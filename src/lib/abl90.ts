/**
 * Reads values out of the OCR text of a Radiometer ABL90 FLEX PLUS printout.
 *
 * Privacy by construction: this is an allow-list. Only lines that start with
 * a known analyte label are read, and only the number after the label is
 * kept. Everything else on the printout (patient name, personnummer, sample
 * ID, operator) is never extracted, stored or shown.
 *
 * OCR on thermal paper is noisy, so labels are matched loosely (O/0 mixups,
 * missing "c" prefix, stray symbols) and every value goes through a
 * plausibility range. The result is always shown to the user to confirm
 * before anything is calculated.
 */

export type Analyte =
  | 'ph'
  | 'pco2'
  | 'po2'
  | 'na'
  | 'k'
  | 'ca'
  | 'cl'
  | 'lactate'
  | 'glucose'
  | 'hco3'
  | 'hco3st'
  | 'be';

export interface Reading {
  value: number;
  /** Outside the plausible range: probably an OCR error. */
  suspect: boolean;
}

export type Readings = Partial<Record<Analyte, Reading>>;

export const ANALYTES: { key: Analyte; label: string; unit: string }[] = [
  { key: 'ph', label: 'pH', unit: '' },
  { key: 'pco2', label: 'pCO₂', unit: 'kPa' },
  { key: 'po2', label: 'pO₂', unit: 'kPa' },
  { key: 'na', label: 'cNa⁺', unit: 'mmol/L' },
  { key: 'k', label: 'cK⁺', unit: 'mmol/L' },
  { key: 'ca', label: 'cCa²⁺', unit: 'mmol/L' },
  { key: 'cl', label: 'cCl⁻', unit: 'mmol/L' },
  { key: 'lactate', label: 'cLac', unit: 'mmol/L' },
  { key: 'glucose', label: 'cGlu', unit: 'mmol/L' },
  { key: 'hco3', label: 'cHCO₃⁻(P)', unit: 'mmol/L' },
  { key: 'hco3st', label: 'cHCO₃⁻(P,st)', unit: 'mmol/L' },
  { key: 'be', label: 'cBase(Ecf)', unit: 'mmol/L' },
];

/** Plausible ranges (pressures in kPa). Outside → flagged for review. */
export const PLAUSIBLE: Record<Analyte, [number, number]> = {
  ph: [6.5, 8.0],
  pco2: [1, 30],
  po2: [1, 90],
  na: [90, 200],
  k: [1, 10],
  ca: [0.2, 3],
  cl: [50, 160],
  lactate: [0, 30],
  glucose: [0.5, 60],
  hco3: [1, 60],
  hco3st: [1, 60],
  be: [-40, 40],
};

const MMHG_PER_KPA = 7.50062;

/**
 * One pattern per analyte, matched at the start of a line (after
 * normalisation). Order matters where labels overlap: the more specific
 * (P,st) bicarbonate is tried before plain (P).
 */
const PATTERNS: [Analyte, RegExp][] = [
  // "pH" but not "pH(T)" (temperature-corrected).
  ['ph', /^p\s?H(?!\s*\(T)\b/i],
  // "pCO2": OCR reads the O as 0, sometimes doubled ("pC002"); not "pCO2(T)".
  ['pco2', /^p\s?C[O0]{1,2}\s?2(?!\s*\(T)/i],
  ['po2', /^p\s?[O0]{1,2}\s?2(?!\s*\(T|\s*\()/i],
  ['na', /^c?\s?Na\s?\+?(?![a-z])/i],
  // Not "cK+" inside "Anion Gap,K+": anchored to line start, so safe.
  ['k', /^c?\s?K\s?\+?(?![a-z])/i],
  // Actual ionised calcium, not the pH-7.4-normalised "cCa2+(7.4)".
  ['ca', /^c?\s?Ca(?![a-z])(?!\S*\(7)\s?2?\s?\+?/i],
  ['cl', /^c?\s?C[lI1]\s?-?(?![a-z])/],
  ['lactate', /^c?\s?Lac\b/i],
  ['glucose', /^c?\s?Glu\b/i],
  ['hco3st', /^c?\s?HC[O0]{1,2}\s?3\s?-?\s?[([{]\s?P\s?[,.]\s?st\s?[)\]}|]?/i],
  // OCR often turns the brackets into [ ] { } or |.
  ['hco3', /^c?\s?HC[O0]{1,2}\s?3\s?-?\s?[([{]\s?P\s?[)\]}|]/i],
  ['be', /^c?\s?Base\s?\(\s?Ecf\s?\)/i],
];

/** Tidies the OCR text so the patterns above have less to cope with. */
function normaliseLine(line: string): string {
  return (
    line
      .replace(/[−–—]/g, '-')
      .replace(/[₀-₉]/g, d => String(d.charCodeAt(0) - 0x2080))
      .replace(/[²]/g, '2')
      .replace(/[⁺]/g, '+')
      .replace(/[⁻]/g, '-')
      // Leading flags and bullets the printer or OCR adds: ↑ ↓ * ? ! |
      .replace(/^[\s↑↓*?!|•·>]+/, '')
      .trim()
  );
}

/** First number after the label: "7,412" and "7.412" both work. */
function firstNumber(rest: string): number | undefined {
  const m = rest.match(/(-?\s?\d+(?:[.,]\d+)?)/);
  if (!m) {
    return undefined;
  }
  const n = Number(m[1].replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

export function parseAbl90(text: string): Readings {
  const readings: Readings = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = normaliseLine(raw);
    for (const [key, pattern] of PATTERNS) {
      if (readings[key]) {
        continue;
      }
      const m = line.match(pattern);
      if (!m) {
        continue;
      }
      const rest = line.slice(m[0].length);
      let value = firstNumber(rest);
      if (value === undefined) {
        continue;
      }
      // Pressures: the analyser may be set to mmHg.
      if ((key === 'pco2' || key === 'po2') && /mm\s?Hg/i.test(rest)) {
        value = Math.round((value / MMHG_PER_KPA) * 100) / 100;
      }
      // pH printed without its decimal point ("7412"): restore it.
      if (key === 'ph' && value > 600 && value < 800) {
        value = value / 100;
      }
      const [min, max] = PLAUSIBLE[key];
      readings[key] = { value, suspect: value < min || value > max };
      break;
    }
  }
  return readings;
}

/**
 * Swedish personnummer / samordningsnummer: YYMMDD-NNNN, YYYYMMDDNNNN and
 * variants with + or no separator. Used to make sure no such number ever
 * reaches the screen, even inside text the parser didn't recognise.
 */
// Day 61–91 is a samordningsnummer (day + 60).
const PERSONNUMMER = /\b(?:19|20)?\d{2}[01]\d[0-36-9]\d[-+\s]?\d{4}\b/g;

export function redactPersonnummer(text: string): string {
  return text.replace(PERSONNUMMER, '[personnummer]');
}
