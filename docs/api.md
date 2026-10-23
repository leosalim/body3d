# API reference

Everything the package exports, the viewer's options, methods and events, the activation and view
formats, the tape-measure fit, the custom element and the iframe protocol. Types are in
[`src/index.d.ts`](../src/index.d.ts).

- [Creating a viewer](#creating-a-viewer)
- [Options](#options)
- [Activations](#activations)
- [Methods and properties](#methods-and-properties)
- [Events](#events)
- [Views](#views)
- [Body shape: FFMI](#body-shape-ffmi)
- [Body shape: tape measures](#body-shape-tape-measures)
- [Poses and rig](#poses-and-rig)
- [Breathing](#breathing)
- [Localization](#localization)
- [Theming and accessibility](#theming-and-accessibility)
- [Custom element](#custom-element)
- [iframe](#iframe)
- [Vite plugin](#vite-plugin)
- [Pure helpers (Node)](#pure-helpers-node)
- [Serving the models](#serving-the-models)

## Creating a viewer

```js
import { BodyViewer, createBodyViewer } from 'body3d'

const viewer = new BodyViewer(container, options)   // or createBodyViewer(container, options)
await viewer.ready                                   // first model loaded (rejects without WebGL)
// …
viewer.dispose()                                     // frees GPU memory, DOM and listeners
```

The container receives a `<canvas>` that fills it, a tooltip, the BodyParts3D credit and the
split-view button; a `static` container becomes `relative`. The viewer resizes with the
container (ResizeObserver) and renders only when something changed.

Without WebGL the container shows a message (`strings.noWebgl`), `ready` rejects and an `error`
event fires.

## Options

All optional. `DEFAULTS` exports the defaults.

| Option | Default | |
|---|---|---|
| `model` | `'male'` | `'male'` or `'female'` |
| `lod` | `'auto'` | `'high'` (380 k triangles), `'lite'` (159 k); `'auto'` picks the lite one on small touch screens |
| `modelBaseUrl` | `'/body3d/models/'` | folder with `male.glb`, `female.glb`, `male-lite.glb`, `female-lite.glb` |
| `modelUrl` | `null` | one explicit GLB URL (overrides `model`, `lod`, `modelBaseUrl`) |
| `activations` | `[]` | initial activation list |
| `aliases` | `null` | extra names: `{ "Peito": "chest", "Lower glutes": { "glutes": 0.8 } }` |
| `view` | `'front'` | a preset, a direction `[x, y, z]`, a saved view `{ yaw, pitch, zoom, focus }` or `'auto'` |
| `locale` | `'en'` | `'en'` or `'pt-BR'` — anatomical labels and interface text |
| `strings` | `null` | interface text overrides, `{ [locale]: { key: text } }` (see [Localization](#localization)) |
| `background` | `null` | a CSS colour; `null` = transparent (the page decides) |
| `colors` | `{}` | any of `DEFAULT_COLORS` |
| `interactive` | `true` | orbit, zoom, pan and tap |
| `hover` | `true` | highlight the part under the mouse |
| `tooltip` | `true` | built-in label on tap / hover |
| `showBones` | `true` | draw the skeleton |
| `autoRotate` | `false` | turn slowly around the body |
| `transitionMs` | `350` | activation transition; shape ×1.6; 0 with `prefers-reduced-motion` |
| `credit` | `true` | BodyParts3D credit (CC BY 4.0 requires attribution) |
| `pixelRatio` | `null` | `null` = `min(devicePixelRatio, 2)` |
| `pose` | `null` | a pose id of the model or a pose object (see [Poses](#poses-and-rig)); `null` = standing |
| `breath` | `null` | a breathing shell on the thorax (see [Breathing](#breathing)); `null` = none |
| `ffmi` | `null` | normalized FFMI to draw; `null` = the model default (26 male, 22 female) |
| `body` | `null` | the person's measures for the fit (wins over `ffmi`) |
| `measureRings` | `false` | draw the tape of every measure the fit used |
| `split` | `false` | start with the split view |
| `splitButton` | `true` | the corner button that toggles the split view |

## Activations

An activation list is an array of `{ muscle, activation, side? }`; `activation` is a percentage
0–100, `side` (`'left'` | `'right'`) restricts it to one side. `name` or `id` are accepted in
place of `muscle`. A part reached by several entries keeps the largest value.

```js
viewer.setActivations([
  { muscle: 'Chest', activation: 100 },             // a training group
  { muscle: 'Deltoide anterior', activation: 55 },  // the same vocabulary in Portuguese
  { muscle: 'triceps', activation: 60 },            // an anatomical group id
  { muscle: 'Rectus femoris', activation: 40, side: 'left' }  // a muscle label
])
```

**Names** match without case or accents, in four vocabularies (all listed in
[catalog.md](catalog.md)):

| Vocabulary | Examples | Count |
|---|---|---|
| training groups — English name, Portuguese name or id | `Chest`, `Peitoral`, `upper-back`, `Hamstrings` | 25 |
| anatomical groups — id or label | `delt-front`, `Anterior deltoid`, `Deltoide anterior` | 44 |
| muscles — id or label (no side) | `rectus-femoris`, `Rectus femoris`, `Reto femoral` | 135 |
| your `aliases` | anything | — |

When two vocabularies share a name, aliases win, then training-group names, then ids of groups and
of muscles, then labels, then training-group ids. `"glutes"` is the training group (gluteus maximus
and, at half, medius); `"Gluteus maximus"` the anatomical group. Prefixes make it explicit:
`"training:glutes"`, `"group:glutes"`, `"muscle:gluteus-maximus"`.

A **training group** maps to anatomical groups or muscles with weights — a fraction of the
activation sent: `Brachialis` lights the brachialis at 100 % and the brachioradialis at 50 %;
`Hip Flexors` the iliopsoas and, at 50–60 %, rectus femoris, sartorius and tensor fasciae latae.

Unknown names are skipped, listed in `viewer.unknown` and reported with a console warning.

```js
import { fromExercise, resolveActivations, targetsOf } from 'body3d'

fromExercise({ primaryMuscles: ['Glutes'], secondaryMuscles: [{ name: 'Hamstrings' }] })
// → [{ muscle: 'Hamstrings', activation: 45 }, { muscle: 'Glutes', activation: 100 }]
fromExercise(exercise, { primary: 90, secondary: 30 })
targetsOf('Brachialis')                 // { brachialis: 1, brachioradialis: 0.5 }
resolveActivations(list, viewer.parts)  // { values: Float32Array (0–1 per part), unknown }
```

## Methods and properties

| | |
|---|---|
| `setActivations(list, { animate })` | replaces the activations (an empty list = rest) |
| `activationOf(index)` | current activation 0–100 of a part |
| `unknown` | names of the last list that matched nothing |
| `setModel('male' \| 'female')` | loads the other model; camera, activations and the pose (when the other model has it) are kept; returns a Promise |
| `setView(view, { animate })` | turns the camera (see [Views](#views)); a double click returns to the last view set |
| `getView()` | the current view `{ yaw, pitch, zoom, focus }` — store it to restore it later |
| `bestView()` | the best view for the current activations, without moving the camera |
| `autoView({ animate })` | computes the best view and goes there |
| `setSplit(on)`, `split` | the opposite side alongside (see [views.md](views.md)) |
| `setFocus(0–1)` | dims what is not active |
| `setColors(colors)` | changes colours without reloading |
| `setShowBones(on)`, `setAutoRotate(on)` | |
| `setLocale(locale)`, `locale`, `strings` | labels and interface text |
| `setFfmi(value \| null, { animate })`, `ffmi`, `ffmiRange` | see [Body shape: FFMI](#body-shape-ffmi) |
| `setBody(input \| null, { animate })`, `bodyFit` | see [Body shape: tape measures](#body-shape-tape-measures) |
| `regionWeights`, `setRegionWeights(weights, { animate })` | the 14 morph weights directly |
| `setMeasureRings(on)` | tape rings on the body |
| `fitModel` | prepared fit data of the loaded model (advanced) |
| `poses`, `pose`, `setPose(id \| pose \| null, { animate, view })` | see [Poses](#poses-and-rig) |
| `breath`, `setBreath(spec \| null)`, `breathState()` | see [Breathing](#breathing) |
| `bones`, `joints` | the rig (three.js bones by name; joint positions and hinge axes) |
| `parts`, `meta` | the part table and the metadata of the loaded GLB ([model-format.md](model-format.md)) |
| `pickAt(clientX, clientY)` | index of the part under a point, or −1 |
| `partInfo(index)` | `{ index, id, muscle, side, kind, label, group, groupLabel, activation }` |
| `select(index)` | selects a part (−1 clears) and fires `select` |
| `snapshot()` | the current frame as a PNG data URL |
| `render()` | requests a frame (after moving bones by hand) |
| `resize()` | adapts to the container (called by a ResizeObserver) |
| `dispose()` | frees everything; the viewer is unusable afterwards |
| `canvas`, `container`, `splitButton`, `renderer`, `scene`, `camera` | the DOM and three.js objects, for advanced use |

Every setter returns the viewer, so calls chain: `viewer.setActivations(list).setFocus(1)`.

## Events

The viewer is an `EventTarget`; every event is a `CustomEvent`.

| Event | `detail` |
|---|---|
| `load` | `{ model, lod, url, meta }` — after every model load |
| `error` | the error (model load failure, no WebGL) |
| `select` | `partInfo` of the tapped muscle or tissue, or `null` |
| `hover` | `partInfo` under the mouse, or `null` (mouse only) |
| `viewchange` | `getView()` — the person finished orbiting or zooming |
| `split` | `true` / `false` |
| `fit` | `bodyFit` — after every fit to measures |
| `breath` | `breathAt` state of the phase that starts (`phase`, `duration`, `remaining`, `cycle`, `fill`) |

## Views

```js
viewer.setView('back')                                   // preset
viewer.setView([1, 0.2, 1])                              // direction from the body towards the camera
viewer.setView({ yaw: 135, pitch: 10, zoom: 1.4, focus: [0, 0.15, 0] })
viewer.setView('auto')                                   // bestView() for the current activations
const saved = viewer.getView()                           // e.g. persist it per exercise
```

Presets: `front`, `back`, `left`, `right` (the body's sides), `front-left`, `front-right`,
`back-left`, `back-right`, `top`.

A saved view is relative to the body: `yaw` in degrees around it (0 front, 90 the body's left,
180 back, −90 the body's right), `pitch` above the horizontal (−85…85), `zoom` (1 frames the whole
body; 0.5…5) and `focus`, the look-at point from the body centre in body heights. The same view
fits both models, any FFMI and any viewport. How `'auto'` chooses, and its evaluation:
[views.md](views.md).

`toViewSpec`, `viewPose` and `viewFromCamera` expose the same math for other code.

## Body shape: FFMI

The body is drawn for a **normalized fat-free-mass index**, FFM / height² + 6.1 × (1.8 − height)
(Kouri et al. 1995), in kg/m².

```js
viewer.ffmiRange     // { min: 15, max: 32, default: 26 } on the male model; 12–26, 22 on the female
viewer.setFfmi(19.4) // the typical body of FFMI 19.4 (smooth transition)
viewer.setFfmi(null) // back to the model default
viewer.ffmi          // the FFMI drawn now
```

The typical body of an FFMI is the mean body of the people with that FFMI in ANSUR II for the
limbs, and the model's hypertrophy for the trunk ([body-fit.md](body-fit.md)). Outside the range
the body stays at the limit.

## Body shape: tape measures

```js
viewer.setBody({
  heightCm: 178, weightKg: 82,
  bodyFatPercent: 14, bodyFatMethod: 'BIA',      // the method weighs its uncertainty
  ffmi: 22.6,                                     // optional: the same formula, if you already have it
  girths: { RIGHT_BICEP: 39, LEFT_BICEP: 38.6, RIGHT_THIGH: 60, NECK: 39, WAIST: 82 }   // cm
})
viewer.setMeasureRings(true)
viewer.bodyFit
```

**Tape sites** (`TAPE_SITES`): `LEFT_/RIGHT_BICEP` (flexed, at the thickest point — the ANSUR
convention), `LEFT_/RIGHT_FOREARM`, `LEFT_/RIGHT_THIGH` (just below the gluteal fold),
`LEFT_/RIGHT_CALF`, `NECK` (below the larynx), `SHOULDERS`, `CHEST` (nipple height; ignored for
women — it measures the breasts), `HIPS` and `GLUTES` (the same loop; their mean is used), and
`WAIST` / `ABDOMEN` (only for the US Navy body-fat estimate). A tape outside its plausible range
(`TAPE_RANGES`) is treated as a typo.

**Body fat**: `bodyFatPercent` with a method — `DEXA`, `HYDROSTATIC`, `BOD_POD`, `SKINFOLD_7`,
`SKINFOLD_3`, `BIA`, `NAVY`, `VISUAL` (`BODY_FAT_SD` has their uncertainty). Without it, the US Navy
method from neck + abdomen (men) or neck + waist + hips (women); without that either, the tapes
decide how much muscle there is.

**Result** (`bodyFit`, the `fit` event):

| Field | |
|---|---|
| `weights` | the 14 region weights (`Float64Array`, order of `meta.body.regions`) |
| `ffmi`, `ffmiMeasured` | the fitted FFMI and the one from weight/height/body fat (null without) |
| `bodyFat` | `{ value, sd, source: 'measured' \| 'navy', method }` or null |
| `sites[]` | per tape: `codes`, `measuredCm`, `status` and, for used tapes, `expectedCm` (what the population with this FFMI measures), `fittedCm` (the drawn tape), `muscleOnlyFitCm`, `fatMm` (estimated skin + fat), `z` (standardized residual) |
| `status` | `'ok'`, `'outlier'` (inconsistent with the FFMI and the other tapes: left out), `'invalid'` (outside the plausible range), `'ignored'` (a woman's chest), `'navy'` (waist/abdomen: body fat only) |
| `muscle` | `{ volumeL, targetL, kg, fractions (per region), groups: { arms, legs, trunk } }` — `kg` is the person's skeletal muscle mass estimate |
| `uncertainty` | standard deviation of each weight (Laplace approximation) |
| `iterations`, `measured`, `notes` | solver iterations, tapes used, `['no-body-fat']` when nothing gave a body fat |

`setBody(null)` returns to the typical body of `ffmi`. The method, its calibration and its
validation are in [body-fit.md](body-fit.md).

## Poses and rig

```js
viewer.poses                                   // [{ id, label, view, activations, joints }] of the model
viewer.setPose('front-lat-spread', { view: true })   // pose and turn to its view (0.7 s)
viewer.setActivations(poseActivations(viewer.poses[1]))   // what is contracted in the pose
viewer.setPose(null)                           // standing
```

| Male | Female |
|---|---|
| `front-double-biceps`, `front-lat-spread`, `side-chest`, `back-double-biceps`, `side-triceps`, `abs-and-thigh` | `front-pose`, `back-pose`, `side-pose`, `front-double-biceps`, `back-double-biceps`, `side-triceps` |

After posing, the body moves until the lowest foot touches the floor. Switching sex keeps a pose
when the other model has the same id.

A page can also give its own pose, in the same format: an object `{ joints, ground, frame, view }`.
`ground: 'body'` rests the body on the lowest point of its skin instead of its feet (on hands and
knees, on the back), `frame: 'pose'` (the default with `ground: 'body'`) frames the camera on the
posed body, `view` is where the camera goes with `setPose(…, { view: true })`. Trace's yoga poses
are such objects.

```js
viewer.setPose({ joints: { pelvis: [['x', 95]], thigh_l: [['x', -150]], shin_l: [['x', 150]] }, ground: 'body' }, { view: true })
```

A change of pose takes 0.7 s, up to 1.6 s for a large one (standing to lying). With `ground:
'body'` at either end the body is grounded again on every frame, so no limb goes through the
floor half way, and with `view: true` the camera moves with the body at the same pace. A frame
that stalls (the first one compiles the shaders) pauses the running transitions instead of
skipping them.

The rig has 52 joints (`pelvis` → `spine_lower` → `spine_upper` → `chest` → `neck` → `head`;
`shoulder` → `upperarm` → `forearm` → `hand` → fingers in three phalanges; `thigh` → `shin` →
`foot` → `toes`, `_l`/`_r`). In the rest pose every bone has identity rotation, so rotations are
about the body axes:

```js
viewer.bones.upperarm_l.rotation.z = 1.2   // abducts the left arm
viewer.bones.shin_r.rotation.x = 1.4       // flexes the right knee
viewer.render()
```

## Breathing

```js
viewer.setBreath({
  center: { bone: 'chest', position: [0, 0.24, 0.1] },   // the point the breath works against, in a bone's frame (m)
  radius: 0.11,                                           // metres
  inhale: 4, holdIn: 0, exhale: 6, holdOut: 0             // seconds
})
viewer.addEventListener('breath', (e) => show(e.detail.phase, e.detail.duration))
viewer.setBreath(null)
```

A nearly transparent sphere is drawn over the thorax (a Fresnel rim, so it reads as a circle from
any side), with a dot at its centre: it fills on the inhale, holds, empties on the exhale and holds
again, and follows its bone as the body moves. Every phase that starts fires `breath`;
`breathState()` says where the breath is now. With reduced motion the shell stays still and no
event fires. `breathAt(seconds, spec)` and `breathPeriod(spec)` are the same timing as pure
functions; `color` changes the shell's colour (default a pale lilac).

## Localization

`locale: 'en'` (default) or `'pt-BR'` sets the anatomical labels (`partInfo`, tooltip, pose labels)
and the interface text. `setLocale()` switches live. Other languages: pass interface text with
`strings` and the locale tag; anatomical labels fall back to English until they are added to
`pipeline/anatomy.py`.

```js
createBodyViewer(el, {
  locale: 'es',
  strings: { es: { yourView: 'tu vista', oppositeSide: 'lado opuesto', left: 'izquierdo', right: 'derecho',
                   activation: '{pct} de activación', noWebgl: 'Tu navegador no pudo abrir el modelo 3D.' } }
})
```

Keys: `modelLabel`, `modelLabelActive` (`{list}`), `modelLabelRest`, `noWebgl`, `splitTitle`,
`splitAria`, `yourView`, `oppositeSide`, `left`, `right`, `activation` (`{pct}` is drawn in bold).

## Theming and accessibility

Colours: `DEFAULT_COLORS` — `muscle`, `tissue`, `bone`, `cartilage`, the activation ramp `low` →
`mid` → `high`, `highlight`, `rim`, `tape`, `tapeOutlier`.

CSS custom properties read from the container: tooltip `--b3d-tip-bg`, `--b3d-tip-fg`,
`--b3d-tip-radius`, `--b3d-tip-shadow`; split button `--b3d-button-bg`, `--b3d-button-fg`,
`--b3d-button-border`, `--b3d-button-radius`, `--b3d-button-shadow`, `--b3d-button-on-bg`,
`--b3d-button-on-fg`; split view `--b3d-label-fg`, `--b3d-divider`; credit `--b3d-credit-fg`. The
background is transparent unless `background` is set.

Accessibility: the canvas has `role="img"` and an `aria-label` that lists what is active,
strongest first ("3D muscle model. Activation: Chest 100%, Triceps 60%."); the split button has a
label and `aria-pressed`; `prefers-reduced-motion` turns transitions and auto-rotation off.

## Custom element

```js
import { defineBodyElement } from 'body3d'
defineBodyElement()               // registers <body3d-viewer> (or defineBodyElement('my-tag'))
```

```html
<body3d-viewer model="female" view="back" locale="pt-BR" no-bones></body3d-viewer>
<script>
  const el = document.querySelector('body3d-viewer')
  el.activations = [{ muscle: 'Glutes', activation: 100 }]
  el.body = { heightCm: 165, weightKg: 60, bodyFatPercent: 24, girths: { LEFT_THIGH: 58 } }
  el.addEventListener('body3d-select', (e) => console.log(e.detail))
</script>
```

Attributes: `model`, `view`, `pose`, `lod`, `locale`, `model-base-url`, `background`,
`auto-rotate`, `no-bones`, `no-tooltip`, `no-credit`, `measure-rings`. Properties: `activations`,
`body`, `viewer`. Events: `body3d-load`, `body3d-select`, `body3d-hover`, `body3d-error`,
`body3d-fit`, `body3d-viewchange`. In Vue, declare the tag a custom element
(`compilerOptions.isCustomElement`) and bind `:activations.prop="list"`.

## iframe

`embed.html` (in `dist/app` after `npm run build`) is configured by its URL:

```
embed.html?model=female&view=back&pose=back-pose&locale=pt-BR&a=Glutes:100,Hamstrings:50:left&bg=%23101214&origin=https://app.example
```

Parameters: `model`, `view`, `pose`, `lod`, `locale`, `models` (model folder), `bg`, `rotate`,
`bones=0`, `credit=0`, `a` (`name:percent[:left|right]`, comma separated), `origin`.

Then by messages:

```js
frame.contentWindow.postMessage({ type: 'body3d:set', activations, model: 'male', pose: 'side-chest' }, origin)
frame.contentWindow.postMessage({ type: 'body3d:set', body: measures, rings: true, locale: 'en' }, origin)
// the frame answers { type: 'body3d:ready' | 'body3d:select' | 'body3d:hover' | 'body3d:viewchange' | 'body3d:fit', detail }
```

`origin` restricts who may send and receive messages. The page reads no personal data on its own;
measures only arrive when the parent sends them, and `body3d:fit` (which echoes them) is only sent
when `origin` is set.

## Vite plugin

```js
// vite.config.js
import { body3d } from 'body3d/vite'
export default defineConfig({ plugins: [body3d()] })          // body3d({ lods: ['lite'] }) ships only the lite models
// app code
import { createBodyViewer } from '@body3d'
```

It aliases `@body3d` to the library source (bundled with the app; `three` resolved once from the
app — `dedupe`), serves the models at `/body3d/models/` in development and copies them to
`<outDir>/body3d/models/` in the build: the app's own origin, so `connect-src 'self'` covers them.

## Pure helpers (Node)

The fit and the anthropometry run without a browser:

```js
import { prepareFitModel, fitBody, ffmiNormalized, navyBodyFat } from 'body3d'
const model = prepareFitModel(glbJson.extras.body)     // once per model
const fit = fitBody(model, { heightCm: 178, weightKg: 82, bodyFatPercent: 14, girths: { RIGHT_BICEP: 39 } })
```

`prepareFitModel(body, { calibration, populationSpread })`: `calibration: null` uses the uniform
body without ANSUR II; `populationSpread` widens the population prior (default 3). Also exported:
`observe`, `priorWeights`, `siteGirth`, `muscleVolume`, `targetVolume`, `uniformWeight`,
`fingerprint`, `WEIGHT_RANGE`, `POPULATION_SPREAD`, `TAPE_SITES`, `TAPE_RANGES`, `BODY_FAT_SD`,
`skinfoldMm`, `girthScale`, `bodySurfaceArea`; and for views `computeBestView`,
`BEST_VIEW_DEFAULTS`; for anatomy `AREAS`, `GROUPS`, `MUSCLES`, `TISSUES`, `REGIONS`,
`TRAINING_GROUPS`, `partLabel`, `groupLabel`, `normalizeName`; `clearModelCache()` drops parsed
models.

## Building blocks

For tools that stage the body in their own three.js scene — posed with other objects, drawn with
their own materials (a scene builder, for example, renders it into a G-buffer to draw icons):

```js
import { loadModel, cloneModel, modelUrl, poseQuaternions, useDualQuaternionSkinning, BodyShape } from 'body3d'
const gltf = await loadModel(modelUrl('male', 'lite', '/models/'))   // cached per URL
const root = cloneModel(gltf)                                         // bones re-bound to the copy
const meshes = []; root.traverse((o) => o.isSkinnedMesh && meshes.push(o))
const shape = new BodyShape(meshes, gltf.userData.body)
shape.set(shape.resolve({ ffmi: 22 }).weights)                       // the typical body of FFMI 22
material.onBeforeCompile = (shader) => useDualQuaternionSkinning(shader)   // any three material
```

`poseQuaternions(spec, boneNames)` turns a pose in the format of `src/poses.js` into one
quaternion per bone. The models carry the dequantization in their bone matrices: draw them with
`useDualQuaternionSkinning` (it separates that scale), and note that three's
`SkinnedMesh.getVertexPosition` already applies the bones.

## Serving the models

| File | Triangles | Size | gzip (level 1 / 6) |
|---|---:|---:|---:|
| `male.glb` | 379 742 | 11.0 MB | 5.7 / 5.5 MB |
| `female.glb` | 379 742 | 11.0 MB | 5.6 / 5.4 MB |
| `male-lite.glb` | 158 610 | 5.0 MB | 2.6 / 2.5 MB |
| `female-lite.glb` | 158 610 | 5.0 MB | 2.5 / 2.4 MB |

- Serve `.glb` as `model/gltf-binary` and gzip it (nginx: `types { model/gltf-binary glb; }` and
  `gzip_types model/gltf-binary`; its default `mime.types` sends octet-stream, uncompressed).
- The files need nothing but WebGL: positions and normals are quantized (KHR_mesh_quantization),
  read natively by three.js — no Draco or meshopt decoder, no WebAssembly, no `eval`, so a strict
  Content-Security-Policy (`script-src 'self'`) works. Same origin: `connect-src 'self'`.
- The model URL is not derived from `import.meta.url` on purpose — bundlers rewrite it inside
  dependencies. Use `modelBaseUrl` or serve them at `/body3d/models/`.
- Parsed models are cached per URL and shared by every viewer on the page.
