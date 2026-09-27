// Records the live camera during the shoot — the "behind the booth" clip.
// iOS Safari records mp4; Chrome records webm (or mp4 in newer versions).
const TYPES = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"];

export function canRecord() {
  return typeof window.MediaRecorder === "function";
}

export function startRecording(stream) {
  if (!canRecord() || !stream) return null;
  const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported?.(t)) || "";
  let rec;
  try {
    rec = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 3_000_000 } : undefined);
  } catch {
    return null;
  }
  const chunks = [];
  rec.addEventListener("dataavailable", (e) => {
    if (e.data && e.data.size) chunks.push(e.data);
  });
  const done = new Promise((resolve) => {
    rec.addEventListener("stop", () => {
      const type = rec.mimeType || mimeType || "video/webm";
      resolve(chunks.length ? new Blob(chunks, { type }) : null);
    });
    rec.addEventListener("error", () => resolve(null));
  });
  try {
    rec.start(1000);
  } catch {
    return null;
  }
  return {
    stop() {
      if (rec.state !== "inactive") rec.stop();
      return done;
    },
  };
}

export function videoExt(blob) {
  return /mp4/.test(blob?.type || "") ? "mp4" : "webm";
}
