"""Assembles the body from the selection in anatomy.py: a list of Parts, in metres."""
from __future__ import annotations

import dataclasses
import json
import pathlib
import re

import numpy as np

import anatomy
import bp3d
import meshops

HERE = pathlib.Path(__file__).resolve().parent


@dataclasses.dataclass
class Part:
    """One drawable (or core-only) piece of the body.

    Later stages attach more attributes: `joints`/`weights` (rig.skin_weights), `morph` and
    `region_morph` (morph.morph), `ao` (morph.bake_ao), `growth` (synthetic latissimus),
    `index` (export)."""
    id: str                 # unique: "biceps-long-head_l"
    base: str               # without side: "biceps-long-head"
    side: str | None        # "l", "r" or None (midline)
    kind: str               # muscle | tissue | bone | cartilage | viscera
    label: str              # English label (the FMA name for bones and viscera)
    group: str | None = None
    segment: str | None = None
    v: np.ndarray = dataclasses.field(default=None, repr=False)
    f: np.ndarray = dataclasses.field(default=None, repr=False)
    source: list = dataclasses.field(default_factory=list)


def _rows():
    with open(HERE.parent / "catalog" / "bp3d-elements.json", encoding="utf-8") as fh:
        return json.load(fh)


def _load_files(meshes: bp3d.Meshes, files: list[str]) -> tuple[np.ndarray, np.ndarray]:
    vs, fs, off = [], [], 0
    for fid in files:
        v, f = meshes.load(fid)
        v, f = meshops.weld(v, f)
        vs.append(v)
        fs.append(f + off)
        off += len(v)
    return np.concatenate(vs), np.concatenate(fs)


def load() -> list[Part]:
    rows = _rows()
    by_name: dict[str, list[str]] = {}
    for r in rows:
        by_name.setdefault(r["name"], []).append(r["file"])
    meshes = bp3d.Meshes()
    parts: list[Part] = []

    def files_for(src: str, side: str) -> list[str]:
        if src.startswith("="):
            fid = src[1:]
            return [fid if side == "r" else fid + "M"]
        name = src if side == "r" else anatomy.left_name(src)
        return by_name[name]

    for mid, srcs, label, _pt, group in anatomy.MUSCLES:
        for side in ("r", "l"):
            files = [x for s in srcs for x in files_for(s, side)]
            v, f = _load_files(meshes, files)
            parts.append(Part(f"{mid}_{side}", mid, side, "muscle", label, group=group, v=v, f=f, source=files))

    for tid, srcs, label, _pt, sided in anatomy.TISSUES:
        for side in (("r", "l") if sided else (None,)):
            files = [x for s in srcs for x in (files_for(s, side) if side else by_name[s])]
            v, f = _load_files(meshes, files)
            parts.append(Part(f"{tid}_{side}" if side else tid, tid, side, "tissue", label, v=v, f=f, source=files))

    for r in rows:
        if r["system"] not in ("bone", "cartilage") and not re.search(r"sternum|xiphoid|tooth", r["name"]):
            continue
        if re.search(anatomy.BONE_EXCLUDE, r["name"]):
            continue
        seg = _segment(r["name"])
        if seg is None:
            continue
        side = "l" if r["side"] == "left" else "r" if r["side"] == "right" else None
        if "{side}" in seg:
            if side is None:  # phalanges and the like carry the side in their name
                continue
            seg = seg.format(side=side)
        v, f = _load_files(meshes, [r["file"]])
        base = re.sub(r"\b(right|left)\b ?", "", r["name"]).strip().replace(" ", "-")
        parts.append(Part(f"{base}_{side}" if side else base, base, side,
                          "cartilage" if r["system"] == "cartilage" else "bone", r["name"], segment=seg,
                          v=v, f=f, source=[r["file"]]))

    pats = [re.compile(p) for p in anatomy.VISCERA]
    for r in rows:
        if any(p.search(r["name"]) for p in pats):
            v, f = _load_files(meshes, [r["file"]])
            parts.append(Part(f'viscera-{r["file"]}', r["name"], None, "viscera", r["name"], v=v, f=f, source=[r["file"]]))
    _dedupe_ids(parts)
    return parts


FINGERS = {"index": "index", "middle": "middle", "ring": "ring", "little": "pinky"}


def _segment(name: str) -> str | None:
    for pat, seg in anatomy.BONE_SEGMENTS:
        m = re.search(pat, name)
        if m:
            if "{finger}" in seg:
                seg = seg.replace("{finger}", FINGERS[m.group(2)])
            return seg
    return None


def check_sides(parts: list[Part], limit: float = 0.08) -> None:
    """A sided muscle or tissue has no piece on the other side of the body (x > 0 is the body's
    left). BodyParts3D swaps the side in the name of a few files; joining meshes by name once put
    one head of flexor pollicis brevis in each hand."""
    bad = [p.id for p in parts if p.kind in ("muscle", "tissue") and p.side in ("l", "r")
           and (p.v[:, 0] < -limit).any() and (p.v[:, 0] > limit).any()]
    if bad:
        raise SystemExit(f"parts with pieces on both sides of the body: {bad}")


def _dedupe_ids(parts: list[Part]) -> None:
    seen: dict[str, int] = {}
    for p in parts:
        if p.id in seen:
            seen[p.id] += 1
            p.id = f"{p.id}-{seen[p.id]}"
        else:
            seen[p.id] = 0


if __name__ == "__main__":
    import collections
    parts = load()
    c = collections.Counter(p.kind for p in parts)
    faces = collections.Counter()
    for p in parts:
        faces[p.kind] += len(p.f)
    for k in c:
        print(f"{k:10s} {c[k]:4d} parts {faces[k]:9d} triangles")
    segs = collections.Counter(p.segment for p in parts if p.kind in ("bone", "cartilage"))
    print(dict(segs))
    # open or inverted meshes
    bad = []
    for p in parts:
        if p.kind in ("muscle", "tissue"):
            vol = meshops.volume(p.v, p.f)
            if vol <= 0:
                bad.append((p.id, round(vol * 1e6, 1)))
    print("volume <= 0:", bad[:20])
