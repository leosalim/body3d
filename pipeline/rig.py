"""Rig: joint pivots taken from the bone geometry, and skinning weights.

Every skeleton segment (anatomy.BONE_SEGMENTS) becomes a rig bone with its pivot at the proximal
joint. In the rest pose every bone has identity rotation (world axes); the anatomical axes of
the hinges (knee, elbow, ankle) are kept in `axis` for whoever animates later.

How each pivot is found:
- ball joints (hip, shoulder): least-squares sphere fitted to the head of the femur/humerus,
  seeded by the vertices near the socket (acetabulum/glenoid);
- hinges (knee, elbow): midpoint of the epicondyles;
- ankle: midpoint of the tips of the malleoli;
- spine: centre of the intervertebral disks (L5/S1, L2/L3, T12/L1, C7/T1);
- head: occipital–atlas contact; sternoclavicular: clavicle–manubrium contact;
- wrist: head of the capitate (contact with the lunate);
- fingers: centre of the contact between neighbouring bones.
"""
from __future__ import annotations

import dataclasses
import re

import numpy as np
from scipy.spatial import cKDTree

import meshops

SIDES = ("l", "r")


@dataclasses.dataclass
class Joint:
    name: str
    parent: str | None
    pos: np.ndarray
    axis: np.ndarray | None = None  # flexion axis of the hinges


def _bone(parts, pattern: str, side: str | None = None) -> np.ndarray:
    vs = [p.v for p in parts if p.kind in ("bone", "cartilage") and re.search(pattern, p.label)
          and (side is None or p.side == side)]
    if not vs:
        raise KeyError(f"bone not found: {pattern} ({side})")
    return np.concatenate(vs)


def _contact(a: np.ndarray, b: np.ndarray, want: int = 60, start: float = 0.002, stop: float = 0.02) -> np.ndarray:
    """Vertices of `a` near `b`, widening the radius until there are `want` of them."""
    d, _ = cKDTree(b).query(a)
    r = start
    while r <= stop:
        sel = a[d < r]
        if len(sel) >= want:
            return sel
        r *= 1.4
    return a[np.argsort(d)[:want]]


def fit_sphere(p: np.ndarray) -> tuple[np.ndarray, float]:
    A = np.c_[2 * p, np.ones(len(p))]
    b = (p * p).sum(axis=1)
    x, *_ = np.linalg.lstsq(A, b, rcond=None)
    c = x[:3]
    return c, float(np.sqrt(max(x[3] + c @ c, 1e-12)))


def ball_center(head_bone: np.ndarray, socket: np.ndarray) -> np.ndarray:
    seed = _contact(head_bone, socket, want=120)
    c, r = fit_sphere(seed)
    for _ in range(3):  # grow to the whole head: vertices close to the sphere
        d = np.abs(np.linalg.norm(head_bone - c, axis=1) - r)
        sel = head_bone[(d < 0.003) & (np.linalg.norm(head_bone - c, axis=1) < r * 1.3)]
        if len(sel) < 50:
            break
        c, r = fit_sphere(sel)
    return c


def _pca_axis(p: np.ndarray) -> np.ndarray:
    c = p - p.mean(axis=0)
    _, _, vt = np.linalg.svd(c, full_matrices=False)
    ax = vt[0]
    return ax if ax[1] > 0 else -ax  # pointing up


def epicondyles(bone: np.ndarray, frac: float = 0.12) -> tuple[np.ndarray, np.ndarray]:
    """Centre and axis between the epicondyles at the distal end of a long bone."""
    ax = _pca_axis(bone)
    t = (bone - bone.mean(axis=0)) @ ax
    distal = bone[t < t.min() + (t.max() - t.min()) * frac]
    ml = np.cross(ax, [0.0, 0.0, 1.0])
    ml /= np.linalg.norm(ml)
    s = distal @ ml
    a, b = distal[np.argmin(s)], distal[np.argmax(s)]
    axis = (b - a) / np.linalg.norm(b - a)
    return (a + b) / 2, axis


def compute_joints(parts) -> list[Joint]:
    J: list[Joint] = []
    disc = lambda n: _bone(parts, rf"intervertebral disk of {n}$").mean(axis=0)  # noqa: E731

    hips = {s: ball_center(_bone(parts, "femur", s), _bone(parts, "hip bone", s)) for s in SIDES}
    J.append(Joint("pelvis", None, (hips["l"] + hips["r"]) / 2))
    l5s1 = disc("fifth lumbar vertebra")
    J.append(Joint("spine_lower", "pelvis", l5s1))
    J.append(Joint("spine_upper", "spine_lower", disc("second lumbar vertebra")))
    t11, l1 = disc("eleventh thoracic vertebra"), disc("first lumbar vertebra")
    J.append(Joint("chest", "spine_upper", (t11 + l1) / 2))
    J.append(Joint("neck", "chest", disc("seventh cervical vertebra")))
    J.append(Joint("head", "neck", _contact(_bone(parts, "occipital bone"), _bone(parts, "^atlas$"), want=80).mean(axis=0)))

    for s in SIDES:
        clav = _bone(parts, "clavicle", s)
        J.append(Joint(f"shoulder_{s}", "chest", _contact(clav, _bone(parts, "manubrium"), want=40).mean(axis=0)))
        J.append(Joint(f"upperarm_{s}", f"shoulder_{s}", ball_center(_bone(parts, "humerus", s), _bone(parts, "scapula", s))))
        c, ax = epicondyles(_bone(parts, "humerus", s))
        J.append(Joint(f"forearm_{s}", f"upperarm_{s}", c, ax))
        wrist = _contact(_bone(parts, "capitate", s), _bone(parts, "lunate", s), want=40).mean(axis=0)
        J.append(Joint(f"hand_{s}", f"forearm_{s}", wrist))
        # thumb: carpometacarpal (trapezium–first metacarpal), MCP, IP
        J.append(Joint(f"thumb1_{s}", f"hand_{s}", _gap(parts, "trapezium", "first metacarpal", s)))
        J.append(Joint(f"thumb2_{s}", f"thumb1_{s}", _gap(parts, "first metacarpal", "proximal phalanx of .* thumb", s)))
        J.append(Joint(f"thumb3_{s}", f"thumb2_{s}",
                       _gap(parts, "proximal phalanx of .* thumb", "distal phalanx of .* thumb", s)))
        for finger, meta, fma in (("index", "second", "index"), ("middle", "third", "middle"),
                                  ("ring", "fourth", "ring"), ("pinky", "fifth", "little")):
            proximal = f"proximal phalanx of .* {fma} finger"
            middle = f"middle phalanx of .* {fma} finger"
            distal = f"distal phalanx of .* {fma} finger"
            J.append(Joint(f"{finger}1_{s}", f"hand_{s}", _gap(parts, f"{meta} metacarpal", proximal, s)))
            J.append(Joint(f"{finger}2_{s}", f"{finger}1_{s}", _gap(parts, proximal, middle, s)))
            J.append(Joint(f"{finger}3_{s}", f"{finger}2_{s}", _gap(parts, middle, distal, s)))

        J.append(Joint(f"thigh_{s}", "pelvis", hips[s]))
        c, ax = epicondyles(_bone(parts, "femur", s), frac=0.1)
        J.append(Joint(f"shin_{s}", f"thigh_{s}", c, ax))
        J.append(Joint(f"foot_{s}", f"shin_{s}", *_ankle(parts, s)))
        J.append(Joint(f"toes_{s}", f"foot_{s}", _gap(parts, "metatarsal", "proximal phalanx of .* toe", s)))
    return J


def _gap(parts, a: str, b: str, side: str) -> np.ndarray:
    pa, pb = _bone(parts, a, side), _bone(parts, b, side)
    return np.concatenate([_contact(pa, pb, want=30), _contact(pb, pa, want=30)]).mean(axis=0)


def _ankle(parts, side: str):
    tib, fib = _bone(parts, "tibia", side), _bone(parts, "fibula", side)
    medial = 1.0 if side == "r" else -1.0  # the right side has x < 0: medial is +x
    low_t = tib[tib[:, 1] < tib[:, 1].min() + 0.025]
    low_f = fib[fib[:, 1] < fib[:, 1].min() + 0.015]
    mm = low_t[np.argmax(low_t[:, 0] * medial)]
    lm = low_f[np.argmin(low_f[:, 0] * medial)]
    ax = (mm - lm) / np.linalg.norm(mm - lm)
    return (mm + lm) / 2, ax


# ---------------------------------------------------------------------------
# skinning
# ---------------------------------------------------------------------------

def check_segments(parts, joints: list[Joint], limit: float = 0.45) -> None:
    """Every bone must lie near the pivot of its own segment: a loose regex in
    anatomy.BONE_SEGMENTS once sent the cuneiform cartilage of the larynx to the foot."""
    pos = {j.name: j.pos for j in joints}
    bad = []
    for p in parts:
        if p.kind in ("bone", "cartilage") and p.segment in pos:
            d = float(np.linalg.norm(p.v.mean(axis=0) - pos[p.segment]))
            if d > limit:
                bad.append(f"{p.label} → {p.segment} ({d:.2f} m)")
    if bad:
        raise SystemExit("bones far from their segment:\n" + "\n".join(bad))


def skin_weights(parts, joints: list[Joint], spacing: float = 0.004) -> None:
    """Fills p.joints (N×4 indices) and p.weights (N×4) on every part.

    Bone: rigid on its own segment. Soft tissue: inverse distance to the bone surface of each
    segment (third power, only segments within 4 cm of the nearest one), with the part's
    dominant segment reinforced, the 4 largest kept, smoothed over the mesh.
    """
    names = [j.name for j in joints]
    index = {n: i for i, n in enumerate(names)}
    seg_pts: dict[str, np.ndarray] = {}
    for p in parts:
        if p.kind in ("bone", "cartilage") and p.segment in index:
            pts = meshops.sample_surface(p.v, p.f, spacing)
            seg_pts[p.segment] = np.concatenate([seg_pts[p.segment], pts]) if p.segment in seg_pts else pts
    segs = sorted(seg_pts)
    trees = {s: cKDTree(seg_pts[s]) for s in segs}
    neighbors: dict[str, set] = {}
    for j in joints:
        if j.parent:
            neighbors.setdefault(j.name, set()).add(j.parent)
            neighbors.setdefault(j.parent, set()).add(j.name)

    for p in parts:
        n = len(p.v)
        if p.kind in ("bone", "cartilage"):
            p.joints = np.zeros((n, 4), dtype=np.uint16)
            p.joints[:, 0] = index[p.segment]
            p.weights = np.zeros((n, 4), dtype=np.float32)
            p.weights[:, 0] = 1
            continue
        d = np.stack([trees[s].query(p.v, distance_upper_bound=0.4)[0] for s in segs], axis=1)
        d = np.minimum(d, 1.0)
        # a part only binds to the segments that dominate its vertices and to their neighbours in
        # the chain (the hand hangs next to the thigh: without this, raising the leg would take
        # the hand along)
        nearest = np.argmin(d, axis=1)
        counts = np.bincount(nearest, minlength=len(segs))
        core = {segs[k] for k in np.flatnonzero(counts >= max(3, 0.03 * n))}
        allowed = set(core)
        for s in core:
            allowed |= neighbors.get(s, set())
        d[:, [k for k, s in enumerate(segs) if s not in allowed]] = 1.0
        dmin = d.min(axis=1, keepdims=True)
        w = 1.0 / np.maximum(d, 0.004) ** 3
        w[d > dmin + 0.04] = 0
        # the dominant segment (where most of the muscle is) weighs 4×: the belly turns rigidly
        # with its bone and only the ends, near the other joint, blend — without it the biceps
        # stretched between humerus and forearm when the elbow flexed
        w[:, int(np.argmax(counts))] *= 4.0
        w /= w.sum(axis=1, keepdims=True)
        w = meshops.smooth_values(w, p.f, iters=10, lam=0.5)
        top = np.argsort(-w, axis=1)[:, :4]
        tw = np.take_along_axis(w, top, axis=1)
        tw /= tw.sum(axis=1, keepdims=True)
        p.joints = np.array([[index[segs[k]] for k in row] for row in top], dtype=np.uint16)
        p.weights = tw.astype(np.float32)
