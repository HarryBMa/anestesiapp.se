import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useId, useMemo, useState } from 'react';
import { Tag } from '../components/Tag';
import {
  type AbgInput,
  type Finding,
  fromMmhg,
  interpretAbg,
  type PressureUnit,
  toMmhg,
} from '../lib/abg';

export const Route = createFileRoute('/blodgas')({
  component: BloodGas,
});

type Field =
  | 'ph'
  | 'pco2'
  | 'hco3'
  | 'be'
  | 'na'
  | 'cl'
  | 'albumin'
  | 'lactate'
  | 'po2'
  | 'fio2'
  | 'age';

type Form = Record<Field, string>;

const EMPTY: Form = {
  ph: '',
  pco2: '',
  hco3: '',
  be: '',
  na: '',
  cl: '',
  albumin: '',
  lactate: '',
  po2: '',
  fio2: '',
  age: '',
};

/** Plausible limits; values outside are almost certainly typos. */
const LIMITS: Record<Field, { min: number; max: number } | ((u: PressureUnit) => { min: number; max: number })> = {
  ph: { min: 6.5, max: 8 },
  pco2: u => (u === 'kPa' ? { min: 1, max: 30 } : { min: 7, max: 225 }),
  hco3: { min: 1, max: 60 },
  be: { min: -40, max: 40 },
  na: { min: 90, max: 200 },
  cl: { min: 50, max: 160 },
  albumin: { min: 5, max: 70 },
  lactate: { min: 0, max: 40 },
  po2: u => (u === 'kPa' ? { min: 1, max: 90 } : { min: 7, max: 700 }),
  fio2: { min: 21, max: 100 },
  age: { min: 0, max: 120 },
};

/** Worked examples (kPa), so the tool can be explored without a patient. */
const EXAMPLES: { label: string; values: Partial<Form> }[] = [
  {
    label: 'Ketoacidos',
    values: { ph: '7,12', pco2: '2,7', hco3: '6,5', be: '-21', na: '134', cl: '98', albumin: '38', lactate: '2,4' },
  },
  {
    label: 'KOL-skov',
    values: { ph: '7,28', pco2: '9,3', hco3: '32', be: '6', po2: '7,2', fio2: '28', age: '72' },
  },
  {
    label: 'Septisk chock',
    values: { ph: '7,31', pco2: '4,9', hco3: '18', be: '-7', na: '138', cl: '108', albumin: '22', lactate: '5,1', po2: '9,8', fio2: '50', age: '64' },
  },
];

function parse(value: string): number | undefined {
  const trimmed = value.trim().replace(',', '.').replace('−', '-');
  if (trimmed === '' || trimmed === '-') {
    return undefined;
  }
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

function limitsFor(field: Field, unit: PressureUnit) {
  const l = LIMITS[field];
  return typeof l === 'function' ? l(unit) : l;
}

function inRange(field: Field, n: number | undefined, unit: PressureUnit) {
  if (n === undefined) {
    return false;
  }
  const { min, max } = limitsFor(field, unit);
  return n >= min && n <= max;
}

function BloodGas() {
  const [unit, setUnit] = useState<PressureUnit>('kPa');
  const [form, setForm] = useState<Form>(EMPTY);

  useEffect(() => {
    document.title = 'Blodgas – AnestesiApp';
  }, []);

  const set = (field: Field) => (value: string) =>
    setForm(f => ({ ...f, [field]: value }));

  // Switching unit converts what's already typed rather than reinterpreting it.
  const switchUnit = (next: PressureUnit) => {
    if (next === unit) {
      return;
    }
    const convert = (v: string) => {
      const n = parse(v);
      if (n === undefined) {
        return v;
      }
      const converted = fromMmhg(toMmhg(n, unit), next);
      return (next === 'kPa' ? converted.toFixed(1) : converted.toFixed(0)).replace('.', ',');
    };
    setForm(f => ({ ...f, pco2: convert(f.pco2), po2: convert(f.po2) }));
    setUnit(next);
  };

  const result = useMemo(() => {
    const n = (field: Field) => {
      const v = parse(form[field]);
      return inRange(field, v, unit) ? v : undefined;
    };
    const ph = n('ph');
    const pco2 = n('pco2');
    const hco3 = n('hco3');
    if (ph === undefined || pco2 === undefined || hco3 === undefined) {
      return null;
    }
    const fio2 = n('fio2');
    const input: AbgInput = {
      unit,
      ph,
      pco2,
      hco3,
      be: n('be'),
      na: n('na'),
      cl: n('cl'),
      albumin: n('albumin'),
      lactate: n('lactate'),
      po2: n('po2'),
      fio2: fio2 === undefined ? undefined : fio2 / 100,
      age: n('age'),
    };
    return interpretAbg(input);
  }, [form, unit]);

  const fieldProps = (field: Field) => ({
    value: form[field],
    onChange: set(field),
    error:
      form[field].trim() !== '' && !inRange(field, parse(form[field]), unit)
        ? `${limitsFor(field, unit).min}–${limitsFor(field, unit).max}`
        : undefined,
  });

  return (
    <main className="mx-auto max-w-5xl px-4 pt-12 pb-24 sm:px-8">
      <Tag>Beslutsstöd</Tag>
      <h1 className="mt-4 font-wide text-4xl font-extrabold tracking-tight sm:text-5xl">
        Blodgas
      </h1>

      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
        <fieldset className="flex rounded-lg border border-border p-1">
          <legend className="sr-only">Tryckenhet</legend>
          {(['kPa', 'mmHg'] as const).map(u => (
            <label
              key={u}
              className={`flex min-h-11 min-w-16 cursor-pointer items-center justify-center rounded-md px-3 font-mono text-sm transition-colors duration-150 has-focus-visible:outline-2 has-focus-visible:outline-ring ${unit === u ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
            >
              <input
                type="radio"
                name="unit"
                value={u}
                checked={unit === u}
                onChange={() => switchUnit(u)}
                className="sr-only"
              />
              {u}
            </label>
          ))}
        </fieldset>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Exempel:</span>
          {EXAMPLES.map(ex => (
            <button
              key={ex.label}
              type="button"
              onClick={() => {
                setUnit('kPa');
                setForm({ ...EMPTY, ...ex.values });
              }}
              className="min-h-10 rounded-md px-3 underline decoration-border underline-offset-4 transition-colors duration-150 hover:decoration-foreground"
            >
              {ex.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setForm(EMPTY)}
            className="min-h-10 rounded-md px-3 text-muted-foreground hover:text-foreground"
          >
            Rensa
          </button>
        </div>
      </div>

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,26rem)_1fr]">
        <form onSubmit={e => e.preventDefault()} className="space-y-8">
          <Group title="Syra–bas" note="obligatoriskt">
            <NumberField label="pH" {...fieldProps('ph')} />
            <NumberField label="PaCO₂" unit={unit} {...fieldProps('pco2')} />
            <NumberField label="HCO₃⁻" unit="mmol/L" {...fieldProps('hco3')} />
            <NumberField label="BE" unit="mmol/L" {...fieldProps('be')} />
          </Group>
          <Group title="Elektrolyter" note="för anjongap">
            <NumberField label="Na⁺" unit="mmol/L" {...fieldProps('na')} />
            <NumberField label="Cl⁻" unit="mmol/L" {...fieldProps('cl')} />
            <NumberField label="Albumin" unit="g/L" {...fieldProps('albumin')} />
            <NumberField label="Laktat" unit="mmol/L" {...fieldProps('lactate')} />
          </Group>
          <Group title="Oxygenering">
            <NumberField label="PaO₂" unit={unit} {...fieldProps('po2')} />
            <NumberField label="FiO₂" unit="%" {...fieldProps('fio2')} />
            <NumberField label="Ålder" unit="år" {...fieldProps('age')} />
          </Group>
        </form>

        <section aria-live="polite" aria-label="Tolkning" className="lg:sticky lg:top-6 lg:self-start">
          {result ? (
            <Result result={result} />
          ) : (
            <div className="rounded-xl border border-dashed border-border p-6 text-muted-foreground">
              <p className="font-semibold text-foreground">Fyll i pH, PaCO₂ och HCO₃⁻.</p>
              <p className="mt-2 text-sm">
                Tolkningen uppdateras medan du skriver. Lägg till Na⁺, Cl⁻ och
                albumin för anjongap, och PaO₂ med FiO₂ för oxygenering. Eller
                prova ett exempel ovan.
              </p>
            </div>
          )}
        </section>
      </div>

      <p className="mt-16 max-w-2xl text-sm text-muted-foreground">
        Beslutsstöd för vuxna, arteriellt prov, havsnivå. Ersätter inte klinisk
        bedömning. Värdena lämnar aldrig din enhet.
      </p>
    </main>
  );
}

function Group({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="flex items-baseline gap-2">
        <span className="inline-block -rotate-1 font-narrow text-sm font-bold tracking-wide uppercase">
          {title}
        </span>
        {note && <span className="text-xs text-muted-foreground">{note}</span>}
      </legend>
      <div className="mt-3 grid grid-cols-2 gap-3">{children}</div>
    </fieldset>
  );
}

function NumberField(props: {
  label: string;
  unit?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div>
      <label htmlFor={id} className="text-sm font-semibold">
        {props.label}
      </label>
      <div
        className={`mt-1 flex items-center rounded-lg border bg-card focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring ${props.error ? 'border-alert' : 'border-border'}`}
      >
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          value={props.value}
          onChange={e => props.onChange(e.target.value)}
          aria-invalid={props.error ? true : undefined}
          aria-describedby={props.error ? errorId : undefined}
          className="h-12 w-full min-w-0 bg-transparent px-3 font-mono text-lg outline-none"
        />
        {props.unit && (
          <span className="pr-3 font-mono text-xs whitespace-nowrap text-muted-foreground">
            {props.unit}
          </span>
        )}
      </div>
      {props.error && (
        <p id={errorId} className="mt-1 text-xs text-alert">
          Rimligt: {props.error}
        </p>
      )}
    </div>
  );
}

const SEVERITY_STYLE: Record<Finding['severity'], { mark: string; label: string; color: string }> = {
  ok: { mark: '●', label: 'Normalt', color: 'text-ok' },
  info: { mark: '◆', label: 'Info', color: 'text-muted-foreground' },
  warn: { mark: '▲', label: 'Avvikande', color: 'text-warn' },
  alert: { mark: '■', label: 'Viktigt', color: 'text-alert' },
};

function Result({ result }: { result: ReturnType<typeof interpretAbg> }) {
  const v = result.values;
  const fmt = (n: number | undefined, d = 1) =>
    n === undefined ? undefined : n.toLocaleString('sv-SE', { maximumFractionDigits: d, minimumFractionDigits: d });

  const working: [string, string | undefined][] = [
    ['Beräknat pH (Henderson–Hasselbalch)', fmt(v.calculatedPh, 2)],
    ['Anjongap', fmt(v.anionGap)],
    ['Albuminkorrigerat anjongap', fmt(v.correctedAnionGap)],
    ['Deltakvot', fmt(v.deltaRatio, 2)],
    ['P/F (kPa)', fmt(v.pfRatioKpa)],
    ['P/F (mmHg)', fmt(v.pfRatioMmhg, 0)],
    ['A–a-gradient (mmHg)', fmt(v.aaGradientMmhg, 0)],
    ['Förväntad A–a för åldern (mmHg)', fmt(v.expectedAaMmhg, 0)],
  ];

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-[0_1px_0_var(--border)] sm:p-6">
      <p className="font-narrow text-xs font-bold tracking-wide text-muted-foreground uppercase">
        Sammanfattning
      </p>
      <p className="mt-1 font-wide text-2xl leading-tight font-bold tracking-tight">
        {result.summary}
      </p>

      <ol className="mt-6 space-y-4">
        {result.findings.map(f => {
          const s = SEVERITY_STYLE[f.severity];
          return (
            <li key={f.title} className="grid grid-cols-[1.25rem_1fr] gap-x-2">
              <span aria-hidden="true" className={`${s.color} text-sm leading-6`}>
                {s.mark}
              </span>
              <div>
                <p className="leading-6 font-semibold">
                  <span className="sr-only">{s.label}: </span>
                  {f.title}
                </p>
                {f.detail && <p className="mt-0.5 text-sm text-muted-foreground">{f.detail}</p>}
              </div>
            </li>
          );
        })}
      </ol>

      <details className="group mt-6 border-t border-border pt-4">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-semibold">
          <span aria-hidden="true" className="inline-block transition-transform duration-150 group-open:rotate-90">
            ›
          </span>
          Visa uträkningar
        </summary>
        <dl className="mt-2 divide-y divide-border text-sm">
          {working
            .filter((row): row is [string, string] => row[1] !== undefined)
            .map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4 py-2">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-mono">{value}</dd>
              </div>
            ))}
        </dl>
      </details>
    </div>
  );
}
