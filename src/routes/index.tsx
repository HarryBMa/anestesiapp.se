import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import './index.css';

export const Route = createFileRoute('/')({
  component: Home,
});

/**
 * The homepage. Plain HTML elements, styled only by ./index.css.
 *
 * JSX looks like HTML with two differences: `class` is written `className`,
 * and `{...}` inserts a JavaScript value (like `unit.name` below).
 */
function Home() {
  const { unit, strandedApp } = useStoredUnit();

  return (
    <main className="home">
      <h1>AnestesiApp</h1>

      {strandedApp && (
        <p className="notice" role="status">
          Förrådet-appen öppnades här i stället för på din enhet. Ta bort appen från
          hemskärmen, öppna din enhets länk (t.ex. anestesiapp.se/din-enhet) och
          lägg till den på hemskärmen igen. Då öppnas den direkt på enheten.
        </p>
      )}

      <nav>
        {/* Förrådet is a separate app, so it gets a normal link. */}
        <a className="button" href={unit ? `/${unit.slug}` : undefined}>
          {unit ? `Förrådet – ${unit.name}` : 'Förrådet (öppna via din enhets länk)'}
        </a>
        <a className="button" href="/blodgas">
          Blodgas
        </a>
        <a className="button" href="/stewart">
          Stewart
        </a>
        <a className="button" href="/lugn">
          Lugn
        </a>
        <a className="button" href="/a/tessa">
          TV-läge
        </a>
      </nav>
    </main>
  );
}

/**
 * Förrådet remembers the user's unit in localStorage under `currentUnit`.
 * Both apps live on www.anestesiapp.se, so the homepage can read it.
 *
 * Older installs of the Förrådet app open at "/?source=pwa"; that launch is
 * sent straight on to the unit. On iOS an installed app has its own storage,
 * so it may know no unit: then the page explains how to re-add the app (new
 * installs open on their unit directly).
 */
function useStoredUnit() {
  const [unit, setUnit] = useState<{ slug: string; name: string } | null>(null);
  const [strandedApp, setStrandedApp] = useState(false);

  useEffect(() => {
    let stored: { slug: string; name: string } | null = null;
    try {
      const parsed = JSON.parse(localStorage.getItem('currentUnit') ?? 'null');
      if (typeof parsed?.slug === 'string' && /^[a-z0-9-]+$/.test(parsed.slug)) {
        stored = { slug: parsed.slug, name: parsed.displayName ?? parsed.name ?? parsed.slug };
      }
    } catch {
      // Nothing stored, or storage blocked.
    }

    const fromPwa = new URLSearchParams(window.location.search).get('source') === 'pwa';
    if (fromPwa && stored) {
      window.location.replace(`/${stored.slug}`);
      return;
    }
    setUnit(stored);
    setStrandedApp(fromPwa);
  }, []);

  return { unit, strandedApp };
}
