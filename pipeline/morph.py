"""Proportions: the female body and FFMI-calibrated hypertrophy.

FFMI (fat-free mass index) = fat-free mass (kg) / height (m)². Default targets: male FFMI 26,
female FFMI 22 (very muscular; ~25 is the practical ceiling for drug-free men, Kouri et al.
1995).

From FFMI to skeletal muscle mass (SMM): SMM ≈ k · FFM. Janssen et al. (2000, whole-body MRI)
measured SMM ≈ 38 % of body mass in men and ≈ 31 % in women; with the typical body fat of those
samples, k ≈ 0.49 and ≈ 0.47 (our estimate). In trained people k is higher (Midorikawa et al.
2007; Abe et al. 2018: ~8 %); the ramp to 0.56 (male) and 0.52 (female) at the targets is our
assumption, about twice that (docs/anatomy.md §5). The base model (BodyParts3D) is a lean man; the
volume of its muscles is measured, converted to mass (1.06 kg/L) and compared with the target.

Hypertrophy thickens every muscle without moving bones and viscera. To keep the layers stacked,
the displacement of each point is the sum of the thickening of all the muscle between it and the
"core" (bones, cartilage, viscera), measured along the direction away from the core (gradient of
the smoothed distance field). A point on the inner face of a muscle rises with the outer face of
the muscle below; the muscle itself thickens. A global gain g, solved by bisection, makes the
total muscle volume meet the target; the per-group emphasis distributes the gain like a trained
physique.

Female proportions: per-segment transforms of the rig applied through the skinning weights
(scale does not propagate to children; rotations do): wider pelvis, narrower thorax, waist and
shoulders, larger carrying angle and knee valgus, smaller hands, feet and neck.
"""
from __future__ import annotations

import numpy as np
from scipy import ndimage

import anatomy
import meshops
import voxel

DENSITY = 1.06          # kg/L, skeletal muscle
MAX_REGION_DISP = 0.12  # m per unit region weight (guard in morph(); the largest legitimate one is ~8 cm)
BASE_SMM_FFM = 0.49     # SMM/FFM of the base model (young untrained man)
# Fraction of the skeletal musculature the model represents: internal oblique, transversus,
# quadratus lumborum, multifidus, diaphragm, facial muscles, tongue, pelvic floor and the
# posterior serrati are missing (~2 L in an adult).
COVERAGE = 0.92

PROFILES = {
    "male": {
        "height": 1.78, "ffmi": 26.0,
        # drawable normalized FFMI (morph target) and SMM/FFM along it
        "ffmi_range": (15.0, 32.0), "smm_ffm": ((17.0, 0.49), (26.0, 0.56)),
        # relative emphasis of the gain (male bodybuilding physique)
        "emphasis": {
            "traps-upper": 1.45, "traps-middle": 1.3, "traps-lower": 1.2, "delt-front": 1.5, "delt-side": 1.65,
            "delt-rear": 1.25, "chest-upper": 1.45, "chest-middle": 1.4, "chest-lower": 1.3, "lats": 1.45,
            "teres-major": 1.3, "rhomboids": 1.1, "erectors": 1.15, "biceps": 1.5, "brachialis": 1.35,
            "triceps": 1.5, "coracobrachialis": 0.9, "brachioradialis": 1.1, "forearm-flexors": 0.95,
            "forearm-extensors": 0.95, "abs": 0.8, "obliques": 0.6, "serratus": 1.1, "glutes": 0.85,
            "glute-med": 0.75, "tfl": 0.6, "quads": 0.8, "hamstrings": 0.75, "adductors": 0.65, "sartorius": 0.5,
            "gastrocnemius": 0.7, "soleus": 0.6, "tibialis": 0.5, "fibularis": 0.5, "deep-calf": 0.4,
            "scm": 1.1, "neck-back": 1.2, "neck-deep": 0.5, "rotator-cuff": 0.9, "hip-flexors": 0.5,
            "hip-rotators": 0.5, "hand": 0.3, "foot": 0.3, "intercostals": 0.0,
        },
        "proportions": None,
    },
    "female": {
        "height": 1.65, "ffmi": 22.0,
        "ffmi_range": (12.0, 26.0), "smm_ffm": ((14.0, 0.47), (22.0, 0.52)),
        # typical emphasis of female training: lower limbs and glutes
        "emphasis": {
            "traps-upper": 0.6, "traps-middle": 0.65, "traps-lower": 0.65, "delt-front": 0.85, "delt-side": 0.9,
            "delt-rear": 0.8, "chest-upper": 0.55, "chest-middle": 0.5, "chest-lower": 0.45, "lats": 0.85,
            "teres-major": 0.8, "rhomboids": 0.8, "erectors": 1.0, "biceps": 0.75, "brachialis": 0.7,
            "triceps": 0.75, "coracobrachialis": 0.5, "brachioradialis": 0.6, "forearm-flexors": 0.5,
            "forearm-extensors": 0.5, "abs": 0.75, "obliques": 0.5, "serratus": 0.8, "glutes": 1.6,
            "glute-med": 1.3, "tfl": 0.9, "quads": 1.05, "hamstrings": 1.05, "adductors": 0.85, "sartorius": 0.8,
            "gastrocnemius": 0.9, "soleus": 0.85, "tibialis": 0.6, "fibularis": 0.6, "deep-calf": 0.5,
            "scm": 0.5, "neck-back": 0.5, "neck-deep": 0.4, "rotator-cuff": 0.7, "hip-flexors": 0.6,
            "hip-rotators": 0.7, "hand": 0.2, "foot": 0.2, "intercostals": 0.0,
        },
        # Skeletal differences relative to height (adult anthropometry: biacromial breadth ~8 %
        # smaller, bi-iliac/bitrochanteric ~10–14 % larger, smaller rib cage, carrying angle ~13°
        # against ~10°, more knee valgus).
        # (scale x, y, z) about the segment pivot, rotation about z (degrees)
        "proportions": {
            "pelvis": {"scale": (1.14, 0.98, 1.04)},
            "spine_upper": {"scale": (0.90, 1.0, 0.94)},
            "chest": {"scale": (0.92, 1.0, 0.94)},
            "neck": {"scale": (0.86, 1.0, 0.90)},
            "head": {"scale": (0.95, 0.95, 0.95)},
            "shoulder_l": {"scale": (0.88, 1.0, 0.97)}, "shoulder_r": {"scale": (0.88, 1.0, 0.97)},
            "forearm_l": {"rot_z": 4.0}, "forearm_r": {"rot_z": -4.0},
            "thigh_l": {"rot_z": -2.2}, "thigh_r": {"rot_z": 2.2},
            "shin_l": {"rot_z": 2.2}, "shin_r": {"rot_z": -2.2},
            **{f"{seg}_{s}": {"scale": (0.92, 0.92, 0.92)} for s in "lr" for seg in
               ["hand", "thumb1", "thumb2", "thumb3", "index1", "index2", "index3", "middle1", "middle2", "middle3",
                "ring1", "ring2", "ring3", "pinky1", "pinky2", "pinky3", "foot", "toes"]},
        },
    },
}


# ---------------------------------------------------------------------------
# measurements
# ---------------------------------------------------------------------------

def height(parts) -> float:
    ys = np.concatenate([p.v[:, 1] for p in parts if p.kind == "bone"])
    return float(ys.max() - ys.min())


def muscle_volume(parts) -> float:
    """m³; signed sum (the cut rectus and oblique add up to the original closed mesh)."""
    return float(sum(meshops.volume(p.v, p.f) for p in parts if p.kind == "muscle"))


def body_stats(parts) -> dict:
    h = height(parts)
    vol = muscle_volume(parts)
    smm = vol * 1000 * DENSITY / COVERAGE
    return {"height": h, "muscleVolumeL": vol * 1000, "smm": smm, "ffm": smm / BASE_SMM_FFM,
            "ffmi": smm / BASE_SMM_FFM / h ** 2}


# ---------------------------------------------------------------------------
# per-segment transforms (proportions)
# ---------------------------------------------------------------------------

def _rz(deg):
    a = np.radians(deg)
    return np.array([[np.cos(a), -np.sin(a), 0], [np.sin(a), np.cos(a), 0], [0, 0, 1]])


def segment_maps(joints, spec) -> dict:
    """Per-segment affine maps: v' = p' + R_acc · S · (v − p). Rotation propagates to the
    children, scale does not (or shrinking the neck would shrink the head)."""
    maps, racc, newpos = {}, {}, {}
    for j in joints:  # compute_joints returns parents before children
        s = spec.get(j.name, {})
        S = np.diag(s.get("scale", (1, 1, 1)))
        R = _rz(s.get("rot_z", 0.0))
        parent_r = racc[j.parent] if j.parent else np.eye(3)
        racc[j.name] = parent_r @ R
        if j.parent:
            pm, pt = maps[j.parent]
            newpos[j.name] = pm @ j.pos + pt
        else:
            newpos[j.name] = j.pos.copy()
        m = racc[j.name] @ S
        maps[j.name] = (m, newpos[j.name] - m @ j.pos)
    return maps


def apply_proportions(parts, joints, spec) -> None:
    maps = segment_maps(joints, spec)
    names = [j.name for j in joints]
    mats = np.stack([maps[n][0] for n in names])
    trans = np.stack([maps[n][1] for n in names])
    for p in parts:
        if p.kind in ("bone", "cartilage"):
            m, t = maps[p.segment]
            p.v = p.v @ m.T + t
            continue
        if getattr(p, "joints", None) is None:
            continue
        out = np.zeros_like(p.v)
        for k in range(4):
            jk = p.joints[:, k].astype(int)
            wk = p.weights[:, k].astype(np.float64)[:, None]
            out += wk * (np.einsum("nij,nj->ni", mats[jk], p.v) + trans[jk])
        p.v = out
    for j in joints:
        m, t = maps[j.name]
        j.pos = m @ j.pos + t
        if j.axis is not None:
            a = m @ j.axis
            j.axis = a / np.linalg.norm(a)


# ---------------------------------------------------------------------------
# hypertrophy
# ---------------------------------------------------------------------------

def _grids(parts, emphasis, pitch, regions):
    allv = np.concatenate([p.v for p in parts])
    g = voxel.Grid(allv.min(axis=0) - 0.02, allv.max(axis=0) + 0.02, pitch)
    core = g.empty()
    for p in parts:
        if p.kind in ("bone", "cartilage", "viscera"):
            core |= g.solid(p.v, p.f)
    # emphasis of the muscle in each voxel (the largest where two overlap) and its region
    emph = np.zeros(g.shape, dtype=np.float32)
    label = np.zeros(g.shape, dtype=np.int16)
    for p in parts:
        if p.kind == "muscle":
            r = np.float32(emphasis.get(p.group, 1.0))
            m = g.solid(p.v, p.f)
            upd = m & (r > emph)
            emph[upd] = r
            label[upd] = regions.index(anatomy.region_of(p.group, p.side))
    emph[core] = 0
    dist = ndimage.distance_transform_edt(~core).astype(np.float32) * pitch
    smooth = ndimage.gaussian_filter(dist, 4.0)
    grad = [x / pitch for x in np.gradient(smooth)]
    return g, core, emph, label, dist, grad


def _field(g, f, p, order=1):
    return ndimage.map_coordinates(f, g.index(p), order=order, mode="nearest")


def stacking(parts, emphasis, regions, pitch=0.003, step=0.0015, reach=0.16):
    """For every soft vertex: direction u (away from the core) and B = ∫ emphasis along the
    path down to the core. The final displacement is g · B · u.

    The integral splits by region (`regions`, anatomy.region_ids): B = Σ B_r, where B_r sums
    only the muscle voxels of that region. Everything afterwards (smoothing, Taubin, scale) is
    linear, so every region becomes a morph target and their sum, with equal weights, is
    exactly the uniform hypertrophy. Returns {part id: {region index: field (n, 3)}}, only for
    the regions that move the part."""
    g, _core, emph, label, dist, grad = _grids(parts, emphasis, pitch, regions)
    R = len(regions)
    fields = {}
    for p in parts:
        if p.kind not in ("muscle", "tissue"):
            continue
        n = len(p.v)
        rows = np.arange(n)
        u = np.stack([_field(g, gr, p.v) for gr in grad], axis=-1)
        u /= np.linalg.norm(u, axis=-1, keepdims=True) + 1e-9
        B = np.zeros((n, R))
        alive = np.ones(n, dtype=bool)
        # the ray is no longer than 1.3× the true distance to the core: a ray grazing the edge of
        # a bone (scapula, iliac crest) would add up muscle from elsewhere
        limit = np.minimum(1.3 * _field(g, dist, p.v) + 0.005, reach)
        for k in range(int(reach / step)):
            x = p.v - u * (k * step)
            d = _field(g, dist, x)
            alive &= (d > 0) & (k * step <= limit)
            if not alive.any():
                break
            e = np.where(alive, _field(g, emph, x, order=0), 0) * step
            B[rows, _field(g, label, x, order=0).astype(np.int64)] += e
        if getattr(p, "growth", None) is not None:
            B = B * p.growth[:, None]
        # smooth the vector (not magnitude and direction separately); cut borders keep the
        # computed value, identical on both sides
        D = B[:, :, None] * u[:, None, :]
        fixed = meshops.boundary_vertices(n, p.f)
        D = meshops.smooth_values(D.reshape(n, R * 3), p.f, iters=14, lam=0.5, fixed=fixed).reshape(n, R, 3)
        fields[p.id] = {r: D[:, r] for r in range(R) if np.abs(D[:, r]).max() > 1e-9}
    return fields


# limbs: region → (proximal, distal) joint of the axis
LIMB_AXES = {"upperarm": ("upperarm", "forearm"), "forearm": ("forearm", "hand"),
             "thigh": ("thigh", "shin"), "calf": ("shin", "foot")}
# how much of each limb's displacement becomes isotropic growth (mid-limb): the arm is the most
# flattened by stacking; thigh and lower leg already grow almost evenly
ISO_MIX = {"upperarm": 1.0, "forearm": 0.9, "thigh": 0.7, "calf": 0.7}


def isotropize_limbs(parts, joints, fields_r: dict, regions: list[str], mix: dict = ISO_MIX) -> dict:
    """Isotropic growth of the limbs.

    Stacking thickens every layer along the thickness it already has: in the arm, biceps and
    triceps are thick antero-posteriorly and thin at the sides, so the cross-section grows almost
    only in depth (at FFMI 26, 10 × 21 cm — a real arm is nearly round). A fusiform muscle grows
    in area, in width and in depth. Here, at every level along the limb axis, the displacement
    becomes a radial scale about the centre of the cross-section; the blend is `mix[limb]` mid-limb
    and falls to zero near the joints, where the limb meets its neighbours. The scale is computed
    once, per unit of gain on the rest shape, so the field stays linear (region morphs remain
    exactly additive); it matches the outline area stacking adds at unit gain to first order, not
    each level's volume — check_isotropy.py measures the difference (docs/validation/anatomy-checks.md). Layers stay stacked:
    the scale is monotonic in the distance to the centre, and whatever lies on top (deltoid,
    iliotibial tract) receives the same field by position.
    """
    from scipy.spatial import ConvexHull
    J = {j.name: j.pos for j in joints}
    by_id = {p.id: p for p in parts}
    for rid in regions:
        base, _, side = rid.partition("_")
        if base not in LIMB_AXES or side not in ("l", "r"):
            continue
        ri = regions.index(rid)
        a = J[f"{LIMB_AXES[base][0]}_{side}"]
        b = J[f"{LIMB_AXES[base][1]}_{side}"]
        L = float(np.linalg.norm(b - a))
        ax = (b - a) / L
        own = [p for p in parts if p.kind == "muscle" and anatomy.region_of(p.group, p.side) == rid and ri in fields_r[p.id]]
        V = np.concatenate([p.v for p in own])
        D = np.concatenate([fields_r[p.id][ri] for p in own])
        fv = (V - a) @ ax / L
        e1 = np.cross(ax, [0.0, 0.0, 1.0])
        e1 /= np.linalg.norm(e1)
        e2 = np.cross(ax, e1)
        levels = np.linspace(0.0, 1.0, 41)
        cent = np.zeros((len(levels), 3))
        scale = np.zeros(len(levels))
        reach = np.zeros(len(levels))  # limb radius (distance to the axis) at each level
        rv = V - a
        rv = np.linalg.norm(rv - np.outer(rv @ ax, ax), axis=1)
        for k, f in enumerate(levels):
            sl = np.abs(fv - f) < 0.02
            if sl.sum() < 12:
                cent[k] = a + f * L * ax
                continue
            reach[k] = float(np.percentile(rv[sl], 98))
            q = V[sl] - a
            q2 = np.c_[q @ e1, q @ e2]
            try:
                h = ConvexHull(q2)
            except Exception:
                cent[k] = a + f * L * ax
                continue
            c2 = q2[h.vertices].mean(axis=0)
            cent[k] = a + f * L * ax + c2[0] * e1 + c2[1] * e2
            # outward displacement on the outline: component of the field along the radial direction
            hv = h.vertices
            rad = q2[hv] - c2
            rn = rad / (np.linalg.norm(rad, axis=1, keepdims=True) + 1e-9)
            dperp = np.c_[D[sl][hv] @ e1, D[sl][hv] @ e2]
            m = float(np.mean(np.einsum("ij,ij->i", dperp, rn)))
            area, perim = h.volume, h.area
            if area <= 0 or m <= 0:
                continue
            # area added by stacking ≈ perimeter × mean thickness; a radial scale s over area A adds
            # A(s² − 1): the same area with s = √(1 + P·m/A), per unit gain
            scale[k] = np.sqrt(1 + perim * m / area) - 1
        # mid-limb levels (with a cross-section) drive the empty ones; the blend falls off at the ends
        ok = scale > 0
        if ok.sum() < 3:
            continue
        scale = np.interp(levels, levels[ok], scale[ok])
        has = reach > 0
        reach = np.interp(levels, levels[has], reach[has])
        for c in range(3):
            cent[:, c] = np.interp(levels, levels[ok], cent[ok, c])
        for pid, fr in fields_r.items():
            if ri not in fr:
                continue
            p = by_id[pid]
            f = (p.v - a) @ ax / L
            w = mix[base] * _smooth01((f - 0.04) / 0.16) * _smooth01((0.96 - f) / 0.16)
            # only inside the limb: pectoralis and latissimus inserting on the humerus, or pieces on
            # the other side with a residue of this region, would get a scale measured from far
            # away (tens of centimetres)
            ra = p.v - a
            ra = np.linalg.norm(ra - np.outer(ra @ ax, ax), axis=1)
            R = np.interp(np.clip(f, 0, 1), levels, reach)
            w = w * _smooth01((1.4 * R - ra) / (0.3 * R + 1e-9))
            if not np.any(w > 0):
                continue
            fc = np.clip(f, 0, 1)
            c3 = np.stack([np.interp(fc, levels, cent[:, c]) for c in range(3)], axis=1)
            rho = p.v - c3
            rho -= np.outer(rho @ ax, ax)
            iso = np.interp(fc, levels, scale)[:, None] * rho
            fr[ri] = (1 - w[:, None]) * fr[ri] + w[:, None] * iso
    return fields_r


def _smooth01(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3 - 2 * x)


def total_fields(fields_r: dict, parts) -> dict:
    """Field of the uniform hypertrophy: the sum of the regions."""
    out = {}
    for p in parts:
        if p.id in fields_r:
            out[p.id] = sum(fields_r[p.id].values()) if fields_r[p.id] else np.zeros_like(p.v)
    return out


def apply_hypertrophy(parts, fields, gain: float, base=None) -> None:
    for p in parts:
        if p.id in fields:
            src = base[p.id] if base is not None else p.v
            p.v = src + gain * fields[p.id]


def solve_gain(parts, fields, target_ratio: float, tol=0.002) -> float:
    base = {p.id: p.v.copy() for p in parts if p.id in fields}
    v0 = muscle_volume(parts)
    lo, hi = 0.0, 4.0
    for _ in range(40):
        mid = (lo + hi) / 2
        apply_hypertrophy(parts, fields, mid, base)
        ratio = muscle_volume(parts) / v0
        if abs(ratio - target_ratio) < tol:
            break
        lo, hi = (mid, hi) if ratio < target_ratio else (lo, mid)
    return mid


# ---------------------------------------------------------------------------
# framing
# ---------------------------------------------------------------------------

def normalize(parts, joints, target_height: float) -> tuple[float, np.ndarray]:
    """Feet at y = 0, pelvis at x = z = 0, target height (uniform scale). Returns (scale, origin)."""
    ys = np.concatenate([p.v[:, 1] for p in parts if p.kind == "bone"])
    pelvis = next(j for j in joints if j.name == "pelvis").pos
    origin = np.array([pelvis[0], ys.min(), pelvis[2]])
    s = target_height / (ys.max() - ys.min())
    for p in parts:
        p.v = (p.v - origin) * s
    for j in joints:
        j.pos = (j.pos - origin) * s
    return s, origin


def ffmi_from_smm(smm: float, prof: dict) -> tuple[float, float]:
    """(raw FFMI, normalized FFMI) at the model height, from the SMM.

    SMM/FFM rises with training (profile table): solves the fixed point
    FFMI = SMM / (k(FFMI) · h²). Normalized: + 6.1 × (1.8 − h) (Kouri et al. 1995).
    """
    (f0, k0), (f1, k1) = prof["smm_ffm"]
    h = prof["height"]
    ffmi = smm / (k0 * h * h)
    for _ in range(20):
        k = float(np.interp(ffmi, [f0, f1], [k0, k1]))
        ffmi = smm / (k * h * h)
    return ffmi, ffmi + 6.1 * (1.8 - h)


def morph(parts, joints, sex: str, log=print) -> dict:
    if sex == "base":  # development comparison only: BodyParts3D at the male height
        normalize(parts, joints, PROFILES["male"]["height"])
        return {"sex": "base"}
    prof = PROFILES[sex]
    base = body_stats(parts)
    log(f"base: {base['height']:.3f} m, muscles {base['muscleVolumeL']:.1f} L, SMM {base['smm']:.1f} kg, "
        f"FFMI ≈ {base['ffmi']:.1f}")
    if prof["proportions"]:
        apply_proportions(parts, joints, prof["proportions"])
    # SMM at the final height from the current volume (volume ∝ height³)
    scale3 = (prof["height"] / height(parts)) ** 3
    regions = anatomy.region_ids()
    fields_r = stacking(parts, prof["emphasis"], regions)
    fields_r = isotropize_limbs(parts, joints, fields_r, regions)
    fields = total_fields(fields_r, parts)
    rest = {p.id: p.v.copy() for p in parts if p.id in fields}

    def ffmi_at(g: float) -> float:
        apply_hypertrophy(parts, fields, g, rest)
        smm = muscle_volume(parts) * 1000 * DENSITY / COVERAGE * scale3
        return ffmi_from_smm(smm, prof)[1]

    # normalized FFMI along the gain (monotonic) → gains at the ends of the range
    gains = np.round(np.arange(-0.4, 3.01, 0.1), 3)
    ffmis = np.array([ffmi_at(g) for g in gains])
    lo, hi = prof["ffmi_range"]
    g_lo = float(np.interp(lo, ffmis, gains))
    g_hi = float(np.interp(hi, ffmis, gains))
    lo, hi = float(np.interp(g_lo, gains, ffmis)), float(np.interp(g_hi, gains, ffmis))

    # shape at the maximum and at the minimum FFMI; everything afterwards (Taubin with fixed
    # borders, scale) is linear, so minimum + t × (maximum − minimum) reproduces any gain between
    apply_hypertrophy(parts, fields, g_hi, rest)
    round_edges(parts)
    top = {pid: next(p for p in parts if p.id == pid).v.copy() for pid in fields}
    apply_hypertrophy(parts, fields, g_lo, rest)
    round_edges(parts)
    s, origin = normalize(parts, joints, prof["height"])
    for p in parts:
        if p.id in top:
            p.morph = (top[p.id] - origin) * s - p.v
    # one morph per region: the same path (gain, Taubin with fixed borders, scale), which is
    # linear — with all weights equal, the sum reproduces the uniform morph above
    worst = 0.0
    for p in parts:
        if p.id not in top:
            continue
        p.region_morph = {}
        for r, D in fields_r[p.id].items():
            d = D * (g_hi - g_lo)
            if p.kind == "muscle":
                d = meshops.taubin(d, p.f, iters=3)
            p.region_morph[r] = d * s
        total = sum(p.region_morph.values()) if p.region_morph else np.zeros_like(p.v)
        worst = max(worst, float(np.abs(total - p.morph).max()))
    if worst > 1e-6:
        raise SystemExit(f"region morphs do not add up to the uniform morph (error {worst * 1000:.4f} mm)")
    # guard: no point moves more than MAX_REGION_DISP per unit weight of one region (a field applied
    # far from its own limb once produced 30 cm "streamers" out of the hands)
    big = [(float(np.linalg.norm(m, axis=1).max()), p.id, regions[r]) for p in parts
           for r, m in getattr(p, "region_morph", {}).items()]
    big = max(big) if big else (0.0, "", "")
    if big[0] > MAX_REGION_DISP:
        raise SystemExit(f"morph of region {big[2]} moves {big[1]} by {big[0] * 100:.1f} cm per unit weight")
    log(f"region morphs: {len(regions)} regions, sum = uniform (max error {worst:.1e} m)")

    sel = (gains >= g_lo - 1e-9) & (gains <= g_hi + 1e-9)
    table = [[round(lo, 2), 0.0]] + [[round(float(f), 2), round((float(g) - g_lo) / (g_hi - g_lo), 4)]
                                      for g, f in zip(gains[sel], ffmis[sel])] + [[round(hi, 2), 1.0]]
    table = [row for i, row in enumerate(table) if i == 0 or row[0] > table[i - 1][0] + 1e-6]
    default_t = float(np.interp(prof["ffmi"], [r[0] for r in table], [r[1] for r in table]))
    info = {"sex": sex, "heightM": prof["height"], "baseFfmi": round(base["ffmi"], 1), "scale": round(s, 4),
            "ffmi": {"min": round(lo, 2), "max": round(hi, 2), "default": prof["ffmi"], "normalized": True,
                     "table": table,
                     # SMM → FFMI (ffmi_from_smm), for consumers that recompute the FFMI of a muscle volume
                     "smm": {"density": DENSITY, "coverage": COVERAGE, "smmFfm": [list(x) for x in prof["smm_ffm"]]}},
            "defaultWeight": round(default_t, 4), "gainRange": [round(g_lo, 3), round(g_hi, 3)],
            "regions": regions}
    log(f"{sex}: normalized FFMI {lo:.1f}–{hi:.1f} (gain {g_lo:.2f}–{g_hi:.2f}), "
        f"default {prof['ffmi']} → weight {default_t:.3f}")
    return info


# ---------------------------------------------------------------------------
# finishing
# ---------------------------------------------------------------------------

def round_edges(parts, iters: int = 3) -> None:
    """Light Taubin after hypertrophy: rounds the edges of BodyParts3D's plate-like meshes
    without touching the cut seams (borders stay fixed)."""
    for p in parts:
        if p.kind == "muscle":
            p.v = meshops.taubin(p.v, p.f, iters=iters)


def bake_ao(parts, pitch: float = 0.003, strength: float = 1.0) -> None:
    """Per-vertex ambient occlusion (p.ao, 0–1) from the distance field of the whole body:
    samples the SDF along the normal; where there is volume nearby, the point sits in a groove."""
    from gltf import vertex_normals
    shown = [p for p in parts if p.kind in ("muscle", "tissue", "bone", "cartilage")]
    allv = np.concatenate([p.v for p in shown])
    g = voxel.Grid(allv.min(axis=0) - 0.05, allv.max(axis=0) + 0.05, pitch)
    solid = g.empty()
    for p in shown:
        solid |= g.solid(p.v, p.f)
    sdf = g.sdf(solid)
    dists = np.array([0.006, 0.012, 0.024, 0.045])
    weights = np.array([0.5, 0.25, 0.15, 0.10])
    for p in shown:
        n = vertex_normals(p.v, p.f)
        occ = np.zeros(len(p.v))
        for d, w in zip(dists, weights):
            s = ndimage.map_coordinates(sdf, g.index(p.v + n * d), order=1, mode="nearest")
            occ += w * np.clip((d - s) / d, 0, 1)
        ao = np.clip(1 - strength * occ * 1.6, 0.25, 1)
        p.ao = meshops.smooth_values(ao, p.f, iters=2, lam=0.5)
