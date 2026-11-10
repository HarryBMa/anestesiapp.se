import { describe, expect, it } from 'vitest';
import { PRESET_PRODUCTS } from './catalogue';
import { drugPerMinute, totalDrug, totalHours, validatePatient, validatePlan, type DrugPlan } from './consumption';
import { chooseSyringes, fixedPlasticG } from './impact';
import { explain, optimise, type OptimiseInput } from './optimiser';
import { DEFAULT_POLICY, type Policy, type Product } from './types';

const propofol = PRESET_PRODUCTS.filter(p => p.drug === 'propofol');

// 70 kg, 100 min maintenance at 6 mg/kg/h -> 70 * 6 / 60 * 100 = 700 mg (hand calculation).
const plan: DrugPlan = {
  drug: 'propofol',
  bolusPerKg: 0,
  phases: [{ label: 'Maintenance', minutes: 100, rate: 6, scalesWithDuration: true }],
};

function input(policy: Partial<Policy> = {}, products: Product[] = propofol, hoursHigh = 2.2): OptimiseInput {
  const pol = { ...DEFAULT_POLICY, ...policy };
  return {
    products,
    scenarioNeeds: pol.scales.map(s => totalDrug(plan, 70, s)),
    hoursHigh,
    policy: pol,
    syringes: [
      { ml: 20, massG: 6 },
      { ml: 50, massG: 14 },
    ],
  };
}

describe('consumption', () => {
  it('integrates the entered rate over time (hand-checked)', () => {
    expect(drugPerMinute('propofol', 6, 70)).toBeCloseTo(7, 10);
    expect(totalDrug(plan, 70)).toBeCloseTo(700, 8);
    expect(totalDrug(plan, 70, 1.3)).toBeCloseTo(910, 8);
  });
  it('adds a bolus and only scales phases marked as scalable', () => {
    const p: DrugPlan = {
      drug: 'remifentanil',
      bolusPerKg: 1,
      phases: [
        { label: 'Maintenance', minutes: 60, rate: 0.2, scalesWithDuration: true },
        { label: 'Emergence', minutes: 10, rate: 0.05, scalesWithDuration: false },
      ],
    };
    // 70 kg: bolus 70 µg; 0.2*70*60 = 840; 0.05*70*10 = 35 -> 945. Scale 2: 70 + 1680 + 35 = 1785.
    expect(totalDrug(p, 70)).toBeCloseTo(945, 8);
    expect(totalDrug(p, 70, 2)).toBeCloseTo(1785, 8);
    expect(totalHours(p, 2)).toBeCloseTo((120 + 10) / 60, 10);
  });
  it('blocks children and empty plans', () => {
    expect(validatePatient({ ageYears: 17, weightKg: 60 }).length).toBeGreaterThan(0);
    expect(validatePatient({ ageYears: 40, weightKg: 0 }).length).toBeGreaterThan(0);
    expect(validatePatient({ ageYears: 40, weightKg: 70 })).toEqual([]);
    expect(validatePlan({ drug: 'propofol', bolusPerKg: 0, phases: [] }).length).toBeGreaterThan(0);
  });
});

describe('plastic', () => {
  it('picks fewest syringes, then least plastic', () => {
    expect(chooseSyringes(45, [{ ml: 20, massG: 6 }, { ml: 50, massG: 14 }])).toEqual({ ml: 50, count: 1, massG: 14 });
    // 60 ml: 2 x 50 ml beats 3 x 20 ml because fewer syringes come first.
    expect(chooseSyringes(60, [{ ml: 20, massG: 6 }, { ml: 50, massG: 14 }])).toEqual({ ml: 50, count: 2, massG: 28 });
    // Same count: the lighter syringe wins.
    expect(chooseSyringes(25, [{ ml: 50, massG: 14 }, { ml: 30, massG: 10 }])).toEqual({ ml: 30, count: 1, massG: 10 });
  });
  it('reports null instead of inventing masses', () => {
    expect(chooseSyringes(10, [{ ml: 20, massG: null }])?.massG).toBeNull();
    expect(fixedPlasticG([{ name: 'line', count: 1, massG: null }])).toBeNull();
    expect(fixedPlasticG([{ name: 'line', count: 2, massG: 5 }])).toBe(10);
  });
});

describe('optimiser safety invariants', () => {
  it('every recommended option covers the upper estimate with priming and reserve', () => {
    const inp = input({ primingMl: 5 });
    const res = optimise(inp);
    expect(res.ranked.length).toBeGreaterThan(0);
    for (const e of res.ranked) {
      const cap = e.preparedCapacity + (e.contingency ? e.contingency.product.capacity * e.contingency.count : 0);
      expect(cap).toBeGreaterThanOrEqual(e.requiredCapacity - 1e-6);
      expect(e.requiredCapacity).toBeGreaterThanOrEqual(910 + 5 * 20);
    }
  });

  it('known case: 3 x 20 ml wins without contingency, waste matches hand calculation', () => {
    // Required = (910 + 100) * 1.15 = 1161.5 mg. Options covering it: 3x20ml = 1200 mg is the least capacity.
    const res = optimise(input({ primingMl: 5 }));
    const best = res.ranked[0];
    expect(best?.preparedCapacity).toBe(1200);
    expect(best?.contingency).toBeNull();
    // Mean need over scales 0.8..1.3 = 700 * 1.05 = 735, plus 100 priming = 835 -> waste 365.
    expect(best?.expectedWaste).toBeCloseTo(365, 6);
  });

  it('a contingency container lowers expected waste but stays within the allowed share', () => {
    const base = optimise(input({ primingMl: 5 })).ranked[0];
    const cont = optimise(input({ primingMl: 5, allowContingency: true, maxShortfallShare: 0.5 })).ranked[0];
    expect(cont).toBeDefined();
    expect(cont!.expectedWaste).toBeLessThan(base!.expectedWaste);
    expect(cont!.shortfallShare).toBeLessThanOrEqual(0.5 + 1e-9);
    expect(cont!.contingency).not.toBeNull();
  });

  it('refuses everything if the plan outlasts the in-use limit', () => {
    const res = optimise(input({}, propofol, 12.5));
    expect(res.ranked).toEqual([]);
    expect(res.reason).toMatch(/in-use limit/);
  });

  it('uses the stricter of local and label limits', () => {
    const tooLong = propofol.map(p => ({ ...p, inUseLimitH: 24, labelInUseLimitH: 12 }));
    expect(optimise(input({}, tooLong, 13)).ranked).toEqual([]);
  });

  it('never mixes concentrations in one strategy', () => {
    const mixed: Product[] = [
      ...propofol,
      { ...propofol[0]!, id: 'p10', name: 'Propofol 10 mg/ml, 20 ml', capacity: 200, concentration: 10 },
    ];
    const res = optimise(input({ primingMl: 5 }, mixed));
    for (const e of res.ranked) {
      const concs = new Set([...e.prepared.map(l => l.product.concentration), ...(e.contingency ? [e.contingency.product.concentration] : [])]);
      expect(concs.size).toBe(1);
    }
  });

  it('reports a clear reason when the container limit is too small', () => {
    const res = optimise(input({ maxContainers: 1 }, [propofol[0]!]));
    expect(res.ranked).toEqual([]);
    expect(res.reason).toMatch(/container/);
  });

  it('ignores disabled products and explains the winner', () => {
    const only20 = propofol.map(p => ({ ...p, enabled: p.id === 'prop-20x20' }));
    const res = optimise(input({}, only20));
    expect(res.ranked.every(e => e.prepared.every(l => l.product.id === 'prop-20x20'))).toBe(true);
    const best = res.ranked[0]!;
    expect(explain(best, res.ranked[1], 'mg')).toMatch(/Expected discard/);
  });
});
