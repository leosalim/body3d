// Names → model parts (src/activation.js).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { resolveActivations, targetsOf, fromExercise, normalizeName } from '../src/activation.js'
import { GROUPS, MUSCLES, TRAINING_GROUPS } from '../src/catalog.generated.js'

// a miniature model: two sides of the biceps long head, a midline tissue, a bone
const PARTS = [
  { base: 'biceps-long-head', group: 'biceps', side: 'l' },
  { base: 'biceps-long-head', group: 'biceps', side: 'r' },
  { base: 'brachioradialis', group: 'brachioradialis', side: 'l' },
  { base: 'gluteus-maximus', group: 'glutes', side: 'l' },
  { base: 'gluteus-medius', group: 'glute-med', side: 'l' },
  { base: 'linea-alba', side: null },
  { base: 'humerus', side: 'l' }
]

describe('names', () => {
  test('training groups resolve by English name, Portuguese name and id, ignoring case and accents', () => {
    const chest = { 'chest-upper': 1, 'chest-middle': 1, 'chest-lower': 1 }
    for (const name of ['Chest', 'chest', 'Peitoral', 'PEITORAL', ' peitoral ']) assert.deepEqual(targetsOf(name), chest)
    assert.deepEqual(targetsOf('Posteriores da coxa'), { hamstrings: 1 })
    assert.deepEqual(targetsOf('Abdomen'), targetsOf('Abdômen'))
    assert.deepEqual(targetsOf('upper-back'), targetsOf('Upper Back'))
  })

  test('anatomical groups and muscles resolve by id and by label in both languages', () => {
    assert.deepEqual(targetsOf('delt-front'), { 'delt-front': 1 })
    assert.deepEqual(targetsOf('Anterior deltoid'), { 'delt-front': 1 })
    assert.deepEqual(targetsOf('Deltoide anterior'), { 'delt-front': 1 })
    assert.deepEqual(targetsOf('rectus-femoris'), { 'rectus-femoris': 1 })
    assert.deepEqual(targetsOf('Rectus femoris'), { 'rectus-femoris': 1 })
    assert.deepEqual(targetsOf('Reto femoral'), { 'rectus-femoris': 1 })
  })

  test('training-group names win over anatomical names; prefixes choose explicitly', () => {
    assert.deepEqual(targetsOf('glutes'), { glutes: 1, 'glute-med': 0.5 })
    assert.deepEqual(targetsOf('group:glutes'), { glutes: 1 })
    assert.deepEqual(targetsOf('training:glutes'), { glutes: 1, 'glute-med': 0.5 })
    assert.deepEqual(targetsOf('muscle:gluteus-maximus'), { 'gluteus-maximus': 1 })
    // an id shared by a training group and an anatomical group: the anatomical id wins unprefixed
    assert.deepEqual(targetsOf('hip-flexors'), { 'hip-flexors': 1 })
    assert.equal(Object.keys(targetsOf('training:hip-flexors')).length, 4)
  })

  test('every catalog name resolves', () => {
    for (const t of TRAINING_GROUPS) {
      for (const n of [t.label.en, t.label['pt-BR'], `training:${t.id}`]) assert.ok(targetsOf(n), n)
    }
    for (const g of GROUPS) for (const n of [g.id, g.label.en, g.label['pt-BR']]) assert.ok(targetsOf(n), n)
    for (const m of MUSCLES) for (const n of [`muscle:${m.id}`, m.label.en, m.label['pt-BR']]) assert.ok(targetsOf(n), n)
  })

  test('aliases are looked up first and may point to a name or to targets', () => {
    const aliases = { Peito: 'chest', 'Lower glutes': { glutes: 0.8 } }
    assert.deepEqual(targetsOf('peito', aliases), targetsOf('chest'))
    assert.deepEqual(targetsOf('lower glutes', aliases), { glutes: 0.8 })
    assert.equal(targetsOf('Peito'), null)
  })

  test('normalizeName strips accents, case and outer spaces', () => {
    assert.equal(normalizeName('  Glúteos '), 'gluteos')
  })
})

describe('resolveActivations', () => {
  test('percentages become 0–1, capped at 100 %, and weights scale them', () => {
    const { values } = resolveActivations([{ muscle: 'Brachialis', activation: 80 }], PARTS)
    // brachialis training group = brachialis 1 + brachioradialis 0.5
    assert.ok(Math.abs(values[2] - 0.4) < 1e-6)
    const capped = resolveActivations([{ muscle: 'biceps', activation: 250 }], PARTS).values
    assert.equal(capped[0], 1)
  })

  test('the largest value wins when two entries reach a part', () => {
    const { values } = resolveActivations([{ muscle: 'Glutes', activation: 100 }, { muscle: 'glute-med', activation: 70 }], PARTS)
    assert.ok(Math.abs(values[4] - 0.7) < 1e-6) // 0.5 from Glutes, 0.7 direct
    assert.equal(values[3], 1)
  })

  test('a side restricts sided parts and leaves midline parts alone', () => {
    const { values } = resolveActivations([{ muscle: 'biceps', activation: 60, side: 'right' }], PARTS)
    assert.equal(values[0], 0)
    assert.ok(Math.abs(values[1] - 0.6) < 1e-6)
  })

  test('unknown names are reported; zero, negative and invalid percentages do nothing', () => {
    const { values, unknown } = resolveActivations([
      { muscle: 'pecs-of-steel', activation: 90 }, { muscle: 'biceps', activation: 0 },
      { muscle: 'triceps', activation: -5 }, { muscle: 'biceps', activation: 'x' }, null
    ], PARTS)
    assert.deepEqual(unknown, ['pecs-of-steel'])
    assert.ok(values.every((v) => v === 0))
  })

  test('`name` and `id` are accepted in place of `muscle`', () => {
    const a = resolveActivations([{ name: 'biceps', activation: 50 }], PARTS).values
    const b = resolveActivations([{ id: 'biceps', activation: 50 }], PARTS).values
    assert.deepEqual(a, b)
    assert.ok(a[0] > 0)
  })
})

describe('fromExercise', () => {
  test('primaries at 100 %, secondaries at 45 %, names or { name } objects', () => {
    const list = fromExercise({ primaryMuscles: [{ name: 'Chest' }], secondaryMuscles: ['Triceps'] })
    assert.deepEqual(list, [{ muscle: 'Triceps', activation: 45 }, { muscle: 'Chest', activation: 100 }])
    assert.deepEqual(fromExercise(null), [])
    assert.equal(fromExercise({ primaryMuscles: ['abs'] }, { primary: 80 })[0].activation, 80)
  })
})
