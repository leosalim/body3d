# Pipeline — BodyParts3D → GLB

`pipeline/` turns the BodyParts3D 4.0 meshes into the four models in `public/models/` and writes
`src/catalog.generated.js` and `docs/catalog.md`. It runs offline (Python, NumPy, SciPy and
`fast-simplification`), in about two minutes per model on a desktop CPU, and is **deterministic**:
the same inputs give byte-identical GLBs.

Run it again only when the anatomy table, the proportions, the synthesis or the fit sites change —
and then **re-calibrate** (the calibration only holds for the model it was made on):

```bash
node dev/calibrate.mjs <ANSUR II .csv> --write     # src/calibration.generated.js
npm test                                            # fails without a calibration for every model
```

## Setup (once)

```bash
cd body3d/pipeline
python -m venv ~/.cache/body3d/venv                 # outside synced folders: the cache is ~200 MB
~/.cache/body3d/venv/bin/python -m pip install -r requirements.txt     # Scripts\python on Windows
```

The first run downloads the BodyParts3D tables and two zip files (≈ 200 MB) from DBCLS into
`$BODY3D_CACHE` (default `~/.cache/body3d`; an existing `~/.cache/trace-body3d` is reused).

## Run

```bash
PY=~/.cache/body3d/venv/bin/python
$PY catalog.py                 # catalog/bp3d-elements.json: all 2 234 meshes, classified by system
$PY anatomy.py                 # validates the anatomical table against the catalog
$PY build.py                   # the 4 models + src/catalog.generated.js (~8 min)
$PY build.py --sex female --lod high
$PY catalog_doc.py             # docs/catalog.md
$PY check_fit.py               # fit data vs the deformed meshes (~4 min per resolution)
$PY -m ruff check .            # lint (the formatter is not used: the data tables are aligned by hand)
```

`build.py --sex base` writes `base.glb`: BodyParts3D at the male height with no hypertrophy, for
comparisons during development (not shipped). `debug_export.py` writes every raw mesh, one node
per mesh, for `dev/inspect.html`.

## Stages

| Stage | Module | What it does |
|---|---|---|
| download, tables | `bp3d.py` | fetches the release, cross-references concepts and element files, reads OBJ straight from the zips, converts mm → m and to three.js axes |
| catalog | `catalog.py` | classifies all 2 234 meshes by system from their FMA IS-A ancestors |
| selection | `anatomy.py`, `body.py` | the explicit table: 133 muscles + 2 synthesized per side, tissues, bone → segment rules, viscera; loads it as `Part`s (welded) and checks sides |
| joints | `rig.py` | 52 pivots from the bone geometry at full resolution; checks that every bone is near its segment |
| decimation | `build.py`, `meshops.py` | per kind, a triangle budget spread by surface area (uniform density; minimum per part); viscera decimated hard (they only serve as the core) |
| cut | `split.py` | rectus abdominis cut out of the external-oblique mesh along the measured linea semilunaris |
| smoothing | `meshops.py` | Taubin λ/μ, borders fixed (cut seams stay glued) |
| synthesis | `synth.py`, `voxel.py` | latissimus dorsi (fibres draped over a distance field of the trunk) and patellar ligament |
| skinning | `rig.py` | 4 weights per vertex: inverse distance to bone surfaces, restricted to dominant segments and their neighbours |
| proportions, hypertrophy | `morph.py` | female proportions through the skin weights; layered hypertrophy integral, split by region; isotropic limb growth; gains for the FFMI range; one morph per region |
| ambient occlusion | `morph.py` | per-vertex occlusion from the whole-body distance field, at the default FFMI |
| fit data | `fitdata.py` | girth probes (material points of cross-sections) and the exact cubic polynomial of muscle volume |
| export | `export.py`, `gltf.py` | quantized GLB with rig, part index, AO, sparse morph targets, metadata |

Budgets (triangles, soft tissue / skeleton): `high` 260 000 / 110 000, `lite` 90 000 / 40 000
(after cutting and synthesis: 277 182 / 102 560 and 113 697 / 44 913).

Method and numbers: [anatomy.md](anatomy.md) (selection, synthesis, hypertrophy, proportions,
rig) and [body-fit.md](body-fit.md) (fit data).

## Checks built into the build

The build stops (`SystemExit`) instead of writing a wrong model:

- `anatomy.check()` — every concept name and file exists, every muscle has a left side, every
  group has muscles and sits in exactly one fit region, every training-group target exists;
- `body.check_sides` — no sided part with pieces on both sides of the body;
- `rig.check_segments` — every bone within 0.45 m of its segment's pivot;
- the region morphs add up to the uniform morph (error printed, must be < 1 µm; it is 1.5 × 10⁻¹⁵ m);
- no region morph moves a point more than 12 cm per unit weight (`MAX_REGION_DISP`).

`check_isotropy.py` (separate) measures what the isotropic limbs change against plain stacking
([validation/anatomy-checks.md](validation/anatomy-checks.md)).

`check_fit.py` (separate, slower) samples region weights over the plausible range and checks
that (1) region morphs sum to the uniform one, (2) the volume polynomial equals the signed volume
of the deformed mesh (to 1e-6), (3) each probe girth matches the true cross-section of the
deformed mesh. Worst probe errors on the published models: arms ≤ 0.4 %, forearms ≤ 0.2 %, calves
≤ 0.2 %, neck ≤ 1.0 %, chest ≤ 0.8 %, shoulders ≤ 1.6 %, hips ≤ 2.0 % (female), thighs ≤ 2.9 %
(female left) — tolerances 2 % for limbs, 3 % for the thigh, neck and trunk (trunk tapes enter
the fit as a ratio over the typical body, so their systematic part cancels).

## Reproducibility

Random draws are seeded (`sample_surface`, the hull-point configurations of `fitdata.py`), sets
are sorted before use, and NumPy/SciPy operations are deterministic on one machine. Rebuilding
after the 0.2 refactor gave GLBs whose binary chunks are byte-identical to the previous ones —
same geometry, same fit-data fingerprints, so the calibration stayed valid. Compare two builds
with the binary chunk (bytes after the JSON chunk) and `fingerprint()`; labels live in the JSON.

## Traps

- **Landmarks at full resolution.** Iliac crest, intertubercular groove, spinous processes and
  the erector border are measured on the undecimated bones (`ref` in `build.py`); on the lite
  model the slices come out empty.
- **Non-watertight meshes.** BodyParts3D's left femur does not close on the voxel grid: a plain
  flood fill made the whole left thigh "inflate" in the hypertrophy. `voxel.Grid.solid` uses ray
  parity along the three axes with a majority vote — do not replace it with `binary_fill_holes`.
- **Loose regexes.** "cuneiform" matched the cuneiform cartilage of the larynx and sent neck
  muscles' bones to the foot. `rig.check_segments` now stops such a build.
- **Swapped side names.** BodyParts3D names file `FJ1469` "left flexor pollicis brevis" but it lies
  in the right hand; joining meshes by name put one head of the muscle in each hand.
  `anatomy.py` takes it by file (`=FJ1469`), `body.check_sides` guards the rest.
- **Fields applied far away.** A region field applied outside its own limb (the pectoralis
  inserting on the humerus, a voxel residue on the other side) once moved vertices by 30 cm:
  `isotropize_limbs` only acts inside the limb tube and `MAX_REGION_DISP` stops the build.
- **Console encoding.** Logs carry `≈`, `µm`, `–`: the scripts switch stdout to UTF-8 (Windows
  consoles default to cp1252 when redirected).
- **After a build, re-calibrate.** Without it the viewer silently falls back to the uncalibrated
  body; `npm test` catches it.
