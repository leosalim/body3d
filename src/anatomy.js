/**
 * Lookups over the anatomical catalog (generated from `pipeline/anatomy.py`).
 */
import { AREAS, GROUPS, MUSCLES, REGIONS, TISSUES, TRAINING_GROUPS } from './catalog.generated.js'
import { localized } from './i18n.js'

const index = (rows) => new Map(rows.map((r) => [r.id, r]))
const GROUP_BY_ID = index(GROUPS)
const PART_BY_ID = new Map([...index(MUSCLES), ...index(TISSUES)])
const TRAINING_BY_ID = index(TRAINING_GROUPS)

/** Catalog entry of a muscle or tissue by id (without side), or null. */
export function muscleById(id) {
  return PART_BY_ID.get(id) ?? null
}

/** Catalog entry of an activatable group, or null. */
export function groupById(id) {
  return GROUP_BY_ID.get(id) ?? null
}

/** Catalog entry of a training group, or null. */
export function trainingGroupById(id) {
  return TRAINING_BY_ID.get(id) ?? null
}

/** Localized label of a group id, or null. */
export function groupLabel(id, locale = 'en') {
  return localized(GROUP_BY_ID.get(id)?.label, locale)
}

/**
 * Localized label of a model part (an entry of `viewer.parts`). Muscles and tissues come from
 * the catalog; bones and cartilage keep their FMA name from the model file.
 */
export function partLabel(part, locale = 'en') {
  if (!part) return null
  return localized(PART_BY_ID.get(part.base)?.label, locale) ?? part.label ?? part.base
}

export { AREAS, GROUPS, MUSCLES, REGIONS, TISSUES, TRAINING_GROUPS }
