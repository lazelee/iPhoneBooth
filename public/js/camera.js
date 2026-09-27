export async function startCamera(video, facingMode) {
  stopCamera(video);
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser can't open the camera. Use Safari or Chrome over HTTPS.");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: facingMode },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
  });
  video.srcObject = stream;
  await video.play().catch(() => {});
  await waitForFrame(video);
  return stream;
}

export function stopCamera(video) {
  const stream = video.srcObject;
  if (stream) {
    for (const track of stream.getTracks()) track.stop();
  }
  video.srcObject = null;
}

export function cameraLive(video) {
  const track = video.srcObject?.getVideoTracks?.()[0];
  return !!track && track.readyState === "live";
}

function waitForFrame(video) {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 2 && video.videoWidth) {
      resolve();
      return;
    }
    const t = setTimeout(() => reject(new Error("The camera took too long to start. Try again.")), 8000);
    video.addEventListener(
      "loadeddata",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true }
    );
  });
}

export function grabFrame(video, mirrored) {
  const w = video.videoWidth || 1280;
  const h = video.videoHeight || 720;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (mirrored) {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, 0, 0, w, h);
  return canvas;
}
