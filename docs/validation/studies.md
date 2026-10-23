# Studies that need people

Three questions the available data cannot answer. Each has a protocol a small team can run in an
afternoon or two, and a script in `dev/` that turns the answers into the numbers to report. None
has been run yet: the paper and [ansur-holdout.md](ansur-holdout.md) say so where it matters.

Measuring people is research with human participants: get written informed consent, record no
names (use an `id`), keep the files out of the repository, and follow the rules of the place where
you run it (in Brazil, the LGPD and, for publication, an ethics committee — CEP/CONEP).

## 1. Both sides of the limbs

**Question.** Does the fitted body follow a real left–right difference, and how large are real
differences? ANSUR II measures the limbs on the right side only, so the calibration ties both
sides with an *assumed* between-side standard deviation of 2 % of the girth (`dev/calibrate.mjs`).
A synthetic test ([ansur-holdout.md](ansur-holdout.md#asymmetry-synthetic)) shows the fit
reproduces 80–85 % of an imposed difference for men and 48–66 % for women; real asymmetry is
untested.

**People.** 20–40 adults, both sexes; include people with a known asymmetry (a past injury, a
dominant side in a one-sided sport) as well as ordinary ones.

**Measures.** Height, weight, body fat (record the method), and on **both sides**: arm (flexed,
at the peak of the biceps), forearm (largest girth), thigh (at the gluteal fold), calf (largest
girth); once: neck, shoulders, chest (men), waist (women) or abdomen at the navel (men), hips.
The same measurer for everyone, a non-stretch tape, two measurements per site (a third when they
differ by more than 1 cm), the mean recorded. Note the dominant side.

**File.** One row per person in `dev/measured-template.csv` (codes as columns, cm).

**Analysis.**

```bash
node dev/validate-measured.mjs people.csv --json bilateral.json
```

reports, per limb, the measured asymmetry (SD of (L − R) / mean, in %) and how much of each
measured difference the fitted body reproduces (slope of fitted against measured L − R).

**Decision.** If the measured asymmetry differs clearly from 2 %, change the side term in
`dev/calibrate.mjs` and recalibrate; if the slope stays well below 1 for real differences, the
prior ties the sides too strongly for the product's use ("one leg bigger than the other").

## 2. A trained population

**Question.** Does the population prior, learnt on soldiers, suit people who train, and which
`POPULATION_SPREAD` (the width of the prior) should the library use? It is 3 by design choice;
on ANSUR II a spread of 2 predicts marginally better ([ansur-holdout.md](ansur-holdout.md#ablation-the-width-of-the-population-prior)).

**People.** 30 or more people who have trained with weights regularly for at least a year — the
library's audience —, both sexes, a range from recreational to competitive.

**Measures.** As in study 1 (both sides if possible: the two studies can share participants),
with body fat from one device for everyone — bioimpedance (BIA) at least, DXA if available —
recorded with its method (`BIA`, `DEXA`, …), so the fit uses the right uncertainty.

**Analysis.**

```bash
node dev/validate-measured.mjs trained.csv --spreads 1,2,3 --json trained.json
```

For each spread: standardized residuals (with a well-sized prior, |z| p95 ≈ 2), tapes flagged
as outliers (real tapes should not be), and the leave-one-out RMS of every tape.

**Decision.** The smallest spread that flags no real tape and does not raise the leave-one-out
error becomes `POPULATION_SPREAD` (`src/fit.js`), with this study cited in docs/decisions.md.

## 3. The automatic view

**Question.** Do people who teach exercise agree with the view `bestView()` picks? The views of
the 372-exercise catalog were reviewed by the author only ([../views.md](../views.md)).

**People.** 3–5 raters who teach exercise (coaches, physiotherapists, physical education
teachers), working independently.

**Material.** 30 exercises, the most popular of a catalog stratified by the azimuth the algorithm
chooses, each rendered from the eight azimuths it considers (whole body, no zoom):

```bash
npm run dev     # another terminal
node dev/view-study.mjs build exercises.json study --count 30 --lang pt-BR
```

Send the `study` folder **without `key.json`** (the algorithm's choices). Each rater opens
`index.html` (it works offline), clicks the best view of every exercise, ticks the others that
would also do and whether one side is not enough, and downloads their answers (~20 minutes).

**Analysis.**

```bash
node dev/view-study.mjs analyze study answers/*.json --json views.json
```

reports the agreement of the raters among themselves (Fleiss' κ, share of rater pairs choosing
the same view) and of the algorithm with them (same best view, among the acceptable views, equal
to a strict majority), per exercise and overall.

**Reading.** The algorithm is as good as a person when it agrees with the raters about as often as
they agree with each other. The exercises where it is not among the acceptable views are the ones
to fix (a catalog `view` override, or a change of the score in docs/views.md). Exercises marked
"needs both sides" by most raters are candidates for opening in the split view.
