"""Data for the tape-measure fit (src/fit.js), written to extras.body.fit.

Two things, both exact on the exported geometry (shape at the minimum FFMI + one morph per
region, anatomy.REGIONS):

1. **Girth probes** (`sites`): for every standard tape site, a set of cross-sections
   perpendicular to the limb (or horizontal, on the trunk) at a few levels. Each section keeps
   the points where mesh edges cross the plane in a reference shape (a typical FFMI) as
   material points: position = base + Σ weight_r · morph_r, linear in the weights. The tape
   girth is the perimeter of the convex hull of those points projected on the plane (the tape
   bridges concavities), and the measure of a limb is the one at the thickest level (the neck:
   the thinnest). Only points that reach the hull for some plausible weight combination stay.

2. **Muscle volume** (`volume`): the signed volume of a closed mesh is Σ a·(b×c)/6 over its
   triangles; with vertices affine in the weights it is an exact cubic polynomial in the
   weights. One polynomial per owning region (their sum is the total), in litres.

fit.js uses both to find the weights that reproduce the measures with the muscle volume of the
FFMI. check_fit.py compares the probes with the true cross-section of the deformed mesh.
"""
from __future__ import annotations

import itertools

import numpy as np
from scipy.spatial import ConvexHull

import anatomy

# --------------------------------------------------------------------------
# Tape sites. Limb axis: from the proximal to the distal joint; `levels` are fractions of that
# length. Trunk: horizontal planes at fractions of the model height. `regions`: regions whose
# muscles enter the section ({s} = side); `bones`: segments whose bones enter; `tissues`.
# `radius`: maximum distance to the axis (m, at the model height) — the plane is infinite and
# would cut the rest of the body. `codes`: the tape-site codes of src/anthro.js TAPE_SITES.
# --------------------------------------------------------------------------
SITES = [
    # arm (flexed, at the thickest point — the ANSUR convention): biceps and triceps below the
    # deltoid; the deltoid stays out (the tape goes around the biceps, not the shoulder)
    {"id": "arm_{s}", "codes": ["{SIDE}_BICEP"], "axis": ("upperarm_{s}", "forearm_{s}"),
     "levels": np.linspace(0.45, 0.78, 7), "mode": "max", "radius": 0.20,
     "regions": ["upperarm_{s}"], "bones": ["upperarm_{s}"], "tissues": []},
    # forearm: largest girth below the elbow (proximal; further towards the wrist the section
    # picked up outside material when the arm grows)
    {"id": "forearm_{s}", "codes": ["{SIDE}_FOREARM"], "axis": ("forearm_{s}", "hand_{s}"),
     "levels": np.linspace(0.08, 0.38, 6), "mode": "max", "radius": 0.16,
     "regions": ["forearm_{s}"], "bones": ["forearm_{s}"], "tissues": []},
    # thigh: largest girth from just below the gluteal fold down to mid-thigh (on the model,
    # without fat, the thickest is mid-thigh; the gluteal fold is near 0.24)
    {"id": "thigh_{s}", "codes": ["{SIDE}_THIGH"], "axis": ("thigh_{s}", "shin_{s}"),
     "levels": np.linspace(0.24, 0.56, 7), "mode": "max", "radius": 0.16,
     "regions": ["thigh_{s}", "hips"], "bones": ["thigh_{s}"], "tissues": ["iliotibial-tract_{s}"]},
    # lower leg: largest calf girth
    {"id": "calf_{s}", "codes": ["{SIDE}_CALF"], "axis": ("shin_{s}", "foot_{s}"),
     "levels": np.linspace(0.14, 0.52, 7), "mode": "max", "radius": 0.16,
     "regions": ["calf_{s}"], "bones": ["shin_{s}"], "tissues": ["calcaneal-tendon_{s}"]},
    # neck: smallest girth below the larynx, perpendicular to the neck
    {"id": "neck", "codes": ["NECK"], "axis": ("neck", "head"),
     "levels": np.linspace(0.25, 0.65, 5), "mode": "min", "radius": 0.10,
     "regions": ["neck"], "bones": ["neck"], "tissues": []},
    # shoulders: horizontal, at the largest bulge of the deltoids, arms at the sides
    {"id": "shoulders", "codes": ["SHOULDERS"], "horizontal": True,
     "levels": np.linspace(0.745, 0.80, 6), "mode": "max", "radius": None,
     "regions": ["shoulders", "chest", "back", "neck", "upperarm_l", "upperarm_r"],
     "bones": ["chest", "shoulder_l", "shoulder_r", "upperarm_l", "upperarm_r"], "tissues": []},
    # chest: horizontal, at nipple height (0.735 of stature in ANSUR II), under the arms (arms
    # excluded). Slightly lower: just above, latissimus and pectoralis already run to the humerus
    # and the section widens. The model's latissimus flares more than in ANSUR; since the chest
    # enters the fit as a ratio over the typical body (fit.js), the systematic offset cancels
    {"id": "chest", "codes": ["CHEST"], "horizontal": True,
     "levels": np.linspace(0.70, 0.725, 4), "mode": "max", "radius": None,
     "regions": ["chest", "back", "core"], "bones": ["chest", "shoulder_l", "shoulder_r"], "tissues": []},
    # hips/buttocks: horizontal, at the largest bulge of the glutes
    {"id": "hips", "codes": ["HIPS", "GLUTES"], "horizontal": True,
     "levels": np.linspace(0.45, 0.53, 5), "mode": "max", "radius": None,
     "regions": ["hips", "thigh_l", "thigh_r", "core"], "bones": ["pelvis", "thigh_l", "thigh_r"],
     "tissues": ["iliotibial-tract_l", "iliotibial-tract_r"]},
]

SIDE_NAME = {"l": "LEFT", "r": "RIGHT"}
REF_RANGE = (-0.25, 1.5)  # plausible weights per region (to choose the hull points)
UNIT = 1e-4  # m per unit of the probe integers
REF_FFMI = {"male": 21.0, "female": 17.0}


def expand_sites() -> list[dict]:
    out = []
    for spec in SITES:
        sided = "{s}" in spec["id"]
        for s in ("l", "r") if sided else (None,):
            def fmt(x, s=s):
                return x.replace("{s}", s).replace("{SIDE}", SIDE_NAME[s]) if s else x
            out.append({**spec, "id": fmt(spec["id"]), "codes": [fmt(c) for c in spec["codes"]],
                        "axis": tuple(fmt(a) for a in spec["axis"]) if "axis" in spec else None,
                        "regions": [fmt(r) for r in spec["regions"]], "bones": [fmt(b) for b in spec["bones"]],
                        "tissues": [fmt(t) for t in spec["tissues"]], "side": s})
    return out


def site_parts(parts, site) -> list:
    sel = []
    for p in parts:
        muscle = p.kind == "muscle" and anatomy.region_of(p.group, p.side) in site["regions"]
        bone = p.kind in ("bone", "cartilage") and p.segment in site["bones"]
        tissue = p.kind == "tissue" and p.id in site["tissues"]
        if muscle or bone or tissue:
            sel.append(p)
    return sel


def planes(site, joints, height) -> list[tuple[np.ndarray, np.ndarray, float]]:
    """(origin, normal, level) of every section."""
    if site.get("horizontal"):
        return [(np.array([0.0, f * height, 0.0]), np.array([0.0, 1.0, 0.0]), float(f)) for f in site["levels"]]
    J = {j.name: j.pos for j in joints}
    a, b = J[site["axis"][0]], J[site["axis"][1]]
    n = (b - a) / np.linalg.norm(b - a)
    return [(a + f * (b - a), n, float(f)) for f in site["levels"]]


def basis(n: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Plane basis: e1 lateral (the body x axis, projected), e2 = n × e1."""
    ref = np.array([1.0, 0.0, 0.0]) if abs(n[0]) < 0.9 else np.array([0.0, 0.0, 1.0])
    e1 = ref - n * (ref @ n)
    e1 /= np.linalg.norm(e1)
    return e1, np.cross(n, e1)


def morphed(p, w: dict[int, float]) -> np.ndarray:
    v = p.v.copy()
    for r, m in getattr(p, "region_morph", {}).items():
        v += w.get(r, 0.0) * m
    return v


def material_points(sel, o, n, w_ref, radius, regions_idx, half_width=None, lateral=None):
    """Material points of the section in the reference shape: base (n, 3) and displacement per
    region (R, n, 3) — position(w) = base + Σ w_r · disp_r. `radius`: maximum distance to the
    axis; `half_width`: maximum lateral distance (along `lateral`)."""
    bases, disps = [], []
    for p in sel:
        v = morphed(p, w_ref)
        d = (v - o) @ n
        f = p.f
        for i, j in ((0, 1), (1, 2), (2, 0)):
            di, dj = d[f[:, i]], d[f[:, j]]
            m = (di > 0) != (dj > 0)
            if not m.any():
                continue
            t = (di[m] / (di[m] - dj[m]))[:, None]
            a, b = f[m, i], f[m, j]
            q = v[a] + t * (v[b] - v[a])
            keep = np.ones(len(q), dtype=bool)
            if radius is not None:
                r = q - o
                r -= np.outer(r @ n, n)
                keep = np.linalg.norm(r, axis=1) <= radius
            if half_width is not None:
                keep &= np.abs((q - o) @ lateral) <= half_width
            if not keep.any():
                continue
            a, b, t = a[keep], b[keep], t[keep]
            bases.append(p.v[a] + t * (p.v[b] - p.v[a]))
            rm = getattr(p, "region_morph", {})
            disps.append(np.stack([(rm[r][a] + t * (rm[r][b] - rm[r][a])) if r in rm else np.zeros((len(a), 3))
                                   for r in regions_idx]))
    if not bases:
        return np.zeros((0, 3)), np.zeros((len(regions_idx), 0, 3))
    return np.concatenate(bases), np.concatenate(disps, axis=1)


def hull_perimeter(pts2: np.ndarray) -> float:
    return float(ConvexHull(pts2).area) if len(pts2) >= 3 else 0.0


def build_site(parts, joints, site, regions, w_ref, height, rng):
    sel = site_parts(parts, site)
    # regions that move some point of the section (the others stay out of the data)
    levels = []
    for o, n, f in planes(site, joints, height):
        e1, e2 = basis(n)
        hw = site.get("halfWidth")
        base, disp = material_points(sel, o, n, w_ref, site["radius"], list(range(len(regions))),
                                     half_width=hw * height if hw else None, lateral=e1)
        if len(base) < 3:
            continue
        b2 = np.c_[(base - o) @ e1, (base - o) @ e2]
        d2 = np.stack([np.c_[d @ e1, d @ e2] for d in disp])  # (R, n, 2)
        levels.append({"f": f, "o": o, "n": n, "e": (e1, e2), "b2": b2, "d2": d2})
    used = sorted({r for lv in levels for r in range(len(regions)) if np.abs(lv["d2"][r]).max() > 1e-7})
    # points that reach the hull: uniform weights, each region at the extremes, random draws
    lo, hi = REF_RANGE
    configs = [np.full(len(used), t) for t in np.linspace(lo, hi, 9)]
    for k in range(len(used)):
        for t0 in (lo, 0.0, 0.7, hi):
            for t in (lo, hi):
                c = np.full(len(used), t0)
                c[k] = t
                configs.append(c)
    configs += list(rng.uniform(lo, hi, size=(150, len(used))))
    out_levels = []
    for lv in levels:
        d2 = lv["d2"][used]  # (K, n, 2)
        keep = set()
        for c in configs:
            pts = lv["b2"] + np.tensordot(c, d2, axes=1)
            keep.update(ConvexHull(pts).vertices.tolist())
        idx = np.array(sorted(keep))
        idx = _thin(lv["b2"][idx], d2[:, idx], idx)
        out_levels.append({**lv, "idx": idx, "b2k": lv["b2"][idx], "d2k": d2[:, idx]})
    return used, out_levels, sel


THIN = 0.004  # m: hull points closer than this in every shape become one


def _thin(b2, d2, idx):
    """Neighbouring outline points that move together for every weight combination are
    redundant: one per THIN cell stays, by position in reference shapes (all weights at the
    minimum and at the maximum, and each region alone at the maximum). Dropping points ≤ 8 mm
    apart on an arc of 5 cm radius changes the perimeter by ~0.1 %."""
    lo, hi = REF_RANGE
    feats = [b2 + lo * d2.sum(axis=0), b2 + hi * d2.sum(axis=0)]
    for k in range(len(d2)):
        feats.append(b2 + lo * d2.sum(axis=0) + (hi - lo) * d2[k])
    key = np.round(np.concatenate(feats, axis=1) / THIN).astype(np.int64)
    _, first = np.unique(key, axis=0, return_index=True)
    return idx[np.sort(first)]


def volume_polynomials(parts, regions) -> dict[str, dict[tuple, float]]:
    """{owning region: {monomial (sorted tuple of region indices): coefficient in L}}."""
    out: dict[str, dict[tuple, float]] = {r: {} for r in regions}
    for p in parts:
        if p.kind != "muscle":
            continue
        owner = anatomy.region_of(p.group, p.side)
        rm = getattr(p, "region_morph", {})
        K = sorted(rm)
        A = [p.v, *(rm[r] for r in K)]
        lab = [None, *K]
        f0, f1, f2 = p.f[:, 0], p.f[:, 1], p.f[:, 2]
        poly = out[owner]
        for i, j, l in itertools.product(range(len(A)), repeat=3):
            c = float(np.einsum("ij,ij->", A[i][f0], np.cross(A[j][f1], A[l][f2]))) / 6 * 1000
            if c == 0.0:
                continue
            key = tuple(sorted(x for x in (lab[i], lab[j], lab[l]) if x is not None))
            poly[key] = poly.get(key, 0.0) + c
    return out


def eval_poly(poly: dict[tuple, float], w) -> float:
    return sum(c * np.prod([w[r] for r in key]) for key, c in poly.items())


def build(parts, joints, info, log=print) -> dict:
    regions = info["regions"]
    R = len(regions)
    height = info["heightM"]
    w_def = info["defaultWeight"]
    # reference shape of the material points: the typical FFMI (ANSUR II: men 21.7, women 17.1 on
    # the 1.80 m scale), where most people are — the material-point error grows with the
    # distance from it (check_fit.py)
    table = info["ffmi"]["table"]
    t_ref = float(np.interp(REF_FFMI[info["sex"]], [r[0] for r in table], [r[1] for r in table]))
    w_ref = {r: t_ref for r in range(R)}
    rng = np.random.default_rng(7)
    sites = []
    total_pts = 0
    for site in expand_sites():
        used, levels, _sel = build_site(parts, joints, site, regions, w_ref, height, rng)
        total_pts += sum(len(lv["idx"]) for lv in levels)
        sites.append({
            "id": site["id"], "codes": site["codes"], "mode": site["mode"], "side": site["side"],
            "regions": used,
            "levels": [{
                "f": round(lv["f"], 4),
                "origin": [round(float(x), 5) for x in lv["o"]], "normal": [round(float(x), 5) for x in lv["n"]],
                "axes": [[round(float(x), 5) for x in e] for e in lv["e"]],
                # integers in UNIT metres (0.1 mm): [x0, y0, x1, y1, …]
                "base": np.round(lv["b2k"] / UNIT).astype(int).reshape(-1).tolist(),
                "disp": [np.round(d / UNIT).astype(int).reshape(-1).tolist() for d in lv["d2k"]],
            } for lv in levels],
        })
    polys = volume_polynomials(parts, regions)
    volume = {r: [[round(c, 7), list(k)] for k, c in sorted(polys[r].items(), key=lambda kv: (len(kv[0]), kv[0]))
                  if abs(c) > 1e-9] for r in regions}
    v_def = sum(eval_poly(polys[r], np.full(R, w_def)) for r in regions)
    log(f"fit: {len(sites)} tape sites, {total_pts} hull points; "
        f"muscle volume at the default {v_def:.2f} L ({sum(len(v) for v in volume.values())} monomials)")
    return {"version": 1, "unit": UNIT, "sites": sites, "volume": volume}
