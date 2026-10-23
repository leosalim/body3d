// The published models against the catalog, the poses and the interface strings — the contract
// between pipeline/ and src/ (docs/model-format.md).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { readGlbJson, readSoftMeshes, partVolumes } from '../dev/glb.mjs'
import { prepareFitModel, priorWeights, muscleVolume } from '../src/fit.js'
import { GROUPS, MUSCLES, TISSUES, REGIONS, AREAS, TRAINING_GROUPS } from '../src/catalog.generated.js'
import { resolveActivations } from '../src/activation.js'
import { POSES, poseActivations } from '../src/poses.js'
import { VIEWS } from '../src/views.js'
import { STRINGS, resolveLocale, stringsFor, localized, format } from '../src/i18n.js'
import { partLabel, groupLabel } from '../src/anatomy.js'

const MODELS = ['male', 'male-lite', 'female', 'female-lite']
const docs = Object.fromEntries(MODELS.map((m) => [m, readGlbJson(fileURLToPath(new URL(`../public/models/${m}.glb`, import.meta.url)))]))
const regionIds = REGIONS.flatMap((r) => (r.sided ? [`${r.id}_l`, `${r.id}_r`] : [r.id]))

for (const [name, doc] of Object.entries(docs)) {
  describe(`${name}.glb`, () => {
    const x = doc.extras

    test('format, attribution and metadata', () => {
      assert.equal(x.format, 'body3d')
      assert.equal(x.version, 2)
      assert.match(x.attribution, /BodyParts3D.*CC Attribution 4\.0/)
      assert.equal(x.sex, name.split('-')[0])
      assert.deepEqual(doc.extensionsRequired, ['KHR_mesh_quantization'])
    })

    test('every part is known to the catalog', () => {
      const muscles = new Set(MUSCLES.map((m) => m.id))
      const tissues = new Set(TISSUES.map((t) => t.id))
      const groups = new Set(GROUPS.map((g) => g.id))
      for (const p of x.parts) {
        assert.ok(['muscle', 'tissue', 'bone', 'cartilage'].includes(p.kind), p.id)
        if (p.kind === 'muscle') assert.ok(muscles.has(p.base) && groups.has(p.group), p.id)
        if (p.kind === 'tissue') assert.ok(tissues.has(p.base), p.id)
        if (p.kind === 'bone' || p.kind === 'cartilage') assert.ok(p.segment, p.id)
        assert.ok(partLabel(p, 'en') && partLabel(p, 'pt-BR'), p.id)
      }
      // both sides of every muscle
      for (const m of MUSCLES) {
        assert.ok(x.parts.some((p) => p.id === `${m.id}_l`) && x.parts.some((p) => p.id === `${m.id}_r`), m.id)
      }
    })

    test('groups, regions and joints match the catalog and the rig', () => {
      assert.deepEqual(x.groups.map((g) => g.id), GROUPS.map((g) => g.id))
      assert.deepEqual(x.body.regions, regionIds)
      assert.equal(x.joints.length, 52)
      const names = new Set(x.joints.map((j) => j.name))
      for (const j of x.joints) assert.ok(j.parent === null || names.has(j.parent), j.name)
      // parents before children (the order the pipeline and the GLB node tree rely on)
      const seen = new Set()
      for (const j of x.joints) { assert.ok(j.parent === null || seen.has(j.parent), j.name); seen.add(j.name) }
    })

    test('poses: known joints, preset views, activations that resolve', () => {
      const joints = new Set(x.joints.map((j) => j.name))
      for (const pose of POSES[x.sex]) {
        for (const j of Object.keys(pose.joints)) assert.ok(joints.has(j), `${pose.id}: ${j}`)
        assert.ok(VIEWS[pose.view], `${pose.id}: view ${pose.view}`)
        const { unknown, values } = resolveActivations(poseActivations(pose), x.parts)
        assert.deepEqual(unknown, [], pose.id)
        assert.ok(values.some((v) => v > 0), pose.id)
        assert.ok(pose.label.en && pose.label['pt-BR'], pose.id)
      }
    })
  })
}

describe('catalog', () => {
  test('every group has muscles, an area and labels in both languages', () => {
    const areas = new Set(AREAS.map((a) => a.id))
    for (const g of GROUPS) {
      assert.ok(areas.has(g.area), g.id)
      assert.ok(MUSCLES.some((m) => m.group === g.id), g.id)
      assert.ok(g.label.en && g.label['pt-BR'], g.id)
      assert.ok(groupLabel(g.id, 'pt-BR'))
    }
    for (const m of MUSCLES) assert.ok(m.label.en && m.label['pt-BR'], m.id)
  })

  test('every training-group target is a group or a muscle; ids are unique', () => {
    const ids = new Set([...GROUPS.map((g) => g.id), ...MUSCLES.map((m) => m.id)])
    for (const t of TRAINING_GROUPS) for (const k of Object.keys(t.targets)) assert.ok(ids.has(k), `${t.id}: ${k}`)
    assert.equal(new Set(TRAINING_GROUPS.map((t) => t.id)).size, TRAINING_GROUPS.length)
  })

  test('every group is in exactly one fit region', () => {
    for (const g of GROUPS) assert.equal(REGIONS.filter((r) => r.groups.includes(g.id)).length, 1, g.id)
  })
})

describe('i18n', () => {
  test('every interface string exists in every built-in locale', () => {
    for (const [locale, strings] of Object.entries(STRINGS)) {
      for (const key of Object.keys(STRINGS.en)) assert.ok(strings[key], `${locale}.${key}`)
    }
  })

  test('locale tags resolve to the built-in ones; unknown tags fall back to English', () => {
    assert.equal(resolveLocale('pt_BR'), 'pt-BR')
    assert.equal(resolveLocale('pt'), 'pt-BR')
    assert.equal(resolveLocale('en-GB'), 'en')
    assert.equal(resolveLocale('es'), 'en')
    assert.equal(resolveLocale('es', { es: {} }), 'es')
    assert.equal(resolveLocale(null), 'en')
  })

  test('overrides and formatting', () => {
    assert.equal(stringsFor('pt-BR', { 'pt-BR': { yourView: 'você' } }).yourView, 'você')
    assert.equal(stringsFor('es', { es: { left: 'izquierdo' } }).right, 'right')
    assert.equal(localized({ en: 'Chest', 'pt-BR': 'Peitoral' }, 'pt-BR'), 'Peitoral')
    assert.equal(localized({ en: 'Chest' }, 'fr'), 'Chest')
    assert.equal(format(STRINGS.en.modelLabelActive, { list: 'Chest 90%' }), '3D muscle model. Activation: Chest 90%.')
  })
})

describe('meshes against the fit data', () => {
  // the fit never reads the meshes: its volume polynomial must describe them exactly
  for (const name of MODELS) {
    test(`${name}: the muscle volume of the meshes is the fit's volume polynomial`, () => {
      const mesh = readSoftMeshes(fileURLToPath(new URL(`../public/models/${name}.glb`, import.meta.url)))
      const model = prepareFitModel(docs[name].extras.body)
      const [lo, hi] = [model.table[0][0], model.table[model.table.length - 1][0]]
      for (const ffmi of [lo + 2, (lo + hi) / 2, hi - 2]) {
        const w = priorWeights(model, ffmi).w
        const vol = partVolumes(mesh, w)
        const meshes = mesh.parts.reduce((s, p, i) => s + (p.kind === 'muscle' ? vol[i] : 0), 0) * 1000
        const poly = muscleVolume(model, w).total
        assert.ok(Math.abs(meshes / poly - 1) < 1e-3, `FFMI ${ffmi}: meshes ${meshes.toFixed(3)} L, polynomial ${poly.toFixed(3)} L`)
      }
    })
  }
})
