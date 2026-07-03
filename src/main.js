// tick — compact list of named countdown timers.
// State lives in localStorage; a single 250ms loop drives every timer.

const STORE_KEY = "tick.timers.v1";
const VOL_KEY = "tick.volume.v1"; // 0..100; 50 == previous fixed loudness

/** @typedef {{id:string,name:string,duration:number,remaining:number,running:boolean,endAt:number|null,done:boolean}} Timer */

let pendingCatchup = []; // timers that elapsed while the app was closed — notified after init
/** @type {Timer[]} */
let timers = load();
let editingId = null; // id being edited, or null when creating
let volume = loadVolume(); // 0..100, persisted
let lastVolume = volume > 0 ? volume : 50; // restored when un-muting

const $ = (sel) => document.querySelector(sel);
const listEl = $("#list");
const emptyEl = $("#empty");
const overlay = $("#overlay");
const form = $("#form");
const fName = $("#f-name");
const fH = $("#f-h");
const fM = $("#f-m");
const fS = $("#f-s");
const volEl = $("#vol");
const volWrap = $(".volume");
const volIcon = $("#vol-icon");

// ---------- persistence ----------
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    return JSON.parse(raw).map((t) => {
      // endAt is an absolute wall-clock timestamp, so a running timer survives a
      // full close: resume it if still in the future...
      if (t.running && t.endAt && t.endAt - Date.now() > 0) return { ...t };
      // ...otherwise it elapsed while we were closed — show it done, notify once ready.
      if (t.running && t.endAt) {
        const done = { ...t, running: false, endAt: null, remaining: 0, done: true };
        pendingCatchup.push(done);
        return done;
      }
      return { ...t, running: false, endAt: null }; // was paused — keep its remaining
    });
  } catch {
    return [];
  }
}
function save() {
  localStorage.setItem(STORE_KEY, JSON.stringify(timers));
}
function loadVolume() {
  const n = parseInt(localStorage.getItem(VOL_KEY), 10);
  return isNaN(n) ? 50 : Math.min(100, Math.max(0, n));
}
function saveVolume() {
  localStorage.setItem(VOL_KEY, String(volume));
}

// ---------- volume control ----------
function applyVolume() {
  volEl.value = String(volume);
  volWrap.classList.toggle("muted", volume === 0);
}
function setVolume(v) {
  volume = Math.min(100, Math.max(0, Math.round(v)));
  if (volume > 0) lastVolume = volume;
  saveVolume();
  applyVolume();
}
volEl.addEventListener("input", () => setVolume(parseInt(volEl.value, 10) || 0));
volIcon.addEventListener("click", () => setVolume(volume === 0 ? lastVolume : 0));
applyVolume();

// ---------- helpers ----------
function uid() {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
}
function fmt(secs) {
  secs = Math.max(0, Math.ceil(secs));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

// ---------- audio cue ----------
let audioCtx = null;
// Slider 0..100 → peak gain. 50 maps to 0.25 (the old fixed level), 100 → 0.5.
function peakGain() {
  return (volume / 100) * 0.5;
}
function beep() {
  const peak = peakGain();
  if (peak <= 0) return; // muted
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const now = audioCtx.currentTime;
    [0, 0.28, 0.56].forEach((offset) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(peak, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.22);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.24);
    });
  } catch {
    /* audio not available — silent */
  }
}

// ---------- native notification ----------
const notif = window.__TAURI__ && window.__TAURI__.notification;
let canNotify = false;
async function initNotifications() {
  if (!notif) return; // running outside Tauri (e.g. plain browser)
  try {
    let granted = await notif.isPermissionGranted();
    if (!granted) granted = (await notif.requestPermission()) === "granted";
    canNotify = granted;
  } catch {
    canNotify = false;
  }
  flushCatchup(); // fire any "finished while away" notifications now that we can
}
function flushCatchup() {
  for (const t of pendingCatchup) notifyDone(t);
  pendingCatchup = [];
}
function notifyDone(t) {
  if (!canNotify || !notif) return;
  try {
    notif.sendNotification({ title: t.name ? t.name : "Timer", body: "Time's up" });
  } catch {
    /* ignore */
  }
}
initNotifications();

// ---------- timer actions ----------
function startTimer(t) {
  if (t.remaining <= 0) t.remaining = t.duration;
  t.running = true;
  t.done = false;
  t.endAt = Date.now() + t.remaining * 1000;
  save();
  render();
}
function pauseTimer(t) {
  if (!t.running) return;
  t.remaining = Math.max(0, (t.endAt - Date.now()) / 1000);
  t.running = false;
  t.endAt = null;
  save();
  render();
}
function resetTimer(t) {
  t.running = false;
  t.endAt = null;
  t.done = false;
  t.remaining = t.duration;
  save();
  render();
}
function removeTimer(id) {
  timers = timers.filter((t) => t.id !== id);
  save();
  render();
}
function fire(t) {
  t.running = false;
  t.endAt = null;
  t.remaining = 0;
  t.done = true;
  save();
  beep();
  notifyDone(t);
}

// ---------- main loop ----------
function loop() {
  let dirty = false;
  for (const t of timers) {
    if (!t.running) continue;
    const rem = (t.endAt - Date.now()) / 1000;
    if (rem <= 0) {
      fire(t);
      dirty = true;
    }
    updateRow(t, Math.max(0, rem));
  }
  if (dirty) render();
}
setInterval(loop, 250);

// ---------- rendering ----------
const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
  reset: '<svg viewBox="0 0 24 24"><path d="M12 5V1L7 6l5 5V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75zM20.7 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75z"/></svg>',
  del: '<svg viewBox="0 0 24 24"><path d="M6 7h12l-1 14H7zM9 4h6l1 2H8zM4 6h16v2H4z"/></svg>',
};

function liveRemaining(t) {
  return t.running ? Math.max(0, (t.endAt - Date.now()) / 1000) : t.remaining;
}

function render() {
  emptyEl.classList.toggle("hidden", timers.length > 0);
  listEl.innerHTML = "";
  for (const t of timers) {
    const rem = liveRemaining(t);
    const li = document.createElement("li");
    li.className = "row" + (t.running ? " running" : "") + (t.done ? " done" : "");
    li.dataset.id = t.id;
    const pct = t.duration > 0 ? rem / t.duration : 0;
    const warn = t.running && rem <= 10 && rem > 0;
    li.innerHTML = `
      <div class="meta">
        <div class="name">${t.name ? escapeHtml(t.name) : "Timer"}</div>
        <div class="time${warn ? " warn" : ""}">${fmt(rem)}</div>
        <div class="bar"><i style="transform:scaleX(${pct})"></i></div>
      </div>
      <div class="controls">
        <button class="ctl primary" data-act="toggle" title="${t.running ? "Pause" : "Start"}">${t.running ? ICON.pause : ICON.play}</button>
        <button class="ctl" data-act="reset" title="Reset">${ICON.reset}</button>
        <button class="ctl" data-act="edit" title="Edit">${ICON.edit}</button>
        <button class="ctl" data-act="del" title="Delete">${ICON.del}</button>
      </div>`;
    listEl.appendChild(li);
  }
}

// light-touch update so the loop doesn't rebuild the DOM 4x/sec
function updateRow(t, rem) {
  const li = listEl.querySelector(`.row[data-id="${t.id}"]`);
  if (!li) return;
  const timeEl = li.querySelector(".time");
  timeEl.textContent = fmt(rem);
  timeEl.classList.toggle("warn", rem <= 10 && rem > 0);
  const bar = li.querySelector(".bar > i");
  if (bar) bar.style.transform = `scaleX(${t.duration > 0 ? rem / t.duration : 0})`;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- events ----------
listEl.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const id = btn.closest(".row").dataset.id;
  const t = timers.find((x) => x.id === id);
  if (!t) return;
  switch (btn.dataset.act) {
    case "toggle": t.running ? pauseTimer(t) : startTimer(t); break;
    case "reset": resetTimer(t); break;
    case "edit": openForm(t); break;
    case "del": removeTimer(id); break;
  }
});

// ---------- form (create / edit) ----------
function openForm(t) {
  editingId = t ? t.id : null;
  fName.value = t ? t.name : "";
  const d = t ? t.duration : 0;
  fH.value = d ? Math.floor(d / 3600) || "" : "";
  fM.value = d ? Math.floor((d % 3600) / 60) || "" : "";
  fS.value = d ? d % 60 || "" : "";
  overlay.classList.remove("hidden");
  fName.focus();
}
function closeForm() {
  overlay.classList.add("hidden");
  editingId = null;
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const h = clamp(fH.value, 99);
  const m = clamp(fM.value, 59);
  const s = clamp(fS.value, 59);
  const duration = h * 3600 + m * 60 + s;
  if (duration <= 0) { fS.focus(); return; }
  const name = fName.value.trim();

  if (editingId) {
    const t = timers.find((x) => x.id === editingId);
    if (t) {
      t.name = name;
      t.duration = duration;
      if (!t.running) { t.remaining = duration; t.done = false; }
    }
  } else {
    timers.push({ id: uid(), name, duration, remaining: duration, running: false, endAt: null, done: false });
  }
  save();
  render();
  closeForm();
});

function clamp(v, max) {
  const n = parseInt(v, 10);
  if (isNaN(n) || n < 0) return 0;
  return Math.min(n, max);
}

// select the value on focus so a single click replaces it (keyboard tab too);
// deferred so a real drag-select isn't clobbered by the programmatic select.
for (const el of [fH, fM, fS]) {
  el.addEventListener("focus", () => setTimeout(() => el.select(), 0));
}

$("#add-btn").addEventListener("click", () => openForm(null));
$("#f-cancel").addEventListener("click", closeForm);
// close only when the press *starts* on the backdrop — otherwise a text
// selection that drags from an input and releases on the backdrop would
// count as a backdrop click (click fires on the mousedown/up common ancestor).
let downOnOverlay = false;
overlay.addEventListener("mousedown", (e) => { downOnOverlay = e.target === overlay; });
overlay.addEventListener("click", (e) => { if (e.target === overlay && downOnOverlay) closeForm(); });

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !overlay.classList.contains("hidden")) closeForm();
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") { e.preventDefault(); openForm(null); }
});

render();

// ---------- auto-update ----------
// On startup, ask the updater (GitHub Releases) if there's a newer version. If so,
// surface a small banner; the user opts in to download + install + relaunch.
const upd = window.__TAURI__ && window.__TAURI__.updater;
const proc = window.__TAURI__ && window.__TAURI__.process;
const updateBar = $("#update-bar");
const updateMsg = $("#update-msg");
let pendingUpdate = null;

async function checkForUpdate() {
  if (!upd) return; // plain browser, or updater not available
  try {
    const update = await upd.check();
    if (!update) return; // already up to date
    pendingUpdate = update;
    updateMsg.textContent = `Update available — v${update.version}`;
    updateBar.classList.remove("hidden");
  } catch {
    /* offline / no release yet — fail quiet */
  }
}

async function installUpdate() {
  if (!pendingUpdate) return;
  const now = $("#update-now");
  now.disabled = true;
  updateMsg.textContent = "Downloading…";
  try {
    await pendingUpdate.downloadAndInstall();
    updateMsg.textContent = "Restarting…";
    if (proc) await proc.relaunch();
  } catch {
    updateMsg.textContent = "Update failed — try again later";
    now.disabled = false;
  }
}

$("#update-now").addEventListener("click", installUpdate);
$("#update-later").addEventListener("click", () => updateBar.classList.add("hidden"));
if (window.__TAURI__) checkForUpdate();

// ---------- reveal window ----------
// The window starts hidden (tauri.conf.json) so it never flashes white at the default
// position before the saved geometry is restored. Show it only after the UI has painted.
function revealWindow() {
  const w = window.__TAURI__ && window.__TAURI__.window;
  if (!w) return; // plain browser — nothing to show
  w.getCurrentWindow().show().catch(() => {});
}
// When launched at login (autostart), the Rust side flags this so we stay in the
// tray instead of popping the window. Ask before revealing.
async function startedHidden() {
  try {
    const core = window.__TAURI__ && window.__TAURI__.core;
    return core ? await core.invoke("started_hidden") : false;
  } catch {
    return false;
  }
}
if (window.__TAURI__) {
  startedHidden().then((hidden) => {
    if (hidden) return; // login launch — leave it in the tray
    // wait two frames so the first paint has landed, then reveal
    requestAnimationFrame(() => requestAnimationFrame(revealWindow));
    // safety net so the window can never stay hidden if a frame never fires
    setTimeout(revealWindow, 400);
  });
}
