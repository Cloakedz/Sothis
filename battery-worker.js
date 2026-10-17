// Reads a G-Wolves mouse's battery over HID. Runs in its own process so a
// sleeping or unresponsive receiver can never freeze the main window.
// Protocol (from MouseBattery 1.0.2, MIT): send a 65-byte feature report
// [0]=0x00 (report id) [3]=0x02 [4]=0x02 [6]=0x83, wait 100 ms, read a
// 65-byte feature report back: [1]=0xA1 [3]=0x02 [4]=0x02 [6]=0x83,
// [7]=charging (0/1), [8]=percent (0-100).
const HID = require("node-hid");

const GWOLVES_VID = 0x33e4;
const WIRELESS_PID = 0x3508;
const WIRED_PID = 0x3517;

function batteryRequest() {
  const b = Buffer.alloc(65);
  b[3] = 0x02; b[4] = 0x02; b[6] = 0x83;
  return b;
}

function parse(raw) {
  const r = Buffer.from(raw || []);
  // Windows normally returns the report id (0) first; tolerate it being stripped.
  const base = r[0] === 0x00 && r[1] === 0xa1 ? 0 : r[0] === 0xa1 ? -1 : null;
  if (base === null || r.length < 9 + base) return null;
  const at = i => r[i + base];
  if (at(3) !== 0x02 || at(4) !== 0x02 || at(6) !== 0x83) return null;
  if (at(7) > 1 || at(8) > 100) return null;
  return { percent: at(8), charging: at(7) === 1 };
}

function isCandidate(d) {
  const name = String(d.product || "").toLowerCase();
  return d.vendorId === GWOLVES_VID || name.includes("g-wolves") || name.includes("gwolves") || name.includes("htx");
}

function connection(d) {
  const name = String(d.product || "").toLowerCase();
  if (d.vendorId === GWOLVES_VID && d.productId === WIRELESS_PID) return "Wireless";
  if (d.vendorId === GWOLVES_VID && d.productId === WIRED_PID) return "Wired";
  if (name.includes("receiver") || name.includes("dongle")) return "Wireless";
  return "";
}

const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function probe() {
  let devices;
  try { devices = HID.devices(); } catch { return { state: "error", message: "Couldn't list USB devices." }; }

  const known = devices.filter(isCandidate);
  const candidates = known
    .filter(d => (d.usagePage || 0) >= 0xff00)
    .sort((a, b) => score(b) - score(a))
    .slice(0, 16);
  if (!known.length) return { state: "none" };
  if (!candidates.length) return { state: "unsupported" };

  const seen = new Set();
  for (const d of candidates) {
    if (seen.has(d.path)) continue;
    seen.add(d.path);
    let h;
    try { h = new HID.HID(d.path); } catch { continue; }
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          h.sendFeatureReport(batteryRequest());
          sleep(100);
          const reading = parse(h.getFeatureReport(0, 65));
          if (reading) {
            return {
              state: "ok",
              percent: reading.percent,
              charging: reading.charging,
              product: (d.product || "G-Wolves mouse").trim(),
              connection: connection(d)
            };
          }
        } catch {}
      }
    } finally {
      try { h.close(); } catch {}
    }
  }
  return { state: "asleep", product: (known[0].product || "G-Wolves mouse").trim() };
}

function score(d) {
  let s = 0;
  if (d.usagePage === 0xffff) s += 2;
  if (d.usage === 0) s += 1;
  return s;
}

process.parentPort.on("message", e => {
  if (e.data !== "read") return;
  let result;
  try { result = probe(); } catch (err) { result = { state: "error", message: "Device access failed." }; }
  process.parentPort.postMessage(result);
});
