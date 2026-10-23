# Design decisions

Every non-obvious decision in body3d, written as: the **problem**, the **alternatives** studied,
the **choice**, and the **evidence** or reasoning behind it. Read this before changing one of them.
Method details live in the topic documents; this is the "why".

- [Data and anatomy](#data-and-anatomy) — D1–D7
- [Geometry and body shape](#geometry-and-body-shape) — D8–D14
- [Rig and skinning](#rig-and-skinning) — D15–D17
- [File format](#file-format) — D18–D21
- [Runtime](#runtime) — D22–D27
- [Views](#views) — D28–D30
- [Tape-measure fit](#tape-measure-fit) — D31–D41
- [Engineering](#engineering) — D42–D45
- [Open questions](#open-questions)

---

## Data and anatomy

### D1. BodyParts3D as the source

**Problem.** A web viewer of muscle activation needs separate, named, volumetric muscles over a
skeleton, under a licence that allows commercial use.

**Alternatives.** Skin-surface body models (SMPL and its successors; MakeHuman) have no muscles.
Musculoskeletal simulation models (OpenSim) represent muscles as lines of action, not volumes.
Commercial atlases (Zygote and the like) are not redistributable. Z-Anatomy derives from
BodyParts3D and keeps a share-alike licence.

**Choice.** BodyParts3D 4.0 (DBCLS): one adult male body, every FMA concept with a shape as a
mesh, 426 muscle meshes.

**Why.** The only open set with volumetric, individually named muscles tied to an ontology (FMA
ids give unambiguous names in any language). Since 2025 it is CC BY 4.0 — commercial use with
attribution, no share-alike. Its gaps (no latissimus, a fused abdominal wall, one male body) are
addressed in D4–D6 and D13.

### D2. An explicit anatomical table

**Problem.** Which of the 2 234 meshes enter the model, under which name and group.

**Alternatives.** Include by system classification (everything classified "muscle"); include by
regex on names.

**Choice.** `pipeline/anatomy.py` lists every muscle by concept name, every tissue, bone rules and
viscera; `check()` fails the build on any inconsistency.

**Why.** Classification and regexes failed in practice: "cuneiform" matched a laryngeal cartilage;
a file is named "left" but lies on the right (FJ1469). An explicit list makes every inclusion a
reviewed decision and gives the place to attach labels, groups, regions and translations.

### D3. Two levels of grouping: 44 anatomical groups, 25 training groups

**Problem.** Training talks about "chest", "lats", "upper back"; anatomy about clavicular parts
and teres major. An activation API should accept both.

**Choice.** Each muscle belongs to one of 44 anatomical groups (fine: three pectoral parts, three
deltoid parts, gastrocnemius apart from soleus). 25 training groups map onto groups or muscles
**with weights** (Brachialis → brachialis 1, brachioradialis 0.5). Names resolve case- and
accent-insensitively across both vocabularies and muscles, with a fixed precedence and explicit
prefixes.

**Why.** Weights express that a training group recruits structures partially; fine groups let an
application be precise when it knows more (standing vs seated calf raise). The precedence keeps
every name that resolved before 0.2 resolving to the same targets (checked on all 377 names).

### D4. Synthesizing the latissimus dorsi

**Problem.** BodyParts3D 4.0 has no latissimus — the muscle of every pull exercise.

**Alternatives.** Sculpt it by hand (not reproducible, a licence question for the result); borrow a
mesh from another atlas (licence); a parametric sheet between landmarks (crosses the ribs, ignores
the muscles below).

**Choice.** Fibres as elastic bands draped over a signed distance field of the trunk, from a fleshy
origin measured on the model (spine under the trapezius, the lateral border of the erectors, the
iliac crest) to the intertubercular sulcus; a sheet thickened by volume conservation.

**Why.** It follows the anatomy's own rule — a muscle lies taut over what is below it — from
landmarks measured on this body, so it sits on these ribs and erectors, rebuilds with the rest,
and its shape is explainable. Multiresolution relaxation makes it converge in seconds.

### D5. Cutting the rectus abdominis out of the abdominal wall

**Problem.** The "external oblique" mesh is the whole anterior wall; "abs" cannot light alone.

**Choice.** A cut along the linea semilunaris, measured as a groove on horizontal slices, with new
vertices on the cut duplicated per side.

**Why.** The groove is visible on the mesh; cutting exactly on an iso-line keeps both parts glued
and gives each face to one side, so colour never bleeds.

### D6. Leaving the thoracolumbar aponeurosis out

**Problem.** The latissimus' medial aponeurosis covers the lower back.

**Choice.** Not drawn; the latissimus starts at its fleshy border.

**Why.** Drawn, it would hide the erectors — the "lower back" group of every deadlift. A viewer of
activation must show activatable structures; the aponeurosis is thin and not activated.

### D7. Viscera as the core of the hypertrophy

**Problem.** Layered hypertrophy (D10) grows muscle away from a core; with bones alone as the core
the whole abdomen inflated from the spine.

**Choice.** Bones, cartilage and viscera (decimated hard, never drawn) form the core.

**Why.** The abdominal wall then thickens over the organs, as it does, and the linea alba stays
sunk between the recti.

## Geometry and body shape

### D8. Voxelization by ray parity with majority vote

**Problem.** Volumetric operations need inside/outside of meshes that are not all watertight.

**Alternatives.** Flood fill / `binary_fill_holes` on the surface voxels; winding numbers.

**Choice.** Ray parity along the three axes; a column with an odd number of crossings is dropped on
that axis; two of three votes decide; the surface shell is added.

**Why.** The left femur of BodyParts3D leaks on the grid: a flood fill marked the whole thigh as
bone and the hypertrophy "inflated" it. Parity voting is robust to small holes and fully
vectorized.

### D9. Area-proportional decimation and fixed-border Taubin smoothing

**Choice.** A triangle budget per kind and LOD spread by surface area (uniform density, a minimum
per part); Taubin λ/μ smoothing with borders fixed.

**Why.** Uniform density avoids small muscles turning into blobs next to dense large ones. Taubin
does not shrink (Laplacian smoothing does); fixed borders keep cut pieces glued; and being linear
it commutes with the morph targets (D11).

### D10. Hypertrophy as a stacking integral

**Problem.** Making muscles bigger without layers crossing.

**Alternatives.** Inflating each muscle along its normals (layers interpenetrate); physical
simulation (finite elements: heavy, needs tetrahedral meshes, many parameters); sculpted targets
(manual, not FFMI-calibrated).

**Choice.** Each point moves, along the direction away from the core, by the integral of the
emphasis of all the muscle between it and the core; a global gain meets a target muscle volume.

**Why.** Displacement is monotonic with depth, so layers stay stacked by construction; it is
linear in the gain (D11); and the gain is solved to a measurable quantity (FFMI → volume, D14).

### D11. One morph target per region, exact by linearity

**Problem.** Different parts of a body differ (big arms, small legs) — one uniform morph cannot
show a person.

**Choice.** The stacking integral splits by fit region; every later step (smoothing, Taubin with
fixed borders, scale) is linear, so each region is an exact morph target and the regions sum to the
uniform morph. The build checks the sum (largest difference 1.5 × 10⁻¹⁵ m, float64 rounding) and
caps displacement per unit weight.

**Why.** Exactness lets the fit reason with closed forms (girth probes, a volume polynomial)
instead of sampling; morph targets are evaluated by the GPU for free.

### D12. Isotropic growth of the limbs

**Problem.** Stacking thickens each layer along the thickness it has: the arm grew in depth only
(10 × 21 cm at FFMI 26).

**Choice.** Mid-limb, the displacement becomes a radial scale about the section centre, blended by
limb and faded at the joints, only inside the limb tube. The scale per level is computed once, per
unit of gain on the rest shape, from the outline area stacking adds (to first order), and enters
as a fixed field.

**Why.** Fusiform muscles grow in area; arms are nearly round. Computing the scale once keeps the
field linear, so D11 still holds exactly. The tube restriction stopped a field applied from the
humerus to the pectoralis from producing 30 cm "streamers".

**Evidence and cost.** It does not conserve volume per level (an earlier version of this document
said it did): against plain stacking a limb's own muscle volume changes by −9 % to +23 % and the
upper arm's field enlarges the latissimus near the axilla
([validation/anatomy-checks.md](validation/anatomy-checks.md#2-isotropic-limbs-against-plain-stacking)).
The FFMI calibration is unaffected — the table FFMI → gain is computed afterwards on the measured
volume — and in the fit the limbs follow ANSUR II girths. A per-level rescaling to match stacking's
volume at a reference gain would stay linear; it was not needed for the calibrated body.

### D13. Female proportions by skeletal transforms

**Problem.** BodyParts3D has one male body.

**Alternatives.** A female dataset (none with volumetric muscles is open); scaling the male body
uniformly (wrong proportions).

**Choice.** Per-segment transforms through the skinning weights (wider pelvis, narrower thorax,
waist and shoulders, larger carrying angle and knee valgus, smaller hands, feet and neck), then a
female emphasis of the hypertrophy (glutes, legs).

**Why.** The differences that read as "female" in a muscle figure are skeletal proportions and the
distribution of muscle; both are parameters here, from mean anthropometric differences. No breasts:
the model shows muscle.

### D14. FFMI as the body-size parameter

**Problem.** One number to say how muscular a body is.

**Alternatives.** Weight or BMI (confound fat and muscle); skeletal muscle mass (rarely known);
raw FFMI (depends on height).

**Choice.** Height-normalized FFMI (Kouri et al. 1995), converted to skeletal muscle mass with an
SMM/FFM ratio that rises with muscularity, and to represented volume with a coverage factor for
the muscles the model lacks. The untrained end comes from Janssen et al. (2000); that the ratio is
higher in athletes is reported by Midorikawa et al. (2007) and Abe et al. (2018), about +8 %; the
ramp used (+14 % male, +11 % female) is our assumption ([anatomy.md](anatomy.md#5-from-ffmi-to-muscle-volume)).

**Why.** It is computable from data people have (weight, height, body fat), it separates muscle
from fat, and its normalized form has known reference values (≈ 25 as a practical drug-free
ceiling in men). The ANSUR II calibration later replaced the SMM/FFM estimate for the limbs by
measured girths (D35); the ratio still sets the trunk of the typical body (half the slope: the
default male's shoulders 2.7 cm narrower).

## Rig and skinning

### D15. Joint pivots from bone geometry

**Choice.** Sphere fits on the femoral and humeral heads, epicondyle and malleoli midpoints, disk
centres, bone contacts — computed at full resolution.

**Why.** Reproducible, anatomically placed pivots; checked against anthropometric segment tables
(knee 0.28, hip 0.52, shoulder 0.81 of height). Manual placement would not survive a rebuild.

### D16. Skinning weights restricted to dominant segments

**Problem.** Inverse-distance weights bind the hand to the thigh it hangs next to, and stretch
muscle bellies across joints.

**Choice.** Inverse distance (cubed) to bone surfaces, only among the segments that dominate the
part and their chain neighbours; the dominant segment ×4; smoothed; 4 influences.

**Why.** Both failures were observed: raising the leg dragged the hand; flexing the elbow stretched
the biceps between humerus and forearm. With these rules the belly turns rigidly with its bone and
only the ends blend.

### D17. Dual-quaternion skinning in the shader

**Problem.** Linear blend skinning collapses volume under twist (double biceps: external rotation
of the humerus; side chest: trunk rotation).

**Choice.** Dual-quaternion skinning (Kavan et al. 2008) in three's standard material via shader
chunks, separating the uniform scale that the quantized format folds into the bone matrices.

**Why.** It preserves volume and costs a few ALU operations per vertex; replacing chunks keeps
three's lighting and morph targets. The scale separation was needed because D19 puts the
dequantization in the inverse bind matrices.

## File format

### D18. glTF with KHR_mesh_quantization, no compression codec

**Problem.** Small downloads under a strict Content-Security-Policy.

**Alternatives.** Draco or meshopt compression (smaller, but need a decoder — WebAssembly or a
worker the CSP must allow); float positions (twice the size).

**Choice.** int16 positions, int8 normals, uint8 skin and AO, uint16 indices, sparse morph targets,
served gzipped: 11 MB → 5.7 MB (full), 5 MB → 2.6 MB (lite).

**Why.** three.js reads quantized attributes natively — no decoder, no WebAssembly, no `eval`;
gzip at the web server recovers much of the redundancy (about half). The trade-off is a larger
file than a meshopt or Draco encoding would give, accepted for zero runtime dependencies.

### D19. One quantization for the whole body

**Choice.** A single bounding box quantizes every mesh (≈ 0.03 mm steps), and the dequantization
goes into the inverse bind matrices.

**Why.** glTF ignores the transform of skinned mesh nodes, so per-mesh quantization would need one
skin per mesh; one box lets a single skin serve all 15 meshes.

### D20. Meshes grouped by dominant region, sparse targets

**Problem.** With 14 regions, every vertex of a mesh carrying all targets evaluates 14 morphs.

**Choice.** Soft parts go into one mesh per region that moves them most; each mesh carries only the
targets that move it (1–10); a target moving under 60 % of the vertices is sparse.

**Why.** Fewer active targets per vertex in the shader and ~3/4 of the targets sparse in the file.

### D21. Labels in the catalog, not only in the GLB

**Choice.** The GLB carries English labels and ids; translations live in the generated JS catalog,
keyed by id; the viewer picks a locale at runtime.

**Why.** One model file serves every language; adding a language does not rebuild 30 MB of models.

## Runtime

### D22. Per-part state in a data texture

**Problem.** Changing the colour of any of 547 parts at interactive rates.

**Alternatives.** One material per part (547 draw calls); vertex colours (rewriting megabytes of
buffers per change).

**Choice.** A 1 × 547 RGBA texture (activation, highlight, dimming, kind) read by the vertex shader
through a per-vertex part index.

**Why.** A change rewrites ≤ 2.2 kB; the body stays 15 draw calls.

### D23. GPU picking

**Choice.** Render the part ids of one pixel; read it back.

**Why.** Exact on the skinned, morphed, posed body; ~1 ms on a GPU. CPU raycasting would need the
deformed geometry on the CPU (skinning, 14 morphs) for 380 k triangles.

### D24. Rendering on demand

**Choice.** A dirty flag; the loop renders only after a change.

**Why.** An idle viewer costs nothing on the GPU — important on phones and in pages with several
viewers.

### D25. Model URLs not derived from `import.meta.url`

**Why.** Bundlers rewrite `new URL(…, import.meta.url)` inside dependencies and the path broke in
the applications that embedded the library. A default folder plus `modelBaseUrl` is explicit.

### D26. `three` as a peer dependency, plus a standalone bundle

**Why.** Two copies of three.js in an application break `instanceof` checks and double the
download; a peer dependency shares the app's copy. Plain pages without a bundler get
`body3d.standalone.js` with three.js inside.

### D27. Accessibility and internationalization in the core

**Choice.** An `aria-label` that lists what is active, labelled controls, reduced motion honoured,
English and Portuguese built in, overridable strings.

**Why.** A canvas is opaque to assistive technology; the activation list is the content. Labels
were Portuguese-only before 0.2; the library is now English-first for an international audience,
with the original language kept.

## Views

### D28. Views as data relative to the body

**Choice.** `{ yaw, pitch, zoom, focus }` relative to the body box and the frame-filling distance.

**Why.** A stored view must survive a model switch, an FFMI change and another viewport; camera
positions do not.

### D29. The automatic view by rendering

See [views.md](views.md): counting visible pixels per group in the picking buffer accounts for
occlusion, poses and shape; normalizing per group stops large muscles from out-voting small ones
(the first version sent lateral raises to the back); activation² lets secondary muscles break ties
only. Evaluated on 372 exercises, reviewed visually by the author only; an agreement study with
people who teach exercise is prepared, not yet run ([validation/studies.md](validation/studies.md#3-the-automatic-view)).

### D30. A split view instead of a second viewer

**Why.** Opposite sides must stay opposite while the person orbits; two viewers would load two
models and need cross-wiring. One renderer, two cameras and two scissor passes cost +1.2 ms per
frame.

## Tape-measure fit

### D31. The tape as the perimeter of a convex hull

**Alternatives.** Section perimeter (follows concavities a tape bridges); a fitted ellipse or
circle (overestimates oval sections).

**Why.** A tape is the convex hull of the cross-section. Its derivative is analytic (the hull's
vertex set is locally constant), so the fit is a smooth least-squares problem almost everywhere.

### D32. Material points rather than re-slicing the mesh

**Why.** Re-slicing 380 k triangles per iteration is too slow in a browser. Points where edges cross
the plane in a reference shape move linearly with the weights; checked against true sections over
the plausible range (worst 0.0–2.9 % by site).

### D33. An exact volume polynomial

**Why.** The muscle volume of a mesh with vertices affine in the weights is a cubic polynomial;
exporting its coefficients (≈ 500 monomials) makes the volume constraint exact and differentiable
at no cost.

### D34. Total muscle conserved by a volume term

**Problem.** Tapes say where muscle is; FFMI how much. They must agree.

**Choice.** A residual tying the model's muscle volume to the volume of the typical body of the
fitted FFMI (±1 %), with the FFMI itself a free parameter held by its own measurement.

**Why.** It is what makes a big thigh take muscle from the rest when the body fat measure is
precise, and raise the FFMI when it is not — both observed in the tests.

### D35. A population prior calibrated on ANSUR II

**Alternatives.** An uninformed prior (each region independent: an arm tape says nothing about the
forearm); a hand-set correlation structure.

**Choice.** The typical body per FFMI and the covariance between regions learnt from 6 068
measured adults, noise of tape and fat removed, projected to positive definite.

**Why.** It transfers information from measured regions to unmeasured ones with real
correlations, and replaced appearance-tuned proportions by measured ones (the male arm went from
51 cm of muscle at FFMI 26 to ANSUR's curve). Validated out of sample ([validation](validation/ansur-holdout.md)).

**Limits found.** ANSUR II measures the limbs on one side: both sides are tied by an *assumed*
between-side deviation of 2 % of the girth, and a synthetic left–right difference is reproduced
at 80–85 % (men) and 48–66 % (women). Against a ridge regression on the same inputs, the fit is
within 0.1 cm with height, weight and body fat only, and 0.2–0.3 cm behind on the limbs when all
other tapes are given: the prior carries muscle covariance only, while fat and skeletal breadth
also co-vary between sites.

### D36. Population spread ×3

**Evidence.** On ANSUR II, spreads 1, 2 and 3 move each predicted tape by ≤ 0.2 cm; 2 is
marginally best. 3 is kept as a design choice: robustness for a population more varied than
soldiers, at ≤ 0.2 cm. The motivation is anecdotal — during development, with spread 1, one real
training body (a thigh 15 % above typical) was flagged as an outlier — and untested on trained
people; [validation/studies.md](validation/studies.md#2-a-trained-population) describes the study
that would settle it.

### D37. Trunk sites as ratios

**Evidence.** Fitting shoulders, chest and hips in absolute value drove the deltoids to the minimum
and the glutes to the maximum: those girths carry skeletal breadth and fat shape. As ratios over
the population mean, the model's own systematic offsets cancel.

### D38. Skinfolds from total body fat

**Why.** Few people measure skinfolds; total body fat is common. The estimate reproduces Lee et
al.'s means within 3 mm; its ~20 % individual variation enters each measure's uncertainty, and the
residual a site cannot explain with muscle goes back to that site's fat.

### D39. Height scaling through lean mass

**Why.** Geometric similarity would give a short, muscular person a thin model. Scaling by the
ratio of lean masses at the normalized FFMI keeps the girth–muscle relation the FFMI implies.

### D40. Huber loss and leave-one-out outliers on population deviations

**Why.** A single typo must not deform the body, and a real outlier body must not be "corrected".
Huber reduces a bad tape's pull during the fit; the leave-one-out test with the *population*
deviation (not the fit's) separates an implausible tape (52 cm calf on a lean body) from an unusual
body (a large thigh). Typos outside physical ranges never enter.

### D41. Calibration keyed by a fingerprint

**Why.** A calibration is a function of the exact fit data of a model; a rebuilt model with stale
calibration would silently draw wrong bodies. Keying by a hash of the fit data makes the mismatch
detectable (the tests fail).

## Engineering

### D42. Deterministic, self-checking pipeline

**Why.** Rebuilding must not change what was validated. Seeded sampling, sorted iteration and
build-time checks (names, sides, segments, morph sums, displacement caps) make a rebuild either
identical or loud. The 0.2 refactor was verified by byte-identical binary chunks.

### D43. Pure modules tested in Node, the rest by pixels

**Why.** Fit, activations, views, best-view scoring and the model contract are pure and fast to
test (111 tests, ~1 s). Rendering is verified by deterministic screenshots under SwiftShader
(`dev/snapshots.mjs`): the 0.2 refactor reproduced 17 scenarios pixel for pixel.

### D44. Plain JavaScript with type declarations

**Why.** No build step for contributors or for applications bundling the source; `index.d.ts`
(checked by `tsc` and by a test that compares it with the runtime exports) gives editors and
TypeScript users the API.

### D45. Generated files committed

**Why.** `catalog.generated.js` (from `anatomy.py`) and `calibration.generated.js` (from ANSUR II,
which is not redistributed) let the library build without Python or the dataset; both are
regenerated by documented commands and guarded by tests.

## Open questions

Studied but not done — candidates for future work:

- **Studies with people** ([validation/studies.md](validation/studies.md)): both sides of the
  limbs, a trained population with measured body fat (and the population spread), and the agreement
  of coaches with the automatic view. Protocols and analysis scripts are ready.
- **Correlated fat residuals in the fit**: a ridge regression beats the fit by 0.2–0.3 cm per limb
  when every tape is given, largely because fat and skeletal breadth co-vary between sites (a
  large hip predicts a large thigh). A covariance of the per-site fat deviations, learnt on ANSUR II
  like the muscle one, would let the fit use it.
- **Quadriceps heads**: BodyParts3D's rectus femoris is about twice its MRI share of the
  quadriceps and the vastus intermedius about 0.6 of it (the group as a whole is plausible —
  [validation/anatomy-checks.md](validation/anatomy-checks.md#3-muscle-volumes-against-mri)).
  Correcting it would need re-segmenting the source meshes.
- **The views stored in a catalog** are computed by `bestView()` on one model version: the views
  of the Trace catalog predate the ANSUR II recalibration; today 27 of 372 exercises get another
  azimuth, mostly a flip between the mirror-image front 3/4 views ([views.md](views.md)). Re-run
  `dev/evaluate-views.mjs --write` after a model change, and look at the pictures. A tie-break
  towards one side would make mirror flips deterministic.

- **Per-muscle shape** instead of per-region: bicep vs triceps, gluteus medius vs maximus. Needs
  more morph targets (or a learned basis) and more tapes than people record.
- **Skinfold input**: would separate fat from muscle per site and sharpen the female calibration,
  whose noise model currently absorbs the observed variance.
- **A fat and skin layer**: the model shows muscle; a translucent envelope from the fitted fat
  would show the person's silhouette.
- **Skeletal proportions per person** (arm length, shoulder breadth) from more measurements.
- **Activation data**: the training groups map names to structures; EMG-derived intensities per
  exercise phase would make the colours quantitative.
- **More poses and animation** (exercise movements), using the existing rig.
- **Mobile GPU measurements**: performance was measured on a desktop GPU and with CPU rendering;
  phones sit between.
- **Optional meshopt compression** for applications whose CSP allows WebAssembly (smaller files;
  to be measured).
- **Keyboard navigation** of muscles (focus a part, read its label) for accessibility beyond the
  activation summary.
