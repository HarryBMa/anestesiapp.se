import type { Product, SyringeSize, FixedItem } from './types';

/**
 * EXAMPLE presentations taken from Läkemedelsverket SmPC text (see
 * docs/greentiva/ARCHITECTURE.md, section 2.4). They are a starting point
 * only: a department must check them against its own formulary and confirm
 * them in the app before any result is shown. Masses are deliberately empty.
 */
const PROPOFOL_SRC = 'Propolipid 20 mg/ml SmPC (Läkemedelsverket): vials 20, 50, 100 ml; max 12 h per infusion system';
const REMI_SRC = 'Ultiva SmPC (Läkemedelsverket): 1, 2, 5 mg vials; TCI 20-50 µg/ml; use immediately or within 12 h at ≤ 25 °C';

export const PRESET_PRODUCTS: Product[] = [
  { id: 'prop-20x20', name: 'Propofol 20 mg/ml, 20 ml vial', drug: 'propofol', capacity: 400, concentration: 20, inUseLimitH: 12, labelInUseLimitH: 12, costPerContainer: null, source: PROPOFOL_SRC, enabled: true },
  { id: 'prop-20x50', name: 'Propofol 20 mg/ml, 50 ml vial', drug: 'propofol', capacity: 1000, concentration: 20, inUseLimitH: 12, labelInUseLimitH: 12, costPerContainer: null, source: PROPOFOL_SRC, enabled: true },
  { id: 'prop-20x100', name: 'Propofol 20 mg/ml, 100 ml vial', drug: 'propofol', capacity: 2000, concentration: 20, inUseLimitH: 12, labelInUseLimitH: 12, costPerContainer: null, source: PROPOFOL_SRC, enabled: true },
  { id: 'remi-1', name: 'Remifentanil 1 mg vial (to 50 µg/ml)', drug: 'remifentanil', capacity: 1000, concentration: 50, inUseLimitH: 12, labelInUseLimitH: 12, costPerContainer: null, source: REMI_SRC, enabled: true },
  { id: 'remi-2', name: 'Remifentanil 2 mg vial (to 50 µg/ml)', drug: 'remifentanil', capacity: 2000, concentration: 50, inUseLimitH: 12, labelInUseLimitH: 12, costPerContainer: null, source: REMI_SRC, enabled: true },
  { id: 'remi-5', name: 'Remifentanil 5 mg vial (to 50 µg/ml)', drug: 'remifentanil', capacity: 5000, concentration: 50, inUseLimitH: 12, labelInUseLimitH: 12, costPerContainer: null, source: REMI_SRC, enabled: true },
];

export const PRESET_SYRINGES: SyringeSize[] = [
  { ml: 20, massG: null },
  { ml: 50, massG: null },
];

export const PRESET_FIXED_ITEMS: FixedItem[] = [
  { name: 'Infusion line', count: 1, massG: null },
  { name: 'Extension', count: 1, massG: null },
  { name: 'Three-way tap', count: 1, massG: null },
  { name: 'Syringe cap', count: 1, massG: null },
];
