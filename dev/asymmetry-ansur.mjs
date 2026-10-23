// How much of a left–right difference between tapes the fit reproduces.
//
//   node dev/asymmetry-ansur.mjs <csv> --calibration cal.json [--n 300] [--spread 3] [--json out.json]
//
// ANSUR II measures the limbs on the right side only, so real asymmetry cannot be validated on
// it (docs/validation/studies.md describes the bilateral study that would). This is the
// synthetic part: for people of the validation half, each limb's left tape is set to the right
// one times (1 + δ), every tape is fitted, and the predicted left − right difference is compared
// with the imposed one. The ratio is what the prior (which ties both sides, 2 % of the girth
// apart) and the volume term (which takes the extra muscle from elsewhere) let through. Also
// reported: how far the larger side drags the other one.
import { readFileSync, writeFileSync } from 'node:fs'
import { readCsv } from './lib/ansur.mjs'
import { fitModel, holdoutPeople, predictTape, mean, rms, r2 } from './lib/holdout.mjs'
import { fitBody, POPULATION_SPREAD } from '../src/fit.js'

const args = process.argv.slice(2)
const csvPath = args[0]
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d }
if (!csvPath) {
  console.error('usage: node dev/asymmetry-ansur.mjs <csv> [--calibration cal.json] [--n 300] [--spread 3] [--json out.json]')
  process.exit(1)
}
const N = Number(opt('--n', 300))
const spread = Number(opt('--spread', POPULATION_SPREAD))
const calFile = opt('--calibration')
const calibrations = calFile ? JSON.parse(readFileSync(calFile, 'utf8')) : null
const rows = readCsv(csvPath)

const LIMBS = { arm: ['RIGHT_BICEP', 'LEFT_BICEP'], forearm: ['RIGHT_FOREARM', 'LEFT_FOREARM'],
  thigh: ['RIGHT_THIGH', 'LEFT_THIGH'], calf: ['RIGHT_CALF', 'LEFT_CALF'] }
const DELTAS = [0, 0.02, 0.05, 0.1]

const summary = { calibration: calFile ? 'holdout' : 'repository', spread, sexes: {} }
for (const sex of ['male', 'female']) {
  const model = fitModel(sex, { calibrations, spread })
  const people = holdoutPeople(rows, model, sex, { parity: 1, n: N })
  const out = {}
  for (const [limb, [right, left]] of Object.entries(LIMBS)) {
    out[limb] = {}
    for (const delta of DELTAS) {
      const recovered = [], diffErr = [], drag = []
      for (const p of people) {
        const R = p.girths[right]
        if (!(R > 0)) continue
        const girths = { ...p.girths, [left]: R * (1 + delta) }
        const fit = fitBody(model, { ...p, girths })
        const pl = predictTape(model, p, left, fit.weights, R)
        const pr = predictTape(model, p, right, fit.weights, R)
        const imposed = girths[left] - R
        recovered.push([pl - pr, imposed])
        diffErr.push(pl - pr - imposed)
        drag.push(pr - R) // the measured side, pulled by the other one
      }
      const got = mean(recovered.map(([d]) => d))
      const want = mean(recovered.map(([, d]) => d))
      out[limb][delta] = {
        imposedCm: r2(want), recoveredCm: r2(got), share: delta ? r2(got / want) : null,
        differenceRmsCm: r2(rms(diffErr)),
        // how much the right side's prediction moved compared with equal tapes (δ = 0)
        dragCm: r2(mean(drag) - (out[limb][0]?.rightErrorCm ?? mean(drag))),
        rightErrorCm: mean(drag)
      }
    }
  }
  for (const byDelta of Object.values(out)) for (const v of Object.values(byDelta)) delete v.rightErrorCm
  summary.sexes[sex] = { people: people.length, limbs: out }
  console.log(`\n=== ${sex}: ${people.length} people of the validation half, spread ${spread}`)
  console.log('  limb       δ     imposed L−R   fitted L−R   share   RMS of the difference   right side moved (vs δ = 0)')
  for (const [limb, byDelta] of Object.entries(out)) {
    for (const [delta, v] of Object.entries(byDelta)) {
      console.log(`  ${limb.padEnd(8)} ${(100 * delta).toFixed(0).padStart(3)} %   ${v.imposedCm.toFixed(2).padStart(7)} cm   ` +
        `${v.recoveredCm.toFixed(2).padStart(7)} cm   ${v.share == null ? '   — ' : v.share.toFixed(2).padStart(5)}   ` +
        `${v.differenceRmsCm.toFixed(2).padStart(10)} cm          ${v.dragCm >= 0 ? '+' : ''}${v.dragCm.toFixed(2)} cm`)
    }
  }
}
const jsonAt = args.indexOf('--json')
if (jsonAt >= 0) writeFileSync(args[jsonAt + 1], JSON.stringify(summary, null, 2) + '\n')
