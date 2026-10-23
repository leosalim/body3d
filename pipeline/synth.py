"""Structures BodyParts3D 4.0 lacks, built on the neighbouring anatomy.

Latissimus dorsi
----------------
Origin (Gray's Anatomy, 41st ed.): spinous processes of T7–T12 and, through the thoracolumbar
fascia, the lumbar vertebrae and sacrum; posterior third of the iliac crest; last 3–4 ribs;
sometimes the inferior angle of the scapula. Insertion: floor of the intertubercular sulcus of
the humerus. It lies superficial to the erector spinae, serratus posterior inferior, lower ribs
and teres major, which it wraps from below to form the posterior axillary fold; the ascending
part of the trapezius covers its superomedial corner.

Construction:
1. A signed distance field (SDF) of the "support" — ribs, spine, scapula, erectors, serrati,
   external oblique, teres major, viscera — with a morphological closing over the gaps between
   ribs and every horizontal slice filled, so no fibre can cut through the thorax.
2. Every fibre is an elastic band: it starts as an arc around the trunk and is repeatedly
   shortened (neighbour average) and pushed out of the support until it lies taut over it —
   the path a real fibre takes. Multiresolution: 9 → 17 → 33 → 65 → 96 points.
3. The sheet of fibres becomes a solid. Thickness follows volume conservation (∝ width at the
   origin / local width, capped), thinning at the free borders.
4. The medial aponeurotic part (thoracolumbar fascia) is not drawn: it is thin and, over the
   lower back, it would hide the erectors (the "lower back" training group).

Patellar ligament
-----------------
A flat band from the apex of the patella to the tibial tuberosity (~3 cm wide, ~6 mm thick),
held off the bone by the infrapatellar fat pad.
"""
from __future__ import annotations

import re

import numpy as np
from scipy import ndimage

import anatomy
import meshops
import voxel
from body import Part

SUPPORT_LAT = [
    r"thoracic vertebra", r"lumbar vertebra", r"\brib$", r"costal cartilage", r"sacrum", r"hip bone", r"scapula",
    r"humerus",
]
SUPPORT_LAT_MUSCLES = [
    "iliocostalis-lumborum", "iliocostalis-thoracis", "longissimus-thoracis", "spinalis-thoracis",
    "serratus-posterior-inferior", "serratus-anterior", "external-oblique", "rectus-abdominis", "teres-major",
    "infraspinatus", "teres-minor", "rhomboid-major", "triceps-long-head", "triceps-medial-head", "coracobrachialis",
    "biceps-short-head", "subscapularis", "external-intercostals", "gluteus-medius",
]


def _bones(parts, patterns, side=None):
    out = []
    for p in parts:
        if (p.kind in ("bone", "cartilage") and any(re.search(pt, p.label) for pt in patterns)
                and (side is None or p.side in (side, None))):
            out.append(p)
    return out


def _one(parts, pattern, side=None) -> np.ndarray:
    vs = [p.v for p in parts
          if p.kind in ("bone", "cartilage") and re.search(pattern, p.label) and (side is None or p.side == side)]
    return np.concatenate(vs)


# ---------------------------------------------------------------------------
# support (SDF)
# ---------------------------------------------------------------------------

def _support(parts, bone_pats, muscle_bases, box, pitch=0.0025, close_mm=9.0):
    """SDF of the support on both sides, with the trunk cavity filled.

    The closing covers the gaps between ribs; filling every horizontal slice (the ring of ribs,
    spine, sternum and abdominal wall is closed on each slice) keeps a fibre from cutting
    through the thorax.
    """
    sel = _bones(parts, bone_pats)
    sel += [p for p in parts if p.base in muscle_bases]
    g = voxel.Grid(box[0], box[1], pitch)
    solid = g.empty()
    for p in sel:
        if np.any(p.v.max(axis=0) < box[0]) or np.any(p.v.min(axis=0) > box[1]):
            continue
        solid |= g.solid(p.v, p.f)
    solid = voxel.close(solid, round(close_mm / 1000 / pitch))
    for j in range(solid.shape[1]):  # horizontal slices (y axis)
        solid[:, j, :] = ndimage.binary_fill_holes(solid[:, j, :])
    sdf = g.sdf(solid)
    sdf = ndimage.gaussian_filter(sdf, 1.0)
    grad = g.gradient(sdf)
    return g, sdf, grad


def _field(g, f, p):
    return ndimage.map_coordinates(f, g.index(p), order=1, mode="nearest")


# ---------------------------------------------------------------------------
# elastic band over the support
# ---------------------------------------------------------------------------

def drape(g, sdf, grad, start, end, n=64, offset=0.002, bulge=None, iters=300, free_end=0.0, free_start=0.0):
    """Fibres (K×n×3) stretched from start[k] to end[k] over the outside of the support.

    Multiresolution relaxation: an elastic band of n points needs ~n² iterations to become
    taut; starting with 9 points and doubling, every level starts almost converged.
    """
    K = len(start)
    levels = [m for m in (9, 17, 33, 65) if m < n] + [n]
    t = np.linspace(0, 1, levels[0])
    p = start[:, None, :] * (1 - t)[None, :, None] + end[:, None, :] * t[None, :, None]
    if bulge is not None:
        p += bulge(p, t)
    for m in levels:
        if p.shape[1] != m:
            p = resample(p, m)
        t = np.linspace(0, 1, m)
        proj = (t >= free_start) & (t <= 1 - free_end)
        proj[0] = proj[-1] = False
        for _ in range(iters):
            avg = 0.5 * (p[:, :-2] + p[:, 2:])        # shorten: neighbour average
            p[:, 1:-1] += 0.5 * (avg - p[:, 1:-1])
            flat = p.reshape(-1, 3)                    # push out of the support
            d = _field(g, sdf, flat).reshape(K, m)
            need = (d < offset) & proj[None, :]
            if need.any():
                gv = np.stack([_field(g, gr, flat) for gr in grad], axis=-1).reshape(K, m, 3)
                gv /= np.linalg.norm(gv, axis=-1, keepdims=True) + 1e-9
                p += np.where(need[..., None], (offset - d)[..., None] * gv, 0)
    return p


def resample(fibers, n):
    out = np.empty((len(fibers), n, 3))
    for k, f in enumerate(fibers):
        seg = np.linalg.norm(np.diff(f, axis=0), axis=1)
        s = np.concatenate([[0], np.cumsum(seg)])
        s /= s[-1]
        tt = np.linspace(0, 1, n)
        for c in range(3):
            out[k, :, c] = np.interp(tt, s, f[:, c])
    return out


# ---------------------------------------------------------------------------
# sheet → solid
# ---------------------------------------------------------------------------

def sheet_solid(inner, thick, normals_out):
    """inner, normals_out: K×M×3; thick: K×M. Returns a closed mesh (v, f)."""
    K, M, _ = inner.shape
    outer = inner + normals_out * thick[..., None]
    v = np.concatenate([outer.reshape(-1, 3), inner.reshape(-1, 3)])
    off = K * M
    idx = np.arange(K * M).reshape(K, M)
    faces = []
    a, b, c, d = idx[:-1, :-1], idx[1:, :-1], idx[1:, 1:], idx[:-1, 1:]
    quad = lambda a, b, c, d: np.stack([np.stack([a, b, c], -1), np.stack([a, c, d], -1)]).reshape(-1, 3)  # noqa: E731
    faces.append(quad(a, b, c, d))            # outer face
    faces.append(quad(a, d, c, b) + off)      # inner face (flipped)
    # borders: k=0, k=K-1, m=0, m=M-1
    for line, rev in ((idx[0, :], False), (idx[-1, :], True), (idx[:, 0], True), (idx[:, -1], False)):
        i0, i1 = line[:-1], line[1:]
        if rev:
            faces.append(quad(i0, i0 + off, i1 + off, i1))
        else:
            faces.append(quad(i0, i1, i1 + off, i0 + off))
    f = np.concatenate(faces)
    if meshops.volume(v, f) < 0:
        f = f[:, ::-1]
    return v, f


def surface_normals(grid):
    """Normals of a K×M×3 grid surface (cross product of the derivatives)."""
    du = np.gradient(grid, axis=0)
    dv = np.gradient(grid, axis=1)
    n = np.cross(du, dv)
    return n / (np.linalg.norm(n, axis=-1, keepdims=True) + 1e-12)


# ---------------------------------------------------------------------------
# latissimus
# ---------------------------------------------------------------------------

def _spinous_tip(parts, name):
    v = _one(parts, rf"^{name}$")
    mid = v[np.abs(v[:, 0]) < 0.012]
    return mid[np.argmin(mid[:, 2])]  # most posterior (the back faces -Z)


def _iliac_crest(parts, side, xs):
    hip = _one(parts, "hip bone", side)
    sgn = -1 if side == "r" else 1
    pts = []
    for x in xs:
        sl = hip[(np.abs(hip[:, 0] - sgn * x) < 0.006) & (hip[:, 2] < 0.10)]
        pts.append(sl[np.argmax(sl[:, 1])])
    return np.array(pts)


def _humerus_groove(parts, side, n):
    hum = _one(parts, "humerus", side)
    top = hum[:, 1].max()
    out = []
    for dy in np.linspace(0.045, 0.085, n):
        sl = hum[np.abs(hum[:, 1] - (top - dy)) < 0.004]
        pt = sl[np.argmax(sl[:, 2])].copy()  # anterior face
        c = sl.mean(axis=0)
        pt[0] += (c[0] - pt[0]) * 0.35         # towards the floor of the sulcus (the shaft axis)
        pt[2] += (c[2] - pt[2]) * 0.25
        out.append(pt)
    return np.array(out)


def lat_support(parts):
    """Support of the latissimus: the trunk (bones, deep muscles, viscera). The arm stays out,
    or the lateral fibres would wrap around the humerus instead of entering the axilla."""
    box = (np.array([-0.30, 0.84, -0.12]), np.array([0.30, 1.46, 0.30]))
    bones = [b for b in SUPPORT_LAT if b != "humerus"]
    arm = {"triceps-long-head", "triceps-medial-head", "coracobrachialis", "biceps-short-head"}
    muscles = (set(SUPPORT_LAT_MUSCLES) - arm) | {p.base for p in parts if p.kind == "viscera"}
    return _support(parts, bones, muscles, box)


def _posterior_surface(g, sdf, xy, offset):
    """Point on the back surface of the support at each (x, y): marches along +z from behind."""
    out = []
    for x, y in xy:
        zs = np.arange(g.lo[2], g.lo[2] + g.shape[2] * g.pitch, g.pitch * 0.5)
        pts = np.stack([np.full_like(zs, x), np.full_like(zs, y), zs], axis=1)
        d = _field(g, sdf, pts)
        k = int(np.argmax(d < offset))
        out.append(pts[k])
    return np.array(out)


def _erector_edge(parts, side, ys):
    """Lateral border (|x|) of the erectors at each height."""
    v = np.concatenate([p.v for p in parts if p.side == side and p.base in
                        ("iliocostalis-lumborum", "iliocostalis-thoracis", "longissimus-thoracis")])
    out = []
    for y in ys:
        sl = v[np.abs(v[:, 1] - y) < 0.006]
        out.append(np.abs(sl[:, 0]).max())
    return np.array(out)


def latissimus(parts, side: str, support, ref=None, K: int = 36, M: int = 60) -> tuple[Part, dict]:
    """`ref`: full-resolution parts, used only to measure landmarks (the lite LOD is too sparse)."""
    ref = ref or parts
    sgn = -1 if side == "r" else 1
    g, sdf, grad = support
    offset = 0.002

    # --- fleshy origin (the medial aponeurosis is not drawn; see the module docstring)
    t7 = _spinous_tip(ref, "seventh thoracic vertebra")[1]
    crest = _iliac_crest(ref, side, np.linspace(0.07, 0.13, 5))
    crest_y = crest[:, 1].max()
    # medial border: close to the spine under the trapezius (T7–T11), against the lateral border
    # of the erectors over the lower back; then along the iliac crest (outer lip, 1.5 cm above)
    ys = np.linspace(t7 + 0.005, crest_y + 0.03, 8)
    edge = _erector_edge(ref, side, ys)
    near_spine = np.interp(ys, [crest_y + 0.03, t7 - 0.08, t7 + 0.005], [1.0, 0.25, 0.0])
    medial_x = 0.022 + (edge + 0.003 - 0.022) * near_spine
    xy = [(sgn * x, y) for x, y in zip(medial_x, ys)]
    xy += [(c[0], c[1] + 0.015) for c in crest if abs(c[0]) > medial_x[-1] + 0.01]
    line = _posterior_surface(g, sdf, xy, offset)
    seg = np.linalg.norm(np.diff(line, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)]) / seg.sum()
    u = np.linspace(0, 1, K)
    origin = np.stack([np.interp(u, s, line[:, c]) for c in range(3)], axis=-1)

    # --- insertion: intertubercular sulcus, top (fibres from T7) to bottom
    groove = _humerus_groove(ref, side, 12)
    gs = np.linspace(0, 1, len(groove))
    insertion = np.stack([np.interp(u, gs, groove[:, c]) for c in range(3)], axis=-1)

    axis_c = np.array([0.0, 0.0, 0.085])  # approximate trunk axis (x, -, z)

    def bulge(p, t):
        d = p.copy()
        d[..., 0] -= axis_c[0]
        d[..., 1] = 0
        d[..., 2] -= axis_c[2]
        d /= np.linalg.norm(d, axis=-1, keepdims=True) + 1e-9
        return d * (0.10 * np.sin(np.pi * t))[None, :, None]

    fibers = drape(g, sdf, grad, origin, insertion, n=96, offset=offset, bulge=bulge, free_end=0.16)
    fibers = resample(fibers, M)
    n = surface_normals(fibers)
    probe = _field(g, sdf, (fibers + n * 0.004).reshape(-1, 3)) - _field(g, sdf, fibers.reshape(-1, 3))
    if np.mean(probe) < 0:
        n = -n

    # --- thickness: volume conservation while converging (∝ initial width / local width)
    width = np.linalg.norm(np.gradient(fibers, axis=0), axis=-1) * (K - 1)
    w0 = np.maximum(width[:, :4].mean(axis=1, keepdims=True), 1e-3)
    v = np.linspace(0, 1, M)[None, :]
    uu = u[:, None]
    base_t = 0.0045 + 0.004 * np.clip((uu - 0.2) / 0.6, 0, 1)             # thicker low and lateral
    thick = np.minimum(base_t * np.clip(w0 / np.maximum(width, 1e-3), 1, 5), 0.020)
    thick *= np.clip(v / 0.16, 0.10, 1) ** 0.8                             # thin origin border
    thick *= np.interp(v, [0, 0.80, 0.92, 1.0], [1, 1, 0.7, 0.35])         # flat tendon at the insertion
    thick *= np.clip(uu / 0.06, 0.3, 1) * np.clip((1 - uu) / 0.06, 0.55, 1)  # free borders

    vtx, fcs = sheet_solid(fibers, thick, n)
    # growth under hypertrophy: full in the belly, almost none in the free tendon in the axilla
    growth = np.interp(np.tile(np.linspace(0, 1, M), K), [0, 0.7, 0.9, 1.0], [1, 1, 0.35, 0.1])
    growth = np.concatenate([growth, growth])
    vtx, fcs, growth = meshops.weld_attr(vtx, fcs, growth)
    part = Part(f"latissimus-dorsi_{side}", "latissimus-dorsi", side, "muscle", anatomy.label_of("latissimus-dorsi"),
                group="lats", v=vtx, f=fcs, source=["synthesized"])
    part.growth = growth
    return part, {"fibers": fibers, "origin": origin, "insertion": insertion}


def push_out(part, obstacles, margin=0.0015, pitch=0.002, falloff=0.012):
    """Moves the vertices of `part` out of `obstacles` along the distance gradient, with a smooth
    falloff so that neighbours do not jump."""
    lo = part.v.min(axis=0) - 0.03
    hi = part.v.max(axis=0) + 0.03
    g = voxel.Grid(lo, hi, pitch)
    solid = g.empty()
    for o in obstacles:
        if np.any(o.v.max(axis=0) < lo) or np.any(o.v.min(axis=0) > hi):
            continue
        solid |= g.solid(o.v, o.f)
    if not solid.any():
        return 0
    sdf = g.sdf(solid)
    grad = g.gradient(sdf)
    d = _field(g, sdf, part.v)
    need = np.clip(margin - d, 0, None)
    if not need.any():
        return 0
    # spread the displacement over the mesh (smoothly) without reducing it where it is needed
    spread = meshops.smooth_values(need, part.f, iters=int(falloff / 0.004), lam=0.6)
    amount = np.maximum(need, spread)
    gv = np.stack([_field(g, gr, part.v) for gr in grad], axis=-1)
    gv /= np.linalg.norm(gv, axis=-1, keepdims=True) + 1e-9
    part.v = part.v + gv * amount[:, None]
    return int((need > 0).sum())


# ---------------------------------------------------------------------------
# patellar ligament
# ---------------------------------------------------------------------------

def patellar_ligament(parts, side: str) -> Part:
    pat = _one(parts, "patella", side)
    tib = _one(parts, "tibia", side)
    apex = pat[np.argmin(pat[:, 1])]
    top = tib[:, 1].max()
    upper = tib[(tib[:, 1] < top - 0.025) & (tib[:, 1] > top - 0.075)]
    tub = upper[np.argmax(upper[:, 2])]
    # centre of the anterior face of the patella, a little above the apex (broad attachment)
    a0 = pat[(pat[:, 1] < apex[1] + 0.012)]
    a0 = a0[a0[:, 2] > np.percentile(a0[:, 2], 60)].mean(axis=0)
    t = np.linspace(0, 1, 16)
    path = a0[None] * (1 - t)[:, None] + tub[None] * t[:, None]
    path[:, 2] += 0.006 * np.sin(np.pi * t)  # the fat pad pushes it forward
    width = 0.030 - 0.006 * t
    thick = 0.0055 * np.ones_like(t)
    fwd = np.array([0.0, 0.0, 1.0])
    dirs = np.gradient(path, axis=0)
    dirs /= np.linalg.norm(dirs, axis=1, keepdims=True)
    lat = np.cross(dirs, fwd)
    lat /= np.linalg.norm(lat, axis=1, keepdims=True)
    nrm = np.cross(lat, dirs)
    ring = []
    for ang in np.linspace(0, 2 * np.pi, 20, endpoint=False):
        ring.append(path + lat * (np.cos(ang) * width / 2)[:, None] + nrm * (np.sin(ang) * thick / 2)[:, None])
    ring = np.stack(ring, axis=1)  # T×R×3
    T, R, _ = ring.shape
    v = ring.reshape(-1, 3)
    idx = np.arange(T * R).reshape(T, R)
    f = []
    for i in range(T - 1):
        for j in range(R):
            a, b = idx[i, j], idx[i, (j + 1) % R]
            c, d = idx[i + 1, (j + 1) % R], idx[i + 1, j]
            f += [[a, b, c], [a, c, d]]
    c0 = len(v)
    v = np.concatenate([v, path[[0]], path[[-1]]])
    for j in range(R):
        f.append([c0, idx[0, (j + 1) % R], idx[0, j]])
        f.append([c0 + 1, idx[-1, j], idx[-1, (j + 1) % R]])
    f = np.array(f)
    if meshops.volume(v, f) < 0:
        f = f[:, ::-1]
    return Part(f"patellar-ligament_{side}", "patellar-ligament", side, "tissue", anatomy.label_of("patellar-ligament"),
                v=v, f=f, source=["synthesized"])


def add_synthetic(parts: list[Part], ref: list[Part] | None = None) -> list[Part]:
    out = list(parts)
    support = lat_support(parts)
    by = {p.id: p for p in parts}
    deep = ["serratus-posterior-inferior", "iliocostalis-lumborum", "iliocostalis-thoracis", "longissimus-thoracis",
            "external-oblique", "serratus-anterior", "teres-major", "rhomboid-major", "infraspinatus"]
    for side in ("r", "l"):
        lat, _ = latissimus(parts, side, support, ref=ref)
        push_out(lat, [by[f"{b}_{side}"] for b in deep if f"{b}_{side}" in by])
        lat.v = meshops.taubin(lat.v, lat.f, iters=6)
        push_out(lat, [by[f"{b}_{side}"] for b in deep if f"{b}_{side}" in by])
        # the ascending trapezius covers the superomedial corner of the latissimus
        push_out(by[f"trapezius-ascending_{side}"], [lat], margin=0.001)
        out.append(lat)
        out.append(patellar_ligament(ref or parts, side))
    return out
