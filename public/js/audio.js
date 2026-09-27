let ctx;
let enabled = true;

function audio() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

export function setSound(on) {
  enabled = on;
}

export function beep(freq = 880, dur = 0.08) {
  if (!enabled) return;
  const ac = audio();
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.frequency.value = freq;
  osc.type = "triangle";
  gain.gain.setValueAtTime(0.0001, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.08, ac.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
  osc.connect(gain).connect(ac.destination);
  osc.start();
  osc.stop(ac.currentTime + dur + 0.02);
}

export function shutter() {
  if (!enabled) return;
  const ac = audio();
  const buffer = ac.createBuffer(1, ac.sampleRate * 0.12, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  }
  const src = ac.createBufferSource();
  const filter = ac.createBiquadFilter();
  const gain = ac.createGain();
  filter.type = "highpass";
  filter.frequency.value = 1800;
  gain.gain.value = 0.18;
  src.buffer = buffer;
  src.connect(filter).connect(gain).connect(ac.destination);
  src.start();
}

// Call inside a tap: iOS only lets audio start from a user gesture.
export function unlockAudio() {
  try {
    audio();
  } catch {
    /* no Web Audio */
  }
}
