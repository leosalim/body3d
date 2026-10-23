"""Writes the final GLB the viewer loads.

Layout:
- rig nodes (joint hierarchy, translation relative to the parent, identity rotation in the rest
  pose);
- "soft" meshes (muscles + tissues, one per dominant fit region, each carrying only the morph
  targets that move it) and "skeleton" meshes (bones + cartilage), all skinned to the same
  joints;
- a _PART attribute (uint16) = index of the part in extras.parts: the shader looks the
  activation of that part up in a texture, and GPU picking returns the part under the pointer;
- a _AO attribute (uint8): baked ambient occlusion;
- scene extras: parts, groups, joints, the body metadata (FFMI range, regions, fit data).

Positions are int16 (KHR_mesh_quantization). Because glTF ignores the transform of a skinned
mesh node, the dequantization (scale + centre) goes into the inverseBindMatrices.

See docs/model-format.md for the full contract.
"""
from __future__ import annotations

import numpy as np

import anatomy
import bp3d
from gltf import ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER, GLB, vertex_normals

KIND_ORDER = {"muscle": 0, "tissue": 1, "bone": 2, "cartilage": 3}


def _quant_weights(w: np.ndarray) -> np.ndarray:
    q = np.floor(w * 255 + 0.5).astype(np.int32)
    q[:, 0] += 255 - q.sum(axis=1)  # exact sum of 255
    return np.clip(q, 0, 255).astype(np.uint8)


def _main_region(p, n_regions: int) -> int:
    """Region that moves the part the most (n_regions for parts without a morph)."""
    rm = getattr(p, "region_morph", None) or {}
    if not rm:
        return n_regions
    return max(rm, key=lambda r: float(np.abs(rm[r]).max()))


def _chunks(sel) -> list[list]:
    """Chunks of < 65 536 vertices (16-bit indices, half the size)."""
    chunks, cur, count = [], [], 0
    for p in sel:
        if cur and count + len(p.v) > 65535:
            chunks.append(cur)
            cur, count = [], 0
        cur.append(p)
        count += len(p.v)
    chunks.append(cur)
    return chunks


def export(path, parts, joints, meta: dict) -> dict:
    glb = GLB()
    names = [j.name for j in joints]
    idx = {n: i for i, n in enumerate(names)}

    # --- rig
    root = glb.node("body3d")
    jnode = {}
    for j in joints:
        parent_pos = joints[idx[j.parent]].pos if j.parent else np.zeros(3)
        jnode[j.name] = glb.node(j.name, parent=jnode[j.parent] if j.parent else root,
                                 translation=[float(x) for x in (j.pos - parent_pos)])
    joint_nodes = [jnode[n] for n in names]

    # --- part table (stable order: muscles, tissues, bones, cartilage)
    shown = [p for p in parts if p.kind in KIND_ORDER]
    shown.sort(key=lambda p: (KIND_ORDER[p.kind], p.base, p.side or ""))
    for i, p in enumerate(shown):
        p.index = i

    # one quantization for the whole body (≈ 0.03 mm): a single skin serves every mesh
    allv = np.concatenate([p.v for p in shown])
    lo, hi = allv.min(axis=0), allv.max(axis=0)
    center = (lo + hi) / 2
    half = float(np.max(hi - lo) / 2)
    dq = np.eye(4)
    dq[:3, :3] *= half
    dq[:3, 3] = center
    ibm = []
    for j in joints:
        inv = np.eye(4)
        inv[:3, 3] = -j.pos  # rest pose: translation only
        ibm.append((inv @ dq).T.reshape(-1))  # glTF is column-major
    skin = glb.skin(joint_nodes, np.array(ibm), skeleton=jnode["pelvis"])
    glb.extensions.add("KHR_mesh_quantization")

    regions = meta.get("body", {}).get("regions") or []
    default_w = float(meta.get("body", {}).get("defaultWeight", 0.0))
    stats = {"targets": 0, "sparse": 0}
    for group_name, kinds in (("soft", ("muscle", "tissue")), ("skeleton", ("bone", "cartilage"))):
        sel = [p for p in shown if p.kind in kinds]
        if group_name == "soft" and regions:
            # one mesh (or more, past 65 535 vertices) per region that moves each part the most:
            # every mesh carries only the morph targets of the regions that move it — the shader
            # walks all the targets of a mesh on every vertex
            groups: dict[int, list] = {}
            for p in sel:
                groups.setdefault(_main_region(p, len(regions)), []).append(p)
            chunks = [c for k in sorted(groups) for c in _chunks(groups[k])]
        else:
            chunks = _chunks(sel)
        tv = tf = 0
        for ci, chunk in enumerate(chunks):
            vs, fs, parts_attr, js, ws, aos, off = [], [], [], [], [], [], 0
            for p in chunk:
                aos.append(getattr(p, "ao", None) if getattr(p, "ao", None) is not None else np.ones(len(p.v)))
                vs.append(p.v)
                fs.append(p.f + off)
                parts_attr.append(np.full(len(p.v), p.index, dtype=np.uint16))
                js.append(p.joints)
                ws.append(p.weights)
                off += len(p.v)
            v = np.concatenate(vs)
            f = np.concatenate(fs)
            n = np.concatenate([vertex_normals(p.v, p.f) for p in chunk])
            q = np.round((v - center) / half * 32767).clip(-32767, 32767).astype(np.int16)
            prim_attrs = {
                "POSITION": glb.accessor(q, ARRAY_BUFFER, normalized=True, minmax=True),
                "NORMAL": glb.accessor(np.round(n * 127).clip(-127, 127).astype(np.int8), ARRAY_BUFFER, normalized=True),
                "_PART": glb.accessor(np.concatenate(parts_attr), ARRAY_BUFFER),
                "JOINTS_0": glb.accessor(np.concatenate(js).astype(np.uint8), ARRAY_BUFFER),
                "WEIGHTS_0": glb.accessor(_quant_weights(np.concatenate(ws)), ARRAY_BUFFER, normalized=True),
                "_AO": glb.accessor(np.round(np.concatenate(aos) * 255).clip(0, 255).astype(np.uint8), ARRAY_BUFFER,
                                    normalized=True),
            }
            prim = {"attributes": prim_attrs,
                    "indices": glb.accessor(f.reshape(-1).astype(np.uint16), ELEMENT_ARRAY_BUFFER)}
            mesh_doc = {"name": f"{group_name}-{ci}", "primitives": [prim]}
            if group_name == "soft" and regions:
                # one morph target per region that moves this mesh (anatomy.REGIONS), in the same
                # normalized units as the positions; sparse when few vertices move
                targets, names = [], []
                for r in sorted({r for p in chunk for r in getattr(p, "region_morph", {})}):
                    d = np.concatenate([p.region_morph.get(r, np.zeros_like(p.v)) for p in chunk])
                    qd = np.round(d / half * 32767).clip(-32767, 32767).astype(np.int16)
                    n_r = np.concatenate([vertex_normals(p.v + p.region_morph[r], p.f) if r in p.region_morph
                                          else vertex_normals(p.v, p.f) for p in chunk])
                    dn = np.round((n_r - n).clip(-1, 1) * 127).astype(np.int8)
                    moved = np.flatnonzero(np.any(qd != 0, axis=1) | np.any(dn != 0, axis=1))
                    if not len(moved):
                        continue
                    if len(moved) < 0.6 * len(v):
                        targets.append({
                            "POSITION": glb.sparse_accessor(len(v), moved, qd[moved], normalized=True, minmax=True),
                            "NORMAL": glb.sparse_accessor(len(v), moved, dn[moved], normalized=True),
                        })
                        stats["sparse"] += 1
                    else:
                        targets.append({
                            "POSITION": glb.accessor(qd, ARRAY_BUFFER, normalized=True, minmax=True),
                            "NORMAL": glb.accessor(dn, ARRAY_BUFFER, normalized=True),
                        })
                    names.append(regions[r])
                if targets:
                    prim["targets"] = targets
                    mesh_doc["weights"] = [default_w] * len(targets)
                    mesh_doc["extras"] = {"targetNames": names}
                    stats["targets"] += len(targets)
            name = mesh_doc["name"]
            glb.doc["meshes"].append(mesh_doc)
            glb.node(name, parent=root, mesh=len(glb.doc["meshes"]) - 1, skin=skin)
            tv += len(v)
            tf += len(f)
        stats[group_name] = {"vertices": int(tv), "triangles": int(tf), "meshes": len(chunks)}

    extras = {
        "format": "body3d",
        "version": 2,
        "attribution": bp3d.ATTRIBUTION,
        **meta,
        "parts": [{
            "id": p.id, "base": p.base, "side": p.side, "kind": p.kind, "label": p.label,
            **({"group": p.group} if p.group else {}), **({"segment": p.segment} if p.segment else {}),
        } for p in shown],
        "groups": [{"id": g, "label": en, "area": area} for g, en, _pt, area in anatomy.GROUPS],
        "joints": [{"name": j.name, "parent": j.parent, "position": [round(float(x), 5) for x in j.pos],
                    **({"axis": [round(float(x), 4) for x in j.axis]} if j.axis is not None else {})} for j in joints],
        "stats": stats,
    }
    size = glb.save(path, extras=extras)
    return {"bytes": size, **stats}
