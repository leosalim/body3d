"""Minimal binary glTF 2.0 (GLB) writer, with no dependency besides numpy.

Supports what the viewer uses: indexed meshes with POSITION/NORMAL, custom attributes
(underscore prefix, which three.js's GLTFLoader exposes in lower case), JOINTS_0/WEIGHTS_0 with a
skin, morph targets (dense or sparse), a node hierarchy and free-form `extras`.

Attributes may be quantized (KHR_mesh_quantization): positions as normalized int16 with the
scale on the node (or in the inverse bind matrices of a skin), normals as normalized int8.
three.js reads that with no decoder — no WebAssembly, which strict Content-Security-Policies
forbid, unlike Draco or meshopt.
"""
from __future__ import annotations

import json
import struct

import numpy as np

FLOAT, UBYTE, USHORT, UINT, BYTE, SHORT = 5126, 5121, 5123, 5125, 5120, 5122
ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER = 34962, 34963
_TYPES = {1: "SCALAR", 2: "VEC2", 3: "VEC3", 4: "VEC4", 16: "MAT4"}
_CT = {np.float32: FLOAT, np.uint8: UBYTE, np.uint16: USHORT, np.uint32: UINT, np.int8: BYTE, np.int16: SHORT}


class GLB:
    def __init__(self) -> None:
        self.doc: dict = {
            "asset": {"version": "2.0", "generator": "body3d pipeline"},
            "scene": 0,
            "scenes": [{"nodes": []}],
            "nodes": [],
            "meshes": [],
            "accessors": [],
            "bufferViews": [],
            "buffers": [],
            "materials": [],
        }
        self.bin = bytearray()
        self.extensions: set[str] = set()

    # ---------------------------------------------------------------- buffers
    def accessor(self, data: np.ndarray, target: int | None = None, normalized: bool = False,
                 minmax: bool = False) -> int:
        data = np.ascontiguousarray(data)
        ncomp = 1 if data.ndim == 1 else data.shape[1]
        ctype = _CT[data.dtype.type]
        # alignment: every vertex element must take a multiple of 4 bytes
        if target == ARRAY_BUFFER and (data.itemsize * ncomp) % 4:
            pad = 4 // data.itemsize - ncomp % (4 // data.itemsize)
            padded = np.zeros((data.shape[0], ncomp + pad), dtype=data.dtype)
            padded[:, :ncomp] = data.reshape(-1, ncomp)
            raw, stride = padded.tobytes(), padded.itemsize * padded.shape[1]
        else:
            raw, stride = data.tobytes(), None
        while len(self.bin) % 4:
            self.bin.append(0)
        view = {"buffer": 0, "byteOffset": len(self.bin), "byteLength": len(raw)}
        if stride:
            view["byteStride"] = stride
        if target:
            view["target"] = target
        self.bin.extend(raw)
        self.doc["bufferViews"].append(view)
        acc = {
            "bufferView": len(self.doc["bufferViews"]) - 1,
            "componentType": ctype,
            "count": int(data.shape[0]),
            "type": _TYPES[ncomp],
        }
        if normalized:
            acc["normalized"] = True
        if minmax:
            flat = data.reshape(data.shape[0], -1)
            acc["min"] = [x.item() for x in flat.min(axis=0)]
            acc["max"] = [x.item() for x in flat.max(axis=0)]
        self.doc["accessors"].append(acc)
        return len(self.doc["accessors"]) - 1

    def sparse_accessor(self, count: int, indices: np.ndarray, values: np.ndarray, normalized: bool = False,
                        minmax: bool = False) -> int:
        """Sparse accessor without a bufferView: zeros except `values` (n, k) at `indices`.
        Sparse blocks may not have a byteStride (glTF 2.0, 3.6.2.3): they are tightly packed."""
        values = np.ascontiguousarray(values)
        ncomp = 1 if values.ndim == 1 else values.shape[1]
        itype = np.uint8 if count <= 256 else np.uint16 if count <= 65536 else np.uint32
        views = []
        for data in (np.ascontiguousarray(indices.astype(itype)), values):
            while len(self.bin) % 4:
                self.bin.append(0)
            raw = data.tobytes()
            self.doc["bufferViews"].append({"buffer": 0, "byteOffset": len(self.bin), "byteLength": len(raw)})
            self.bin.extend(raw)
            views.append(len(self.doc["bufferViews"]) - 1)
        acc = {
            "componentType": _CT[values.dtype.type],
            "count": int(count),
            "type": _TYPES[ncomp],
            "sparse": {
                "count": len(indices),
                "indices": {"bufferView": views[0], "componentType": _CT[itype]},
                "values": {"bufferView": views[1]},
            },
        }
        if normalized:
            acc["normalized"] = True
        if minmax:
            flat = values.reshape(len(values), -1)
            acc["min"] = [min(0, x.item()) for x in flat.min(axis=0)]
            acc["max"] = [max(0, x.item()) for x in flat.max(axis=0)]
        self.doc["accessors"].append(acc)
        return len(self.doc["accessors"]) - 1

    # ---------------------------------------------------------------- scene
    def material(self, name: str, color, roughness=0.6, metallic=0.0, extras=None) -> int:
        m = {"name": name, "pbrMetallicRoughness": {
            "baseColorFactor": list(color) + ([1.0] if len(color) == 3 else []),
            "roughnessFactor": roughness, "metallicFactor": metallic}}
        if extras:
            m["extras"] = extras
        self.doc["materials"].append(m)
        return len(self.doc["materials"]) - 1

    def mesh(self, name: str, positions: np.ndarray, faces: np.ndarray, normals: np.ndarray | None = None,
             material: int | None = None, attributes: dict | None = None, quantize: bool = True,
             extras: dict | None = None) -> tuple[int, dict]:
        """Returns (mesh index, node transform) — when quantized, the node carries the scale."""
        attrs = {}
        node_tf: dict = {}
        if quantize:
            lo, hi = positions.min(axis=0), positions.max(axis=0)
            center = (lo + hi) / 2
            half = float(np.max(hi - lo) / 2) or 1.0
            q = np.round((positions - center) / half * 32767).clip(-32767, 32767).astype(np.int16)
            attrs["POSITION"] = self.accessor(q, ARRAY_BUFFER, normalized=True, minmax=True)
            node_tf = {"translation": [float(c) for c in center], "scale": [half] * 3}
            self.extensions.add("KHR_mesh_quantization")
        else:
            attrs["POSITION"] = self.accessor(positions.astype(np.float32), ARRAY_BUFFER, minmax=True)
        if normals is not None:
            if quantize:
                qn = np.round(normals * 127).clip(-127, 127).astype(np.int8)
                attrs["NORMAL"] = self.accessor(qn, ARRAY_BUFFER, normalized=True)
            else:
                attrs["NORMAL"] = self.accessor(normals.astype(np.float32), ARRAY_BUFFER)
        for key, (arr, norm) in (attributes or {}).items():
            attrs[key] = self.accessor(arr, ARRAY_BUFFER, normalized=norm)
        idx_type = np.uint16 if positions.shape[0] < 65536 else np.uint32
        prim = {"attributes": attrs, "indices": self.accessor(faces.reshape(-1).astype(idx_type), ELEMENT_ARRAY_BUFFER)}
        if material is not None:
            prim["material"] = material
        m = {"name": name, "primitives": [prim]}
        if extras:
            m["extras"] = extras
        self.doc["meshes"].append(m)
        return len(self.doc["meshes"]) - 1, node_tf

    def node(self, name: str, parent: int | None = None, **kw) -> int:
        n = {"name": name}
        n.update({k: v for k, v in kw.items() if v is not None})
        self.doc["nodes"].append(n)
        i = len(self.doc["nodes"]) - 1
        if parent is None:
            self.doc["scenes"][0]["nodes"].append(i)
        else:
            self.doc["nodes"][parent].setdefault("children", []).append(i)
        return i

    def skin(self, joints: list[int], inverse_binds: np.ndarray, skeleton: int | None = None) -> int:
        s = {"joints": joints, "inverseBindMatrices": self.accessor(inverse_binds.astype(np.float32).reshape(-1, 16))}
        if skeleton is not None:
            s["skeleton"] = skeleton
        self.doc.setdefault("skins", []).append(s)
        return len(self.doc["skins"]) - 1

    # ---------------------------------------------------------------- out
    def save(self, path, extras: dict | None = None) -> int:
        if extras:
            self.doc["extras"] = extras
        if self.extensions:
            self.doc["extensionsUsed"] = sorted(self.extensions)
            self.doc["extensionsRequired"] = sorted(self.extensions)
        for k in ("materials", "accessors", "bufferViews"):
            if not self.doc[k]:
                del self.doc[k]
        while len(self.bin) % 4:
            self.bin.append(0)
        self.doc["buffers"] = [{"byteLength": len(self.bin)}]
        js = json.dumps(self.doc, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        js += b" " * ((4 - len(js) % 4) % 4)
        total = 12 + 8 + len(js) + 8 + len(self.bin)
        with open(path, "wb") as fh:
            fh.write(struct.pack("<III", 0x46546C67, 2, total))
            fh.write(struct.pack("<II", len(js), 0x4E4F534A))
            fh.write(js)
            fh.write(struct.pack("<II", len(self.bin), 0x004E4942))
            fh.write(self.bin)
        return total


def vertex_normals(v: np.ndarray, f: np.ndarray) -> np.ndarray:
    fn = np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]])  # area-weighted
    n = np.zeros_like(v)
    for k in range(3):
        np.add.at(n, f[:, k], fn)
    ln = np.linalg.norm(n, axis=1, keepdims=True)
    ln[ln == 0] = 1
    return n / ln
