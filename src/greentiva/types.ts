/**
 * GreenTIVA domain types. Engines in this folder are pure TypeScript: no
 * React, no DOM, no clock, no randomness. See docs/greentiva/ARCHITECTURE.md.
 *
 * Drug amounts are in the drug's own unit: propofol in mg, remifentanil in µg.
 */
export type Drug = 'propofol' | 'remifentanil';

export const DRUG_UNIT: Record<Drug, 'mg' | 'µg'> = {
  propofol: 'mg',
  remifentanil: 'µg',
};

/** Rate unit per drug. Mass-based only, so a rate never depends on which container is used. */
export const RATE_UNIT: Record<Drug, string> = {
  propofol: 'mg/kg/h',
  remifentanil: 'µg/kg/min',
};

/** One single-use container option (vial, or powder vial diluted to a fixed concentration). */
export interface Product {
  id: string;
  name: string;
  drug: Drug;
  /** Total drug in one container, in the drug's unit. */
  capacity: number;
  /** Drug per ml as it is drawn up or diluted for the pump. Volume = capacity / concentration. */
  concentration: number;
  /** Local in-use limit in hours. Never allowed above the label limit. */
  inUseLimitH: number;
  /** In-use limit from the product text, in hours. */
  labelInUseLimitH: number;
  costPerContainer: number | null;
  /** Where the presentation and limits came from. */
  source: string;
  enabled: boolean;
}

export interface SyringeSize {
  ml: number;
  /** Plastic mass in grams, entered by the department; null = not configured. */
  massG: number | null;
}

/** A disposable used once per anaesthetic whichever strategy is chosen (line, extension, tap...). */
export interface FixedItem {
  name: string;
  count: number;
  massG: number | null;
}

export interface Policy {
  /** Extra margin on top of the upper estimate plus priming, in percent. */
  reservePct: number;
  /** Drug held in the line and dead space, in ml. Zero until measured locally. */
  primingMl: number;
  /** Duration multipliers applied to phases that scale with procedure duration. */
  scales: number[];
  /** Allow opening a further container mid-case when the plan runs over. */
  allowContingency: boolean;
  /** Largest share of scenarios in which a further container may be needed (0-1). */
  maxShortfallShare: number;
  maxContainers: number;
}

export const MIN_RESERVE_PCT = 10;

export const DEFAULT_POLICY: Policy = {
  reservePct: 15,
  primingMl: 0,
  // Placeholder assumption, not data: replaced by recorded variability later.
  scales: [0.8, 0.9, 1.0, 1.1, 1.2, 1.3],
  allowContingency: false,
  maxShortfallShare: 0.5,
  maxContainers: 6,
};
