/** Easing for the viewer's transitions (activation, body shape, pose, camera). */

/** Smoothstep: eases in and out. */
export function smoothstep(t) {
  return t * t * (3 - 2 * t)
}

/** Cubic ease-out: fast start, gentle stop (camera moves). */
export function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3)
}

/** Linear progress 0–1 of a transition `{ t0, ms }` at time `now`. */
export function progress(now, anim) {
  return Math.min(1, (now - anim.t0) / anim.ms)
}
