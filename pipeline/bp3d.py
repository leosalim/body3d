"""Access to BodyParts3D 4.0 (DBCLS): download, tables and meshes.

BodyParts3D publishes "ELEMENT" meshes only (FJxxxx.obj files); composite organs are lists of
elements (isa/partof_element_parts.txt). An element does not say which concept it belongs to:
the most specific concept is the one with the smallest element list that contains it. Files
with an M suffix (FJ1452M) mirror the right side — the model is symmetric in its pairs.

BodyParts3D coordinates: millimetres, x > 0 towards the body's left, y > 0 posterior, z up.
They are converted to the three.js convention in metres: X = x (the body's left, the viewer's
right when facing the body), Y = z (up), Z = -y (forward).

Data licence: CC BY 4.0 — "BodyParts3D, © The Database Center for Life Science licensed under
CC Attribution 4.0 International".
"""
from __future__ import annotations

import collections
import io
import os
import pathlib
import re
import urllib.request
import zipfile

import numpy as np

BASE_URL = "https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST"
TABLES = [
    "isa_parts_list_e.txt",
    "partof_parts_list_e.txt",
    "isa_element_parts.txt",
    "partof_element_parts.txt",
    "isa_inclusion_relation_list.txt",
    "partof_inclusion_relation_list.txt",
]
ZIPS = {"isa": "isa_BP3D_4.0_obj_99.zip", "partof": "partof_BP3D_4.0_obj_99.zip"}
ATTRIBUTION = (
    "BodyParts3D, © The Database Center for Life Science licensed under "
    "CC Attribution 4.0 International"
)


def cache_dir() -> pathlib.Path:
    """Raw data stays out of the repository (≈ 200 MB): $BODY3D_CACHE, else ~/.cache/body3d
    (or the older ~/.cache/trace-body3d when that one exists)."""
    if os.environ.get("BODY3D_CACHE"):
        d = pathlib.Path(os.environ["BODY3D_CACHE"])
    else:
        cache = pathlib.Path.home() / ".cache"
        legacy = cache / "trace-body3d"
        d = legacy if legacy.is_dir() and not (cache / "body3d").exists() else cache / "body3d"
    d.mkdir(parents=True, exist_ok=True)
    return d


def download(force: bool = False) -> None:
    d = cache_dir()
    for name in TABLES + list(ZIPS.values()):
        target = d / name
        if target.exists() and not force:
            continue
        print(f"downloading {name}…")
        tmp = target.with_suffix(target.suffix + ".part")
        urllib.request.urlretrieve(f"{BASE_URL}/{name}", tmp)
        tmp.replace(target)


class Catalog:
    """BodyParts3D tables, cross-referenced: concept ⇄ element files."""

    def __init__(self) -> None:
        d = cache_dir()
        self.names: dict[str, str] = {}
        self.elements: dict[str, set[str]] = collections.defaultdict(set)
        self.tree: dict[str, str] = {}
        for tree in ("isa", "partof"):
            for c, n, f in _rows(d / f"{tree}_element_parts.txt"):
                self.names[c] = n
                self.elements[c].add(f)
                self.tree.setdefault(c, tree)
            for c, _rep, n in _rows(d / f"{tree}_parts_list_e.txt"):
                self.names.setdefault(c, n)
        self.by_name = {n: c for c, n in self.names.items()}

        # most specific concept of each file = the one with the smallest list containing it
        best: dict[str, tuple[int, list[str]]] = {}
        for c, files in self.elements.items():
            for f in files:
                n = len(files)
                if f not in best or n < best[f][0]:
                    best[f] = (n, [c])
                elif n == best[f][0]:
                    best[f][1].append(c)
        self.file_concepts = {f: sorted(cs, key=lambda c: _specificity(self.names[c])) for f, (_n, cs) in best.items()}

    def concept(self, name: str) -> str:
        return self.by_name[name]

    def files_of(self, name: str) -> list[str]:
        return sorted(self.elements[self.concept(name)])

    def label(self, f: str) -> str:
        return self.names[self.file_concepts[f][0]]


def _specificity(name: str) -> tuple[int, int]:
    # between tied names, prefer the sided and the longer one ("right internal thoracic
    # vein" over "internal thoracic vein")
    lateral = 0 if re.search(r"\b(left|right)\b", name) else 1
    return (lateral, -len(name))


def _rows(path: pathlib.Path):
    with open(path, encoding="utf-8") as fh:
        next(fh)
        for line in fh:
            parts = line.rstrip("\n").split("\t")
            if len(parts) >= 3:
                yield parts[0], parts[1], parts[2]


class Meshes:
    """Reads FJxxxx.obj straight from the zip files, without extracting them."""

    def __init__(self) -> None:
        d = cache_dir()
        self.zips = [zipfile.ZipFile(d / z) for z in ZIPS.values() if (d / z).exists()]
        self.index: dict[str, tuple[zipfile.ZipFile, str]] = {}
        for z in self.zips:
            for info in z.infolist():
                m = re.search(r"(FJ\d+M?)\.obj$", info.filename)
                if m and m.group(1) not in self.index:
                    self.index[m.group(1)] = (z, info.filename)

    def raw(self, fid: str) -> str:
        z, name = self.index[fid]
        return z.read(name).decode("utf-8", errors="replace")

    def load(self, fid: str) -> tuple[np.ndarray, np.ndarray]:
        """Vertices (m, three.js axes) and triangular faces."""
        v, f = parse_obj(self.raw(fid))
        return to_three(v), f


def parse_obj(text: str) -> tuple[np.ndarray, np.ndarray]:
    verts: list[list[float]] = []
    faces: list[list[int]] = []
    for line in io.StringIO(text):
        if line.startswith("v "):
            verts.append([float(t) for t in line.split()[1:4]])
        elif line.startswith("f "):
            idx = [int(t.split("/")[0]) for t in line.split()[1:]]
            idx = [i - 1 if i > 0 else len(verts) + i for i in idx]
            for k in range(1, len(idx) - 1):  # fan for polygons with more than 3 sides
                faces.append([idx[0], idx[k], idx[k + 1]])
    return np.asarray(verts, dtype=np.float64), np.asarray(faces, dtype=np.int64).reshape(-1, 3)


def to_three(v: np.ndarray) -> np.ndarray:
    """BodyParts3D mm (x left, y posterior, z up) → three.js m (X body's left, Y up, Z forward)."""
    out = np.empty_like(v)
    out[:, 0] = v[:, 0] / 1000.0
    out[:, 1] = v[:, 2] / 1000.0
    out[:, 2] = -v[:, 1] / 1000.0
    return out


if __name__ == "__main__":
    download()
    cat = Catalog()
    print(len(cat.names), "concepts;", len(cat.file_concepts), "element files")
