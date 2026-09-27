import { fetchQueue, deleteStrip, printImage } from "./share.js";

const $ = (s) => document.querySelector(s);
const latest = $("#latest");
const empty = $("#empty");
const queue = $("#queue");
const autoPrint = $("#autoPrint");

const store = {
  get(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* private mode */
    }
  },
};

const printed = new Set(store.get("ipb.printed", []));
let seen = null; // ids present at the last refresh; null until the first load
let current = null;
let lastKey = "";
autoPrint.checked = store.get("ipb.autoPrint", false);
autoPrint.addEventListener("change", () => store.set("ipb.autoPrint", autoPrint.checked));

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), 3000);
}

async function printId(id) {
  try {
    await printImage(`/api/strips/${id}/print`);
    printed.add(id);
    store.set("ipb.printed", [...printed].slice(-200));
    render(lastStrips);
  } catch (err) {
    toast(err.message);
  }
}

const describe = (item) =>
  [new Date(item.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }), item.layout || "strip", item.theme, item.filter, printed.has(item.id) ? "printed" : ""]
    .filter(Boolean)
    .join(" · ");

let lastStrips = [];
function render(strips) {
  lastStrips = strips;
  const key = strips.map((s) => s.id + (printed.has(s.id) ? "p" : "")).join(",");
  if (key === lastKey) return;
  lastKey = key;
  empty.hidden = strips.length > 0;
  latest.hidden = strips.length === 0;
  $("#queueTitle").hidden = strips.length < 2;
  queue.innerHTML = "";
  if (!strips.length) {
    current = null;
    return;
  }
  current = strips[0];
  $("#latestImg").src = `/api/strips/${current.id}/print`;
  $("#openLatest").href = `/api/strips/${current.id}/print`;
  $("#latestMeta").textContent = describe(current);
  $("#printLatest").textContent = printed.has(current.id) ? "Print again" : "Print 4×6";
  for (const item of strips.slice(1)) {
    const card = document.createElement("article");
    card.className = `q-card${printed.has(item.id) ? " printed" : ""}`;
    const img = document.createElement("img");
    img.src = `/api/strips/${item.id}/image`;
    img.alt = item.caption || "Photo strip";
    img.loading = "lazy";
    const meta = document.createElement("p");
    meta.className = "print-meta";
    meta.textContent = describe(item);
    const actions = document.createElement("div");
    actions.className = "q-actions";
    const printBtn = document.createElement("button");
    printBtn.className = "btn btn-primary";
    printBtn.type = "button";
    printBtn.textContent = "Print";
    printBtn.addEventListener("click", () => printId(item.id));
    const removeBtn = document.createElement("button");
    removeBtn.className = "btn btn-ghost";
    removeBtn.type = "button";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => remove(item.id));
    actions.append(printBtn, removeBtn);
    card.append(img, meta, actions);
    queue.appendChild(card);
  }
}

async function remove(id) {
  try {
    await deleteStrip(id);
  } catch (err) {
    toast(err.message);
  }
  await refresh();
}

$("#printLatest").addEventListener("click", () => current && printId(current.id));
$("#dismissLatest").addEventListener("click", () => current && remove(current.id));

async function refresh() {
  try {
    const data = await fetchQueue();
    const strips = data.strips || [];
    if (seen && autoPrint.checked) {
      const fresh = strips.filter((s) => !seen.has(s.id) && !printed.has(s.id)).reverse();
      for (const s of fresh) await printId(s.id);
    }
    seen = new Set(strips.map((s) => s.id));
    $("#emptyText").textContent = "Keep this page open. Strips from the booth land here, ready for 4×6.";
    render(strips);
  } catch (err) {
    empty.hidden = false;
    $("#emptyText").textContent = `Can't reach the booth host: ${err.message}`;
  }
}

refresh();
setInterval(refresh, 2500);
