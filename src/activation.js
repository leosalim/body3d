/**
 * From activation lists (names + percentages) to one value per model part.
 *
 * A name may be:
 * - a training group — the coarse gym vocabulary of `TRAINING_GROUPS`, by English name
 *   ("Chest", "Hamstrings"), Portuguese name ("Peitoral", "Posteriores da coxa") or id
 *   ("hamstrings");
 * - an anatomical group by id or label ("delt-front", "Anterior deltoid", "Deltoide anterior");
 * - a muscle by id or label ("rectus-femoris", "Rectus femoris", "Reto femoral").
 *
 * Matching ignores case and accents. When two vocabularies share a name, the first one wins,
 * in this order: training-group names; ids of groups, then of muscles; labels of groups, then of
 * muscles; training-group ids. So "glutes" is the training group (gluteus maximus and, at half,
 * medius) and "gluteus maximus" the anatomical group. A prefix removes the ambiguity:
 * "group:glutes", "muscle:gluteus-maximus", "training:glutes".
 */
import { GROUPS, MUSCLES, TRAINING_GROUPS } from './catalog.generated.js'

/**
 * One input activation. `activation` is a percentage, 0–100. `side` restricts it to one side
 * of the body. `name` and `id` are accepted in place of `muscle`.
 *
 * @typedef {{ muscle: string, activation: number, side?: 'left' | 'right' }} Activation
 */

/** Normalized lookup key: no accents, trimmed, lower case. */
export function normalizeName(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
}

/** normalized name → { groupOrMuscleId: weight } */
const INDEX = new Map()
/** prefixed keys ("group:abs") never collide */
const PREFIXED = new Map()

function add(key, targets) {
  const k = normalizeName(key)
  if (k && !INDEX.has(k)) INDEX.set(k, targets)
}
function addPrefixed(prefix, key, targets) {
  PREFIXED.set(`${prefix}:${normalizeName(key)}`, targets)
}

// the order below is the precedence for unprefixed names (see the module comment)
for (const t of TRAINING_GROUPS) add(t.label['pt-BR'], t.targets)
for (const t of TRAINING_GROUPS) add(t.label.en, t.targets)
const anatomical = [...GROUPS.map((g) => ['group', g]), ...MUSCLES.map((m) => ['muscle', m])]
for (const [, e] of anatomical) add(e.id, { [e.id]: 1 })
for (const [, e] of anatomical) {
  add(e.label['pt-BR'], { [e.id]: 1 })
  add(e.label.en, { [e.id]: 1 })
}
for (const [prefix, e] of anatomical) {
  for (const k of [e.id, e.label.en, e.label['pt-BR']]) addPrefixed(prefix, k, { [e.id]: 1 })
}
for (const t of TRAINING_GROUPS) {
  add(t.id, t.targets)
  for (const k of [t.id, t.label.en, t.label['pt-BR']]) addPrefixed('training', k, t.targets)
}

/**
 * Targets ({ groupOrMuscleId: weight }) of a name, or null when it is unknown.
 *
 * @param {string} name
 * @param {Record<string, string | Record<string, number>>} [aliases]  extra names: an alias maps
 *   to another name ("Peito": "chest") or straight to targets ({ "chest-upper": 1 }). Aliases
 *   are looked up first.
 */
export function targetsOf(name, aliases) {
  const key = normalizeName(name)
  if (aliases) {
    for (const [alias, to] of Object.entries(aliases)) {
      if (normalizeName(alias) !== key) continue
      return typeof to === 'string' ? targetsOf(to) : to
    }
  }
  return PREFIXED.get(key) ?? INDEX.get(key) ?? null
}

/**
 * Converts an activation list to one value (0–1) per model part. A part reached by more than
 * one entry keeps the largest value.
 *
 * @param {Activation[]} list
 * @param {{ base: string, group?: string, side?: 'l' | 'r' | null }[]} parts  `extras.parts` of the GLB
 * @param {{ aliases?: Record<string, string | Record<string, number>> }} [options]
 * @returns {{ values: Float32Array, unknown: string[] }}
 */
export function resolveActivations(list, parts, { aliases } = {}) {
  const values = new Float32Array(parts.length)
  const unknown = []
  for (const item of list ?? []) {
    if (!item) continue
    const name = item.muscle ?? item.name ?? item.id
    const targets = targetsOf(name, aliases)
    if (!targets) { unknown.push(String(name)); continue }
    const pct = Number(item.activation ?? item.value ?? 0)
    if (!Number.isFinite(pct) || pct <= 0) continue
    const amount = Math.min(pct, 100) / 100
    const side = item.side === 'left' ? 'l' : item.side === 'right' ? 'r' : null
    parts.forEach((p, i) => {
      if (side && p.side && p.side !== side) return
      const w = targets[p.base] ?? (p.group ? targets[p.group] : undefined)
      if (w) values[i] = Math.max(values[i], amount * w)
    })
  }
  return { values, unknown }
}

/**
 * Activations from an exercise that lists primary and secondary muscles by name (strings or
 * `{ name }` objects): primaries at `primary` %, secondaries at `secondary` %.
 *
 * @param {{ primaryMuscles?: (string | { name: string })[], secondaryMuscles?: (string | { name: string })[] }} exercise
 * @returns {Activation[]}
 */
export function fromExercise(exercise, { primary = 100, secondary = 45 } = {}) {
  const out = []
  for (const m of exercise?.secondaryMuscles ?? []) out.push({ muscle: m.name ?? m, activation: secondary })
  for (const m of exercise?.primaryMuscles ?? []) out.push({ muscle: m.name ?? m, activation: primary })
  return out
}
