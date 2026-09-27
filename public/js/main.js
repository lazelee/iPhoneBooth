import { LAYOUTS, LAYOUT_ORDER, shotCount, cellRects } from "./layouts.js";
import { FRAMES, PACKS, framesInPack } from "./frames.js";
import { FILTERS, renderStrip, renderPrint, renderWallpaper, photoFor, dateStamp } from "./compose.js";
import { createDecorator, STICKERS, CRAYONS, SIZES } from "./decorate.js";
import { startCamera, stopCamera, cameraLive, grabFrame } from "./camera.js";
import { startRecording, videoExt } from "./recorder.js";
import { beep, shutter, setSound, unlockAudio } from "./audio.js";
import { uploadStrip, fetchInfo, canvasToBlob, blobToDataUrl, saveOrShare, printImage } from "./share.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dpr = () => Math.min(2, window.devicePixelRatio || 1);

const app = $("#app");
const video = $("#camera");

// ---------- settings ----------
const DEFAULTS = { countdown: 3, gap: 1600, facing: "user", mirror: true, sound: true, record: true, autoSend: true, idle: true };
const settings = (() => {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem("ipb.settings") || "{}") };
  } catch {
    return { ...DEFAULTS };
  }
})();
function saveSettings() {
  try {
    localStorage.setItem("ipb.settings", JSON.stringify(settings));
  } catch {
    /* private mode */
  }
}

// ---------- session ----------
function freshSession() {
  return {
    layout: "strip",
    frame: "paper",
    pack: "Simple",
    shots: [],
    slots: [],
    filter: "original",
    deco: { stickers: [], strokes: [] },
    caption: "",
    showDate: true,
    clip: null,
    exports: null,
    upload: "idle", // idle | sending | sent | failed | off
    shooting: false,
    abort: false,
  };
}
let S = freshSession();

function releaseShots() {
  for (const shot of S.shots) {
    shot.canvas.width = 0; // lets iOS reclaim canvas memory right away
    shot.cache?.clear();
  }
  S.shots = [];
  S.slots = [];
  S.clip = null;
  S.exports = null;
}

const slotPhotos = () => S.slots.map((i) => (i == null ? null : S.shots[i]));
const cellAspect = () => {
  const r = cellRects(S.layout)[0];
  return r.w / r.h;
};

// ---------- scenes ----------
const FLOW = ["start", "size", "frame", "booth", "pick", "filter", "decorate", "done"];
const RAIL = [["size", "Size"], ["frame", "Frame"], ["booth", "Shoot"], ["pick", "Pick"], ["filter", "Filter"], ["decorate", "Decorate"], ["done", "Done"]];
const CAMERA_SCENES = new Set(["size", "frame", "booth"]);
let scene = "start";
const enter = {};

function go(next) {
  scene = next;
  app.dataset.scene = next;
  $$(".scene").forEach((el) => {
    el.hidden = el.dataset.scene !== next;
  });
  renderRail();
  if (CAMERA_SCENES.has(next)) {
    ensureCamera().catch((err) => {
      toast(cameraMessage(err));
      go("start");
      showStartError(err);
    });
  } else {
    stopCamera(video);
  }
  enter[next]?.();
  bumpIdle();
  window.scrollTo(0, 0);
}

function renderRail() {
  const rail = $("#rail");
  const at = RAIL.findIndex(([id]) => id === scene);
  rail.innerHTML = "";
  RAIL.forEach(([id, label], i) => {
    const li = document.createElement("li");
    li.className = i < at ? "done" : i === at ? "on" : "";
    li.title = label;
    li.setAttribute("aria-label", `${label}${i === at ? " (current)" : ""}`);
    rail.appendChild(li);
  });
}

$$("[data-back]").forEach((b) =>
  b.addEventListener("click", () => {
    const back = { size: "start", frame: "size", filter: "pick", decorate: "filter" }[scene];
    if (back) go(back);
  })
);
$$("[data-next]").forEach((b) =>
  b.addEventListener("click", () => {
    if (b.disabled) return;
    go(FLOW[FLOW.indexOf(scene) + 1]);
  })
);

// ---------- camera ----------
let camPromise = null;
const mirrored = () => settings.mirror && settings.facing === "user";

function applyMirror() {
  video.classList.toggle("mirror", mirrored());
}

async function ensureCamera() {
  if (cameraLive(video)) return;
  if (!camPromise) {
    camPromise = startCamera(video, settings.facing)
      .then(() => {
        applyMirror();
        updateGuide();
      })
      .finally(() => {
        camPromise = null;
      });
  }
  return camPromise;
}

async function restartCamera() {
  stopCamera(video);
  await ensureCamera();
}

function cameraMessage(err) {
  const name = err?.name || "";
  const msg = String(err?.message || err || "");
  if (!window.isSecureContext) return "The camera needs HTTPS. Open the https:// address shown in the Mac terminal.";
  if (name === "NotAllowedError" || /denied|not allowed/i.test(msg)) return "Camera access is off. In Safari tap aA → Website Settings → Camera → Allow, then try again.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera found on this device.";
  if (name === "NotReadableError") return "The camera is busy in another app. Close it and try again.";
  return msg || "Could not start the camera.";
}

function showStartError(err) {
  const el = $("#startError");
  el.hidden = false;
  el.textContent = cameraMessage(err);
}

// The crop guide shows exactly what lands in each photo box.
function updateGuide() {
  const guide = $("#guide");
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) {
    guide.hidden = true;
    return;
  }
  const W = window.innerWidth;
  const H = window.innerHeight;
  const s = Math.max(W / vw, H / vh);
  const a = cellAspect();
  let cw = vw;
  let ch = vw / a;
  if (ch > vh) {
    ch = vh;
    cw = vh * a;
  }
  let gw = cw * s;
  let gh = ch * s;
  // keep the guide on screen with a margin, above the dock
  const maxW = W - 24;
  const maxH = H - 320;
  const fit = Math.min(1, maxW / gw, maxH / gh);
  gw *= fit;
  gh *= fit;
  guide.hidden = false;
  guide.style.width = `${gw}px`;
  guide.style.height = `${gh}px`;
  guide.style.left = `${(W - gw) / 2}px`;
  guide.style.top = `${Math.max(132, (H - 190 - gh) / 2 + 60)}px`;
}
video.addEventListener("loadedmetadata", updateGuide);

// ---------- start ----------
$("#startBtn").addEventListener("click", async () => {
  const btn = $("#startBtn");
  btn.disabled = true;
  $("#startError").hidden = true;
  setSound(settings.sound);
  unlockAudio();
  try {
    await ensureCamera();
    lockScreen();
    go("size");
  } catch (err) {
    showStartError(err);
  } finally {
    btn.disabled = false;
  }
});
$("#homeBtn").addEventListener("click", () => {
  if (scene === "start") return;
  if (S.shooting) return;
  ask("Start over?", "This clears the current strip.", "Start over").then((ok) => ok && newGuests());
});

function newGuests() {
  releaseShots();
  const caption = S.caption;
  S = freshSession();
  S.caption = caption; // an event caption usually stays the same all night
  $("#caption").value = S.caption;
  go("start");
}

// ---------- size ----------
function thumbScale(L, cssH) {
  return (cssH * dpr()) / L.h;
}

enter.size = () => {
  const grid = $("#layoutGrid");
  grid.innerHTML = "";
  for (const id of LAYOUT_ORDER) {
    const L = LAYOUTS[id];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `choice${S.layout === id ? " on" : ""}`;
    btn.setAttribute("aria-pressed", String(S.layout === id));
    const canvas = renderStrip({ layout: id, frame: "ink", numbers: true, scale: thumbScale(L, 150), caption: "", date: `${L.slots + 2} shots` });
    canvas.className = "thumb";
    const cap = document.createElement("span");
    cap.className = "choice-cap";
    cap.innerHTML = `<b>${L.name}</b><small>${L.hint}</small>`;
    btn.append(canvas, cap);
    btn.addEventListener("click", () => {
      S.layout = id;
      enter.size();
    });
    btn.addEventListener("dblclick", () => go("frame"));
    grid.appendChild(btn);
  }
};

// ---------- frame ----------
enter.frame = () => {
  const tabs = $("#packTabs");
  tabs.innerHTML = "";
  for (const pack of PACKS) {
    const t = document.createElement("button");
    t.type = "button";
    t.role = "tab";
    t.className = `tab${S.pack === pack ? " on" : ""}`;
    t.setAttribute("aria-selected", String(S.pack === pack));
    const has = FRAMES[S.frame]?.pack === pack ? " •" : "";
    t.textContent = pack + has;
    t.addEventListener("click", () => {
      S.pack = pack;
      enter.frame();
    });
    tabs.appendChild(t);
  }
  const grid = $("#frameGrid");
  grid.innerHTML = "";
  const L = LAYOUTS[S.layout];
  for (const f of framesInPack(S.pack)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `choice${S.frame === f.id ? " on" : ""}`;
    btn.setAttribute("aria-pressed", String(S.frame === f.id));
    const canvas = renderStrip({ layout: S.layout, frame: f.id, scale: thumbScale(L, 170), caption: S.caption || "iPhoneBooth", date: dateStamp() });
    canvas.className = "thumb";
    const cap = document.createElement("span");
    cap.className = "choice-cap";
    cap.innerHTML = `<b>${f.name}</b>`;
    btn.append(canvas, cap);
    btn.addEventListener("click", () => {
      S.frame = f.id;
      enter.frame();
    });
    grid.appendChild(btn);
  }
};

// ---------- booth ----------
const ring = $("#ring");
const RING_LEN = 2 * Math.PI * 46;
ring.style.strokeDasharray = `${RING_LEN}`;
ring.style.strokeDashoffset = `${RING_LEN}`;

enter.booth = () => {
  S.shots.forEach((s) => (s.canvas.width = 0));
  S.shots = [];
  S.slots = [];
  S.clip = null;
  S.exports = null;
  $("#shotLabel").textContent = `${shotCount(S.layout)} shots · keep your best ${LAYOUTS[S.layout].slots}`;
  renderShotRail();
  updateGuide();
};

function renderShotRail() {
  const rail = $("#shotRail");
  const n = shotCount(S.layout);
  rail.innerHTML = "";
  for (let i = 0; i < n; i++) {
    const cell = document.createElement("span");
    cell.className = "shot-cell";
    cell.style.aspectRatio = String(cellAspect());
    const shot = S.shots[i];
    if (shot) {
      const img = document.createElement("img");
      img.src = thumbFor(shot, "original");
      img.alt = `Shot ${i + 1}`;
      cell.appendChild(img);
      cell.classList.add("filled");
    } else {
      cell.textContent = String(i + 1);
      if (S.shooting && i === S.shots.length) cell.classList.add("next");
    }
    rail.appendChild(cell);
  }
}

function thumbFor(shot, filter) {
  shot.thumbs ||= {};
  const key = `${S.layout}|${filter}`;
  if (!shot.thumbs[key]) {
    const w = 240;
    shot.thumbs[key] = photoFor(shot, filter, w, w / cellAspect()).toDataURL("image/jpeg", 0.82);
  }
  return shot.thumbs[key];
}

async function countdown(seconds) {
  const cd = $("#countdown");
  ring.style.transition = "none";
  ring.style.strokeDashoffset = "0";
  void ring.getBoundingClientRect();
  ring.style.transition = `stroke-dashoffset ${seconds}s linear`;
  ring.style.strokeDashoffset = `${RING_LEN}`;
  for (let n = seconds; n >= 1; n--) {
    if (S.abort) return;
    cd.textContent = String(n);
    cd.classList.remove("pop");
    void cd.offsetWidth;
    cd.classList.add("pop");
    beep(n === 1 ? 1320 : 880, 0.09);
    navigator.vibrate?.(n === 1 ? 40 : 15);
    await sleep(1000);
  }
  cd.classList.remove("pop");
  cd.textContent = "";
}

async function runShoot() {
  if (S.shooting) return;
  await ensureCamera().catch(() => {});
  if (!cameraLive(video)) {
    toast("Camera isn't running. Check permissions and try again.");
    return;
  }
  setSound(settings.sound);
  lockScreen();
  S.shooting = true;
  S.abort = false;
  app.classList.add("shooting");
  S.shots = [];
  const n = shotCount(S.layout);
  const rec = settings.record ? startRecording(video.srcObject) : null;
  const flash = $("#flash");
  try {
    for (let i = 0; i < n; i++) {
      $("#shotLabel").textContent = `Shot ${i + 1} of ${n}`;
      renderShotRail();
      await countdown(settings.countdown);
      if (S.abort) throw new Error("aborted");
      flash.classList.remove("go");
      void flash.offsetWidth;
      flash.classList.add("go");
      shutter();
      const canvas = grabFrame(video, mirrored());
      S.shots.push({ id: i, canvas });
      renderShotRail();
      if (i < n - 1) {
        $("#shotLabel").textContent = i === n - 2 ? "Last one!" : ["Nice.", "Love it.", "Switch it up.", "Big smile.", "Now a silly one."][i % 5];
        await sleep(settings.gap);
        if (S.abort) throw new Error("aborted");
      }
    }
  } catch (err) {
    S.shooting = false;
    app.classList.remove("shooting");
    rec?.stop();
    $("#countdown").textContent = "";
    ring.style.transition = "none";
    ring.style.strokeDashoffset = `${RING_LEN}`;
    if (err.message !== "aborted") toast("Capture failed. Try again.");
    enter.booth();
    return;
  }
  $("#shotLabel").textContent = "Developing…";
  S.clip = rec ? await rec.stop() : null;
  S.shooting = false;
  app.classList.remove("shooting");
  autoFill();
  await sleep(350);
  go("pick");
}

function autoFill() {
  const need = LAYOUTS[S.layout].slots;
  const idx = S.shots.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  S.slots = idx.slice(0, need).sort((a, b) => a - b);
}

$("#shutterBtn").addEventListener("click", runShoot);
$("#boothBack").addEventListener("click", () => {
  if (S.shooting) {
    S.abort = true;
    return;
  }
  go("frame");
});
$("#flipBtn").addEventListener("click", async () => {
  if (S.shooting) return;
  settings.facing = settings.facing === "user" ? "environment" : "user";
  saveSettings();
  syncSettingsUI();
  try {
    await restartCamera();
  } catch (err) {
    toast(cameraMessage(err));
  }
});

// ---------- pick ----------
function previewScale(canvas) {
  const box = canvas.parentElement.getBoundingClientRect();
  const L = LAYOUTS[S.layout];
  const s = Math.min((box.height * dpr()) / L.h, (box.width * dpr()) / L.w);
  return Math.max(0.15, Math.min(1, s || 0.3));
}

function renderPickPreview() {
  const canvas = $("#pickCanvas");
  renderStrip({ layout: S.layout, frame: S.frame, photos: slotPhotos(), filter: "original", caption: S.caption, date: S.showDate ? dateStamp() : "", numbers: true, deco: false, scale: previewScale(canvas), canvas });
}

enter.pick = () => {
  const need = LAYOUTS[S.layout].slots;
  $("#pickTitle").textContent = need === 1 ? "Pick your shot" : `Pick your ${need}`;
  renderPickPreview();
  renderPool();
};

function renderPool() {
  const pool = $("#pool");
  const need = LAYOUTS[S.layout].slots;
  pool.innerHTML = "";
  S.shots.forEach((shot, i) => {
    const at = S.slots.indexOf(i);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `pool-item${at >= 0 ? " on" : ""}`;
    btn.style.aspectRatio = String(cellAspect());
    btn.setAttribute("aria-pressed", String(at >= 0));
    btn.setAttribute("aria-label", `Shot ${i + 1}${at >= 0 ? `, in box ${at + 1}` : ""}`);
    const img = document.createElement("img");
    img.src = thumbFor(shot, "original");
    img.alt = "";
    btn.appendChild(img);
    if (at >= 0) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = String(at + 1);
      btn.appendChild(badge);
    }
    btn.addEventListener("click", () => togglePick(i));
    pool.appendChild(btn);
  });
  const filled = S.slots.filter((v) => v != null).length;
  const next = $('section[data-scene="pick"] [data-next]');
  next.disabled = filled < need;
  $("#pickNote").textContent = filled < need ? `${need - filled} more to go` : `${filled} of ${need}`;
}

function togglePick(i) {
  const need = LAYOUTS[S.layout].slots;
  const at = S.slots.indexOf(i);
  if (at >= 0) {
    S.slots[at] = null;
  } else {
    let empty = S.slots.indexOf(null);
    if (empty < 0 && S.slots.length < need) empty = S.slots.length;
    if (empty < 0) {
      if (need === 1) empty = 0;
      else {
        toast("Strip is full. Tap a photo on it to clear a box.");
        return;
      }
    }
    S.slots[empty] = i;
  }
  renderPickPreview();
  renderPool();
}

function canvasPoint(canvas, e) {
  const r = canvas.getBoundingClientRect();
  const s = Math.min(r.width / canvas.width, r.height / canvas.height);
  const w = canvas.width * s;
  const h = canvas.height * s;
  return [(e.clientX - r.left - (r.width - w) / 2) / w, (e.clientY - r.top - (r.height - h) / 2) / h];
}

$("#pickCanvas").addEventListener("click", (e) => {
  const [nx, ny] = canvasPoint(e.currentTarget, e);
  const L = LAYOUTS[S.layout];
  const x = nx * L.w;
  const y = ny * L.h;
  const k = cellRects(S.layout).findIndex((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
  if (k >= 0 && S.slots[k] != null) {
    S.slots[k] = null;
    renderPickPreview();
    renderPool();
  }
});
$("#pickRetake").addEventListener("click", async () => {
  if (await ask("Retake?", "All shots will be replaced.", "Retake")) go("booth");
});

// ---------- filter ----------
function renderFilterPreview() {
  const canvas = $("#filterCanvas");
  renderStrip({ layout: S.layout, frame: S.frame, photos: slotPhotos(), filter: S.filter, caption: S.caption, date: S.showDate ? dateStamp() : "", deco: false, scale: previewScale(canvas), canvas });
}

enter.filter = () => {
  const row = $("#filterRow");
  row.innerHTML = "";
  const sample = slotPhotos().find(Boolean);
  for (const [key, f] of Object.entries(FILTERS)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.role = "option";
    btn.className = `filter-card${S.filter === key ? " on" : ""}`;
    btn.setAttribute("aria-selected", String(S.filter === key));
    const img = document.createElement("img");
    img.alt = "";
    img.src = thumbFor(sample, key);
    img.style.aspectRatio = String(cellAspect());
    const cap = document.createElement("span");
    cap.textContent = f.name;
    btn.append(img, cap);
    btn.addEventListener("click", () => {
      S.filter = key;
      $$(".filter-card", row).forEach((c) => {
        c.classList.toggle("on", c === btn);
        c.setAttribute("aria-selected", String(c === btn));
      });
      renderFilterPreview();
    });
    row.appendChild(btn);
  }
  renderFilterPreview();
  requestAnimationFrame(() => $(".filter-card.on", row)?.scrollIntoView({ block: "nearest", inline: "center" }));
};

// ---------- decorate ----------
const deco = createDecorator({
  wrap: $("#decoWrap"),
  stage: $("#decoStage"),
  base: $("#decoBase"),
  draw: $("#decoDraw"),
  layer: $("#decoLayer"),
  onChange: bumpIdle,
});

function renderDecoBase(canvas, pw) {
  renderStrip({ layout: S.layout, frame: S.frame, photos: slotPhotos(), filter: S.filter, caption: S.caption, date: S.showDate ? dateStamp() : "", deco: false, scale: pw / LAYOUTS[S.layout].w, canvas });
}

enter.decorate = () => {
  const L = LAYOUTS[S.layout];
  requestAnimationFrame(() => deco.mount(S.deco, L.w / L.h, renderDecoBase));
  setTool($(".deco-panel .tab.on")?.dataset.tool || "sticker");
};

let drawSize = "fine";
function setTool(tool) {
  $$(".deco-panel .tab").forEach((t) => {
    t.classList.toggle("on", t.dataset.tool === tool);
    t.setAttribute("aria-selected", String(t.dataset.tool === tool));
  });
  $$(".deco-panel .tool").forEach((p) => {
    p.hidden = p.dataset.panel !== tool;
  });
  $(".tool-actions").hidden = tool === "text";
  if (tool === "draw") deco.setMode(drawSize === "erase" ? "erase" : "draw");
  else deco.setMode("sticker");
}
$$(".deco-panel .tab").forEach((t) => t.addEventListener("click", () => setTool(t.dataset.tool)));

const tray = $("#stickerTray");
for (const emoji of STICKERS) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "sticker-pick";
  b.textContent = emoji;
  b.setAttribute("aria-label", `Add ${emoji} sticker`);
  b.addEventListener("click", () => deco.addSticker(emoji));
  tray.appendChild(b);
}
const crayons = $("#crayons");
CRAYONS.forEach((c, i) => {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `swatch${i === 2 ? " on" : ""}`;
  b.style.setProperty("--c", c);
  b.setAttribute("aria-label", `Crayon ${c}`);
  b.addEventListener("click", () => {
    deco.setColor(c);
    $$(".swatch", crayons).forEach((s) => s.classList.toggle("on", s === b));
    if (drawSize === "erase") selectSize("fine");
  });
  crayons.appendChild(b);
});
function selectSize(size) {
  drawSize = size;
  $$('[data-panel="draw"] .seg-btn').forEach((s) => s.classList.toggle("on", s.dataset.size === size));
  if (size === "erase") deco.setMode("erase");
  else {
    deco.setSize(SIZES[size]);
    deco.setMode("draw");
  }
}
$$('[data-panel="draw"] .seg-btn').forEach((b) => b.addEventListener("click", () => selectSize(b.dataset.size)));
$("#decoUndo").addEventListener("click", () => deco.undo());
$("#decoClear").addEventListener("click", () => deco.clear());

let captionTimer;
$("#caption").addEventListener("input", (e) => {
  S.caption = e.target.value;
  clearTimeout(captionTimer);
  captionTimer = setTimeout(() => deco.refit(), 120);
});
$("#caption").addEventListener("keydown", (e) => {
  if (e.key === "Enter") e.target.blur();
});
$("#dateToggle").addEventListener("change", (e) => {
  S.showDate = e.target.checked;
  deco.refit();
});

// ---------- done ----------
enter.done = async () => {
  deco.deselect();
  const img = $("#finalImg");
  const strip = renderStrip({
    layout: S.layout,
    frame: S.frame,
    photos: slotPhotos(),
    filter: S.filter,
    stickers: S.deco.stickers,
    strokes: S.deco.strokes,
    caption: S.caption,
    date: S.showDate ? dateStamp() : "",
  });
  const exp = { strip: null, print: null, wall: null, stripUrl: null, printUrl: null };
  S.exports = exp;
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  exp.name = `iphonebooth-${stamp}`;
  $("#clipBtn").hidden = !S.clip;
  if (S.clip) $("#clipStatus").textContent = `${videoExt(S.clip)} video`;
  setStation(settings.autoSend ? "sending" : "off");

  exp.strip = await canvasToBlob(strip);
  if (S.exports !== exp) return;
  if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
  exp.stripUrl = URL.createObjectURL(exp.strip);
  img.src = exp.stripUrl;
  img.dataset.url = exp.stripUrl;

  const print = renderPrint(strip, S.layout);
  exp.print = await canvasToBlob(print);
  exp.printUrl = URL.createObjectURL(exp.print);
  const firstShot = slotPhotos().find(Boolean);
  exp.wall = await canvasToBlob(renderWallpaper(strip, firstShot, S.filter));
  print.width = 0;
  strip.width = 0;
  if (S.exports !== exp) return;
  if (settings.autoSend) sendToStation();
};

function setStation(status) {
  S.upload = status;
  const label = { idle: "tap to send", sending: "sending…", sent: "queued ✓", failed: "failed · tap to retry", off: "tap to send" }[status];
  $("#stationStatus").textContent = label;
  $("#stationBtn").classList.toggle("ok", status === "sent");
  $("#stationBtn").classList.toggle("bad", status === "failed");
}

async function sendToStation() {
  const exp = S.exports;
  if (!exp?.strip || !exp.print || exp.sending) return;
  exp.sending = true;
  setStation("sending");
  try {
    await uploadStrip({
      strip: await blobToDataUrl(exp.strip),
      print: await blobToDataUrl(exp.print),
      layout: S.layout,
      theme: S.frame,
      filter: S.filter,
      caption: S.caption,
    });
    if (S.exports === exp) setStation("sent");
  } catch (err) {
    if (S.exports === exp) setStation("failed");
    toast(`Print station unreachable: ${err.message}`);
  } finally {
    exp.sending = false;
  }
}

function ready(key) {
  if (!S.exports?.[key]) {
    toast("One sec, still developing…");
    return false;
  }
  return true;
}

$("#saveBtn").addEventListener("click", async () => {
  if (!ready("strip")) return;
  const r = await saveOrShare(S.exports.strip, `${S.exports.name}.jpg`);
  if (r === "downloaded") toast("Saved to downloads");
});
$("#printBtn").addEventListener("click", () => {
  if (!ready("printUrl")) return;
  printImage(S.exports.printUrl).catch((err) => toast(err.message));
});
$("#stationBtn").addEventListener("click", () => {
  if (S.upload === "sent") {
    toast("Already in the print queue");
    return;
  }
  if (!ready("print")) return;
  sendToStation();
});
$("#clipBtn").addEventListener("click", async () => {
  if (!S.clip) return;
  await saveOrShare(S.clip, `${S.exports?.name || "iphonebooth"}.${videoExt(S.clip)}`);
});
$("#wallBtn").addEventListener("click", async () => {
  if (!ready("wall")) return;
  const r = await saveOrShare(S.exports.wall, `${S.exports.name}-wallpaper.jpg`);
  if (r === "downloaded") toast("Wallpaper saved");
});
$("#retakeBtn").addEventListener("click", async () => {
  if (await ask("Retake?", "Same size, frame and filter. New photos.", "Retake")) {
    S.deco = { stickers: [], strokes: [] };
    go("booth");
  }
});
$("#newBtn").addEventListener("click", newGuests);

// ---------- dialogs & toast ----------
function ask(title, text, yes) {
  const sheet = $("#confirm");
  $("#confirmTitle").textContent = title;
  $("#confirmText").textContent = text;
  $("#confirmYes").textContent = yes;
  sheet.hidden = false;
  $("#confirmYes").focus();
  return new Promise((resolve) => {
    const done = (v) => {
      sheet.hidden = true;
      $("#confirmYes").onclick = $("#confirmNo").onclick = sheet.onclick = null;
      resolve(v);
    };
    $("#confirmYes").onclick = () => done(true);
    $("#confirmNo").onclick = () => done(false);
    sheet.onclick = (e) => e.target === sheet && done(false);
  });
}

let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  el.classList.remove("in");
  void el.offsetWidth;
  el.classList.add("in");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 3200);
}

// ---------- idle reset ----------
const IDLE_MS = 90_000;
const WARN_S = 15;
let idleTimer;
let idleTick;
function bumpIdle() {
  clearTimeout(idleTimer);
  clearInterval(idleTick);
  $("#idle").hidden = true;
  if (!settings.idle || scene === "start" || S.shooting) return;
  idleTimer = setTimeout(warnIdle, IDLE_MS - WARN_S * 1000);
}
function warnIdle() {
  if (S.shooting) return bumpIdle();
  let n = WARN_S;
  $("#idleCount").textContent = String(n);
  $("#idle").hidden = false;
  idleTick = setInterval(() => {
    n -= 1;
    $("#idleCount").textContent = String(n);
    if (n <= 0) {
      clearInterval(idleTick);
      $("#idle").hidden = true;
      $("#confirm").hidden = true;
      $("#settings").hidden = true;
      newGuests();
    }
  }, 1000);
}
["pointerdown", "keydown"].forEach((t) => window.addEventListener(t, bumpIdle, { passive: true }));

// ---------- settings ----------
function syncSettingsUI() {
  $$("[data-setting]").forEach((el) => {
    const key = el.dataset.setting;
    if (el.classList.contains("seg")) {
      $$(".seg-btn", el).forEach((b) => b.classList.toggle("on", String(settings[key]) === b.dataset.value));
    } else {
      el.checked = !!settings[key];
    }
  });
}
$$(".seg[data-setting] .seg-btn").forEach((b) =>
  b.addEventListener("click", async () => {
    const key = b.parentElement.dataset.setting;
    const raw = b.dataset.value;
    const value = typeof DEFAULTS[key] === "number" ? Number(raw) : raw;
    const changed = settings[key] !== value;
    settings[key] = value;
    saveSettings();
    syncSettingsUI();
    if (key === "facing" && changed && CAMERA_SCENES.has(scene)) restartCamera().catch((err) => toast(cameraMessage(err)));
  })
);
$$("input[data-setting]").forEach((el) =>
  el.addEventListener("change", () => {
    settings[el.dataset.setting] = el.checked;
    saveSettings();
    setSound(settings.sound);
    applyMirror();
    bumpIdle();
  })
);
function openSettings() {
  syncSettingsUI();
  $("#settings").hidden = false;
}
$("#settingsBtn").addEventListener("click", openSettings);
$("#helpBtn").addEventListener("click", openSettings);
$("#closeSettings").addEventListener("click", () => ($("#settings").hidden = true));
$("#settings").addEventListener("click", (e) => {
  if (e.target.id === "settings") e.target.hidden = true;
});
window.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  $("#settings").hidden = true;
  if (!$("#confirm").hidden) $("#confirmNo").click();
});

fetchInfo().then((info) => {
  const box = $("#hostInfo");
  const lan = info?.urls?.lan || [];
  box.innerHTML = "";
  const title = document.createElement("p");
  title.className = "host-title";
  title.textContent = "Phone setup";
  const steps = document.createElement("ol");
  const items = [
    lan.length ? `On the iPhone (same Wi-Fi), open ${lan.join(" or ")}` : "Connect the Mac to Wi-Fi to get a phone address.",
    "Safari warns about the certificate: tap Show Details → visit this website.",
    `If the camera stays blocked, open ${lan[0] || location.origin}/api/cert, install the profile, then trust “iPhoneBooth Local” in Settings → General → About → Certificate Trust Settings.`,
    "Share → Add to Home Screen for a full-screen booth.",
  ];
  for (const t of items) {
    const li = document.createElement("li");
    li.textContent = t;
    steps.appendChild(li);
  }
  box.append(title, steps);
});

// ---------- device ----------
let wakeLock = null;
async function lockScreen() {
  try {
    if ("wakeLock" in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => (wakeLock = null));
    }
  } catch {
    /* unsupported */
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (S.shooting) S.abort = true;
    return;
  }
  lockScreen();
  if (CAMERA_SCENES.has(scene) && !cameraLive(video)) ensureCamera().catch((err) => toast(cameraMessage(err)));
});

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (scene === "booth") updateGuide();
    if (scene === "pick") renderPickPreview();
    if (scene === "filter") renderFilterPreview();
  }, 120);
});
window.addEventListener("pagehide", () => stopCamera(video));

if (!window.isSecureContext) {
  $("#startError").hidden = false;
  $("#startError").textContent = "The camera needs HTTPS. Open the https:// address printed in the Mac terminal.";
}

setSound(settings.sound);
syncSettingsUI();
go("start");

// test hook for automated runs
window.__booth = { get state() { return S; }, get scene() { return scene; }, go };
