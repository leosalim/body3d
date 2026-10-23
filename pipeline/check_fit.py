"""Checks the tape-measure fit data (fitdata.py) against the actual mesh.

    python check_fit.py                       # male and female, full resolution (~2 min each)
    python check_fit.py --sex female --lod lite

For region weights drawn across the plausible range:
  1. the region morphs, all with the same weight, add up to the uniform morph (exact);
  2. the volume polynomial matches the signed volume of the deformed mesh (exact);
  3. the probe girth (material points, reduced hull) matches the true cross-section of the
     deformed mesh in the same plane (tolerance per site).
Exits with code 1 when a check fails.
"""
from __future__ import annotations

import argparse
import sys

import numpy as np

import build
import fitdata
import meshops

# maximum relative error of probe vs true section, over the plausible weight range. Limbs 2 % (the thigh
# 3 %: its section mixes thigh, hip and iliotibial tract); neck and trunk 3 % — trunk tapes enter the fit
# as a ratio over the typical body (src/fit.js RATIO_SITES), so the systematic part of the error cancels
TOLERANCE = {"default": 0.02, "thigh": 0.03, "neck": 0.03, "shoulders": 0.03, "chest": 0.03, "hips": 0.03}
PLAUSIBLE = (-0.1, 1.2)


def true_girth(parts, spec, level, w):
    sel = fitdata.site_parts(parts, spec)
    o, n = np.array(level["origin"]), np.array(level["normal"])
    e1, e2 = fitdata.basis(n)
    hw = spec.get("halfWidth")
    pts = []
    for p in sel:
        v = fitdata.morphed(p, w)
        d = (v - o) @ n
        for i, j in ((0, 1), (1, 2), (2, 0)):
            di, dj = d[p.f[:, i]], d[p.f[:, j]]
            m = (di > 0) != (dj > 0)
            t = (di[m] / (di[m] - dj[m]))[:, None]
            q = v[p.f[m, i]] + t * (v[p.f[m, j]] - v[p.f[m, i]])
            keep = np.ones(len(q), dtype=bool)
            if spec["radius"] is not None:
                r = q - o
                r -= np.outer(r @ n, n)
                keep &= np.linalg.norm(r, axis=1) <= spec["radius"]
            if hw:
                keep &= np.abs((q - o) @ e1) <= hw * build.morph.PROFILES[spec.get("sex", "male")]["height"]
            pts.append(q[keep])
    q = np.concatenate(pts)
    return fitdata.hull_perimeter(np.c_[(q - o) @ e1, (q - o) @ e2])


def probe_girth(fit, site, w):
    vals = []
    for lv in site["levels"]:
        b = np.array(lv["base"], float).reshape(-1, 2) * fit["unit"]
        for k, r in enumerate(site["regions"]):
            b = b + w[r] * np.array(lv["disp"][k], float).reshape(-1, 2) * fit["unit"]
        vals.append(fitdata.hull_perimeter(b))
    return vals


def check(sex: str, lod: str) -> list[str]:
    parts, _joints, info = build.prepare(sex, lod)
    fit = info["fit"]
    R = len(info["regions"])
    specs = {s["id"]: {**s, "sex": sex} for s in fitdata.expand_sites()}
    problems = []
    rng = np.random.default_rng(3)
    configs = [np.full(R, t) for t in (PLAUSIBLE[0], 0.0, 0.4, info["defaultWeight"], PLAUSIBLE[1])]
    configs += list(rng.uniform(*PLAUSIBLE, size=(8, R)))
    worst = {}
    for w in configs:
        wd = {r: float(w[r]) for r in range(R)}
        # 1. morphs add up to the uniform one
        if np.allclose(w, w[0]):
            for p in parts:
                if getattr(p, "region_morph", None):
                    tot = sum(p.region_morph.values())
                    if np.abs(tot - p.morph).max() > 1e-6:
                        problems.append(f"{p.id}: region morphs do not add up to the uniform morph")
                        break
        # 2. volume
        vp = sum(fitdata.eval_poly({tuple(k): c for c, k in fit["volume"][r]}, w) for r in info["regions"])
        vm = sum(meshops.volume(fitdata.morphed(p, wd), p.f) for p in parts if p.kind == "muscle") * 1000
        if abs(vp - vm) > 1e-6 * max(1.0, vm):
            problems.append(f"volume: polynomial {vp:.5f} L vs mesh {vm:.5f} L")
        # 3. probes
        for site in fit["sites"]:
            spec = specs[site["id"]]
            probes = probe_girth(fit, site, w)
            truth = [true_girth(parts, spec, lv, wd) for lv in site["levels"]]
            pick = max if site["mode"] == "max" else min
            err = abs(pick(probes) - pick(truth)) / pick(truth)
            worst[site["id"]] = max(worst.get(site["id"], 0.0), err)
    for sid, err in worst.items():
        tol = next((v for k, v in TOLERANCE.items() if sid.startswith(k)), TOLERANCE["default"])
        flag = "" if err <= tol else "  ← above tolerance"
        print(f"  {sex}/{lod} {sid:10s} worst probe error {err:.2%} (tolerance {tol:.1%}){flag}")
        if err > tol:
            problems.append(f"{sid}: probe off by {err:.2%}")
    return problems


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")  # logs carry ≈, µm, – (Windows consoles default to cp1252)
    ap = argparse.ArgumentParser()
    ap.add_argument("--sex", choices=["male", "female"], action="append")
    ap.add_argument("--lod", choices=list(build.BUDGETS), action="append")
    a = ap.parse_args()
    problems = []
    for sex in a.sex or ["male", "female"]:
        for lod in a.lod or ["high"]:
            problems += [f"{sex}/{lod}: {p}" for p in check(sex, lod)]
    if problems:
        print("\n".join(problems))
        sys.exit(1)
    print("ok: morphs, volume and probes agree")
