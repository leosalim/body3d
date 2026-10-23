# Architecture

How the runtime is put together: the modules, what happens when a model loads and when the
activations change, how a frame is drawn, how a tap finds a muscle, and why each piece is built the
way it is (the longer rationale, with alternatives, is in [decisions.md](decisions.md)).

## Two halves

```
BodyParts3D (OBJ, FMA tables) ──► pipeline/ (Python, offline) ──► public/models/*.glb ──► src/ (browser)
                                     │                                   ▲                   │
                                     └── src/catalog.generated.js ───────┘                   │
ANSUR II (CSV) ──► dev/calibrate.mjs ──► src/calibration.generated.js ──────────────────────┘
```

Everything expensive happens offline: selecting and cleaning meshes, synthesizing missing
muscles, placing joints, computing skinning weights, the hypertrophy morphs, baked occlusion and
the fit data. The browser receives a self-describing GLB ([model-format.md](model-format.md)) and
does only what must react to the person: colour, pose, shape, camera, picking and the tape fit
(a 15-unknown least-squares problem, about 10 ms).

## Modules

| Module | Responsibility | Depends on |
|---|---|---|
| `index.js` | public exports | — |
| `viewer.js` | `BodyViewer`: options, lifecycle, events, the render loop; composes everything below | all |
| `loader.js` | model URL, resolution choice, a page-wide GLB cache, per-viewer scene clones | three (GLTFLoader) |
| `stage.js` | renderer, lights, image-based lighting, ground shadow, camera lens | three |
| `material.js` | the body shader: part texture, activation ramp, rim, AO, dual-quaternion skinning; pick shader | three |
| `activation.js` | activation names → a value per part | catalog |
| `anatomy.js`, `catalog.generated.js` | labels, groups, training vocabulary, regions (generated from `pipeline/anatomy.py`) | i18n |
| `i18n.js` | interface strings, locale resolution, label lookup | — |
| `views.js` | view specs ⇄ camera poses (pure math) | three math |
| `best-view.js` | the automatic default view (pure, with a render callback) | views |
| `picking.js` | the id render pass | three |
| `split-view.js` | the second camera, panes and synchronised controls | dom, OrbitControls |
| `posing.js` | pose descriptions → bone rotations, ground contact, blending | three math |
| `poses.js` | the pose library | — |
| `shape.js` | morph weights from an FFMI or a fit; legacy single-morph models | fit |
| `fit.js`, `anthro.js`, `linalg.js` | the tape-measure fit and its anthropometry (pure, Node-friendly) | calibration |
| `rings.js` | tape rings drawn around the body | fit, three |
| `dom.js` | canvas, tooltip, credit, split button, fallback; CSS-variable theming | — |
| `tween.js` | easing | — |
| `element.js`, `embed.js`, `demo.js` | the custom element, the iframe page, the demo page | viewer |

Pure modules (`activation`, `views`, `best-view`, `posing`'s math, `fit`, `anthro`, `linalg`,
`i18n`, the catalog) are tested in Node (`test/`); the rest is covered by the visual snapshots
(`dev/snapshots.mjs`).

## Loading a model

1. `setModel(model)` picks the URL (`modelUrl`, else `<modelBaseUrl>/<model>[-lite].glb`, the lite
   file on small touch screens) and awaits the cached parse. A later `setModel` call supersedes
   an earlier one still loading (a load token).
2. `_install` clones the scene for this viewer (bones re-bound), creates the part texture and the
   two materials, assigns the body material to every skinned mesh, indexes the bones and builds
   the `BodyShape` (morph weights) and `PoseRig` (posing) of the model.
3. `_frame` measures the body box from the skinned skeleton in the rest pose: it drives the view
   math, the zoom limits and the ground shadow.
4. The requested pose, activations, body shape and view are applied without animation; `load`
   fires.

## The part texture

All per-part state lives in a 1 × N RGBA texture (N = 547), one texel per part, nearest filtering:

| Channel | Meaning |
|---|---|
| R | activation 0–255 (animated) |
| G | highlight: 0 none, 128 hover, 255 selected |
| B | 255 = dimmed (`setFocus`: a muscle not active while something else is) |
| A | part kind × 64 (muscle, tissue, bone, cartilage) |

The vertex shader reads its texel with `texelFetch(partTex, ivec2(_part, 0))`. Changing
activations, hover or selection rewrites up to 2 188 bytes and flags the texture; geometry,
materials and draw calls never change. The whole body is 15 draw calls (14 soft meshes, one
skeleton, plus the ground shadow) whatever is active.

## The shader

`createBodyMaterial` is three's `MeshStandardMaterial` with chunks replaced (`onBeforeCompile`),
so it keeps physically based lighting, tone mapping and image-based light:

- **base colour** by kind (muscle at rest is a desaturated pink so activation stands out), mixed
  towards the activation ramp amber → orange → red with `smoothstep(0, 0.06, a)` so the faintest
  activation is visible;
- **dimming** and **highlight** mixes; a **rim** (Fresnel) term that separates overlapping muscles;
  a small emissive term on active muscles so they read under any light;
- **roughness** per kind (bone rougher than muscle);
- **baked ambient occlusion** (`_AO`) multiplying the colour — grooves between muscles read without
  screen-space effects;
- **dual-quaternion skinning** replacing `skinning_vertex` and `skinnormal_vertex`.

### Dual-quaternion skinning

Linear blend skinning averages bone matrices; under a twist (the humerus rotated externally in a
double biceps, the trunk turned in a side chest) the blended matrix is no longer a rotation and
the shoulder, elbow or waist collapses ("candy-wrapper"). Dual quaternions blend rigid motions as
rigid motions and keep the volume (Kavan et al. 2008). Two details specific to these models:

- the bone matrices carry a **uniform scale** — the dequantization folded into the inverse bind
  matrices. The shader takes it as the length of the first column, removes it, converts the
  rotation to a quaternion, and applies the blended scale before the rigid part;
- **antipodality**: each quaternion is flipped to the hemisphere of the first influence before
  blending.

## Picking

A tap renders the scene once with the pick material — each fragment writes its part index + 1 as
16 bits in red and green — into a 1 × 1 render target through `camera.setViewOffset` on the tapped
pixel, and reads it back. The answer is exact for the deformed, posed, morphed body, costs one
1-pixel render (≈1 ms on a desktop GPU) and needs no CPU copy of skinned geometry. The ground and
the tape rings are hidden in the pass. In the split view the tapped half chooses the camera.
Hover runs the same pass at most once per frame, for mouse pointers only.

## Body shape

`BodyShape.resolve({ ffmi, body })` returns the 14 region weights: the fit to `body` when it has
tapes, body fat or an FFMI, else the typical body of `ffmi` (the calibrated prior). The viewer
eases between weight sets (smoothstep, 1.6 × the transition time) and draws the tape rings when
the shape settles. See [body-fit.md](body-fit.md).

## Poses

`PoseRig.target(spec)` turns a pose description into one quaternion per bone (rotations about the
fixed body axes, premultiplied), applies it once to measure the lowest foot (every 7th skeleton
vertex bound to a foot or toe), computes the pelvis offset that puts that foot on the floor, and
restores the previous state. Transitions slerp each bone and interpolate the offset over 0.7 s.

## Camera and views

OrbitControls with damping, a target clamped to the body box (panning cannot lose the body) and
zoom limits from 0.25 to 4 body heights. Views are data (`{ yaw, pitch, zoom, focus }`, relative
to the body); `setView` eases along the sphere the shortest way round in azimuth. Until the person
moves the camera, resizes re-frame the view (a container may first lay out with no size).
`'auto'` resolves through `bestView()` (cached by the activation set). See [views.md](views.md).

## The loop

One `requestAnimationFrame` loop per viewer advances, in order: the activation transition, the
shape transition, the pose transition, the camera transition, the controls (damping), a pending
hover pick, the second camera of the split view; then it renders **only if something changed**
(a dirty flag). An idle viewer costs one rAF callback and no GPU work — it matters on phones.
`prefers-reduced-motion` sets every transition to zero and disables auto-rotation.

## Split view

`SplitView` clones the camera, lays two transparent panes over the canvas (each with its own
OrbitControls) and renders the canvas twice with scissor rectangles. Moving either half moves the
other to the diametrically opposite position (`follow`), with a guard so the two controls do not
feed back. Inertia is off while split, or the halves would drift between frames.

## Resources and lifecycle

Parsed models are cached per URL for the page; each viewer clones the scene (geometry and
morph buffers are shared) and owns its materials, part texture, pick target, ground and rings.
`dispose()` cancels the loop, aborts every DOM listener (one `AbortController`), disconnects the
ResizeObserver, tears down the split view and frees the GPU objects. A disposed viewer leaves no
listener on its container, so a framework may mount another on the same element.

## Performance

Measured on an NVIDIA RTX 4060 Ti (Chrome, ANGLE/D3D11, 800 × 1000 canvas) and, as a pessimistic
bound, with CPU rendering (SwiftShader on an i7-12700F):

| | Full model, GPU | Lite, GPU | Full, CPU | Lite, CPU |
|---|---:|---:|---:|---:|
| frame | 2.3 ms | 1.3 ms | 256 ms | 156 ms |
| split-view frame | 3.5 ms | 2.0 ms | — | — |
| pick | 1.1 ms | 0.8 ms | 26 ms | 12 ms |
| `bestView()` | 23 ms | 15 ms | 589 ms | 268 ms |
| tape fit (8 tapes) | 6.5 ms | 9.2 ms | — | — |

Medians of repeated calls; the fit runs on the CPU in any case (7–15 ms mean with every tape over
1 200 ANSUR II bodies in Node.js, varying between runs, [body-fit.md](body-fit.md)).
