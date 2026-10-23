# Out-of-sample validation on ANSUR II

How well the tape-measure fit ([../body-fit.md](../body-fit.md)) predicts real bodies it was not
calibrated on, against statistical baselines. Reproduce with the public ANSUR II file:

```bash
node dev/calibrate.mjs ergonomics.csv --holdout --json cal-half.json      # calibrate on the even rows
node dev/validate-ansur.mjs ergonomics.csv --calibration cal-half.json --json out.json
node dev/validate-ansur.mjs ergonomics.csv --calibration cal-half.json --body-fat bmi   # blind body fat
node dev/validate-ansur.mjs ergonomics.csv --calibration cal-half.json --spread 1       # ablation
node dev/asymmetry-ansur.mjs ergonomics.csv --calibration cal-half.json                 # synthetic asymmetry
```

Run on 2026-10-07 with the models of version 0.2 (fingerprints `31cfad5b` male, `14a85e2e`
female). The scripts check that the calibration they are given belongs to the model.

## Protocol

- **Data**: ANSUR II (U.S. Army, 2012): 4 082 men and 1 986 women, 93 measurements each, in the
  order of the public file (men first). Calibration on the even-numbered rows (2 041 men, 993
  women); validation on the **first 600 odd-numbered rows of each sex**, never seen by the
  calibration — no other selection.
- **Inputs per person**: height, weight, the right-side tapes the fit uses (flexed biceps, flexed
  forearm, thigh at the gluteal fold, calf, neck, shoulders, chest — men only — and buttocks as
  hips), and body fat.
- **Body fat** is a proxy: ANSUR II has no reference measurement (DXA, hydrostatic weighing). By
  default it is the US Navy formula on the person's own neck, waist or abdomen and (women) hips,
  given to the fit as a measured value (`bodyFatMethod: 'NAVY'`, ±4 points). Those tapes therefore
  leak into the "FFMI + body fat" column for the neck and hips. With `--body-fat bmi` it is
  Deurenberg's formula on BMI, age and sex instead, which reads no tape (±4 points): blind for
  every site, but biased for muscular people.
- **Fit with every tape**: time, solver iterations, standardized residuals, tapes flagged as
  outliers, how far the fitted FFMI moved from the measured one.
- **Leave one out**: each tape is hidden and predicted from (a) height, weight and body fat alone —
  the typical body of the FFMI; (b) one neighbouring tape (biceps ↔ forearm, thigh ↔ calf, neck →
  shoulders, shoulders → chest, chest → shoulders, hips → thigh); (c) all the other tapes;
  (d) as a diagnostic, the other limb tapes only. The prediction goes through the same model → tape
  conversion as the fit (height scale, the ratio on the trunk, skin and fat).
- **Baselines**, trained on the calibration half: the sex mean of the site; and a **ridge
  regression** of the hidden tape on exactly the fit's inputs for each column (height, weight, body
  fat, plus the given tapes), standardized features, penalty by 5-fold cross-validation
  (`dev/lib/ridge.mjs`).

## Results (default: Navy body fat, `POPULATION_SPREAD` = 3)

| | Men | Women |
|---|---|---|
| people | 600 | 600 |
| fit with every tape, mean (p95) | 8.6 ms (13.7 ms) | 6.6 ms (11.7 ms) |
| iterations, median / p95 | 5 / 5 | 3 / 5 |
| standardized residuals \|z\|, median / p95 | 0.15 / 0.94 | 0.22 / 0.81 |
| tapes flagged as outliers | 0 % | 0 % |
| fitted − measured FFMI, mean [p5, p95] | +0.03 [−0.64, +0.74] | −0.01 [−0.49, +0.57] |

Fit times vary between runs on the same machine (Node.js 22, Intel i7-12700F): repeated timings of
the same 600 fits gave means of 8.5–14.5 ms (men) and 7.0–11.2 ms (women); the table shows the
first run.

Predicting a hidden tape, RMS error (cm): fit and ridge regression with the same information.

| Men | sex mean | h, w, fat: ridge | fit | + one: ridge | fit | + all: ridge | fit | + limbs: ridge | fit | bias (fit, all) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| biceps (flexed) | 3.45 | 1.65 | 1.60 | 1.33 | 1.36 | 1.26 | 1.51 | 1.30 | 1.33 | −0.26 |
| forearm | 2.16 | 1.10 | 1.09 | 0.89 | 0.92 | 0.86 | 0.87 | 0.88 | 0.90 | +0.15 |
| thigh | 5.96 | 2.30 | 2.60 | 2.26 | 2.54 | 1.59 | 2.46 | 2.24 | 2.52 | −0.27 |
| calf | 3.06 | 1.66 | 1.66 | 1.64 | 1.61 | 1.55 | 1.58 | 1.61 | 1.59 | +0.01 |
| neck¹ | 2.63 | 1.39 | 1.37 | 1.37 | 1.45 | 1.23 | 1.50 | 1.25 | 1.21 | −0.13 |
| shoulders | 6.44 | 3.18 | 3.09 | 2.91 | 3.05 | 2.87 | 3.05 | 3.06 | 3.10 | +0.34 |
| chest | 8.69 | 3.34 | 4.55 | 3.06 | 4.23 | 2.65 | 4.43 | 2.83 | 4.70 | −0.37 |
| hips | 7.77 | 2.55 | 2.85 | 1.99 | 2.20 | 1.95 | 2.26 | 1.96 | 2.17 | +0.01 |
| **limb mean** | **3.66** | **1.68** | **1.74** | **1.53** | **1.61** | **1.31** | **1.61** | **1.51** | **1.59** | |

| Women | sex mean | h, w, fat: ridge | fit | + one: ridge | fit | + all: ridge | fit | + limbs: ridge | fit | bias (fit, all) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| biceps (flexed) | 2.88 | 1.33 | 1.42 | 1.17 | 1.28 | 1.18 | 1.33 | 1.17 | 1.30 | +0.16 |
| forearm | 1.75 | 0.94 | 0.93 | 0.83 | 0.88 | 0.79 | 0.84 | 0.82 | 0.86 | −0.08 |
| thigh | 5.61 | 2.21 | 2.52 | 2.13 | 2.43 | 1.76 | 2.33 | 2.14 | 2.44 | −0.14 |
| calf | 2.88 | 1.65 | 1.67 | 1.59 | 1.66 | 1.46 | 1.53 | 1.56 | 1.68 | −0.13 |
| neck¹ | 1.83 | 1.19 | 1.19 | 1.14 | 1.22 | 1.06 | 1.13 | 1.07 | 1.08 | +0.10 |
| shoulders | 5.04 | 2.92 | 2.89 | —² | —² | 2.72 | 2.92 | 2.75 | 2.86 | −0.01 |
| hips¹ | 7.42 | 2.12 | 2.62 | 1.78 | 2.16 | 1.79 | 2.36 | 1.79 | 2.33 | +0.21 |
| **limb mean** | **3.28** | **1.53** | **1.64** | **1.43** | **1.57** | **1.30** | **1.51** | **1.42** | **1.57** | |

¹ The Navy body fat reads the neck (and, for women, the hips): for those sites the "h, w, fat"
columns are not blind. ² The partner of the shoulders is the chest, which is not used for women.

### With a girth-free body fat (`--body-fat bmi`)

Limb means, RMS (cm), ridge / fit:

| | h, w, fat | + one | + all | + limbs |
|---|---|---|---|---|
| men | 1.74 / 1.88 | 1.53 / 1.62 | 1.32 / 1.69 | 1.51 / 1.60 |
| women | 1.57 / 1.69 | 1.48 / 1.63 | 1.31 / 1.57 | 1.46 / 1.61 |

Blind to every tape, the typical body still halves the error of the sex mean, but loses
0.05–0.14 cm against the Navy body fat and gains biases (men, with all tapes: thigh −1.36 cm, chest
−1.71 cm). BMI attributes muscle to fat in muscular soldiers: the FFMI is underestimated, and the
fit raises it by +0.34 on average (p95 +1.31) to reconcile the tapes.

## Ablation: the width of the population prior

`POPULATION_SPREAD` multiplies the standard deviations of the between-region covariance learnt
on ANSUR II. Same protocol, spreads 1, 2 and 3 (limb mean RMS with all other tapes; residuals):

| Spread | Men: limbs, all others | Women: limbs, all others | Men \|z\| p50 / p95 | Women \|z\| p50 / p95 |
|---:|---:|---:|---:|---:|
| 1 | 1.60 cm | 1.53 cm | 0.37 / 1.28 | 0.38 / 1.22 |
| 2 | 1.53 cm | 1.51 cm | 0.21 / 1.06 | 0.28 / 0.96 |
| 3 (default) | 1.61 cm | 1.51 cm | 0.15 / 0.94 | 0.22 / 0.81 |

Per site the differences stay within 0.2 cm (biceps, men: 1.33 / 1.35 / 1.51; thigh: 2.51 / 2.33 /
2.46). Within this homogeneous population a spread of 2 predicts marginally best. The narrower
prior also removes the drag of the trunk tapes on the men's biceps: with all tapes it is predicted
to 1.33 and 1.35 cm at spreads 1 and 2, as well as from one neighbouring tape. The default of
3 is a design choice for training populations, where between-region variation is expected to be
wider than among soldiers (cyclists with large thighs, people who skip leg training,
bodybuilders). The only evidence for it is anecdotal — with spread 1, one real thigh 15 % above
typical was flagged as an outlier during development —; the study that would settle it is in
[studies.md](studies.md#2-a-trained-population). On ANSUR II its cost is ≤ 0.2 cm per site.

## Asymmetry (synthetic)

ANSUR II measures the limbs on the right side only, so the calibration ties both sides with an
assumed between-side deviation of 2 % of the girth, and real asymmetry cannot be validated here
([studies.md](studies.md#1-both-sides-of-the-limbs) describes the bilateral study). What can be
measured is how much of a known difference the fit lets through: for 300 people of each sex, each
limb's left tape is set to the right one × (1 + δ), every tape is fitted, and the fitted
left − right difference of the drawn body is compared with the imposed one
(`dev/asymmetry-ansur.mjs`).

| Limb | Men, δ = 2 / 5 / 10 % | Women, δ = 2 / 5 / 10 % |
|---|---|---|
| arm | 0.82 / 0.81 / 0.80 | 0.49 / 0.50 / 0.50 |
| forearm | 0.82 / 0.82 / 0.82 | 0.60 / 0.60 / 0.60 |
| thigh | 0.81 / 0.81 / 0.80 | 0.49 / 0.49 / 0.48 |
| calf | 0.85 / 0.85 / 0.85 | 0.66 / 0.66 / 0.66 |

Share of the imposed difference the fitted body reproduces. With equal tapes the fitted
difference is ≤ 0.01 cm. At δ = 10 % the measured (right) side moves up by 0.1–0.35 cm: the larger
side pulls the other along. Women's tapes carry more uncertainty (more estimated fat), so the
prior that ties the sides weighs more: about half of a real difference would be drawn.

## Reading the results

- **The typical body of the FFMI already halves the error** of the population mean on every site
  (biceps 3.45 → 1.60 cm, thigh 5.96 → 2.60 cm): muscle mass and body fat explain most of a girth.
  With the same three inputs, a ridge regression does about as well on the limbs (1.68 vs 1.74 cm,
  men) and better on the trunk (chest 3.34 vs 4.55 cm), where the model's fixed skeleton cannot
  follow skeletal breadth.
- **With more tapes the regression pulls ahead**: 0.2–0.3 cm on the limb mean with all tapes, 0.9 cm
  on the men's thigh (1.59 vs 2.46), 1.8 cm on the chest. The ridge learns how fat and skeletal
  breadth co-vary between sites — a large hip girth predicts a large thigh (its thigh error drops
  from 2.24 to 1.59 cm when the trunk tapes are added). The fit can only explain a tape with muscle:
  its prior holds the covariance of *muscle* between regions, and each site's fat deviation is
  independent noise. That is the price of drawing one consistent anatomical body, and the first
  thing to improve (correlated fat residuals, [../decisions.md](../decisions.md#open-questions)).
- **More tapes do not always help the fit.** One neighbouring tape beats all of them for the men's
  biceps (1.36 vs 1.51), neck, chest and hips, and the women's biceps and hips; the other limb
  tapes alone predict the men's biceps (1.33) and neck (1.21) better than all tapes. Trunk tapes
  enter as ratios and mostly carry fat and skeletal breadth; with a wide prior the fit moves trunk
  regions to match them, and the muscle correlations drag the arm and neck along. The regression,
  which weighs each input by its predictive value, never loses from more inputs.
- **Trunk sites remain the hardest** (shoulders ~3 cm, chest ~4.4 cm) for the same reason.
- **Biases are small** (|bias| ≤ 0.37 cm) and the **fitted FFMI stays close** to the measured
  one (90 % within ±0.75): the volume term and the FFMI term hold the total. Both are estimated
  from the same tapes (Navy), so this agreement is not an independent check of body composition.
- **No real body was flagged as an outlier** (0 of ~9 000 used tapes).
