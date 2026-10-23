"""Catalog of the BodyParts3D meshes: system, side, size and polygon count.

Writes `catalog/bp3d-elements.json` (all 2 234 meshes) and prints a summary. The system of each
mesh comes from the ancestors of its concept in the FMA IS-A tree.
"""
from __future__ import annotations

import collections
import json
import pathlib
import re

import bp3d

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE.parent / "catalog"

# IS-A ancestor → system; the first matching rule wins
SYSTEMS = [
    ("muscle", ["muscle organ", "skeletal muscle", "head of muscle organ", "zone of muscle organ", "muscle of",
                "trapezius", "interossei", "lumbricals", "levatores costarum", "intertransversarii"]),
    ("bone", ["bone organ", "long bone", "irregular bone", "flat bone", "short bone", "sesamoid bone", "vertebra", "rib"]),
    ("cartilage", ["cartilage", "intervertebral disk", "meniscus"]),
    ("tendon", ["tendon"]),
    ("ligament", ["ligament", "fascia", "tract", "retinaculum", "membrane", "raphe"]),
    ("artery", ["artery", "arterial"]),
    ("vein", ["vein", "venous"]),
    ("nerve", ["nerve", "neuraxis", "brain", "gyrus", "nucleus", "lobe"]),
    ("skin", ["skin"]),
]


def isa_parents() -> dict[str, set[str]]:
    parents: dict[str, set[str]] = collections.defaultdict(set)
    path = bp3d.cache_dir() / "isa_inclusion_relation_list.txt"
    with open(path, encoding="utf-8") as fh:
        lines = fh.readlines()[1:]
    for p, _pn, c, _cn in (line.rstrip("\n").split("\t") for line in lines):
        parents[c].add(p)
    return parents


def ancestors(cid: str, parents: dict[str, set[str]]) -> list[str]:
    seen, stack = [], [cid]
    while stack:
        c = stack.pop()
        for p in parents.get(c, ()):
            if p not in seen:
                seen.append(p)
                stack.append(p)
    return seen


def _has(text: str, keys: list[str]) -> bool:
    return any(re.search(rf"\b{re.escape(k)}s?\b", text) for k in keys)


def classify(name: str, anc_names: list[str]) -> str:
    # the name itself rules ("right thoracodorsal vein" is no bone because an ancestor says
    # "vertebra"); vessels and nerves first, because they inherit the names of bones
    for system in ("artery", "vein", "nerve"):
        if _has(name, dict(SYSTEMS)[system]):
            return system
    for a in [name, *anc_names]:
        for system, keys in SYSTEMS:
            if _has(a, keys):
                return system
    return "other"


def header(text: str) -> dict:
    out = {}
    for line in text.splitlines()[:20]:
        m = re.match(r"# (Concept ID|English name|Volume\(cm3\)|Bounds\(mm\))\s*:\s*(.*)", line)
        if m:
            out[m.group(1)] = m.group(2).strip()
    return out


def build() -> list[dict]:
    cat = bp3d.Catalog()
    meshes = bp3d.Meshes()
    parents = isa_parents()
    rows = []
    for fid in sorted(meshes.index):
        text = meshes.raw(fid)
        h = header(text)
        cid = h.get("Concept ID") or cat.file_concepts[fid][0]
        name = (h.get("English name") or cat.label(fid)).lower()
        anc = [cat.names.get(a, a) for a in ancestors(cid, parents)]
        nv = text.count("\nv ")
        nf = text.count("\nf ")
        side = "left" if re.search(r"\bleft\b", name) else "right" if re.search(r"\bright\b", name) else "center"
        rows.append({
            "file": fid,
            "concept": cid,
            "name": name,
            "system": classify(name, anc),
            "side": side,
            "mirrorOf": fid[:-1] if fid.endswith("M") else None,
            "vertices": nv,
            "faces": nf,
            "volumeCm3": float(h["Volume(cm3)"]) if "Volume(cm3)" in h else None,
            "boundsMm": h.get("Bounds(mm)"),
            "ancestors": anc[:3],
        })
    return rows


if __name__ == "__main__":
    rows = build()
    OUT.mkdir(exist_ok=True)
    with open(OUT / "bp3d-elements.json", "w", encoding="utf-8", newline="\n") as fh:
        # one element per line: readable diffs and a small file
        lines = (json.dumps(r, ensure_ascii=False, separators=(",", ":")) for r in rows)
        fh.write("[\n" + ",\n".join(lines) + "\n]\n")
    by = collections.Counter(r["system"] for r in rows)
    faces = collections.Counter()
    for r in rows:
        faces[r["system"]] += r["faces"]
    for s, n in by.most_common():
        print(f"{s:10s} {n:5d} meshes  {faces[s]:9d} triangles")
    print("total", len(rows))
