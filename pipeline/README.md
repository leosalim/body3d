# pipeline

Builds the body3d models from BodyParts3D 4.0. Python 3.11+, NumPy, SciPy, fast-simplification.

```bash
python -m venv ~/.cache/body3d/venv && ~/.cache/body3d/venv/bin/python -m pip install -r requirements.txt
~/.cache/body3d/venv/bin/python build.py          # public/models/*.glb + src/catalog.generated.js
node ../dev/calibrate.mjs <ANSUR II .csv> --write # then re-calibrate (the calibration is per model)
```

Stages, checks, reproducibility and traps: [../docs/pipeline.md](../docs/pipeline.md). The
method behind each stage: [../docs/anatomy.md](../docs/anatomy.md) and
[../docs/body-fit.md](../docs/body-fit.md).

| Module | |
|---|---|
| `anatomy.py` | **the table**: groups, muscles (English and Portuguese), tissues, bone rules, viscera, fit regions, training groups |
| `bp3d.py` | download, tables, OBJ reading, unit and axis conversion |
| `catalog.py` | classification of all 2 234 meshes |
| `body.py` | the selection as `Part`s |
| `rig.py` | joint pivots and skinning weights |
| `meshops.py`, `voxel.py` | welding, decimation, Taubin, cuts by scalar field; parity voxelization, SDF |
| `split.py` | rectus abdominis cut out of the abdominal wall |
| `synth.py` | latissimus dorsi and patellar ligament |
| `morph.py` | female proportions, layered hypertrophy per region, isotropic limbs, AO |
| `fitdata.py` | girth probes and the muscle-volume polynomial |
| `export.py`, `gltf.py` | the quantized GLB |
| `build.py` | the whole pipeline |
| `check_fit.py` | fit data vs the deformed meshes |
| `check_isotropy.py` | the isotropic limbs against plain stacking (docs/validation/anatomy-checks.md) |
| `catalog_js.py`, `catalog_doc.py` | `src/catalog.generated.js`, `docs/catalog.md` |
| `debug_export.py` | raw meshes for `dev/inspect.html` |
