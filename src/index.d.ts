// Type declarations for body3d. The library is plain JavaScript; these describe its public API.
// Reference with examples: docs/api.md.

import type { Bone, Mesh, Object3D, PerspectiveCamera, Quaternion, Scene, Vector3, WebGLRenderer } from 'three'

// ------------------------------------------------------------------ inputs

/** One activation: a name (training group, anatomical group or muscle) and a percentage 0–100. */
export interface Activation {
  muscle: string
  activation: number
  /** Restricts the activation to one side of the body. */
  side?: 'left' | 'right'
}

/** A saved camera view, relative to the body (see views.js). */
export interface ViewSpec {
  /** Degrees around the body: 0 front, 90 the body's left, 180 back, −90 the body's right. */
  yaw: number
  /** Degrees above the horizontal. */
  pitch: number
  /** 1 frames the whole standing body. */
  zoom: number
  /** Look-at point from the body centre, in body heights. */
  focus: [number, number, number]
}

export type ViewPreset = 'front' | 'back' | 'left' | 'right' | 'front-left' | 'front-right' | 'back-left' | 'back-right' | 'top'
/** A preset, a direction [x, y, z] from the target towards the camera, a saved view, or 'auto'. */
export type View = ViewPreset | [number, number, number] | ViewSpec | 'auto'

export type Locale = 'en' | 'pt-BR' | (string & {})
export type ModelName = 'male' | 'female'
export type TapeCode =
  | 'LEFT_BICEP' | 'RIGHT_BICEP' | 'LEFT_FOREARM' | 'RIGHT_FOREARM' | 'LEFT_THIGH' | 'RIGHT_THIGH'
  | 'LEFT_CALF' | 'RIGHT_CALF' | 'NECK' | 'SHOULDERS' | 'CHEST' | 'HIPS' | 'GLUTES' | 'WAIST' | 'ABDOMEN'
export type BodyFatMethod =
  | 'DEXA' | 'HYDROSTATIC' | 'BOD_POD' | 'SKINFOLD_7' | 'SKINFOLD_3' | 'BIA' | 'NAVY' | 'NAVY_TAPE' | 'VISUAL'

/** A person's measures for the tape-measure fit (viewer.setBody). */
export interface BodyInput {
  heightCm?: number
  weightKg?: number
  bodyFatPercent?: number
  bodyFatMethod?: BodyFatMethod | null
  /** Normalized FFMI, if already computed (it must match weight, height and body fat). */
  ffmi?: number
  /** Tape girths in cm. */
  girths?: Partial<Record<TapeCode, number>>
}

export type Aliases = Record<string, string | Record<string, number>>

export interface Colors {
  muscle: string; tissue: string; bone: string; cartilage: string
  low: string; mid: string; high: string; highlight: string; rim: string
  tape: string; tapeOutlier: string
}

export interface ViewerStrings {
  modelLabel: string; modelLabelActive: string; modelLabelRest: string; noWebgl: string
  splitTitle: string; splitAria: string; yourView: string; oppositeSide: string
  left: string; right: string; activation: string
}

export interface ViewerOptions {
  model: ModelName
  lod: 'auto' | 'high' | 'lite'
  modelBaseUrl: string | null
  modelUrl: string | null
  activations: Activation[]
  aliases: Aliases | null
  view: View
  locale: Locale
  strings: Record<string, Partial<ViewerStrings>> | null
  background: string | null
  colors: Partial<Colors>
  interactive: boolean
  hover: boolean
  tooltip: boolean
  showBones: boolean
  autoRotate: boolean
  transitionMs: number
  credit: boolean
  pixelRatio: number | null
  pose: string | PoseSpec | null
  breath: BreathSpec | null
  ffmi: number | null
  body: BodyInput | null
  measureRings: boolean
  split: boolean
  splitButton: boolean
}

// ------------------------------------------------------------------ outputs

/** A part of the loaded model (`viewer.parts`, from the GLB). */
export interface ModelPart {
  id: string
  base: string
  side: 'l' | 'r' | null
  kind: 'muscle' | 'tissue' | 'bone' | 'cartilage'
  label: string
  group?: string
  segment?: string
}

/** What `select`/`hover` report and `partInfo` returns; labels in the viewer's locale. */
export interface PartInfo {
  index: number
  id: string
  muscle: string
  side: 'left' | 'right' | null
  kind: ModelPart['kind']
  label: string
  group: string | null
  groupLabel: string | null
  activation: number
}

export interface FitSite {
  site: string | null
  codes: TapeCode[]
  measuredCm: number
  status: 'ok' | 'outlier' | 'invalid' | 'navy' | 'ignored'
  /** For 'ok' and 'outlier' sites: */
  fatMm?: number
  fatTypicalMm?: number
  correctedCm?: number
  expectedCm?: number
  fittedCm?: number
  muscleOnlyFitCm?: number
  z?: number
}

/** Result of the tape-measure fit (viewer.bodyFit, the `fit` event, fitBody()). */
export interface FitResult {
  weights: Float64Array
  ffmi: number
  ffmiMeasured: number | null
  bodyFat: { value: number; sd: number; source: 'measured' | 'navy'; method: string | null } | null
  scale: number
  sites: FitSite[]
  measured: number
  muscle: {
    volumeL: number
    targetL: number
    kg: number | null
    fractions: Record<string, number>
    groups: { arms: number; legs: number; trunk: number }
  }
  uncertainty: Float64Array
  iterations: number
  notes: string[]
}

export interface Pose {
  id: string
  label: string
  view: ViewPreset
  activations: Record<string, number>
  joints: Record<string, ['x' | 'y' | 'z', number][]>
}

/** A pose given by the page (setPose with an object): yoga poses, any staged position. */
export interface PoseSpec {
  joints: Record<string, ['x' | 'y' | 'z', number][]>
  /** What rests on the floor: the lowest foot (default) or the lowest point of the body. */
  ground?: 'feet' | 'body'
  /** Frame the camera on the posed body (default with ground 'body') or on the standing one. */
  frame?: 'pose' | 'rest'
  view?: View
}

/** A breathing pattern for the shell (seconds; the centre in a bone's frame, metres). */
export interface BreathSpec {
  center?: { bone: string; position: [number, number, number] }
  radius?: number
  inhale?: number
  holdIn?: number
  exhale?: number
  holdOut?: number
  color?: string
}

export type BreathPhase = 'inhale' | 'holdIn' | 'exhale' | 'holdOut'

export interface BreathState {
  phase: BreathPhase
  index: 0 | 1 | 2 | 3
  /** 0–1 within the phase. */
  t: number
  remaining: number
  duration: number
  cycle: number
  /** How full the lungs are, 0–1 (eased). */
  fill: number
}

export interface LoadDetail {
  model: ModelName
  lod: 'high' | 'lite'
  url: string
  meta: Record<string, unknown>
}

export interface BodyViewerEventMap {
  load: CustomEvent<LoadDetail>
  error: CustomEvent<unknown>
  select: CustomEvent<PartInfo | null>
  hover: CustomEvent<PartInfo | null>
  split: CustomEvent<boolean>
  viewchange: CustomEvent<ViewSpec>
  fit: CustomEvent<FitResult>
  breath: CustomEvent<BreathState>
}

// ------------------------------------------------------------------ viewer

export declare const DEFAULTS: Readonly<ViewerOptions>

export declare class BodyViewer extends EventTarget {
  constructor(container: HTMLElement, options?: Partial<ViewerOptions>)
  /** Resolves when the first model has loaded (rejects without WebGL or on a load error). */
  readonly ready: Promise<void>
  readonly options: ViewerOptions
  readonly container: HTMLElement
  readonly canvas: HTMLCanvasElement
  /** The split-view toggle button, when `splitButton` is on. */
  readonly splitButton?: HTMLButtonElement
  readonly parts: ModelPart[]
  readonly joints: { name: string; parent: string | null; position: [number, number, number]; axis?: [number, number, number] }[]
  readonly meta: Record<string, any> | null
  readonly bones: Record<string, Bone>
  /** Names of the last setActivations call that matched nothing. */
  readonly unknown: string[]
  readonly strings: ViewerStrings
  readonly renderer: WebGLRenderer
  readonly scene: Scene
  readonly camera: PerspectiveCamera

  setModel(model: ModelName): Promise<void>
  setActivations(list: Activation[] | null, options?: { animate?: boolean }): this
  activationOf(index: number): number
  setFocus(amount: number): this
  setColors(colors: Partial<Colors>): this

  readonly locale: Locale
  setLocale(locale: Locale): this

  readonly ffmiRange: { min: number; max: number; default: number } | null
  readonly ffmi: number | null
  setFfmi(value: number | null, options?: { animate?: boolean }): this
  setBody(input: BodyInput | null, options?: { animate?: boolean }): this
  readonly bodyFit: FitResult | null
  readonly fitModel: FitModel | null
  readonly regionWeights: Record<string, number>
  setRegionWeights(weights: Record<string, number> | ArrayLike<number>, options?: { animate?: boolean }): this
  setMeasureRings(on: boolean): this

  readonly poses: Pose[]
  readonly pose: string | PoseSpec | null
  setPose(pose: string | PoseSpec | null, options?: { animate?: boolean; view?: boolean }): this

  readonly breath: Required<BreathSpec> | null
  setBreath(spec: BreathSpec | null): this
  breathState(now?: number): BreathState | null

  setView(view: View, options?: { animate?: boolean }): this
  getView(): ViewSpec | null
  bestView(): ViewSpec
  autoView(options?: { animate?: boolean }): this

  readonly split: boolean
  setSplit(on: boolean): this
  setAutoRotate(on: boolean): this
  setShowBones(on: boolean): this

  pickAt(clientX: number, clientY: number): number
  partInfo(index: number): PartInfo | null
  select(index: number): this

  render(): this
  resize(): void
  snapshot(): string
  dispose(): void

  addEventListener<K extends keyof BodyViewerEventMap>(type: K, listener: (event: BodyViewerEventMap[K]) => void, options?: boolean | AddEventListenerOptions): void
  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void
  removeEventListener<K extends keyof BodyViewerEventMap>(type: K, listener: (event: BodyViewerEventMap[K]) => void, options?: boolean | EventListenerOptions): void
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void
}

export declare function createBodyViewer(container: HTMLElement, options?: Partial<ViewerOptions>): BodyViewer
export declare function defineBodyElement(tag?: string): CustomElementConstructor
export declare const DEFAULT_MODEL_BASE_URL: string
export declare function clearModelCache(): void
export declare const DEFAULT_COLORS: Readonly<Colors>
export declare const STRINGS: Record<'en' | 'pt-BR', ViewerStrings>
export declare const LOCALES: string[]

// ------------------------------------------------------------------ activations and anatomy

export type Label = { en: string; 'pt-BR': string }

export declare function resolveActivations(list: Activation[] | null, parts: Pick<ModelPart, 'base' | 'group' | 'side'>[], options?: { aliases?: Aliases | null }): { values: Float32Array; unknown: string[] }
export declare function fromExercise(
  exercise: { primaryMuscles?: (string | { name: string })[]; secondaryMuscles?: (string | { name: string })[] } | null,
  options?: { primary?: number; secondary?: number }
): Activation[]
export declare function targetsOf(name: string, aliases?: Aliases | null): Record<string, number> | null
export declare function normalizeName(name: string): string

export declare const AREAS: { id: string; label: Label }[]
export declare const GROUPS: { id: string; area: string; label: Label }[]
export declare const MUSCLES: { id: string; group: string; label: Label }[]
export declare const TISSUES: { id: string; label: Label }[]
export declare const REGIONS: { id: string; sided: boolean; groups: string[]; label: Label }[]
export declare const TRAINING_GROUPS: { id: string; label: Label; targets: Record<string, number> }[]
export declare function partLabel(part: Pick<ModelPart, 'base' | 'label'>, locale?: Locale): string | null
export declare function groupLabel(id: string, locale?: Locale): string | null

// ------------------------------------------------------------------ views and poses

export declare const VIEWS: Record<ViewPreset, [number, number, number]>
export declare const FRONT_VIEW: Readonly<ViewSpec>
export declare function toViewSpec(view: Exclude<View, 'auto'>): ViewSpec
export interface BodyFrame { center: Vector3; size: Vector3; fov: number }
export declare function viewPose(spec: Partial<ViewSpec>, frame: BodyFrame, aspect: number): { target: Vector3; position: Vector3 }
export declare function viewFromCamera(position: Vector3, target: Vector3, frame: BodyFrame, aspect: number): ViewSpec

export declare const BEST_VIEW_DEFAULTS: Readonly<{
  width: number; height: number; yaws: number[]; pitches: number[]; frontBonus: number; backBonus: number
  raisedPenalty: number; keyFraction: number; padding: number; fullBodyFraction: number; maxZoom: number; minZoom: number
}>
export declare function computeBestView(input: {
  parts: Pick<ModelPart, 'kind' | 'group' | 'base'>[]
  activation: ArrayLike<number>
  frame: BodyFrame
  renderIds: (spec: ViewSpec, width: number, height: number) => Uint8Array
  options?: Partial<typeof BEST_VIEW_DEFAULTS>
}): ViewSpec

export declare const POSES: Record<ModelName, (Omit<Pose, 'label'> & { label: Label })[]>
export declare function poseActivations(pose: { activations?: Record<string, number> } | null): Activation[]
export declare const BREATH_PHASES: BreathPhase[]
export declare const BREATH_DEFAULTS: Readonly<Required<BreathSpec>>
export declare function normalizeBreath(spec: BreathSpec): Required<BreathSpec>
export declare function breathAt(seconds: number, spec: BreathSpec): BreathState
export declare function breathPeriod(spec: BreathSpec): number

// ------------------------------------------------------------------ fit (pure, Node-friendly)

/** Prepared fit data of a model (prepareFitModel). */
export interface FitModel {
  sex: ModelName
  heightM: number
  regions: string[]
  R: number
  sites: unknown[]
  siteById: Record<string, unknown>
  calibration: unknown | null
  populationSpread: number
  [key: string]: unknown
}

export declare const WEIGHT_RANGE: [number, number]
export declare const POPULATION_SPREAD: number
export declare function prepareFitModel(body: object, options?: { calibration?: object | null; populationSpread?: number }): FitModel | null
export declare function fitBody(model: FitModel, input?: BodyInput): FitResult
export declare function observe(model: FitModel, input: BodyInput): object
export declare function priorWeights(model: FitModel, ffmi: number): { w: Float64Array; dw: Float64Array }
export declare function siteGirth(model: FitModel, site: unknown, weights: ArrayLike<number>): { value: number; grad: Float64Array }
export declare function muscleVolume(model: FitModel, weights: ArrayLike<number>): { total: number; byRegion: Float64Array; grad: Float64Array }
export declare function targetVolume(model: FitModel, ffmi: number): { v: number; dv: number }
export declare function uniformWeight(model: Pick<FitModel, 'table'> | { table: [number, number][] }, ffmi: number): number
export declare function fingerprint(model: FitModel): string

export declare const TAPE_SITES: Record<TapeCode, { site: string | null; fat: string | null }>
export declare const TAPE_RANGES: Record<TapeCode, [number, number]>
export declare const BODY_FAT_SD: Record<string, number>
export declare function navyBodyFat(sex: ModelName, girths: { heightCm: number; neck?: number; waist?: number; abdomen?: number; hips?: number }): number | null
export declare function skinfoldMm(kind: string, sex: ModelName, person: { heightCm: number; weightKg: number; bodyFatPercent: number }): { mm: number; sd: number }
export declare function ffmiNormalized(weightKg: number, heightCm: number, bodyFatPercent: number): number
export declare function girthScale(heightCm: number, modelHeightM: number, ffmi: number | null, leanKg: number | null): number
export declare function bodySurfaceArea(heightCm: number, weightKg: number): number

// ------------------------------------------------------------------ building blocks
// For tools that stage the body in their own three.js scene (a scene builder, an icon renderer).

/** Loads (once per URL, cached for the page) and parses a model GLB with three's GLTFLoader. */
export declare function loadModel(url: string): Promise<{ scene: Object3D; userData: Record<string, any> }>
/** A copy of a loaded model's scene whose skinned meshes are bound to the copied bones. */
export declare function cloneModel(gltf: { scene: Object3D }): Object3D
/** URL of a model file: `<base>/<model>[-lite].glb`, relative to the page. */
export declare function modelUrl(model: ModelName, lod: 'high' | 'lite', base?: string | null): string
/** Quaternion of every bone for a pose description (rotations about the fixed body axes, in order). */
export declare function poseQuaternions(spec: Record<string, ['x' | 'y' | 'z', number][]>, boneNames: string[]): Record<string, Quaternion>
/** Swaps three's linear blend skinning for dual-quaternion skinning in a shader being compiled. */
export declare function useDualQuaternionSkinning(shader: { vertexShader: string }): void
/** Morph-target weights of one loaded model from an FFMI or a tape-measure fit. */
export declare class BodyShape {
  constructor(meshes: Mesh[], body: object | null)
  readonly regions: string[]
  weights: Float64Array | null
  get range(): { min: number; max: number; default: number } | null
  set(weights: ArrayLike<number>): void
  resolve(input?: { ffmi?: number | null; body?: BodyInput | null }): { weights: Float64Array; fit: FitResult | null; ffmi: number | null }
}
