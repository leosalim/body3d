"""Voxel grid: voxelization of closed meshes, distance fields and sampling.

Used whenever an operation needs volume rather than surface: draping the synthesized
latissimus over the trunk (synth.py), stacking the hypertrophy layer over layer (morph.py) and
baking ambient occlusion.
"""
from __future__ import annotations

import numpy as np
from scipy import ndimage

import meshops


class Grid:
    def __init__(self, lo, hi, pitch: float):
        self.pitch = float(pitch)
        self.lo = np.asarray(lo, dtype=np.float64)
        self.shape = tuple(np.ceil((np.asarray(hi) - self.lo) / pitch).astype(int) + 1)

    def index(self, p: np.ndarray) -> np.ndarray:
        """Continuous grid coordinates (for map_coordinates)."""
        return ((p - self.lo) / self.pitch).T

    def cell(self, p: np.ndarray) -> np.ndarray:
        return np.round((p - self.lo) / self.pitch).astype(np.int64)

    def centers(self) -> np.ndarray:
        axes = [self.lo[i] + np.arange(self.shape[i]) * self.pitch for i in range(3)]
        return np.stack(np.meshgrid(*axes, indexing="ij"), axis=-1)

    def empty(self, dtype=bool) -> np.ndarray:
        return np.zeros(self.shape, dtype=dtype)

    # ------------------------------------------------------------------ voxelization
    def surface(self, v: np.ndarray, f: np.ndarray) -> np.ndarray:
        """Voxels crossed by the surface (dense sampling of the triangles)."""
        pts = meshops.sample_surface(v, f, self.pitch * 0.5)
        c = self.cell(pts)
        ok = np.all((c >= 0) & (c < np.array(self.shape)), axis=1)
        m = self.empty()
        m[tuple(c[ok].T)] = True
        return m

    def solid(self, v: np.ndarray, f: np.ndarray) -> np.ndarray:
        """Volume of a mesh: ray parity along the three axes, majority vote, plus the shell.

        Robust to small holes: a column with an odd number of crossings is dropped on that
        axis and the other two axes decide. BodyParts3D's left femur is not watertight on
        this grid; a plain flood fill made the whole left thigh "inflate"."""
        lo = np.maximum(self.cell(v.min(axis=0)) - 1, 0)
        hi = np.minimum(self.cell(v.max(axis=0)) + 2, np.array(self.shape))
        out = self.empty()
        if np.any(hi <= lo):
            return out
        sub = Grid(self.lo + lo * self.pitch, self.lo + (hi - 1) * self.pitch, self.pitch)
        votes = np.zeros(sub.shape, dtype=np.uint8)
        for axis in range(3):
            votes += sub._parity(v, f, axis)
        s = tuple(slice(lo[i], lo[i] + sub.shape[i]) for i in range(3))
        out[s] = (votes >= 2)[: out[s].shape[0], : out[s].shape[1], : out[s].shape[2]]
        return out | self.surface(v, f)

    def _parity(self, v: np.ndarray, f: np.ndarray, a: int) -> np.ndarray:
        b, c = [k for k in range(3) if k != a]
        P = (v - self.lo) / self.pitch + 1e-4 * np.array([1.0, 1.7, 2.3])  # no ray exactly on an edge
        tri = P[f]                                   # T×3×3 (grid coordinates)
        tb, tc, ta = tri[:, :, b], tri[:, :, c], tri[:, :, a]
        b0 = np.ceil(tb.min(axis=1)).astype(np.int64)
        b1 = np.floor(tb.max(axis=1)).astype(np.int64)
        c0 = np.ceil(tc.min(axis=1)).astype(np.int64)
        c1 = np.floor(tc.max(axis=1)).astype(np.int64)
        nb = np.maximum(b1 - b0 + 1, 0)
        nc = np.maximum(c1 - c0 + 1, 0)
        n = nb * nc
        out = np.zeros(self.shape, dtype=np.uint8)
        if n.sum() == 0:
            return out
        t = np.repeat(np.arange(len(f)), n)
        k = np.arange(n.sum()) - np.repeat(np.cumsum(n) - n, n)
        ib = b0[t] + k // np.maximum(nc[t], 1)
        ic = c0[t] + k % np.maximum(nc[t], 1)
        # barycentric coordinates in the (b, c) plane
        x0, y0 = tb[t, 0], tc[t, 0]
        x1, y1 = tb[t, 1], tc[t, 1]
        x2, y2 = tb[t, 2], tc[t, 2]
        det = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
        ok = np.abs(det) > 1e-12
        det = np.where(ok, det, 1)
        l0 = ((y1 - y2) * (ib - x2) + (x2 - x1) * (ic - y2)) / det
        l1 = ((y2 - y0) * (ib - x2) + (x0 - x2) * (ic - y2)) / det
        l2 = 1 - l0 - l1
        inside = ok & (l0 >= 0) & (l1 >= 0) & (l2 >= 0)
        inside &= (ib >= 0) & (ib < self.shape[b]) & (ic >= 0) & (ic < self.shape[c])
        if not inside.any():
            return out
        hit = (l0 * ta[t, 0] + l1 * ta[t, 1] + l2 * ta[t, 2])[inside]
        col = ib[inside] * self.shape[c] + ic[inside]
        order = np.lexsort((hit, col))
        col, hit = col[order], hit[order]
        # rank of each crossing within its column; columns with an odd count are dropped
        start = np.r_[0, np.flatnonzero(np.diff(col)) + 1]
        counts = np.diff(np.r_[start, len(col)])
        rank = np.arange(len(col)) - np.repeat(start, counts)
        even_col = np.repeat(counts % 2 == 0, counts)
        enter = (rank % 2 == 0) & even_col
        leave = (rank % 2 == 1) & even_col
        na = self.shape[a]
        diff = np.zeros((self.shape[b] * self.shape[c], na + 1), dtype=np.int32)
        ia = np.clip(np.ceil(hit[enter]).astype(np.int64), 0, na)
        ja = np.clip(np.floor(hit[leave]).astype(np.int64) + 1, 0, na)
        np.add.at(diff, (col[enter], ia), 1)
        np.add.at(diff, (col[leave], ja), -1)
        inside_cols = np.cumsum(diff[:, :na], axis=1) > 0
        vol = inside_cols.reshape(self.shape[b], self.shape[c], na)
        # back to axis order (0, 1, 2)
        perm = np.argsort([b, c, a])
        return np.transpose(vol, perm).astype(np.uint8)

    # ------------------------------------------------------------------ fields
    def sdf(self, solid: np.ndarray) -> np.ndarray:
        """Signed distance (m): positive outside, negative inside."""
        out = ndimage.distance_transform_edt(~solid) * self.pitch
        inn = ndimage.distance_transform_edt(solid) * self.pitch
        return (out - inn).astype(np.float32)

    def sample(self, field: np.ndarray, p: np.ndarray, order: int = 1, cval: float = 0.0) -> np.ndarray:
        return ndimage.map_coordinates(field, self.index(p), order=order, mode="nearest" if cval is None else "constant",
                                       cval=cval if cval is not None else 0.0)

    def gradient(self, field: np.ndarray) -> list[np.ndarray]:
        return [g.astype(np.float32) / self.pitch for g in np.gradient(field)]


def ball(radius_vox: int) -> np.ndarray:
    r = radius_vox
    z, y, x = np.ogrid[-r:r + 1, -r:r + 1, -r:r + 1]
    return (x * x + y * y + z * z) <= r * r


def close(mask: np.ndarray, radius_vox: int) -> np.ndarray:
    """Morphological closing with a ball (fills gaps between ribs and the like)."""
    b = ball(radius_vox)
    pad = radius_vox + 1
    m = np.pad(mask, pad)
    m = ndimage.binary_erosion(ndimage.binary_dilation(m, structure=b), structure=b)
    return m[pad:-pad, pad:-pad, pad:-pad]
