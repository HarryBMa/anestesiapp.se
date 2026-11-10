import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Tag } from '../../components/Tag';
import { PRESET_FIXED_ITEMS, PRESET_PRODUCTS, PRESET_SYRINGES } from '../../greentiva/catalogue';
import {
  totalDrug,
  totalHours,
  validatePatient,
  validatePlan,
  type DrugPlan,
  type Phase,
} from '../../greentiva/consumption';
import { fixedPlasticG } from '../../greentiva/impact';
import { explain, optimise, type Evaluated, type OptimiseResult } from '../../greentiva/optimiser';
import {
  DEFAULT_POLICY,
  DRUG_UNIT,
  MIN_RESERVE_PCT,
  RATE_UNIT,
  type Drug,
  type FixedItem,
  type Policy,
  type Product,
  type SyringeSize,
} from '../../greentiva/types';

export const Route = createFileRoute('/a/greentiva')({
  component: GreenTiva,
});

/**
 * GreenTIVA, phase 1: a planning and sustainability aid. It multiplies the
 * rates the clinician types in by weight and time, then compares ways of
 * preparing single-use containers. It has no pharmacokinetic or TCI model
 * and never suggests a dose, target or rate. Design and limits:
 * docs/greentiva/ARCHITECTURE.md.
 */

interface Config {
  products: Product[];
  syringes: SyringeSize[];
  fixed: FixedItem[];
  policy: Policy;
  confirmed: boolean;
}

interface PhaseInput {
  label: string;
  minutes: number | null;
  rate: number | null;
  scalesWithDuration: boolean;
}

interface DrugInput {
  include: boolean;
  bolusPerKg: number | null;
  phases: PhaseInput[];
}

const STORAGE_KEY = 'greentiva.config.v1';

const defaultConfig = (): Config => ({
  products: PRESET_PRODUCTS.map(p => ({ ...p })),
  syringes: PRESET_SYRINGES.map(s => ({ ...s })),
  fixed: PRESET_FIXED_ITEMS.map(f => ({ ...f })),
  policy: { ...DEFAULT_POLICY, scales: [...DEFAULT_POLICY.scales] },
  confirmed: false,
});

function loadConfig(): Config {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultConfig();
    const c = JSON.parse(raw) as Partial<Config>;
    const d = defaultConfig();
    if (!Array.isArray(c.products) || !Array.isArray(c.syringes) || !Array.isArray(c.fixed) || !c.policy) return d;
    return {
      products: c.products,
      syringes: c.syringes,
      fixed: c.fixed,
      policy: { ...d.policy, ...c.policy },
      confirmed: false, // must be re-confirmed in every session
    };
  } catch {
    return defaultConfig();
  }
}

const CATEGORIES = [
  'FESS',
  'Thyroidectomy',
  'Parotidectomy',
  'Tonsillectomy',
  'Free-flap reconstruction',
  'Major head and neck surgery',
  'General surgery',
  'Other',
];

const emptyDrug = (include: boolean): DrugInput => ({
  include,
  bolusPerKg: null,
  phases: [{ label: 'Maintenance', minutes: null, rate: null, scalesWithDuration: true }],
});

const fieldCls =
  'w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring';
const btnCls =
  'rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-card focus-visible:outline-2 focus-visible:outline-ring';

function NumField(props: {
  value: number | null;
  onChange: (v: number | null) => void;
  label: string;
  min?: number;
  max?: number;
  step?: number | 'any';
}) {
  return (
    <input
      type="number"
      inputMode="decimal"
      aria-label={props.label}
      className={fieldCls}
      min={props.min ?? 0}
      max={props.max}
      step={props.step ?? 'any'}
      value={props.value === null ? '' : props.value}
      onChange={e => props.onChange(e.target.value === '' ? null : Number(e.target.value))}
    />
  );
}

function Card({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return (
    <section className="mt-6 rounded-xl border border-border bg-card p-4 sm:p-5">
      <h2 className="font-wide text-xl font-bold tracking-tight">{title}</h2>
      {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

const fmt = (n: number, d = 0) => n.toLocaleString('en-GB', { maximumFractionDigits: d, minimumFractionDigits: d });

function GreenTiva() {
  const [config, setConfig] = useState<Config>(loadConfig);
  const [age, setAge] = useState<number | null>(null);
  const [weight, setWeight] = useState<number | null>(null);
  const [category, setCategory] = useState(CATEGORIES[0] ?? 'Other');
  const [inputs, setInputs] = useState<Record<Drug, DrugInput>>({
    propofol: emptyDrug(true),
    remifentanil: emptyDrug(true),
  });
  const [reviewed, setReviewed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...config, confirmed: false }));
    } catch {
      /* storage can be unavailable (private window); the tool still works */
    }
  }, [config]);

  const patientErrors = useMemo(
    () => (age === null || weight === null ? ['Enter age and weight.'] : validatePatient({ ageYears: age, weightKg: weight })),
    [age, weight],
  );

  const analysis = useMemo(() => {
    if (patientErrors.length > 0 || weight === null) return null;
    const out: Partial<Record<Drug, DrugAnalysis>> = {};
    for (const drug of ['propofol', 'remifentanil'] as Drug[]) {
      const inp = inputs[drug];
      if (!inp.include) continue;
      const phases: Phase[] = inp.phases.map(p => ({
        label: p.label,
        minutes: p.minutes ?? 0,
        rate: p.rate ?? 0,
        scalesWithDuration: p.scalesWithDuration,
      }));
      const plan: DrugPlan = { drug, bolusPerKg: inp.bolusPerKg ?? 0, phases };
      const errors = validatePlan(plan);
      if (errors.length > 0) {
        out[drug] = { plan, errors, needs: [], result: null };
        continue;
      }
      const needs = config.policy.scales.map(s => totalDrug(plan, weight, s));
      const hoursHigh = totalHours(plan, Math.max(...config.policy.scales));
      const result = optimise({
        products: config.products.filter(p => p.drug === drug),
        scenarioNeeds: needs,
        hoursHigh,
        policy: config.policy,
        syringes: config.syringes,
      });
      out[drug] = { plan, errors: [], needs, result, hoursHigh };
    }
    return out;
  }, [patientErrors, weight, inputs, config]);

  const setProduct = (id: string, patch: Partial<Product>) =>
    setConfig(c => ({
      ...c,
      confirmed: false,
      products: c.products.map(p => {
        if (p.id !== id) return p;
        const next = { ...p, ...patch };
        // A local limit may be stricter than the label, never longer.
        next.inUseLimitH = Math.min(next.inUseLimitH, next.labelInUseLimitH);
        return next;
      }),
    }));

  const fixedG = fixedPlasticG(config.fixed);

  const summary = () => {
    const lines = [`GreenTIVA planning estimate (${category}). Not a dose. Reviewed by clinician: ${reviewed ? 'yes' : 'no'}.`];
    for (const drug of ['propofol', 'remifentanil'] as Drug[]) {
      const a = analysis?.[drug];
      const best = a?.result?.ranked[0];
      if (!a || !best) continue;
      const u = DRUG_UNIT[drug];
      const prep = best.prepared.map(l => `${l.count} × ${l.product.name}`).join(' + ');
      lines.push(
        `${drug}: expected ${fmt(a.needs[a.needs.length > 1 ? (config.policy.scales.indexOf(1) >= 0 ? config.policy.scales.indexOf(1) : 0) : 0] ?? 0)} ${u}, prepare ${prep}` +
          (best.contingency ? `, keep ${best.contingency.count} × ${best.contingency.product.name} unopened` : '') +
          `, expected discard ${fmt(best.expectedWaste)} ${u}.`,
      );
    }
    return lines.join('\n');
  };

  return (
    <main className="mx-auto max-w-5xl px-4 pt-12 pb-24 sm:px-8">
      <Tag>Hållbar TIVA</Tag>
      <h1 className="mt-4 font-wide text-4xl font-extrabold tracking-tight sm:text-5xl">GreenTIVA</h1>
      <p className="mt-3 max-w-2xl text-lg text-muted-foreground">
        Plan how to prepare propofol and remifentanil so less is thrown away and less plastic is used.
      </p>

      <div role="note" className="mt-6 rounded-xl border border-border bg-card p-4 text-sm leading-relaxed">
        <p className="font-semibold">Planning estimate only, not a dose and not clinical advice.</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
          <li>
            It multiplies the rates <em>you</em> type in by weight and time. There is no pharmacokinetic or TCI model yet, and
            it never suggests a dose, target or rate.
          </li>
          <li>
            Every container is single-use and for one patient: no sharing, no re-use, no preparing in advance, no longer in-use
            time than the product allows. Follow product instructions and local policy.
          </li>
          <li>
            A clinician must review the result. Independent validation is required before clinical use.
          </li>
          <li>Nothing about the patient is stored. Only your formulary setup is kept in this browser.</li>
        </ul>
        <p className="mt-2">
          <a className="underline underline-offset-4" href="/a/greentiva-plan">
            Architecture and validation plan
          </a>
        </p>
      </div>

      <Card title="1. Case" hint="Adults only. Age and weight are not stored.">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">
            Age (years)
            <NumField label="Age in years" value={age} onChange={setAge} min={0} step={1} />
          </label>
          <label className="text-sm">
            Weight (kg)
            <NumField label="Weight in kilograms" value={weight} onChange={setWeight} min={0} />
          </label>
          <label className="text-sm">
            Procedure category
            <select className={fieldCls} value={category} onChange={e => setCategory(e.target.value)}>
              {CATEGORIES.map(c => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>
        {patientErrors.length > 0 && (age !== null || weight !== null) && (
          <ul className="mt-3 text-sm text-alert">
            {patientErrors.map(e => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
      </Card>

      {(['propofol', 'remifentanil'] as Drug[]).map(drug => (
        <PlanCard
          key={drug}
          drug={drug}
          value={inputs[drug]}
          onChange={v => setInputs(s => ({ ...s, [drug]: v }))}
        />
      ))}

      <Card
        title="3. Formulary and rules"
        hint="Presets are examples from product texts. Check every line against your own formulary."
      >
        <FormularyEditor config={config} setConfig={setConfig} setProduct={setProduct} />
      </Card>

      <Card title="4. Preparation comparison">
        {!config.confirmed && (
          <p className="text-sm text-warn">Confirm the formulary above to see results.</p>
        )}
        {config.confirmed && patientErrors.length > 0 && <p className="text-sm text-muted-foreground">Enter the case to see results.</p>}
        {config.confirmed && analysis && (
          <div className="space-y-8">
            {(['propofol', 'remifentanil'] as Drug[]).map(drug => {
              const a = analysis[drug];
              return a ? <DrugResult key={drug} drug={drug} a={a} policy={config.policy} /> : null;
            })}
            <p className="text-sm text-muted-foreground">
              Fixed disposables per anaesthetic (same for every option):{' '}
              {fixedG === null ? 'masses not configured' : `${fmt(fixedG, 1)} g plastic`}. Plastic is shown as weight only: no
              recyclability or carbon footprint is claimed, because no reliable lifecycle data is configured.
            </p>
            <div className="rounded-lg border border-border p-3">
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />
                <span>I have reviewed this preparation plan and it fits the clinical situation and local policy.</span>
              </label>
              <button
                className={`${btnCls} mt-3 disabled:opacity-40`}
                disabled={!reviewed}
                onClick={() => {
                  void navigator.clipboard?.writeText(summary()).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  });
                }}
              >
                {copied ? 'Copied' : 'Copy summary'}
              </button>
            </div>
          </div>
        )}
      </Card>
    </main>
  );
}

interface DrugAnalysis {
  plan: DrugPlan;
  errors: string[];
  needs: number[];
  result: OptimiseResult | null;
  hoursHigh?: number;
}

function PlanCard({ drug, value, onChange }: { drug: Drug; value: DrugInput; onChange: (v: DrugInput) => void }) {
  const unit = DRUG_UNIT[drug];
  const setPhase = (i: number, patch: Partial<PhaseInput>) =>
    onChange({ ...value, phases: value.phases.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  return (
    <Card
      title={`2. ${drug === 'propofol' ? 'Propofol' : 'Remifentanil'} plan`}
      hint={`Enter YOUR intended plan. Rates in ${RATE_UNIT[drug]}. This tool does not propose any value.`}
    >
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={value.include} onChange={e => onChange({ ...value, include: e.target.checked })} />
        Include {drug}
      </label>
      {value.include && (
        <div className="mt-4 space-y-3">
          <label className="block max-w-xs text-sm">
            Bolus ({unit}/kg, optional)
            <NumField label={`${drug} bolus per kg`} value={value.bolusPerKg} onChange={v => onChange({ ...value, bolusPerKg: v })} />
          </label>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="pb-1 pr-2 font-medium">Phase</th>
                  <th className="pb-1 pr-2 font-medium">Minutes</th>
                  <th className="pb-1 pr-2 font-medium">Rate ({RATE_UNIT[drug]})</th>
                  <th className="pb-1 pr-2 font-medium">Scales with duration</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {value.phases.map((p, i) => (
                  <tr key={i}>
                    <td className="pr-2 pb-2">
                      <input className={fieldCls} aria-label="Phase name" value={p.label} onChange={e => setPhase(i, { label: e.target.value })} />
                    </td>
                    <td className="pr-2 pb-2">
                      <NumField label="Minutes" value={p.minutes} onChange={v => setPhase(i, { minutes: v })} />
                    </td>
                    <td className="pr-2 pb-2">
                      <NumField label="Rate" value={p.rate} onChange={v => setPhase(i, { rate: v })} />
                    </td>
                    <td className="pr-2 pb-2">
                      <input type="checkbox" aria-label="Scales with duration" checked={p.scalesWithDuration} onChange={e => setPhase(i, { scalesWithDuration: e.target.checked })} />
                    </td>
                    <td className="pb-2">
                      <button className={btnCls} aria-label="Remove phase" onClick={() => onChange({ ...value, phases: value.phases.filter((_, j) => j !== i) })}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            className={btnCls}
            onClick={() => onChange({ ...value, phases: [...value.phases, { label: '', minutes: null, rate: null, scalesWithDuration: false }] })}
          >
            Add phase
          </button>
        </div>
      )}
    </Card>
  );
}

function FormularyEditor({
  config,
  setConfig,
  setProduct,
}: {
  config: Config;
  setConfig: (f: (c: Config) => Config) => void;
  setProduct: (id: string, patch: Partial<Product>) => void;
}) {
  const [scalesText, setScalesText] = useState(config.policy.scales.join(', '));
  const unset = (patch: Partial<Config>) => setConfig(c => ({ ...c, ...patch, confirmed: false }));
  const setPolicy = (patch: Partial<Policy>) => setConfig(c => ({ ...c, confirmed: false, policy: { ...c.policy, ...patch } }));

  const addProduct = (drug: Drug) =>
    unset({
      products: [
        ...config.products,
        {
          id: `custom-${Date.now()}`,
          name: drug === 'propofol' ? 'Propofol (custom)' : 'Remifentanil (custom)',
          drug,
          capacity: 0,
          concentration: drug === 'propofol' ? 20 : 50,
          inUseLimitH: 12,
          labelInUseLimitH: 12,
          costPerContainer: null,
          source: 'Entered by department',
          enabled: true,
        },
      ],
    });

  return (
    <div className="space-y-8">
      {(['propofol', 'remifentanil'] as Drug[]).map(drug => (
        <div key={drug}>
          <h3 className="font-semibold capitalize">{drug} containers</h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="pb-1 pr-2 font-medium">Use</th>
                  <th className="pb-1 pr-2 font-medium">Name</th>
                  <th className="pb-1 pr-2 font-medium">Content ({DRUG_UNIT[drug]})</th>
                  <th className="pb-1 pr-2 font-medium">{DRUG_UNIT[drug]}/ml</th>
                  <th className="pb-1 pr-2 font-medium">Label limit (h)</th>
                  <th className="pb-1 pr-2 font-medium">Local limit (h)</th>
                  <th className="pb-1 pr-2 font-medium">Cost</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {config.products
                  .filter(p => p.drug === drug)
                  .map(p => (
                    <tr key={p.id} title={p.source}>
                      <td className="pr-2 pb-2">
                        <input type="checkbox" aria-label={`Use ${p.name}`} checked={p.enabled} onChange={e => setProduct(p.id, { enabled: e.target.checked })} />
                      </td>
                      <td className="pr-2 pb-2">
                        <input className={fieldCls} aria-label="Product name" value={p.name} onChange={e => setProduct(p.id, { name: e.target.value })} />
                      </td>
                      <td className="pr-2 pb-2">
                        <NumField label="Content" value={p.capacity} onChange={v => setProduct(p.id, { capacity: v ?? 0 })} />
                      </td>
                      <td className="pr-2 pb-2">
                        <NumField label="Concentration" value={p.concentration} onChange={v => setProduct(p.id, { concentration: v ?? 0 })} />
                      </td>
                      <td className="pr-2 pb-2">
                        <NumField label="Label in-use limit" value={p.labelInUseLimitH} onChange={v => setProduct(p.id, { labelInUseLimitH: v ?? 0 })} />
                      </td>
                      <td className="pr-2 pb-2">
                        <NumField label="Local in-use limit (cannot exceed label)" value={p.inUseLimitH} max={p.labelInUseLimitH} onChange={v => setProduct(p.id, { inUseLimitH: v ?? 0 })} />
                      </td>
                      <td className="pr-2 pb-2">
                        <NumField label="Cost per container" value={p.costPerContainer} onChange={v => setProduct(p.id, { costPerContainer: v })} />
                      </td>
                      <td className="pb-2">
                        <button className={btnCls} aria-label={`Remove ${p.name}`} onClick={() => unset({ products: config.products.filter(x => x.id !== p.id) })}>
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <button className={`${btnCls} mt-1`} onClick={() => addProduct(drug)}>
            Add {drug} container
          </button>
        </div>
      ))}

      <div>
        <h3 className="font-semibold">Syringes (plastic grams, weigh them)</h3>
        <div className="mt-2 space-y-2">
          {config.syringes.map((s, i) => (
            <div key={i} className="grid max-w-md grid-cols-[1fr_1fr_auto] gap-2">
              <NumField label="Syringe size in ml" value={s.ml} onChange={v => unset({ syringes: config.syringes.map((x, j) => (j === i ? { ...x, ml: v ?? 0 } : x)) })} />
              <NumField label="Syringe plastic grams" value={s.massG} onChange={v => unset({ syringes: config.syringes.map((x, j) => (j === i ? { ...x, massG: v } : x)) })} />
              <button className={btnCls} aria-label="Remove syringe" onClick={() => unset({ syringes: config.syringes.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">Columns: size (ml), plastic mass (g). Leave mass empty if not measured.</p>
          <button className={btnCls} onClick={() => unset({ syringes: [...config.syringes, { ml: 0, massG: null }] })}>Add syringe size</button>
        </div>
      </div>

      <div>
        <h3 className="font-semibold">Other disposables per anaesthetic</h3>
        <div className="mt-2 space-y-2">
          {config.fixed.map((f, i) => (
            <div key={i} className="grid max-w-xl grid-cols-[2fr_1fr_1fr_auto] gap-2">
              <input className={fieldCls} aria-label="Item name" value={f.name} onChange={e => unset({ fixed: config.fixed.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              <NumField label="Count" value={f.count} step={1} onChange={v => unset({ fixed: config.fixed.map((x, j) => (j === i ? { ...x, count: v ?? 0 } : x)) })} />
              <NumField label="Plastic grams each" value={f.massG} onChange={v => unset({ fixed: config.fixed.map((x, j) => (j === i ? { ...x, massG: v } : x)) })} />
              <button className={btnCls} aria-label="Remove item" onClick={() => unset({ fixed: config.fixed.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">Columns: item, count, plastic mass each (g).</p>
          <button className={btnCls} onClick={() => unset({ fixed: [...config.fixed, { name: '', count: 1, massG: null }] })}>Add item</button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          Reserve on top of upper estimate (%), minimum {MIN_RESERVE_PCT}
          <NumField label="Reserve percent" value={config.policy.reservePct} min={MIN_RESERVE_PCT} onChange={v => setPolicy({ reservePct: Math.max(MIN_RESERVE_PCT, v ?? MIN_RESERVE_PCT) })} />
        </label>
        <label className="text-sm">
          Priming and dead space (ml)
          <NumField label="Priming ml" value={config.policy.primingMl} onChange={v => setPolicy({ primingMl: v ?? 0 })} />
        </label>
        <label className="text-sm">
          Largest container count
          <NumField label="Maximum containers" value={config.policy.maxContainers} step={1} min={1} max={10} onChange={v => setPolicy({ maxContainers: Math.min(10, Math.max(1, Math.round(v ?? 1))) })} />
        </label>
        <label className="text-sm sm:col-span-3">
          Duration scenarios (multipliers, must include 1). Placeholder assumption, not measured data.
          <input
            className={fieldCls}
            value={scalesText}
            onChange={e => setScalesText(e.target.value)}
            onBlur={() => {
              const nums = scalesText.split(/[,\s]+/).map(Number).filter(n => Number.isFinite(n) && n > 0);
              if (nums.length > 0 && nums.includes(1)) setPolicy({ scales: nums });
              else setScalesText(config.policy.scales.join(', '));
            }}
          />
        </label>
        <label className="flex items-start gap-2 text-sm sm:col-span-3">
          <input type="checkbox" className="mt-1" checked={config.policy.allowContingency} onChange={e => setPolicy({ allowContingency: e.target.checked })} />
          <span>
            Allow keeping a further container unopened and opening it only if needed (stock must be at hand in the theatre).
          </span>
        </label>
        {config.policy.allowContingency && (
          <label className="text-sm">
            Largest share of scenarios needing it (%)
            <NumField label="Maximum shortfall percent" value={Math.round(config.policy.maxShortfallShare * 100)} max={100} step={5} onChange={v => setPolicy({ maxShortfallShare: Math.min(1, Math.max(0, (v ?? 0) / 100)) })} />
          </label>
        )}
      </div>

      <label className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm">
        <input type="checkbox" className="mt-1" checked={config.confirmed} onChange={e => setConfig(c => ({ ...c, confirmed: e.target.checked }))} />
        <span>
          I have checked these products, in-use limits and rules against our formulary and local policy. (Asked again each visit.)
        </span>
      </label>
    </div>
  );
}

function DrugResult({ drug, a, policy }: { drug: Drug; a: DrugAnalysis; policy: Policy }) {
  const u = DRUG_UNIT[drug];
  const title = drug === 'propofol' ? 'Propofol' : 'Remifentanil';
  if (a.errors.length > 0) {
    return (
      <div>
        <h3 className="text-lg font-bold">{title}</h3>
        <ul className="mt-2 text-sm text-alert">
          {a.errors.map(e => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      </div>
    );
  }
  const midIdx = Math.max(0, policy.scales.indexOf(1));
  const low = Math.min(...a.needs);
  const high = Math.max(...a.needs);
  const mid = a.needs[midIdx] ?? 0;
  const res = a.result;
  const best = res?.ranked[0];
  return (
    <div>
      <h3 className="text-lg font-bold">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Estimated need from your plan: lower {fmt(low)} {u}, expected {fmt(mid)} {u}, upper {fmt(high)} {u}. This is an estimate of
        quantity to prepare, not an administered dose.
      </p>
      {!res || res.ranked.length === 0 ? (
        <p className="mt-3 rounded-lg border border-border p-3 text-sm text-alert">
          No preparation is recommended. {res?.reason}
        </p>
      ) : (
        <>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[44rem] text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="pb-1 pr-3 font-medium">Option</th>
                  <th className="pb-1 pr-3 font-medium">Prepare</th>
                  <th className="pb-1 pr-3 font-medium">Keep unopened</th>
                  <th className="pb-1 pr-3 font-medium">Expected discard ({u})</th>
                  <th className="pb-1 pr-3 font-medium">Containers at expected</th>
                  <th className="pb-1 pr-3 font-medium">Syringes</th>
                  <th className="pb-1 pr-3 font-medium">Syringe plastic (g)</th>
                </tr>
              </thead>
              <tbody>
                {res.ranked.slice(0, 5).map((e, i) => (
                  <Row key={i} e={e} rank={i + 1} u={u} />
                ))}
              </tbody>
            </table>
          </div>
          {best && (
            <p className="mt-3 rounded-lg border border-border p-3 text-sm">
              <strong>Why option 1:</strong> {explain(best, res.ranked[1], u)}{' '}
              <span className="text-muted-foreground">
                Shortest in-use limit {fmt(best.shortestInUseH, 1)} h; plan upper estimate {fmt(a.hoursHigh ?? 0, 1)} h. Prepare at
                time of use, one patient only.
              </span>
            </p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            {res.feasibleCount} acceptable combinations found; best 5 shown. Discard is averaged over your duration scenarios.
          </p>
        </>
      )}
    </div>
  );
}

function Row({ e, rank, u }: { e: Evaluated; rank: number; u: string }) {
  return (
    <tr className={rank === 1 ? 'bg-background font-medium' : ''}>
      <td className="py-1.5 pr-3 align-top">{rank === 1 ? '1 (for review)' : rank}</td>
      <td className="py-1.5 pr-3 align-top">{e.prepared.map(l => `${l.count} × ${l.product.name}`).join(' + ')}</td>
      <td className="py-1.5 pr-3 align-top">{e.contingency ? `${e.contingency.count} × ${e.contingency.product.name}` : 'none'}</td>
      <td className="py-1.5 pr-3 align-top">
        {fmt(e.expectedWaste)} {u} ({e.expectedWastePct.toFixed(0)}%)
      </td>
      <td className="py-1.5 pr-3 align-top">{e.containersAtExpected}</td>
      <td className="py-1.5 pr-3 align-top">{e.syringesAtExpected ? `${e.syringesAtExpected.count} × ${e.syringesAtExpected.ml} ml` : 'not set'}</td>
      <td className="py-1.5 pr-3 align-top">{e.plasticG === null ? 'not set' : fmt(e.plasticG, 1)}</td>
    </tr>
  );
}
