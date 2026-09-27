import { LAYOUTS, cellRects } from "./layouts.js";
import { FRAMES } from "./frames.js";

// Filters are colour matrices (the W3C filter-effects formulas), applied per pixel.
// ctx.filter would be simpler, but Safari before 18 ignores it, so prints would come
// out unfiltered on older iPhones.
export const FILTERS = {
  original: { name: "Original", ops: [], grain: 0 },
  mono: { name: "Mono", ops: [["grayscale", 1], ["contrast", 1.08]], grain: 0 },
  noir: { name: "Noir", ops: [["grayscale", 1], ["contrast", 1.35], ["brightness", 0.95]], grain: 0.18 },
  retro: { name: "Retro", ops: [["sepia", 0.5], ["contrast", 1.05], ["saturate", 1.4], ["hue", -10]], grain: 0.12 },
  film: { name: "Film", ops: [["contrast", 0.9], ["saturate", 0.85], ["brightness", 1.08], ["sepia", 0.18]], grain: 0.24 },
  cool: { name: "Cool", ops: [["saturate", 1.15], ["contrast", 1.05], ["hue", 18], ["brightness", 1.03]], grain: 0 },
  peach: { name: "Peach", ops: [["saturate", 1.25], ["contrast", 0.98], ["brightness", 1.07], ["sepia", 0.28], ["hue", -12]], grain: 0 },
  automat: { name: "Automat", ops: [["grayscale", 0.5], ["sepia", 0.45], ["contrast", 1.14], ["brightness", 1.02], ["saturate", 0.9]], grain: 0.32 },
};

function opMatrix([op, v]) {
  const a = 1 - v;
  switch (op) {
    case "grayscale":
      return { m: [0.2126 + 0.7874 * a, 0.7152 - 0.7152 * a, 0.0722 - 0.0722 * a, 0.2126 - 0.2126 * a, 0.7152 + 0.2848 * a, 0.0722 - 0.0722 * a, 0.2126 - 0.2126 * a, 0.7152 - 0.7152 * a, 0.0722 + 0.9278 * a], t: [0, 0, 0] };
    case "sepia":
      return { m: [0.393 + 0.607 * a, 0.769 - 0.769 * a, 0.189 - 0.189 * a, 0.349 - 0.349 * a, 0.686 + 0.314 * a, 0.168 - 0.168 * a, 0.272 - 0.272 * a, 0.534 - 0.534 * a, 0.131 + 0.869 * a], t: [0, 0, 0] };
    case "saturate":
      return { m: [0.213 + 0.787 * v, 0.715 - 0.715 * v, 0.072 - 0.072 * v, 0.213 - 0.213 * v, 0.715 + 0.285 * v, 0.072 - 0.072 * v, 0.213 - 0.213 * v, 0.715 - 0.715 * v, 0.072 + 0.928 * v], t: [0, 0, 0] };
    case "hue": {
      const r = (v * Math.PI) / 180;
      const c = Math.cos(r);
      const s = Math.sin(r);
      return { m: [0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928, 0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283, 0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072], t: [0, 0, 0] };
    }
    case "brightness":
      return { m: [v, 0, 0, 0, v, 0, 0, 0, v], t: [0, 0, 0] };
    case "contrast": {
      const t = 127.5 * (1 - v);
      return { m: [v, 0, 0, 0, v, 0, 0, 0, v], t: [t, t, t] };
    }
    default:
      return { m: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };
  }
}

// Compose ops left-to-right into one affine matrix: out = M·rgb + t
function filterMatrix(key) {
  let M = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  let T = [0, 0, 0];
  for (const op of FILTERS[key]?.ops || []) {
    const { m, t } = opMatrix(op);
    const nM = [];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        nM.push(m[r * 3] * M[c] + m[r * 3 + 1] * M[3 + c] + m[r * 3 + 2] * M[6 + c]);
      }
    }
    const nT = [0, 1, 2].map((r) => m[r * 3] * T[0] + m[r * 3 + 1] * T[1] + m[r * 3 + 2] * T[2] + t[r]);
    M = nM;
    T = nT;
  }
  return { M, T };
}

export function applyFilter(canvas, key) {
  const f = FILTERS[key] || FILTERS.original;
  if (!f.ops.length && !f.grain) return canvas;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const { M, T } = filterMatrix(key);
  const g = f.grain * 70;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const gr = d[i + 1];
    const b = d[i + 2];
    const n = g ? (Math.random() - 0.5) * g : 0;
    d[i] = M[0] * r + M[1] * gr + M[2] * b + T[0] + n;
    d[i + 1] = M[3] * r + M[4] * gr + M[5] * b + T[1] + n;
    d[i + 2] = M[6] * r + M[7] * gr + M[8] * b + T[2] + n;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// A shot cropped (cover) to a cell size and filtered, cached on the shot itself.
export function photoFor(shot, filter, w, h) {
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));
  const key = `${filter}|${w}x${h}`;
  shot.cache ||= new Map();
  const hit = shot.cache.get(key);
  if (hit) return hit;
  const src = shot.canvas;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  const sr = src.width / src.height;
  const dr = w / h;
  let sx = 0;
  let sy = 0;
  let sw = src.width;
  let sh = src.height;
  if (sr > dr) {
    sw = src.height * dr;
    sx = (src.width - sw) / 2;
  } else {
    sh = src.width / dr;
    sy = (src.height - sh) / 2;
  }
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
  applyFilter(c, filter);
  if (shot.cache.size > 24) shot.cache.delete(shot.cache.keys().next().value);
  shot.cache.set(key, c);
  return c;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function dateStamp(d = new Date()) {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// Strokes live in their own layer so the eraser only removes crayon, never photos.
export function drawStrokes(ctx, strokes, w, h) {
  if (!strokes.length) return;
  const layer = document.createElement("canvas");
  layer.width = Math.max(1, Math.round(w));
  layer.height = Math.max(1, Math.round(h));
  const lc = layer.getContext("2d");
  lc.lineCap = "round";
  lc.lineJoin = "round";
  for (const s of strokes) {
    if (!s.points.length) continue;
    lc.globalCompositeOperation = s.erase ? "destination-out" : "source-over";
    lc.strokeStyle = s.color;
    lc.fillStyle = s.color;
    lc.lineWidth = s.size * layer.width;
    const [x0, y0] = s.points[0];
    if (s.points.length === 1) {
      lc.beginPath();
      lc.arc(x0 * layer.width, y0 * layer.height, lc.lineWidth / 2, 0, Math.PI * 2);
      lc.fill();
      continue;
    }
    lc.beginPath();
    lc.moveTo(x0 * layer.width, y0 * layer.height);
    for (let i = 1; i < s.points.length; i++) {
      lc.lineTo(s.points[i][0] * layer.width, s.points[i][1] * layer.height);
    }
    lc.stroke();
  }
  ctx.drawImage(layer, 0, 0, w, h);
}

export function drawSticker(ctx, s, w, h) {
  const size = s.size * w;
  ctx.save();
  ctx.translate(s.x * w, s.y * h);
  ctx.rotate(s.rot || 0);
  ctx.font = `${size}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(s.emoji, 0, size * 0.04);
  ctx.restore();
}

/**
 * Render a strip. `photos` is one entry per slot (a shot or null).
 * `deco: false` skips stickers/strokes (the decorate stage draws those live).
 */
export function renderStrip({
  layout,
  frame,
  photos = [],
  filter = "original",
  stickers = [],
  strokes = [],
  caption = "",
  date = dateStamp(),
  scale = 1,
  deco = true,
  numbers = false,
  canvas,
}) {
  const L = LAYOUTS[layout];
  const F = FRAMES[frame] || FRAMES.paper;
  const c = canvas || document.createElement("canvas");
  c.width = Math.round(L.w * scale);
  c.height = Math.round(L.h * scale);
  const ctx = c.getContext("2d");
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  F.paint(ctx, L.w, L.h, L);

  const radius = L.w * F.radius;
  cellRects(layout).forEach((r, i) => {
    const shot = photos[i];
    ctx.save();
    roundRect(ctx, r.x, r.y, r.w, r.h, radius);
    ctx.clip();
    if (shot) {
      ctx.drawImage(photoFor(shot, filter, r.w * scale, r.h * scale), r.x, r.y, r.w, r.h);
    } else {
      ctx.fillStyle = F.paper;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = F.slot;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      if (numbers) {
        ctx.fillStyle = F.ink;
        ctx.globalAlpha = 0.35;
        ctx.font = `600 ${Math.round(r.h * 0.22)}px ${F.mono}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(i + 1), r.x + r.w / 2, r.y + r.h / 2);
      }
    }
    ctx.restore();
  });

  if (F.over) F.over(ctx, L.w, L.h, L);

  const fy = L.h - L.footer;
  const text = (caption || "").trim();
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  if (text) {
    const shown = F.upper ? text.toUpperCase() : text;
    let size = Math.round(L.w * (L.slots === 4 && L.cols === 1 ? 0.085 : 0.06));
    ctx.font = `800 ${size}px ${F.font}`;
    while (ctx.measureText(shown).width > L.w - L.pad * 2 && size > 12) {
      size -= 2;
      ctx.font = `800 ${size}px ${F.font}`;
    }
    ctx.fillStyle = F.ink;
    ctx.fillText(shown, L.w / 2, fy + L.footer * 0.52);
  }
  ctx.fillStyle = F.accent;
  ctx.font = `500 ${Math.round(L.w * (L.cols === 1 && L.slots === 4 ? 0.04 : 0.026))}px ${F.mono}`;
  ctx.fillText(date.toUpperCase(), L.w / 2, fy + L.footer * (text ? 0.78 : 0.6));

  if (deco) {
    drawStrokes(ctx, strokes, L.w, L.h);
    for (const s of stickers) drawSticker(ctx, s, L.w, L.h);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return c;
}

// 4×6 portrait print at 300 dpi. Strips print two-up (cut down the middle).
export function renderPrint(stripCanvas, layout) {
  const P = document.createElement("canvas");
  P.width = 1200;
  P.height = 1800;
  const ctx = P.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, P.width, P.height);
  if (layout === "strip") {
    ctx.drawImage(stripCanvas, 0, 0, 600, 1800);
    ctx.drawImage(stripCanvas, 600, 0, 600, 1800);
  } else if (layout === "polaroid") {
    const w = 1080;
    const h = (stripCanvas.height / stripCanvas.width) * w;
    ctx.drawImage(stripCanvas, (P.width - w) / 2, (P.height - h) / 2, w, h);
  } else {
    ctx.drawImage(stripCanvas, 0, 0, P.width, P.height);
  }
  return P;
}

// Phone lock-screen wallpaper: a soft, dark backdrop from the first photo with the strip on top.
export function renderWallpaper(stripCanvas, shot, filter) {
  const W = 1179;
  const H = 2556;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#0b0b0d";
  ctx.fillRect(0, 0, W, H);
  if (shot) {
    const tiny = photoFor(shot, filter, 18, 39);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(tiny, 0, 0, W, H);
    ctx.fillStyle = "rgba(8,8,10,0.45)";
    ctx.fillRect(0, 0, W, H);
  }
  const maxH = H * 0.56;
  const maxW = W * 0.78;
  const s = Math.min(maxH / stripCanvas.height, maxW / stripCanvas.width);
  const w = stripCanvas.width * s;
  const h = stripCanvas.height * s;
  const x = (W - w) / 2;
  const y = H * 0.36;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 60;
  ctx.shadowOffsetY = 24;
  ctx.drawImage(stripCanvas, x, y, w, h);
  ctx.restore();
  return c;
}
