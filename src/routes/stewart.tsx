import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useId, useMemo, useState } from 'react';
import { ANALYTES, type Analyte, PLAUSIBLE, parseAbl90 } from '../lib/abl90';
import { bicarbonateFromPh, type Segment, type StewartResult, stewart } from '../lib/stewart';
import './stewart.css';

export const Route = createFileRoute('/stewart')({
  component: StewartPage,
});

/** Values typed or scanned in, as strings so the inputs stay editable. */
type Field = Analyte | 'albumin' | 'phosphate' | 'mg';
type Form = Partial<Record<Field, string>>;
type Source = 'scanned' | 'suspect';

/** Values the ABL90 doesn't measure: entered by hand. */
const MANUAL: { key: Field; label: string; unit: string; range: [number, number]; note: string }[] = [
  { key: 'albumin', label: 'Albumin', unit: 'g/L', range: [5, 70], note: 'krävs' },
  { key: 'phosphate', label: 'Fosfat', unit: 'mmol/L', range: [0.1, 5], note: 'valfritt' },
  { key: 'mg', label: 'Mg²⁺ (joniserat)', unit: 'mmol/L', range: [0.1, 3], note: 'valfritt' },
];

function parse(value: string | undefined): number | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  const n = Number(value.trim().replace(',', '.').replace('−', '-'));
  return Number.isFinite(n) ? n : undefined;
}

const fmt = (n: number, digits = 1) =>
  n.toLocaleString('sv-SE', { minimumFractionDigits: digits, maximumFractionDigits: digits });

function StewartPage() {
  const [form, setForm] = useState<Form>({});
  const [sources, setSources] = useState<Partial<Record<Field, Source>>>({});
  const [status, setStatus] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    document.title = 'Stewart – AnestesiApp';
  }, []);

  const set = (key: Field, value: string) => {
    setForm(f => ({ ...f, [key]: value }));
    setConfirmed(false);
  };

  const scan = async (file: File) => {
    setBusy(true);
    setConfirmed(false);
    setStatus('Läser in läsmotorn…');
    try {
      const { readPrintout } = await import('../lib/ocr');
      const text = await readPrintout(file, p => setStatus(`Läser utskriften… ${Math.round(p * 100)} %`));
      // Only allow-listed analyte values come out of the text; the text
      // itself (with name and personnummer) is dropped right here.
      const readings = parseAbl90(text);
      const found = Object.keys(readings) as Analyte[];
      setForm(f => {
        const next = { ...f };
        for (const key of found) {
          // Shown exactly as read, so it can be compared with the printout.
          next[key] = String(readings[key]?.value).replace('.', ',');
        }
        return next;
      });
      setSources(Object.fromEntries(found.map(k => [k, readings[k]?.suspect ? 'suspect' : 'scanned'])));
      setStatus(
        found.length
          ? `${found.length} värden avlästa. Kontrollera dem mot utskriften.`
          : 'Inga värden hittades. Prova ett skarpare foto, rakt ovanifrån, eller skriv in värdena.',
      );
    } catch (err) {
      console.error(err);
      setStatus('Avläsningen misslyckades. Skriv in värdena för hand.');
    } finally {
      setBusy(false);
    }
  };

  const n = (key: Field) => parse(form[key]);

  const missing = (['ph', 'na', 'k', 'cl', 'albumin'] as Field[]).filter(k => n(k) === undefined);
  const ph = n('ph');
  const pco2 = n('pco2');
  const hco3 = n('hco3') ?? (ph !== undefined && pco2 !== undefined ? bicarbonateFromPh(ph, pco2) : undefined);
  if (hco3 === undefined) {
    missing.push('hco3');
  }

  const result = useMemo(() => {
    if (missing.length || ph === undefined || hco3 === undefined) {
      return null;
    }
    return stewart({
      ph,
      hco3,
      na: n('na') as number,
      k: n('k') as number,
      cl: n('cl') as number,
      ca: n('ca'),
      mg: n('mg'),
      lactate: n('lactate'),
      albumin: n('albumin') as number,
      phosphate: n('phosphate'),
      be: n('be'),
    });
    // biome-ignore lint/correctness/useExhaustiveDependencies: derived from form.
  }, [form]);

  return (
    <main className="stewart">
      <h1>Stewart</h1>
      <p>
        Fysikalisk-kemisk syra–basanalys från en ABL90 FLEX PLUS-utskrift: starka
        joners differens (SID), svaga syror och starka jongapet (SIG).
      </p>

      <section className="step">
        <h2>1. Fotografera utskriften</h2>
        <label className="file">
          Ta foto eller välj bild
          <input
            type="file"
            accept="image/*"
            capture="environment"
            disabled={busy}
            onChange={e => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) {
                void scan(file);
              }
            }}
          />
        </label>
        <p className="status" aria-live="polite">
          {status}
        </p>
        <p className="privacy">
          Bilden läses i din telefon och skickas ingenstans. Bara analysvärden läses
          ut; namn och personnummer läses aldrig, sparas inte och visas inte.
        </p>
      </section>

      <section className="step">
        <h2>2. Kontrollera värdena</h2>
        <table className="values">
          <thead>
            <tr>
              <th scope="col">Analys</th>
              <th scope="col">Värde</th>
              <th scope="col">Enhet</th>
              <th scope="col">Källa</th>
            </tr>
          </thead>
          <tbody>
            {ANALYTES.map(a => (
              <ValueRow
                key={a.key}
                label={a.label}
                unit={a.unit}
                value={form[a.key] ?? ''}
                onChange={v => set(a.key, v)}
                range={PLAUSIBLE[a.key]}
                source={sources[a.key]}
              />
            ))}
            {MANUAL.map(m => (
              <ValueRow
                key={m.key}
                label={m.label}
                unit={m.unit}
                value={form[m.key] ?? ''}
                onChange={v => set(m.key, v)}
                range={m.range}
                note={m.note}
              />
            ))}
          </tbody>
        </table>
        <p className="note">
          Ingen HCO₃⁻(P)? Den räknas ut från pH och pCO₂. Utan fosfat och Mg²⁺ blir SIG
          något högre respektive lägre än med.
        </p>
        <label className="confirm">
          <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
          Jag har kontrollerat värdena mot utskriften
        </label>
      </section>

      <section className="step" aria-live="polite">
        <h2>3. Resultat</h2>
        {!result ? (
          <p>Saknas: {missing.map(labelFor).join(', ')}.</p>
        ) : !confirmed ? (
          <p>Bekräfta värdena ovan för att se resultatet.</p>
        ) : (
          <Result result={result} />
        )}
      </section>

      <p className="disclaimer">
        Beslutsstöd. Ersätter inte klinisk bedömning. Kontrollera alltid mot
        originalutskriften.
      </p>
    </main>
  );
}

function labelFor(key: Field): string {
  return ANALYTES.find(a => a.key === key)?.label ?? MANUAL.find(m => m.key === key)?.label ?? key;
}

function ValueRow(props: {
  label: string;
  unit: string;
  value: string;
  onChange: (value: string) => void;
  range: [number, number];
  source?: Source;
  note?: string;
}) {
  const id = useId();
  const n = parse(props.value);
  const outOfRange = n !== undefined && (n < props.range[0] || n > props.range[1]);
  const flag = outOfRange || props.source === 'suspect' ? 'Kontrollera' : props.source === 'scanned' ? 'Avläst' : props.note ?? '';
  return (
    <tr data-flag={outOfRange || props.source === 'suspect' ? 'check' : props.source ?? 'manual'}>
      <th scope="row">
        <label htmlFor={id}>{props.label}</label>
      </th>
      <td>
        <input id={id} inputMode="decimal" autoComplete="off" value={props.value} onChange={e => props.onChange(e.target.value)} />
      </td>
      <td>{props.unit}</td>
      <td>{flag}</td>
    </tr>
  );
}

function Result({ result }: { result: StewartResult }) {
  const r = result;
  const be = r.bePartition;
  return (
    <>
      <dl className="numbers">
        <div>
          <dt>SIDa (apparent)</dt>
          <dd>{fmt(r.sida)} mEq/L</dd>
        </div>
        <div>
          <dt>SIDe (effektiv)</dt>
          <dd>{fmt(r.side)} mEq/L</dd>
        </div>
        <div>
          <dt>SIG</dt>
          <dd>{fmt(r.sig)} mEq/L</dd>
        </div>
        <div>
          <dt>Albumin⁻</dt>
          <dd>{fmt(r.albuminCharge)} mEq/L</dd>
        </div>
      </dl>
      <ul className="reading">
        {interpret(r).map(line => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      <Gamblegram result={r} />

      {be && (
        <table className="partition">
          <caption>Basöverskottet uppdelat (Fencl–Story)</caption>
          <thead>
            <tr>
              <th scope="col">Orsak</th>
              <th scope="col">mmol/L</th>
            </tr>
          </thead>
          <tbody>
            {(
              [
                ['Natrium (fritt vatten)', be.sodium],
                ['Klorid', be.chloride],
                ['Albumin', be.albumin],
                ['Laktat', be.lactate],
                ['Omätta anjoner', be.unmeasured],
              ] as const
            ).map(([label, value]) => (
              <tr key={label} data-sign={value < -0.05 ? 'acid' : value > 0.05 ? 'base' : 'zero'}>
                <th scope="row">{label}</th>
                <td>
                  {value > 0 ? '+' : ''}
                  {fmt(value)}
                </td>
              </tr>
            ))}
            <tr>
              <th scope="row">Basöverskott (cBase(Ecf))</th>
              <td>
                {be.total > 0 ? '+' : ''}
                {fmt(be.total)}
              </td>
            </tr>
          </tbody>
        </table>
      )}
    </>
  );
}

/** A few plain-language lines. Thresholds are indicative and method-dependent. */
function interpret(r: StewartResult): string[] {
  const lines: string[] = [];
  if (r.sida < 38) {
    lines.push('Lågt SIDa: stark-jon-acidos (oftast hyperkloremi, ev. laktat).');
  } else if (r.sida > 46) {
    lines.push('Högt SIDa: stark-jon-alkalos (t.ex. kloridförlust).');
  }
  if (r.sig > 5) {
    lines.push('Förhöjt SIG: omätta anjoner (t.ex. ketoner, njursvikt, toxiner).');
  }
  const p = r.bePartition;
  if (p && p.albumin > 3) {
    lines.push('Lågt albumin verkar alkaliserande och kan dölja en acidos.');
  }
  if (!lines.length) {
    lines.push('Inga tydliga stark-jon- eller SIG-avvikelser.');
  }
  lines.push('Referens (metodberoende): SIDa ≈ 40–44, SIG ≈ 0–5 mEq/L.');
  return lines;
}

// ── Gamblegram ───────────────────────────────────────────────────────────
//
// Two stacked columns of equal charge: cations left, anions right. On the
// anion side, strong anions sit at the bottom, then the buffer base (SIDe),
// then whatever is left over: the strong ion gap. The brackets show SIDa
// (everything above the strong anions) and how SIDe + SIG fill it.

const W = 600;
const H = 440;
const TOP = 16;
const BOTTOM = 24;
const CAT_X = 90;
const AN_X = 210;
const BAR_W = 90;
const MIN_LABEL_GAP = 15;

type Group = 'cation' | 'strong' | 'buffer' | 'sig';

interface Placed extends Segment {
  group: Group;
  y0: number;
  y1: number;
}

function stack(segments: Segment[], group: Group, start: number, scale: (v: number) => number): Placed[] {
  let at = start;
  return segments.map(s => {
    const placed = { ...s, group, y0: scale(at), y1: scale(at + s.value) };
    at += s.value;
    return placed;
  });
}

/** Spreads label positions apart so none overlap, keeping order. */
function spread(ys: number[]): number[] {
  const out = [...ys];
  for (let i = out.length - 2; i >= 0; i--) {
    if (out[i] - out[i + 1] < MIN_LABEL_GAP) {
      out[i] = out[i + 1] + MIN_LABEL_GAP;
    }
  }
  return out;
}

function Gamblegram({ result: r }: { result: StewartResult }) {
  const titleId = useId();
  const sum = (s: Segment[]) => s.reduce((a, x) => a + x.value, 0);
  const cationTotal = sum(r.cations);
  const anionMeasured = sum(r.strongAnions) + sum(r.bufferBase);
  const max = Math.max(cationTotal, anionMeasured);
  const plot = H - TOP - BOTTOM;
  const scale = (v: number) => H - BOTTOM - (v / max) * plot;

  const cations = stack(r.cations, 'cation', 0, scale);
  const strong = stack(r.strongAnions, 'strong', 0, scale);
  const strongTop = sum(r.strongAnions);
  const buffer = stack(r.bufferBase, 'buffer', strongTop, scale);
  const sig = r.sig > 0 ? stack([{ key: 'sig', label: 'SIG', value: r.sig }], 'sig', anionMeasured, scale) : [];
  const anions = [...strong, ...buffer, ...sig];

  const labels = (segs: Placed[]) => {
    const mids = segs.map(s => (s.y0 + s.y1) / 2);
    return spread(mids);
  };
  const catLabelY = labels(cations);
  const anLabelY = labels(anions);

  const bracket = (x: number, from: number, to: number, text: string, value: number) => {
    const y0 = scale(from);
    const y1 = scale(to);
    return (
      <g className="bracket">
        <path d={`M${x} ${y0}h6V${y1}h-6`} fill="none" />
        <text x={x + 12} y={(y0 + y1) / 2} dominantBaseline="middle">
          {text} {fmt(value)}
        </text>
      </g>
    );
  };

  const summary = `Katjoner ${fmt(cationTotal)} mEq/L, starka anjoner ${fmt(strongTop)}, buffertbas (SIDe) ${fmt(r.side)}, SIG ${fmt(r.sig)}.`;

  return (
    <figure className="gamblegram">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={titleId}>
        <title id={titleId}>Gamblegram. {summary}</title>
        <defs>
          <pattern id="sig-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" className="hatch" />
          </pattern>
        </defs>

        {cations.map((s, i) => (
          <g key={s.key}>
            <Bar x={CAT_X} s={s} />
            <line className="leader" x1={CAT_X - 4} x2={CAT_X - 10} y1={(s.y0 + s.y1) / 2} y2={catLabelY[i]} />
            <text x={CAT_X - 14} y={catLabelY[i]} textAnchor="end" dominantBaseline="middle">
              {s.label} {fmt(s.value)}
            </text>
          </g>
        ))}
        {anions.map((s, i) => (
          <g key={s.key}>
            <Bar x={AN_X} s={s} />
            <line className="leader" x1={AN_X + BAR_W + 4} x2={AN_X + BAR_W + 10} y1={(s.y0 + s.y1) / 2} y2={anLabelY[i]} />
            <text x={AN_X + BAR_W + 14} y={anLabelY[i]} dominantBaseline="middle">
              {s.label} {fmt(s.value)}
            </text>
          </g>
        ))}

        {bracket(440, strongTop, anionMeasured, 'SIDe', r.side)}
        {bracket(520, strongTop, cationTotal, 'SIDa', r.sida)}

        <text x={CAT_X + BAR_W / 2} y={H - 6} textAnchor="middle" className="axis">
          Katjoner
        </text>
        <text x={AN_X + BAR_W / 2} y={H - 6} textAnchor="middle" className="axis">
          Anjoner
        </text>
      </svg>
      <figcaption>
        <span className="key" data-group="cation">Starka katjoner</span>{' '}
        <span className="key" data-group="strong">Starka anjoner</span>{' '}
        <span className="key" data-group="buffer">Buffertbas (SIDe)</span>{' '}
        <span className="key" data-group="sig">SIG (omätta anjoner)</span>
      </figcaption>
    </figure>
  );
}

function Bar({ x, s }: { x: number; s: Placed }) {
  // 1 px inset top and bottom: a 2 px gap between stacked segments.
  const y = Math.min(s.y0, s.y1) + 1;
  const h = Math.max(0, Math.abs(s.y0 - s.y1) - 2);
  return (
    <rect x={x} y={y} width={BAR_W} height={h} className="segment" data-group={s.group}>
      <title>
        {s.label}: {fmt(s.value)} mEq/L
      </title>
    </rect>
  );
}
