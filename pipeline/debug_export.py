"""Exports the raw (decimated) musculoskeletal meshes for visual inspection.

One node per mesh, named file + concept, coloured by system. Development only:
    python debug_export.py [fraction] [out.glb] [--skin]      # default: ../dev/debug.glb
Open it with dev/inspect.html?glb=/dev/debug.glb.
"""
from __future__ import annotations

import json
import pathlib
import sys

import fast_simplification
import numpy as np

import bp3d
from gltf import GLB, vertex_normals

HERE = pathlib.Path(__file__).resolve().parent
COLORS = {
    "muscle": (0.72, 0.28, 0.25), "bone": (0.9, 0.87, 0.78), "cartilage": (0.7, 0.8, 0.9),
    "tendon": (0.9, 0.9, 0.95), "ligament": (0.6, 0.7, 0.6), "skin": (0.8, 0.7, 0.6),
}
KEEP_LIGAMENTS = ("iliotibial", "interosseous membrane", "retinaculum", "long plantar", "linea alba")


def wanted(r: dict) -> bool:
    if r["system"] in ("muscle", "bone", "tendon"):
        return not any(k in r["name"] for k in ("papillary", "ventricle", "eyeball", "rectus", "oblique", "palpebr"))\
            or any(k in r["name"] for k in ("rectus femoris", "external oblique", "obliquus capitis", "rectus capitis"))
    if r["system"] == "cartilage":
        return "costal" in r["name"]
    return any(k in r["name"] for k in KEEP_LIGAMENTS) or (r["system"] == "skin" and r["name"] == "skin")


def main(frac: float, out: str, with_skin: bool) -> None:
    with open(HERE.parent / "catalog" / "bp3d-elements.json", encoding="utf-8") as fh:
        rows = json.load(fh)
    meshes = bp3d.Meshes()
    glb = GLB()
    mats = {s: glb.material(s, c) for s, c in COLORS.items()}
    n = 0
    for r in rows:
        if not wanted(r) or (r["system"] == "skin" and not with_skin):
            continue
        v, f = meshes.load(r["file"])
        if len(f) > 400:
            v, f = fast_simplification.simplify(v.astype(np.float32), f.astype(np.int32), 1 - frac)
        if len(f) == 0:
            continue
        mesh, tf = glb.mesh(r["name"], v, f, vertex_normals(v, f), material=mats.get(r["system"], mats["ligament"]))
        glb.node(f'{r["file"]}|{r["name"]}|{r["system"]}', mesh=mesh, **tf)
        n += 1
    size = glb.save(out)
    print(f"{n} meshes, {size / 1e6:.1f} MB", file=sys.stderr)


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    main(float(args[0]) if args else 0.1, args[1] if len(args) > 1 else str(HERE.parent / "dev" / "debug.glb"),
         "--skin" in sys.argv)
