"""Mesh operations used by the pipeline (plain numpy + fast_simplification)."""
from __future__ import annotations

import fast_simplification
import numpy as np
from scipy import sparse
from scipy.spatial import cKDTree


def weld(v: np.ndarray, f: np.ndarray, tol: float = 1e-6) -> tuple[np.ndarray, np.ndarray]:
    """Merges coincident vertices and drops degenerate and duplicate faces."""
    key = np.round(v / tol).astype(np.int64)
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    inv = inv.reshape(-1)
    v2 = v[first]
    f2 = inv[f]
    ok = (f2[:, 0] != f2[:, 1]) & (f2[:, 1] != f2[:, 2]) & (f2[:, 0] != f2[:, 2])
    f2 = f2[ok]
    srt = np.sort(f2, axis=1)
    _, keep = np.unique(srt, axis=0, return_index=True)
    f2 = f2[np.sort(keep)]
    return compact(v2, f2)


def weld_attr(v: np.ndarray, f: np.ndarray, attr: np.ndarray, tol: float = 1e-6):
    """weld() carrying a per-vertex attribute (the first merged vertex keeps its value)."""
    key = np.round(v / tol).astype(np.int64)
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    inv = inv.reshape(-1)
    f2 = inv[f]
    ok = (f2[:, 0] != f2[:, 1]) & (f2[:, 1] != f2[:, 2]) & (f2[:, 0] != f2[:, 2])
    return compact(v[first], f2[ok], attr[first])


def compact(v: np.ndarray, f: np.ndarray, *attrs: np.ndarray):
    used = np.unique(f)
    remap = -np.ones(len(v), dtype=np.int64)
    remap[used] = np.arange(len(used))
    out = (v[used], remap[f])
    return (*out, *(a[used] for a in attrs)) if attrs else out


def area(v: np.ndarray, f: np.ndarray) -> float:
    return float(np.linalg.norm(np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]]), axis=1).sum() / 2)


def volume(v: np.ndarray, f: np.ndarray) -> float:
    """Signed volume (m³); meaningful only for a closed, consistently oriented mesh."""
    a, b, c = v[f[:, 0]], v[f[:, 1]], v[f[:, 2]]
    return float(np.einsum("ij,ij->i", a, np.cross(b, c)).sum() / 6)


def decimate(v: np.ndarray, f: np.ndarray, faces: int) -> tuple[np.ndarray, np.ndarray]:
    if len(f) <= faces:
        return v, f
    red = 1 - faces / len(f)
    v2, f2 = fast_simplification.simplify(v.astype(np.float32), f.astype(np.int32), red, agg=5)
    return weld(v2.astype(np.float64), f2.astype(np.int64))


def adjacency(n: int, f: np.ndarray) -> sparse.csr_matrix:
    i = np.concatenate([f[:, 0], f[:, 1], f[:, 2], f[:, 1], f[:, 2], f[:, 0]])
    j = np.concatenate([f[:, 1], f[:, 2], f[:, 0], f[:, 0], f[:, 1], f[:, 2]])
    a = sparse.csr_matrix((np.ones(len(i)), (i, j)), shape=(n, n))
    a.data[:] = 1
    return a


def smooth_values(values: np.ndarray, f: np.ndarray, iters: int = 5, lam: float = 0.5,
                  fixed: np.ndarray | None = None) -> np.ndarray:
    """Smooths a per-vertex field (neighbour average), optionally keeping some vertices fixed."""
    a = adjacency(len(values), f)
    deg = np.asarray(a.sum(axis=1)).reshape(-1, *([1] * (values.ndim - 1)))
    deg[deg == 0] = 1
    x = values.astype(np.float64).copy()
    for _ in range(iters):
        avg = (a @ x.reshape(len(x), -1)).reshape(x.shape) / deg
        new = x + lam * (avg - x)
        if fixed is not None:
            new[fixed] = x[fixed]
        x = new
    return x


def boundary_vertices(n: int, f: np.ndarray) -> np.ndarray:
    """Vertices on edges used by a single face (borders of open meshes, cuts)."""
    e = np.sort(np.concatenate([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]]), axis=1)
    uniq, counts = np.unique(e, axis=0, return_counts=True)
    mask = np.zeros(n, dtype=bool)
    mask[uniq[counts == 1].reshape(-1)] = True
    return mask


def taubin(v: np.ndarray, f: np.ndarray, iters: int = 10, lam: float = 0.5, mu: float = -0.53,
           keep_boundary: bool = True) -> np.ndarray:
    """Smoothing without shrinkage (Taubin λ/μ). Borders stay fixed, so two parts cut from the
    same mesh stay glued together."""
    a = adjacency(len(v), f)
    deg = np.asarray(a.sum(axis=1))
    deg[deg == 0] = 1
    fixed = boundary_vertices(len(v), f) if keep_boundary else np.zeros(len(v), dtype=bool)
    x = v.copy()
    for _ in range(iters):
        for k in (lam, mu):
            step = k * ((a @ x) / deg - x)
            step[fixed] = 0
            x = x + step
    return x


def split_by_field(v: np.ndarray, f: np.ndarray, s: np.ndarray, *attrs: np.ndarray):
    """Cuts the mesh exactly along the iso-line s = 0.

    Returns (v, f, side_per_face, *attrs) with new vertices on the cut, duplicated for each
    side — the two pieces stay glued (same surface), but every face belongs to one side only,
    so no colour bleeds across the cut.
    """
    s = s.astype(np.float64).copy()
    s[np.abs(s) < 1e-9] = 1e-9  # no vertex exactly on the cut
    pos = s > 0
    fp = pos[f]
    npos = fp.sum(axis=1)
    whole = (npos == 0) | (npos == 3)
    out_f = [f[whole]]
    out_side = [npos[whole] == 3]
    verts = [v]
    extra_attrs = [[a] for a in attrs]
    cut_cache: dict[tuple[int, int, bool], int] = {}
    count = len(v)

    def cut_vertex(i: int, j: int, side: bool) -> int:
        nonlocal count
        key = (min(i, j), max(i, j), side)
        if key in cut_cache:
            return cut_cache[key]
        t = s[i] / (s[i] - s[j])
        verts.append((v[i] + t * (v[j] - v[i]))[None])
        for lst, a in zip(extra_attrs, attrs):
            lst.append((a[i] + t * (a[j] - a[i]))[None])
        cut_cache[key] = count
        count += 1
        return cut_cache[key]

    for tri, p in zip(f[~whole], fp[~whole]):
        # rotate so that the lone vertex is tri[0]
        lone_side = p.sum() == 1
        k = int(np.where(p == lone_side)[0][0])
        a, b, c = tri[k], tri[(k + 1) % 3], tri[(k + 2) % 3]
        ab_l, ac_l = cut_vertex(a, b, lone_side), cut_vertex(a, c, lone_side)
        ab_o, ac_o = cut_vertex(a, b, not lone_side), cut_vertex(a, c, not lone_side)
        out_f.append(np.array([[a, ab_l, ac_l]]))
        out_side.append(np.array([lone_side]))
        out_f.append(np.array([[ab_o, b, c], [ab_o, c, ac_o]]))
        out_side.append(np.array([not lone_side, not lone_side]))
    v_out = np.concatenate(verts)
    f_out = np.concatenate(out_f).astype(np.int64)
    side = np.concatenate(out_side).astype(bool)
    return (v_out, f_out, side, *(np.concatenate(a) for a in extra_attrs))


def submesh(v: np.ndarray, f: np.ndarray, mask: np.ndarray, *attrs: np.ndarray):
    return compact(v, f[mask], *attrs)


def nearest(points: np.ndarray, targets: np.ndarray, k: int = 1):
    return cKDTree(targets).query(points, k=k)


def sample_surface(v: np.ndarray, f: np.ndarray, spacing: float) -> np.ndarray:
    """Nearly uniform points on the surface (to voxelize and to measure distances).

    Seeded: the same mesh always gives the same points (the build is reproducible)."""
    a, b, c = v[f[:, 0]], v[f[:, 1]], v[f[:, 2]]
    ar = np.linalg.norm(np.cross(b - a, c - a), axis=1) / 2
    n = np.maximum(1, np.ceil(ar / (spacing * spacing * 0.4)).astype(np.int64))
    idx = np.repeat(np.arange(len(f)), n)
    r1 = np.sqrt(np.random.default_rng(0).random(len(idx)))
    r2 = np.random.default_rng(1).random(len(idx))
    pts = (1 - r1)[:, None] * a[idx] + (r1 * (1 - r2))[:, None] * b[idx] + (r1 * r2)[:, None] * c[idx]
    return np.concatenate([pts, v])
