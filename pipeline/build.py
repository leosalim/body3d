"""Whole pipeline: BodyParts3D → public/models/{male,female}[-lite].glb.

    python build.py                 # both sexes, both resolutions
    python build.py --sex male --lod high

Stages (one module each):
  bp3d/body    download and load the selection of anatomy.py (metres, three.js axes)
  rig          joint pivots from the bones (full resolution)
  (decimation) uniform triangle density, budget per LOD
  split        rectus abdominis cut out of BodyParts3D's abdominal wall
  synth        structures BodyParts3D lacks (latissimus dorsi, patellar ligament)
  rig          skinning weights
  morph        female proportions and FFMI-calibrated hypertrophy, one morph per region
  fitdata      girth probes and the muscle-volume polynomial for the tape-measure fit
  export       quantized GLB with rig, part index and metadata

The build is deterministic: the same inputs give byte-identical GLBs. After a build, run
`node dev/calibrate.mjs <ANSUR II .csv> --write`: the calibration is keyed by the fingerprint
of the fit data of each model (docs/body-fit.md).
"""
from __future__ import annotations

import argparse
import copy
import json
import pathlib
import sys
import time

import numpy as np

import anatomy
import body
import bp3d
import catalog_js
import export
import fitdata
import meshops
import morph
import rig
import split
import synth

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE.parent / "public" / "models"

# triangles per LOD (soft tissue, skeleton)
BUDGETS = {"high": (260_000, 110_000), "lite": (90_000, 40_000)}
MIN_FACES = {"muscle": 120, "tissue": 80, "bone": 60, "cartilage": 40, "viscera": 40}
VISCERA_BUDGET = 40_000  # viscera only serve as the core of the hypertrophy; they never reach the GLB


def decimate_all(parts, soft_budget: int, bone_budget: int) -> None:
    for kinds, budget in ((("muscle", "tissue"), soft_budget), (("bone", "cartilage"), bone_budget),
                          (("viscera",), VISCERA_BUDGET)):
        sel = [p for p in parts if p.kind in kinds]
        areas = np.array([meshops.area(p.v, p.f) for p in sel])
        density = budget / areas.sum()
        for p, a in zip(sel, areas):
            target = max(MIN_FACES[p.kind], int(a * density))
            p.v, p.f = meshops.decimate(p.v, p.f, target)


def log(t0, msg):
    print(f"[{time.time() - t0:6.1f}s] {msg}", flush=True)


def build(sex: str, lod: str) -> dict:
    t0 = time.time()
    parts, joints, info = prepare(sex, lod, t0)
    OUT.mkdir(parents=True, exist_ok=True)
    name = f"{sex}{'' if lod == 'high' else '-lite'}.glb"
    out = export.export(OUT / name, parts, joints, {"sex": sex, "lod": lod, "body": info})
    log(t0, f"{name}: {out['bytes'] / 1e6:.2f} MB {json.dumps({k: v for k, v in out.items() if k != 'bytes'})}")
    return {**out, "body": info}


def prepare(sex: str, lod: str, t0: float | None = None, fit: bool = True):
    """Everything before export: parts in their final shape (minimum FFMI), morphs, rig and —
    except for the base model — the tape-measure fit data (info["fit"])."""
    t0 = t0 or time.time()
    bp3d.download()
    parts = body.load()
    body.check_sides(parts)
    log(t0, f"loaded: {len(parts)} parts")
    joints = rig.compute_joints(parts)
    rig.check_segments(parts, joints)
    log(t0, f"rig: {len(joints)} joints")
    # anatomical landmarks are always measured at full resolution, whatever the LOD
    ref = [copy.copy(p) for p in parts if p.kind in ("bone", "cartilage") or p.group == "erectors"]
    decimate_all(parts, *BUDGETS[lod])
    parts = split.split_rectus(parts)
    for p in parts:  # BodyParts3D is faceted and decimation adds noise
        if p.kind in ("muscle", "tissue"):
            p.v = meshops.taubin(p.v, p.f, iters=4)
    log(t0, "decimated, cut and smoothed")
    parts = synth.add_synthetic(parts, ref)
    log(t0, "latissimus and patellar ligament synthesized")
    rig.skin_weights(parts, joints)
    log(t0, "skinning")
    info = morph.morph(parts, joints, sex, log=lambda m: log(t0, m))
    _bake_ao(parts, info.get("defaultWeight", 0.0))
    log(t0, "ambient occlusion")
    if fit and sex != "base":
        info["fit"] = fitdata.build(parts, joints, info, log=lambda m: log(t0, m))
    return parts, joints, info


def _bake_ao(parts, weight: float) -> None:
    """Bakes AO in the shape of the default FFMI (groove shading changes little with the FFMI),
    then puts every part back in its exported shape (the minimum FFMI)."""
    rest = {p.id: p.v for p in parts if getattr(p, "morph", None) is not None}
    for p in parts:
        if p.id in rest:
            p.v = rest[p.id] + weight * p.morph
    morph.bake_ao(parts)
    for p in parts:
        if p.id in rest:
            p.v = rest[p.id]


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")  # logs carry ≈, µm, – (Windows consoles default to cp1252)
    ap = argparse.ArgumentParser(description="Build the body3d GLB models from BodyParts3D.")
    ap.add_argument("--sex", choices=["male", "female", "base"], action="append",
                    help="model to build (repeatable; default: male and female). 'base' is BodyParts3D at the "
                         "male height without hypertrophy, for comparison only")
    ap.add_argument("--lod", choices=list(BUDGETS), action="append", help="resolution (repeatable; default: both)")
    a = ap.parse_args()
    anatomy.check()
    catalog_js.main()  # src/catalog.generated.js always matches the table the models use
    for sex in a.sex or ["male", "female"]:
        for lod in a.lod or list(BUDGETS):
            build(sex, lod)
