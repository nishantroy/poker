/**
 * Tiny WebAudio synth for table sounds. No assets, no network; every sound is a few oscillator
 * envelopes so the page stays snappy. Audio is created lazily on first play (browsers require a gesture).
 */
export type Sfx = "turn" | "chip" | "card" | "allin" | "win" | "badbeat" | "taunt" | "eliminate" | "ghost" | "fold" | "tick" | "tickLast";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function ac(): { ctx: AudioContext; out: GainNode } | null {
  try {
    ctx ??= new AudioContext();
    if (!master) {
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") void ctx.resume();
    return { ctx, out: master };
  } catch {
    return null;
  }
}

function tone(a: { ctx: AudioContext; out: GainNode }, opts: { type?: OscillatorType; f0: number; f1?: number; t?: number; dur: number; gain?: number; delay?: number }) {
  const { ctx, out } = a;
  const t0 = ctx.currentTime + (opts.delay ?? 0);
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = opts.type ?? "sine";
  o.frequency.setValueAtTime(opts.f0, t0);
  if (opts.f1) o.frequency.exponentialRampToValueAtTime(opts.f1, t0 + (opts.t ?? opts.dur));
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.15, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
  o.connect(g).connect(out);
  o.start(t0);
  o.stop(t0 + opts.dur + 0.02);
}

function noise(a: { ctx: AudioContext; out: GainNode }, dur: number, gain: number, hp: number, delay = 0) {
  const { ctx, out } = a;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = "highpass";
  f.frequency.value = hp;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(out);
  src.start(ctx.currentTime + delay);
}

export function playSfx(name: Sfx) {
  const a = ac();
  if (!a) return;
  switch (name) {
    case "turn":
      tone(a, { f0: 880, f1: 1175, t: 0.09, dur: 0.25, gain: 0.18 });
      break;
    case "chip":
      noise(a, 0.05, 0.25, 3000);
      tone(a, { type: "triangle", f0: 1900, f1: 1400, dur: 0.07, gain: 0.08 });
      tone(a, { type: "triangle", f0: 2400, f1: 1700, dur: 0.06, gain: 0.05, delay: 0.035 });
      break;
    case "card":
      noise(a, 0.07, 0.18, 1800);
      break;
    case "allin":
      noise(a, 0.18, 0.3, 900);
      tone(a, { type: "sawtooth", f0: 160, f1: 420, dur: 0.22, gain: 0.07 });
      break;
    case "win":
      tone(a, { f0: 660, dur: 0.14, gain: 0.14 });
      tone(a, { f0: 880, dur: 0.14, gain: 0.14, delay: 0.11 });
      tone(a, { f0: 1320, dur: 0.3, gain: 0.16, delay: 0.22 });
      break;
    case "badbeat":
      tone(a, { type: "sawtooth", f0: 330, f1: 110, t: 0.7, dur: 0.8, gain: 0.12 });
      tone(a, { type: "square", f0: 165, f1: 55, t: 0.7, dur: 0.8, gain: 0.05 });
      break;
    case "taunt":
      tone(a, { type: "triangle", f0: 520, f1: 780, t: 0.06, dur: 0.12, gain: 0.1 });
      break;
    case "eliminate":
      tone(a, { type: "square", f0: 440, f1: 220, t: 0.25, dur: 0.3, gain: 0.07 });
      noise(a, 0.25, 0.2, 400);
      break;
    case "fold":
      // cards slid into the muck: a soft swish and a low drop
      noise(a, 0.16, 0.14, 700);
      tone(a, { type: "triangle", f0: 320, f1: 140, t: 0.14, dur: 0.16, gain: 0.06 });
      break;
    case "tick":
      // your clock is running out
      tone(a, { type: "square", f0: 1240, dur: 0.06, gain: 0.07 });
      break;
    case "tickLast":
      tone(a, { type: "square", f0: 1480, dur: 0.09, gain: 0.1 });
      tone(a, { type: "square", f0: 1480, dur: 0.09, gain: 0.1, delay: 0.14 });
      break;
    case "ghost":
      tone(a, { f0: 300, f1: 600, t: 0.4, dur: 0.6, gain: 0.07 });
      tone(a, { f0: 450, f1: 900, t: 0.4, dur: 0.6, gain: 0.04, delay: 0.05 });
      break;
  }
}

export function vibrate(ms: number) {
  try { navigator.vibrate?.(ms); } catch { /* ignore */ }
}
