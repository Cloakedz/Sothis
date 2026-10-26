// Reads a wireless mouse's battery. Runs in its own process so a sleeping or unresponsive
// receiver can never freeze the main window. Pick the brand in Settings (or leave it on Auto):
//   G-Wolves  : HID feature report (protocol from MouseBattery 1.0.2, MIT)
//   Logitech  : HID++ 2.0 (Unified Battery 0x1004, Battery Status 0x1000 or Battery Voltage 0x1001)
//   Razer     : the 90-byte Razer feature report (battery 0x07/0x80, charging 0x07/0x84)
//   Bluetooth : any Bluetooth mouse that tells Windows its battery level (most do)
const HID = require("node-hid");
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const listHid = () => { try { return HID.devices(); } catch { return null; } };
const clean = (s, d) => String(s || d || "").replace(/\s+/g, " ").trim();

/* ---------- G-Wolves ---------- */
const GWOLVES_VID = 0x33e4, GW_WIRELESS_PID = 0x3508, GW_WIRED_PID = 0x3517;
function gwRequest() { const b = Buffer.alloc(65); b[3] = 0x02; b[4] = 0x02; b[6] = 0x83; return b; }
function gwParse(raw) {
  const r = Buffer.from(raw || []);
  // Windows normally returns the report id (0) first; tolerate it being stripped.
  const base = r[0] === 0x00 && r[1] === 0xa1 ? 0 : r[0] === 0xa1 ? -1 : null;
  if (base === null || r.length < 9 + base) return null;
  const at = i => r[i + base];
  if (at(3) !== 0x02 || at(4) !== 0x02 || at(6) !== 0x83) return null;
  if (at(7) > 1 || at(8) > 100) return null;
  return { percent: at(8), charging: at(7) === 1 };
}
function gwolves(devices) {
  const isGw = d => { const n = String(d.product || "").toLowerCase(); return d.vendorId === GWOLVES_VID || n.includes("g-wolves") || n.includes("gwolves") || n.includes("htx"); };
  const known = devices.filter(isGw);
  if (!known.length) return null;
  const cands = known.filter(d => (d.usagePage || 0) >= 0xff00).sort((a, b) => ((b.usagePage === 0xffff) * 2 + (b.usage === 0)) - ((a.usagePage === 0xffff) * 2 + (a.usage === 0))).slice(0, 16);
  if (!cands.length) return { state: "unsupported", product: clean(known[0].product, "G-Wolves mouse") };
  const seen = new Set();
  for (const d of cands) {
    if (seen.has(d.path)) continue; seen.add(d.path);
    let h; try { h = new HID.HID(d.path); } catch { continue; }
    try {
      for (let i = 0; i < 2; i++) {
        try {
          h.sendFeatureReport(gwRequest()); sleep(100);
          const r = gwParse(h.getFeatureReport(0, 65));
          if (r) return { state: "ok", percent: r.percent, charging: r.charging, product: clean(d.product, "G-Wolves mouse"),
            connection: d.vendorId === GWOLVES_VID && d.productId === GW_WIRELESS_PID ? "Wireless" : d.vendorId === GWOLVES_VID && d.productId === GW_WIRED_PID ? "Wired" : "" };
        } catch {}
      }
    } finally { try { h.close(); } catch {} }
  }
  return { state: "asleep", product: clean(known[0].product, "G-Wolves mouse") };
}

/* ---------- Logitech (HID++ 2.0) ---------- */
const LOGI_VID = 0x046d;
function hppAsk(h, idx, feat, fn, params) {
  const out = Buffer.alloc(20); out[0] = 0x11; out[1] = idx; out[2] = feat; out[3] = (fn << 4) | 0x0a;
  (params || []).forEach((v, i) => { out[4 + i] = v; });
  h.write([...out]);
  const end = Date.now() + 700;
  while (Date.now() < end) {
    let r; try { r = h.readTimeout(250); } catch { return null; }
    if (!r || !r.length) continue;
    // an error for our request, or "no device at this index"
    if ((r[0] === 0x11 && r[1] === idx && r[2] === 0xff && r[3] === feat) || (r[0] === 0x10 && r[1] === idx && r[2] === 0x8f)) return null;
    if (r[0] === 0x11 && r[1] === idx && r[2] === feat && (r[3] & 0x0f) === 0x0a) return r.slice(4);
  }
  return null;
}
function hppFeature(h, idx, id) { const r = hppAsk(h, idx, 0x00, 0, [id >> 8, id & 0xff]); return r && r[0] ? r[0] : 0; }
function voltToPct(mv) { const t = [[4186, 100], [4067, 90], [3989, 80], [3922, 70], [3859, 60], [3811, 50], [3778, 40], [3751, 30], [3717, 20], [3671, 10], [3500, 0]]; for (const [v, p] of t) if (mv >= v) return p; return 0; }
function logiRead(h, idx) {
  let f = hppFeature(h, idx, 0x1004);
  if (f) { const r = hppAsk(h, idx, f, 1); if (r) return { percent: Math.min(100, r[0]), charging: r[2] === 1 || r[2] === 2 || (r[2] === 3 && r[3] === 1) }; }
  f = hppFeature(h, idx, 0x1000);
  if (f) { const r = hppAsk(h, idx, f, 0); if (r && r[0] <= 100) return { percent: r[0], charging: r[2] >= 1 && r[2] <= 3 }; }
  f = hppFeature(h, idx, 0x1001);
  if (f) { const r = hppAsk(h, idx, f, 0); if (r) { const mv = (r[0] << 8) | r[1]; return { percent: voltToPct(mv), charging: !!(r[2] & 0x80) }; } }
  return null;
}
function logitech(devices) {
  const logi = devices.filter(d => d.vendorId === LOGI_VID);
  if (!logi.length) return null;
  // the long HID++ collection (vendor page 0xFF00, usage 2)
  const cands = logi.filter(d => (d.usagePage === 0xff00 || d.usagePage === 0xff43) && d.usage === 0x0002);
  if (!cands.length) return { state: "unsupported", product: clean(logi[0].product, "Logitech mouse") };
  const seen = new Set();
  for (const d of cands) {
    if (seen.has(d.path)) continue; seen.add(d.path);
    let h; try { h = new HID.HID(d.path); } catch { continue; }
    try {
      const receiver = /receiver|lightspeed|unifying|bolt/i.test(d.product || "");
      for (const idx of receiver ? [1, 2, 3, 4, 5, 6] : [0xff, 1]) {
        const r = logiRead(h, idx);
        if (r) return { state: "ok", percent: r.percent, charging: r.charging, product: clean(receiver ? "Logitech mouse" : d.product, "Logitech mouse"), connection: receiver ? "Wireless" : "" };
      }
    } catch {} finally { try { h.close(); } catch {} }
  }
  return { state: "asleep", product: clean(logi[0].product, "Logitech mouse") };
}

/* ---------- Razer ---------- */
const RAZER_VID = 0x1532;
function razerPacket(tid, cls, id, size) {
  const b = Buffer.alloc(91);   // report id 0 + 90 bytes
  b[2] = tid; b[6] = size; b[7] = cls; b[8] = id;
  let crc = 0; for (let i = 3; i < 89; i++) crc ^= b[i]; b[89] = crc;
  return b;
}
function razerAsk(h, tid, cls, id) {
  try {
    h.sendFeatureReport(razerPacket(tid, cls, id, 0x02)); sleep(60);
    const r = Buffer.from(h.getFeatureReport(0, 91));
    const o = r.length === 91 ? 1 : 0;   // with or without the report id in front
    if (r[o] !== 0x02 || r[o + 6] !== cls || r[o + 7] !== id) return null;   // 0x02 = done
    return r[o + 9];
  } catch { return null; }
}
function razer(devices) {
  const rz = devices.filter(d => d.vendorId === RAZER_VID);
  if (!rz.length) return null;
  const seen = new Set();
  for (const d of rz.slice(0, 12)) {
    if (seen.has(d.path)) continue; seen.add(d.path);
    let h; try { h = new HID.HID(d.path); } catch { continue; }
    try {
      for (const tid of [0x1f, 0x3f, 0xff, 0x08]) {
        const lvl = razerAsk(h, tid, 0x07, 0x80);
        if (lvl == null) continue;
        const ch = razerAsk(h, tid, 0x07, 0x84);
        return { state: "ok", percent: Math.round(lvl / 255 * 100), charging: ch === 1, product: clean(d.product, "Razer mouse"), connection: /dongle|receiver|wireless|hyperspeed/i.test(d.product || "") ? "Wireless" : "" };
      }
    } finally { try { h.close(); } catch {} }
  }
  return { state: "unsupported", product: clean(rz[0].product, "Razer mouse") };
}

/* ---------- Bluetooth (Windows keeps the battery level of connected Bluetooth devices) ---------- */
function bluetooth() {
  if (process.platform !== "win32") return null;
  const ps = `$ErrorActionPreference='SilentlyContinue'
$out=@()
foreach ($d in Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -like 'BTHLE*' -or $_.InstanceId -like 'BTHENUM*' }) {
  $b = (Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName '{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2').Data
  if ($b -ne $null) { $out += [pscustomobject]@{ n = $d.FriendlyName; p = [int]$b } }
}
$out | ConvertTo-Json -Compress`;
  let txt = "";
  try { txt = require("child_process").execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { windowsHide: true, timeout: 7000, encoding: "utf8" }); } catch { return null; }
  let list = []; try { list = [].concat(JSON.parse(txt || "[]") || []); } catch {}
  list = list.filter(x => x && x.n && x.p >= 0 && x.p <= 100);
  if (!list.length) return null;
  // the mouse if one says so, else anything that isn't obviously headphones / a controller / a phone
  const pick = list.find(x => /mouse|mx |viper|deathadder|basilisk|pulsar|lamzu|g-?wolves|zowie|finalmouse/i.test(x.n))
    || list.find(x => !/head|bud|pod|ear|speaker|controller|gamepad|xbox|dualsense|phone|iphone|galaxy|watch|keyboard/i.test(x.n));
  if (!pick) return null;
  return { state: "ok", percent: pick.p, charging: false, product: clean(pick.n, "Bluetooth mouse"), connection: "Bluetooth" };
}

/* ---------- pick the brand ---------- */
const READERS = { gwolves, logitech, razer };
function probe(brand) {
  brand = String(brand || "auto");
  if (brand === "off") return { state: "off" };
  if (brand === "bluetooth") return bluetooth() || { state: "none", brand };
  const devices = listHid();
  if (!devices) return { state: "error", message: "Couldn't list USB devices." };
  if (READERS[brand]) return READERS[brand](devices) || { state: "none", brand };
  // Auto: the first brand that answers; a found-but-sleeping mouse beats "nothing found"
  let fallback = null;
  for (const k of ["gwolves", "logitech", "razer"]) {
    const r = READERS[k](devices);
    if (r && r.state === "ok") return r;
    if (r && !fallback) fallback = r;
  }
  const bt = bluetooth(); if (bt) return bt;
  return fallback || { state: "none", brand: "auto" };
}

process.parentPort.on("message", e => {
  const m = e.data;
  const brand = m && typeof m === "object" ? m.brand : "auto";
  if (!(m === "read" || (m && m.cmd === "read"))) return;
  let result;
  try { result = probe(brand); } catch { result = { state: "error", message: "Device access failed." }; }
  process.parentPort.postMessage(result);
});
