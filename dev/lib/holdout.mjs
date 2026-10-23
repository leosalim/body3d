// The ANSUR II split shared by the validation scripts (dev/validate-ansur.mjs,
// dev/asymmetry-ansur.mjs): `dev/calibrate.mjs --holdout` calibrates on the even rows, and the
// people of the odd rows are the ones the calibration never saw.
import { fileURLToPath } from 'node:url'
import { readBody } from '../glb.mjs'
import { sexOf, subject, deurenbergBodyFat } from './ansur.mjs'
import { prepareFitModel, observe, siteGirth, fingerprint, POPULATION_SPREAD } from '../../src/fit.js'

/** Tape sites ANSUR measures (right side for the limbs). */
export const SITES = ['RIGHT_BICEP', 'RIGHT_FOREARM', 'RIGHT_THIGH', 'RIGHT_CALF', 'NECK', 'SHOULDERS', 'CHEST', 'HIPS']
export const LIMB_SITES = SITES.slice(0, 4)
/** The "one other tape" of each site: the neighbour a person usually measures with it. */
export const PARTNER = {
  RIGHT_BICEP: 'RIGHT_FOREARM', RIGHT_FOREARM: 'RIGHT_BICEP', RIGHT_THIGH: 'RIGHT_CALF', RIGHT_CALF: 'RIGHT_THIGH',
  NECK: 'SHOULDERS', SHOULDERS: 'CHEST', CHEST: 'SHOULDERS', HIPS: 'RIGHT_THIGH'
}
/** The fit does not use women's chest (it measures the breasts). */
export const usedSite = (sex, code) => !(sex === 'female' && code === 'CHEST')

/**
 * Where each person's body fat comes from: `navy` — the US Navy formula on their own neck, waist
 * and (women) hips, given to the fit as a measurement; `bmi` — Deurenberg's formula on BMI and
 * age, which reads no tape (a blind but less precise estimate).
 */
export const BODY_FAT_SOURCES = ['navy', 'bmi']

/** Fit model of one sex, with a calibration from `calibrate.mjs --json` (keyed by fingerprint). */
export function fitModel(sex, { calibrations = null, spread = POPULATION_SPREAD } = {}) {
  const body = readBody(fileURLToPath(new URL(`../../public/models/${sex}.glb`, import.meta.url)))
  const model = prepareFitModel(body, { populationSpread: spread })
  if (calibrations) {
    const c = calibrations[fingerprint(model)]
    if (!c) throw new Error(`${sex}: no calibration for this model (fingerprint ${fingerprint(model)})`)
    model.calibration = c
  }
  return model
}

/**
 * People of one sex as fit inputs, from every second row: `parity` 1 (odd rows, the validation
 * half, first `n` of them) or 0 (even rows, the calibration half). Body fat from `bodyFat`; the
 * tapes exclude the waist and abdomen, which only feed the Navy formula.
 */
export function holdoutPeople(rows, model, sex, { parity = 1, bodyFat = 'navy', n = Infinity } = {}) {
  const picked = rows.filter((r, i) => i % 2 === parity && sexOf(r) === sex).slice(0, n)
  const out = []
  for (const r of picked) {
    const s = subject(r)
    const bf = bodyFat === 'bmi'
      ? deurenbergBodyFat(s)
      : observe(model, { ...s, bodyFatMethod: 'NAVY' }).bodyFat?.value
    if (!(bf > 0)) continue
    const girths = Object.fromEntries(Object.entries(s.girths).filter(([c]) => c !== 'WAIST' && c !== 'ABDOMEN'))
    out.push({ ...s, girths, bodyFatPercent: bf, bodyFatMethod: bodyFat === 'bmi' ? null : 'NAVY' })
  }
  return out
}

/**
 * Predicted tape for a site (cm) at the fitted weights: the same model → tape conversion as the
 * fit (height scale, ratio on the trunk, skin and fat). The value put in place of the tape only
 * builds the conversion, which does not depend on it.
 */
export function predictTape(model, input, code, weights, placeholder) {
  const o = observe(model, { ...input, girths: { [code]: placeholder } })
  const ob = o.obs.find((x) => x.codes.includes(code))
  if (!ob) return null
  const g = siteGirth(model, model.siteById[ob.site], weights).value
  return (g * ob.correctedCm) / ob.y + (ob.measuredCm - ob.correctedCm)
}

export const rms = (a) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / Math.max(1, a.length))
export const mean = (a) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length)
export const percentile = (a, p) => {
  const s = [...a].sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]
}
export const r2 = (x) => Math.round(x * 100) / 100
