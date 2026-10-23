// Validates the tape-measure fit on real bodies from ANSUR II.
//
//   node dev/calibrate.mjs <csv> --holdout --json cal.json        # calibrate on half (even rows)
//   node dev/validate-ansur.mjs <csv> --calibration cal.json [--n 600] [--spread 3]
//                               [--body-fat navy|bmi] [--json out.json]
//
// Uses the other half (odd rows), which the calibration never saw. For every person:
//   1. fits with every tape: time, iterations, standardized residuals, tapes flagged as
//      outliers, how far the FFMI moved;
//   2. leave one out: hides each site and predicts it (a) from height, weight and body fat alone —
//      the typical body of the FFMI —, (b) with one neighbouring tape, (c) with all the other
//      tapes and, as a diagnostic, (d) with the other limb tapes only (no trunk tape);
//   3. the same predictions by two statistical baselines trained on the calibration half: the sex
//      mean, and ridge regression on the same inputs (height, weight, body fat, the given tapes).
// --body-fat bmi replaces the US Navy body fat (which reads the neck, waist and hips) by a
// girth-free estimate, so that column (a) is blind to every tape. --spread overrides
// POPULATION_SPREAD (the width of the prior) to measure its effect. Without --calibration it uses
// the repository calibration, which saw every row (in-sample).
import { readFileSync, writeFileSync } from 'node:fs'
import { readCsv } from './lib/ansur.mjs'
import { fitRidge } from './lib/ridge.mjs'
import {
  SITES, LIMB_SITES, PARTNER, BODY_FAT_SOURCES, usedSite, fitModel, holdoutPeople, predictTape,
  rms, mean, percentile, r2
} from './lib/holdout.mjs'
import { fitBody, POPULATION_SPREAD } from '../src/fit.js'

const args = process.argv.slice(2)
const csvPath = args[0]
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d }
if (!csvPath) {
  console.error('usage: node dev/validate-ansur.mjs <csv> [--calibration cal.json] [--n 600] [--spread 3] ' +
    '[--body-fat navy|bmi] [--json out.json]')
  process.exit(1)
}
const N = Number(opt('--n', 600))
const spread = Number(opt('--spread', POPULATION_SPREAD))
const bodyFat = opt('--body-fat', 'navy')
if (!BODY_FAT_SOURCES.includes(bodyFat)) throw new Error(`--body-fat: one of ${BODY_FAT_SOURCES.join(', ')}`)
const calFile = opt('--calibration')
const calibrations = calFile ? JSON.parse(readFileSync(calFile, 'utf8')) : null
const rows = readCsv(csvPath)

// what each prediction knows besides height, weight and body fat
const GIVEN = {
  prior: () => [],
  one: (sex, code) => (usedSite(sex, PARTNER[code]) ? [PARTNER[code]] : null),
  all: (sex, code) => SITES.filter((c) => c !== code && usedSite(sex, c)),
  limbs: (sex, code) => LIMB_SITES.filter((c) => c !== code)
}
const features = (p, codes) => [p.heightCm, p.weightKg, p.bodyFatPercent, ...codes.map((c) => p.girths[c])]

/** Ridge models per site and information set, trained on the calibration half. */
function trainBaselines(sex, train) {
  const out = {}
  for (const code of SITES.filter((c) => usedSite(sex, c))) {
    const known = train.filter((p) => p.girths[code] > 0)
    out[code] = { mean: mean(known.map((p) => p.girths[code])) }
    for (const [k, given] of Object.entries(GIVEN)) {
      const codes = given(sex, code)
      if (!codes) continue
      const rowsK = known.filter((p) => codes.every((c) => p.girths[c] > 0))
      out[code][k] = fitRidge(rowsK.map((p) => features(p, codes)), rowsK.map((p) => p.girths[code]))
    }
  }
  return out
}

const COLUMNS = ['mean', 'ridgePrior', 'prior', 'ridgeOne', 'one', 'ridgeAll', 'all', 'ridgeLimbs', 'limbs']
const summary = { calibration: calFile ? 'holdout' : 'repository', spread, bodyFat, sexes: {} }
for (const sex of ['male', 'female']) {
  const model = fitModel(sex, { calibrations, spread })
  const people = holdoutPeople(rows, model, sex, { parity: 1, bodyFat, n: N })
  const baselines = trainBaselines(sex, holdoutPeople(rows, model, sex, { parity: 0, bodyFat }))
  const times = [], iters = [], zs = [], dF = []
  let outliers = 0, sitesSeen = 0
  const err = Object.fromEntries(COLUMNS.map((k) => [k, Object.fromEntries(SITES.map((s) => [s, []]))]))
  for (const p of people) {
    const tapes = p.girths
    const t0 = performance.now()
    const res = fitBody(model, p)
    times.push(performance.now() - t0)
    iters.push(res.iterations)
    if (res.ffmiMeasured != null) dF.push(res.ffmi - res.ffmiMeasured)
    for (const s of res.sites) {
      if (s.status !== 'ok' && s.status !== 'outlier') continue
      sitesSeen++
      zs.push(s.z)
      if (s.status === 'outlier') outliers++
    }
    const prior = fitBody(model, { ...p, girths: {} })
    for (const code of SITES) {
      const truth = tapes[code]
      if (truth == null || !usedSite(sex, code)) continue
      const b = baselines[code]
      err.mean[code].push(b.mean - truth)
      for (const [k, given] of Object.entries(GIVEN)) {
        const codes = given(sex, code)
        if (!codes || !codes.every((c) => tapes[c] > 0)) continue
        const fit = k === 'prior' ? prior : fitBody(model, { ...p, girths: Object.fromEntries(codes.map((c) => [c, tapes[c]])) })
        const predicted = predictTape(model, p, code, fit.weights, truth)
        if (predicted != null) err[k][code].push(predicted - truth)
        err[`ridge${k[0].toUpperCase()}${k.slice(1)}`][code].push(b[k].predict(features(p, codes)) - truth)
      }
    }
  }
  const rmsCm = Object.fromEntries(SITES.filter((c) => err.all[c].length).map((c) => [c, {
    ...Object.fromEntries(COLUMNS.map((k) => [k, err[k][c].length ? r2(rms(err[k][c])) : null])),
    biasAll: r2(mean(err.all[c])), biasPrior: r2(mean(err.prior[c]))
  }]))
  const limbMean = Object.fromEntries(COLUMNS.map((k) => [k, r2(mean(LIMB_SITES.map((c) => rms(err[k][c]))))]))
  const s = {
    people: people.length,
    fitMs: { mean: r2(mean(times)), p95: r2(percentile(times, 0.95)) },
    iterations: { p50: percentile(iters, 0.5), p95: percentile(iters, 0.95) },
    absZ: { p50: r2(percentile(zs.map(Math.abs), 0.5)), p95: r2(percentile(zs.map(Math.abs), 0.95)) },
    outlierPercent: r2(100 * outliers / sitesSeen),
    ffmiShift: { mean: r2(mean(dF)), p5: r2(percentile(dF, 0.05)), p95: r2(percentile(dF, 0.95)) },
    rmsCm,
    limbMean
  }
  summary.sexes[sex] = s
  console.log(`\n=== ${sex}: ${s.people} people outside the calibration ` +
    `${calibrations ? '(calibrated on the other half)' : '(repository calibration: in-sample)'}, spread ${spread}, ` +
    `body fat: ${bodyFat === 'bmi' ? 'BMI and age (no tape)' : 'US Navy (neck, waist, hips)'}`)
  console.log(`  fit with every tape: ${s.fitMs.mean} ms mean (p95 ${s.fitMs.p95} ms), iterations p50 ${s.iterations.p50} / p95 ${s.iterations.p95}`)
  console.log(`  standardized residuals: |z| p50 ${s.absZ.p50}, p95 ${s.absZ.p95}; flagged as outliers ${s.outlierPercent} %`)
  console.log(`  fitted FFMI − measured FFMI: mean ${s.ffmiShift.mean}, p5 ${s.ffmiShift.p5}, p95 ${s.ffmiShift.p95}`)
  console.log('  predicting a hidden tape — RMS error (cm); ridge = ridge regression on the same inputs')
  console.log('                  sex mean │ h, w, fat: ridge    fit │ + one tape: ridge    fit │ + all others: ridge    fit │' +
    ' + limb tapes: ridge    fit │ bias (fit, all)')
  const f = (v) => (v == null ? '—' : v.toFixed(2)).padStart(6)
  const line = (name, v, bias) => console.log(`    ${name.padEnd(13)} ${f(v.mean)} │ ${f(v.ridgePrior)} ${f(v.prior)}        │` +
    ` ${f(v.ridgeOne)} ${f(v.one)}         │ ${f(v.ridgeAll)} ${f(v.all)}           │ ${f(v.ridgeLimbs)} ${f(v.limbs)}           │ ${bias}`)
  for (const [c, v] of Object.entries(rmsCm)) line(c, v, `${v.biasAll >= 0 ? '+' : ''}${v.biasAll.toFixed(2)}`)
  line('limb mean', limbMean, '')
}
const jsonAt = args.indexOf('--json')
if (jsonAt >= 0) writeFileSync(args[jsonAt + 1], JSON.stringify(summary, null, 2) + '\n')
