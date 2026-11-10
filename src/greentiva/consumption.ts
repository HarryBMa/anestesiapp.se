import type { Drug } from './types';

/**
 * Consumption from the clinician's OWN entered infusion plan. There is no
 * pharmacokinetic model here: the numbers are rate × weight × time, nothing
 * more. They are planning estimates, never doses or recommendations.
 */
export interface Phase {
  label: string;
  minutes: number;
  /** mg/kg/h for propofol, µg/kg/min for remifentanil. */
  rate: number;
  /** True if this phase stretches or shrinks with procedure duration. */
  scalesWithDuration: boolean;
}

export interface DrugPlan {
  drug: Drug;
  /** Bolus in mg/kg (propofol) or µg/kg (remifentanil). */
  bolusPerKg: number;
  phases: Phase[];
}

export interface Patient {
  ageYears: number;
  weightKg: number;
}

export function validatePatient(p: Patient): string[] {
  const errors: string[] = [];
  if (!Number.isFinite(p.ageYears) || p.ageYears < 18) {
    errors.push('Adults only (18 years or older). Paediatric patients are not supported.');
  }
  if (!Number.isFinite(p.weightKg) || p.weightKg <= 0 || p.weightKg > 300) {
    errors.push('Enter a body weight between 1 and 300 kg.');
  }
  return errors;
}

/** Drug per minute for a phase, in the drug's unit. */
export function drugPerMinute(drug: Drug, rate: number, weightKg: number): number {
  return drug === 'propofol' ? (rate * weightKg) / 60 : rate * weightKg;
}

/** Total drug for the plan when scalable phases are multiplied by `scale`. */
export function totalDrug(plan: DrugPlan, weightKg: number, scale = 1): number {
  let total = plan.bolusPerKg * weightKg;
  for (const ph of plan.phases) {
    const minutes = ph.minutes * (ph.scalesWithDuration ? scale : 1);
    total += drugPerMinute(plan.drug, ph.rate, weightKg) * minutes;
  }
  return total;
}

/** Total plan time in hours when scalable phases are multiplied by `scale`. */
export function totalHours(plan: DrugPlan, scale = 1): number {
  let minutes = 0;
  for (const ph of plan.phases) minutes += ph.minutes * (ph.scalesWithDuration ? scale : 1);
  return minutes / 60;
}

export function validatePlan(plan: DrugPlan): string[] {
  const errors: string[] = [];
  if (!(plan.bolusPerKg >= 0)) errors.push('Bolus cannot be negative.');
  for (const ph of plan.phases) {
    if (!(ph.minutes >= 0) || !(ph.rate >= 0)) {
      errors.push(`Phase "${ph.label || 'unnamed'}": minutes and rate must be zero or more.`);
    }
  }
  if (totalDrug(plan, 1) <= 0) errors.push('The plan uses no drug. Enter a bolus or a phase with a rate and minutes.');
  return errors;
}
