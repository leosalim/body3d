/**
 * BodyViewer — the 3D muscle-activation viewer.
 *
 * It owns a canvas inside a container element, loads one body model (GLB built by the
 * pipeline), colours muscles by activation, lets the person orbit, zoom and tap muscles, and
 * shapes the body to an FFMI or to tape measures. Everything else lives in small modules:
 *
 *   loader.js      model files and cache          activation.js  names → part values
 *   stage.js       renderer, lights, ground       material.js    shading, part texture, skinning
 *   views.js       camera views as data           best-view.js   automatic default view
 *   picking.js     GPU picking pass               split-view.js  side-by-side opposite view
 *   posing.js      poses and ground contact       shape.js       FFMI / tape-fit morph weights
 *   rings.js       tape rings                     dom.js         tooltip, buttons, credit
 *   breath.js      breathing shell and its timing
 *
 * Events (it is an EventTarget): `load`, `error`, `select` and `hover` (detail = partInfo or
 * null), `split` (detail = on), `viewchange` (detail = getView()), `fit` (detail = bodyFit),
 * `breath` (detail = the phase that starts, see breathAt).
 */
import { Vector2, Vector3, Box3, Group, WebGLRenderTarget, Spherical } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

import { createBodyMaterial, createPartTexture, createPickMaterial, DEFAULT_COLORS, setMaterialColors } from './material.js'
import { resolveActivations } from './activation.js'
import { groupLabel, partLabel } from './anatomy.js'
import { POSES } from './poses.js'
import { resolveLocale, stringsFor, format, localized } from './i18n.js'
import { VIEWS, FRONT_VIEW, toViewSpec, viewPose, viewFromCamera, fitDistance } from './views.js'
import { computeBestView } from './best-view.js'
import { renderIds } from './picking.js'
import { SplitView } from './split-view.js'
import { PoseRig, blendPoses, poseDistance } from './posing.js'
import { breathAt, createBreathShell, disposeBreathShell, normalizeBreath, updateBreathShell } from './breath.js'
import { BodyShape } from './shape.js'
import { createRing, disposeRing, ringBone } from './rings.js'
import { DEFAULT_MODEL_BASE_URL, cloneModel, loadModel, modelUrl, pickLod } from './loader.js'
import { createCamera, createGround, createRenderer, createScene, disposeGround, fitGround, fitGroundToBox } from './stage.js'
import { smoothstep, easeOutCubic, progress } from './tween.js'
import {
  createCanvas, createCredit, createFallback, createSplitButton, createTooltip, fillTooltip, placeTooltip,
  setSplitButtonState
} from './dom.js'

export { VIEWS, DEFAULT_MODEL_BASE_URL }

/** Options and their defaults (see docs/api.md). */
export const DEFAULTS = Object.freeze({
  model: 'male',              // 'male' | 'female'
  lod: 'auto',                // 'auto' | 'high' | 'lite'
  modelBaseUrl: null,         // folder with male.glb, female.glb, *-lite.glb (default /body3d/models/)
  modelUrl: null,             // explicit URL (overrides model, lod and modelBaseUrl)
  activations: [],
  aliases: null,              // extra names for activations: { name: otherName | { target: weight } }
  view: 'front',              // preset, [x, y, z], { yaw, pitch, zoom, focus } or 'auto'
  locale: 'en',               // 'en' | 'pt-BR' (labels and interface text)
  strings: null,              // interface text overrides: { [locale]: { key: text } }
  background: null,           // null = transparent (the page decides)
  colors: {},                 // any of DEFAULT_COLORS
  interactive: true,
  hover: true,                // highlight the part under the mouse
  tooltip: true,              // built-in label on tap / hover
  showBones: true,
  autoRotate: false,
  transitionMs: 350,
  credit: true,               // BodyParts3D credit (CC BY 4.0 requires attribution)
  pixelRatio: null,           // null = min(devicePixelRatio, 2)
  pose: null,                 // id of a pose of POSES[sex], or a pose { joints, ground, frame } (null = standing)
  breath: null,               // breathing shell { center, radius, inhale, holdIn, exhale, holdOut, color } (null = none)
  ffmi: null,                 // the person's normalized FFMI (null = the model default)
  body: null,                 // the person's measures for the fit (see setBody); wins over ffmi
  measureRings: false,        // draw the tape of every measure the fit used
  split: false,               // start with the split view
  splitButton: true           // corner button that toggles the split view
})

const POSE_MS = 700         // a small change of pose; a large one (standing to lying) takes up to POSE_MS_MAX
const POSE_MS_MAX = 1600
const VIEW_MS = 650
const STALL_MS = 120        // a frame longer than this pauses the running transitions (see _tick)

export class BodyViewer extends EventTarget {
  /**
   * @param {HTMLElement} container  receives a <canvas> filling it; give it a size
   * @param {Partial<typeof DEFAULTS>} [options]
   */
  constructor(container, options = {}) {
    super()
    this.options = { ...DEFAULTS, ...options }
    this.container = container
    this.parts = []
    this.joints = []
    this.meta = null
    this.bones = {}
    this.unknown = []
    this._values = new Float32Array(0)   // shown activation per part
    this._target = new Float32Array(0)   // where the transition goes
    this._from = new Float32Array(0)
    this._hovered = -1
    this._selected = -1
    this._dirty = true
    this._disposed = false
    this._loadToken = 0
    this._listeners = new AbortController()
    this._locale = resolveLocale(this.options.locale, this.options.strings ?? {})
    this.strings = stringsFor(this._locale, this.options.strings ?? {})

    // reduced motion: no transitions, no auto-rotation
    this._reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    if (this._reducedMotion) {
      this.options.transitionMs = 0
      this.options.autoRotate = false
    }

    this._setupDom()
    try {
      this._setupThree()
    } catch (err) {
      // no WebGL (old browser, blocked GPU): a message in place of the canvas
      this._failed = true
      this.canvas.remove()
      this.fallback = createFallback(container, this.strings.noWebgl)
      this.ready = Promise.reject(err)
      this.ready.catch(() => {})
      queueMicrotask(() => this.dispatchEvent(new CustomEvent('error', { detail: err })))
      return
    }
    this._setupControls()
    this._raf = requestAnimationFrame(this._tick)
    this.ready = this.setModel(this.options.model, { initial: true })
    if (this.options.split) this.setSplit(true)
  }

  // ------------------------------------------------------------------ setup
  _setupDom() {
    const c = this.container
    if (getComputedStyle(c).position === 'static') c.style.position = 'relative'
    this.canvas = createCanvas(c)
    this.canvas.setAttribute('aria-label', this.strings.modelLabel)
    this.tip = createTooltip(c)
    if (this.options.credit) this.credit = createCredit(c)
    if (this.options.splitButton) {
      this.splitButton = createSplitButton(c, () => this.setSplit(!this.split))
      this._labelSplitButton()
    }
    this._ro = new ResizeObserver(() => this.resize())
    this._ro.observe(c)
  }

  _setupThree() {
    const o = this.options
    this.renderer = createRenderer(this.canvas, o.pixelRatio)
    this.scene = createScene(this.renderer, o.background)
    this.camera = createCamera()
    this.root = new Group()
    this.scene.add(this.root)
    this.ground = createGround()
    this.scene.add(this.ground)
    this.pickTarget = new WebGLRenderTarget(1, 1)
    this._pickBuf = new Uint8Array(4)
  }

  _setupControls() {
    const c = new OrbitControls(this.camera, this.canvas)
    this._configureControls(c)
    c.enableDamping = true
    c.dampingFactor = 0.09
    c.autoRotate = !!this.options.autoRotate
    c.addEventListener('change', () => {
      this._clampTarget()
      this._splitView?.follow(c)
      this._dirty = true
    })
    c.addEventListener('start', () => { this._cancelViewAnim(); this._userMoved = true })
    c.addEventListener('end', () => this._emitViewChange())
    this.controls = c

    // pointer events reach the container: from the canvas or, when split, from the two panes
    const el = this.container
    const signal = this._listeners.signal
    const onSurface = (e) => e.target === this.canvas || e.target?.classList?.contains('b3d-pane')
    let down = null
    el.addEventListener('pointerdown', (e) => {
      down = onSurface(e) ? { x: e.clientX, y: e.clientY, t: performance.now() } : null
    }, { signal })
    el.addEventListener('pointerup', (e) => {
      if (!down || !this.options.interactive) return
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y)
      if (moved < 6 && performance.now() - down.t < 500) this._onTap(e)   // a tap, not a drag
      down = null
    }, { signal })
    el.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || !this.options.hover || !this.options.interactive || e.buttons) return
      if (onSurface(e)) this._pendingHover = e
    }, { signal })
    el.addEventListener('pointerleave', () => { this._pendingHover = null; this._setHover(-1) }, { signal })
    el.addEventListener('dblclick', (e) => { if (onSurface(e)) this.setView(this._lastView ?? 'front') }, { signal })
  }

  _configureControls(c) {
    c.rotateSpeed = 0.8
    c.screenSpacePanning = true
    c.minPolarAngle = 0.02
    c.maxPolarAngle = Math.PI - 0.02
    c.autoRotateSpeed = 1.2
    c.enabled = this.options.interactive
    if (this.bodySize) {
      c.minDistance = this.bodySize.y * 0.25
      c.maxDistance = this.bodySize.y * 4
    }
  }

  _emitViewChange() {
    this.dispatchEvent(new CustomEvent('viewchange', { detail: this.getView() }))
  }

  // ------------------------------------------------------------------ locale
  /** Current locale ('en', 'pt-BR' or one added through `strings`). */
  get locale() {
    return this._locale
  }

  /** Switches labels and interface text ('en', 'pt-BR'…). */
  setLocale(locale) {
    this._locale = resolveLocale(locale, this.options.strings ?? {})
    this.options.locale = this._locale
    this.strings = stringsFor(this._locale, this.options.strings ?? {})
    if (this.fallback) this.fallback.textContent = this.strings.noWebgl
    this._labelSplitButton()
    this._splitView?.setStrings(this.strings)
    this._describe()
    this.tip.style.display = 'none'
    return this
  }

  _labelSplitButton() {
    if (!this.splitButton) return
    this.splitButton.title = this.strings.splitTitle
    this.splitButton.setAttribute('aria-label', this.strings.splitAria)
  }

  // ------------------------------------------------------------------ split
  /** Is the screen split (current view | opposite side)? */
  get split() {
    return !!this._splitView
  }

  /** Shows the opposite side next to the current view (see split-view.js). */
  setSplit(on) {
    on = !!on
    if (on === this.split || this._failed) return this
    this.options.split = on
    this.tip.style.display = 'none'
    if (on) {
      this._splitView = new SplitView(this)
      this.resize()
      this._splitView.follow(this.controls)
    } else {
      this._splitView.dispose()
      this._splitView = null
      this.resize()
    }
    if (this.splitButton) setSplitButtonState(this.splitButton, on)
    if (!this._userMoved && this.bodyCenter) this.setView(this.options.view, { animate: false })
    this._dirty = true
    this.dispatchEvent(new CustomEvent('split', { detail: on }))
    return this
  }

  // ------------------------------------------------------------------ model
  /**
   * Loads a model ('male' | 'female'); camera, activations and — if the other model has it —
   * the pose are kept.
   * @returns {Promise<void>}
   */
  async setModel(model, { initial = false } = {}) {
    const o = this.options
    o.model = model
    if (this._failed) return
    const lod = pickLod(o.lod)
    const url = o.modelUrl ?? modelUrl(model, lod, o.modelBaseUrl)
    const token = ++this._loadToken
    this._loading = true
    try {
      const gltf = await loadModel(url)
      if (token !== this._loadToken || this._disposed) return
      this._loading = false
      this._install(gltf)
      // the requested pose holds if this model has it; otherwise standing
      if (typeof o.pose === 'string' && !this.poses.some((p) => p.id === o.pose)) {
        console.warn('[body3d] no such pose on this model, standing instead:', o.pose)
        o.pose = null
      }
      this.setPose(o.pose, { animate: false })
      this.setBreath(o.breath)
      this.setActivations(o.activations, { animate: false })
      if (initial || !this._userMoved) this.setView(o.view, { animate: false })
      this.dispatchEvent(new CustomEvent('load', { detail: { model, lod, url, meta: this.meta } }))
    } catch (err) {
      if (token === this._loadToken) this._loading = false
      console.error('[body3d] could not load the model', url, err)
      this.dispatchEvent(new CustomEvent('error', { detail: err }))
      throw err
    }
  }

  _install(gltf) {
    this._disposeModel()
    const scene = cloneModel(gltf)   // the parsed GLB stays cached; every viewer gets its own copy
    const data = gltf.userData
    this.meta = data
    this.parts = data.parts
    this.joints = data.joints
    this.partTex = createPartTexture(this.parts)
    this.material = createBodyMaterial(this.partTex, this.options.colors)
    this.pickMaterial = createPickMaterial(this.partTex)
    this.material.userData.uniforms.dimAmount.value = this._focus ?? 0
    this.meshes = []
    this.skeletonMeshes = []
    this.bones = {}
    scene.traverse((o) => {
      if (o.isSkinnedMesh) {
        o.material = this.material
        o.frustumCulled = false
        this.meshes.push(o)
        if (o.name.startsWith('skeleton')) this.skeletonMeshes.push(o)
      }
      if (o.isBone) this.bones[o.name] = o
    })
    for (const m of this.skeletonMeshes) m.visible = this.options.showBones
    this._shape = new BodyShape(this.meshes, data.body)
    this._weightAnim = null
    this.model = scene
    this.root.add(scene)

    const n = this.parts.length
    const keep = this._target.length === n
    this._values = keep ? this._values : new Float32Array(n)
    this._target = keep ? this._target : new Float32Array(n)
    this._from = new Float32Array(n)
    this._hovered = this._selected = -1
    this._poseFrame = null
    this._frame()
    this._rig = new PoseRig(this.bones, this.skeletonMeshes, this.root, this.meshes)
    this._writeTexture()
    this._applyBody({ animate: false })
  }

  /** Body box from the skinned skeleton in the rest pose; sets the zoom limits and the ground. */
  _frame() {
    const box = new Box3()
    for (const mesh of this.skeletonMeshes.length ? this.skeletonMeshes : this.meshes) {
      mesh.updateMatrixWorld(true)
      mesh.skeleton.update()
      mesh.computeBoundingBox()
      box.union(mesh.boundingBox.clone().applyMatrix4(mesh.matrixWorld))
    }
    this._restFrame = { box, center: box.getCenter(new Vector3()), size: box.getSize(new Vector3()) }
    this._applyFrame()
  }

  /**
   * Makes the rest frame or a posed body's frame current: the view math, the zoom limits, the
   * orbit target's bounds and the ground shadow follow it. A posed frame is a cube as wide as the
   * pose's longest side, so a body lying down is framed from any side.
   */
  _applyFrame() {
    const f = this._poseFrame ?? this._restFrame
    this.bodyBox = f.box
    this.bodyCenter = f.center
    this.bodySize = f.size
    for (const c of [this.controls, this._splitView?.controls]) {
      if (!c) continue
      c.minDistance = this.bodySize.y * 0.25
      c.maxDistance = this.bodySize.y * 4
    }
    if (this._poseFrame) fitGroundToBox(this.ground, this._poseFrame.box)
    else fitGround(this.ground, this.bodySize)
  }

  /** The body frame the view math works in: box centre and size, camera fov. */
  get _bodyFrame() {
    return { center: this.bodyCenter, size: this.bodySize, fov: this.camera.fov }
  }

  /** Keeps the orbit target inside the body box (panning cannot lose the body). */
  _clampTarget() {
    if (!this.bodyBox) return
    const t = this.controls.target
    const clamped = t.clone().clamp(this.bodyBox.min, this.bodyBox.max)
    if (!clamped.equals(t)) {
      const d = clamped.sub(t)
      t.add(d)
      this.camera.position.add(d)
    }
  }

  // ------------------------------------------------------------ activations
  /**
   * Sets the activations, replacing the previous ones (an empty list = rest).
   * @param {import('./activation.js').Activation[]} list
   */
  setActivations(list, { animate = true } = {}) {
    this.options.activations = list ?? []
    this._describe()
    if (!this.parts.length) return this
    const { values, unknown } = resolveActivations(this.options.activations, this.parts, { aliases: this.options.aliases })
    this.unknown = unknown
    if (unknown.length) console.warn('[body3d] unknown muscles:', unknown.join(', '))
    this._from.set(this._values)
    this._target = values
    if (animate && this.options.transitionMs > 0) {
      this._anim = { t0: performance.now(), ms: this.options.transitionMs }
    } else {
      this._values.set(values)
      this._anim = null
      this._writeTexture()
    }
    this._dirty = true
    return this
  }

  /** Accessible label of the canvas: what is active, strongest first, as the page named it. */
  _describe() {
    if (!this.canvas) return
    const items = [...this.options.activations]
      .filter((a) => a && Number(a.activation) > 0)
      .sort((a, b) => b.activation - a.activation)
      .map((a) => `${a.muscle ?? a.name ?? a.id} ${Math.round(Math.min(100, a.activation))}%`)
    this.canvas.setAttribute('aria-label',
      items.length ? format(this.strings.modelLabelActive, { list: items.join(', ') }) : this.strings.modelLabelRest)
  }

  /** Current activation (0–100) of a part by index. */
  activationOf(index) {
    return Math.round((this._target[index] ?? 0) * 100)
  }

  /** Dims what is not active (0 = off, 1 = strong). */
  setFocus(amount) {
    this._focus = amount
    if (this.material) this.material.userData.uniforms.dimAmount.value = amount
    this._writeTexture()
    return this
  }

  /** Changes colours (any of DEFAULT_COLORS) without reloading. */
  setColors(colors) {
    this.options.colors = { ...this.options.colors, ...colors }
    if (this.material) setMaterialColors(this.material, this.options.colors)
    if (this._shape) this._updateRings()
    this._dirty = true
    return this
  }

  /** Writes the part texture: R activation, G highlight, B dimmed (see material.js). */
  _writeTexture() {
    if (!this.partTex) return
    const d = this.partTex.image.data
    const anyActive = this._target.some((v) => v > 0)
    for (let i = 0; i < this.parts.length; i++) {
      d[i * 4] = Math.round(Math.min(1, this._values[i]) * 255)
      d[i * 4 + 1] = i === this._selected ? 255 : i === this._hovered ? 128 : 0
      d[i * 4 + 2] = anyActive && this._target[i] <= 0 && this.parts[i].kind === 'muscle' ? 255 : 0
    }
    this.partTex.needsUpdate = true
    this._dirty = true
  }

  // ----------------------------------------------------- FFMI and tape fit
  /** Drawable range of the loaded model, `{ min, max, default }`, in normalized FFMI. */
  get ffmiRange() {
    return this._shape?.range ?? null
  }

  /** Normalized FFMI the body is drawn at (the fitted one when there are measures). */
  get ffmi() {
    if (this._drawnFfmi != null) return this._drawnFfmi
    const r = this.ffmiRange
    if (!r) return null
    const v = this.options.ffmi ?? r.default
    return Math.min(r.max, Math.max(r.min, v))
  }

  /**
   * Draws the typical body of a normalized FFMI (FFMI + 6.1 × (1.8 − height)); outside the
   * model's range it stays at the limit. `null` returns to the model default. Drops the measures
   * of setBody.
   */
  setFfmi(value, { animate = true } = {}) {
    this.options.ffmi = value == null || !Number.isFinite(Number(value)) ? null : Number(value)
    this.options.body = null
    this._applyBody({ animate })
    return this
  }

  /**
   * Fits the body to a person's measures (fit.js): every region grows or shrinks to the measured
   * tape girth while the total muscle stays that of the FFMI — a region that measures more than
   * expected takes muscle from the others.
   *
   *   viewer.setBody({ sex: 'male', heightCm: 178, weightKg: 82, bodyFatPercent: 14, bodyFatMethod: 'BIA',
   *                    ffmi: 22.6, girths: { RIGHT_BICEP: 39, LEFT_THIGH: 60, NECK: 39 } })
   *
   * `girths` are in cm, keyed by the tape-site codes of anthro.js TAPE_SITES. `null` returns to
   * the typical body of the FFMI. The result is in `bodyFit` and in the `fit` event.
   */
  setBody(input, { animate = true } = {}) {
    this.options.body = input ?? null
    if (input?.ffmi != null) this.options.ffmi = input.ffmi
    this._applyBody({ animate })
    return this
  }

  /** Result of the last tape-measure fit (null without measures). */
  get bodyFit() {
    return this._bodyFit ?? null
  }

  /** Fit data of the loaded model (prepareFitModel), for advanced use. */
  get fitModel() {
    return this._shape?.fitModel ?? null
  }

  /** Weight of each region (`{ upperarm_l: 0.4, … }`); 0 = the model's minimum FFMI, 1 = maximum. */
  get regionWeights() {
    const regions = this.meta?.body?.regions ?? []
    const w = this._shape?.weights
    return Object.fromEntries(regions.map((r, i) => [r, w?.[i] ?? 0]))
  }

  /** Sets region weights directly (`{ region: weight }` or an array in the order of `regions`). */
  setRegionWeights(weights, { animate = true } = {}) {
    if (!this._shape) return this
    const regions = this.meta?.body?.regions ?? []
    const list = Array.isArray(weights) || ArrayBuffer.isView(weights)
    const w = Float64Array.from(regions, (r, i) => (list ? weights[i] : weights?.[r]) ?? 0)
    this._animateWeights(w, animate)
    return this
  }

  /** Shows (or hides) the tape of every measure the fit used. */
  setMeasureRings(on) {
    this.options.measureRings = !!on
    this._updateRings()
    return this
  }

  _applyBody({ animate }) {
    if (!this._shape) return
    const { weights, fit, ffmi } = this._shape.resolve({ ffmi: this.options.ffmi, body: this.options.body })
    this._bodyFit = fit
    this._drawnFfmi = ffmi
    this._animateWeights(weights, animate)
    if (fit) this.dispatchEvent(new CustomEvent('fit', { detail: fit }))
  }

  _animateWeights(to, animate) {
    const from = this._shape.weights
    const moving = from && from.length === to.length && to.some((x, i) => Math.abs(x - from[i]) > 1e-4)
    if (animate && moving && !this._reducedMotion && this.options.transitionMs > 0) {
      this._weightAnim = { t0: performance.now(), ms: this.options.transitionMs * 1.6, from: Float64Array.from(from), to }
      this._clearRings()
    } else {
      this._weightAnim = null
      this._shape.set(to)
      this._dirty = true
      this._updateRings()
    }
  }

  _clearRings() {
    for (const m of this._ringMeshes ?? []) disposeRing(m)
    this._ringMeshes = []
    this._dirty = true
  }

  /** Rings are left out of picking passes (they have no part index). */
  get _rings() {
    return this._ringMeshes ?? []
  }

  _updateRings() {
    this._clearRings()
    const fit = this._bodyFit
    const fitModel = this.fitModel
    if (!this.options.measureRings || !fit || !fitModel || !this._shape?.weights) return
    const colors = { ...DEFAULT_COLORS, ...this.options.colors }
    const joints = Object.fromEntries((this.joints ?? []).map((j) => [j.name, j.position]))
    for (const s of fit.sites) {
      if (s.status !== 'ok' && s.status !== 'outlier') continue
      const bone = this.bones[ringBone(s.site)]
      if (!bone) continue
      const color = s.status === 'outlier' ? colors.tapeOutlier : colors.tape
      const mesh = createRing(fitModel, s, fit.scale, this._shape.weights, joints[bone.name], color)
      if (!mesh) continue
      bone.add(mesh)
      this._ringMeshes.push(mesh)
    }
    this._dirty = true
  }

  // ------------------------------------------------------------------ poses
  /** Poses of the loaded model, `[{ id, label, view, activations, joints }]`, labels in the viewer's locale. */
  get poses() {
    return (POSES[this.meta?.sex] ?? []).map((p) => ({ ...p, label: localized(p.label, this._locale) }))
  }

  /** Current pose: an id of `viewer.poses`, the pose object given to setPose, or null. */
  get pose() {
    return this.options.pose
  }

  /**
   * Puts the body in a pose or standing (null). A pose is an id of `viewer.poses` or an object
   * `{ joints, ground, frame, view }`: `joints` in the format of src/poses.js, `ground: 'body'`
   * to rest it on its lowest point (a pose on hands, knees or the back; default the feet), and
   * `frame: 'pose'` (the default with `ground: 'body'`) to frame the camera on the posed body.
   * Activations are left alone; `poseActivations(pose)` gives a named pose's suggestion.
   * `view: true` also turns the camera to the pose's view, or re-frames the current one.
   */
  setPose(id, { animate = true, view = false } = {}) {
    if (this._loading || !this._rig) {
      // still loading: applies to the model that arrives (checked in setModel)
      this.options.pose = id || null
      return this
    }
    const given = id && typeof id === 'object' ? id : null
    const pose = given ?? (id ? this.poses.find((p) => p.id === id) : null)
    if (id && !pose) console.warn('[body3d] unknown pose for this model:', id)
    this.options.pose = given ?? (pose ? pose.id : null)
    const ground = pose?.ground === 'body' ? 'body' : 'feet'
    const target = this._rig.target(pose?.joints ?? {}, { ground })
    const from = this._rig.state()
    // a posed body is framed on itself; the box is padded for the flesh over the skeleton
    const framed = !!pose && (pose.frame ?? (ground === 'body' ? 'pose' : 'rest')) === 'pose'
    if (framed) {
      const box = this._rig.boxOf(target).expandByScalar(0.06)
      const size = box.getSize(new Vector3())
      const side = Math.max(size.x, size.y, size.z)
      this._poseFrame = { box, center: box.getCenter(new Vector3()), size: new Vector3(side, side, side) }
    } else this._poseFrame = null
    const before = this.bodyBox?.clone()
    this._applyFrame()
    let ms = 0
    if (animate && !this._reducedMotion && this.options.transitionMs > 0) {
      ms = POSE_MS + (POSE_MS_MAX - POSE_MS) * Math.min(1, poseDistance(from, target) / Math.PI)
      // resting on the body at either end: grounded again on every frame, so no limb goes
      // through the floor half way
      const live = ground === 'body' || this._ground === 'body'
      this._poseAnim = { t0: performance.now(), ms, from, to: target, ground: live ? 'body' : null }
      // on the way, the orbit target may be anywhere the body passes: the old box and the new
      if (before) this.bodyBox = this.bodyBox.clone().union(before)
    } else {
      this._poseAnim = null
      this._rig.apply(target)
    }
    this._ground = ground
    // the camera moves with the body, at its pace: the new frame is the pose's, and jumping to it
    // first would cut a standing body in half on its way down
    if (view) this.setView(pose?.view ?? this.options.view, ms ? { animate, ms, ease: smoothstep } : { animate })
    this._dirty = true
    return this
  }

  // ----------------------------------------------------------------- breath
  /** Current breathing spec (normalized), or null. */
  get breath() {
    return this._breathSpec ?? null
  }

  /**
   * Shows a breathing shell on the thorax (see breath.js) or removes it (null): a nearly
   * transparent sphere centred on `center` ({ bone, position } in the bone's frame) that fills
   * on `inhale`, holds, empties on `exhale` and holds again (seconds). Each phase that starts is
   * announced with a `breath` event; with reduced motion the shell stays still and silent.
   */
  setBreath(spec) {
    if (this._breathShell) {
      disposeBreathShell(this._breathShell)
      this._breathShell = null
    }
    this.options.breath = spec ?? null
    this._breathSpec = spec ? normalizeBreath(spec) : null
    this._breathPhase = null
    if (!this._breathSpec || !this.scene) return this
    this._breathShell = createBreathShell(this._breathSpec)
    this.scene.add(this._breathShell)
    this._breathT0 = performance.now()
    if (this.bones.chest) updateBreathShell(this._breathShell, this.bones, null)
    this._dirty = true
    return this
  }

  /** Where the breath is now (`breathAt`), or null without a breath or with reduced motion. */
  breathState(now = performance.now()) {
    if (!this._breathSpec || this._reducedMotion) return null
    return breathAt((now - this._breathT0) / 1000, this._breathSpec)
  }

  // ------------------------------------------------------------------ views
  /**
   * Turns the camera to a view: a preset name (see VIEWS), a direction [x, y, z], a saved view
   * `{ yaw, pitch, zoom, focus }` or 'auto' (bestView for the current activations).
   */
  setView(view, { animate = true, ms = VIEW_MS, ease = easeOutCubic } = {}) {
    this.options.view = view
    if (!this.bodyCenter) return this
    this._lastView = view
    this._userMoved = false
    if (this._reducedMotion) animate = false
    const { target, position } = viewPose(this._resolveView(view), this._bodyFrame, this.camera.aspect || 1)
    if (!animate) {
      this.controls.target.copy(target)
      this.camera.position.copy(position)
      this.controls.update()
      this._dirty = true
      return this
    }
    const a = {
      t0: performance.now(), ms, ease,
      fromT: this.controls.target.clone(), toT: target,
      fromS: new Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target)),
      toS: new Spherical().setFromVector3(position.clone().sub(target))
    }
    // shortest way round in azimuth
    while (a.toS.theta - a.fromS.theta > Math.PI) a.toS.theta -= 2 * Math.PI
    while (a.toS.theta - a.fromS.theta < -Math.PI) a.toS.theta += 2 * Math.PI
    this._viewAnim = a
    return this
  }

  /**
   * The current view as a spec to store and apply to another model or screen (see views.js).
   * When split, the view of the left half.
   */
  getView() {
    if (!this.bodyCenter) return null
    return viewFromCamera(this.camera.position, this.controls.target, this._bodyFrame, this.camera.aspect || 1)
  }

  /** Goes to the automatic view for the current activations (see bestView). */
  autoView({ animate = true } = {}) {
    this._autoCache = null
    return this.setView('auto', { animate })
  }

  _resolveView(view) {
    if (view === 'auto') {
      const key = this._activationKey()
      if (!this._autoCache || this._autoCache.key !== key) this._autoCache = { key, spec: this.bestView() }
      return this._autoCache.spec
    }
    return toViewSpec(view)
  }

  _activationKey() {
    let k = ''
    for (let i = 0; i < this._target.length; i++) if (this._target[i] > 0) k += `${i}:${this._target[i].toFixed(2)},`
    return k
  }

  /** Distance that frames the whole standing body for an aspect ratio. */
  _fitDistance(aspect) {
    return fitDistance(this._bodyFrame, aspect)
  }

  /**
   * The best view for the current activations, `{ yaw, pitch, zoom, focus }` (best-view.js).
   * About 0.1 s: sixteen small picking renders.
   */
  bestView() {
    const frame = this._bodyFrame
    if (!this.meshes?.length || !this.bodyCenter) return { ...FRONT_VIEW, focus: [...FRONT_VIEW.focus] }
    let rt = null
    let cam = null
    let buf = null
    const renderAt = (spec, W, H) => {
      if (!rt) {
        rt = new WebGLRenderTarget(W, H)
        cam = createCamera()
        cam.aspect = W / H
        cam.updateProjectionMatrix()
        buf = new Uint8Array(W * H * 4)
      }
      const { target, position } = viewPose(spec, frame, W / H)
      cam.position.copy(position)
      cam.lookAt(target)
      cam.updateMatrixWorld()
      renderIds(this.renderer, this.scene, cam, rt, { material: this.pickMaterial, hide: this._unpickable(), show: this.skeletonMeshes })
      this.renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf)
      return buf
    }
    try {
      return computeBestView({ parts: this.parts, activation: this._target, frame, renderIds: renderAt })
    } finally {
      rt?.dispose()
      this._dirty = true
    }
  }

  _cancelViewAnim() { this._viewAnim = null }

  setAutoRotate(on) {
    if (this.controls) this.controls.autoRotate = !!on && !this._reducedMotion
    this._dirty = true
    return this
  }

  setShowBones(on) {
    this.options.showBones = !!on
    for (const m of this.skeletonMeshes ?? []) m.visible = !!on
    this._dirty = true
    return this
  }

  // ---------------------------------------------------------------- picking
  /** Index of the part at a pixel (client coordinates), or -1. */
  pickAt(clientX, clientY) {
    if (!this.meshes?.length) return -1
    const rect = this.canvas.getBoundingClientRect()
    const dpr = this.renderer.getPixelRatio()
    let w = rect.width * dpr
    const h = rect.height * dpr
    let x = (clientX - rect.left) * dpr
    const y = (clientY - rect.top) * dpr
    if (x < 0 || y < 0 || x >= w || y >= h) return -1
    let cam = this.camera
    if (this._splitView) {
      w = w / 2
      if (x >= w) { x -= w; cam = this._splitView.camera }
    }
    cam.setViewOffset(w, h, Math.floor(x), Math.floor(y), 1, 1)
    try {
      renderIds(this.renderer, this.scene, cam, this.pickTarget, { material: this.pickMaterial, hide: this._unpickable() })
      this.renderer.readRenderTargetPixels(this.pickTarget, 0, 0, 1, 1, this._pickBuf)
    } finally {
      cam.clearViewOffset()
    }
    return this._pickBuf[0] + this._pickBuf[1] * 256 - 1
  }

  /**
   * What a part is: `{ index, id, muscle, side, kind, label, group, groupLabel, activation }`,
   * labels in the viewer's locale; null for an invalid index.
   */
  partInfo(index) {
    const p = this.parts[index]
    if (!p) return null
    return {
      index,
      id: p.id,
      muscle: p.base,
      side: p.side === 'l' ? 'left' : p.side === 'r' ? 'right' : null,
      kind: p.kind,
      label: partLabel(p, this._locale),
      group: p.group ?? null,
      groupLabel: p.group ? groupLabel(p.group, this._locale) : null,
      activation: this.activationOf(index)
    }
  }

  _onTap(e) {
    const i = this.pickAt(e.clientX, e.clientY)
    const soft = i >= 0 && (this.parts[i].kind === 'muscle' || this.parts[i].kind === 'tissue')
    this.select(soft ? i : -1)
    this._showTip(soft ? i : -1, e)
  }

  /** Selects a part (index) or clears the selection with -1. */
  select(index) {
    this._selected = index
    this._writeTexture()
    this.dispatchEvent(new CustomEvent('select', { detail: index >= 0 ? this.partInfo(index) : null }))
    return this
  }

  _setHover(i) {
    if (i === this._hovered) return
    this._hovered = i
    this._writeTexture()
    this.dispatchEvent(new CustomEvent('hover', { detail: i >= 0 ? this.partInfo(i) : null }))
  }

  _showTip(i, e) {
    if (!this.options.tooltip || i < 0) { this.tip.style.display = 'none'; return }
    fillTooltip(this.tip, this.partInfo(i), this.strings)
    placeTooltip(this.tip, this.container, e.clientX, e.clientY)
  }

  // ------------------------------------------------------------------- loop
  _tick = (now) => {
    if (this._disposed) return
    this._raf = requestAnimationFrame(this._tick)
    // a stalled frame (the first render compiles the shaders, a long task on the page) must not
    // eat a transition: what runs is pushed back by the stall, so it plays from where it was
    const gap = this._lastTick ? now - this._lastTick : 0
    this._lastTick = now
    if (gap > STALL_MS) {
      const lost = gap - 1000 / 60
      for (const a of [this._anim, this._weightAnim, this._poseAnim, this._viewAnim]) if (a) a.t0 += lost
      if (this._breathT0 != null) this._breathT0 += lost
    }
    if (this._anim) {
      const t = progress(now, this._anim)
      const k = smoothstep(t)
      for (let i = 0; i < this._values.length; i++) this._values[i] = this._from[i] + (this._target[i] - this._from[i]) * k
      if (t >= 1) this._anim = null
      this._writeTexture()
    }
    if (this._weightAnim) {
      const a = this._weightAnim
      const t = progress(now, a)
      const k = smoothstep(t)
      this._shape.set(a.to.map((x, i) => a.from[i] + (x - a.from[i]) * k))
      this._dirty = true
      if (t >= 1) {
        this._weightAnim = null
        this._updateRings()
      }
    }
    if (this._poseAnim) {
      const a = this._poseAnim
      const t = progress(now, a)
      if (t >= 1) {
        this._rig.apply(a.to)
        this._poseAnim = null
        this.bodyBox = (this._poseFrame ?? this._restFrame).box
      } else {
        const state = blendPoses(a.from, a.to, smoothstep(t))
        this._rig.apply(state)
        if (a.ground === 'body') this._rig.apply({ ...state, offset: this._rig.groundOffset('body') })
      }
      this._dirty = true
    }
    if (this._breathShell && this.model) {
      const b = this.breathState(now)
      updateBreathShell(this._breathShell, this.bones, b)
      if (b) {
        const key = `${b.cycle}:${b.index}`
        if (key !== this._breathPhase) {
          this._breathPhase = key
          this.dispatchEvent(new CustomEvent('breath', { detail: b }))
        }
        this._dirty = true
      } else if (this._poseAnim) this._dirty = true
    }
    if (this._viewAnim) {
      const a = this._viewAnim
      const t = progress(now, a)
      const k = a.ease(t)
      const s = new Spherical(
        a.fromS.radius + (a.toS.radius - a.fromS.radius) * k,
        a.fromS.phi + (a.toS.phi - a.fromS.phi) * k,
        a.fromS.theta + (a.toS.theta - a.fromS.theta) * k)
      this.controls.target.lerpVectors(a.fromT, a.toT, k)
      this.camera.position.setFromSpherical(s).add(this.controls.target)
      if (t >= 1) this._viewAnim = null
      this._dirty = true
    }
    if (this.controls.update()) this._dirty = true
    if (this._pendingHover) {
      const e = this._pendingHover
      this._pendingHover = null
      const i = this.pickAt(e.clientX, e.clientY)
      const soft = i >= 0 && this.parts[i].kind !== 'bone' && this.parts[i].kind !== 'cartilage'
      this._setHover(soft ? i : -1)
      if (this._selected < 0) this._showTip(soft ? i : -1, e)
    }
    this._splitView?.controls.update()
    if (this._dirty && this.model) {
      this._dirty = false
      this._render()
    }
  }

  _render() {
    const r = this.renderer
    if (!this._splitView) {
      r.render(this.scene, this.camera)
      return
    }
    const size = r.getSize(new Vector2())
    const half = Math.floor(size.x / 2)
    r.setScissorTest(true)
    r.setViewport(0, 0, half, size.y)
    r.setScissor(0, 0, half, size.y)
    r.render(this.scene, this.camera)
    r.setViewport(half, 0, size.x - half, size.y)
    r.setScissor(half, 0, size.x - half, size.y)
    r.render(this.scene, this._splitView.camera)
    r.setScissorTest(false)
    r.setViewport(0, 0, size.x, size.y)
  }

  /** Requests a frame (after posing bones by hand). */
  render() { this._dirty = true; return this }

  /** Adapts to the container size (a ResizeObserver calls it; call it after manual layout changes). */
  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight
    if (!w || !h || !this.renderer) return
    this.renderer.setSize(w, h, false)
    const aspect = this._splitView ? w / 2 / h : w / h
    for (const cam of [this.camera, this._splitView?.camera]) {
      if (!cam) continue
      cam.aspect = aspect
      cam.updateProjectionMatrix()
    }
    // until the person moves the camera, re-frame (the container may have loaded with no size —
    // a hidden tab, a late layout)
    if (!this._userMoved && this.bodyCenter) this.setView(this.options.view, { animate: false })
    this._dirty = true
  }

  /** What the picking pass must not draw: it carries no part index. */
  _unpickable() {
    return [this.ground, ...this._rings, ...(this._breathShell ? [this._breathShell] : [])]
  }

  /** PNG of the current frame (data URL). */
  snapshot() {
    this._render()
    return this.canvas.toDataURL('image/png')
  }

  _disposeModel() {
    if (!this.model) return
    this._clearRings()
    this.root.remove(this.model)
    this.material?.dispose()
    this.pickMaterial?.dispose()
    this.partTex?.dispose()
    this.model = null
    this.meshes = []
    this.skeletonMeshes = []
    this._shape = null
    this._rig = null
  }

  /** Frees the GPU resources, the DOM and the listeners. The viewer is unusable afterwards. */
  dispose() {
    if (this._disposed) return
    this._disposed = true
    cancelAnimationFrame(this._raf)
    this._ro.disconnect()
    this._listeners.abort()
    if (this._splitView) {
      this._splitView.dispose()
      this._splitView = null
    }
    if (this._breathShell) disposeBreathShell(this._breathShell)
    this.tip.remove()
    this.credit?.remove()
    this.fallback?.remove()
    this.splitButton?.remove()
    if (this._failed) return
    this._disposeModel()
    this.controls.dispose()
    this.pickTarget.dispose()
    disposeGround(this.ground)
    this.scene.environment?.dispose()
    this.renderer.dispose()
    this.canvas.remove()
  }
}
