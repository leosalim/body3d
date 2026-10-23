// Muscle volumes of the typical body against MRI measurements — a coarse check of the anatomy
// inside the model, which the tape fit never sees.
//
//   node dev/muscle-volumes.mjs [--json out.json]
//
// For the typical body (src/calibration.generated.js) at several FFMIs: the volume of every
// muscle from the exported meshes (signed volume of each closed part), the total against the
// fit's volume polynomial, and the right quadriceps — the most measured muscle group in MRI
// studies — with the share of each head. The quadriceps is then compared with
// Maden-Wilkinson et al. (2020): 52 untrained and 16 long-term resistance-trained young men,
// MRI of the dominant thigh. That study reports height and mass but no body composition, so the
// model is evaluated over a range of assumed body fat: a person's quadriceps is the typical body's
// at their normalized FFMI, scaled by their lean mass over the model's.
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { readBody, readSoftMeshes, partVolumes } from './glb.mjs'
import { prepareFitModel, priorWeights, muscleVolume } from '../src/fit.js'

const QUADS = ['vastus-lateralis', 'vastus-intermedius', 'vastus-medialis', 'rectus-femoris']
// Maden-Wilkinson et al. 2020, J Appl Physiol 128:1000–1011 (mean ± SD, cm³)
const MRI = {
  untrained: { n: 52, heightCm: 176, weightKg: 73, quads: [1838.2, 262.9], heads: [609.8, 546.9, 441.4, 240.2],
    bodyFat: [12, 16, 20] },
  trained: { n: 16, heightCm: 183, weightKg: 91, quads: [2881.9, 308.1], heads: [964.3, 846.4, 691.2, 374.6],
    bodyFat: [8, 12, 16] }
}
const FFMIS = { male: [17, 20, 23, 26], female: [14, 17, 20, 22] }

const report = {}
for (const sex of ['male', 'female']) {
  const path = fileURLToPath(new URL(`../public/models/${sex}.glb`, import.meta.url))
  const model = prepareFitModel(readBody(path))
  const mesh = readSoftMeshes(path)
  const { parts } = mesh
  const h = model.heightM ?? readBody(path).heightM
  const leanOfModel = (F) => (F - 6.1 * (1.8 - h)) * h * h
  const quadIdx = QUADS.map((b) => parts.findIndex((p) => p.base === b && p.side === 'r'))
  const at = (F) => {
    const w = priorWeights(model, F).w
    const vol = partVolumes(mesh, w)
    const shifted = partVolumes(mesh, w, [1, 1, 1])
    let total = 0
    parts.forEach((p, i) => { if (p.kind === 'muscle') total += vol[i] })
    // the quadriceps heads must be closed for their volumes to mean anything (some other parts are
    // open on purpose: the cut rectus abdominis and abdominal wall only add up together)
    const closure = Math.max(...quadIdx.map((i) => Math.abs(shifted[i] - vol[i]) / Math.abs(vol[i])))
    const heads = quadIdx.map((i) => vol[i] * 1e6)
    return { F, totalL: total * 1000, polynomialL: muscleVolume(model, w).total, closure, quads: heads.reduce((s, x) => s + x, 0), heads }
  }
  const rows = FFMIS[sex].map(at)
  console.log(`\n=== ${sex} (model ${h} m): typical body`)
  console.log('  FFMI   muscle volume (meshes / fit polynomial)   right quadriceps   VL / VI / VM / RF')
  for (const r of rows) {
    console.log(`  ${String(r.F).padStart(4)}   ${r.totalL.toFixed(2)} L / ${r.polynomialL.toFixed(2)} L` +
      `                 ${r.quads.toFixed(0).padStart(5)} cm³         ` +
      r.heads.map((x) => `${(100 * x / r.quads).toFixed(1)} %`).join(' / '))
  }
  console.log(`  closure of the quadriceps meshes (volume change when the origin moves by 1.7 m): ` +
    `${(100 * Math.max(...rows.map((r) => r.closure))).toExponential(1)} %`)
  report[sex] = { heightM: h, rows }
  if (sex !== 'male') continue
  // MRI comparison (men): the person's quadriceps = the typical body's at their FFMI × lean-mass ratio
  report.mri = {}
  for (const [group, g] of Object.entries(MRI)) {
    const m = g.heightCm / 100
    const preds = g.bodyFat.map((bf) => {
      const lean = g.weightKg * (1 - bf / 100)
      const F = lean / (m * m) + 6.1 * (1.8 - m)
      const r = at(F)
      return { bodyFat: bf, ffmi: Math.round(F * 10) / 10, quadsCm3: Math.round(r.quads * lean / leanOfModel(F)), heads: r.heads.map((x) => x / r.quads) }
    })
    const share = g.heads.map((x) => x / g.heads.reduce((s, y) => s + y, 0))
    report.mri[group] = { measured: g.quads, measuredShares: share, predicted: preds }
    console.log(`  MRI, ${group} men (n = ${g.n}, ${g.heightCm} cm, ${g.weightKg} kg): ${g.quads[0].toFixed(0)} ± ${g.quads[1].toFixed(0)} cm³, ` +
      `heads ${share.map((x) => `${(100 * x).toFixed(1)} %`).join(' / ')}`)
    for (const p of preds) {
      console.log(`      model, assuming ${p.bodyFat} % body fat (FFMI ${p.ffmi}): ${p.quadsCm3} cm³ ` +
        `(${((p.quadsCm3 - g.quads[0]) / g.quads[1]).toFixed(1)} SD), heads ${p.heads.map((x) => `${(100 * x).toFixed(1)} %`).join(' / ')}`)
    }
  }
}
const jsonAt = process.argv.indexOf('--json')
if (jsonAt >= 0) writeFileSync(process.argv[jsonAt + 1], JSON.stringify(report, null, 2) + '\n')
