/**
 * Stewart (physicochemical) acid–base analysis.
 *
 * Stewart's idea: pH is not set by HCO3⁻, which is a dependent variable. It
 * is set by three independent ones:
 *
 *   1. PaCO2
 *   2. SID, the strong ion difference: fully dissociated cations minus
 *      fully dissociated anions (Na⁺ + K⁺ + Ca²⁺ + Mg²⁺ − Cl⁻ − lactate⁻)
 *   3. Atot, the total of weak acids: mainly albumin and phosphate
 *
 * Electroneutrality means the charge "left over" by the strong ions (SIDa,
 * apparent) must be carried by the buffer base: HCO3⁻ plus the negative
 * charge on albumin and phosphate (SIDe, effective). Whatever SIDa − SIDe
 * doesn't account for is the strong ion gap (SIG): anions nobody measured
 * (ketones, sulphate, toxic alcohols' metabolites, …).
 *
 * All charges are in mEq/L. Ca²⁺ and Mg²⁺ carry two charges each, so their
 * mmol/L values are doubled.
 *
 * References: Stewart 1983; Figge et al. 1992 (albumin and phosphate
 * charge); Kellum 2000 (SIG); Fencl et al. 2000 and Story et al. 2004
 * (base-excess partition).
 */

export interface StewartInput {
  ph: number;
  /** Plasma bicarbonate, mmol/L (actual, not standard). */
  hco3: number;
  na: number;
  k: number;
  cl: number;
  /** Ionised calcium, mmol/L. */
  ca?: number;
  /** Ionised magnesium, mmol/L. Not on the ABL90: optional. */
  mg?: number;
  lactate?: number;
  /** Albumin, g/L. Not on the ABL90: entered by hand. */
  albumin: number;
  /** Phosphate, mmol/L. Not on the ABL90: entered by hand. */
  phosphate?: number;
  /** Standard base excess, cBase(Ecf), mmol/L. Enables the BE partition. */
  be?: number;
}

export interface Segment {
  key: string;
  label: string;
  /** mEq/L */
  value: number;
}

export interface StewartResult {
  /** Apparent SID: strong cations − strong anions. */
  sida: number;
  /** Effective SID: HCO3⁻ + albumin⁻ + phosphate⁻ (the buffer base). */
  side: number;
  /** Strong ion gap: SIDa − SIDe. Positive = unmeasured anions. */
  sig: number;
  albuminCharge: number;
  phosphateCharge: number;
  /** Bars for the Gamblegram, bottom to top. */
  cations: Segment[];
  strongAnions: Segment[];
  bufferBase: Segment[];
  /** Fencl–Story partition of base excess, when BE is known. */
  bePartition?: BePartition;
}

export interface BePartition {
  /** Free water: Na⁺ away from 140 dilutes or concentrates everything. */
  sodium: number;
  /** Chloride, corrected for the free-water change. */
  chloride: number;
  /** Low albumin is alkalinising. */
  albumin: number;
  lactate: number;
  /** What's left: unmeasured anions (or cations, if positive). */
  unmeasured: number;
  total: number;
}

/**
 * Charge on albumin (Figge): in mEq/L per g/L, depends on pH because the
 * histidine residues titrate across the physiological range.
 */
export function albuminCharge(albuminGL: number, ph: number): number {
  return albuminGL * (0.123 * ph - 0.631);
}

/** Charge on inorganic phosphate (Figge), mmol/L → mEq/L. */
export function phosphateCharge(phosphate: number, ph: number): number {
  return phosphate * (0.309 * ph - 0.469);
}

export function stewart(input: StewartInput): StewartResult {
  const { ph, hco3, na, k, cl, albumin } = input;
  const ca = input.ca ?? 0;
  const mg = input.mg ?? 0;
  const lactate = input.lactate ?? 0;
  const phosphate = input.phosphate ?? 0;

  const cations: Segment[] = [
    { key: 'na', label: 'Na⁺', value: na },
    { key: 'k', label: 'K⁺', value: k },
  ];
  if (input.ca !== undefined) {
    cations.push({ key: 'ca', label: 'Ca²⁺', value: 2 * ca });
  }
  if (input.mg !== undefined) {
    cations.push({ key: 'mg', label: 'Mg²⁺', value: 2 * mg });
  }

  const strongAnions: Segment[] = [{ key: 'cl', label: 'Cl⁻', value: cl }];
  if (input.lactate !== undefined) {
    strongAnions.push({ key: 'lac', label: 'Laktat⁻', value: lactate });
  }

  const alb = albuminCharge(albumin, ph);
  const pi = phosphateCharge(phosphate, ph);
  const bufferBase: Segment[] = [
    { key: 'hco3', label: 'HCO₃⁻', value: hco3 },
    { key: 'alb', label: 'Alb⁻', value: alb },
  ];
  if (input.phosphate !== undefined) {
    bufferBase.push({ key: 'pi', label: 'Pi⁻', value: pi });
  }

  const sum = (s: Segment[]) => s.reduce((acc, x) => acc + x.value, 0);
  const sida = sum(cations) - sum(strongAnions);
  const side = sum(bufferBase);

  return {
    sida,
    side,
    sig: sida - side,
    albuminCharge: alb,
    phosphateCharge: pi,
    cations,
    strongAnions,
    bufferBase,
    bePartition: input.be === undefined ? undefined : partitionBaseExcess(input, input.be),
  };
}

/**
 * Fencl–Story: split the base excess into the parts each Stewart variable
 * explains. The remainder is what no measured ion explains.
 */
export function partitionBaseExcess(
  input: Pick<StewartInput, 'na' | 'cl' | 'albumin' | 'lactate'>,
  be: number,
): BePartition {
  const sodium = 0.3 * (input.na - 140);
  const chloride = 102 - (input.cl * 140) / input.na;
  const albumin = 0.25 * (42 - input.albumin);
  const lactate = -(input.lactate ?? 0);
  return {
    sodium,
    chloride,
    albumin,
    lactate,
    unmeasured: be - (sodium + chloride + albumin + lactate),
    total: be,
  };
}

/** Bicarbonate from pH and PaCO2 (Henderson–Hasselbalch), PaCO2 in kPa. */
export function bicarbonateFromPh(ph: number, pco2Kpa: number): number {
  return 0.0307 * 7.50062 * pco2Kpa * 10 ** (ph - 6.1);
}
