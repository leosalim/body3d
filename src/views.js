/**
 * Camera views, as data.
 *
 * A saved view is `{ yaw, pitch, zoom, focus }`:
 * - `yaw`: degrees around the body — 0 front, 90 the body's left, 180 back, −90 the body's right;
 * - `pitch`: degrees above the horizontal;
 * - `zoom`: 1 frames the whole standing body; 2 is twice as close;
 * - `focus`: the look-at point relative to the centre of the body, in body heights.
 *
 * Being relative to the body, the same view fits both models and any FFMI. Everything here is
 * pure (three.js math only), so it runs in Node.
 */
import { MathUtils, Vector3 } from 'three'

/** Preset directions (from the target towards the camera). */
export const VIEWS = {
  front: [0, 0.08, 1],
  back: [0, 0.08, -1],
  left: [1, 0.05, 0],        // the body's left side
  right: [-1, 0.05, 0],
  'front-left': [0.7, 0.12, 0.7],
  'front-right': [-0.7, 0.12, 0.7],
  'back-left': [0.7, 0.12, -0.7],
  'back-right': [-0.7, 0.12, -0.7],
  top: [0, 1, 0.02]
}

/** The front view as a spec (what `bestView` returns when nothing is active). */
export const FRONT_VIEW = Object.freeze({ yaw: 0, pitch: 4.6, zoom: 1, focus: [0, 0, 0] })

/** Is this a saved view (`{ yaw, pitch, zoom, focus }`) rather than a preset or a direction? */
export function isViewSpec(view) {
  return !!view && typeof view === 'object' && !Array.isArray(view)
}

/**
 * Spec of a preset name or a direction `[x, y, z]` (a spec passes through). Unknown presets
 * fall back to `front`. `'auto'` is resolved by the viewer, which knows the activations.
 */
export function toViewSpec(view) {
  if (isViewSpec(view)) return view
  const d = new Vector3(...(Array.isArray(view) ? view : VIEWS[view] ?? VIEWS.front)).normalize()
  return {
    yaw: MathUtils.radToDeg(Math.atan2(d.x, d.z)),
    pitch: MathUtils.radToDeg(Math.asin(d.y)),
    zoom: 1,
    focus: [0, 0, 0]
  }
}

/**
 * Camera distance that frames the whole standing body (8 % margin in height, 15 % in width)
 * for a vertical field of view `fov` (degrees) and an `aspect` ratio.
 * @param {{ size: Vector3, fov: number }} frame  body size (bounding box) and camera fov
 */
export function fitDistance(frame, aspect) {
  const fov = (frame.fov * Math.PI) / 180
  const h = frame.size.y * 1.08
  const fit = Math.max(h / 2 / Math.tan(fov / 2), (frame.size.x * 1.15) / 2 / (Math.tan(fov / 2) * aspect))
  return fit + frame.size.z / 2
}

/**
 * Camera target and position for a view spec.
 * @param {{ yaw?: number, pitch?: number, zoom?: number, focus?: number[] }} spec
 * @param {{ center: Vector3, size: Vector3, fov: number }} frame
 * @returns {{ target: Vector3, position: Vector3 }}
 */
export function viewPose(spec, frame, aspect) {
  const yaw = MathUtils.degToRad(Number(spec.yaw) || 0)
  const pitch = MathUtils.degToRad(MathUtils.clamp(Number(spec.pitch) || 0, -85, 85))
  const zoom = MathUtils.clamp(Number(spec.zoom) || 1, 0.5, 5)
  const f = Array.isArray(spec.focus) ? spec.focus : [0, 0, 0]
  const target = frame.center.clone().add(new Vector3(f[0] || 0, f[1] || 0, f[2] || 0).multiplyScalar(frame.size.y))
  const dir = new Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))
  const position = target.clone().addScaledVector(dir, fitDistance(frame, aspect) / zoom)
  return { target, position }
}

/**
 * The view spec of a camera (position looking at target), rounded for storage: yaw and pitch to
 * 0.1°, zoom to 0.01, focus to 0.001 body heights.
 */
export function viewFromCamera(position, target, frame, aspect) {
  const off = position.clone().sub(target)
  const r = off.length()
  const focus = target.clone().sub(frame.center).divideScalar(frame.size.y)
  return {
    yaw: round(MathUtils.radToDeg(Math.atan2(off.x, off.z)), 1),
    pitch: round(MathUtils.radToDeg(Math.asin(MathUtils.clamp(off.y / r, -1, 1))), 1),
    zoom: round(fitDistance(frame, aspect) / r, 2),
    focus: focus.toArray().map((x) => round(x, 3))
  }
}

function round(n, digits) {
  return Math.round(n * 10 ** digits) / 10 ** digits
}
