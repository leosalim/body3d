/**
 * Fitting the body to a person's tape measures.
 *
 * The model has one morph target per fit region (pipeline anatomy.REGIONS: upper arm, forearm,
 * thigh and lower leg on each side; shoulders, chest, back, neck, core, hips). A region's weight
 * scales its hypertrophy: 0 is the model's minimum FFMI, 1 its maximum, and all weights equal
 * reproduce the uniform body of an FFMI (the model's table).
 *
 * The fit finds the weights w and the FFMI F that minimise, by damped Gauss-Newton
 * (Levenberg-Marquardt) with an active set at the bounds, the sum of four terms — each residual
 * divided by its uncertainty:
 *
 *   1. measures: perimeter of the convex hull of the model's cross-section at each tape site
 *      (probes from pipeline/fitdata.py) against the person's tape without skin and fat
 *      (anthro.js), carried to the model's height. Huber loss: a measure far from the rest
 *      weighs less and comes out flagged as an outlier instead of deforming the body;
 *   2. typical body: w close to the mean body of that FFMI (prior(F), calibrated on ANSUR II),
 *      with the population covariance between regions — a big arm pulls forearm and shoulders
 *      along, both sides move together;
 *   3. FFMI: F close to the measured FFMI (weight, height, body fat), with the uncertainty of
 *      the body-fat method; with no body fat or weight, close to the population mean with a wide
 *      uncertainty — the tapes then decide how much muscle there is;
 *   4. volume: the model's muscle volume at w matches the volume of FFMI F (1 %). This is the
 *      term that takes muscle from one place when another measures more than expected.
 *
 * Everything is in model space (its height). Pure: no three.js, no DOM — it runs in Node.
 * Method, calibration and validation: docs/body-fit.md.
 */
import {
  TAPE_SITES, TAPE_RANGES, skinfoldMm, navyBodyFat, BODY_FAT_SD, DEFAULT_BODY_FAT,
  ffmiNormalized, girthScale
} from './anthro.js'
import { CALIBRATION } from './calibration.generated.js'
import { solve, invert } from './linalg.js'

export { invert }

/** Allowed weight per region (beyond it the meshes start to intersect). */
export const WEIGHT_RANGE = [-0.15, 1.35]
/**
 * Relative error of each site besides the fat: tape technique and level placement. Trunk sites
 * depend more on skeletal breadth and fat shape than on muscle: they weigh less.
 */
const SITE_REL_SD = {
  arm: 0.015, forearm: 0.015, thigh: 0.015, calf: 0.012, neck: 0.025, shoulders: 0.03, chest: 0.035, hips: 0.04
}
const TAPE_REL_SD = 0.01
/**
 * Trunk sites also measure skeletal breadth and fat shape, which the model does not reproduce
 * person by person. With a calibration they enter as a ratio: the person's tape over the mean of
 * the population with the same FFMI (ANSUR II), applied to the cross-section of the typical body.
 */
export const RATIO_SITES = new Set(['neck', 'shoulders', 'chest', 'hips'])
const SITE_CURVE = { arm_l: 'arm', arm_r: 'arm', forearm_l: 'forearm', forearm_r: 'forearm', thigh_l: 'thigh',
  thigh_r: 'thigh', calf_l: 'calf', calf_r: 'calf', neck: 'neck', shoulders: 'shoulders', chest: 'chest', hips: 'hips' }

/** Expected girth (m, muscle and bone, model space) of a site at an FFMI, or null without calibration. */
export function expectedGirth(model, siteId, ffmi) {
  const c = model.calibration?.sites?.[SITE_CURVE[siteId]]
  return c ? Math.sqrt(Math.max(1e-6, c.a + c.b * ffmi)) : null
}
const VOLUME_REL_SD = 0.01
const HUBER_K = 2.5
/**
 * A tape is an outlier when it lies more than OUTLIER_Z deviations from what the FFMI and the
 * other tapes predict for it — the population deviation (ANSUR II), not the fit's. A thigh 15 %
 * above typical is body (the fit follows it); a 52 cm calf on a lean body is an error.
 */
const OUTLIER_Z = 6
const DEFAULT_SITE_SD = 0.04 // relative, without calibration
/**
 * Normalized FFMI of the population [mean, sd] when the person has no body fat or weight: the ANSUR II
 * means (21.72 men, 17.72 women, Navy body fat) with standard deviations ~1.3–1.5× the observed ones
 * (1.90, 1.04) — a deliberately wide prior, so the tapes decide.
 */
const POPULATION_FFMI = { male: [21.7, 2.5], female: [17.7, 1.6] }

// --------------------------------------------------------------------------- model

/**
 * Prepares the fit data of a loaded model (`meta.body` of the GLB). Once per model.
 * @param {object} body  `extras.body` of the GLB (ffmi, regions, heightM, fit)
 * @param {object} [options]
 * @param {object | null} [options.calibration]  calibration to use; by default the one in
 *   calibration.generated.js whose fingerprint matches the model, `null` for none
 * @param {number} [options.populationSpread]  scale of the population covariance (POPULATION_SPREAD)
 */
export function prepareFitModel(body, { calibration, populationSpread = POPULATION_SPREAD } = {}) {
  if (!body?.fit?.sites || !body.regions) return null
  const regions = body.regions
  const R = regions.length
  const unit = body.fit.unit
  const sites = body.fit.sites.map((s) => ({
    id: s.id,
    codes: s.codes,
    mode: s.mode,
    side: s.side,
    regions: Int32Array.from(s.regions),
    levels: s.levels.map((lv) => ({
      f: lv.f,
      origin: lv.origin,
      normal: lv.normal,
      axes: lv.axes,
      base: Float64Array.from(lv.base, (x) => x * unit),
      disp: lv.disp.map((d) => Float64Array.from(d, (x) => x * unit))
    }))
  }))
  const monomials = []
  regions.forEach((rid, owner) => {
    for (const [c, idx] of body.fit.volume[rid] ?? []) monomials.push({ c, idx, owner })
  })
  const table = body.ffmi.table
  const model = {
    sex: body.sex,
    heightM: body.heightM,
    regions,
    R,
    sites,
    siteById: Object.fromEntries(sites.map((s) => [s.id, s])),
    monomials,
    ffmi: body.ffmi,
    table,
    smm: body.ffmi.smm ?? { density: 1.06, coverage: 0.92 },
    populationSpread
  }
  // volume of the uniform body on an FFMI grid (the target of term 4 without calibration)
  const lo = table[0][0], hi = table[table.length - 1][0]
  const grid = []
  for (let f = lo; f <= hi + 1e-9; f += 0.05) grid.push(Math.min(f, hi))
  model.volumeGrid = { lo, step: 0.05, v: grid.map((f) => muscleVolume(model, uniform(R, uniformWeight(model, f))).total) }
  model.calibration = calibration === undefined ? calibrationFor(model) : calibration
  return model
}

function calibrationFor(model) {
  const c = CALIBRATION?.[fingerprint(model)]
  if (!c || c.sex !== model.sex || c.regions?.join() !== model.regions.join()) return null
  return c
}

/** Fingerprint of the fit data: a calibration only holds for the model it was made on. */
export function fingerprint(model) {
  let h = 0
  const add = (x) => { h = (Math.imul(h, 31) + Math.round(x * 1e6)) | 0 }
  for (const s of model.sites) for (const lv of s.levels) { add(lv.base.length); add(lv.base[0] ?? 0); add(lv.base[lv.base.length - 1] ?? 0) }
  for (const m of model.monomials) add(m.c)
  return (h >>> 0).toString(16)
}

function uniform(R, t) {
  return new Float64Array(R).fill(t)
}

/** Uniform weight that draws a normalized FFMI (the model's table; outside it, the nearest end). */
export function uniformWeight(model, ffmi) {
  const t = model.table
  const x = Math.min(t[t.length - 1][0], Math.max(t[0][0], ffmi))
  if (x <= t[0][0]) return t[0][1]
  for (let i = 1; i < t.length; i++) {
    if (x <= t[i][0]) {
      const k = (x - t[i - 1][0]) / (t[i][0] - t[i - 1][0])
      return t[i - 1][1] + (t[i][1] - t[i - 1][1]) * k
    }
  }
  return t[t.length - 1][1]
}

/**
 * Muscle volume (L, model space) of an FFMI and its derivative: the calibrated typical body's
 * (ANSUR II) or, without calibration, the pipeline's uniform body. The total the fit preserves.
 */
export function targetVolume(model, ffmi) {
  const c = model.calibration?.prior
  if (c?.volume) {
    const x = Math.min(Math.max(ffmi, c.ffmi[0]), c.ffmi[c.ffmi.length - 1])
    let i = 0
    while (i < c.ffmi.length - 2 && x > c.ffmi[i + 1]) i++
    const span = c.ffmi[i + 1] - c.ffmi[i]
    const dv = (c.volume[i + 1] - c.volume[i]) / span
    return { v: c.volume[i] + dv * (x - c.ffmi[i]), dv }
  }
  const g = model.volumeGrid
  const x = Math.min(Math.max(ffmi, g.lo), g.lo + g.step * (g.v.length - 1))
  const i = Math.min(g.v.length - 2, Math.floor((x - g.lo) / g.step))
  const k = (x - g.lo) / g.step - i
  return { v: g.v[i] + (g.v[i + 1] - g.v[i]) * k, dv: (g.v[i + 1] - g.v[i]) / g.step }
}

/**
 * Typical body of an FFMI: weights per region. With a calibration (ANSUR II), the population
 * mean; without one, the model's uniform body.
 * @returns {{ w: Float64Array, dw: Float64Array }}  weights and their derivative in the FFMI
 */
export function priorWeights(model, ffmi) {
  const c = model.calibration
  if (!c) {
    const h = 0.01
    const t = uniformWeight(model, ffmi)
    const t2 = uniformWeight(model, ffmi + h)
    return { w: uniform(model.R, t), dw: uniform(model.R, (t2 - t) / h) }
  }
  const g = c.prior
  const x = Math.min(Math.max(ffmi, g.ffmi[0]), g.ffmi[g.ffmi.length - 1])
  let i = 0
  while (i < g.ffmi.length - 2 && x > g.ffmi[i + 1]) i++
  const span = g.ffmi[i + 1] - g.ffmi[i]
  const k = (x - g.ffmi[i]) / span
  const w = new Float64Array(model.R)
  const dw = new Float64Array(model.R)
  for (let r = 0; r < model.R; r++) {
    w[r] = g.weights[i][r] + (g.weights[i + 1][r] - g.weights[i][r]) * k
    dw[r] = (g.weights[i + 1][r] - g.weights[i][r]) / span
  }
  return { w, dw }
}

// --------------------------------------------------------------------------- geometry

/**
 * Girth (m, model space) of a site at weights w, with its gradient in w: the perimeter of the
 * convex hull of the cross-section, at the largest level (limbs) or the smallest (neck).
 */
export function siteGirth(model, site, w) {
  let best = null
  for (const lv of site.levels) {
    const g = levelGirth(model, site, lv, w)
    if (!best || (site.mode === 'max' ? g.value > best.value : g.value < best.value)) best = g
  }
  return best
}

function levelGirth(model, site, lv, w) {
  const n = lv.base.length / 2
  const pts = new Float64Array(lv.base)
  site.regions.forEach((r, k) => {
    const wr = w[r]
    if (wr === 0) return
    const d = lv.disp[k]
    for (let i = 0; i < 2 * n; i++) pts[i] += wr * d[i]
  })
  const hull = convexHull(pts, n)
  let value = 0
  const grad = new Float64Array(model.R)
  const m = hull.length
  for (let a = 0; a < m; a++) {
    const i = hull[a], j = hull[(a + 1) % m]
    const ex = pts[2 * j] - pts[2 * i], ey = pts[2 * j + 1] - pts[2 * i + 1]
    const len = Math.hypot(ex, ey)
    if (len < 1e-12) continue
    value += len
    const ux = ex / len, uy = ey / len
    // d|pj − pi| = u · (dpj − dpi): the hull's vertex set is locally constant
    site.regions.forEach((r, k) => {
      const d = lv.disp[k]
      grad[r] += ux * (d[2 * j] - d[2 * i]) + uy * (d[2 * j + 1] - d[2 * i + 1])
    })
  }
  return { value, grad, level: lv, hull, pts }
}

/** 2D convex hull (Andrew's monotone chain). Indices in counter-clockwise order. */
export function convexHull(pts, n) {
  const idx = Array.from({ length: n }, (_, i) => i)
  idx.sort((a, b) => pts[2 * a] - pts[2 * b] || pts[2 * a + 1] - pts[2 * b + 1])
  const cross = (o, a, b) => (pts[2 * a] - pts[2 * o]) * (pts[2 * b + 1] - pts[2 * o + 1])
    - (pts[2 * a + 1] - pts[2 * o + 1]) * (pts[2 * b] - pts[2 * o])
  const lower = []
  for (const p of idx) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper = []
  for (let k = idx.length - 1; k >= 0; k--) {
    const p = idx[k]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

/** Muscle volume (L, model space) from the cubic polynomial: total, per owning region, gradient in w. */
export function muscleVolume(model, w) {
  const byRegion = new Float64Array(model.R)
  const grad = new Float64Array(model.R)
  let total = 0
  for (const { c, idx, owner } of model.monomials) {
    let prod = c
    for (const r of idx) prod *= w[r]
    total += prod
    byRegion[owner] += prod
    for (let a = 0; a < idx.length; a++) {
      let d = c
      for (let b = 0; b < idx.length; b++) if (b !== a) d *= w[idx[b]]
      grad[idx[a]] += d
    }
  }
  return { total, byRegion, grad }
}

/**
 * Skeletal muscle mass (kg) of a lean mass: the model's SMM/FFM ratio, which rises with the FFMI
 * (Janssen et al. 2000 and strength athletes — docs/anatomy.md).
 */
export function smmFromLean(model, leanKg, ffmi) {
  const t = model.smm.smmFfm
  if (!t) return leanKg * 0.52
  const [[f0, k0], [f1, k1]] = t
  const k = ffmi <= f0 ? k0 : ffmi >= f1 ? k1 : k0 + (k1 - k0) * (ffmi - f0) / (f1 - f0)
  return leanKg * k
}

/** Fraction of the model's muscle in the arms, the legs (with hips) and the trunk. */
function groupFractions(model, byRegion, total) {
  const out = { arms: 0, legs: 0, trunk: 0 }
  model.regions.forEach((rid, r) => {
    const k = /^(upperarm|forearm)/.test(rid) ? 'arms' : /^(thigh|calf|hips)/.test(rid) ? 'legs' : 'trunk'
    out[k] += byRegion[r] / total
  })
  return out
}

// --------------------------------------------------------------------------- input

/**
 * Reads a person's measures and returns the observations in model space.
 * @param {object} model  prepareFitModel(...)
 * @param {object} input  { heightCm, weightKg, bodyFatPercent, bodyFatMethod, ffmi, girths: { CODE: cm } }
 */
export function observe(model, input) {
  const sex = model.sex
  const girths = input.girths ?? {}
  const heightCm = input.heightCm
  const notes = []
  const entries = []
  // tapes outside the plausible range are typos: they enter nothing
  const valid = {}
  for (const [code, raw] of Object.entries(girths)) {
    const v = Number(raw)
    if (!TAPE_SITES[code] || !(v > 0)) continue
    const [lo, hi] = TAPE_RANGES[code]
    if (v < lo || v > hi) {
      entries.push({ code, measuredCm: v, status: 'invalid' })
      continue
    }
    valid[code] = v
  }

  // body fat: the measured one (with its method's uncertainty), the US Navy estimate from tapes, or the typical
  let bodyFat = null
  if (input.bodyFatPercent != null) {
    bodyFat = { value: input.bodyFatPercent, sd: BODY_FAT_SD[input.bodyFatMethod] ?? BODY_FAT_SD.null,
      source: 'measured', method: input.bodyFatMethod ?? null }
  }
  const navy = heightCm ? navyBodyFat(sex, {
    heightCm, neck: valid.NECK, waist: valid.WAIST, abdomen: valid.ABDOMEN, hips: valid.HIPS ?? valid.GLUTES
  }) : null
  if (!bodyFat && navy != null) bodyFat = { value: navy, sd: BODY_FAT_SD.NAVY, source: 'navy', method: 'NAVY' }
  const fatForSkin = bodyFat?.value ?? DEFAULT_BODY_FAT[sex]

  // FFMI: the one given (same formula), or from weight and body fat, or none
  let ffmi = null
  const weightKg = input.weightKg
  if (input.ffmi != null && bodyFat?.source === 'measured') ffmi = input.ffmi
  else if (weightKg && heightCm && bodyFat) ffmi = ffmiNormalized(weightKg, heightCm, bodyFat.value)
  let ffmiSd = null
  if (ffmi != null) {
    // body-fat error carried to the FFMI: Δfat% × weight / height² (without both, ±1)
    const m = heightCm / 100
    ffmiSd = Math.max(0.25, weightKg && heightCm ? (weightKg * bodyFat.sd / 100) / (m * m) : 1)
  }
  const leanKg = weightKg && bodyFat ? weightKg * (1 - bodyFat.value / 100) : null
  const k = heightCm ? girthScale(heightCm, model.heightM, ffmi, leanKg) : 1

  const obs = []
  const bySite = {}
  for (const [code, v] of Object.entries(valid)) {
    const def = TAPE_SITES[code]
    if (!def.site) {
      entries.push({ code, measuredCm: v, status: 'navy' })
      continue
    }
    if (def.site === 'chest' && sex === 'female') {
      // a woman's chest at nipple height measures the breasts, which the model does not have
      entries.push({ code, measuredCm: v, status: 'ignored' })
      continue
    }
    if (!model.siteById[def.site]) continue
    ;(bySite[def.site] ??= []).push({ code, v, fat: def.fat })
  }
  const typical = model.calibration ? priorWeights(model, ffmi ?? POPULATION_FFMI[sex]?.[0] ?? 21).w : null
  const Fref = ffmi ?? POPULATION_FFMI[sex]?.[0] ?? 21
  for (const [site, list] of Object.entries(bySite)) {
    // hips and buttocks are the same loop: their mean counts
    const v = list.reduce((s, x) => s + x.v, 0) / list.length
    const fat = list[0].fat
    const skin = heightCm && weightKg ? skinfoldMm(fat, sex, { heightCm, weightKg, bodyFatPercent: fatForSkin })
      : skinfoldMm(fat, sex, { heightCm: model.heightM * 100, weightKg: 70, bodyFatPercent: fatForSkin })
    const skinSd = bodyFat ? skin.sd : skin.sd * 1.6
    const corrected = v - Math.PI * skin.mm / 10
    const sdFatCm = Math.PI * skinSd / 10
    const sdCm = Math.hypot(TAPE_REL_SD * v, SITE_REL_SD[fat] * v, sdFatCm)
    let y = corrected / 100 * k
    let sd = sdCm / 100 * k
    const expected = expectedGirth(model, site, Fref)
    if (RATIO_SITES.has(site) && expected && typical) {
      // the same ratio over the typical body, on the model's cross-section
      const ratio = siteGirth(model, model.siteById[site], typical).value / expected
      y *= ratio
      sd *= ratio
    }
    obs.push({
      site, codes: list.map((x) => x.code), measuredCm: v, fatMm: skin.mm, correctedCm: corrected, y, sd,
      // share of the uncertainty that is the fat of that site (the rest: tape and level)
      fatShare: (sdFatCm / sdCm) ** 2,
      // what the population with this FFMI and body fat measures, on the tape (cm)
      expectedTapeCm: expected ? (expected / k) * 100 + Math.PI * skin.mm / 10 : null
    })
  }
  if (input.bodyFatPercent == null && navy == null) notes.push('no-body-fat')
  return { sex, heightCm, weightKg, bodyFat, ffmi, ffmiSd, scale: k, obs, entries, notes }
}

// --------------------------------------------------------------------------- fit

/**
 * Fits the model to a person's measures. Without tapes, returns the typical body of the FFMI
 * (the same as `setFfmi`). See docs/api.md for the result.
 * @returns {{ weights: Float64Array, ffmi: number|null, sites: object[], muscle: object,
 *            bodyFat: object|null, uncertainty: Float64Array, iterations: number, measured: number }}
 */
export function fitBody(model, input = {}) {
  const o = observe(model, input)
  const first = solveFit(model, o)
  // consistency: every tape far from typical is compared with what the others predict (leave one out)
  const outliers = new Set()
  if (o.obs.length) {
    const typical = priorWeights(model, first.F).w
    o.obs.forEach((ob, i) => {
      const sdPop = siteSd(model, ob.site, ob.y)
      const ref = siteGirth(model, model.siteById[ob.site], typical).value
      if (Math.abs(ob.y - ref) / Math.hypot(sdPop, ob.sd) <= OUTLIER_Z) return
      const others = { ...o, obs: o.obs.filter((_, j) => j !== i) }
      const loo = solveFit(model, others)
      const pred = siteGirth(model, model.siteById[ob.site], loo.w).value
      if (Math.abs(ob.y - pred) / Math.hypot(sdPop, ob.sd) > OUTLIER_Z) outliers.add(i)
    })
  }
  const fit = outliers.size ? solveFit(model, o, outliers) : first
  return report(model, o, fit, outliers)
}

/** Between-person deviation (m) of a site at the same FFMI: ANSUR II's, or 4 %. */
function siteSd(model, site, y) {
  return model.calibration?.siteSd?.[SITE_CURVE[site]] ?? DEFAULT_SITE_SD * y
}

/** Damped Gauss-Newton over (w, F); `skip`: indices of observations left out. */
function solveFit(model, o, skip = new Set()) {
  if (skip.size) o = { ...o, obs: o.obs.map((ob, i) => (skip.has(i) ? null : ob)).filter(Boolean) }
  const R = model.R
  const pop = POPULATION_FFMI[model.sex] ?? POPULATION_FFMI.male
  const F0 = o.ffmi ?? pop[0]
  const sdF = o.ffmi != null ? o.ffmiSd : pop[1]
  const [fLo, fHi] = [model.table[0][0], model.table[model.table.length - 1][0]]
  const P = priorPrecision(model)
  const N = R + 1

  // start at the typical body of the FFMI
  let F = Math.min(fHi, Math.max(fLo, F0))
  let w = Float64Array.from(priorWeights(model, F).w)
  let robust = o.obs.map(() => 1)
  let lambda = 1e-3
  let cost = Infinity
  let iterations = 0
  const state = (wv, Fv) => evaluate(model, o, wv, Fv, F0, sdF, P)
  let cur = state(w, F)
  for (let it = 0; it < 60; it++) {
    iterations = it + 1
    // robust (Huber) weights from the current residuals — iteratively reweighted
    robust = cur.girthRes.map((r) => (Math.abs(r) <= HUBER_K ? 1 : HUBER_K / Math.abs(r)))
    cost = cur.cost()
    const { H, g } = normalEquations(cur, robust, N)
    let improved = false
    // active set: a weight at its bound that the gradient pushes outwards stays put this step
    const free = new Array(N).fill(true)
    for (let r = 0; r < R; r++) {
      if ((w[r] <= WEIGHT_RANGE[0] + 1e-9 && g[r] > 0) || (w[r] >= WEIGHT_RANGE[1] - 1e-9 && g[r] < 0)) free[r] = false
    }
    if ((F <= fLo + 1e-9 && g[R] > 0) || (F >= fHi - 1e-9 && g[R] < 0)) free[R] = false
    for (let tries = 0; tries < 8; tries++) {
      const A = H.map((row, i) => row.map((x, j) => {
        if (!free[i] || !free[j]) return i === j ? 1 : 0
        return i === j ? x + lambda * (x + 1e-6) : x
      }))
      const step = solve(A, g.map((x, i) => (free[i] ? -x : 0)))
      if (!step) { lambda *= 10; continue }
      const w2 = new Float64Array(R)
      for (let r = 0; r < R; r++) w2[r] = clamp(w[r] + step[r], WEIGHT_RANGE[0], WEIGHT_RANGE[1])
      const F2 = clamp(F + step[R], fLo, fHi)
      const next = state(w2, F2)
      const c2 = next.cost()
      if (c2 < cost) {
        const gain = cost - c2
        w = w2; F = F2; cur = next
        lambda = Math.max(1e-7, lambda / 3)
        improved = gain > 1e-6 * (1 + cost)
        cost = c2
        break
      }
      lambda *= 4
    }
    if (!improved) break
  }

  // uncertainty: inverse of the normal matrix at the optimum (Laplace approximation)
  const { H } = normalEquations(cur, robust, N)
  const cov = invert(H)
  const uncertainty = new Float64Array(R)
  for (let r = 0; r < R; r++) uncertainty[r] = cov ? Math.sqrt(Math.max(0, cov[r][r])) : NaN

  return { w, F, cur, uncertainty, iterations }
}

/** Builds the fit result: weights, FFMI, every site (measured, expected, fitted), muscle. */
function report(model, o, fit, outliers) {
  const { w, F, uncertainty, iterations } = fit
  const kept = o.obs.map((_, i) => i).filter((i) => !outliers.has(i))
  const girthOf = (i) => siteGirth(model, model.siteById[o.obs[i].site], w).value
  const prior = priorWeights(model, F).w
  const vol = muscleVolume(model, w)
  const k = o.scale
  const sites = []
  o.obs.forEach((ob, i) => {
    const site = model.siteById[ob.site]
    const fittedGirth = girthOf(i)
    // from model to tape: undo the height scale (and the ratio, on the trunk), add skin and fat back
    const toTape = (g) => (g * ob.correctedCm) / ob.y + (ob.measuredCm - ob.correctedCm)
    const expected = ob.expectedTapeCm ?? toTape(siteGirth(model, site, prior).value)
    const z = (fittedGirth - ob.y) / ob.sd
    // what the muscle does not explain goes, in proportion to the uncertainties, to the fat of that
    // site: with a firm FFMI, a large thigh on a woman is largely fat (and the drawn tape matches
    // the measure). An outlier leaves the fat alone.
    const muscleTape = toTape(fittedGirth)
    const fatCm = outliers.has(i) ? 0 : (ob.measuredCm - muscleTape) * ob.fatShare
    const fatMm = Math.max(1, ob.fatMm + (fatCm * 10) / Math.PI)
    sites.push({
      site: ob.site, codes: ob.codes, measuredCm: ob.measuredCm, fatMm: round(fatMm, 1),
      fatTypicalMm: round(ob.fatMm, 1), correctedCm: round(ob.correctedCm, 1), expectedCm: round(expected, 1),
      fittedCm: round(muscleTape + fatCm, 1), muscleOnlyFitCm: round(muscleTape, 1), z: round(z, 2),
      status: outliers.has(i) ? 'outlier' : 'ok'
    })
  })
  for (const e of o.entries) sites.push({ site: TAPE_SITES[e.code]?.site ?? null, codes: [e.code], measuredCm: e.measuredCm, status: e.status })

  // the person's muscle mass: from the lean mass (weight and body fat), moved with the FFMI when
  // the tapes pull it
  const leanUser = o.weightKg && o.bodyFat ? o.weightKg * (1 - o.bodyFat.value / 100) : null
  const leanFit = leanUser && o.ffmi != null && o.heightCm ? leanUser + (F - o.ffmi) * (o.heightCm / 100) ** 2 : null
  const byRegion = {}
  model.regions.forEach((rid, r) => { byRegion[rid] = vol.byRegion[r] / vol.total })
  return {
    weights: w,
    ffmi: round(F, 2),
    ffmiMeasured: o.ffmi != null ? round(o.ffmi, 2) : null,
    bodyFat: o.bodyFat ? { ...o.bodyFat, value: round(o.bodyFat.value, 1) } : null,
    scale: k,
    sites,
    measured: kept.length,
    muscle: {
      volumeL: round(vol.total, 3),
      targetL: round(targetVolume(model, F).v, 3),
      kg: leanFit ? round(smmFromLean(model, leanFit, F), 1) : null,
      fractions: byRegion,
      groups: groupFractions(model, vol.byRegion, vol.total)
    },
    uncertainty,
    iterations,
    notes: o.notes
  }
}

function evaluate(model, o, w, F, F0, sdF, P) {
  const R = model.R
  const girths = [], girthRes = [], girthGrad = []
  for (const ob of o.obs) {
    const g = siteGirth(model, model.siteById[ob.site], w)
    girths.push(g.value)
    girthRes.push((g.value - ob.y) / ob.sd)
    girthGrad.push(g.grad.map((x) => x / ob.sd))
  }
  const pr = priorWeights(model, F)
  const dev = new Float64Array(R)
  for (let r = 0; r < R; r++) dev[r] = w[r] - pr.w[r]
  const vol = muscleVolume(model, w)
  const tv = targetVolume(model, F)
  const sdV = VOLUME_REL_SD * tv.v
  const volRes = (vol.total - tv.v) / sdV
  const fRes = (F - F0) / sdF
  return {
    girths, girthRes, girthGrad, dev, prDw: pr.dw, P,
    volRes, volGrad: vol.grad.map((x) => x / sdV), volDF: -tv.dv / sdV,
    fRes, fGrad: 1 / sdF,
    cost() {
      let c = 0
      for (const r of girthRes) c += huber(r)
      for (let a = 0; a < R; a++) for (let b = 0; b < R; b++) c += 0.5 * dev[a] * P[a][b] * dev[b]
      return c + 0.5 * volRes * volRes + 0.5 * fRes * fRes
    }
  }
}

function huber(r) {
  const a = Math.abs(r)
  return a <= HUBER_K ? 0.5 * r * r : HUBER_K * (a - 0.5 * HUBER_K)
}

/** Gauss-Newton normal equations: H = JᵀΩJ, g = JᵀΩr over (w, F). */
function normalEquations(s, robust, N) {
  const R = N - 1
  const H = Array.from({ length: N }, () => new Float64Array(N))
  const g = new Float64Array(N)
  s.girthRes.forEach((r, i) => {
    const J = s.girthGrad[i]
    const om = robust[i]
    for (let a = 0; a < R; a++) {
      if (!J[a]) continue
      g[a] += om * J[a] * r
      for (let b = 0; b < R; b++) if (J[b]) H[a][b] += om * J[a] * J[b]
    }
  })
  // prior: ½ (w − μ(F))ᵀ P (w − μ(F)); d/dF through −dμ/dF
  const P = s.P
  for (let a = 0; a < R; a++) {
    let pd = 0, pm = 0
    for (let b = 0; b < R; b++) {
      pd += P[a][b] * s.dev[b]
      pm += P[a][b] * s.prDw[b]
      H[a][b] += P[a][b]
    }
    g[a] += pd
    H[a][R] -= pm
    H[R][a] -= pm
    g[R] -= s.prDw[a] * pd
  }
  let mpm = 0
  for (let a = 0; a < R; a++) for (let b = 0; b < R; b++) mpm += s.prDw[a] * P[a][b] * s.prDw[b]
  H[R][R] += mpm
  // volume
  for (let a = 0; a < R; a++) {
    g[a] += s.volGrad[a] * s.volRes
    for (let b = 0; b < R; b++) H[a][b] += s.volGrad[a] * s.volGrad[b]
    H[a][R] += s.volGrad[a] * s.volDF
    H[R][a] += s.volGrad[a] * s.volDF
  }
  g[R] += s.volDF * s.volRes + s.fGrad * s.fRes
  H[R][R] += s.volDF * s.volDF + s.fGrad * s.fGrad
  return { H: H.map((row) => Array.from(row)), g: Array.from(g) }
}

/**
 * Precision (inverse covariance) of the typical body between regions. Calibrated on ANSUR II
 * when there is a calibration; otherwise a default structure: one factor per zone (upper, lower,
 * core), one per limb pair and one per side. Cached per calibration and spread.
 */
function priorPrecision(model) {
  const cal = model.calibration ?? null
  const spread = model.populationSpread ?? POPULATION_SPREAD
  const cached = model._precision
  if (cached && cached.calibration === cal && cached.spread === spread) return cached.P
  const c = cal?.covariance
  const cov = c ? c.map((row) => row.map((x) => x * spread ** 2)) : defaultCovariance(model.regions)
  const P = invert(cov.map((row, i) => row.map((x, j) => x + (i === j ? 1e-6 : 0))))
  model._precision = { calibration: cal, spread, P }
  return P
}

/**
 * How much wider (standard deviation) the between-region variation of a training population is
 * than ANSUR II's. Soldiers train alike; a training app has cyclists with huge thighs, people who
 * skip leg day, bodybuilders — with ANSUR's deviation a thigh 15 % above typical became an
 * "outlier" instead of body. The correlations, which carry information from the measured regions
 * to the others, stay ANSUR's; only the scale grows. docs/body-fit.md has the trade-off measured.
 */
export const POPULATION_SPREAD = 3

const ZONES = {
  upperarm: 'upper', forearm: 'upper', shoulders: 'upper', chest: 'upper', back: 'upper', neck: 'upper',
  thigh: 'lower', calf: 'lower', hips: 'lower', core: 'core'
}

export function defaultCovariance(regions, { zone = 0.07, pair = 0.07, side = 0.025 } = {}) {
  const base = (id) => id.replace(/_[lr]$/, '')
  return regions.map((a) => regions.map((b) => {
    let c = 0
    if (ZONES[base(a)] === ZONES[base(b)]) c += zone * zone
    if (base(a) === base(b)) c += pair * pair
    if (a === b) c += side * side
    return c
  }))
}

// --------------------------------------------------------------------------- helpers

function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x))
}

function round(x, d) {
  const f = 10 ** d
  return Math.round(x * f) / f
}
