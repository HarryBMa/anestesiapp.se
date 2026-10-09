import { describe, expect, it } from 'vitest';
import { albuminCharge, bicarbonateFromPh, partitionBaseExcess, phosphateCharge, stewart } from './stewart';

describe('weak acid charges (Figge)', () => {
  it('gives about 11 mEq/L for albumin 40 g/L at pH 7.40', () => {
    expect(albuminCharge(40, 7.4)).toBeCloseTo(11.17, 1);
  });
  it('gives about 1.8 mEq/L for phosphate 1.0 mmol/L at pH 7.40', () => {
    expect(phosphateCharge(1, 7.4)).toBeCloseTo(1.82, 1);
  });
});

describe('stewart', () => {
  it('finds a near-zero gap in a normal sample', () => {
    const r = stewart({ ph: 7.4, hco3: 24, na: 140, k: 4, cl: 104, ca: 1.2, lactate: 1, albumin: 42, phosphate: 1 });
    // SIDa = 140 + 4 + 2.4 − 104 − 1 = 41.4
    expect(r.sida).toBeCloseTo(41.4, 1);
    // SIDe = 24 + 11.7 + 1.8 ≈ 37.6
    expect(r.side).toBeCloseTo(37.55, 1);
    expect(r.sig).toBeCloseTo(3.85, 1);
  });

  it('shows a high strong ion gap when unmeasured anions are added', () => {
    const base = { ph: 7.4, na: 140, k: 4, cl: 104, ca: 1.2, lactate: 1, albumin: 42, phosphate: 1 };
    const normal = stewart({ ...base, hco3: 24 });
    const keto = stewart({ ...base, hco3: 14 });
    expect(keto.sig - normal.sig).toBeCloseTo(10, 5);
  });

  it('doubles divalent ions', () => {
    const r = stewart({ ph: 7.4, hco3: 24, na: 140, k: 4, cl: 104, ca: 1.2, mg: 0.5, albumin: 40 });
    expect(r.cations.find(c => c.key === 'ca')?.value).toBeCloseTo(2.4);
    expect(r.cations.find(c => c.key === 'mg')?.value).toBeCloseTo(1);
  });
});

describe('partitionBaseExcess (Fencl–Story)', () => {
  it('attributes hyperchloraemia to chloride', () => {
    // Na 140, Cl 112: chloride effect 102 − 112 = −10.
    const p = partitionBaseExcess({ na: 140, cl: 112, albumin: 42, lactate: 0 }, -10);
    expect(p.chloride).toBeCloseTo(-10);
    expect(p.unmeasured).toBeCloseTo(0);
  });

  it('shows hypoalbuminaemia as alkalinising', () => {
    const p = partitionBaseExcess({ na: 140, cl: 102, albumin: 22, lactate: 0 }, 5);
    expect(p.albumin).toBeCloseTo(5);
  });
});

describe('bicarbonateFromPh', () => {
  it('gives 24 mmol/L at pH 7.40 and 5.33 kPa', () => {
    expect(bicarbonateFromPh(7.4, 5.33)).toBeCloseTo(24.5, 0);
  });
});
