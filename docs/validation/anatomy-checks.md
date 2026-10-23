# Checks of the model's geometry

What the pipeline's own choices do to the anatomy, measured on the published models (version 0.2,
fingerprints `31cfad5b` male, `14a85e2e` female). The tape-measure fit is validated separately
([ansur-holdout.md](ansur-holdout.md)); the checks of the fit data against the meshes are in
`pipeline/check_fit.py` ([../pipeline.md](../pipeline.md#checks-built-into-the-build)).

```bash
cd pipeline && python check_isotropy.py     # isotropic limbs vs plain stacking (~2 min per model)
node dev/muscle-volumes.mjs                  # muscle volumes of the typical body vs MRI
```

## 1. The region morphs are exactly additive

The hypertrophy is linear in the per-region emphasis, and every later step (vector smoothing,
Taubin with fixed borders, the isotropic limbs below, the scale to the model height) is linear in
the displacement, so the 14 region morphs add up to the uniform morph. The build checks it on
every vertex: the largest difference is **1.5 × 10⁻¹⁵ m** on both models — float64 rounding.

## 2. Isotropic limbs against plain stacking

`morph.isotropize_limbs` replaces, mid-limb, the stacking displacement by a radial scale about
the centre of each cross-section ([../anatomy.md](../anatomy.md#6-hypertrophy-in-layers)). How it
is built matters for what it preserves:

- the scale per level, `s = √(1 + P·m̄ / A)` (hull area `A`, perimeter `P`, mean outward
  displacement `m̄` of the hull's vertices), is computed **once**, from the stacking displacement
  per unit of gain on the rest shape;
- it then enters as a fixed vector field, multiplied by the gain like any other field. The
  hypertrophy stays linear and the region morphs exactly additive (§1);
- what it matches is the outline area that stacking adds **at unit gain, to first order**
  (perimeter × mean thickness). It does not conserve the muscle volume of each level, at unit
  gain or elsewhere: stacking thickens deep and superficial layers differently, the hull's vertices
  are not evenly spaced along the perimeter, and a muscle lying over the limb is scaled rather
  than translated.

Measured over the drawable gain range (`pipeline/check_isotropy.py`, right side; "own" = the
limb's own muscles):

| Limb | own muscle volume, isotropic ÷ stacking | mid-limb outline area added, isotropic ÷ stacking |
|---|---|---|
| upper arm | male 0.97–1.00, female 1.04–1.07 | male 1.05–1.06, female 1.16–1.18 |
| forearm | male 1.16–1.17, female 1.21–1.23 | male 0.86–0.88, female 0.87–0.88 |
| thigh | male 0.94–0.95, female 0.91–0.92 | male 0.91–0.92, female 0.87–0.88 |
| lower leg | male 0.99–1.01, female 0.97–0.99 | male 0.97–0.98, female 0.95–0.96 |

The upper arm's field also enlarges muscles lying over it near the axilla — latissimus dorsi
(+227 cm³ at unit gain, male), deltoid — by a further 0.2–0.4 L across the male range (≤ 0.1 L
female), which stacking would only have translated.

Consequences:

- **The FFMI stays calibrated.** The table FFMI → gain is computed after this step, on the
  measured volume of the final field.
- **The share between limbs and trunk barely moves.** For the uniform field at the top of the
  range, the limbs take 69.4 % of the added volume instead of 68.7 % (male) and 76.4 % instead of
  77.1 % (female).
- **In the fit it does not matter for the limbs**: the typical body's limbs are set by the ANSUR
  II girth curves, whatever volume a unit of weight adds ([../body-fit.md](../body-fit.md)).
- What remains is shape: a limb region's weight inflates the latissimus insertion a little.

An exact alternative — rescaling the radial field per level so each level's volume matches
stacking at a reference gain — would keep linearity; it was not adopted because the calibration
already absorbs the volume and the shapes were approved as they are
([../decisions.md](../decisions.md), D12).

## 3. Muscle volumes against MRI

The fit never sees the inside of the body: the tapes constrain hull perimeters and the FFMI the
total muscle volume. As a coarse check of the anatomy, `dev/muscle-volumes.mjs` computes the
volume of every muscle of the typical body (`src/calibration.generated.js`) from the exported
meshes — their sum matches the fit's volume polynomial to 0.01 L at every FFMI — and compares the
right quadriceps with the MRI study of Maden-Wilkinson et al. (2020): 52 untrained and 16
long-term resistance-trained young men, dominant thigh.

That study reports height and mass but not body composition, so the model is evaluated over a
range of assumed body fat: a person's quadriceps is the typical body's at their normalized FFMI,
scaled by their lean mass over the model's.

| Group | MRI, cm³ (mean ± SD) | Model, cm³ (assumed body fat) |
|---|---|---|
| untrained, 176 cm, 73 kg | 1 838 ± 263 | 1 943 (20 %) · 2 079 (16 %) · 2 216 (12 %) |
| trained, 183 cm, 91 kg | 2 882 ± 308 | 2 704 (16 %) · 2 873 (12 %) · 3 041 (8 %) |

The quadriceps as a whole is plausible: within −0.6 to +1.4 SD of the measured means for plausible
body fat. The difference between the groups is smaller in the model: +37 % to +39 % for the same
body-fat gap between them, against +57 % measured — long-term trained men carry more quadriceps
than the typical (ANSUR II) body of their FFMI.

The split between its heads is not:

| | vastus lateralis | vastus intermedius | vastus medialis | rectus femoris |
|---|---|---|---|---|
| MRI (both groups) | 33 % | 29–30 % | 24 % | 13 % |
| model (any FFMI) | 37 % | 18 % | 20 % | 24–25 % |

BodyParts3D's rectus femoris takes about twice its MRI share of the quadriceps and the vastus
intermedius about 0.6 of it. The difference comes from the source meshes (one donor, segmented
under different conventions — the boundary between the intermedius and its neighbours is hard to
see), not from the hypertrophy, which keeps the shares almost constant (± 1 point from FFMI 17 to
26). Volumes are therefore plausible per muscle group, not per head; the viewer's activations are
per group, which is what the colours show.

Sources: Maden-Wilkinson TM, Balshaw TG, Massey GJ, Folland JP (2020). What makes long-term
resistance-trained individuals so strong? A comparison of skeletal muscle morphology,
architecture, and joint mechanics. *J Appl Physiol* 128:1000–1011.
