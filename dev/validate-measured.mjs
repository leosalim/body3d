// Validates the tape-measure fit on people you measured yourself — the studies described in
// docs/validation/studies.md: trained people (does the population prior suit them, and which
// POPULATION_SPREAD?) and both sides of every limb (does the fit follow real asymmetry?).
//
//   node dev/validate-measured.mjs <people.csv> [--spreads 1,2,3] [--json out.json]
//
// CSV, one person per row (dev/measured-template.csv; header case does not matter, empty cells
// are allowed): id, sex (male | female), height_cm, weight_kg, body_fat_percent,
// body_fat_method (a key of BODY_FAT_SD in src/anthro.js: DEXA, BIA, SKINFOLD_7, …), then tapes
// in cm under the codes of TAPE_SITES: LEFT_BICEP, RIGHT_BICEP, LEFT_FOREARM, RIGHT_FOREARM,
// LEFT_THIGH, RIGHT_THIGH, LEFT_CALF, RIGHT_CALF, NECK, SHOULDERS, CHEST, WAIST, ABDOMEN, HIPS.
// Where and how to measure each site: docs/validation/studies.md (the arm flexed, the thigh at the
// gluteal fold — the ANSUR II conventions the calibration uses).
//
// For every spread of the population prior:
//   1. fit with every tape: standardized residuals and tapes flagged as outliers — a trained
//      population that the prior does not suit shows large |z| and false outliers;
//   2. leave one out: each tape hidden in turn and predicted from all the others (RMS per site);
//   3. both sides: for every limb measured on both sides, the fitted left − right difference
//      against the measured one (slope through the origin: 1 = fully reproduced), and the
//      measured asymmetry itself (SD of (L − R) / mean, in %; the calibration assumes 2 %).
import { writeFileSync } from 'node:fs'
import { readCsv } from './lib/ansur.mjs'
import { fitModel, predictTape, rms, mean, percentile, r2 } from './lib/holdout.mjs'
import { fitBody } from '../src/fit.js'
import { TAPE_SITES } from '../src/anthro.js'

const args = process.argv.slice(2)
const csvPath = args[0]
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d }
if (!csvPath) {
  console.error('usage: node dev/validate-measured.mjs <people.csv> [--spreads 1,2,3] [--json out.json]')
  process.exit(1)
}
const spreads = opt('--spreads', '1,2,3').split(',').map(Number)
const PAIRS = { arm: ['LEFT_BICEP', 'RIGHT_BICEP'], forearm: ['LEFT_FOREARM', 'RIGHT_FOREARM'],
  thigh: ['LEFT_THIGH', 'RIGHT_THIGH'], calf: ['LEFT_CALF', 'RIGHT_CALF'] }
// tapes that only feed the US Navy body fat: not predicted
const NOT_PREDICTED = new Set(['WAIST', 'ABDOMEN'])

const num = (v) => (v == null || v === '' ? null : Number(String(v).replace(',', '.')))
const people = readCsv(csvPath).map((r) => {
  const girths = {}
  for (const code of Object.keys(TAPE_SITES)) {
    const v = num(r[code.toLowerCase()])
    if (v > 0) girths[code] = v
  }
  return {
    id: r.id, sex: /^f/i.test(r.sex) ? 'female' : 'male', heightCm: num(r.height_cm), weightKg: num(r.weight_kg),
    bodyFatPercent: num(r.body_fat_percent), bodyFatMethod: r.body_fat_method ? r.body_fat_method.toUpperCase() : null, girths
  }
}).filter((p) => p.heightCm > 0 && p.weightKg > 0)

const summary = { file: csvPath, people: people.length, spreads: {} }
for (const spread of spreads) {
  const out = { sexes: {} }
  for (const sex of ['male', 'female']) {
    const group = people.filter((p) => p.sex === sex)
    if (!group.length) continue
    const model = fitModel(sex, { spread })
    const zs = [], flagged = []
    const loo = {}
    const sides = Object.fromEntries(Object.keys(PAIRS).map((k) => [k, { measured: [], fitted: [], relative: [] }]))
    for (const p of group) {
      const res = fitBody(model, p)
      for (const s of res.sites) {
        if (s.status !== 'ok' && s.status !== 'outlier') continue
        zs.push(s.z)
        if (s.status === 'outlier') flagged.push(`${p.id}:${s.codes?.join('/') ?? s.site}`)
      }
      for (const code of Object.keys(p.girths)) {
        if (NOT_PREDICTED.has(code)) continue
        const others = { ...p.girths }
        delete others[code]
        const fit = fitBody(model, { ...p, girths: others })
        const predicted = predictTape(model, p, code, fit.weights, p.girths[code])
        if (predicted != null) (loo[code] ??= []).push(predicted - p.girths[code])
      }
      for (const [limb, [left, right]] of Object.entries(PAIRS)) {
        const L = p.girths[left], R = p.girths[right]
        if (!(L > 0 && R > 0)) continue
        const fl = predictTape(model, p, left, res.weights, L)
        const fr = predictTape(model, p, right, res.weights, R)
        sides[limb].measured.push(L - R)
        sides[limb].fitted.push(fl - fr)
        sides[limb].relative.push((L - R) / ((L + R) / 2))
      }
    }
    const sd = (a) => Math.sqrt(mean(a.map((x) => (x - mean(a)) ** 2)))
    out.sexes[sex] = {
      people: group.length,
      absZ: { p50: r2(percentile(zs.map(Math.abs), 0.5)), p95: r2(percentile(zs.map(Math.abs), 0.95)) },
      outliers: flagged,
      outlierPercent: r2(100 * flagged.length / Math.max(1, zs.length)),
      leaveOneOutRmsCm: Object.fromEntries(Object.entries(loo).map(([c, e]) => [c, { n: e.length, rms: r2(rms(e)), bias: r2(mean(e)) }])),
      sides: Object.fromEntries(Object.entries(sides).filter(([, v]) => v.measured.length).map(([limb, v]) => {
        const sxy = v.measured.reduce((s, m, i) => s + m * v.fitted[i], 0)
        const sxx = v.measured.reduce((s, m) => s + m * m, 0)
        return [limb, {
          n: v.measured.length, measuredAsymmetrySdPercent: r2(100 * sd(v.relative)),
          reproducedSlope: sxx > 0 ? r2(sxy / sxx) : null,
          differenceRmsCm: r2(rms(v.fitted.map((f, i) => f - v.measured[i])))
        }]
      }))
    }
    const s = out.sexes[sex]
    console.log(`\n=== spread ${spread}, ${sex}: ${s.people} ${s.people === 1 ? 'person' : 'people'}`)
    console.log(`  fit with every tape: |z| p50 ${s.absZ.p50}, p95 ${s.absZ.p95}; flagged as outliers ${s.outlierPercent} %` +
      (flagged.length ? ` (${flagged.join(', ')})` : ''))
    console.log('  leave one out, RMS (bias) in cm:', Object.entries(s.leaveOneOutRmsCm)
      .map(([c, v]) => `${c} ${v.rms} (${v.bias >= 0 ? '+' : ''}${v.bias}, n=${v.n})`).join('; '))
    for (const [limb, v] of Object.entries(s.sides)) {
      console.log(`  ${limb}: measured asymmetry SD ${v.measuredAsymmetrySdPercent} % (n=${v.n}); fitted vs measured ` +
        `left − right: slope ${v.reproducedSlope}, RMS ${v.differenceRmsCm} cm`)
    }
  }
  summary.spreads[spread] = out
}
const jsonAt = args.indexOf('--json')
if (jsonAt >= 0) writeFileSync(args[jsonAt + 1], JSON.stringify(summary, null, 2) + '\n')
