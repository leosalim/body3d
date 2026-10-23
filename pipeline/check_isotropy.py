"""Measures what the isotropic limbs (morph.isotropize_limbs) change against plain stacking.

    python check_isotropy.py                  # male and female, full resolution (~2 min each)
    python check_isotropy.py --sex male --lod lite

The isotropic field is computed once, from the stacking displacement per unit of gain on the rest
shape, and then used like any other field: the hypertrophy stays linear in the gain and the region
morphs stay exactly additive. What is matched by construction is the added cross-section area at
unit gain, to first order. This script reports, for every limb and across the drawable gain range:
  1. the muscle volume the limb's own field adds, isotropic vs stacking — split into the limb's own
     muscles and the muscles lying over it, which the field moves by position;
  2. the added area of the mid-limb outline (convex hull of the region's muscles in a 2 cm band),
     isotropic vs stacking — what a tape at that level sees;
  3. how far the region morphs are from adding up to the uniform morph (float rounding).
"""
from __future__ import annotations

import argparse
import sys

import numpy as np
from scipy.spatial import ConvexHull

import anatomy
import build
import meshops
import morph

LIMBS = ["upperarm_r", "forearm_r", "thigh_r", "calf_r"]


def capture():
    """Wraps morph.isotropize_limbs to keep the rest shape and the fields before and after it."""
    seen = {}
    original = morph.isotropize_limbs

    def wrapper(parts, joints, fields_r, regions, *a, **k):
        seen["rest"] = {p.id: p.v.copy() for p in parts}
        seen["faces"] = {p.id: p.f for p in parts}
        seen["kind"] = {p.id: p.kind for p in parts}
        seen["region"] = {p.id: anatomy.region_of(p.group, p.side) for p in parts}
        seen["joints"] = {j.name: j.pos.copy() for j in joints}
        seen["regions"] = list(regions)
        seen["stack"] = {pid: {r: d.copy() for r, d in fr.items()} for pid, fr in fields_r.items()}
        result = original(parts, joints, fields_r, regions, *a, **k)
        seen["iso"] = {pid: {r: d.copy() for r, d in fr.items()} for pid, fr in result.items()}
        return result

    morph.isotropize_limbs = wrapper
    return seen


def added_volume(seen, fields, ri, gain):
    """Muscle volume (m³) added by region ri's field alone at this gain, as (the region's own
    muscles, the other muscles its field moves — those lying over the limb)."""
    own = other = 0.0
    for pid, fr in fields.items():
        if ri not in fr or seen["kind"][pid] != "muscle":
            continue
        v0, f = seen["rest"][pid], seen["faces"][pid]
        dv = meshops.volume(v0 + gain * fr[ri], f) - meshops.volume(v0, f)
        if seen["region"][pid] == seen["regions"][ri]:
            own += dv
        else:
            other += dv
    return own, other


def top_increases(seen, ri, gain, n=4):
    """Muscles whose volume grows most under the isotropic field compared with stacking."""
    rows = []
    for pid, fr in seen["iso"].items():
        if ri not in fr or seen["kind"][pid] != "muscle":
            continue
        v0, f = seen["rest"][pid], seen["faces"][pid]
        dvi = meshops.volume(v0 + gain * fr[ri], f)
        dvs = meshops.volume(v0 + gain * seen["stack"][pid][ri], f)
        rows.append((dvi - dvs, pid))
    return sorted(rows, reverse=True)[:n]


def mid_outline_area(seen, fields, rid, gain):
    """Area of the convex hull of the region's muscles in a 2 cm band at mid-limb."""
    base, _, side = rid.partition("_")
    a = seen["joints"][f"{morph.LIMB_AXES[base][0]}_{side}"]
    b = seen["joints"][f"{morph.LIMB_AXES[base][1]}_{side}"]
    L = float(np.linalg.norm(b - a))
    ax = (b - a) / L
    e1 = np.cross(ax, [0.0, 0.0, 1.0])
    e1 /= np.linalg.norm(e1)
    e2 = np.cross(ax, e1)
    ri = seen["regions"].index(rid)
    pts = []
    for pid, v0 in seen["rest"].items():
        if seen["kind"][pid] != "muscle" or seen["region"][pid] != rid:
            continue
        v = v0 + gain * fields[pid][ri] if ri in fields.get(pid, {}) else v0
        q = v - a
        band = np.abs(q @ ax / L - 0.5) < 0.01 / L
        pts.append(np.c_[q[band] @ e1, q[band] @ e2])
    return ConvexHull(np.concatenate(pts)).volume


def check(sex: str, lod: str) -> None:
    seen = capture()
    parts, _joints, info = build.prepare(sex, lod, fit=False)
    g_lo, g_hi = info["gainRange"]
    # the fields are in BodyParts3D's size; volumes and areas are reported at the model height
    cm3, cm2 = info["scale"] ** 3 * 1e6, info["scale"] ** 2 * 1e4
    worst = 0.0
    for p in parts:
        rm = getattr(p, "region_morph", None)
        if rm:
            worst = max(worst, float(np.abs(sum(rm.values()) - p.morph).max()))
    print(f"\n=== {sex} {lod}: gain range {g_lo:.2f}–{g_hi:.2f}; region morphs vs uniform morph: "
          f"max error {worst:.1e} m")
    print("  limb        gain   added muscle volume, stacking → isotropic (own + over the limb)"
          "                 mid-limb added outline area")
    for rid in LIMBS:
        ri = seen["regions"].index(rid)
        a0 = mid_outline_area(seen, seen["stack"], rid, 0.0)
        for g in (0.5 * g_hi, 1.0, g_hi):
            vs = added_volume(seen, seen["stack"], ri, g)
            vi = added_volume(seen, seen["iso"], ri, g)
            as_ = mid_outline_area(seen, seen["stack"], rid, g) - a0
            ai = mid_outline_area(seen, seen["iso"], rid, g) - a0
            print(f"  {rid:<11} {g:4.2f}   {sum(vs) * cm3:6.0f} ({vs[0] * cm3:5.0f} + {vs[1] * cm3:4.0f}) → "
                  f"{sum(vi) * cm3:6.0f} ({vi[0] * cm3:5.0f} + {vi[1] * cm3:4.0f}) cm³  "
                  f"×{sum(vi) / sum(vs):5.3f}, own ×{vi[0] / vs[0]:5.3f}"
                  f"      {as_ * cm2:6.1f} → {ai * cm2:6.1f} cm² (×{ai / as_:5.3f})")
        print("              largest increases at gain 1:",
              ", ".join(f"{pid} {d * cm3:+.0f} cm³" for d, pid in top_increases(seen, ri, 1.0)))
    # the whole uniform field: how the limbs' share of the growth changes
    for name in ("stack", "iso"):
        per = {rid: sum(added_volume(seen, seen[name], r, g_hi)) for r, rid in enumerate(seen["regions"])}
        tot = sum(per.values())
        limbs = sum(v for rid, v in per.items() if rid.partition("_")[0] in morph.LIMB_AXES)
        print(f"  uniform field at gain {g_hi:.2f}, {'stacking' if name == 'stack' else 'isotropic'}: "
              f"{tot * cm3 / 1000:.2f} L added (sum of the regions alone), limbs {100 * limbs / tot:.1f} %")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description="Isotropic limbs against plain stacking.")
    ap.add_argument("--sex", choices=["male", "female"], action="append")
    ap.add_argument("--lod", choices=list(build.BUDGETS), default="high")
    a = ap.parse_args()
    for sex in a.sex or ["male", "female"]:
        check(sex, a.lod)
