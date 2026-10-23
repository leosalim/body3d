// Compile-time check of src/index.d.ts against typical use (`npm run typecheck`; never executed).
import {
  BodyViewer, createBodyViewer, defineBodyElement, fromExercise, fitBody, prepareFitModel, targetsOf, toViewSpec,
  TRAINING_GROUPS, POSES, type Activation, type ViewSpec, type FitResult, type PartInfo, type BodyInput
} from 'body3d'

declare const el: HTMLElement

const viewer: BodyViewer = createBodyViewer(el, { model: 'female', view: 'auto', locale: 'pt-BR', colors: { high: '#c00' } })
const list: Activation[] = [{ muscle: 'Chest', activation: 90 }, { muscle: 'Triceps', activation: 50, side: 'left' }]
viewer.setActivations(list, { animate: false }).setFocus(1).setView('back').setSplit(true)
viewer.setActivations(fromExercise({ primaryMuscles: [{ name: 'Glutes' }], secondaryMuscles: ['Hamstrings'] }))

viewer.addEventListener('select', (e) => {
  const info: PartInfo | null = e.detail
  if (info) console.log(info.label, info.groupLabel, info.activation)
})
viewer.addEventListener('viewchange', (e) => {
  const v: ViewSpec = e.detail
  console.log(v.yaw, v.pitch, v.zoom, v.focus[0])
})
viewer.addEventListener('fit', (e) => {
  const fit: FitResult = e.detail
  console.log(fit.ffmi, fit.sites.map((s) => s.status))
})

const body: BodyInput = { heightCm: 178, weightKg: 82, bodyFatPercent: 14, bodyFatMethod: 'BIA', girths: { RIGHT_BICEP: 39 } }
viewer.setBody(body)
const saved: ViewSpec | null = viewer.getView()
if (saved) viewer.setView(saved)
const best: ViewSpec = viewer.bestView()
viewer.setView(toViewSpec('front-left'))
void best

const model = prepareFitModel({}, { calibration: null, populationSpread: 2 })
if (model) {
  const result: FitResult = fitBody(model, body)
  console.log(result.weights.length)
}

const targets: Record<string, number> | null = targetsOf('Peitoral', { Peito: 'chest' })
console.log(targets, TRAINING_GROUPS[0].label['pt-BR'], POSES.male[0].label.en)
defineBodyElement('my-body')
viewer.dispose()
