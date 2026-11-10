# GreenTIVA: architecture, key decisions and validation plan

Status: **proposal for review. No implementation code exists yet.**
Date: 2026-11-10 · Planned route: `/a/greentiva` (not linked from the homepage until the gates in section 9 are passed)

GreenTIVA is a planning and sustainability tool for intravenous anaesthesia (TIVA/TCI). It is not a prescribing or dosing system. Everything in this document serves one measurable goal: **less discarded drug and less disposable plastic per anaesthetic, with no loss of safety or drug availability.**

---

## 1. Decisions at a glance

| # | Decision | Choice | Why |
|---|---|---|---|
| D1 | PK code provenance | **Clean-room implementation** from primary publications. No code copied from SimTIVA. | SimTIVA is GPL-3.0; copying it would force this whole repo to GPL. |
| D2 | Use of existing implementations | **Independent numerical oracles** (SimTIVA, R `tci`, PyTCI, jsTCI, OpenTIVA), compared offline in CI fixtures | A second implementation catches transcription errors in coefficients. |
| D3 | TCI reference | Define the reference as **the pump the unit actually uses**, not "TCI in general" | Drug quantity depends on the pump's algorithm details (update interval, bolus handling, ke0, rate limits). |
| D4 | Uncertainty | Scenario ensembles now; **split-conformal calibration** on recorded data later | Honest about what is known; calibrated coverage is measurable. |
| D5 | Optimiser | **Exhaustive integer enumeration** over container combinations with hard safety constraints, then Pareto ranking | Search space is tiny, so the result is provably optimal, deterministic and explainable. ML is not needed or used here. |
| D6 | Plastic and CO₂e | Grams per item **configured by the department; no shipped defaults**. CO₂e shown only when a cited LCA factor is entered. | Avoids invented numbers. |
| D7 | Storage | IndexedDB (Dexie), local only, PWA offline | Meets "no cloud patient data". See privacy caveats in 3.6. |
| D8 | Repo layout | Engines in `src/greentiva/` with **zero React imports**, enforced by lint. UI in `src/routes/a/greentiva*.tsx`. | Engines can later be extracted into their own package. |
| D9 | Build order | **Start the baseline waste recording first**, in parallel with the PK work | The primary success criterion needs weeks of pre-intervention data. See section 8. |
| D10 | Public exposure | Module A (patient-specific) is **not linked or advertised** on the public homepage until regulatory route is decided | See section 7. |

Items needing your decision are collected in section 10.

---

## 2. Research findings

### 2.1 Existing open-source TCI implementations

| Project | Licence | Models relevant to us | Notes | Our use |
|---|---|---|---|---|
| [SimTIVA](https://www.github.com/luktinghin/simtiva) | **GPL-3.0** | Propofol: Marsh, Schnider, Eleveld, Paedfusor. Remifentanil: Minto, Eleveld. Also fentanyl, alfentanil, dexmedetomidine, ketamine. | JavaScript PWA. Maths "based on STANPUMP" (Shafer). Educational purpose; no formal validation data on its page. Has a high-BMI warning (BMI ≥ 35). | Oracle only. Never copy code. |
| [PyTCI](https://pypi.org/project/PyTCI/) | MIT | Propofol: Schnider, Marsh, Eleveld, Kataria, Paedfusor. Remifentanil: Minto, Eleveld. | Last release Dec 2019, single maintainer, no validation claims. Infusion calculation implemented only for propofol. | Oracle for Cp/Ce time courses. |
| [jsTCI](https://github.com/jplomas/jsTCI) | MIT | Propofol: Schnider, Marsh, Kataria, Paedfusor. Remifentanil: Minto. | Work in progress, no Eleveld, unclear test status. | Weak oracle. Possible licence-safe reference for structure only. |
| R [`tci`](https://www.stats.bris.ac.uk/R/web/packages/tci/readme/README.html) | Not stated on the page I read; check CRAN `DESCRIPTION` | Propofol: Marsh, Schnider, Eleveld. Remifentanil: Minto, Kim, Eleveld. | Plasma targeting after Jacobs (1990); effect-site after Shafer and Gregg (1992). Models can be user-defined. | **Best oracle** (covers all models we need, documented algorithms). Check licence before using anything beyond running it. |
| [OpenTIVA](https://opentiva.readthedocs.io/en/latest/source/userguide.html) | Not stated (copyright notice only) | Propofol: Schnider, Eleveld, Marsh, Diprifusor, Paedfusor. Remifentanil: Minto. | **Validates covariate ranges per model and emits a warning** when outside them. `max_infusion_rate`, `cp_limit` settings. | Design inspiration for range-checking. Behaviour check only. |

Result: no existing implementation can be adopted as a dependency for a clinical-adjacent tool (GPL, unmaintained, no licence, or no validation evidence). All four are valuable as independent numerical references.

### 2.2 Primary model sources (to be cited in every model card)

| Model | Reference | Verified in this research? |
|---|---|---|
| Remifentanil, Eleveld | Eleveld DJ et al. *An allometric model of remifentanil pharmacokinetics and pharmacodynamics.* Anesthesiology 2017;126(6):1005-1018. [DOI](https://doi.org/10.1097/ALN.0000000000001634). According to PubMed: 131 individuals, covariates age, weight, sex; reference individual V1 5.81 L, V2 8.82 L, V3 5.03 L, CL 2.58 L/min; ke0 1.09 /min; performance exceeded Minto over a wide age/weight range. | Yes (PubMed 28509794) |
| Propofol, Eleveld | Eleveld DJ et al. *A general purpose pharmacokinetic model for propofol.* Br J Anaesth 2018;120(5):942-959 | **No.** Citation recalled; verify on PubMed when writing the model card. |
| Propofol, Marsh | Marsh B et al. Br J Anaesth 1991;67:41-48 | **No.** Verify. |
| Propofol, Schnider | Schnider TW et al. Anesthesiology 1998;88:1170-1182 and 1999;90:1502-1516 | **No.** Verify. |
| Remifentanil, Minto | Minto CF et al. Anesthesiology 1997;86:10-23 and 24-33 | **No.** Verify. |
| TCI algorithms | Jacobs 1990 (plasma); Shafer & Gregg, J Pharmacokinet Biopharm 1992;20:147-169 (effect-site) | **No.** Verify. |

Rule: no coefficient enters the code until it is transcribed from the primary paper's table (not from another program), double-entered by two people, and recorded with page and table number.

### 2.3 Sustainability evidence

- **Windler et al., Br J Anaesth 2024;133(6):1459-1464** ([DOI](https://doi.org/10.1016/j.bja.2024.10.002)). According to PubMed: retrospective analysis of 331 procedures at University Hospital Bonn. Induction with the *same syringe pump used for maintenance* was associated with **32.8% less propofol waste** than manual induction from a separate syringe, up to 46.9% less in 20-40 min procedures. Waste was unaffected by sex, age, weight, BMI or ASA class. Syringe pump induction was consistently better except in patients with obesity. Manual induction in patients with active substance use gave 27.6% more waste. Limitations: single centre, retrospective, not randomised. Treat as a hypothesis to test locally, not a guarantee.
- **Royal Cornwall "TIVA from a bottle"** ([Association of Anaesthetists](https://anaesthetists.org/Home/Resources-publications/Anaesthesia-News-magazine/Anaesthesia-News-free-articles/TIVA-from-a-bottle-a-method-for-reducing-plastic-waste-during-total-intravenous-anaesthesia)). Single-trust trial running propofol directly from 20/50/100 ml bottles on B. Braun Infusomat volumetric pumps configured for TCI. Author estimates about 90% less plastic by weight (the page notes career-level estimates have been criticised as possibly overstated). Pump accuracy ±5% versus ±3% for the syringe pump, up to 16 ml can remain in the giving set, one pump brand, proprietary sets. **Not guideline-endorsed.** GreenTIVA can model it as an optional strategy, disabled by default because it needs pump support and local governance.
- Not found in this pass: an authoritative reusable LCA dataset for propofol production or anaesthetic disposables. Hence decision D6.
- Still to do: check Swedish and Region Stockholm guidance on waste (e.g. Janusinfo, SFAI) and the Association of Anaesthetists / Centre for Sustainable Healthcare materials. I did not find or read these.

### 2.4 Product presentations and in-use constraints

What I could confirm from Läkemedelsverket's document store (docetp.mpa.se) and nothing more. **These are licensed presentations, not necessarily what Karolinska stocks. Not every pack size is marketed. The department must configure its real formulary (section 3.4).**

| Product | Presentations | Key handling constraints (from the SmPC text I read) |
|---|---|---|
| [Propofol-Lipuro 20 mg/ml](https://docetp.mpa.se/LMF/Propofol-Lipuro%2020%20mg%20per%20ml%20emulsion%20for%20injection%20or%20infusion%20SmPC_09001bee807a7b23.pdf) | 50 ml glass vials (1 or 10 per pack) | Unopened 2 years. **Use immediately after opening.** Single use, discard leftovers. No preservative. Infusion set and container replaced at least every 12 h. |
| [Propolipid 20 mg/ml](https://docetp.mpa.se/LMF/Propolipid%2020%20mg%20per%20ml%20emulsion%20for%20injection%20or%20infusion%20SmPC_09001bee807a7b4e.pdf) (vials) | 20 ml, 50 ml, 100 ml glass vials | Unopened 3 years. Use immediately after opening; draw up aseptically and start without delay. Max 12 h per infusion through one system. One patient only; discard leftovers. |
| [Propolipid prefilled syringes](https://docetp.mpa.se/LMF/Propolipid%20emulsion%20for%20injection%20or%20infusion%20in%20pre-filled%20syringe%20PL_09001bee807a7b4c.pdf) (patient leaflet) | 10 and 20 mg/ml; glass 10 and 20 ml; plastic 10, 20 and 50 ml | 10/20 ml glass and 10 ml plastic: **manual use only, not for pumps**. Administration set changed 12 h after the syringe was opened. TCI is mentioned only as not recommended under age 2; leaflet does not describe adult TCI. |
| [Ultiva (remifentanil)](https://docetp.mpa.se/LMF/Ultiva%20powder%20for%20concentrate%20for%20solution%20for%20injection%20or%20infusion%20SmPC_09001bee828c8ebc.pdf) | 1 mg, 2 mg, 5 mg powder vials | Reconstitute to 1 mg/ml; dilute to 20-250 µg/ml for manual infusion; **TCI 20-50 µg/ml**. Use immediately or within **12 h at ≤ 25 °C**; discard leftovers. Do not mix with propofol or lactate before administration. Not epidural or intrathecal. |
| Remifentanil generics (hameln, Reig Jofre, B. Braun, Orion) | Found on the same store; **not read** | Check each. Do not assume identical presentations or stability text. |

Design consequences:
- "Use immediately after opening" means the optimiser may never recommend preparing in advance. The 12 h figures are **ceilings**; local policy may be stricter and the app must not allow a longer limit than the label (the config UI rejects it).
- Smaller increments (20 ml vials) allow opening a second container only if needed, which is the main structural lever on vial leftover. A 50 ml vial opened for a 22 ml need wastes 28 ml.
- Remifentanil is a narcotic. Discard recording must **not replace** the unit's narcotics ledger and witnessed-disposal routine. GreenTIVA records quantities for analysis only.
- Still needed from you: the actual Karolinska/ÖNH formulary and pump library (which syringes, which pumps, which TCI models are enabled).

---

## 3. Architecture

### 3.1 Module boundaries and dependency rule

```
          ┌──────────────────────────── UI (React, TanStack Router) ─────────────────────────────┐
          │  /a/greentiva  dashboard · new case wizard · results · protocols · analytics · setup  │
          └───────┬───────────────┬──────────────────┬───────────────────┬──────────────┬────────┘
                  │               │                  │                   │              │
                  ▼               ▼                  ▼                   ▼              ▼
             sim (worker)    optimiser          impact             analytics        storage (Dexie)
                  │               │                  │                   │              │
                  ▼               └──────┬───────────┘                   │              │
                 pk  ◄── catalogue/types ┘                               ▼              ▼
          (pure maths)      (shared domain types, units, zod schemas) ◄──────────────────┘
```

Rule, enforced by `eslint no-restricted-imports` or `dependency-cruiser` in `bun run build`:
`pk` imports only `types`. `sim` imports `pk`, `types`. `optimiser` imports `types` (it consumes a demand distribution, not a PK model). `impact` imports `types`. `analytics` imports `types`. Only `ui` and `storage` import React or Dexie. Engines contain no DOM, no `Date.now()`, no randomness without an injected seeded PRNG, so every result is reproducible.

### 3.2 Directory layout

```
src/greentiva/
  types/        units (branded number types: mg, µg, ml, mg_per_ml), domain types, zod schemas
  pk/           models/{marsh,schnider,eleveld_propofol,minto,eleveld_remifentanil}.ts
                  each: coefficients.ts (with citation + hash), covariates.ts (range checks), model card .md
                lbm.ts (James etc.), statespace.ts (discretisation)
  sim/          timeline.ts (phases, events), tci/{plasma,effectsite}.ts, manual.ts, run.ts, ensemble.ts
  optimiser/    constraints.ts (hard safety invariants), enumerate.ts, score.ts, explain.ts
  impact/       items.ts (user-weighed items), plastic.ts, co2e.ts (only with cited factor)
  analytics/    predicted-vs-actual.ts, calibration.ts (conformal), reports.ts, export-csv.ts
  storage/      db.ts (Dexie), migrations, audit-log.ts
  fixtures/     reference/*.json  (oracle outputs + provenance)
src/routes/a/greentiva.tsx (+ sub-routes)
docs/greentiva/  ARCHITECTURE.md, model-cards/, validation/, hazard-log.md
```

### 3.3 Stack

React 19, TypeScript (strict, `noUncheckedIndexedAccess`), Vite, Tailwind v4, TanStack Router, Vitest: all already in this repo. New dependencies, each needing your approval: `dexie` (IndexedDB), `zod` (schemas), `fast-check` (property tests), `uplot` (time-series charts, small and fast; simple bar charts as hand-rolled SVG), `vite-plugin-pwa` (offline). Simulation runs in a Web Worker so tablets stay responsive.

### 3.4 Core data model (all local)

- `Product`: id, name, drug, concentration (mg/ml or µg/ml), container kind (vial/prefilled syringe/syringe), nominal volume, pump-compatible flag, **in-use limit (h) with source citation**, unit cost, item masses, narcotic flag.
- `Item` (syringe sizes, caps, lines, extensions, taps…): mass in g, optional recyclability note, optional LCA factor with source.
- `Protocol`: versioned template of phases and targets. **Template for estimation only.**
- `CasePlan`: anonymised parameters, protocol version, model versions, simulation output, optimiser output, clinician review flag (must be ticked before the plan is saved).
- `CaseActual`: measured quantities (section 3.5), linked to its `CasePlan` by a random id.
- `AuditEvent`: append-only log of model version, protocol and config changes (hash-chained so tampering is detectable).

### 3.5 Recording design

Compliance decides whether the study works, so the post-case form must take under 30 seconds: vials/syringes opened (tap per size), remaining volume per syringe read from graduations (tap or slider), actual duration, optional "unplanned top-up needed" toggle. Optional scale-weighing is a later add-on. Administered drug is derived as prepared minus remaining, and is labelled **derived**, never "dose".

### 3.6 Privacy and storage

- No names, no personnummer, no free text fields.
- **Quasi-identifiers are the real risk in a small unit:** date, age, weight, height, sex and procedure together can single out a patient. Store only month, age band, weight rounded to 5 kg in analytics tables; exact values exist only in the transient plan unless the user opts in.
- Exports apply minimum cell size (k ≥ 5) and suppress or merge smaller groups. Per-surgeon comparison uses pseudonymous codes and is hidden below the minimum cell size.
- IndexedDB is **not encrypted at rest**; shared theatre tablets need device-level encryption and local policy. Document this in the setup page.
- Whether pseudonymised plan/actual linkage counts as personal data under GDPR, and whether use at Karolinska needs the dataskyddsombud or a QI-register entry, is a question for the hospital, not something the app can settle.

### 3.7 Offline and hosting

Service-worker precache of the built assets, `hem-assets/` path as already configured. Add `a/greentiva` static assets to the `vercel.json` rewrite exclusion only if separate static files are introduced. No network calls from engines; no telemetry.

---

## 4. Mathematical approach

### 4.1 Pharmacokinetic state-space

Three-compartment mammillary model with effect site, state `x = [A1, A2, A3, Ce]` (amounts in the compartments and effect-site concentration):

```
dA1/dt = -(k10 + k12 + k13)·A1 + k21·A2 + k31·A3 + u(t)
dA2/dt =  k12·A1 - k21·A2
dA3/dt =  k13·A1 - k31·A3
dCe/dt =  ke0·(A1/V1 - Ce)
```

`u(t)` is the infusion rate (mg/min); boluses are impulses added to `A1`. Rate constants come from the model's covariate equations. With a fixed step Δt, `x[n+1] = Φ·x[n] + Γ·u[n]` where `Φ = exp(A·Δt)` and `Γ = A⁻¹(Φ − I)B`, computed **exactly** (matrix exponential), not by Euler stepping. Validated against a high-precision RK4/adaptive ODE solve.

### 4.2 Consumption is integrated infusion, not concentration

```
administered_drug = Σ u[n]·Δt + Σ boluses
```

Predicted Cp/Ce are outputs of the model; consumption is computed from the commanded infusion. Mass balance is a unit test: `administered = ΣAi(t) + eliminated(t)` at every step (to numerical tolerance).

Added terms that real consumption includes and a naive integral misses: line priming and dead space, syringe dead volume, changeover losses, and unplanned manual boluses. All are configurable parameters with defaults of **zero until measured locally**.

### 4.3 TCI algorithms

- **Plasma-target:** at each pump update interval, choose `u` so the model's predicted Cp reaches the target at the next step (Jacobs-style), subject to maximum rate and the pump's bolus rules.
- **Effect-site target:** Shafer and Gregg overshoot logic: bolus then infusion such that Ce peaks at the target without Cp exceeding the plasma limit.
- **Pump profile object** (D3) captures: update interval, bolus/infusion split, rate cap, volume resolution, ke0 variant, which lean-body-mass equation, and any rounding. The default profile ships empty; the department selects or records its pump. Until a pump profile is validated, TCI output is labelled "generic TCI estimate, not matched to your pump."
- Time resolution: Δt = 1 s for the simulation core; the pump's own update interval is applied on top. Boluses are placed on the step grid and checked in tests for conservation.

### 4.4 Model scope and range handling

Adults (≥ 18 y) only in the first release. Every model has a **range check from its primary publication's covariate ranges**, shown in its model card; values outside produce a blocking "outside validated range" state with no numbers displayed (stricter than OpenTIVA's warning). Known issue to document: James-equation lean body mass behaves non-physiologically at high BMI (used by Schnider and Minto), which is why SimTIVA warns at BMI ≥ 35; the engine flags this and offers no extrapolation. Paediatric, pregnancy and other special populations are not supported and are blocked, not extrapolated.

### 4.5 Demand distribution and uncertainty

Model output is deterministic for a fixed plan, so the actual uncertainty comes from the plan not being followed. For each case run an ensemble (seeded, N ≈ 2000 on a worker):

- duration drawn from a documented distribution (lognormal by procedure category; initial CV set from your unit's experience, then from recorded data);
- target changes jittered within a clinician-set band;
- a model-misspecification multiplier ε.

Output: `q05`, `q50`, `q95` of required drug (mg or µg) and volume at the chosen concentration. Labels: **"Estimate, not a dose."**

Calibration: after n ≥ 30 recorded cases in a procedure category, compute the empirical ratio `actual/predicted`, and widen or tighten the interval by **split conformal prediction** so the nominal 90% interval achieves about 90% observed coverage. The analytics page shows achieved coverage. Below n = 30 the output carries "uncalibrated". ML models, if ever used, may only produce *additional* informational estimates and **never alter the protocol timeline or hard constraints**.

### 4.5.1 Safety reserve

`required = q_α(D) + R_prime + R_user`, where `q_α` is a configurable upper quantile (default 0.95), `R_prime` is line priming/dead space, and `R_user` is a user-set reserve in ml. The reserve cannot be set below the department's configured minimum. Lowest calculated drug is never treated as the safest preparation.

### 4.6 Preparation optimiser

Inputs: demand quantiles, product catalogue, pump/syringe compatibility, in-use limits, reserve policy, weights.

A **strategy** is a vector `n = (n_k)` of containers prepared at the start for each product `k` plus an optional set of unopened contingency containers kept available (not counted as waste if the department says unopened stock returns to inventory).

Hard constraints (infeasible strategies are discarded, never merely penalised):

1. **Sufficiency:** prepared capacity ≥ `required` (4.5.1).
2. **Single-patient containers:** every opened container is attributed to exactly one patient; no pooled or shared containers exist in the model.
3. **In-use time:** `expected duration + emergence ≤ min(product in-use limits, local limit)`, and the plan is "prepare at time of use".
4. **Pump/syringe compatibility:** only pump-compatible containers feed the pump.
5. **Contingency available:** if `P(D > prepared)` exceeds a configurable threshold, an unopened contingency container must be listed as available in the theatre, otherwise the strategy is rejected.
6. **Within validated model range** (otherwise no strategy is produced).

Objective over the ensemble: expected discarded drug

```
W(n) = E[ Σ_k ( opened_capacity_k − used_k ) ]
```

where opened capacity rounds up to whole containers (single-use vials) and the contingency container is opened only in ensemble members where demand exceeds the prepared amount (**sequential opening policy**, evaluated per scenario). Secondary: plastic grams (from the item table), cost, number of syringes. The UI shows the **Pareto set**; the recommended strategy is the lexicographic minimum (waste, then plastic, then cost) among feasible ones, with a written "why selected" generated from the binding constraints (e.g. "2 × 20 ml chosen over 1 × 50 ml: covers q95 + reserve; 50 ml option would discard an expected 28 ml").

Complexity: with ≤ 4 products and each `n_k ≤ ~6`, the space is ≲ 10⁴ combinations, so the search is exhaustive and exact.

Strategy templates the optimiser may compare, **for the technique the clinician already chose**: separate induction syringe vs single syringe for induction and maintenance (Windler hypothesis, section 2.3), vial size mix, prefilled syringes where licensed for pump use. The optimiser does not choose the anaesthetic technique, targets or rates.

### 4.7 Plastic and footprint

`plastic_g = Σ count_i · mass_i`, where masses are entered per item by the department (weigh them). Distinguishes **plastic mass** from **total product mass** (e.g. glass, drug, packaging). CO₂e is computed only for items with a cited emission factor entered by the user; otherwise "no reliable LCA data". No recyclability assumption is made; items have an optional recyclability note, and reports state plastic weight avoided, not "environmental benefit".

---

## 5. Safety invariants (encoded as tests, not just text)

Property-based tests (fast-check) assert for all generated inputs:

- No output ever contains a shared, pooled or reused container.
- Every strategy satisfies sufficiency and in-use limits.
- Local in-use limit ≤ label limit (config validation).
- Reserve ≥ configured minimum; recommended strategy never has lower capacity than `required`.
- Outside-range patients yield no numbers.
- Estimates are never displayed under the label "dose"; no function returns an infusion rate or TCI target as a recommendation. Targets are user inputs only.
- Saving a plan requires the clinician-review checkbox.
- Model version, coefficient hash and protocol version are stored with every plan and appear in the audit log.

---

## 6. Validation plan

| Level | What | Pass criterion (proposed; to be agreed before running) |
|---|---|---|
| V0 Maths | Mass balance; steady state `Cp → u/CL`; matrix exponential vs adaptive ODE | Relative error < 1e-9 / < 1e-6 |
| V1 Coefficients | Transcription audit against primary papers, double entry by two people, constants file hashed; CI fails if a constant changes without a version bump | 100% match, signed off |
| V2 Cross-implementation | Same patient/regimen run through our engine and the oracles (R `tci`, PyTCI, SimTIVA in headless browser, jsTCI where models overlap). Fixtures stored with oracle version, inputs and tolerances. Differences explained, not averaged away | Cp/Ce curves and total mg within tolerance set per model (target ≤ 1%; any exceedance documented with cause) |
| V3 Pump | Compare predicted infused volume and rate with logs/readouts from the **unit's own pumps** for the same programmed cases | Bland-Altman agreement with limits set in advance; pump profile approved only if met |
| V4 Shadow study | In 100+ cases (adjust after variance is known) predictions made, **not used for decisions**, compared with recorded actuals; calibration of the 90% interval checked | Observed coverage near nominal; no systematic bias by procedure category |
| V5 Safety analysis | Hazard log (ISO 14971-style), requirements trace, software lifecycle appropriate to its class (IEC 62304-style) | Hazard log reviewed and open risks accepted by a named clinician |
| Ongoing | Regression tests, audit log review, annual model card review | n/a |

Required before any clinical use (spec section 11): independent validation against established TCI software and local practice review by someone other than the developer. The application displays this requirement prominently until a signed validation record is imported.

---

## 7. Regulatory implications (preliminary, not legal advice)

What I found:

- Under **MDCG 2019-11** ([summary](https://openregulatory.com/mdcg/mdcg-2019-11)), what matters is **intended purpose**. Software that "calculates drug doses or treatment parameters for a patient" is usually medical device software (MDSW). Software that only aggregates data for population-level research is usually not. Patient-specific therapeutic decision-informing software falls under **MDR Rule 11(a)** and starts at **class IIa**, rising to IIb or III by severity of a wrong decision.
- **Module B** (aggregate analytics, de-identified exports) is likely outside the MDR if kept strictly to aggregates.
- **Module A** produces a patient-specific estimate of how much drug to prepare. Even though its purpose is waste reduction, an under-prepared syringe could affect care, so the conservative assumption is that it may qualify as MDSW. Framing the intended purpose carefully (logistics planning, never dosing) helps but does not by itself settle it; a regulator looks at what the function does.
- **In-house exemption, MDR Art. 5(5)** ([summary](https://openregulatory.com/questions/in-house-devices-under-the-mdr)): a health institution may use a device it makes itself without full MDR compliance if, among other conditions, it is not transferred to another legal entity, it is made under an appropriate QMS, the institution documents that no equivalent device meets the patient group's need, it publishes a declaration of conformity to the general safety and performance requirements, keeps technical documentation, and reviews clinical experience. It does not apply to industrial-scale manufacture. In Sweden, in-house manufacture and use is **reported by the vårdgivare to IVO** using their form under HSLF-FS 2021:32 4 kap. 2 § ([IVO form](https://www.ivo.se/globalassets/dokument/publikationer/blanketter/medicintekniska-produkter/info-om-tillverkning-anvandning-egentillverkade-medicintekniska-produkter-211011.pdf)). That form does not mention software; whether the form applies unchanged to software I could not confirm.

Consequences for this project:

1. The *institution* (Region Stockholm / Karolinska), not an individual employee, would be the manufacturer under Art. 5(5). It cannot be used by the developer personally, and cannot be used by other hospitals installing the code.
2. A **public repository plus a public website** looks like making the tool available beyond one institution. That is why D10 keeps Module A off the public homepage, and why I recommend deciding the route (in-house under the hospital's QMS, research/QI use under supervision, or no patient-specific module at all) **before** deploying Module A anywhere reachable by clinicians outside a controlled pilot.
3. Talk to Karolinska's medical-technology/regulatory function early; they own this decision. Also check ownership and permitted use of work done on employer-related topics.
4. Whether the activity is **QI or research** matters for ethics review (Etikprövningsmyndigheten) if you intend to publish. This is relevant to the doctoral ambition.

An option that avoids the problem for the first phase: ship **Module B and the recording form first** (aggregate waste data, no patient-specific estimates), and run the PK/optimiser as a validated, restricted pilot afterwards.

---

## 8. How actual waste reduction will be measured

The spec requires measured, not theoretical, savings. Proposed design:

- **Baseline period** (≥ 4-8 weeks) of recording only: prepared, remaining, opened containers, duration, procedure category. No advice shown.
- **Intervention period:** advice shown. Use an interrupted time series (or stepped introduction by theatre/day if feasible) and compare against baseline, adjusting for procedure mix and duration.
- **Primary outcome:** discarded drug (mg propofol, µg remifentanil) per anaesthetic. **Secondary:** plastic grams, containers opened, cost, rate of "unplanned top-up needed".
- **Safety outcome (must not worsen):** proportion of cases needing an unplanned second preparation or an interruption of infusion because of insufficient drug. Any rise triggers a review of the reserve settings.
- Waste distributions are skewed; report medians and bootstrap intervals, and size the study from the baseline variance rather than guessing now.
- Watch for observer effects: recording itself can reduce waste. The baseline captures this only if it is present from the start, which is another reason to launch recording early.

---

## 9. Phased plan (revised from the brief)

| Phase | Content | Gate to proceed |
|---|---|---|
| 0 | This document reviewed; formulary, pump and TCI-model inventory supplied; regulatory route chosen | Your approval of section 10 |
| 1a | **Recording form + product/item configuration + audit log + CSV export** (no PK). Starts baseline | Unit agrees to record; privacy approach accepted |
| 1b | Manual-infusion timeline, consumption integral, syringe/container configuration, waste calculation, optimiser v1 using explicit-assumption uncertainty | V0 tests pass |
| 2 | Validated PK models (start with Marsh, Schnider, Eleveld propofol; Minto and Eleveld remifentanil), TCI engine, oracle fixtures, pump profile for the unit's pump | V1, V2, V3 pass; model cards complete |
| 3 | Environmental analytics, predicted-vs-actual, calibration, monthly reports | Baseline data exists |
| 4 | Protocol library, procedure-specific calibration, offline deployment, shadow-mode study | V4, V5 passed; regulatory route in place |

Module A is not linked from the public homepage until the Phase 4 gate. The route can exist earlier for development.

---

## 10. What I need from you before Phase 1

1. **Approve or change D1-D10** above, especially D1 (clean-room), D9 (recording first) and D10 (no public link for Module A).
2. **The unit's real formulary and pumps:** which propofol and remifentanil products and sizes, which syringe sizes, which pumps (and whether TCI is on a syringe pump with which models enabled).
3. **Local rules:** the unit's in-use limits and "prepare at time of use" policy, and how narcotic discards are documented, so recording does not conflict with it.
4. **Regulatory contact** at Karolinska, and your intent: internal QI pilot, research/publication, or wider release.
5. **New dependencies:** OK to add `dexie`, `zod`, `fast-check`, `uplot`, `vite-plugin-pwa`?
6. Whether to **change where this lives** later (this repo is a public, small-tools homepage; the engines are written so they can be extracted).

---

## 11. Sources

- SimTIVA: https://www.github.com/luktinghin/simtiva (GPL-3.0)
- PyTCI: https://pypi.org/project/PyTCI/ (MIT)
- jsTCI: https://github.com/jplomas/jsTCI (MIT)
- R `tci`: https://www.stats.bris.ac.uk/R/web/packages/tci/readme/README.html
- OpenTIVA: https://opentiva.readthedocs.io/en/latest/source/userguide.html
- According to PubMed: Eleveld DJ et al. Anesthesiology 2017;126:1005-18. https://doi.org/10.1097/ALN.0000000000001634
- According to PubMed: Windler F et al. Br J Anaesth 2024;133:1459-64. https://doi.org/10.1016/j.bja.2024.10.002
- University of Bonn press summary: https://uni-bonn.de/en/news/strategy-to-reduce-the-amount-of-propofol-waste-in-the-operating-room
- TIVA from a bottle: https://anaesthetists.org/Home/Resources-publications/Anaesthesia-News-magazine/Anaesthesia-News-free-articles/TIVA-from-a-bottle-a-method-for-reducing-plastic-waste-during-total-intravenous-anaesthesia
- Läkemedelsverket document store SmPCs (linked in section 2.4)
- MDCG 2019-11 summary: https://openregulatory.com/mdcg/mdcg-2019-11
- MDR Art. 5(5) summary: https://openregulatory.com/questions/in-house-devices-under-the-mdr
- IVO form for in-house devices: https://www.ivo.se/globalassets/dokument/publikationer/blanketter/medicintekniska-produkter/info-om-tillverkning-anvandning-egentillverkade-medicintekniska-produkter-211011.pdf

Limits of this research: product details come from SmPC/leaflet text on the Swedish document store, not from Fass or the hospital formulary; several citations are marked unverified; regulatory points are from secondary summaries, not the regulation text or an authority's view of this tool.
