# Model format

The contract between the pipeline (`pipeline/export.py`, `pipeline/fitdata.py`) and the viewer:
what a body3d GLB contains. `test/model.test.mjs` checks it on the published models. The current
version is **2** (`extras.version`); version 1 (before 0.2) had Portuguese labels and
`group.region` instead of `group.area`, and still loads.

## Scene

| | |
|---|---|
| asset | glTF 2.0, `generator: "body3d pipeline"` |
| extensions | `KHR_mesh_quantization` (required) |
| nodes | `body3d` root → the 52 joint nodes (translation relative to the parent, identity rotation in the rest pose) and the mesh nodes |
| skins | one, over the 52 joints; `skeleton` = `pelvis` |
| meshes | `soft-0` … `soft-13` (muscles and tissues, one per dominant fit region, split further past 65 535 vertices) and `skeleton-0` (bones and cartilage) |
| materials | none — the viewer brings its own shader |

### Vertex attributes

| Attribute | Type | |
|---|---|---|
| `POSITION` | int16 ×3, normalized | quantized over the whole body's bounding box (≈ 0.03 mm steps) |
| `NORMAL` | int8 ×3, normalized | area-weighted vertex normals |
| `_PART` | uint16 | index into `extras.parts` — the shader's key into the part texture, and what picking returns |
| `JOINTS_0` | uint8 ×4 | joint indices (4 influences) |
| `WEIGHTS_0` | uint8 ×4, normalized | weights summing exactly to 255 |
| `_AO` | uint8, normalized | baked ambient occlusion (1 = open, ~0.25 = deep groove) |

Indices are uint16 (meshes are chunked below 65 536 vertices).

Because glTF ignores the transform of a skinned mesh node, the dequantization (scale = half the
largest side of the body box, offset = its centre) is folded into every **inverse bind matrix**:
`IBM_j = T(−joint_j) · D`. The bone matrices therefore carry a uniform scale, which the viewer's
dual-quaternion skinning separates before blending (see [architecture.md](architecture.md)).

### Morph targets

Soft meshes carry one morph target per **fit region** that moves them (`extras.targetNames` on the
mesh gives their region ids; at most 10 per mesh, 56–60 in a model). A target holds the
displacement from the shape at the model's minimum FFMI to the shape at its maximum, in the same
normalized units as the positions, plus the change of the normals. A target that moves fewer than
60 % of the mesh's vertices is **sparse** (an index list and the moved values; ~3/4 of them). The
mesh default `weights` are the default FFMI's.

The deformed position of a vertex with region weights `w` is exactly
`base + Σ_r w_r · morph_r` — the hypertrophy is linear in the gain and separable by region
([anatomy.md](anatomy.md#6-hypertrophy-in-layers)), so `w_r = t` for every region reproduces the
uniform body at the gain `t`.

## `extras`

```jsonc
{
  "format": "body3d",
  "version": 2,
  "attribution": "BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International",
  "sex": "male",                 // "male" | "female"
  "lod": "high",                 // "high" | "lite"
  "parts":  [ … ],               // 547 entries, indexed by _PART
  "groups": [ … ],               // 44 activatable groups
  "joints": [ … ],               // 52 joints, parents before children
  "body":   { … },               // shape metadata and fit data
  "stats":  { … }                // vertex, triangle and morph-target counts
}
```

### `parts[i]`

```jsonc
{ "id": "biceps-long-head_l", "base": "biceps-long-head", "side": "l", "kind": "muscle",
  "label": "Biceps brachii (long head)", "group": "biceps" }
{ "id": "humerus_l", "base": "humerus", "side": "l", "kind": "bone",
  "label": "left humerus", "segment": "upperarm_l" }
```

`kind` is `muscle` (270), `tissue` (7: linea alba, iliotibial tracts, calcaneal tendons, patellar
ligaments), `bone` (255) or `cartilage` (15). `side` is `l`, `r` or `null` (midline). Muscles and
tissues have English labels (translations are in the JS catalog, keyed by `base`); bones and
cartilage keep their FMA name. Order: muscles, tissues, bones, cartilage, each by `base` then side
— stable across builds.

### `groups[i]`

`{ "id": "chest-upper", "label": "Upper chest", "area": "trunk" }` — the 44 groups of
`pipeline/anatomy.py`, in the same order as `GROUPS` in the catalog.

### `joints[i]`

`{ "name": "forearm_l", "parent": "upperarm_l", "position": [x, y, z], "axis": [x, y, z] }` —
rest positions in metres (y up, z forward, x towards the body's left); `axis` is the flexion
axis of the hinges (elbows, knees, ankles).

### `body`

| Field | |
|---|---|
| `sex`, `heightM` | 1.78 m male, 1.65 m female |
| `baseFfmi` | FFMI of the BodyParts3D body before any change (≈ 15.1) |
| `scale` | uniform scale from BodyParts3D to the model height |
| `ffmi` | `{ min, max, default, normalized: true, table, smm }`: drawable range, default (26 / 22), and `table` = rows `[normalized FFMI, uniform weight]`; `smm` = `{ density, coverage, smmFfm }` to convert a muscle volume to skeletal muscle mass |
| `defaultWeight` | uniform weight of the default FFMI |
| `gainRange` | hypertrophy gains of the range ends (pipeline internals) |
| `regions` | the 14 region ids in morph order: `upperarm_l`, `upperarm_r`, `forearm_l`, `forearm_r`, `thigh_l`, `thigh_r`, `calf_l`, `calf_r`, `shoulders`, `chest`, `back`, `neck`, `core`, `hips` |
| `fit` | the tape-measure fit data (below) |

### `body.fit`

```jsonc
{
  "version": 1,
  "unit": 0.0001,              // metres per integer of the probes
  "sites": [ {
    "id": "arm_l", "codes": ["LEFT_BICEP"], "mode": "max", "side": "l",
    "regions": [0, 2, 8, 9, 10],          // regions that move some point of this site
    "levels": [ {
      "f": 0.45,                          // fraction along the limb axis (or of the height, trunk)
      "origin": [x, y, z], "normal": [x, y, z], "axes": [[e1], [e2]],   // the section plane
      "base": [x0, y0, x1, y1, …],         // material points in the plane (integers × unit)
      "disp": [[…], …]                     // per region in `regions`: their 2-D displacement
    }, … ]
  }, … ],                                  // 12 sites
  "volume": {                              // per owning region: monomials of the cubic polynomial
    "upperarm_l": [[0.6194007, []], [1.2069415, [0]], [0.0074899, [2]], …]   // [coefficient L, region indices]
  }
}
```

A probe point at weights `w` is `base + Σ_k w[regions[k]] · disp[k]`; the site girth is the
perimeter of the convex hull of its points at the thickest level (`mode: "max"`) or the thinnest
(`"min"`, the neck). The muscle volume is `Σ_regions Σ_monomials c · Π w[i]` (litres, model
space). Both are exact on the exported geometry; [body-fit.md](body-fit.md) explains them and
`pipeline/check_fit.py` verifies them against the deformed meshes.

`fingerprint(prepareFitModel(body))` hashes these data: a calibration in
`src/calibration.generated.js` only applies to the model whose fingerprint it carries.

## Coordinates and units

Metres; y up, z towards the front of the body, x towards the body's **left** (the viewer's right
when facing the body) — BodyParts3D's millimetres converted (`X = x`, `Y = z`, `Z = −y`). The
feet stand on y = 0 and the pelvis is centred on x = z = 0.
