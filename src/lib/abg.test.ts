import { describe, expect, it } from 'vitest';
import { calculatePh, interpretAbg } from './abg';

// Cases are textbook examples, chosen so that pH, PaCO2 and HCO3 agree with
// Henderson–Hasselbalch (as a real analyser's output would).

const titles = (r: ReturnType<typeof interpretAbg>) =>
  r.findings.map(f => f.title).join(' | ');

describe('calculatePh', () => {
  it('gives 7.40 for PaCO2 40 mmHg and HCO3 24', () => {
    expect(calculatePh(40, 24)).toBeCloseTo(7.4, 2);
  });
});

describe('interpretAbg', () => {
  it('reads a normal gas as normal', () => {
    const r = interpretAbg({ unit: 'mmHg', ph: 7.4, pco2: 40, hco3: 24 });
    expect(r.phStatus).toBe('normal');
    expect(r.disorders).toEqual([]);
    expect(r.findings[0].severity).toBe('ok');
  });

  it('finds metabolic acidosis with adequate compensation (Winter)', () => {
    const r = interpretAbg({ unit: 'mmHg', ph: 7.25, pco2: 26, hco3: 11 });
    expect(r.disorders).toEqual(['metabolic-acidosis']);
    expect(titles(r)).toContain('adekvat respiratorisk kompensation');
  });

  it('gives the same answer in kPa', () => {
    const r = interpretAbg({ unit: 'kPa', ph: 7.25, pco2: 3.5, hco3: 11 });
    expect(r.disorders).toEqual(['metabolic-acidosis']);
    expect(r.findings.some(f => f.severity === 'alert')).toBe(false);
  });

  it('flags a respiratory acidosis on top of a metabolic acidosis', () => {
    const r = interpretAbg({ unit: 'mmHg', ph: 7.1, pco2: 40, hco3: 12 });
    expect(r.disorders).toEqual(['metabolic-acidosis', 'respiratory-acidosis']);
  });

  it('separates acute from chronic respiratory acidosis', () => {
    const acute = interpretAbg({ unit: 'mmHg', ph: 7.26, pco2: 60, hco3: 26 });
    expect(acute.disorders).toEqual(['respiratory-acidosis']);
    expect(titles(acute)).toContain('akut');

    const chronic = interpretAbg({ unit: 'mmHg', ph: 7.33, pco2: 60, hco3: 31 });
    expect(chronic.disorders).toEqual(['respiratory-acidosis']);
    expect(titles(chronic)).toContain('kronisk');
  });

  it('finds compensated metabolic alkalosis', () => {
    const r = interpretAbg({ unit: 'mmHg', ph: 7.5, pco2: 47, hco3: 36 });
    expect(r.disorders).toEqual(['metabolic-alkalosis']);
    expect(titles(r)).toContain('med respiratorisk kompensation');
  });

  it('finds acute respiratory alkalosis', () => {
    const r = interpretAbg({ unit: 'mmHg', ph: 7.53, pco2: 28, hco3: 22 });
    expect(r.disorders).toEqual(['respiratory-alkalosis']);
    expect(titles(r)).toContain('akut');
  });

  it('catches a kPa value entered as mmHg', () => {
    const r = interpretAbg({ unit: 'mmHg', ph: 7.4, pco2: 5.3, hco3: 24 });
    expect(r.findings[0].severity).toBe('alert');
    expect(r.findings[0].detail).toContain('byt enhet till kPa');
  });

  it('corrects the anion gap for albumin and computes the delta ratio', () => {
    const r = interpretAbg({
      unit: 'mmHg',
      ph: 7.25,
      pco2: 26,
      hco3: 11,
      na: 140,
      cl: 100,
      albumin: 25,
    });
    expect(r.values.anionGap).toBe(29);
    expect(r.values.correctedAnionGap).toBeCloseTo(32.75);
    expect(r.values.deltaRatio).toBeCloseTo(1.6, 1);
    expect(titles(r)).toContain('förhöjt');
  });

  it('labels a normal-gap acidosis as hyperchloraemic', () => {
    const r = interpretAbg({
      unit: 'mmHg',
      ph: 7.3,
      pco2: 31,
      hco3: 15,
      na: 140,
      cl: 115,
    });
    expect(r.values.anionGap).toBe(10);
    expect(r.findings.some(f => f.detail?.includes('Hyperkloremisk'))).toBe(true);
  });

  it('unmasks a gap acidosis hidden behind a normal pH', () => {
    const r = interpretAbg({
      unit: 'mmHg',
      ph: 7.4,
      pco2: 40,
      hco3: 24,
      na: 140,
      cl: 95,
    });
    expect(r.disorders).toContain('metabolic-acidosis');
    expect(r.disorders).toContain('metabolic-alkalosis');
  });

  it('computes P/F ratio and A–a gradient', () => {
    const r = interpretAbg({
      unit: 'mmHg',
      ph: 7.4,
      pco2: 40,
      hco3: 24,
      po2: 80,
      fio2: 0.5,
    });
    expect(r.values.pfRatioMmhg).toBe(160);
    expect(r.values.aaGradientMmhg).toBeCloseTo(226.5);
    expect(titles(r)).toContain('måttlig');
  });
});
