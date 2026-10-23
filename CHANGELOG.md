# Changelog

## Unreleased

- `LICENSE` holds the MIT text only, so tools and GitHub recognise it; `NOTICE.md` now opens by
  saying the models and the anatomical catalog are not covered by it and keep CC BY 4.0. No licence
  changed.

## 0.3.0 — 2026-10-23 — first public release

The first version published on its own repository. The models are the ones of 0.2.0 (same
fingerprints, same calibration); everything below was added since.

### Poses from the page, breathing

#### Added

- `setPose` takes a pose object `{ joints, ground, frame, view }` besides a named pose: `ground:
  'body'` rests the body on the lowest point of its skin (hands, knees, the back), `frame: 'pose'`
  frames the camera on the posed body. First user: Trace's yoga poses.
- A breathing shell: `breath` option, `setBreath`, `breathState`, the `breath` event, and the pure
  `breathAt`, `breathPeriod`, `normalizeBreath`, `BREATH_PHASES`, `BREATH_DEFAULTS` (src/breath.js).

#### Changed

- Pose transitions take 0.7–1.6 s by how far they go; a body resting on its body is grounded on
  every frame of the transition, and the camera moves with it when the view changes too.
- A stalled frame (shader compilation on the first render, a long task) pauses the running
  transitions instead of letting them end unseen — an animated pose right after loading was
  invisible before.

### Building blocks

#### Added

- Exports for tools that stage the body in their own scene: `loadModel`, `cloneModel`, `modelUrl`,
  `poseQuaternions`, `useDualQuaternionSkinning` and `BodyShape` (docs/api.md "Building blocks").
  Nothing that draws changed. First user: a scene builder that draws exercise icons.

### Evaluation after review

The library, the models and the calibration are unchanged; the evaluation is broader and the
documentation corrects claims it could not support.

#### Added

- `dev/validate-ansur.mjs` compares the fit with two baselines trained on the calibration half —
  the sex mean and a ridge regression on the same inputs (`dev/lib/ridge.mjs`) —, adds a
  limb-tapes-only diagnostic and `--body-fat bmi`, a girth-free body fat (Deurenberg), so the
  typical-body column can be blind to every tape. The ANSUR II split lives in `dev/lib/holdout.mjs`.
- `dev/asymmetry-ansur.mjs`: how much of a synthetic left–right difference the fit reproduces.
- `dev/muscle-volumes.mjs`: muscle volumes of the typical body from the meshes, against MRI.
- `pipeline/check_isotropy.py`: the isotropic limbs against plain stacking.
- Study kits for what needs people (docs/validation/studies.md): `dev/validate-measured.mjs` with
  `dev/measured-template.csv` (both sides of the limbs, a trained population, the population
  spread) and `dev/view-study.mjs` (coaches choose views; Fleiss' κ and agreement with the algorithm).
- `dev/glb.mjs` reads the meshes (`readSoftMeshes`, `partVolumes`); a test checks that the muscle
  volume of the meshes equals the fit's volume polynomial on all four models (118 tests).

#### Documentation

- The isotropic limbs do not conserve each level's volume, as the docs said: they stay linear (the
  region morphs remain exactly additive) and change a limb's own muscle volume by −9 % to +23 %
  against stacking (docs/validation/anatomy-checks.md).
- The rise of SMM/FFM with training is documented in direction only (Midorikawa et al. 2007; Abe et
  al. 2018); its slope is an assumption, and its effect is bounded.
- The fit is within 0.1 cm of a ridge regression with height, weight and body fat, and 0.2–0.3 cm
  behind it on the limbs when every other tape is given; body composition in the validation is a
  proxy; the population spread of 3 is a design choice, not a measured optimum; asymmetry and the
  automatic views are untested with people (docs/validation/ansur-holdout.md, studies.md).
- The view distribution is reported for the current models; fit times as a range across runs.
- The paper is revised accordingly, with related work on learned inner anatomy (OSSO, SKEL, HIT)
  and bodies from measurements (Seo & Magnenat-Thalmann, Wuhrer & Shu, Anny).

## 0.2.0 — 2026-10-07 — preparing for open source

Rendering, geometry and the fit are unchanged: the rebuilt models have byte-identical geometry and
fit data, the calibration reproduces bit for bit, and 17 visual scenarios render pixel for pixel
as before.

### Breaking

- The package is `body3d` (was `@trace/body3d`); `three` is a **peer dependency**, and
  `body3d.js` no longer bundles it — use `body3d/standalone` for plain pages.
- English is the default locale: pass `locale: 'pt-BR'` to keep Portuguese labels and interface
  text.
- `TRACE_GROUPS` / `TRACE_CODES` are replaced by `TRAINING_GROUPS` (`{ id, label: { en, 'pt-BR' },
  targets }`); every name that resolved before still resolves to the same targets (checked on all
  377 names). `GROUPS` and `MUSCLES` carry `label: { en, 'pt-BR' }`; groups have `area` instead of
  `region`.
- The custom element is `<body3d-viewer>` by default (`defineBodyElement('trace-body')` keeps the
  old tag).
- `POSES[sex][i].label` is `{ en, 'pt-BR' }`; `viewer.poses` returns it in the viewer's locale.
  Pose activations use the English training-group names.
- The fit note `sem-gordura` is now `no-body-fat`.
- GLB `extras.format` is `body3d`, `version` 2, with English part labels and `group.area`.

### Added

- `locale`, `setLocale()`, `strings` overrides; `aliases`; name prefixes `group:`, `muscle:`,
  `training:`; `setColors()`; `clearModelCache()`; `body3d-viewchange` element event and
  `body3d:viewchange` iframe message; `locale` in the element and the iframe.
- TypeScript declarations (`src/index.d.ts`), checked by `tsc` and against the runtime exports.
- `prepareFitModel(body, { calibration, populationSpread })`.
- Tests: activations, views and best view (with a fake renderer), the model contract, poses,
  i18n, exports (111 tests, from 59). ESLint. Ruff for the pipeline.
- Tools: `dev/snapshots.mjs` (visual regression), `dev/figures.mjs` (documentation figures),
  `dev/lib/` (ANSUR II reader, matrix helpers); `validate-ansur.mjs --spread` and `--json`.
- Documentation in English: API, architecture, model format, pipeline, anatomy, body fit, views,
  design decisions, references, the full out-of-sample validation; a LaTeX paper.

### Fixed

- `dev/validate-ansur.mjs` looked the held-out calibration up by sex, but `calibrate.mjs --json`
  keys it by model fingerprint: the "out-of-sample" validation silently used the repository
  calibration (in-sample). It now uses the given one and fails loudly on a mismatch.
- The fit returned NaN when an FFMI and weight were given without a height.
- The female population FFMI used when there is no body fat was 17.1; ANSUR II with the same
  computation gives 17.7.
- `dispose()` left the container's pointer listeners attached (a re-mounted custom element kept
  firing events from the old viewer); the ground texture and geometry were not freed.
- The tooltip built HTML from labels; it now uses text nodes.
- The pipeline logs crashed when redirected to a file on Windows (cp1252).
- `check_fit.py` held the trunk sites to 2 %, the documentation to 3 %; aligned at 3 % (the
  female hips probe measures 2.04 % at its worst sampled weights).
- The demo and embed pages requested a favicon that does not exist.

### Changed

- `viewer.js` split into modules (views, best view, picking, split view, posing, shape, rings,
  stage, loader, dom, i18n, tween); ~950 lines from ~1 400.
- The best-view algorithm is a pure function with a render callback (`computeBestView`).
- The pipeline is commented in English, lints clean with ruff and no longer crashes on Windows consoles.

## 0.1.0 — 2026-09-29 … 10-05

First version inside the Trace application: the viewer, the pipeline, poses, split view, the
automatic default view, and the tape-measure fit calibrated on ANSUR II.
