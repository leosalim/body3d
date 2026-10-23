# Contributing

Thanks for helping. This file says how to set up, what to run before a pull request, and the few
rules that keep the models, the calibration and the documentation consistent.

## Setup

```bash
npm install
npm run dev            # demo at http://localhost:5190
```

Node 20+. The browser tools (`dev/snapshots.mjs`, `dev/figures.mjs`, `dev/evaluate-views.mjs`,
`dev/view-study.mjs`) use `playwright-core`, which downloads no browser: they launch the installed
Google Chrome, or the Chrome/Chromium executable named by `CHROME`.

## Before a pull request

```bash
npm run check                         # eslint + type declarations (tsc) + node:test suites
npm run build                         # demo, library and standalone bundles
```

If you touched anything that draws (`src/viewer.js`, `material.js`, `stage.js`, `views.js`,
`best-view.js`, `posing.js`, `rings.js`, `split-view.js`, the models):

```bash
npm run dev                                            # in another terminal
git stash; node dev/snapshots.mjs /tmp/before; git stash pop
node dev/snapshots.mjs /tmp/after --compare /tmp/before
```

The snapshots render 17 scenarios with software rendering (SwiftShader), deterministically: any
pixel or returned value that changes is listed. Explain intended changes in the pull request.

## Changing the models (pipeline)

Python 3.11+ in a virtual environment (see [docs/pipeline.md](docs/pipeline.md)):

```bash
cd pipeline
python -m pip install -r requirements.txt ruff
python -m ruff check .
python build.py                        # ~8 min, writes public/models/*.glb and src/catalog.generated.js
python check_fit.py                    # several minutes: morphs, volume polynomial, girth probes
cd .. && node dev/calibrate.mjs <ANSUR II .csv> --write && npm test
python pipeline/catalog_doc.py         # if the anatomical table changed
```

- A rebuild changes the fit-data fingerprint whenever the geometry changes; **re-calibrate** or
  `npm test` fails (and the viewer would silently draw the uncalibrated body).
- Pure refactors of the pipeline must keep the GLB binary chunks byte-identical — compare them.
- Labels, groups, training groups and regions live only in `pipeline/anatomy.py`; never edit
  `src/catalog.generated.js` or `docs/catalog.md` by hand.
- Ids (`biceps-long-head`, `delt-front`, `upperarm_l`) are a public contract: renaming one is a
  breaking change.

## Adding a language

1. Interface strings: add a locale to `STRINGS` in `src/i18n.js` (every key of `en`; a test checks
   it).
2. Anatomical labels: add a column to the tables of `pipeline/anatomy.py` and to
   `pipeline/catalog_js.py`, regenerate the catalog (`python pipeline/catalog_js.py`) — no model
   rebuild needed.
3. Pose labels: `src/poses.js`.

## Style

- JavaScript: plain ES modules, no build step for the library, two-space indentation, no
  semicolons; `npm run lint`. Public API changes update `src/index.d.ts` (a test compares it with
  the exports) and `docs/api.md`.
- Python: `ruff check`; the formatter is not used — the anatomical tables are aligned by hand.
- Comments say *why*; English throughout the library.
- Numbers in the documentation and the paper come from a command that prints them; cite the
  command or the test.

## Reporting a problem

Include the browser and GPU (`chrome://gpu`), the model and resolution, the activation list or
measures that reproduce it, and a screenshot. For anatomical errors, name the structure and a
reference (an atlas page or the FMA concept).

## Licences

By contributing you agree that your code is released under the MIT licence and your changes to the
models under CC BY 4.0, with BodyParts3D's attribution kept ([NOTICE.md](NOTICE.md)).
