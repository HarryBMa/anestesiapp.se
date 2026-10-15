import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { Tag } from '../components/Tag';

export const Route = createFileRoute('/tessa')({
  component: Tessa,
});

/**
 * Setup page for the TESSA Dagblad corridor display.
 *
 * The display itself is a plain script in public/tessa/narkos-dagblad.js.
 * It has to run *inside* the TESSA tab: the browser's same-origin rule stops
 * any page on anestesiapp.se from reading TESSA. A bookmark whose address
 * starts with `javascript:` (a "bookmarklet") runs its code in whatever tab
 * is open, so that is how the script gets there.
 *
 * The bookmark carries the whole script ("fristående"). The shorter loader,
 * which fetches the script from this site, is blocked on the hospital PCs
 * (TESSA's Content Security Policy or the proxy), so it is only offered as
 * an alternative for other networks. Because the script lives inside the
 * bookmark, a new version means dragging the bookmark in again; the version
 * number in its name shows which one a TV has.
 */
const SCRIPT_PATH = '/tessa/narkos-dagblad.js';

function loaderCode(origin: string) {
  return `(()=>{const s=document.createElement('script');s.src='${origin}${SCRIPT_PATH}?v='+Date.now();document.head.appendChild(s)})();`;
}

function Tessa() {
  const [standalone, setStandalone] = useState<string | null>(null);
  const [version, setVersion] = useState('');
  const [failed, setFailed] = useState(false);
  const loader = `javascript:${loaderCode(window.location.origin)}`;

  useEffect(() => {
    fetch(SCRIPT_PATH, { cache: 'no-store' })
      .then(r => {
        if (!r.ok) throw new Error(String(r.status));
        return r.text();
      })
      // The script uses only /* */ comments, so it survives a browser
      // flattening the bookmark onto one line.
      .then(code => {
        setVersion(/Portrait TV\s+v([\d.]+)/.exec(code)?.[1] ?? '');
        setStandalone(`javascript:${encodeURIComponent(code)}`);
      })
      .catch(() => setFailed(true));
  }, []);

  return (
    <main className="mx-auto max-w-3xl px-4 pt-12 pb-24 sm:px-8">
      <Tag>Korridor-TV</Tag>
      <h1 className="mt-4 font-wide text-4xl font-extrabold tracking-tight sm:text-5xl">
        TESSA Dagblad – TV-läge
      </h1>
      <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
        Gör om Dagbladet i TESSA till en lättläst tavla för en stående TV: salar, vårdledare, resurser och
        frånvaro på en skärm. Den läser bara sidan och ändrar aldrig något i TESSA.
      </p>

      <section className="mt-10">
        <h2 className="font-wide text-xl font-bold">1. Lägg till bokmärket</h2>
        <p className="mt-2 text-muted-foreground">
          Dra knappen till bokmärkesfältet på datorn som visar TV:n (inloggad på enhetskontot). Visa
          bokmärkesfältet med Ctrl+Shift+B om det är dolt.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-4">
          {standalone ? (
            <Bookmarklet href={standalone} label={`📺 TV-läge${version ? ` v${version}` : ''}`} primary />
          ) : (
            <span className="text-sm text-muted-foreground">
              {failed ? 'Kunde inte hämta skriptet. Ladda om sidan.' : 'Hämtar skriptet…'}
            </span>
          )}
        </div>
        {standalone && <CopyRow value={standalone} />}
      </section>

      <section className="mt-10">
        <h2 className="font-wide text-xl font-bold">2. Starta</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>Öppna TESSA → Dagblad.</li>
          <li>Klicka på bokmärket <strong className="text-foreground">📺 TV-läge</strong>.</li>
          <li>Tryck F11 för helskärm.</li>
        </ol>
        <p className="mt-3 text-muted-foreground">
          Tavlan uppdateras när TESSA ändras och byter till nästa dag vid midnatt. Efter en omstart av datorn
          eller om TESSA loggar ut: logga in och klicka på bokmärket igen.
        </p>
      </section>

      <section className="mt-10 rounded-xl border border-border bg-card p-6">
        <h2 className="font-wide text-xl font-bold">Ny version</h2>
        <p className="mt-2 text-muted-foreground">
          Hela tavlan ligger i bokmärket, så den uppdateras inte av sig själv. Står det ett högre
          versionsnummer här än på bokmärket: ta bort det gamla bokmärket och dra in knappen igen.
        </p>
        <details className="mt-4 text-sm text-muted-foreground">
          <summary className="cursor-pointer">Annan dator eller annat nätverk?</summary>
          <p className="mt-2">
            Utanför sjukhusets datorer kan en kort laddare fungera. Den hämtar alltid senaste versionen
            härifrån, men stoppas av TESSA:s säkerhetsinställningar på sjukhusets nät.
          </p>
          <div className="mt-3">
            <Bookmarklet href={loader} label="📺 TV-läge (laddare)" />
          </div>
        </details>
      </section>

      <p className="mt-12 text-sm text-muted-foreground">
        Skriptet:{' '}
        <a className="underline underline-offset-4" href={SCRIPT_PATH}>
          {SCRIPT_PATH}
        </a>
        . Inga personuppgifter lämnar datorn; allt körs i webbläsaren.
      </p>
    </main>
  );
}

/**
 * React refuses to render `javascript:` URLs in href (an XSS guard), so the
 * address is set directly on the DOM element after it mounts. Clicking it
 * here does nothing; it only works once it is a bookmark in a TESSA tab.
 */
function Bookmarklet({ href, label, primary = false }: { href: string; label: string; primary?: boolean }) {
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    ref.current?.setAttribute('href', href);
  }, [href]);

  return (
    <a
      ref={ref}
      onClick={e => e.preventDefault()}
      title="Dra mig till bokmärkesfältet"
      className={`inline-flex min-h-12 cursor-grab items-center rounded-lg px-5 font-semibold active:cursor-grabbing ${
        primary ? 'bg-primary text-primary-foreground' : 'border border-border'
      }`}
    >
      {label}
    </a>
  );
}

/** For browsers where dragging is blocked: copy the address and paste it into a new bookmark. */
function CopyRow({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <details className="mt-4 text-sm text-muted-foreground">
      <summary className="cursor-pointer">Går det inte att dra? Kopiera adressen istället</summary>
      <p className="mt-2">Skapa ett nytt bokmärke, döp det till “📺 TV-läge” och klistra in detta som adress:</p>
      <div className="mt-2 flex gap-2">
        <input
          readOnly
          value={value}
          onFocus={e => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-md border border-border bg-card px-3 py-2 font-mono text-xs"
          aria-label="Bokmärkets adress"
        />
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(value).then(() => setCopied(true), () => {});
          }}
          className="rounded-md bg-primary px-4 text-primary-foreground"
        >
          {copied ? 'Kopierad' : 'Kopiera'}
        </button>
      </div>
    </details>
  );
}
