import { cellRects } from "./layouts.js";

// Frame packs, drawn in code (no image assets). Each frame paints the paper behind the
// photos (`paint`), optionally decorates on top of the paper edges (`over`), and sets the
// footer colours and type.
const SANS = '-apple-system, "SF Pro Display", "Helvetica Neue", Helvetica, Arial, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

function solid(ctx, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
}

function polka(color, alpha) {
  return (ctx, w, h) => {
    const step = w / 9;
    const r = step * 0.16;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    for (let y = 0, row = 0; y < h + step; y += step * 0.87, row++) {
      for (let x = row % 2 ? step / 2 : 0; x < w + step; x += step) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  };
}

function gingham(color) {
  return (ctx, w, h) => {
    const step = w / 10;
    ctx.save();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.16;
    for (let x = 0; x < w; x += step * 2) ctx.fillRect(x, 0, step, h);
    for (let y = 0; y < h; y += step * 2) ctx.fillRect(0, y, w, step);
    ctx.restore();
  };
}

function stripes(color) {
  return (ctx, w, h) => {
    const step = w / 14;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.22;
    ctx.lineWidth = step * 0.45;
    for (let x = -h; x < w + h; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + h, h);
      ctx.stroke();
    }
    ctx.restore();
  };
}

function grid(color) {
  return (ctx, w, h) => {
    const step = w / 16;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.12;
    ctx.lineWidth = Math.max(1, w / 600);
    for (let x = step; x < w; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = step; y < h; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.restore();
  };
}

function sprockets(ctx, w, h, L) {
  const holeW = L.pad * 0.36;
  const holeH = holeW * 1.4;
  const step = holeH * 2.1;
  ctx.fillStyle = "#e9e4d8";
  for (const x of [L.pad * 0.32, w - L.pad * 0.32 - holeW]) {
    for (let y = step / 2; y < h - holeH; y += step) {
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(x, y, holeW, holeH, holeW * 0.25) : ctx.rect(x, y, holeW, holeH);
      ctx.fill();
    }
  }
}

function receiptEdge(ctx, w, h, L) {
  const tooth = w / 30;
  ctx.fillStyle = "#e2e2dc";
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let x = 0; x <= w; x += tooth) {
    ctx.lineTo(x + tooth / 2, h - tooth * 0.6);
    ctx.lineTo(x + tooth, h);
  }
  ctx.closePath();
  ctx.fill();
  ctx.save();
  ctx.strokeStyle = "#151515";
  ctx.setLineDash([L.pad * 0.2, L.pad * 0.16]);
  ctx.lineWidth = Math.max(2, w / 300);
  const y = h - L.footer + L.pad * 0.45;
  ctx.beginPath();
  ctx.moveTo(L.pad, y);
  ctx.lineTo(w - L.pad, y);
  ctx.stroke();
  ctx.restore();
}

function neonCells(ctx, w, h, L) {
  ctx.save();
  ctx.strokeStyle = "#d4ff3a";
  ctx.shadowColor = "#d4ff3a";
  ctx.shadowBlur = L.pad * 0.5;
  ctx.lineWidth = Math.max(3, w / 200);
  for (const r of cellRects(L.id)) {
    ctx.strokeRect(r.x - ctx.lineWidth, r.y - ctx.lineWidth, r.w + ctx.lineWidth * 2, r.h + ctx.lineWidth * 2);
  }
  ctx.restore();
}

function contactMarks(ctx, w, h, L) {
  ctx.save();
  ctx.fillStyle = "#ff8a1f";
  ctx.font = `600 ${Math.round(L.pad * 0.42)}px ${MONO}`;
  ctx.textBaseline = "middle";
  cellRects(L.id).forEach((r, i) => {
    ctx.fillText(`${String(i + 1).padStart(2, "0")}A`, r.x, r.y - L.gap * 0.5 - (i < L.cols ? L.pad * 0.2 : 0));
    ctx.fillText("▶", r.x + r.w - L.pad * 0.4, r.y + r.h + Math.max(L.gap * 0.5, L.pad * 0.25));
  });
  ctx.restore();
}

const make = (id, name, pack, paper, ink, accent, extra = {}) => ({
  id,
  name,
  pack,
  paper,
  ink,
  accent,
  slot: extra.slot || "rgba(0,0,0,0.08)",
  font: extra.font || SANS,
  mono: MONO,
  upper: !!extra.upper,
  radius: extra.radius ?? 0.018,
  paint(ctx, w, h, L) {
    solid(ctx, w, h, paper);
    if (extra.pattern) {
      extra.pattern(ctx, w, h, L);
      // keep the caption legible: the footer is plain paper
      ctx.fillStyle = paper;
      ctx.fillRect(L.pad, h - L.footer + L.pad * 0.35, w - L.pad * 2, L.footer - L.pad * 0.7);
    }
  },
  over: extra.over || null,
});

export const FRAMES = {};
[
  make("paper", "Paper", "Simple", "#f4f2ee", "#121212", "#7a7a7a"),
  make("ink", "Ink", "Simple", "#0e0e10", "#f4f4f4", "#d4ff3a", { slot: "rgba(255,255,255,0.08)" }),
  make("blush", "Blush", "Simple", "#f6d8d2", "#3b1f1b", "#b0564a"),
  make("sage", "Sage", "Simple", "#dfe7da", "#1f2d1c", "#5c7450"),
  make("cobalt", "Cobalt", "Simple", "#2140ff", "#ffffff", "#d4ff3a", { slot: "rgba(255,255,255,0.12)" }),
  make("butter", "Butter", "Simple", "#f7ecb5", "#2b2410", "#8a6d12"),
  make("polka", "Polka", "Pattern", "#fff1ee", "#3a1512", "#ff6f61", { pattern: polka("#ff6f61", 0.35) }),
  make("gingham", "Picnic", "Pattern", "#ffffff", "#5a1616", "#e05a5a", { pattern: gingham("#e05a5a") }),
  make("stripes", "Candy", "Pattern", "#f3f0ff", "#23195e", "#6f5cff", { pattern: stripes("#6f5cff") }),
  make("grid", "Graph", "Pattern", "#f7f7f2", "#1a1a1a", "#3050ff", { pattern: grid("#1a1a1a") }),
  make("film", "35mm", "Film", "#0c0c0c", "#f2f2f2", "#ffb000", {
    slot: "rgba(255,255,255,0.08)",
    font: MONO,
    upper: true,
    radius: 0.006,
    over: sprockets,
  }),
  make("neon", "Neon", "Film", "#07070a", "#d4ff3a", "#f3f3f0", { slot: "rgba(212,255,58,0.08)", radius: 0, over: neonCells }),
  make("contact", "Contact", "Film", "#141210", "#efe7d8", "#ff8a1f", { slot: "rgba(255,255,255,0.06)", font: MONO, upper: true, radius: 0, over: contactMarks }),
  make("receipt", "Receipt", "Film", "#fbfbf8", "#151515", "#151515", {
    font: MONO,
    upper: true,
    radius: 0,
    over: receiptEdge,
  }),
].forEach((f) => {
  FRAMES[f.id] = f;
});

export const PACKS = ["Simple", "Pattern", "Film"];
export const framesInPack = (pack) => Object.values(FRAMES).filter((f) => f.pack === pack);
