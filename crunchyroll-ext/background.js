// Sothis for Crunchyroll: joins what the page says (show, season, episode) with what the video player says (time, paused)
// and sends it to the Sothis app on this PC (127.0.0.1 only). Nothing leaves your computer.
const tabs = {};
chrome.runtime.onMessage.addListener((msg, sender) => {
  const id = sender.tab && sender.tab.id; if (id == null || !msg) return;
  const t = tabs[id] || (tabs[id] = {});
  if (msg.meta) t.meta = msg.meta;
  if (msg.video) t.video = Object.assign(msg.video, { seen: Date.now() });
  if (msg.gone) { delete tabs[id]; return send({ gone: true }); }
  const v = t.video && Date.now() - t.video.seen < 15000 ? t.video : null;
  if (!t.meta || !t.meta.watch) return;
  send(Object.assign({}, t.meta, v ? { time: v.time, dur: v.dur, paused: v.paused } : { paused: true }));
});
chrome.tabs.onRemoved.addListener(id => { if (tabs[id]) { delete tabs[id]; send({ gone: true }); } });
function send(body) {
  fetch("http://127.0.0.1:47823/crunchyroll", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
}
