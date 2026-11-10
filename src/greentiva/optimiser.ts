import { chooseSyringes } from './impact';
import type { Policy, Product, SyringeSize } from './types';

/**
 * Preparation optimiser. Exhaustive search over small container combinations.
 *
 * Hard constraints (an option that breaks one is dropped, never just scored):
 *  - Every container is single-use and belongs to one patient: nothing is
 *    pooled, shared, reused or prepared ahead of the case.
 *  - All containers for one drug in one case share ONE concentration (one
 *    pump syringe cannot mix concentrations).
 *  - Prepared + contingency capacity covers (upper estimate + priming) plus
 *    the reserve.
 *  - Upper-estimate plan time fits inside the shortest in-use limit of every
 *    product used.
 *  - A further container is only assumed if the department allowed it, and
 *    only in at most `maxShortfallShare` of the duration scenarios.
 *
 * Then rank by expected discarded drug, plastic grams, cost, containers.
 * It never chooses technique, targets or infusion rates.
 */

const EPS = 1e-9;

export interface OptimiseInput {
  /** Enabled products for ONE drug. */
  products: Product[];
  /** Drug needed in each duration scenario, excluding priming and reserve. */
  scenarioNeeds: number[];
  /** Plan time in hours at the upper scenario. */
  hoursHigh: number;
  policy: Policy;
  syringes: SyringeSize[];
}

export interface Line {
  product: Product;
  count: number;
}

export interface Evaluated {
  prepared: Line[];
  /** Containers kept unopened and opened only if needed. */
  contingency: Line | null;
  concentration: number;
  preparedCapacity: number;
  preparedVolumeMl: number;
  /** Capacity the strategy must reach: (upper + priming) × (1 + reserve). */
  requiredCapacity: number;
  /** Mean discarded drug across scenarios. */
  expectedWaste: number;
  /** Discarded drug if the plan runs to the expected (middle) scenario. */
  wasteAtExpected: number;
  expectedWastePct: number;
  /** Share of scenarios in which the contingency container is opened. */
  shortfallShare: number;
  containersAtExpected: number;
  syringesAtExpected: { ml: number; count: number } | null;
  /** Plastic grams of syringes at the expected scenario; null if not configured. */
  plasticG: number | null;
  cost: number | null;
  shortestInUseH: number;
}

export interface OptimiseResult {
  ranked: Evaluated[];
  feasibleCount: number;
  /** Why nothing was feasible, when `ranked` is empty. */
  reason: string | null;
}

function* vectors(n: number, maxEach: number, maxTotal: number): Generator<number[]> {
  const cur = new Array<number>(n).fill(0);
  function* rec(i: number, left: number): Generator<number[]> {
    if (i === n) {
      yield cur.slice();
      return;
    }
    for (let c = 0; c <= Math.min(maxEach, left); c++) {
      cur[i] = c;
      yield* rec(i + 1, left - c);
    }
    cur[i] = 0;
  }
  yield* rec(0, maxTotal);
}

export function optimise(input: OptimiseInput): OptimiseResult {
  const { policy, scenarioNeeds } = input;
  const products = input.products.filter(p => p.enabled && p.capacity > 0 && p.concentration > 0);
  if (products.length === 0) return { ranked: [], feasibleCount: 0, reason: 'No enabled products for this drug.' };
  if (scenarioNeeds.length === 0) return { ranked: [], feasibleCount: 0, reason: 'No scenarios.' };

  const highNeed = Math.max(...scenarioNeeds);
  const midIndex = scenarioNeeds.length > 1 ? scenarioNeeds.findIndex((_, i) => policy.scales[i] === 1) : 0;
  const expectedIdx = midIndex >= 0 ? midIndex : 0;

  const groups = new Map<number, Product[]>();
  for (const p of products) {
    const key = Math.round(p.concentration * 1e6) / 1e6;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }

  const results: Evaluated[] = [];
  let inUseBlocked = 0;
  let capacityBlocked = 0;

  for (const [conc, ps] of groups) {
    const primingDrug = policy.primingMl * conc;
    const requiredCapacity = (highNeed + primingDrug) * (1 + policy.reservePct / 100);
    const maxEach = Math.min(policy.maxContainers, 6);

    for (const counts of vectors(ps.length, maxEach, policy.maxContainers)) {
      const total = counts.reduce((a, b) => a + b, 0);
      if (total === 0) continue;
      const prepared: Line[] = ps.flatMap((p, i) => ((counts[i] ?? 0) > 0 ? [{ product: p, count: counts[i] ?? 0 }] : []));
      const preparedCapacity = prepared.reduce((a, l) => a + l.product.capacity * l.count, 0);

      const contOptions: (Line | null)[] = [null];
      if (policy.allowContingency) {
        for (const p of ps) for (let m = 1; m <= 3; m++) contOptions.push({ product: p, count: m });
      }

      for (const contingency of contOptions) {
        if (total + (contingency?.count ?? 0) > policy.maxContainers + 3) continue;
        const contCap = contingency ? contingency.product.capacity * contingency.count : 0;
        if (preparedCapacity + contCap + EPS < requiredCapacity) {
          capacityBlocked++;
          continue;
        }
        const used = [...prepared.map(l => l.product), ...(contingency ? [contingency.product] : [])];
        const shortestInUseH = Math.min(...used.map(p => Math.min(p.inUseLimitH, p.labelInUseLimitH)));
        if (input.hoursHigh > shortestInUseH + EPS) {
          inUseBlocked++;
          continue;
        }

        // Evaluate every duration scenario with the sequential-opening policy.
        let wasteSum = 0;
        let shortfalls = 0;
        let ok = true;
        let wasteAtExpected = 0;
        let extraAtExpected = 0;
        const needs = scenarioNeeds.map(n => n + primingDrug);
        needs.forEach((need, i) => {
          let extra = 0;
          if (need > preparedCapacity + EPS) {
            if (!contingency) ok = false;
            else extra = Math.ceil((need - preparedCapacity) / contingency.product.capacity - EPS);
          }
          if (contingency && extra > contingency.count) ok = false;
          const opened = preparedCapacity + (contingency ? extra * contingency.product.capacity : 0);
          const waste = opened - need;
          if (waste < -EPS) ok = false;
          wasteSum += Math.max(0, waste);
          if (extra > 0) shortfalls++;
          if (i === expectedIdx) {
            wasteAtExpected = Math.max(0, waste);
            extraAtExpected = extra;
          }
        });
        if (!ok) continue;
        const shortfallShare = shortfalls / needs.length;
        if (contingency && shortfallShare > policy.maxShortfallShare + EPS) continue;

        const preparedVolumeMl = preparedCapacity / conc;
        const syr = chooseSyringes(preparedVolumeMl, input.syringes);
        const extraSyr =
          extraAtExpected > 0 && contingency
            ? chooseSyringes((extraAtExpected * contingency.product.capacity) / conc, input.syringes)
            : null;
        const syringeCount = (syr?.count ?? 0) + (extraSyr?.count ?? 0);
        const anyMissingMass = (syr && syr.massG === null) || (extraSyr && extraSyr.massG === null);
        const plasticG =
          input.syringes.length === 0 || anyMissingMass ? null : (syr?.massG ?? 0) + (extraSyr?.massG ?? 0);

        let cost: number | null = 0;
        for (const l of prepared) cost = cost === null || l.product.costPerContainer === null ? null : cost + l.product.costPerContainer * l.count;
        if (cost !== null && contingency && extraAtExpected > 0) {
          cost = contingency.product.costPerContainer === null ? null : cost + contingency.product.costPerContainer * extraAtExpected;
        }

        const expectedWaste = wasteSum / needs.length;
        const meanOpened = expectedWaste + needs.reduce((a, b) => a + b, 0) / needs.length;
        results.push({
          prepared,
          contingency,
          concentration: conc,
          preparedCapacity,
          preparedVolumeMl,
          requiredCapacity,
          expectedWaste,
          wasteAtExpected,
          expectedWastePct: meanOpened > 0 ? (expectedWaste / meanOpened) * 100 : 0,
          shortfallShare,
          containersAtExpected: total + extraAtExpected,
          syringesAtExpected: syr ? { ml: syr.ml, count: syringeCount } : null,
          plasticG,
          cost,
          shortestInUseH,
        });
      }
    }
  }

  const rel = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
  results.sort((a, b) => {
    if (!rel(a.expectedWaste, b.expectedWaste)) return a.expectedWaste - b.expectedWaste;
    const pa = a.plasticG ?? 0;
    const pb = b.plasticG ?? 0;
    if (!rel(pa, pb)) return pa - pb;
    const ca = a.cost ?? 0;
    const cb = b.cost ?? 0;
    if (!rel(ca, cb)) return ca - cb;
    if (a.shortfallShare !== b.shortfallShare) return a.shortfallShare - b.shortfallShare;
    return a.containersAtExpected - b.containersAtExpected;
  });

  let reason: string | null = null;
  if (results.length === 0) {
    if (inUseBlocked > 0 && capacityBlocked === 0) {
      reason = 'The upper-estimate plan time is longer than the in-use limit of the products. Nothing is recommended.';
    } else if (inUseBlocked > 0) {
      reason = 'No combination both covers the upper estimate with reserve and fits the in-use limit.';
    } else {
      reason = `No combination of up to ${policy.maxContainers} containers covers the upper estimate with reserve. Add a larger container or raise the container limit.`;
    }
  }
  return { ranked: results.slice(0, 8), feasibleCount: results.length, reason };
}

/** Plain-language reason for the top option, built from the numbers that decided it. */
export function explain(best: Evaluated, runnerUp: Evaluated | undefined, unit: string): string {
  const parts = [
    `Covers the upper estimate plus priming and a reserve (${Math.round(best.requiredCapacity)} ${unit} needed, ${Math.round(
      best.preparedCapacity + (best.contingency ? best.contingency.product.capacity * best.contingency.count : 0),
    )} ${unit} available).`,
    `Expected discard ${Math.round(best.expectedWaste)} ${unit} (${best.expectedWastePct.toFixed(0)}% of what is opened).`,
  ];
  if (best.contingency) {
    parts.push(
      `A further ${best.contingency.product.name} stays unopened and is opened only if the plan runs over (${Math.round(
        best.shortfallShare * 100,
      )}% of scenarios).`,
    );
  }
  if (runnerUp) {
    parts.push(`Next best discards about ${Math.round(runnerUp.expectedWaste)} ${unit}.`);
  }
  return parts.join(' ');
}
