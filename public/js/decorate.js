import { drawStrokes } from "./compose.js";

export const STICKERS = ["✨", "💖", "🔥", "😎", "🌸", "⭐️", "🎀", "🍒", "🦋", "👑", "💋", "🌈", "🍓", "🎉", "🫶", "👀", "💫", "🐶", "🐱", "🌙"];
export const CRAYONS = ["#111111", "#ffffff", "#ff3b6b", "#2f6bff", "#d4ff3a", "#ffb000"];
export const SIZES = { fine: 0.012, bold: 0.03 };

const MIN_SIZE = 0.06;
const MAX_SIZE = 0.8;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/**
 * Sticker + crayon editor over a rendered strip. All positions are normalised to the
 * strip (0..1), so the export can redraw them at any resolution.
 */
export function createDecorator({ wrap, stage, base, draw, layer, onChange }) {
  let doc = null; // { stickers, strokes } owned by the app state
  let aspect = 1;
  let renderBase = null;
  let mode = "sticker";
  let color = CRAYONS[2];
  let size = SIZES.fine;
  let selected = null;
  let stroke = null;
  const pointers = new Map();
  let gesture = null;

  const dpr = () => Math.min(2, window.devicePixelRatio || 1);

  function fit() {
    const box = wrap.getBoundingClientRect();
    if (!box.width || !box.height) return;
    let w = box.width;
    let h = w / aspect;
    if (h > box.height) {
      h = box.height;
      w = h * aspect;
    }
    w = Math.floor(w);
    h = Math.floor(h);
    stage.style.width = `${w}px`;
    stage.style.height = `${h}px`;
    const pw = Math.round(w * dpr());
    const ph = Math.round(h * dpr());
    if (renderBase) renderBase(base, pw);
    draw.width = pw;
    draw.height = ph;
    redrawStrokes();
    renderStickers();
  }

  const ro = new ResizeObserver(() => fit());
  ro.observe(wrap);

  function redrawStrokes() {
    const ctx = draw.getContext("2d");
    ctx.clearRect(0, 0, draw.width, draw.height);
    if (doc) drawStrokes(ctx, doc.strokes, draw.width, draw.height);
  }

  function renderStickers() {
    layer.innerHTML = "";
    if (!doc) return;
    const w = stage.clientWidth;
    doc.stickers.forEach((s) => {
      const el = document.createElement("div");
      el.className = `sticker${s === selected ? " selected" : ""}`;
      el.textContent = s.emoji;
      el.style.left = `${s.x * 100}%`;
      el.style.top = `${s.y * 100}%`;
      el.style.fontSize = `${s.size * w}px`;
      el.style.transform = `translate(-50%, -50%) rotate(${s.rot}rad)`;
      el.addEventListener("pointerdown", (e) => startStickerDrag(e, s));
      if (s === selected) {
        const handle = document.createElement("button");
        handle.type = "button";
        handle.className = "sticker-handle";
        handle.setAttribute("aria-label", "Resize and rotate sticker");
        handle.addEventListener("pointerdown", (e) => startHandle(e, s));
        const del = document.createElement("button");
        del.type = "button";
        del.className = "sticker-del";
        del.setAttribute("aria-label", "Remove sticker");
        del.textContent = "×";
        del.addEventListener("pointerdown", (e) => e.stopPropagation());
        del.addEventListener("click", (e) => {
          e.stopPropagation();
          doc.stickers.splice(doc.stickers.indexOf(s), 1);
          selected = null;
          renderStickers();
          onChange?.();
        });
        el.append(handle, del);
      }
      layer.appendChild(el);
    });
  }

  function norm(e) {
    const r = stage.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  }

  function startStickerDrag(e, s) {
    if (mode !== "sticker") return;
    e.preventDefault();
    e.stopPropagation();
    if (selected !== s) {
      selected = s;
      renderStickers();
    }
    layer.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, norm(e));
    if (pointers.size === 1) {
      const [px, py] = norm(e);
      gesture = { type: "drag", s, dx: s.x - px, dy: s.y - py };
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      gesture = {
        type: "pinch",
        s,
        dist: Math.hypot((a[0] - b[0]) * aspect, a[1] - b[1]),
        angle: Math.atan2(a[1] - b[1], (a[0] - b[0]) * aspect),
        size: s.size,
        rot: s.rot,
      };
    }
  }

  function startHandle(e, s) {
    e.preventDefault();
    e.stopPropagation();
    layer.setPointerCapture?.(e.pointerId);
    const [px, py] = norm(e);
    const vx = (px - s.x) * aspect;
    const vy = py - s.y;
    gesture = { type: "handle", s, dist: Math.hypot(vx, vy) || 0.01, angle: Math.atan2(vy, vx), size: s.size, rot: s.rot };
    pointers.set(e.pointerId, [px, py]);
  }

  function moveSticker(e) {
    if (!gesture || !pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, norm(e));
    const s = gesture.s;
    if (gesture.type === "drag") {
      const [px, py] = norm(e);
      s.x = clamp(px + gesture.dx, 0, 1);
      s.y = clamp(py + gesture.dy, 0, 1);
    } else if (gesture.type === "pinch" && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot((a[0] - b[0]) * aspect, a[1] - b[1]);
      const angle = Math.atan2(a[1] - b[1], (a[0] - b[0]) * aspect);
      s.size = clamp(gesture.size * (dist / gesture.dist), MIN_SIZE, MAX_SIZE);
      s.rot = gesture.rot + angle - gesture.angle;
    } else if (gesture.type === "handle") {
      const [px, py] = norm(e);
      const vx = (px - s.x) * aspect;
      const vy = py - s.y;
      s.size = clamp(gesture.size * (Math.hypot(vx, vy) / gesture.dist), MIN_SIZE, MAX_SIZE);
      s.rot = gesture.rot + Math.atan2(vy, vx) - gesture.angle;
    }
    renderStickers();
  }

  function endSticker(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size === 0) {
      if (gesture) onChange?.();
      gesture = null;
    } else if (pointers.size === 1 && gesture?.type === "pinch") {
      const [p] = [...pointers.values()];
      gesture = { type: "drag", s: gesture.s, dx: gesture.s.x - p[0], dy: gesture.s.y - p[1] };
    }
  }

  layer.addEventListener("pointermove", moveSticker);
  layer.addEventListener("pointerup", endSticker);
  layer.addEventListener("pointercancel", endSticker);
  layer.addEventListener("pointerdown", (e) => {
    // A second finger anywhere on the strip turns a drag into a pinch.
    if (e.target === layer && gesture?.type === "drag" && pointers.size === 1) {
      startStickerDrag(e, gesture.s);
      return;
    }
    if (e.target === layer && selected) {
      selected = null;
      renderStickers();
    }
  });

  // Crayon
  draw.addEventListener("pointerdown", (e) => {
    if (mode === "sticker" || !doc) return;
    e.preventDefault();
    draw.setPointerCapture?.(e.pointerId);
    stroke = { color, size, erase: mode === "erase", points: [norm(e)] };
    doc.strokes.push(stroke);
    paintSegment(stroke, 0);
  });
  draw.addEventListener("pointermove", (e) => {
    if (!stroke) return;
    const events = e.getCoalescedEvents?.() || [e];
    for (const ev of events) {
      const p = norm(ev);
      const last = stroke.points[stroke.points.length - 1];
      if (Math.hypot((p[0] - last[0]) * aspect, p[1] - last[1]) < 0.002) continue;
      stroke.points.push(p);
      paintSegment(stroke, stroke.points.length - 2);
    }
  });
  const endStroke = () => {
    if (!stroke) return;
    stroke = null;
    onChange?.();
  };
  draw.addEventListener("pointerup", endStroke);
  draw.addEventListener("pointercancel", endStroke);

  function paintSegment(s, from) {
    const ctx = draw.getContext("2d");
    const W = draw.width;
    const H = draw.height;
    ctx.save();
    ctx.globalCompositeOperation = s.erase ? "destination-out" : "source-over";
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = s.size * W;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const a = s.points[from];
    const b = s.points[from + 1];
    ctx.beginPath();
    if (!b) {
      ctx.arc(a[0] * W, a[1] * H, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.moveTo(a[0] * W, a[1] * H);
      ctx.lineTo(b[0] * W, b[1] * H);
      ctx.stroke();
    }
    ctx.restore();
  }

  return {
    mount(nextDoc, nextAspect, nextRenderBase) {
      doc = nextDoc;
      aspect = nextAspect;
      renderBase = nextRenderBase;
      selected = null;
      fit();
    },
    refit: fit,
    setMode(next) {
      mode = next;
      stage.dataset.mode = next;
      if (next !== "sticker" && selected) {
        selected = null;
        renderStickers();
      }
    },
    setColor(c) {
      color = c;
    },
    setSize(s) {
      size = s;
    },
    addSticker(emoji) {
      if (!doc) return;
      const n = doc.stickers.length;
      const s = { emoji, x: 0.5 + ((n % 3) - 1) * 0.12, y: 0.35 + ((n % 5) - 2) * 0.05, size: 0.18, rot: ((n % 5) - 2) * 0.12 };
      doc.stickers.push(s);
      selected = s;
      renderStickers();
      onChange?.();
    },
    undo() {
      if (!doc) return;
      if (mode === "sticker") {
        doc.stickers.pop();
        selected = null;
        renderStickers();
      } else {
        doc.strokes.pop();
        redrawStrokes();
      }
      onChange?.();
    },
    clear() {
      if (!doc) return;
      if (mode === "sticker") {
        doc.stickers.length = 0;
        selected = null;
        renderStickers();
      } else {
        doc.strokes.length = 0;
        redrawStrokes();
      }
      onChange?.();
    },
    deselect() {
      selected = null;
      renderStickers();
    },
  };
}
