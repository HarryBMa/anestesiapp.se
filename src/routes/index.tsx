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
  const unit = useStoredUnit();

  return (
    <main className="home">
      <h1>AnestesiApp</h1>

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
      </nav>
    </main>
  );
}

/**
 * Förrådet remembers the user's unit in localStorage under `currentUnit`.
 * Both apps live on www.anestesiapp.se, so the homepage can read it.
 *
 * The installed Förrådet app opens at "/?source=pwa"; that launch is sent
 * straight on to the unit, so installed apps keep working.
 */
function useStoredUnit() {
  const [unit, setUnit] = useState<{ slug: string; name: string } | null>(null);

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
  }, []);

  return unit;
}
