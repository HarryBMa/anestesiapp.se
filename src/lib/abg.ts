/**
 * Arterial blood gas interpretation.
 *
 * Pure functions, no React: everything here can be unit-tested and read top
 * to bottom as the stepwise approach taught for acid–base analysis:
 *
 *   1. Is the sample internally consistent? (Henderson–Hasselbalch)
 *   2. Acidaemia or alkalaemia?
 *   3. Which primary process explains the pH? (respiratory / metabolic)
 *   4. Is the compensation what we'd expect, or is a second process present?
 *   5. Anion gap (albumin-corrected) and, if raised, the delta ratio.
 *   6. Oxygenation: P/F ratio and A–a gradient.
 *
 * All formulas use mmHg internally because the classic bedside rules
 * (Winter's formula etc.) are written in mmHg. Swedish labs report kPa, so
 * the input carries its unit and is converted once at the start.
 *
 * This is decision support, not a diagnosis: the output always has to be
 * read together with the patient.
 */

export type PressureUnit = 'kPa' | 'mmHg';

export const KPA_TO_MMHG = 7.50062;

export interface AbgInput {
  unit: PressureUnit;
  ph: number;
  /** PaCO2 in `unit`. */
  pco2: number;
  /** Bicarbonate, mmol/L. */
  hco3: number;
  /** PaO2 in `unit`. */
  po2?: number;
  /** Inspired oxygen as a fraction, 0.21–1.0. */
  fio2?: number;
  /** Base excess, mmol/L. */
  be?: number;
  /** Sodium, mmol/L. */
  na?: number;
  /** Chloride, mmol/L. */
  cl?: number;
  /** Albumin, g/L. */
  albumin?: number;
  /** Lactate, mmol/L. */
  lactate?: number;
  /** Age in years; used for the expected A–a gradient. */
  age?: number;
}

export type Severity = 'ok' | 'info' | 'warn' | 'alert';

export interface Finding {
  severity: Severity;
  title: string;
  detail?: string;
}

export type PhStatus = 'acidemia' | 'alkalemia' | 'normal';

export type Disorder =
  | 'respiratory-acidosis'
  | 'respiratory-alkalosis'
  | 'metabolic-acidosis'
  | 'metabolic-alkalosis';

export interface AbgResult {
  phStatus: PhStatus;
  /** Every acid–base process found, primary first. */
  disorders: Disorder[];
  /** Short one-line summary in Swedish. */
  summary: string;
  /** Step-by-step reasoning, in display order. */
  findings: Finding[];
  /** Calculated values, for the "show your working" table. */
  values: {
    pco2Mmhg: number;
    calculatedPh: number;
    anionGap?: number;
    correctedAnionGap?: number;
    deltaRatio?: number;
    pfRatioMmhg?: number;
    pfRatioKpa?: number;
    aaGradientMmhg?: number;
    expectedAaMmhg?: number;
  };
}

// Reference ranges (adult arterial).
export const NORMAL = {
  ph: { low: 7.35, high: 7.45 },
  pco2Mmhg: { low: 35, high: 45 },
  hco3: { low: 22, high: 26 },
  be: { low: -3, high: 3 },
  /** Upper limit of normal anion gap without potassium. */
  anionGapHigh: 12,
  albumin: 40,
} as const;

const PCO2_MID = 40;
const HCO3_MID = 24;

export const DISORDER_LABEL: Record<Disorder, string> = {
  'respiratory-acidosis': 'Respiratorisk acidos',
  'respiratory-alkalosis': 'Respiratorisk alkalos',
  'metabolic-acidosis': 'Metabol acidos',
  'metabolic-alkalosis': 'Metabol alkalos',
};

export function toMmhg(value: number, unit: PressureUnit): number {
  return unit === 'kPa' ? value * KPA_TO_MMHG : value;
}

export function fromMmhg(value: number, unit: PressureUnit): number {
  return unit === 'kPa' ? value / KPA_TO_MMHG : value;
}

/**
 * Henderson–Hasselbalch in its bedside form: [H+] (nmol/L) = 24 × PaCO2 /
 * HCO3. pH is −log10 of [H+] in mol/L, which is 9 − log10 of it in nmol/L.
 */
export function calculatePh(pco2Mmhg: number, hco3: number): number {
  const hydrogen = (24 * pco2Mmhg) / hco3;
  return 9 - Math.log10(hydrogen);
}

/** Expected range for a compensating value: centre ± tolerance. */
interface Range {
  low: number;
  high: number;
}

const range = (centre: number, tolerance: number): Range => ({
  low: centre - tolerance,
  high: centre + tolerance,
});

const fmt = (n: number, digits = 1) =>
  n.toLocaleString('sv-SE', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

/** Formats a pressure given in mmHg in the user's chosen unit. */
const fmtP = (mmhg: number, unit: PressureUnit) =>
  `${fmt(fromMmhg(mmhg, unit), unit === 'kPa' ? 1 : 0)} ${unit}`;

const fmtRange = (r: Range, unit: PressureUnit | 'mmol/L') =>
  unit === 'mmol/L'
    ? `${fmt(r.low)}–${fmt(r.high)} mmol/L`
    : `${fmt(fromMmhg(r.low, unit), unit === 'kPa' ? 1 : 0)}–${fmtP(r.high, unit)}`;

export function interpretAbg(input: AbgInput): AbgResult {
  const { unit, ph, hco3 } = input;
  const pco2 = toMmhg(input.pco2, unit);
  const findings: Finding[] = [];
  const disorders: Disorder[] = [];
  const values: AbgResult['values'] = {
    pco2Mmhg: pco2,
    calculatedPh: calculatePh(pco2, hco3),
  };

  // ── 1. Internal consistency ────────────────────────────────────────────
  // Blood gas analysers calculate HCO3 from pH and PaCO2, so a real sample
  // always agrees with itself. A mismatch almost always means a typo or a
  // kPa/mmHg mix-up, and every step after this would be built on sand.
  const phGap = Math.abs(values.calculatedPh - ph);
  if (phGap > 0.05) {
    const hint =
      unit === 'mmHg' && input.pco2 < 15
        ? ' PaCO2 ser ut att vara angivet i kPa – byt enhet till kPa.'
        : unit === 'kPa' && input.pco2 > 15
          ? ' PaCO2 ser ut att vara angivet i mmHg – byt enhet till mmHg.'
          : ' Kontrollera inmatningen.';
    findings.push({
      severity: 'alert',
      title: 'Värdena går inte ihop',
      detail: `Uppmätt pH ${fmt(ph, 2)}, men PaCO2 och HCO3⁻ ger beräknat pH ${fmt(values.calculatedPh, 2)}.${hint}`,
    });
  }

  // ── 2. pH ──────────────────────────────────────────────────────────────
  const phStatus: PhStatus =
    ph < NORMAL.ph.low
      ? 'acidemia'
      : ph > NORMAL.ph.high
        ? 'alkalemia'
        : 'normal';

  const pco2High = pco2 > NORMAL.pco2Mmhg.high;
  const pco2Low = pco2 < NORMAL.pco2Mmhg.low;
  const hco3High = hco3 > NORMAL.hco3.high;
  const hco3Low = hco3 < NORMAL.hco3.low;

  // ── 3 + 4. Primary process and compensation ────────────────────────────
  if (phStatus === 'acidemia') {
    findings.push({
      severity: 'warn',
      title: `Acidemi (pH ${fmt(ph, 2)})`,
    });
    // Within the normal band, fall back to the side of the midpoint the value
    // sits on: a mildly acidaemic sample still has a direction.
    const resp = pco2High || (!hco3Low && pco2 > PCO2_MID);
    const met = hco3Low || (!pco2High && hco3 < HCO3_MID);
    if (resp && met && pco2High && hco3Low) {
      disorders.push('respiratory-acidosis', 'metabolic-acidosis');
      findings.push({
        severity: 'alert',
        title: 'Kombinerad respiratorisk och metabol acidos',
        detail:
          'Både högt PaCO2 och lågt HCO3⁻ driver pH nedåt. Ingen kompensation pågår – den ena rubbningen förvärrar den andra.',
      });
    } else if (resp && (pco2 - PCO2_MID) / PCO2_MID >= (HCO3_MID - hco3) / HCO3_MID) {
      disorders.push('respiratory-acidosis');
      respiratoryAcidosis(pco2, hco3, findings, disorders);
    } else {
      disorders.push('metabolic-acidosis');
      metabolicAcidosis(pco2, hco3, unit, findings, disorders);
    }
  } else if (phStatus === 'alkalemia') {
    findings.push({
      severity: 'warn',
      title: `Alkalemi (pH ${fmt(ph, 2)})`,
    });
    const resp = pco2Low || (!hco3High && pco2 < PCO2_MID);
    const met = hco3High || (!pco2Low && hco3 > HCO3_MID);
    if (resp && met && pco2Low && hco3High) {
      disorders.push('respiratory-alkalosis', 'metabolic-alkalosis');
      findings.push({
        severity: 'alert',
        title: 'Kombinerad respiratorisk och metabol alkalos',
        detail:
          'Både lågt PaCO2 och högt HCO3⁻ driver pH uppåt. Ingen kompensation pågår.',
      });
    } else if (resp && (PCO2_MID - pco2) / PCO2_MID >= (hco3 - HCO3_MID) / HCO3_MID) {
      disorders.push('respiratory-alkalosis');
      respiratoryAlkalosis(pco2, hco3, findings, disorders);
    } else {
      disorders.push('metabolic-alkalosis');
      metabolicAlkalosis(pco2, hco3, unit, findings, disorders);
    }
  } else if (pco2High && hco3High) {
    // Normal pH with both values shifted the same way: two opposing processes
    // (or, less often, complete compensation). Which side of 7.40 pH sits on
    // hints at which came first.
    disorders.push(
      ...(ph < 7.4
        ? (['respiratory-acidosis', 'metabolic-alkalosis'] as const)
        : (['metabolic-alkalosis', 'respiratory-acidosis'] as const)),
    );
    findings.push({
      severity: 'warn',
      title: 'Normalt pH men högt PaCO2 och högt HCO3⁻',
      detail: `Talar för respiratorisk acidos och metabol alkalos samtidigt (t.ex. KOL med diuretika eller kräkningar). pH på ${ph < 7.4 ? 'sura' : 'basiska'} sidan om 7,40 antyder att ${ph < 7.4 ? 'den respiratoriska' : 'den metabola'} komponenten är primär.`,
    });
  } else if (pco2Low && hco3Low) {
    disorders.push(
      ...(ph < 7.4
        ? (['metabolic-acidosis', 'respiratory-alkalosis'] as const)
        : (['respiratory-alkalosis', 'metabolic-acidosis'] as const)),
    );
    findings.push({
      severity: 'warn',
      title: 'Normalt pH men lågt PaCO2 och lågt HCO3⁻',
      detail: `Talar för metabol acidos och respiratorisk alkalos samtidigt (t.ex. sepsis, salicylatförgiftning, leversvikt). pH på ${ph < 7.4 ? 'sura' : 'basiska'} sidan om 7,40 antyder att ${ph < 7.4 ? 'den metabola' : 'den respiratoriska'} komponenten är primär.`,
    });
  } else if (pco2High || pco2Low || hco3High || hco3Low) {
    findings.push({
      severity: 'info',
      title: 'Normalt pH, enstaka gränsvärde',
      detail:
        'Ingen tydlig syra–basrubbning. Se anjongapet nedan – en dold metabol acidos kan finnas trots normalt pH.',
    });
  } else {
    findings.push({
      severity: 'ok',
      title: 'Normal syra–basstatus',
      detail: 'pH, PaCO2 och HCO3⁻ inom referensintervall.',
    });
  }

  if (input.be !== undefined) {
    const be = input.be;
    if (be < NORMAL.be.low || be > NORMAL.be.high) {
      findings.push({
        severity: 'info',
        title: `Basöverskott ${be > 0 ? '+' : ''}${fmt(be)} mmol/L`,
        detail:
          be < 0
            ? 'Negativt BE: metabol komponent åt det sura hållet (primär eller som kompensation).'
            : 'Positivt BE: metabol komponent åt det basiska hållet (primär eller som kompensation).',
      });
    }
  }

  // ── 5. Anion gap ───────────────────────────────────────────────────────
  if (input.na !== undefined && input.cl !== undefined) {
    analyseAnionGap(input, hco3, findings, disorders, values);
  } else if (disorders.includes('metabolic-acidosis')) {
    findings.push({
      severity: 'info',
      title: 'Ange Na⁺ och Cl⁻ för anjongap',
      detail:
        'Anjongapet skiljer mellan acidos av syratillskott (laktat, ketoner, toxiner) och bikarbonatförlust.',
    });
  }

  if (input.lactate !== undefined && input.lactate > 2) {
    findings.push({
      severity: input.lactate >= 4 ? 'alert' : 'warn',
      title: `Förhöjt laktat ${fmt(input.lactate)} mmol/L`,
      detail:
        input.lactate >= 4
          ? 'Laktat ≥ 4 mmol/L: tecken på vävnadshypoperfusion tills motsatsen är visad.'
          : 'Laktat > 2 mmol/L.',
    });
  }

  // ── 6. Oxygenation ─────────────────────────────────────────────────────
  if (input.po2 !== undefined) {
    analyseOxygenation(input, pco2, findings, values);
  }

  return {
    phStatus,
    disorders,
    summary: summarise(phStatus, disorders),
    findings,
    values,
  };
}

// ── Compensation rules ───────────────────────────────────────────────────
//
// Each rule gives the expected value of the compensating variable. Outside
// that range, a second primary process is present.

function respiratoryAcidosis(
  pco2: number,
  hco3: number,
  findings: Finding[],
  disorders: Disorder[],
) {
  // HCO3 rises 1 mmol/L per 10 mmHg acutely (buffering), 3.5 per 10 mmHg once
  // the kidneys have had 3–5 days.
  const rise = pco2 - PCO2_MID;
  const acute = range(HCO3_MID + 0.1 * rise, 2);
  const chronic = range(HCO3_MID + 0.35 * rise, 2);
  let detail = `Förväntat HCO3⁻: akut ${fmtRange(acute, 'mmol/L')}, kroniskt ${fmtRange(chronic, 'mmol/L')}. Uppmätt ${fmt(hco3)}.`;
  let title = 'Primär respiratorisk acidos';
  let severity: Severity = 'warn';
  if (hco3 < acute.low) {
    disorders.push('metabolic-acidosis');
    title += ' + metabol acidos';
    detail += ' HCO3⁻ är lägre än ens akut buffring förklarar.';
    severity = 'alert';
  } else if (hco3 > chronic.high) {
    disorders.push('metabolic-alkalosis');
    title += ' + metabol alkalos';
    detail += ' HCO3⁻ är högre än full njurkompensation förklarar.';
  } else if (hco3 <= acute.high) {
    title += ', akut';
  } else if (hco3 >= chronic.low) {
    title += ', kronisk (kompenserad)';
  } else {
    title += ', delvis kompenserad';
    detail += ' Mellan akut och kroniskt: subakut förlopp eller akut-på-kronisk.';
  }
  findings.push({ severity, title, detail });
}

function respiratoryAlkalosis(
  pco2: number,
  hco3: number,
  findings: Finding[],
  disorders: Disorder[],
) {
  // HCO3 falls 2 mmol/L per 10 mmHg acutely, 5 per 10 mmHg chronically.
  const fall = PCO2_MID - pco2;
  const acute = range(HCO3_MID - 0.2 * fall, 2);
  const chronic = range(HCO3_MID - 0.5 * fall, 2);
  let detail = `Förväntat HCO3⁻: akut ${fmtRange(acute, 'mmol/L')}, kroniskt ${fmtRange(chronic, 'mmol/L')}. Uppmätt ${fmt(hco3)}.`;
  let title = 'Primär respiratorisk alkalos';
  let severity: Severity = 'warn';
  if (hco3 > acute.high) {
    disorders.push('metabolic-alkalosis');
    title += ' + metabol alkalos';
    detail += ' HCO3⁻ är högre än akut buffring förklarar.';
    severity = 'alert';
  } else if (hco3 < chronic.low) {
    disorders.push('metabolic-acidosis');
    title += ' + metabol acidos';
    detail += ' HCO3⁻ är lägre än full njurkompensation förklarar.';
    severity = 'alert';
  } else if (hco3 >= acute.low) {
    title += ', akut';
  } else if (hco3 <= chronic.high) {
    title += ', kronisk (kompenserad)';
  } else {
    title += ', delvis kompenserad';
  }
  findings.push({ severity, title, detail });
}

function metabolicAcidosis(
  pco2: number,
  hco3: number,
  unit: PressureUnit,
  findings: Finding[],
  disorders: Disorder[],
) {
  // Winter's formula: expected PaCO2 = 1.5 × HCO3 + 8 ± 2 (mmHg).
  const expected = range(1.5 * hco3 + 8, 2);
  let detail = `Winters formel: förväntat PaCO2 ${fmtRange(expected, unit)}. Uppmätt ${fmtP(pco2, unit)}.`;
  let title = 'Primär metabol acidos';
  let severity: Severity = 'warn';
  if (pco2 > expected.high) {
    disorders.push('respiratory-acidosis');
    title += ' + respiratorisk acidos';
    detail +=
      ' PaCO2 är för högt: otillräcklig ventilation (trötthet, opioider, kvarvarande blockad?).';
    severity = 'alert';
  } else if (pco2 < expected.low) {
    disorders.push('respiratory-alkalosis');
    title += ' + respiratorisk alkalos';
    detail += ' PaCO2 är lägre än kompensationen förklarar.';
  } else {
    title += ' med adekvat respiratorisk kompensation';
  }
  findings.push({ severity, title, detail });
}

function metabolicAlkalosis(
  pco2: number,
  hco3: number,
  unit: PressureUnit,
  findings: Finding[],
  disorders: Disorder[],
) {
  // PaCO2 rises ~0.7 mmHg per mmol/L of HCO3. Hypoventilation is limited by
  // hypoxaemia, so the response is variable: ± 5 rather than ± 2.
  const expected = range(PCO2_MID + 0.7 * (hco3 - HCO3_MID), 5);
  let detail = `Förväntat PaCO2 ${fmtRange(expected, unit)}. Uppmätt ${fmtP(pco2, unit)}.`;
  let title = 'Primär metabol alkalos';
  const severity: Severity = 'warn';
  if (pco2 > expected.high) {
    disorders.push('respiratory-acidosis');
    title += ' + respiratorisk acidos';
    detail += ' PaCO2 är högre än kompensationen förklarar.';
  } else if (pco2 < expected.low) {
    disorders.push('respiratory-alkalosis');
    title += ' + respiratorisk alkalos';
    detail += ' PaCO2 är lägre än förväntat.';
  } else {
    title += ' med respiratorisk kompensation';
  }
  findings.push({ severity, title, detail });
}

// ── Anion gap ────────────────────────────────────────────────────────────

function analyseAnionGap(
  input: AbgInput,
  hco3: number,
  findings: Finding[],
  disorders: Disorder[],
  values: AbgResult['values'],
) {
  const na = input.na as number;
  const cl = input.cl as number;
  const gap = na - cl - hco3;
  values.anionGap = gap;

  // Albumin is the main unmeasured anion: every 10 g/L below 40 hides about
  // 2.5 mmol/L of gap. Critically ill patients are often hypoalbuminaemic,
  // so the uncorrected gap misses lactic acidosis.
  let effectiveGap = gap;
  let gapLabel = `Anjongap ${fmt(gap)} mmol/L`;
  if (input.albumin !== undefined) {
    effectiveGap = gap + 0.25 * (NORMAL.albumin - input.albumin);
    values.correctedAnionGap = effectiveGap;
    gapLabel = `Albuminkorrigerat anjongap ${fmt(effectiveGap)} mmol/L`;
  }

  const metAcidosis = disorders.includes('metabolic-acidosis');

  if (effectiveGap <= NORMAL.anionGapHigh) {
    if (metAcidosis) {
      findings.push({
        severity: 'warn',
        title: `${gapLabel} – normalt anjongap`,
        detail:
          'Hyperkloremisk acidos (bikarbonatförlust eller kloridtillskott): stora volymer NaCl, diarré, tarmfistel, renal tubulär acidos.',
      });
    } else {
      findings.push({
        severity: 'ok',
        title: `${gapLabel} – normalt`,
      });
    }
    if (input.albumin === undefined && gap > 6) {
      findings.push({
        severity: 'info',
        title: 'Ange albumin',
        detail:
          'Lågt albumin sänker anjongapet och kan dölja en anjongapsacidos.',
      });
    }
    return;
  }

  // Raised gap. Delta ratio compares the rise in gap with the fall in HCO3:
  // in a pure gap acidosis they move roughly 1:1.
  const gapRise = effectiveGap - NORMAL.anionGapHigh;
  const hco3Fall = HCO3_MID - hco3;
  if (!metAcidosis) {
    disorders.push('metabolic-acidosis');
  }
  findings.push({
    severity: 'alert',
    title: `${gapLabel} – förhöjt`,
    detail: `Anjongapsacidos: tillskott av syra. Tänk GOLDMARK – glykoler, 5-oxoprolin (paracetamol), L-laktat, D-laktat, metanol, aspirin, njursvikt, ketoacidos.${metAcidosis ? '' : ' Förhöjt gap trots att HCO3⁻/pH inte visar acidos: en dold metabol acidos maskeras av en samtidig alkalos.'}`,
  });

  if (hco3Fall <= 0) {
    if (!disorders.includes('metabolic-alkalosis')) {
      disorders.push('metabolic-alkalosis');
    }
    findings.push({
      severity: 'warn',
      title: 'Samtidig metabol alkalos',
      detail:
        'Anjongapet är förhöjt men HCO3⁻ har inte sjunkit: en metabol alkalos döljer acidosen.',
    });
    return;
  }

  const ratio = gapRise / hco3Fall;
  values.deltaRatio = ratio;
  let detail: string;
  if (ratio < 0.4) {
    detail =
      'Under 0,4: HCO3⁻ har sjunkit mycket mer än gapet stigit – främst hyperkloremisk (normalgap) acidos.';
  } else if (ratio < 0.8) {
    detail =
      '0,4–0,8: kombinerad anjongapsacidos och hyperkloremisk acidos (t.ex. ketoacidos som behandlats med NaCl).';
  } else if (ratio <= 2) {
    detail = '0,8–2: ren anjongapsacidos.';
  } else {
    detail =
      'Över 2: HCO3⁻ högre än gapet förklarar – samtidig metabol alkalos, eller en redan kompenserad kronisk respiratorisk acidos.';
    if (!disorders.includes('metabolic-alkalosis')) {
      disorders.push('metabolic-alkalosis');
    }
  }
  findings.push({
    severity: ratio <= 2 && ratio >= 0.8 ? 'info' : 'warn',
    title: `Deltakvot ${fmt(ratio, 2)}`,
    detail,
  });
}

// ── Oxygenation ──────────────────────────────────────────────────────────

/** Sea-level barometric pressure and water vapour pressure, mmHg. */
const P_ATM = 760;
const P_H2O = 47;
const RESPIRATORY_QUOTIENT = 0.8;

function analyseOxygenation(
  input: AbgInput,
  pco2: number,
  findings: Finding[],
  values: AbgResult['values'],
) {
  const { unit } = input;
  const po2 = toMmhg(input.po2 as number, unit);

  if (po2 < 60) {
    findings.push({
      severity: 'alert',
      title: `Hypoxemi (PaO2 ${fmtP(po2, unit)})`,
      detail: `PaO2 under ${fmtP(60, unit)}: motsvarar SaO2 runt 90 % – brant del av dissociationskurvan.`,
    });
  }

  const fio2 = input.fio2;
  if (fio2 === undefined) {
    return;
  }

  const pf = po2 / fio2;
  values.pfRatioMmhg = pf;
  values.pfRatioKpa = pf / KPA_TO_MMHG;
  const pfText = `P/F ${fmt(values.pfRatioKpa)} kPa (${fmt(pf, 0)} mmHg)`;
  if (pf > 300) {
    findings.push({ severity: 'ok', title: `${pfText} – normal oxygenering` });
  } else {
    const grade =
      pf > 200 ? 'lätt' : pf > 100 ? 'måttlig' : 'svår';
    findings.push({
      severity: pf > 200 ? 'warn' : 'alert',
      title: `${pfText} – ${grade} oxygeneringsnedsättning`,
      detail:
        'Gränserna 300/200/100 mmHg (40/26,7/13,3 kPa) är Berlindefinitionens. ARDS kräver dessutom PEEP ≥ 5, bilaterala infiltrat och akut debut.',
    });
  }

  // Alveolar gas equation: what the alveolus "should" hold.
  const alveolar = fio2 * (P_ATM - P_H2O) - pco2 / RESPIRATORY_QUOTIENT;
  const aa = alveolar - po2;
  values.aaGradientMmhg = aa;
  if (input.age !== undefined) {
    values.expectedAaMmhg = input.age / 4 + 4;
  }
  const expected = values.expectedAaMmhg;
  const raised = expected !== undefined ? aa > expected + 5 : aa > 20;
  findings.push({
    severity: raised ? 'warn' : 'ok',
    title: `A–a-gradient ${fmtP(aa, unit)}${raised ? ' – förhöjd' : ''}`,
    detail: `${expected !== undefined ? `Förväntat för åldern ≈ ${fmtP(expected, unit)}. ` : ''}${raised ? 'Förhöjd gradient: shunt, V/Q-obalans eller diffusionshinder. ' : 'Normal gradient vid hypoxemi talar för hypoventilation eller lågt FiO2. '}Gradienten stiger med FiO2 och tolkas säkrast på luft.`,
  });
}

// ── Summary ──────────────────────────────────────────────────────────────

function summarise(phStatus: PhStatus, disorders: Disorder[]): string {
  if (disorders.length === 0) {
    return phStatus === 'normal'
      ? 'Ingen syra–basrubbning'
      : phStatus === 'acidemia'
        ? 'Acidemi'
        : 'Alkalemi';
  }
  const labels = disorders.map((d, i) =>
    i === 0 ? DISORDER_LABEL[d] : DISORDER_LABEL[d].toLowerCase(),
  );
  return labels.length === 1
    ? labels[0]
    : `${labels.slice(0, -1).join(', ')} och ${labels[labels.length - 1]}`;
}
