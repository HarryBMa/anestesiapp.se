import { createFileRoute, Link } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CALM_VIDEOS, type CalmVideo } from '../config/videos';
import { BREATH_CYCLE_S, BREATH_IN_S, BREATH_OUT_S, Soundscape, type SoundKind } from '../lib/soundscape';

export const Route = createFileRoute('/lugn')({
  component: Calm,
});

/**
 * Patient-facing, so it speaks the patient's language: Swedish or English,
 * switchable from the controls.
 */
type Lang = 'sv' | 'en';

const TEXT = {
  sv: {
    start: 'Tryck för att börja',
    startNote: 'Ljud och bild för en lugn stund',
    in: 'Andas in',
    out: 'Andas ut',
    breathing: 'Andningsguide',
    sound: 'Ljud',
    volume: 'Volym',
    scene: 'Scen',
    ownVideo: 'Egen video',
    fullscreen: 'Helskärm',
    exit: 'Avsluta',
  },
  en: {
    start: 'Tap to begin',
    startNote: 'Sound and pictures for a calm moment',
    in: 'Breathe in',
    out: 'Breathe out',
    breathing: 'Breathing guide',
    sound: 'Sound',
    volume: 'Volume',
    scene: 'Scene',
    ownVideo: 'Own video',
    fullscreen: 'Full screen',
    exit: 'Exit',
  },
} satisfies Record<Lang, Record<string, string>>;

interface GeneratedScene {
  kind: 'generated';
  id: string;
  title: { sv: string; en: string };
  sound: SoundKind;
  /** Background plus three blob colours. */
  colours: [string, string, string, string];
}

type Scene = GeneratedScene | ({ kind: 'video'; id: string; sound: SoundKind } & CalmVideo);

const GENERATED: GeneratedScene[] = [
  {
    kind: 'generated',
    id: 'hav',
    title: { sv: 'Hav', en: 'Sea' },
    sound: 'ocean',
    colours: ['oklch(0.26 0.04 235)', 'oklch(0.5 0.08 220)', 'oklch(0.66 0.07 195)', 'oklch(0.8 0.04 180)'],
  },
  {
    kind: 'generated',
    id: 'skymning',
    title: { sv: 'Skymning', en: 'Dusk' },
    sound: 'wind',
    colours: ['oklch(0.27 0.04 300)', 'oklch(0.62 0.11 40)', 'oklch(0.55 0.09 350)', 'oklch(0.8 0.08 75)'],
  },
  {
    kind: 'generated',
    id: 'skog',
    title: { sv: 'Skog i regn', en: 'Forest in rain' },
    sound: 'rain',
    colours: ['oklch(0.24 0.03 150)', 'oklch(0.45 0.07 145)', 'oklch(0.6 0.06 120)', 'oklch(0.72 0.05 95)'],
  },
];

const SCENES: Scene[] = [
  ...GENERATED,
  ...CALM_VIDEOS.map((v, i) => ({ ...v, kind: 'video' as const, id: `video-${i}`, sound: 'none' as const })),
];

const IDLE_MS = 5000;

function Calm() {
  const [started, setStarted] = useState(false);
  const [lang, setLang] = useState<Lang>('sv');
  const [scene, setScene] = useState<Scene>(SCENES[0]);
  const [ownVideo, setOwnVideo] = useState<string | null>(null);
  const [soundOn, setSoundOn] = useState(true);
  const [volume, setVolume] = useState(0.6);
  const [breathing, setBreathing] = useState(true);
  const [idle, setIdle] = useState(false);

  const sound = useRef<Soundscape | null>(null);
  /** Shared clock: the ocean swell and the breathing guide both count from here. */
  const t0 = useRef(0);
  const t = TEXT[lang];

  const activeSound: SoundKind = soundOn && !ownVideo ? scene.sound : 'none';

  useEffect(() => {
    document.title = 'Lugn';
    return () => {
      void sound.current?.stop();
    };
  }, []);

  useEffect(() => {
    sound.current?.setKind(activeSound);
  }, [activeSound]);

  useEffect(() => {
    sound.current?.setVolume(volume);
  }, [volume]);

  // Release the object URL of a local file when it's replaced.
  useEffect(() => () => {
    if (ownVideo) {
      URL.revokeObjectURL(ownVideo);
    }
  }, [ownVideo]);

  // Keep the screen awake while the player is running.
  useEffect(() => {
    if (!started || !('wakeLock' in navigator)) {
      return;
    }
    let lock: WakeLockSentinel | null = null;
    const acquire = async () => {
      try {
        lock = await navigator.wakeLock.request('screen');
      } catch {
        // Denied (battery saver, unsupported context): not critical.
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void acquire();
      }
    };
    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release();
    };
  }, [started]);

  // Controls fade away after a few seconds; any touch brings them back.
  const idleTimer = useRef<number>(0);
  const wake = useCallback(() => {
    setIdle(false);
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setIdle(true), IDLE_MS);
  }, []);
  useEffect(() => {
    if (!started) {
      return;
    }
    wake();
    const events = ['pointermove', 'pointerdown', 'keydown'] as const;
    for (const e of events) {
      window.addEventListener(e, wake);
    }
    return () => {
      window.clearTimeout(idleTimer.current);
      for (const e of events) {
        window.removeEventListener(e, wake);
      }
    };
  }, [started, wake]);

  const begin = async () => {
    t0.current = performance.now();
    setStarted(true);
    sound.current = new Soundscape();
    sound.current.setVolume(volume);
    await sound.current.start(activeSound);
    try {
      await document.documentElement.requestFullscreen?.();
    } catch {
      // iPhone Safari has no element fullscreen; the page still fills the screen.
    }
  };

  const videoSrc = ownVideo ?? (scene.kind === 'video' ? scene.src : null);

  return (
    <main
      className={`fixed inset-0 overflow-hidden text-[oklch(0.96_0.01_90)] ${idle ? 'cursor-none' : ''}`}
      style={{ background: scene.kind === 'generated' ? scene.colours[0] : 'oklch(0.18 0.01 250)' }}
    >
      {videoSrc ? (
        <video
          key={videoSrc}
          src={videoSrc}
          poster={!ownVideo && scene.kind === 'video' ? scene.poster : undefined}
          autoPlay
          loop
          playsInline
          muted={!soundOn}
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        scene.kind === 'generated' && <Blobs colours={scene.colours} />
      )}

      {/* Soft vignette keeps text legible over any scene. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(ellipse at center, transparent 40%, oklch(0.1 0.01 250 / 0.55))' }}
      />

      {!started ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-8 px-4 text-center">
          <button
            type="button"
            onClick={begin}
            className="flex min-h-40 w-full max-w-xl flex-col items-center justify-center gap-3 rounded-[2rem] focus-visible:outline-white"
          >
            <span className="font-wide text-[clamp(2rem,6vw,3.5rem)] font-bold tracking-tight">{t.start}</span>
            <span className="text-lg opacity-80">{t.startNote}</span>
          </button>
          <div className="flex gap-2" role="group" aria-label="Språk / Language">
            {(['sv', 'en'] as const).map(l => (
              <button
                key={l}
                type="button"
                aria-pressed={lang === l}
                onClick={() => setLang(l)}
                className={`min-h-12 min-w-16 rounded-full px-4 font-mono text-sm uppercase ${lang === l ? 'bg-white/20' : 'opacity-70'}`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      ) : (
        breathing && <BreathingGuide t0={t0.current} labels={{ in: t.in, out: t.out }} />
      )}

      {started && (
        <div
          className={`absolute inset-x-0 bottom-0 transition-opacity duration-500 ${idle ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
          aria-hidden={idle}
        >
          <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-2 px-4 pt-10 pb-[max(1.25rem,env(safe-area-inset-bottom))] [&_button]:min-h-12">
            <label className="sr-only" htmlFor="scene">
              {t.scene}
            </label>
            <select
              id="scene"
              value={ownVideo ? 'own' : scene.id}
              onChange={e => {
                const next = SCENES.find(s => s.id === e.target.value);
                if (next) {
                  setOwnVideo(null);
                  setScene(next);
                }
              }}
              className="h-12 rounded-full border-0 bg-black/30 px-4 text-inherit backdrop-blur-sm"
            >
              {SCENES.map(s => (
                <option key={s.id} value={s.id} className="text-black">
                  {s.title[lang]}
                </option>
              ))}
              {ownVideo && (
                <option value="own" className="text-black">
                  {t.ownVideo}
                </option>
              )}
            </select>

            <label className="flex h-12 cursor-pointer items-center rounded-full bg-black/30 px-4 backdrop-blur-sm has-focus-visible:outline-2 has-focus-visible:outline-white">
              {t.ownVideo}
              <input
                type="file"
                accept="video/*"
                className="sr-only"
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setOwnVideo(URL.createObjectURL(file));
                  }
                }}
              />
            </label>

            <Toggle on={soundOn} onClick={() => setSoundOn(s => !s)}>
              {t.sound}
            </Toggle>
            <label className="flex h-12 items-center gap-2 rounded-full bg-black/30 px-4 backdrop-blur-sm">
              <span className="sr-only">{t.volume}</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={volume}
                onChange={e => setVolume(Number(e.target.value))}
                className="w-24 accent-white"
              />
            </label>
            <Toggle on={breathing} onClick={() => setBreathing(b => !b)}>
              {t.breathing}
            </Toggle>
            <button
              type="button"
              onClick={() => setLang(l => (l === 'sv' ? 'en' : 'sv'))}
              className="rounded-full bg-black/30 px-4 font-mono text-sm uppercase backdrop-blur-sm"
              aria-label={lang === 'sv' ? 'Switch to English' : 'Byt till svenska'}
            >
              {lang === 'sv' ? 'en' : 'sv'}
            </button>
            {document.fullscreenEnabled && (
              <button
                type="button"
                onClick={() =>
                  document.fullscreenElement
                    ? void document.exitFullscreen()
                    : void document.documentElement.requestFullscreen()
                }
                className="rounded-full bg-black/30 px-4 backdrop-blur-sm"
              >
                {t.fullscreen}
              </button>
            )}
            <Link
              to="/"
              onClick={() => {
                if (document.fullscreenElement) {
                  void document.exitFullscreen();
                }
              }}
              className="ml-auto flex h-12 items-center rounded-full px-4 opacity-80 hover:opacity-100"
            >
              {t.exit}
            </Link>
          </div>
        </div>
      )}
    </main>
  );
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`rounded-full px-4 backdrop-blur-sm transition-colors duration-150 ${on ? 'bg-white/25' : 'bg-black/30 opacity-70'}`}
    >
      {children}
    </button>
  );
}

/** Large, slow blobs: the homepage motif, slowed right down. */
function Blobs({ colours }: { colours: GeneratedScene['colours'] }) {
  const blob = 'absolute rounded-full blur-[90px] transition-[background-color] duration-[3000ms]';
  return (
    <div aria-hidden="true" className="absolute inset-0">
      <div
        className={`${blob} animate-drift-a top-[10%] left-[5%] size-[55vmax] opacity-70 [animation-duration:60s]`}
        style={{ backgroundColor: colours[1] }}
      />
      <div
        className={`${blob} animate-drift-b top-[35%] -right-[15%] size-[50vmax] opacity-60 [animation-duration:75s]`}
        style={{ backgroundColor: colours[2] }}
      />
      <div
        className={`${blob} animate-drift-c -top-[20%] right-[25%] size-[40vmax] opacity-50 [animation-duration:90s]`}
        style={{ backgroundColor: colours[3] }}
      />
    </div>
  );
}

/**
 * A circle that grows for 4 s (breathe in) and shrinks for 6 s (breathe
 * out). The phase is computed from the shared start time, so it stays in
 * step with the ocean swell even when toggled off and on.
 */
function BreathingGuide({ t0, labels }: { t0: number; labels: { in: string; out: string } }) {
  const [phase, setPhase] = useState({ inhale: false, remaining: 0 });

  useEffect(() => {
    let timer = 0;
    const tick = () => {
      const p = phaseAt(t0);
      setPhase(p);
      timer = window.setTimeout(tick, p.remaining * 1000);
    };
    // First tick on the next frame, so the initial scale renders before the
    // transition to the target scale starts.
    const raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [t0]);

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div
        aria-hidden="true"
        className="absolute size-[min(60vmin,26rem)] rounded-full border border-white/40 bg-white/10 backdrop-blur-[2px]"
        style={{
          transform: `scale(${phase.inhale ? 1 : 0.55})`,
          transition: `transform ${phase.remaining}s cubic-bezier(0.45, 0, 0.55, 1)`,
        }}
      />
      <p aria-live="polite" className="relative font-wide text-[clamp(1.5rem,4vw,2.5rem)] font-semibold tracking-tight">
        {phase.inhale ? labels.in : labels.out}
      </p>
    </div>
  );
}

function phaseAt(t0: number) {
  const elapsed = ((performance.now() - t0) / 1000) % BREATH_CYCLE_S;
  return elapsed < BREATH_IN_S
    ? { inhale: true, remaining: BREATH_IN_S - elapsed }
    : { inhale: false, remaining: BREATH_CYCLE_S - elapsed || BREATH_OUT_S };
}
