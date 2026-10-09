import { describe, expect, it } from 'vitest';
import { parseAbl90, redactPersonnummer } from './abl90';

// Shaped like a Radiometer ABL90 FLEX PLUS printout as OCR returns it:
// header with patient data, flags, reference ranges, some OCR noise.
// The patient is fictitious.
const PRINTOUT = `
ABL90 FLEX PLUS   Patientrapport   Spruta - S 65uL
Patient-ID 19121212-1212
Efternamn Testsson   Förnamn Carl
Provtyp Arteriellt     T 37,0 °C   FIO2 21,0 %
Blodgasvärden
pH        7,312   [ 7,350 - 7,450 ]  ↓
pC02      4,85 kPa  [ 4,67 - 6,00 ]
p02       11,2 kPa  [ 11,0 - 14,4 ]
pH(T)     7,312
Oximetrivärden
ctHb      128 g/L
Elektrolytvärden
cK+       4,1 mmol/L
cNa+      138 mmol/L
cCa2+     1,12 mmol/L
cCa2+(7.4) 1,08 mmol/L
cCl-      109 mmol/L
Metabolitvärden
cGlu      7,4 mmol/L
cLac      4,8 mmol/L  ↑
Syra-basstatus
cBase(Ecf)  -8,1 mmol/L
cHCO3-(P,st)  17,9 mmol/L
cHCO3-(P)   17,6 mmol/L
Anion Gap,K+  15,5 mmol/L
`;

describe('parseAbl90', () => {
  const r = parseAbl90(PRINTOUT);

  it('reads every analyte the Stewart analysis needs', () => {
    expect(r.ph?.value).toBe(7.312);
    expect(r.pco2?.value).toBe(4.85);
    expect(r.na?.value).toBe(138);
    expect(r.k?.value).toBe(4.1);
    expect(r.ca?.value).toBe(1.12);
    expect(r.cl?.value).toBe(109);
    expect(r.lactate?.value).toBe(4.8);
    expect(r.hco3?.value).toBe(17.6);
    expect(r.hco3st?.value).toBe(17.9);
    expect(r.be?.value).toBe(-8.1);
  });

  it('copes with OCR reading O as 0', () => {
    expect(r.po2?.value).toBe(11.2);
  });

  it('skips temperature-corrected and pH-7.4-normalised duplicates', () => {
    // cCa2+(7.4) comes after cCa2+, and must not overwrite it.
    expect(parseAbl90('cCa2+(7.4) 1,08\ncCa2+ 1,12').ca?.value).toBe(1.12);
    expect(parseAbl90('pH(T) 7,300\npH 7,312').ph?.value).toBe(7.312);
  });

  it('does not read K+ out of the anion gap line', () => {
    expect(parseAbl90('Anion Gap,K+  15,5 mmol/L').k).toBeUndefined();
  });

  it('never picks up a value from the patient header', () => {
    const header = parseAbl90('Carl 19121212-1212\nCalle 121212-1212\nNadia 4,1');
    expect(header).toEqual({});
  });

  it('reads bicarbonate whatever bracket OCR produced', () => {
    for (const line of ['cHCO3-(P) 17,6', 'cHCO03-(P)   17,6', 'cHCO3-[P] 17,6', 'cHC03-{P} 17,6', 'HCO3-(P| 17,6']) {
      expect(parseAbl90(line).hco3?.value).toBe(17.6);
    }
    expect(parseAbl90('cHCO3-[P.st] 17,9').hco3st?.value).toBe(17.9);
    expect(parseAbl90('cHCO3-[P.st] 17,9').hco3).toBeUndefined();
  });

  it('converts mmHg to kPa', () => {
    expect(parseAbl90('pCO2 40 mmHg').pco2?.value).toBeCloseTo(5.33, 2);
  });

  it('flags implausible values for review', () => {
    expect(parseAbl90('cNa+ 13,8').na).toEqual({ value: 13.8, suspect: true });
  });
});

describe('redactPersonnummer', () => {
  it('removes personnummer and samordningsnummer in any common form', () => {
    for (const pnr of ['19121212-1212', '121212-1212', '121212+1212', '191212121212', '121272-1212']) {
      expect(redactPersonnummer(`ID ${pnr} x`)).toBe('ID [personnummer] x');
    }
  });

  it('leaves analyte values alone', () => {
    expect(redactPersonnummer('cNa+ 138 mmol/L')).toBe('cNa+ 138 mmol/L');
  });
});
