// Calibrates the typical body of every FFMI and the variation between regions on ANSUR II, and
// writes src/calibration.generated.js.
//
//   node dev/calibrate.mjs <ANSUR II .csv> [--write] [--holdout] [--json <file>]
//
// --holdout calibrates on the even rows only (dev/validate-ansur.mjs validates on the odd ones);
// --json writes the calibration to a file instead of the module (for the validation).
// Run it again whenever the models change (pipeline/build.py): a calibration only holds for the
// model it was made on (its fingerprint). See docs/body-fit.md for the method.
//
// For every person: body fat by the US Navy method (neck, waist and hips from ANSUR itself), the
// normalized FFMI, and every girth carried to the model space exactly as the fit does with a
// user's tapes (anthro.js: minus skin and fat, height scale). Then:
//   1. expected curve of each site: cross-section area (girth²) linear in the FFMI;
//   2. covariance of the deviations between sites at the same FFMI, without the noise of the
//      tape and of the estimated fat, and without the Navy FFMI error (a factor common to all);
//   3. typical body (weights per region) at every FFMI of the model's range: the one that
//      reproduces the curves with the muscle volume of that FFMI;
//   4. covariance of the region weights (that of step 2 carried to the weights by the Jacobian).
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { readBody } from './glb.mjs'
import { readCsv, subject, NAVY_SD_PERCENT } from './lib/ansur.mjs'
import { zeros, transpose, multiply, identity, leastSquaresStep, nearestPositiveDefinite } from './lib/matrix.mjs'
import { invert } from '../src/linalg.js'
import {
  prepareFitModel, observe, siteGirth, muscleVolume, targetVolume, uniformWeight, defaultCovariance, fingerprint,
  WEIGHT_RANGE, POPULATION_SPREAD
} from '../src/fit.js'

const ROOT = new URL('..', import.meta.url)
const [csvPath, ...flags] = process.argv.slice(2)
if (!csvPath) {
  console.error('usage: node dev/calibrate.mjs <ANSUR II .csv> [--write] [--holdout] [--json <file>]')
  process.exit(1)
}

const rows = readCsv(csvPath).filter((_, i) => !flags.includes('--holdout') || i % 2 === 0)

// ------------------------------------------------------------------ per sex
const SITE_OF = { RIGHT_BICEP: 'arm', RIGHT_FOREARM: 'forearm', RIGHT_THIGH: 'thigh', RIGHT_CALF: 'calf',
  NECK: 'neck', SHOULDERS: 'shoulders', CHEST: 'chest', HIPS: 'hips' }
const SITE_IDS = { arm: ['arm_r', 'arm_l'], forearm: ['forearm_r', 'forearm_l'], thigh: ['thigh_r', 'thigh_l'],
  calf: ['calf_r', 'calf_l'], neck: ['neck'], shoulders: ['shoulders'], chest: ['chest'], hips: ['hips'] }
const SYM = ['upperarm', 'forearm', 'thigh', 'calf', 'shoulders', 'chest', 'back', 'neck', 'core', 'hips']
const LIMB_SITES = ['arm', 'forearm', 'thigh', 'calf']
const symOf = (rid) => rid.replace(/_[lr]$/, '')

function calibrate(sex, lod = '') {
  const body = readBody(fileURLToPath(new URL(`public/models/${sex}${lod}.glb`, ROOT)))
  const model = prepareFitModel(body, { calibration: null })
  const R = model.R
  const [fLo, fHi] = [model.table[0][0], model.table[model.table.length - 1][0]]

  // 1. observations in model space
  const people = []
  for (const r of rows) {
    const s = subject(r)
    if (s.sex !== sex || !(s.heightCm > 120) || !(s.weightKg > 30)) continue
    const o = observe(model, { ...s, bodyFatMethod: 'NAVY' })
    if (o.bodyFat?.source !== 'navy' || o.ffmi == null || o.ffmi < fLo || o.ffmi > fHi) continue
    const ys = {}
    for (const ob of o.obs) ys[SITE_OF[ob.codes[0]]] = { y: ob.y, sd: ob.sd }
    const m = s.heightCm / 100
    people.push({ F: o.ffmi, ys, sdF: (s.weightKg * NAVY_SD_PERCENT / 100) / (m * m), bf: o.bodyFat.value })
  }
  const sites = Object.keys(SITE_IDS).filter((k) => people.some((p) => p.ys[k]))

  // 2. curves: area (y²) = a + b·F, least squares with a second pass without the extremes
  const curve = {}
  for (const site of sites) {
    let pts = people.filter((p) => p.ys[site]).map((p) => [p.F, p.ys[site].y])
    let a = 0, b = 0, sd = 0
    for (let pass = 0; pass < 2; pass++) {
      const n = pts.length
      const mx = pts.reduce((s, [x]) => s + x, 0) / n
      const my = pts.reduce((s, [, y]) => s + y * y, 0) / n
      const sxy = pts.reduce((s, [x, y]) => s + (x - mx) * (y * y - my), 0)
      const sxx = pts.reduce((s, [x]) => s + (x - mx) ** 2, 0)
      b = sxy / sxx
      a = my - b * mx
      const res = pts.map(([x, y]) => y - Math.sqrt(Math.max(1e-6, a + b * x)))
      sd = Math.sqrt(res.reduce((s, e) => s + e * e, 0) / n)
      pts = pts.filter((_, i) => Math.abs(res[i]) < 3.5 * sd)
    }
    curve[site] = { a, b, sd, n: pts.length }
  }
  const E = (site, F) => Math.sqrt(Math.max(1e-6, curve[site].a + curve[site].b * F))

  // 3. covariance of the deviations at the same FFMI (complete cases), without the tape and fat
  //    noise. The Navy FFMI error stays in (a factor common to every site): removing it would
  //    need each person's error.
  const full = people.filter((p) => sites.every((s) => p.ys[s]))
  const k = sites.length
  const C = zeros(k, k)
  const noise = new Array(k).fill(0)
  for (const p of full) {
    const e = sites.map((s) => p.ys[s].y - E(s, p.F))
    for (let i = 0; i < k; i++) {
      noise[i] += p.ys[sites[i]].sd ** 2
      for (let j = 0; j < k; j++) C[i][j] += e[i] * e[j]
    }
  }
  const nF = full.length
  const Fmean = people.reduce((s, p) => s + p.F, 0) / people.length
  const Cobs = C.map((row) => row.map((x) => x / nF))
  // the modelled noise may not exceed the observed variance: at most 80 % of it
  const Ctrue = nearestPositiveDefinite(
    Cobs.map((row, i) => row.map((x, j) => x - (i === j ? Math.min(noise[i] / nF, 0.8 * Cobs[i][i]) : 0))), 1e-8)
  const noiseShare = sites.map((_, i) => Math.min(1, (noise[i] / nF) / Cobs[i][i]))

  // 4. typical body of each FFMI: the weights that reproduce the curves. Its muscle volume becomes
  //    the volume of the FFMI in the fit (the pipeline table, FFMI → volume by the SMM/FFM ratio,
  //    gives 7–23 % more muscle than fits in real bodies with those tapes)
  const grid = []
  for (let f = Math.ceil(fLo * 2) / 2; f <= fHi + 1e-9; f += 0.5) grid.push(Math.round(f * 10) / 10)
  const weights = []
  const volume = []
  let w = new Float64Array(R).fill(uniformWeight(model, grid[0]))
  for (const F of grid) {
    w = solvePrior(model, F, w, sites, E)
    weights.push(Array.from(w, (x) => Math.round(x * 1e5) / 1e5))
    volume.push(Math.round(muscleVolume(model, w).total * 1e4) / 1e4)
  }

  // 5. covariance of the weights: site deviations → region deviations (Jacobian at the mean FFMI)
  const wMean = solvePrior(model, Fmean, new Float64Array(R).fill(uniformWeight(model, Fmean)), sites, E)
  const vGap = muscleVolume(model, wMean).total / targetVolume(model, Fmean).v - 1
  const J = sites.map((s) => {
    const row = new Array(SYM.length).fill(0)
    const gr = siteGirth(model, model.siteById[SITE_IDS[s][0]], wMean).grad
    model.regions.forEach((rid, r) => {
      if (rid.endsWith('_l')) return // ANSUR measures the right side
      row[SYM.indexOf(symOf(rid))] += gr[r]
    })
    return row
  })
  const JT = transpose(J)
  const ridge = 1e-6
  const JTJ = multiply(JT, J).map((row, i) => row.map((x, j) => x + (i === j ? ridge : 0)))
  const Jp = multiply(invert(JTJ), JT) // (10 × k)
  const Csym = multiply(multiply(Jp, Ctrue), transpose(Jp))
  // directions no site sees (back and core inside the chest): the default structure
  const Nproj = identity(SYM.length).map((r, i) => r.map((x, j) => x - multiply(Jp, J)[i][j]))
  // the fit multiplies the covariance by POPULATION_SPREAD²; the part that does not come from data
  // must not grow with it (or a region without a tape would become too cheap to move)
  const D = defaultCovariance(SYM).map((row) => row.map((x) => x / POPULATION_SPREAD ** 2))
  const Cnull = multiply(multiply(Nproj, D), transpose(Nproj))
  const Cw = Csym.map((row, i) => row.map((x, j) => x + Cnull[i][j]))
  // asymmetry between sides: ~2 % of the limb girth
  const sideSd = {}
  for (const s of LIMB_SITES) {
    const reg = { arm: 'upperarm', forearm: 'forearm', thigh: 'thigh', calf: 'calf' }[s]
    sideSd[reg] = 0.02 * E(s, Fmean) / Math.max(1e-6, J[sites.indexOf(s)][SYM.indexOf(reg)])
  }
  const cov = model.regions.map((a) => model.regions.map((b) => {
    const ia = SYM.indexOf(symOf(a)), ib = SYM.indexOf(symOf(b))
    let c = Cw[ia][ib]
    if (a === b && sideSd[symOf(a)]) c += sideSd[symOf(a)] ** 2
    return Math.round(c * 1e8) / 1e8
  }))

  const report = {
    n: people.length, complete: nF, ffmi: { mean: round(Fmean, 2), min: round(Math.min(...people.map((p) => p.F)), 1),
      max: round(Math.max(...people.map((p) => p.F)), 1) },
    bodyFat: round(people.reduce((s, p) => s + p.bf, 0) / people.length, 1),
    volumeVsTable: round(vGap * 100, 1),
    sites: Object.fromEntries(sites.map((s, i) => [s, {
      // muscle-only girth on the model (cm) at 3 FFMIs, the between-person deviation and what is left without noise
      at: [Math.round(Fmean - 3), Math.round(Fmean), Math.round(Fmean + 3)].map((F) => round(E(s, F) * 100, 1)),
      residualCm: round(curve[s].sd * 100, 2), trueSdCm: round(Math.sqrt(Ctrue[i][i]) * 100, 2),
      noiseShare: round(noiseShare[i], 2), n: curve[s].n
    }])),
    correlation: Object.fromEntries(sites.map((s, i) => [s, sites.map((_, j) =>
      round(Ctrue[i][j] / Math.sqrt(Ctrue[i][i] * Ctrue[j][j]), 2))]))
  }
  return {
    calibration: {
      source: 'ANSUR II (2012), public data; dev/calibrate.mjs',
      sex,
      model: `${sex}${lod}.glb`,
      regions: model.regions,
      fingerprint: fingerprint(model),
      // expected curves (muscle and bone, model space): y = √(a + b·FFMI), in m
      sites: Object.fromEntries(sites.map((s) => [s, { a: curve[s].a, b: curve[s].b }])),
      // between-person deviation at the same FFMI, without tape and fat noise (m)
      siteSd: Object.fromEntries(sites.map((s, i) => [s, Math.sqrt(Ctrue[i][i])])),
      prior: { ffmi: grid, weights, volume },
      covariance: cov,
      summary: report
    },
    report
  }
}

/**
 * Typical body at FFMI F. The limbs (upper arm, forearm, thigh, lower leg) reproduce the ANSUR
 * curves in absolute value: they are almost all muscle, and the model's cross-section compares
 * with a person's. The trunk (shoulders, chest, back, neck, core, hips) keeps the model's
 * hypertrophy for that FFMI: trunk tapes also measure skeletal breadth and fat shape, and
 * matching them in absolute value drove the deltoids to the minimum and the glutes to the
 * maximum. In the fit, trunk tapes enter as a ratio over the population mean (fit.js RATIO_SITES).
 */
function solvePrior(model, F, start, sites, E) {
  const R = model.R
  const limbSites = sites.filter((s) => LIMB_SITES.includes(s))
  const u = uniformWeight(model, F)
  const trunk = model.regions.map((rid) => !/^(upperarm|forearm|thigh|calf)_/.test(rid))
  let w = Float64Array.from(start, (x, r) => (trunk[r] ? u : x))
  const residuals = (wv) => {
    const rowsJ = [], res = []
    for (const s of limbSites) {
      const target = E(s, F)
      for (const id of SITE_IDS[s]) {
        const gg = siteGirth(model, model.siteById[id], wv)
        const sd = 0.004 * target
        res.push((gg.value - target) / sd)
        rowsJ.push(Array.from(gg.grad, (x, r) => (trunk[r] ? 0 : x / sd)))
      }
    }
    // both sides of each limb together (ANSUR measures one side)
    for (let r = 0; r < R; r++) {
      const rid = model.regions[r]
      if (!rid.endsWith('_l')) continue
      const o = model.regions.indexOf(rid.replace(/_l$/, '_r'))
      const row = new Array(R).fill(0)
      row[r] = 1 / 0.01
      row[o] = -1 / 0.01
      res.push((wv[r] - wv[o]) / 0.01)
      rowsJ.push(row)
    }
    return { rowsJ, res, cost: res.reduce((s2, x) => s2 + x * x, 0) }
  }
  let cur = residuals(w)
  let damping = 1e-3
  for (let it = 0; it < 100; it++) {
    const step = leastSquaresStep(cur.rowsJ, cur.res, R, damping)
    const w2 = w.map((x, r) => (trunk[r] ? u : Math.min(WEIGHT_RANGE[1], Math.max(WEIGHT_RANGE[0], x + step[r]))))
    const next = residuals(w2)
    if (next.cost < cur.cost) {
      const done = cur.cost - next.cost < 1e-10 * (1 + cur.cost)
      w = Float64Array.from(w2); cur = next
      damping = Math.max(1e-8, damping / 3)
      if (done) break
    } else {
      damping *= 5
      if (damping > 1e8) break
    }
  }
  return w
}

const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d

const out = {}
for (const [sex, lod] of [['male', ''], ['male', '-lite'], ['female', ''], ['female', '-lite']]) {
  const { calibration, report } = calibrate(sex, lod)
  out[calibration.fingerprint] = calibration
  if (lod) {
    console.log(`\n=== ${sex}${lod}: calibrated (${calibration.fingerprint})`)
    continue
  }
  console.log(`\n=== ${sex}: ${report.n} people (${report.complete} with every site), FFMI ${report.ffmi.mean} ` +
    `(${report.ffmi.min}–${report.ffmi.max}), mean body fat ${report.bodyFat} %; ` +
    `volume of the typical body vs the pipeline table: ${report.volumeVsTable} %`)
  for (const [s, v] of Object.entries(report.sites)) {
    console.log(`  ${s.padEnd(10)} muscle on the model at FFMI −3/mean/+3: ${v.at.join(' / ')} cm; ` +
      `between-person sd ${v.residualCm} cm, without noise ${v.trueSdCm} cm (noise ${Math.round(v.noiseShare * 100)} % of the variance, n=${v.n})`)
  }
  console.log('  correlations:', JSON.stringify(report.correlation))
  const g = calibration.prior
  for (const F of new Set([g.ffmi[0], 18, 20, 22, 24, 26, g.ffmi[g.ffmi.length - 1]])) {
    const i = g.ffmi.indexOf(F)
    if (i < 0) continue
    console.log(`  typical body at FFMI ${F}:`, calibration.regions.map((r, kk) => `${r}=${g.weights[i][kk].toFixed(2)}`).join(' '))
  }
}

const jsonAt = flags.indexOf('--json')
if (jsonAt >= 0) {
  writeFileSync(flags[jsonAt + 1], JSON.stringify(out))
  console.log('\nwrote', flags[jsonAt + 1])
}
if (flags.includes('--write')) {
  const file = new URL('src/calibration.generated.js', ROOT)
  writeFileSync(file, '// Generated by dev/calibrate.mjs from ANSUR II — do not edit by hand.\n' +
    '// Typical body per FFMI and variation between regions, per model — keyed by the fingerprint of\n' +
    "// the GLB's fit data (fit.js): a rebuilt model needs a new calibration.\n" +
    `export const CALIBRATION = ${JSON.stringify(out)}\n`)
  console.log('\nwrote', fileURLToPath(file))
}
