import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Tag } from '../components/Tag';

export const Route = createFileRoute('/')({
  component: Home,
});

interface StoredUnit {
  slug: string;
  name: string;
}

/**
 * Förrådet (special-lamp) remembers the user's unit in localStorage under
 * `currentUnit`. Both apps share the www.anestesiapp.se origin, so the
 * homepage can read it too.
 */
function readStoredUnit(): StoredUnit | null {
  try {
    const raw = localStorage.getItem('currentUnit');
    if (!raw) {
      return null;
    }
    const unit = JSON.parse(raw);
    if (typeof unit?.slug !== 'string' || !/^[a-z0-9-]+$/.test(unit.slug)) {
      return null;
    }
    return { slug: unit.slug, name: unit.displayName ?? unit.name ?? unit.slug };
  } catch {
    return null;
  }
}

function Home() {
  const [unit, setUnit] = useState<StoredUnit | null>(null);

  useEffect(() => {
    const stored = readStoredUnit();
    // The installed Förrådet PWA starts at "/?source=pwa" (its manifest
    // start_url). Send it straight back to its unit, exactly as Förrådet's
    // own root page used to, so installed apps keep working unchanged.
    const fromPwa = new URLSearchParams(window.location.search).get('source') === 'pwa';
    if (fromPwa && stored) {
      window.location.replace(`/${stored.slug}`);
      return;
    }
    setUnit(stored);
  }, []);

  return (
    <main className="mx-auto max-w-5xl px-4 pt-16 pb-24 sm:px-8 sm:pt-24">
      <div className="rise" style={{ '--i': 0 } as React.CSSProperties}>
        <Tag>Anestesi · Operation · IVA</Tag>
      </div>
      <h1
        className="rise mt-5 max-w-3xl font-wide text-[clamp(2.4rem,7vw,4.75rem)] leading-[0.95] font-extrabold tracking-tight"
        style={{ '--i': 1 } as React.CSSProperties}
      >
        Verktyg för dem som söver.
      </h1>
      <p
        className="rise mt-6 max-w-xl text-lg text-muted-foreground"
        style={{ '--i': 2 } as React.CSSProperties}
      >
        Små, snabba appar byggda av anestesipersonal: för salen, för korridoren
        och för patienten som väntar.
      </p>

      <ol className="mt-16 border-t border-border sm:mt-24">
        <AppRow
          index={3}
          number="01"
          title="Förrådet"
          tag="Beställning"
          description="Beställ material från salen med några tryck. Korridoren ser beställningen direkt, plockar och levererar."
          action={
            unit ? (
              <a
                href={`/${unit.slug}`}
                className="group/link inline-flex min-h-12 items-center gap-2 rounded-lg bg-primary px-5 font-semibold text-primary-foreground transition-transform duration-150 active:scale-[0.98]"
              >
                Öppna {unit.name}
                <Arrow />
              </a>
            ) : (
              <span className="text-sm text-muted-foreground">
                Öppna via din enhets länk.
              </span>
            )
          }
        />
        <AppRow
          index={4}
          number="02"
          title="Blodgas"
          tag="Tolkning"
          description="Syra–bas steg för steg: kompensation, albuminkorrigerat anjongap, deltakvot, P/F och A–a-gradient. kPa eller mmHg."
          action={<RowLink to="/blodgas">Tolka en blodgas</RowLink>}
        />
        <AppRow
          index={5}
          number="03"
          title="Lugn"
          tag="För patienten"
          description="Lugna bilder, ljud och andningsguide i helskärm. Att räcka över på surfplattan i väntan på sövning."
          action={<RowLink to="/lugn">Starta</RowLink>}
        />
      </ol>

      <footer className="mt-20 max-w-xl text-sm text-muted-foreground">
        Verktygen är beslutsstöd och ersätter inte klinisk bedömning. Inga
        patientuppgifter sparas eller skickas – allt räknas ut i din webbläsare.
      </footer>
    </main>
  );
}

function AppRow(props: {
  index: number;
  number: string;
  title: string;
  tag: string;
  description: string;
  action: React.ReactNode;
}) {
  return (
    <li
      className="rise grid gap-x-8 gap-y-3 border-b border-border py-8 sm:grid-cols-[4rem_1fr_auto] sm:items-center"
      style={{ '--i': props.index } as React.CSSProperties}
    >
      <span className="font-mono text-sm text-muted-foreground">{props.number}</span>
      <div>
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="font-wide text-2xl font-bold tracking-tight sm:text-3xl">
            {props.title}
          </h2>
          <Tag className="bg-transparent! text-foreground! outline outline-border">
            {props.tag}
          </Tag>
        </div>
        <p className="mt-2 max-w-lg text-muted-foreground">{props.description}</p>
      </div>
      <div className="sm:justify-self-end">{props.action}</div>
    </li>
  );
}

function RowLink({ to, children }: { to: '/blodgas' | '/lugn'; children: string }) {
  return (
    <Link
      to={to}
      className="inline-flex min-h-12 items-center gap-2 rounded-lg border border-foreground/80 px-5 font-semibold transition-colors duration-150 hover:bg-foreground hover:text-background"
    >
      {children}
      <Arrow />
    </Link>
  );
}

function Arrow() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="none">
      <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
