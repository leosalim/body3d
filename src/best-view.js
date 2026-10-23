/**
 * The best default view for a set of activations.
 *
 * The body is rendered into the picking buffer (part ids, no shading) from eight azimuths —
 * front, back, sides and the four 3/4 views — at two heights. For every activated group, the
 * number of its pixels in each view is divided by the number in the view where it shows the
 * most, so a group counts by how well a view shows it relative to its best, not by its size: a
 * large trapezius does not outweigh a small lateral deltoid. The score of a view is the sum of
 * those fractions weighted by the activation squared (primary 1, secondary at 45 % ≈ 0.2).
 * Front and back get a 10 % and 7 % bonus (they read most clearly; a tie goes to the front) and
 * the slightly raised camera loses 6 %. In the winning view, when the key muscles (at least half
 * the top weight) cover little of the frame, the camera zooms in (up to 1.5×) and centres on
 * them; when they span more than 62 % of the height (legs and trunk together, cardio), it keeps
 * the whole body.
 *
 * Everything is pure except the `renderIds` callback, which the viewer implements with its
 * picking pass (see docs/views.md for the reasoning and the evaluation over a 372-exercise
 * catalog).
 */
import { MathUtils, PerspectiveCamera, Vector3 } from 'three'
import { FRONT_VIEW, viewPose } from './views.js'

export const BEST_VIEW_DEFAULTS = Object.freeze({
  width: 90,                 // picking buffer, px (a body is ~2:1)
  height: 150,
  yaws: [0, 45, 90, 135, 180, -135, -90, -45],
  pitches: [4.6, 16],
  frontBonus: 1.1,
  backBonus: 1.07,
  raisedPenalty: 0.94,       // pitch above 10°
  keyFraction: 0.5,          // key muscles: weight ≥ this × the top weight
  padding: 1.6,              // margin around the key muscles when zooming
  fullBodyFraction: 0.62,    // key muscles taller than this fraction of the frame: no zoom
  maxZoom: 1.5,
  minZoom: 1.12              // below this the zoom is not worth the lost context
})

/**
 * Per-part weights (activation², muscles only) and the activated groups (a part's `group`, or
 * its `base` when it has none).
 * @param {{ kind: string, group?: string, base: string }[]} parts
 * @param {ArrayLike<number>} activation  0–1 per part
 */
export function activationWeights(parts, activation) {
  const weights = new Float32Array(parts.length)
  const groupOf = new Int32Array(parts.length).fill(-1)
  const ids = new Map()
  const groupWeight = []
  let max = 0
  for (let i = 0; i < parts.length; i++) {
    const a = parts[i].kind === 'muscle' ? activation[i] : 0
    weights[i] = a * a
    max = Math.max(max, weights[i])
    if (a <= 0) continue
    const key = parts[i].group ?? parts[i].base
    if (!ids.has(key)) { ids.set(key, groupWeight.length); groupWeight.push(0) }
    const g = ids.get(key)
    groupOf[i] = g
    groupWeight[g] = Math.max(groupWeight[g], weights[i])
  }
  return { weights, groupOf, groupWeight, max }
}

/** Part index stored in an RGBA picking buffer at pixel `i` (−1 = background). */
export function decodePartId(buf, i) {
  return buf[i * 4] + buf[i * 4 + 1] * 256 - 1
}

/** Pixels of each activated group in a picking buffer. */
export function groupPixels(buf, pixelCount, groupOf, groupCount) {
  const px = new Float64Array(groupCount)
  for (let i = 0; i < pixelCount; i++) {
    const id = decodePartId(buf, i)
    if (id >= 0 && groupOf[id] >= 0) px[groupOf[id]]++
  }
  return px
}

/**
 * Highest-scoring candidate `{ yaw, pitch, px }` (see the module comment). Ties keep the first
 * candidate, which is why the front comes first in `yaws`.
 */
export function scoreViews(candidates, groupWeight, opts = BEST_VIEW_DEFAULTS) {
  const most = groupWeight.map((_, g) => Math.max(1, ...candidates.map((c) => c.px[g])))
  let best = null
  for (const c of candidates) {
    let s = 0
    for (let g = 0; g < groupWeight.length; g++) s += groupWeight[g] * (c.px[g] / most[g])
    s *= (c.yaw === 0 ? opts.frontBonus : c.yaw === 180 ? opts.backBonus : 1) * (c.pitch > 10 ? opts.raisedPenalty : 1)
    if (!best || s > best.score) best = { score: s, yaw: c.yaw, pitch: c.pitch }
  }
  return best
}

/** Bounding box (buffer pixels) of the parts with weight ≥ `threshold`, or null. */
export function keyBox(buf, width, height, weights, threshold) {
  let x0 = width, x1 = -1, y0 = height, y1 = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const id = decodePartId(buf, y * width + x)
      if (id >= 0 && weights[id] >= threshold) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  return x1 >= x0 && y1 >= y0 ? { x0, x1, y0, y1 } : null
}

/** Zoom for a key-muscle box: 1 when they span most of the height, else up to `maxZoom`. */
export function framingZoom(box, width, height, opts = BEST_VIEW_DEFAULTS) {
  const bw = ((box.x1 - box.x0 + 1) / width) * opts.padding
  const bh = ((box.y1 - box.y0 + 1) / height) * opts.padding
  return (box.y1 - box.y0 + 1) / height > opts.fullBodyFraction ? 1 : Math.min(opts.maxZoom, 1 / Math.max(bw, bh))
}

/**
 * Focus (body heights from the body centre) that centres the camera of `spec` on the box: the
 * box centre in normalized device coordinates, carried to the target plane along the camera
 * axes. Buffer row 0 is the bottom of the image.
 */
export function focusOnBox(box, spec, frame, aspect, width, height) {
  const cx = ((box.x0 + box.x1 + 1) / 2 / width) * 2 - 1
  const cy = ((box.y0 + box.y1 + 1) / 2 / height) * 2 - 1
  const { target, position } = viewPose(spec, frame, aspect)
  const cam = new PerspectiveCamera(frame.fov, aspect, 0.05, 30)
  cam.position.copy(position)
  cam.lookAt(target)
  cam.updateMatrixWorld()
  const halfH = position.distanceTo(target) * Math.tan(MathUtils.degToRad(cam.fov) / 2)
  const right = new Vector3().setFromMatrixColumn(cam.matrixWorld, 0)
  const up = new Vector3().setFromMatrixColumn(cam.matrixWorld, 1)
  return target.clone()
    .addScaledVector(right, cx * halfH * aspect)
    .addScaledVector(up, cy * halfH)
    .sub(frame.center).divideScalar(frame.size.y)
}

/**
 * Best view for the activations.
 *
 * @param {object} input
 * @param {{ kind: string, group?: string, base: string }[]} input.parts
 * @param {ArrayLike<number>} input.activation  0–1 per part
 * @param {{ center: Vector3, size: Vector3, fov: number }} input.frame  body box and camera fov
 * @param {(spec: object, width: number, height: number) => Uint8Array} input.renderIds  renders
 *   the picking pass of a view into an RGBA buffer (row 0 at the bottom)
 * @param {Partial<typeof BEST_VIEW_DEFAULTS>} [input.options]
 * @returns {{ yaw: number, pitch: number, zoom: number, focus: number[] }}
 */
export function computeBestView({ parts, activation, frame, renderIds, options }) {
  const opts = { ...BEST_VIEW_DEFAULTS, ...options }
  const { weights, groupOf, groupWeight, max } = activationWeights(parts, activation)
  if (max <= 0) return { ...FRONT_VIEW, focus: [...FRONT_VIEW.focus] }
  const { width: W, height: H } = opts
  const aspect = W / H

  const candidates = []
  for (const pitch of opts.pitches) {
    for (const yaw of opts.yaws) {
      const buf = renderIds({ yaw, pitch, zoom: 1, focus: [0, 0, 0] }, W, H)
      candidates.push({ yaw, pitch, px: groupPixels(buf, W * H, groupOf, groupWeight.length) })
    }
  }
  const best = scoreViews(candidates, groupWeight, opts)

  const spec = { yaw: best.yaw, pitch: best.pitch, zoom: 1, focus: [0, 0, 0] }
  const box = keyBox(renderIds(spec, W, H), W, H, weights, max * opts.keyFraction)
  if (box) {
    const zoom = framingZoom(box, W, H, opts)
    if (zoom >= opts.minZoom) {
      // the focus is measured on the whole-body framing the box was found in (zoom 1)
      const focus = focusOnBox(box, spec, frame, aspect, W, H)
      spec.zoom = Math.round(zoom * 100) / 100
      spec.focus = focus.toArray().map((x) => Math.round(x * 1000) / 1000)
    }
  }
  return spec
}
