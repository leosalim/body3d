/**
 * Breathing guide: a nearly transparent spherical shell on the thorax that fills and empties
 * with a breathing pattern (inhale, hold, exhale, hold — seconds each), centred on the point the
 * breath works against in a pose (the front of the lower ribs, the sternum, the back of the
 * ribs…), given in a bone's frame so it follows the body as it moves.
 *
 * The timing is a pure function (`breathAt`); the shell is a sphere drawn over the body with a
 * Fresnel rim (it reads as a circle from any side) plus a small dot at its centre.
 */
import { AdditiveBlending, Color, Group, Mesh, ShaderMaterial, SphereGeometry, Vector3, Quaternion } from 'three'

/** Phases of a breath, in order; `holdIn` and `holdOut` may last 0. */
export const BREATH_PHASES = ['inhale', 'holdIn', 'exhale', 'holdOut']

/** Defaults of a breathing spec (seconds, metres). */
export const BREATH_DEFAULTS = Object.freeze({
  center: { bone: 'chest', position: [0, 0.1, 0.09] },
  radius: 0.11,
  inhale: 4,
  holdIn: 0,
  exhale: 4,
  holdOut: 0,
  color: '#d9d2ff'
})

/** A spec with its defaults, the phase durations clamped to 0–60 s and at least 1 s per breath. */
export function normalizeBreath(spec) {
  const s = { ...BREATH_DEFAULTS, ...spec }
  for (const p of BREATH_PHASES) s[p] = Math.min(60, Math.max(0, Number(s[p]) || 0))
  if (s.inhale + s.holdIn + s.exhale + s.holdOut < 1) s.inhale = s.exhale = 0.5
  s.radius = Math.min(0.4, Math.max(0.03, Number(s.radius) || BREATH_DEFAULTS.radius))
  return s
}

const ease = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t)

/**
 * Where a breathing pattern is `seconds` after it started:
 * `{ phase, index, t, remaining, duration, cycle, fill }` — `t` 0–1 within the phase,
 * `remaining`/`duration` in seconds, `cycle` the breath count from 0, `fill` how full the
 * lungs are (0 empty, 1 full; eased in and out).
 */
export function breathAt(seconds, spec) {
  const s = normalizeBreath(spec)
  const durations = BREATH_PHASES.map((p) => s[p])
  const period = durations.reduce((a, b) => a + b, 0)
  const time = Math.max(0, seconds)
  const cycle = Math.floor(time / period)
  let local = time - cycle * period
  let index = 0
  while (index < 3 && (durations[index] === 0 || local >= durations[index])) {
    local -= durations[index]
    index++
  }
  const duration = durations[index]
  const t = duration > 0 ? Math.min(1, local / duration) : 1
  const fill = index === 0 ? ease(t) : index === 1 ? 1 : index === 2 ? 1 - ease(t) : 0
  return { phase: BREATH_PHASES[index], index, t, remaining: Math.max(0, duration - local), duration, cycle, fill }
}

/** Seconds of one breath. */
export function breathPeriod(spec) {
  const s = normalizeBreath(spec)
  return BREATH_PHASES.reduce((a, p) => a + s[p], 0)
}

const SHELL_VERT = /* glsl */`
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`
const SHELL_FRAG = /* glsl */`
uniform vec3 color;
uniform float base;
uniform float rim;
uniform float glow;
varying vec3 vN;
varying vec3 vV;
void main() {
  float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 3.0);
  float a = base + rim * f + glow * (1.0 - f) * 0.5;
  gl_FragColor = vec4(color * (0.75 + 0.5 * f), clamp(a, 0.0, 1.0));
  #include <colorspace_fragment>
}
`

/**
 * The shell and its centre dot, as one group to add to the scene. Drawn over the body (no depth
 * test), so the whole circle shows; `updateBreathShell` places and sizes it every frame.
 */
export function createBreathShell(spec) {
  const s = normalizeBreath(spec)
  const color = new Color(s.color)
  const shellMat = new ShaderMaterial({
    vertexShader: SHELL_VERT, fragmentShader: SHELL_FRAG,
    uniforms: { color: { value: color }, base: { value: 0.05 }, rim: { value: 0.8 }, glow: { value: 0 } },
    transparent: true, depthWrite: false, depthTest: false
  })
  const shell = new Mesh(new SphereGeometry(1, 48, 32), shellMat)
  const dotMat = new ShaderMaterial({
    vertexShader: SHELL_VERT, fragmentShader: SHELL_FRAG,
    uniforms: { color: { value: color.clone() }, base: { value: 0.55 }, rim: { value: 0.35 }, glow: { value: 0 } },
    transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending
  })
  const dot = new Mesh(new SphereGeometry(1, 16, 12), dotMat)
  const group = new Group()
  group.add(shell, dot)
  group.renderOrder = shell.renderOrder = dot.renderOrder = 10
  group.userData = { spec: s, shell, dot }
  return group
}

const _p = new Vector3()
const _q = new Quaternion()

/**
 * Puts the shell on its bone's point and sizes it for `state` (from `breathAt`; null = at rest,
 * half full). The shell is 82 % of its radius empty and 112 % full.
 */
export function updateBreathShell(group, bones, state) {
  const { spec, shell, dot } = group.userData
  const bone = bones[spec.center?.bone ?? 'chest']
  const offset = spec.center?.position ?? [0, 0, 0]
  if (bone) {
    bone.updateWorldMatrix(true, false)
    bone.getWorldPosition(_p)
    bone.getWorldQuaternion(_q)
    group.position.copy(new Vector3(offset[0], offset[1], offset[2]).applyQuaternion(_q).add(_p))
  }
  const fill = state ? state.fill : 0.5
  shell.scale.setScalar(spec.radius * (0.82 + 0.3 * fill))
  shell.material.uniforms.glow.value = 0.12 * fill
  dot.scale.setScalar(0.012 + 0.006 * fill)
}

export function disposeBreathShell(group) {
  for (const m of [group.userData.shell, group.userData.dot]) {
    m.geometry.dispose()
    m.material.dispose()
  }
  group.removeFromParent()
}
