// Tape-measure fit (src/fit.js, src/anthro.js) on the published models.
//   npm test
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { readBody } from '../dev/glb.mjs'
import {
  prepareFitModel, fitBody, priorWeights, siteGirth, muscleVolume, targetVolume, uniformWeight, observe,
  WEIGHT_RANGE
} from '../src/fit.js'
import { skinfoldMm, navyBodyFat, ffmiNormalized, girthScale, TAPE_SITES } from '../src/anthro.js'

const models = {}
for (const sex of ['male', 'female']) {
  for (const lod of ['', '-lite']) {
    const body = readBody(fileURLToPath(new URL(`../public/models/${sex}${lod}.glb`, import.meta.url)))
    models[sex + lod] = prepareFitModel(body)
  }
}

const PEOPLE = {
  male: { sex: 'male', heightCm: 178, weightKg: 80, bodyFatPercent: 15, bodyFatMethod: 'DEXA' },
  female: { sex: 'female', heightCm: 165, weightKg: 62, bodyFatPercent: 26, bodyFatMethod: 'DEXA' }
}
const withFfmi = (p) => ({ ...p, ffmi: ffmiNormalized(p.weightKg, p.heightCm, p.bodyFatPercent) })

// a value inside the range of each tape, only to build the model → tape conversion
const PLACEHOLDER = { NECK: 38, SHOULDERS: 115, CHEST: 100, HIPS: 100, GLUTES: 100 }

/** Tape measures the model "has" at weights w (the inverse of what the fit does). */
function tapeOf(model, person, w, codes) {
  const out = {}
  for (const code of codes) {
    const o = observe(model, { ...person, girths: { [code]: PLACEHOLDER[code] ?? 40 } })
    const ob = o.obs[0]
    if (!ob) continue
    const g = siteGirth(model, model.siteById[ob.site], w).value
    out[code] = Math.round(((g * ob.correctedCm) / ob.y + (ob.measuredCm - ob.correctedCm)) * 10) / 10
  }
  return out
}

const LIMBS = ['LEFT_BICEP', 'RIGHT_BICEP', 'LEFT_FOREARM', 'RIGHT_FOREARM', 'LEFT_THIGH', 'RIGHT_THIGH', 'LEFT_CALF', 'RIGHT_CALF']
const ALL = [...LIMBS, 'NECK', 'SHOULDERS', 'CHEST', 'HIPS']
const regionIndex = (m, id) => m.regions.indexOf(id)
const volumeOf = (m, w, ids) => {
  const v = muscleVolume(m, w)
  return ids.reduce((s, id) => s + v.byRegion[regionIndex(m, id)], 0)
}

for (const [name, model] of Object.entries(models)) {
  const sex = model.sex
  const person = withFfmi(PEOPLE[sex])
  describe(`${name}`, () => {
    test('fit data present and consistent', () => {
      assert.ok(model, 'model without extras.body.fit')
      assert.equal(model.regions.length, 14)
      for (const site of ['arm_l', 'arm_r', 'forearm_l', 'thigh_r', 'calf_l', 'neck', 'shoulders', 'chest', 'hips']) {
        assert.ok(model.siteById[site], `no probe for ${site}`)
      }
      // the uniform body's volume grows with the FFMI
      let last = 0
      for (let f = model.table[0][0]; f <= model.table[model.table.length - 1][0]; f += 1) {
        const v = targetVolume(model, f).v
        assert.ok(v > last, `volume does not grow at FFMI ${f}`)
        last = v
      }
    })

    test('no tapes: the typical body of the FFMI, with the volume of the FFMI', () => {
      const res = fitBody(model, { ...person, girths: {} })
      const prior = priorWeights(model, person.ffmi).w
      res.weights.forEach((w, i) => assert.ok(Math.abs(w - prior[i]) < 0.01, `${model.regions[i]}: ${w} ≠ ${prior[i]}`))
      assert.ok(Math.abs(res.ffmi - person.ffmi) < 0.05)
      assert.ok(Math.abs(res.muscle.volumeL / res.muscle.targetL - 1) < 0.01)
    })

    test('recovers the body the tapes came from (every tape)', () => {
      const prior = priorWeights(model, person.ffmi).w
      // a plausible body other than the typical one: arms +, legs −, the rest balancing the volume
      const w = prior.map((x, i) => x + (/upperarm|forearm/.test(model.regions[i]) ? 0.06 : /thigh|calf/.test(model.regions[i]) ? -0.04 : 0))
      const girths = tapeOf(model, person, w, ALL.filter((c) => !(sex === 'female' && c === 'CHEST')))
      const res = fitBody(model, { ...person, girths })
      for (const s of res.sites.filter((x) => x.status === 'ok' || x.status === 'outlier')) {
        assert.equal(s.status, 'ok', `${s.codes} flagged as an outlier`)
        assert.ok(Math.abs(s.fittedCm - s.measuredCm) < Math.max(0.8, 0.015 * s.measuredCm), `${s.codes}: ${s.fittedCm} × ${s.measuredCm}`)
      }
      for (const id of ['upperarm_l', 'upperarm_r', 'thigh_l', 'calf_r']) {
        const i = regionIndex(model, id)
        assert.ok(Math.abs(res.weights[i] - w[i]) < 0.05, `${id}: ${res.weights[i].toFixed(3)} × ${w[i].toFixed(3)}`)
      }
    })

    test('a much larger thigh takes muscle from the rest and keeps the FFMI total', () => {
      const base = fitBody(model, { ...person, girths: {} })
      const typical = tapeOf(model, person, base.weights, ['LEFT_THIGH', 'RIGHT_THIGH'])
      const big = { LEFT_THIGH: typical.LEFT_THIGH * 1.15, RIGHT_THIGH: typical.RIGHT_THIGH * 1.15 }
      const res = fitBody(model, { ...person, girths: big })
      const thighs = ['thigh_l', 'thigh_r']
      const rest = model.regions.filter((r) => !thighs.includes(r))
      const grew = volumeOf(model, res.weights, thighs) / volumeOf(model, base.weights, thighs)
      const rest_ = volumeOf(model, res.weights, rest) / volumeOf(model, base.weights, rest)
      // the thigh muscle grows (in the lean man, almost all of it; in the woman, with more thigh
      // fat and an FFMI held by DEXA, part of the excess is fat)
      assert.ok(grew > (sex === 'male' ? 1.2 : 1.1), `thighs grew only ${grew}`)
      assert.ok(rest_ < 0.98, `the rest lost no muscle (${rest_})`)
      // with DEXA body fat the FFMI barely moves: the total stays (the FFMI moves within the method's error)
      assert.ok(Math.abs(res.muscle.volumeL / base.muscle.volumeL - 1) < 0.04, `total changed ${res.muscle.volumeL} vs ${base.muscle.volumeL}`)
      assert.ok(Math.abs(res.ffmi - person.ffmi) < 0.6, `FFMI ${res.ffmi} vs ${person.ffmi}`)
      const thigh = res.sites.find((s) => s.codes.includes('LEFT_THIGH'))
      assert.equal(thigh.status, 'ok', 'a really large thigh is not a measuring error')
      // the drawn tape (muscle + the site's fat) matches the measure
      assert.ok(Math.abs(thigh.fittedCm - thigh.measuredCm) < 1.5, `thigh ${thigh.fittedCm} vs ${thigh.measuredCm}`)
      if (sex === 'female') assert.ok(thigh.fatMm > thigh.fatTypicalMm, 'part of the excess becomes fat')
    })

    test('all tapes 10 % larger: the FFMI rises with a visual body-fat estimate, much less with DEXA', () => {
      const base = fitBody(model, { ...person, girths: {} })
      const codes = ALL.filter((c) => !(sex === 'female' && c === 'CHEST'))
      const t = tapeOf(model, person, base.weights, codes)
      const big = Object.fromEntries(Object.entries(t).map(([c, v]) => [c, v * 1.1]))
      const visual = fitBody(model, { ...person, bodyFatMethod: 'VISUAL', girths: big })
      const dexa = fitBody(model, { ...person, bodyFatMethod: 'DEXA', girths: big })
      assert.ok(visual.ffmi - person.ffmi > 0.8, `visual: FFMI ${visual.ffmi} vs ${person.ffmi}`)
      assert.ok(visual.ffmi > dexa.ffmi, 'the more precise method should hold the FFMI more')
    })

    test('asymmetry: a smaller left arm', () => {
      const base = fitBody(model, { ...person, girths: {} })
      const t = tapeOf(model, person, base.weights, ['LEFT_BICEP', 'RIGHT_BICEP'])
      const res = fitBody(model, { ...person, girths: { LEFT_BICEP: t.LEFT_BICEP - 2.5, RIGHT_BICEP: t.RIGHT_BICEP } })
      const l = res.weights[regionIndex(model, 'upperarm_l')], r = res.weights[regionIndex(model, 'upperarm_r')]
      assert.ok(r > l, `left ${l} vs right ${r}`)
      const left = res.sites.find((x) => x.codes.includes('LEFT_BICEP'))
      const right = res.sites.find((x) => x.codes.includes('RIGHT_BICEP'))
      // the difference between sides shows on the body (at least 2 of the 2.5 cm on the drawn tape,
      // and in the muscle)
      assert.ok(right.fittedCm - left.fittedCm > 2, `difference ${right.fittedCm - left.fittedCm}`)
      assert.ok(right.muscleOnlyFitCm - left.muscleOnlyFitCm > 0.8, `muscle ${right.muscleOnlyFitCm - left.muscleOnlyFitCm}`)
    })

    test('typos are left out', () => {
      const res = fitBody(model, { ...person, girths: { RIGHT_BICEP: 370, LEFT_THIGH: 5.8, NECK: 0, LEFT_CALF: -3 } })
      const st = Object.fromEntries(res.sites.map((s) => [s.codes[0], s.status]))
      assert.equal(st.RIGHT_BICEP, 'invalid')
      assert.equal(st.LEFT_THIGH, 'invalid')
      assert.equal(res.measured, 0)
      const prior = priorWeights(model, person.ffmi).w
      res.weights.forEach((w, i) => assert.ok(Math.abs(w - prior[i]) < 0.01))
    })

    test('an inconsistent tape is flagged and barely deforms the rest', () => {
      const base = fitBody(model, { ...person, girths: {} })
      const t = tapeOf(model, person, base.weights, LIMBS)
      const clean = fitBody(model, { ...person, girths: t })
      const bad = fitBody(model, { ...person, girths: { ...t, LEFT_CALF: t.LEFT_CALF + 14 } })
      const calf = bad.sites.find((s) => s.codes.includes('LEFT_CALF'))
      assert.equal(calf.status, 'outlier')
      for (const id of ['upperarm_l', 'upperarm_r', 'thigh_l', 'thigh_r', 'forearm_r']) {
        const i = regionIndex(model, id)
        assert.ok(Math.abs(bad.weights[i] - clean.weights[i]) < 0.04, `${id} moved ${bad.weights[i]} vs ${clean.weights[i]}`)
      }
    })

    test('a larger arm gives a larger arm weight (monotonic)', () => {
      const base = fitBody(model, { ...person, girths: {} })
      const t = tapeOf(model, person, base.weights, ['RIGHT_BICEP']).RIGHT_BICEP
      let last = -Infinity
      for (const d of [-6, -3, 0, 3, 6, 9]) {
        const res = fitBody(model, { ...person, girths: { RIGHT_BICEP: t + d } })
        const w = res.weights[regionIndex(model, 'upperarm_r')]
        // strictly increasing up to the top of the weight range
        assert.ok(w > last || w >= WEIGHT_RANGE[1] - 1e-6, `not monotonic at ${d}: ${w} ≤ ${last}`)
        last = w
      }
    })

    test('more tapes, less uncertainty', () => {
      const base = fitBody(model, { ...person, bodyFatMethod: 'BIA', girths: {} })
      const t = tapeOf(model, person, base.weights, ALL)
      const sets = [[], ['RIGHT_BICEP'], ['RIGHT_BICEP', 'RIGHT_THIGH'], LIMBS, ALL]
      let last = Infinity
      for (const codes of sets) {
        const res = fitBody(model, { ...person, bodyFatMethod: 'BIA', girths: Object.fromEntries(codes.map((c) => [c, t[c]])) })
        const mean = res.uncertainty.reduce((s, x) => s + x, 0) / res.uncertainty.length
        assert.ok(mean < last + 1e-9, `${codes.length} tapes: uncertainty ${mean} ≥ ${last}`)
        last = mean
      }
    })

    test('weights stay in range, extreme bodies included', () => {
      const cases = [
        { name: 'bodybuilder', p: { ...person, weightKg: sex === 'male' ? 100 : 70, bodyFatPercent: sex === 'male' ? 6 : 12 },
          g: sex === 'male' ? { RIGHT_BICEP: 50, LEFT_BICEP: 50, RIGHT_THIGH: 72, LEFT_THIGH: 72, RIGHT_CALF: 45, NECK: 46, SHOULDERS: 140, CHEST: 125 }
            : { RIGHT_BICEP: 36, LEFT_THIGH: 64, RIGHT_CALF: 39, SHOULDERS: 112 } },
        { name: 'sedentary with obesity', p: { ...person, weightKg: 125, bodyFatPercent: 42, bodyFatMethod: 'BIA' },
          g: { RIGHT_BICEP: 41, LEFT_THIGH: 74, RIGHT_CALF: 45, NECK: 45, HIPS: 128, ABDOMEN: 128, WAIST: 120 } },
        { name: 'sarcopenic', p: { ...person, weightKg: 52, bodyFatPercent: 28 },
          g: { RIGHT_BICEP: 24, LEFT_THIGH: 42, RIGHT_CALF: 29, NECK: 33 } },
        { name: 'only legs trained', p: person, g: { RIGHT_BICEP: 28, LEFT_BICEP: 28, RIGHT_THIGH: 68, LEFT_THIGH: 68, RIGHT_CALF: 44, LEFT_CALF: 44 } },
        { name: 'skips leg day', p: person, g: { RIGHT_BICEP: 42, LEFT_BICEP: 42, SHOULDERS: 128, RIGHT_THIGH: 50, LEFT_THIGH: 50 } },
        { name: 'very tall', p: { ...person, heightCm: 205, weightKg: 105 }, g: { RIGHT_BICEP: 38, LEFT_THIGH: 64 } },
        { name: 'very short', p: { ...person, heightCm: 148, weightKg: 50 }, g: { RIGHT_BICEP: 28, LEFT_THIGH: 50 } },
        { name: 'no body fat, no weight', p: { sex, heightCm: 175 }, g: { RIGHT_BICEP: 34, LEFT_THIGH: 56, NECK: 37 } },
        { name: 'everything huge', p: person, g: Object.fromEntries(ALL.map((c) => [c, 130])) },
        { name: 'everything tiny', p: person, g: Object.fromEntries(LIMBS.map((c) => [c, 16])) }
      ]
      for (const c of cases) {
        const input = { ...c.p }
        if (input.weightKg && input.bodyFatPercent != null) input.ffmi = ffmiNormalized(input.weightKg, input.heightCm, input.bodyFatPercent)
        const t0 = performance.now()
        const res = fitBody(model, { ...input, girths: c.g })
        const ms = performance.now() - t0
        assert.ok(ms < 400, `${c.name}: ${ms.toFixed(0)} ms`)
        res.weights.forEach((w, i) => {
          assert.ok(Number.isFinite(w), `${c.name}: non-finite weight`)
          assert.ok(w >= WEIGHT_RANGE[0] - 1e-9 && w <= WEIGHT_RANGE[1] + 1e-9, `${c.name}: ${model.regions[i]} = ${w}`)
        })
        assert.ok(Number.isFinite(res.ffmi), `${c.name}: FFMI`)
      }
    })

    test('hips and glutes are the same loop; a woman\'s chest is ignored', () => {
      const res = fitBody(model, { ...person, girths: { HIPS: 100, GLUTES: 104, CHEST: sex === 'male' ? 102 : 92 } })
      const hips = res.sites.find((s) => s.site === 'hips')
      assert.equal(hips.measuredCm, 102)
      assert.deepEqual(hips.codes.sort(), ['GLUTES', 'HIPS'])
      const chest = res.sites.find((s) => s.codes.includes('CHEST'))
      assert.equal(chest.status, sex === 'female' ? 'ignored' : 'ok')
    })

    test('US Navy body fat when there is no body-fat measure', () => {
      const p = { sex, heightCm: person.heightCm, weightKg: person.weightKg }
      const girths = sex === 'male' ? { NECK: 39, ABDOMEN: 84 } : { NECK: 33, WAIST: 72, HIPS: 98 }
      const res = fitBody(model, { ...p, girths })
      assert.equal(res.bodyFat.source, 'navy')
      assert.ok(res.bodyFat.value > 8 && res.bodyFat.value < 40)
      assert.ok(Math.abs(res.ffmiMeasured - ffmiNormalized(p.weightKg, p.heightCm, navyBodyFat(sex, { heightCm: p.heightCm, ...lower(girths) }))) < 0.05)
    })
  })
}

function lower(g) {
  return { neck: g.NECK, abdomen: g.ABDOMEN, waist: g.WAIST, hips: g.HIPS }
}

describe('anthropometry', () => {
  test('skinfolds reproduce the means of Lee et al. (2000)', () => {
    // non-obese men: 79 kg, 176.8 cm, ~18.5 % fat → triceps 12.5, thigh 15.6, calf 9.7 mm
    // (the arm uses 0.75 of the triceps — the ring around the arm; the calf, 0.9 of the medial)
    const m = { heightCm: 176.8, weightKg: 79, bodyFatPercent: 18.5 }
    const ref = (kind, frac) => (skinfoldMm(kind, 'male', m).mm - 2.5) / frac + 2.5
    assert.ok(Math.abs(ref('arm', 0.75) - 12.5) < 0.6, `triceps ${ref('arm', 0.75)}`)
    assert.ok(Math.abs(skinfoldMm('thigh', 'male', m).mm - 15.6) < 0.6)
    assert.ok(Math.abs(ref('calf', 0.9) - 9.7) < 0.6, `calf ${ref('calf', 0.9)}`)
    // women with obesity: 92 kg, 162.6 cm, ~40 % → thigh 47.4 mm (ring factor 1.15 over the thigh)
    const f = { heightCm: 162.6, weightKg: 92, bodyFatPercent: 40 }
    const thigh = (skinfoldMm('thigh', 'female', f).mm - 2.5) / 1.15 + 2.5
    assert.ok(Math.abs(thigh - 47.4) < 4, `thigh ${thigh}`)
  })

  test('US Navy: reference values', () => {
    // man, 178 cm, neck 38, abdomen 85 → ~17 %
    const m = navyBodyFat('male', { heightCm: 178, neck: 38, abdomen: 85 })
    assert.ok(m > 14 && m < 20, `man ${m}`)
    const f = navyBodyFat('female', { heightCm: 165, neck: 32, waist: 72, hips: 98 })
    assert.ok(f > 22 && f < 32, `woman ${f}`)
    assert.equal(navyBodyFat('male', { heightCm: 178, neck: 40, abdomen: 39 }), null)
  })

  test('height scale: 1 at the same height, larger for a shorter person', () => {
    assert.ok(Math.abs(girthScale(178, 1.78, 22, (22 - 6.1 * 0.02) * 1.78 ** 2) - 1) < 1e-9)
    const lean = (22 - 6.1 * (1.8 - 1.6)) * 1.6 ** 2
    const k = girthScale(160, 1.78, 22, lean)
    assert.ok(k > 1.05 && k < 1.12)
  })

  test('every standard tape site has a destination', () => {
    for (const code of ['NECK', 'SHOULDERS', 'CHEST', 'WAIST', 'ABDOMEN', 'HIPS', 'GLUTES', ...LIMBS]) assert.ok(TAPE_SITES[code], code)
  })
})

describe('volume of the FFMI', () => {
  test('the target is the volume of the (calibrated) typical body of that FFMI', () => {
    for (const m of Object.values(models)) {
      for (const f of [16, 20, 24]) {
        const v = muscleVolume(m, priorWeights(m, f).w).total
        assert.ok(Math.abs(v / targetVolume(m, f).v - 1) < 5e-3, `FFMI ${f}: ${v} vs ${targetVolume(m, f).v}`)
      }
    }
  })

  test('without calibration, the uniform body of the pipeline table', () => {
    const m = { ...Object.values(models)[0], calibration: null }
    for (const f of [16, 20, 24]) {
      const t = uniformWeight(m, f)
      const v = muscleVolume(m, new Float64Array(m.R).fill(t)).total
      assert.ok(Math.abs(v / targetVolume(m, f).v - 1) < 1e-3)
    }
  })

  test('a calibration exists for the four models (fingerprints match)', () => {
    for (const [name, m] of Object.entries(models)) assert.ok(m.calibration, `${name} has no calibration: run node dev/calibrate.mjs <ANSUR II .csv> --write`)
  })
})

describe('edge cases', () => {
  const model = models.male

  test('an FFMI given without height does not turn the fit into NaN', () => {
    const res = fitBody(model, { weightKg: 80, bodyFatPercent: 15, bodyFatMethod: 'DEXA', ffmi: 22, girths: { RIGHT_BICEP: 36 } })
    assert.ok(Number.isFinite(res.ffmi), `FFMI ${res.ffmi}`)
    res.weights.forEach((w) => assert.ok(Number.isFinite(w)))
    assert.equal(res.muscle.kg, null)
  })

  test('no body fat at all is reported in the notes', () => {
    const res = fitBody(model, { heightCm: 178, girths: { RIGHT_BICEP: 36 } })
    assert.deepEqual(res.notes, ['no-body-fat'])
  })

  test('the precision follows the calibration and the spread', () => {
    const m = prepareFitModel(readBody(fileURLToPath(new URL('../public/models/male.glb', import.meta.url))))
    const p = { ...PEOPLE.male, girths: { RIGHT_BICEP: 39, RIGHT_THIGH: 60 } }
    const a = fitBody(m, p)
    m.populationSpread = 1
    const b = fitBody(m, p)
    m.populationSpread = 3
    const c = fitBody(m, p)
    assert.notDeepEqual(Array.from(a.weights), Array.from(b.weights))
    assert.deepEqual(Array.from(a.weights), Array.from(c.weights))
  })

  test('a calibration can be switched off', () => {
    const m = prepareFitModel(readBody(fileURLToPath(new URL('../public/models/male.glb', import.meta.url))), { calibration: null })
    assert.equal(m.calibration, null)
    const res = fitBody(m, { ...PEOPLE.male, girths: {} })
    const t = uniformWeight(m, res.ffmi)
    res.weights.forEach((w) => assert.ok(Math.abs(w - t) < 0.01))
  })
})
