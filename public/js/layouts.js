// Strip geometry in output pixels (300 dpi). Every renderer — thumbnails, live previews,
// the export — works from these numbers, so what you see is what prints.
export const SPARE_SHOTS = 2;

export const LAYOUTS = {
  strip: { id: "strip", name: "4-cut", hint: "the classic strip", w: 600, h: 1800, cols: 1, slots: 4, pad: 36, gap: 16, footer: 200 },
  grid: { id: "grid", name: "2 × 2", hint: "four on a card", w: 1200, h: 1800, cols: 2, slots: 4, pad: 56, gap: 20, footer: 250 },
  duo: { id: "duo", name: "2-cut", hint: "two big frames", w: 1200, h: 1800, cols: 1, slots: 2, pad: 56, gap: 24, footer: 250 },
  polaroid: { id: "polaroid", name: "Instant", hint: "one shot, make it count", w: 1080, h: 1320, cols: 1, slots: 1, pad: 64, gap: 0, footer: 300 },
};

export const LAYOUT_ORDER = ["strip", "grid", "duo", "polaroid"];

export function shotCount(layout) {
  return LAYOUTS[layout].slots + SPARE_SHOTS;
}

export function cellRects(layout) {
  const L = LAYOUTS[layout];
  const rows = Math.ceil(L.slots / L.cols);
  const cw = (L.w - L.pad * 2 - L.gap * (L.cols - 1)) / L.cols;
  const ch = (L.h - L.pad - L.footer - L.gap * (rows - 1)) / rows;
  const rects = [];
  for (let i = 0; i < L.slots; i++) {
    const col = i % L.cols;
    const row = Math.floor(i / L.cols);
    rects.push({ x: L.pad + col * (cw + L.gap), y: L.pad + row * (ch + L.gap), w: cw, h: ch });
  }
  return rects;
}
