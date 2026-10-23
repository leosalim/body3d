# Paper

`body3d.tex` describes the system: the pipeline from BodyParts3D, the layered hypertrophy and its
exact regional morphs, the runtime, the automatic view, the tape-measure fit with its ANSUR II
calibration, and the evaluation. `body3d.pdf` is the compiled version.

```bash
latexmk -pdf body3d.tex        # TeX Live or MiKTeX; figures come from ../docs/images/
```

Every number in the paper is produced by a command of the repository:

| Numbers | Command |
|---|---|
| model sizes, triangles, morph targets, FFMI ranges | `python pipeline/build.py` (log) |
| probe errors, volume polynomial, morph sums | `python pipeline/check_fit.py --lod high --lod lite` |
| calibration statistics | `node dev/calibrate.mjs <ANSUR II .csv>` |
| Table 1, girth-free body fat, ablation | `node dev/calibrate.mjs <csv> --holdout --json cal.json` then `node dev/validate-ansur.mjs <csv> --calibration cal.json [--body-fat bmi] [--spread 1\|2\|3]` (docs/validation/ansur-holdout.md) |
| Table 4 (asymmetry) | `node dev/asymmetry-ansur.mjs <csv> --calibration cal.json` |
| Table 3 (quadriceps vs MRI) | `node dev/muscle-volumes.mjs` |
| isotropic limbs vs stacking, morph sums | `python pipeline/check_isotropy.py` (docs/validation/anatomy-checks.md) |
| SMM/FFM sensitivity (shoulders −2.7 cm) | docs/anatomy.md §5 |
| fit times | `node dev/validate-ansur.mjs` (varies between runs; docs/validation/ansur-holdout.md) |
| view distribution over 372 exercises | `node dev/evaluate-views.mjs <exercises.json> <out>` (without `--write`) |
| Table 2 | the benchmark described in docs/architecture.md (Playwright, medians) |
| figures | `node dev/figures.mjs` |
| reproducibility claims | `node dev/snapshots.mjs`, GLB binary-chunk comparison (docs/pipeline.md) |
