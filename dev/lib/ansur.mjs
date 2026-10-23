// ANSUR II (2012 Anthropometric Survey of US Army Personnel: 4 082 men and 1 986 women,
// 93 measurements each, public data) read as inputs of the tape-measure fit.
//
// The public CSV is at https://www.openlab.psu.edu/ansur2/ (one file per sex) or, both sexes in
// one file with a `gender` column, at https://calmcode.io/static/data/ergonomics.csv. Lengths are
// in millimetres and mass in hectograms. The CSV stays out of the repository.
import { readFileSync } from 'node:fs'

/**
 * The person's natural (narrowest) waist for the US Navy formula: ANSUR measures women's waist
 * at the navel, on average ~6 % larger than the narrowest.
 */
export const FEMALE_NATURAL_WAIST = 0.94

/** Standard error of the US Navy body-fat method (percentage points). */
export const NAVY_SD_PERCENT = 3.5

/** Rows of a CSV file as objects keyed by lower-case header (quoted fields allowed). */
export function readCsv(path) {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean)
  const head = lines[0].split(',').map((h) => h.trim().toLowerCase())
  return lines.slice(1).map((line) => {
    const cells = []
    let cur = '', quoted = false
    for (const ch of line) {
      if (ch === '"') quoted = !quoted
      else if (ch === ',' && !quoted) { cells.push(cur); cur = '' } else cur += ch
    }
    cells.push(cur)
    return Object.fromEntries(head.map((h, i) => [h, cells[i]]))
  })
}

export const sexOf = (row) => (/^f/i.test(row.gender) ? 'female' : 'male')

/**
 * One ANSUR subject as a fit input: sex, height, weight and the tape sites the fit uses, in cm,
 * under the codes of src/anthro.js TAPE_SITES. The arm is the flexed biceps (ANSUR's convention,
 * kept by the fit); the thigh is measured at the gluteal fold; the chest of women is passed and
 * ignored by the fit (it measures the breasts).
 */
export function subject(row) {
  const sex = sexOf(row)
  const cm = (k) => Number(row[k]) / 10
  const girths = {
    RIGHT_BICEP: cm('bicepscircumferenceflexed'),
    RIGHT_FOREARM: cm('forearmcircumferenceflexed'),
    RIGHT_THIGH: cm('thighcircumference'),
    RIGHT_CALF: cm('calfcircumference'),
    NECK: cm('neckcircumference'),
    SHOULDERS: cm('shouldercircumference'),
    CHEST: cm('chestcircumference'),
    HIPS: cm('buttockcircumference')
  }
  const waist = cm('waistcircumference')
  if (sex === 'female') girths.WAIST = waist * FEMALE_NATURAL_WAIST
  else girths.ABDOMEN = waist
  return { sex, heightCm: cm('stature'), weightKg: Number(row.weightkg) / 10, age: Number(row.age), girths }
}

/**
 * Body fat (%) from BMI, age and sex (Deurenberg et al. 1991; standard error ≈ 4 points). It uses
 * no girth, so a prediction made with it is blind to every tape — unlike the US Navy formula,
 * which reads the neck, the waist and (women) the hips.
 */
export function deurenbergBodyFat({ sex, heightCm, weightKg, age }) {
  const m = heightCm / 100
  return 1.2 * weightKg / (m * m) + 0.23 * age - 10.8 * (sex === 'male' ? 1 : 0) - 5.4
}
