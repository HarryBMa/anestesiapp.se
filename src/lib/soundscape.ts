/**
 * Generated ambient sound with the Web Audio API: no audio files, nothing to
 * license or download. Each soundscape is filtered noise shaped by slow
 * oscillators (LFOs).
 *
 * The ocean swell runs at the same period as the breathing guide (4 s in +
 * 6 s out = 10 s), so waves rise as the patient breathes in and recede on
 * the long exhale. Six breaths a minute with a longer exhale is the classic
 * slow-breathing pattern used for pre-procedural anxiety.
 */

export type SoundKind = 'ocean' | 'rain' | 'wind' | 'none';

export const BREATH_IN_S = 4;
export const BREATH_OUT_S = 6;
export const BREATH_CYCLE_S = BREATH_IN_S + BREATH_OUT_S;

type Colour = 'brown' | 'pink';

/**
 * A seamless loop of coloured noise. The buffer is generated a little long,
 * and the overhang is cross-faded into the start, so the loop point has no
 * click.
 */
function noiseBuffer(ctx: AudioContext, colour: Colour, seconds = 12): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = seconds * rate;
  const fade = Math.floor(rate / 2);
  const raw = new Float32Array(length + fade);

  if (colour === 'brown') {
    // Integrated white noise with a leak, so it doesn't wander off.
    let last = 0;
    for (let i = 0; i < raw.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      raw[i] = last * 3.5;
    }
  } else {
    // Paul Kellet's economy pink-noise filter.
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < raw.length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      raw[i] = (b0 + b1 + b2 + white * 0.1848) * 0.11;
    }
  }

  const buffer = ctx.createBuffer(1, length, rate);
  const out = buffer.getChannelData(0);
  out.set(raw.subarray(0, length));
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    out[i] = raw[i] * t + raw[length + i] * (1 - t);
  }
  return buffer;
}

function lfo(ctx: AudioContext, periodS: number, depth: number, target: AudioParam) {
  const osc = ctx.createOscillator();
  osc.frequency.value = 1 / periodS;
  const gain = ctx.createGain();
  gain.gain.value = depth;
  osc.connect(gain).connect(target);
  osc.start();
  return osc;
}

export class Soundscape {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private layer: { bus: GainNode; nodes: AudioScheduledSourceNode[] } | null = null;
  private volume = 0.6;
  /** Audio-clock time of the first start: the breathing guide's t = 0. */
  private origin = 0;

  /** Must be called from a user gesture (tap), or the browser blocks audio. */
  async start(kind: SoundKind) {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      this.origin = this.ctx.currentTime;
    }
    await this.ctx.resume();
    this.play(kind);
  }

  setKind(kind: SoundKind) {
    if (this.ctx) {
      this.play(kind);
    }
  }

  setVolume(volume: number) {
    this.volume = volume;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.3);
    }
  }

  async stop() {
    if (!this.ctx || !this.master) {
      return;
    }
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    this.layer = null;
    await new Promise(r => setTimeout(r, 1500));
    await ctx.close();
  }

  private play(kind: SoundKind) {
    const ctx = this.ctx as AudioContext;
    const master = this.master as GainNode;

    // Each soundscape is a layer with its own gain: the old one fades out
    // while the new one fades in, never a hard cut.
    const old = this.layer;
    this.layer = null;
    if (old) {
      old.bus.gain.setTargetAtTime(0, ctx.currentTime, 0.5);
      setTimeout(() => {
        for (const n of old.nodes) {
          n.stop();
        }
        old.bus.disconnect();
      }, 3000);
    }
    if (kind === 'none') {
      return;
    }

    const bus = ctx.createGain();
    bus.gain.value = 0;
    bus.connect(master);
    const source = ctx.createBufferSource();
    source.loop = true;
    const nodes: AudioScheduledSourceNode[] = [source];
    this.layer = { bus, nodes };

    if (kind === 'ocean') {
      source.buffer = noiseBuffer(ctx, 'brown');
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 520;
      const swell = ctx.createGain();
      swell.gain.value = 0.55;
      source.connect(filter).connect(swell).connect(bus);
      // Phase −90°: the oscillator starts at its trough, so each wave builds
      // with an inhale. Started on the next cycle boundary of the shared
      // clock, so switching back to the sea later still lines up.
      const osc = ctx.createOscillator();
      osc.frequency.value = 1 / BREATH_CYCLE_S;
      osc.setPeriodicWave(
        ctx.createPeriodicWave(new Float32Array([0, -1]), new Float32Array([0, 0])),
      );
      const depth = ctx.createGain();
      depth.gain.value = 0.42;
      osc.connect(depth).connect(swell.gain);
      const cycles = Math.ceil((ctx.currentTime - this.origin) / BREATH_CYCLE_S);
      osc.start(this.origin + cycles * BREATH_CYCLE_S);
      nodes.push(osc, lfo(ctx, BREATH_CYCLE_S / 2, 160, filter.frequency));
    } else if (kind === 'rain') {
      source.buffer = noiseBuffer(ctx, 'pink');
      const high = ctx.createBiquadFilter();
      high.type = 'highpass';
      high.frequency.value = 700;
      const shelf = ctx.createBiquadFilter();
      shelf.type = 'lowpass';
      shelf.frequency.value = 6000;
      const level = ctx.createGain();
      level.gain.value = 0.45;
      source.connect(high).connect(shelf).connect(level).connect(bus);
      nodes.push(lfo(ctx, 23, 0.08, level.gain));
    } else {
      source.buffer = noiseBuffer(ctx, 'brown');
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 420;
      band.Q.value = 1.4;
      const level = ctx.createGain();
      level.gain.value = 0.9;
      source.connect(band).connect(level).connect(bus);
      nodes.push(lfo(ctx, 17, 240, band.frequency), lfo(ctx, 11, 0.35, level.gain));
    }

    source.start();
    bus.gain.setTargetAtTime(1, ctx.currentTime + 0.3, 0.8);
  }
}
