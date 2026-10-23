/**
 * Anthropometry of the tape-measure fit (fit.js): from a tape girth to the muscle-and-bone girth
 * the model draws.
 *
 * A tape girth wraps skin and subcutaneous fat. For a ring of thickness t around a convex
 * cross-section the outer perimeter is the inner one + 2πt (Steiner's formula); with the skinfold
 * S ≈ 2t (skin and fat folded double), the muscle-and-bone perimeter is C − π·S — the "corrected
 * girth" of Heymsfield et al. (1982) and Lee et al. (2000).
 *
 * Without skinfolds, the skinfold of each site comes from total body fat: the mean subcutaneous
 * fat thickness is proportional to fat mass ÷ body surface area (volume ÷ area), and every site
 * has its fraction of that mean, per sex:
 *
 *     S(site) = s0 + a(site, sex) · (FM / BSA)^0.9      (mm; FM in kg, BSA in m²)
 *
 * s0 = 2.5 mm is the doubled skin; the exponent and the triceps, thigh and calf coefficients
 * reproduce the mean skinfolds of Lee et al. (2000, table 2) in the non-obese and obese groups
 * of both sexes (error ≤ 3 mm), with the body fat of those samples estimated from the
 * skeletal-muscle / lean-mass ratio of Janssen et al. (2000). The other sites are fractions of
 * those skinfolds (mean ring around the limb: the biceps has half the triceps skinfold). The
 * individual skinfold varies for the same total fat (CV ~20 %, within the between-person
 * variation of ANSUR II at the same FFMI — dev/calibrate.mjs); that uncertainty enters the weight
 * of each measure in the fit.
 */

/**
 * Tape sites by code → fit site of the model and fat pattern. The codes are those of the
 * standard tape locations of the application this came from (Trace); arm = flexed biceps at its
 * thickest (the ANSUR II convention), hips and glutes = the same loop.
 */
export const TAPE_SITES = {
  LEFT_BICEP: { site: 'arm_l', fat: 'arm' },
  RIGHT_BICEP: { site: 'arm_r', fat: 'arm' },
  LEFT_FOREARM: { site: 'forearm_l', fat: 'forearm' },
  RIGHT_FOREARM: { site: 'forearm_r', fat: 'forearm' },
  LEFT_THIGH: { site: 'thigh_l', fat: 'thigh' },
  RIGHT_THIGH: { site: 'thigh_r', fat: 'thigh' },
  LEFT_CALF: { site: 'calf_l', fat: 'calf' },
  RIGHT_CALF: { site: 'calf_r', fat: 'calf' },
  NECK: { site: 'neck', fat: 'neck' },
  SHOULDERS: { site: 'shoulders', fat: 'shoulders' },
  CHEST: { site: 'chest', fat: 'chest' },
  HIPS: { site: 'hips', fat: 'hips' },
  GLUTES: { site: 'hips', fat: 'hips' },
  // only enter the US Navy body-fat estimate: they measure fat and viscera, not muscle
  WAIST: { site: null, fat: null },
  ABDOMEN: { site: null, fat: null }
}

/** Plausible range of each tape (cm). Outside it, a measure is treated as a typo. */
export const TAPE_RANGES = {
  LEFT_BICEP: [15, 75], RIGHT_BICEP: [15, 75], LEFT_FOREARM: [14, 60], RIGHT_FOREARM: [14, 60],
  LEFT_THIGH: [28, 120], RIGHT_THIGH: [28, 120], LEFT_CALF: [18, 75], RIGHT_CALF: [18, 75],
  NECK: [22, 70], SHOULDERS: [65, 200], CHEST: [55, 190], HIPS: [55, 200], GLUTES: [55, 200],
  WAIST: [45, 200], ABDOMEN: [45, 210]
}

const SKIN_FOLD_MM = 2.5
const FAT_EXPONENT = 0.9
/** Coefficients `a` of triceps, (anterior) thigh and (medial) calf — fitted to Lee et al. 2000. */
const REF_SITES = {
  male: { triceps: 1.647, thigh: 2.157, calf: 1.186 },
  female: { triceps: 2.474, thigh: 3.533, calf: 1.832 }
}
/**
 * Mean fat ring of each site as a fraction of a reference skinfold. At the hips, gluteal and
 * lower-abdominal fat is the thickest in the body (gluteal CT: ~2 cm in men and ~3.5 cm in
 * normal-weight women) — the ring is worth ~2× the thigh skinfold.
 */
const RINGS = {
  male: {
    arm: ['triceps', 0.75], forearm: ['triceps', 0.5], thigh: ['thigh', 1.0], calf: ['calf', 0.9],
    neck: ['triceps', 0.5], shoulders: ['triceps', 0.9], chest: ['triceps', 1.1], hips: ['thigh', 2.0]
  },
  female: {
    arm: ['triceps', 0.8], forearm: ['triceps', 0.5], thigh: ['thigh', 1.15], calf: ['calf', 0.9],
    neck: ['triceps', 0.5], shoulders: ['triceps', 0.9], chest: ['triceps', 1.0], hips: ['thigh', 1.8]
  }
}
/** Individual variation of the fat pattern for the same total fat. */
export const FAT_PATTERN_CV = 0.2
/** Typical body fat when the person never measured it (for the skinfold only; large uncertainty). */
export const DEFAULT_BODY_FAT = { male: 20, female: 30 }

/** Body surface area (m²), Mosteller (1987). */
export function bodySurfaceArea(heightCm, weightKg) {
  return Math.sqrt((heightCm * weightKg) / 3600)
}

/**
 * Mean skinfold (mm) around a tape site, with the individual standard deviation.
 * @param {'arm'|'forearm'|'thigh'|'calf'|'neck'|'shoulders'|'chest'|'hips'} kind
 * @param {'male'|'female'} sex
 */
export function skinfoldMm(kind, sex, { heightCm, weightKg, bodyFatPercent }) {
  const s = sex === 'female' ? 'female' : 'male'
  const [ref, frac] = RINGS[s][kind]
  const fm = weightKg * bodyFatPercent / 100
  const idx = Math.max(0, fm / bodySurfaceArea(heightCm, weightKg))
  const fat = REF_SITES[s][ref] * frac * Math.pow(idx, FAT_EXPONENT)
  return { mm: SKIN_FOLD_MM + fat, sd: 0.4 + FAT_PATTERN_CV * fat }
}

/**
 * Body fat (%) by the US Navy method (Hodgdon & Beckett 1984), girths in cm. Men: abdomen (at
 * the navel) and neck; women: waist (narrowest), hips and neck. null without the measures.
 * Standard error ~3.5–4 percentage points.
 */
export function navyBodyFat(sex, { heightCm, neck, waist, abdomen, hips }) {
  if (!heightCm || !neck) return null
  if (sex === 'female') {
    if (!waist || !hips || waist + hips - neck <= 0) return null
    const bd = 1.29579 - 0.35004 * Math.log10(waist + hips - neck) + 0.221 * Math.log10(heightCm)
    return clampFat(495 / bd - 450)
  }
  const belly = abdomen ?? waist
  if (!belly || belly - neck <= 0) return null
  const bd = 1.0324 - 0.19077 * Math.log10(belly - neck) + 0.15456 * Math.log10(heightCm)
  return clampFat(495 / bd - 450)
}

function clampFat(v) {
  return Number.isFinite(v) ? Math.min(60, Math.max(3, v)) : null
}

/** Typical uncertainty (percentage points) of each body-fat method; `null` = unknown method. */
export const BODY_FAT_SD = {
  DEXA: 1.5, HYDROSTATIC: 2, BOD_POD: 2.2, SKINFOLD_7: 3, SKINFOLD_3: 3.5, BIA: 4, NAVY: 4,
  NAVY_TAPE: 4, VISUAL: 5, null: 4
}

/** Height-normalized FFMI (Kouri et al. 1995): FFM / h² + 6.1 × (1.8 − h), the model's scale. */
export function ffmiNormalized(weightKg, heightCm, bodyFatPercent) {
  const m = heightCm / 100
  return (weightKg * (1 - bodyFatPercent / 100)) / (m * m) + 6.1 * (1.8 - m)
}

/**
 * Factor that carries a person's girth to the model's height, keeping the relation between
 * girth and the lean mass of the normalized FFMI: the model's lean mass at that FFMI over the
 * person's is the volume ratio; divided by the height ratio, the cross-section-area ratio; its
 * square root, the perimeter ratio. Without an FFMI, geometric similarity (height ÷ height).
 */
export function girthScale(heightCm, modelHeightM, ffmi, leanKg) {
  const hm = modelHeightM
  const hu = heightCm / 100
  if (!(ffmi > 0) || !(leanKg > 0)) return hm / hu
  const leanModel = (ffmi - 6.1 * (1.8 - hm)) * hm * hm
  return Math.sqrt((leanModel / leanKg) / (hm / hu))
}
