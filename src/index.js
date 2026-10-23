/**
 * body3d — a 3D muscle-activation viewer on BodyParts3D.
 *
 *   import { createBodyViewer } from 'body3d'
 *   const viewer = createBodyViewer(el, { model: 'female' })
 *   viewer.setActivations([{ muscle: 'Chest', activation: 90 }, { muscle: 'Triceps', activation: 50 }])
 *
 * Or as an element: `defineBodyElement()` and `<body3d-viewer model="male"></body3d-viewer>`.
 * Full reference: docs/api.md.
 */
import { BodyViewer } from './viewer.js'

// viewer
export { BodyViewer, DEFAULTS } from './viewer.js'
export { defineBodyElement } from './element.js'
export { DEFAULT_MODEL_BASE_URL, clearModelCache } from './loader.js'
export { DEFAULT_COLORS } from './material.js'
export { STRINGS, LOCALES } from './i18n.js'

// activations and anatomy
export { resolveActivations, fromExercise, targetsOf, normalizeName } from './activation.js'
export { AREAS, GROUPS, MUSCLES, TISSUES, REGIONS, TRAINING_GROUPS, partLabel, groupLabel } from './anatomy.js'

// views and poses
export { VIEWS, FRONT_VIEW, toViewSpec, viewPose, viewFromCamera } from './views.js'
export { computeBestView, BEST_VIEW_DEFAULTS } from './best-view.js'
export { POSES, poseActivations } from './poses.js'
export { BREATH_PHASES, BREATH_DEFAULTS, normalizeBreath, breathAt, breathPeriod } from './breath.js'

// body shape and tape-measure fit (pure: also run in Node)
export {
  prepareFitModel, fitBody, observe, priorWeights, siteGirth, muscleVolume, targetVolume, uniformWeight,
  fingerprint, WEIGHT_RANGE, POPULATION_SPREAD
} from './fit.js'
export {
  TAPE_SITES, TAPE_RANGES, BODY_FAT_SD, navyBodyFat, skinfoldMm, ffmiNormalized, girthScale, bodySurfaceArea
} from './anthro.js'

// building blocks for tools that stage the body in their own scene
export { loadModel, cloneModel, modelUrl } from './loader.js'
export { poseQuaternions } from './posing.js'
export { useDualQuaternionSkinning } from './material.js'
export { BodyShape } from './shape.js'

/** Shortcut for `new BodyViewer(container, options)`. */
export function createBodyViewer(container, options) {
  return new BodyViewer(container, options)
}
