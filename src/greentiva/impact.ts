import type { FixedItem, SyringeSize } from './types';

export interface SyringeChoice {
  ml: number;
  count: number;
  /** Total plastic grams, or null if the chosen size has no mass configured. */
  massG: number | null;
}

/**
 * Cheapest way to hold `volumeMl` using ONE syringe size: fewest syringes,
 * then least plastic. Single-use: each syringe belongs to one patient.
 * Returns null when no sizes are configured or the volume is zero.
 */
export function chooseSyringes(volumeMl: number, sizes: SyringeSize[]): SyringeChoice | null {
  if (volumeMl <= 1e-9 || sizes.length === 0) return null;
  let best: SyringeChoice | null = null;
  for (const s of sizes) {
    if (!(s.ml > 0)) continue;
    const count = Math.ceil(volumeMl / s.ml - 1e-9);
    const massG = s.massG === null ? null : count * s.massG;
    const cand: SyringeChoice = { ml: s.ml, count, massG };
    if (
      best === null ||
      cand.count < best.count ||
      (cand.count === best.count && (cand.massG ?? 0) < (best.massG ?? 0))
    ) {
      best = cand;
    }
  }
  return best;
}

/** Plastic from fixed items. Null if any item with a count has no mass configured. */
export function fixedPlasticG(items: FixedItem[]): number | null {
  let total = 0;
  for (const it of items) {
    if (it.count <= 0) continue;
    if (it.massG === null) return null;
    total += it.count * it.massG;
  }
  return total;
}
