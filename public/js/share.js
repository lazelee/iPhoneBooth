export async function uploadStrip(payload) {
  const res = await fetch("/api/strips", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Upload failed");
  }
  return res.json();
}

export async function fetchQueue() {
  const res = await fetch("/api/queue");
  if (!res.ok) throw new Error("Could not load print queue");
  return res.json();
}

export async function deleteStrip(id) {
  const res = await fetch(`/api/strips/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Could not delete strip");
}

export async function fetchInfo() {
  try {
    const res = await fetch("/api/info");
    return res.ok ? res.json() : null;
  } catch {
    return null;
  }
}

export function canvasToBlob(canvas, type = "image/jpeg", quality = 0.92) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode image"))), type, quality);
  });
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// Phones and tablets get the share sheet (Save Image, AirDrop, Messages…). Computers
// download straight away: desktop browsers report file sharing as supported, but the
// share popover is easy to miss and often never resolves, so nothing seems to happen.
export function isHandheld() {
  const ua = navigator.userAgent;
  // iPadOS Safari reports itself as a Mac; touch points give it away.
  return /iPhone|iPad|iPod|Android/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

// Must run inside the tap handler, so the blob is prepared ahead of time.
export async function saveOrShare(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (isHandheld() && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return "shared";
    } catch (err) {
      if (err?.name === "AbortError") return "cancelled";
    }
  }
  downloadBlob(blob, name);
  return "downloaded";
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

// Prints through a hidden iframe (no pop-up to block) and waits for the image to decode
// first — printing before it loads gives a blank page.
export function printImage(src) {
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    doc.open();
    doc.write(`<!doctype html><html><head><title>iPhoneBooth print</title><style>
      @page{size:4in 6in;margin:0}
      html,body{margin:0;padding:0;background:#fff}
      img{display:block;width:4in;height:6in;object-fit:contain}
    </style></head><body><img alt=""></body></html>`);
    doc.close();
    const img = doc.querySelector("img");
    img.onload = () => {
      setTimeout(() => {
        try {
          frame.contentWindow.focus();
          frame.contentWindow.print();
          resolve();
        } catch (err) {
          reject(err);
        } finally {
          setTimeout(() => frame.remove(), 60_000);
        }
      }, 50);
    };
    img.onerror = () => {
      frame.remove();
      reject(new Error("Could not load the print image"));
    };
    img.src = src;
  });
}
