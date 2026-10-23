// Demo page: builds the activation list the way an application would.
import { BodyViewer } from './viewer.js'
import { TRAINING_GROUPS } from './catalog.generated.js'
import { poseActivations } from './poses.js'
import { localized } from './i18n.js'

// Illustrative percentages (the order of magnitude of EMG studies), not measurements. Keys are
// training-group ids (TRAINING_GROUPS).
const EXERCISES = [
  [{ en: 'Bench press', 'pt-BR': 'Supino reto' }, { chest: 100, triceps: 60, 'anterior-deltoids': 55 }],
  [{ en: 'Back squat', 'pt-BR': 'Agachamento livre' }, { quadriceps: 100, glutes: 85, adductors: 55, 'lower-back': 40, hamstrings: 35, abs: 25, calves: 20 }],
  [{ en: 'Deadlift', 'pt-BR': 'Levantamento terra' }, { glutes: 95, hamstrings: 90, 'lower-back': 90, trapezius: 60, forearms: 60, quadriceps: 55, adductors: 50, lats: 40 }],
  [{ en: 'Lat pulldown', 'pt-BR': 'Puxada frontal' }, { lats: 100, biceps: 60, 'upper-back': 55, 'posterior-deltoids': 40, forearms: 35 }],
  [{ en: 'Bent-over row', 'pt-BR': 'Remada curvada' }, { lats: 90, 'upper-back': 90, 'posterior-deltoids': 60, biceps: 50, 'lower-back': 45 }],
  [{ en: 'Overhead press', 'pt-BR': 'Desenvolvimento' }, { 'anterior-deltoids': 100, 'lateral-deltoids': 75, triceps: 60, trapezius: 40, 'upper-chest': 30 }],
  [{ en: 'Lateral raise', 'pt-BR': 'Elevação lateral' }, { 'lateral-deltoids': 100, trapezius: 45, 'anterior-deltoids': 35 }],
  [{ en: 'Barbell curl', 'pt-BR': 'Rosca direta' }, { biceps: 100, brachialis: 70, forearms: 45 }],
  [{ en: 'Skull crusher', 'pt-BR': 'Tríceps testa' }, { triceps: 100, forearms: 20 }],
  [{ en: 'Hip thrust', 'pt-BR': 'Elevação pélvica' }, { glutes: 100, hamstrings: 45, adductors: 30, quadriceps: 30 }],
  [{ en: 'Hip abduction machine', 'pt-BR': 'Cadeira abdutora' }, { abductors: 100, glutes: 40 }],
  [{ en: 'Standing calf raise', 'pt-BR': 'Panturrilha em pé' }, { calves: 100 }],
  [{ en: 'Plank', 'pt-BR': 'Prancha' }, { abs: 90, obliques: 70, 'anterior-deltoids': 30, quadriceps: 20 }]
]

const UI = {
  en: {
    title: '3D muscles', sub: 'Muscle activation on BodyParts3D, with an FFMI-driven body.', poses: 'Poses',
    exercises: 'Exercises', groups: 'Training groups', body: 'Body', ffmi: 'Normalized FFMI', display: 'Display',
    bones: 'Skeleton', focus: 'Dim what is not active', rotate: 'Auto-rotate', input: 'Input sent to the viewer',
    clear: 'Clear activations', standing: 'Standing', tap: 'Tap a muscle to see its name.', male: 'Male',
    female: 'Female', front: 'Front', back: 'Back', left: 'Left', right: 'Right', sideL: 'left', sideR: 'right'
  },
  'pt-BR': {
    title: 'Músculos 3D', sub: 'Ativação muscular sobre o BodyParts3D, com corpo por FFMI.', poses: 'Poses',
    exercises: 'Exercícios', groups: 'Grupos de treino', body: 'Corpo', ffmi: 'FFMI normalizado', display: 'Exibição',
    bones: 'Esqueleto', focus: 'Esmaecer o que não está ativo', rotate: 'Girar sozinho', input: 'Entrada enviada ao visualizador',
    clear: 'Limpar ativações', standing: 'Em pé', tap: 'Toque em um músculo para ver o nome.', male: 'Masculino',
    female: 'Feminino', front: 'Frente', back: 'Costas', left: 'Esquerda', right: 'Direita', sideL: 'esquerdo', sideR: 'direito'
  }
}

const $ = (s) => document.querySelector(s)
const info = $('#info')
let locale = new URLSearchParams(location.search).get('locale') === 'pt-BR' ? 'pt-BR' : 'en'
const t = (k) => UI[locale][k]
const state = Object.fromEntries(TRAINING_GROUPS.map((g) => [g.id, 0]))
let extra = []  // pose activations outside the training groups (e.g. serratus)

const viewer = new BodyViewer($('#viewer'), { locale, modelBaseUrl: new URL('./models/', location.href).href })
window.viewer = viewer

function list() {
  return Object.entries(state).filter(([, v]) => v > 0)
    .map(([id, activation]) => ({ muscle: localized(TRAINING_GROUPS.find((g) => g.id === id).label, 'en'), activation }))
    .concat(extra)
}

function clearPresets() {
  document.querySelectorAll('#presets button, #poses button').forEach((b) => b.classList.remove('on'))
}

function apply() {
  const l = list()
  viewer.setActivations(l)
  $('#json').textContent = JSON.stringify(l, null, 1).replace(/\n\s+(?=[^[{\s])/g, ' ')
  for (const [k, v] of Object.entries(state)) {
    const row = document.querySelector(`[data-group="${CSS.escape(k)}"]`)
    row.querySelector('input').value = v
    row.querySelector('output').textContent = v ? `${v}%` : '—'
  }
}

function renderGroups() {
  const el = $('#groups')
  el.replaceChildren()
  const rows = [...TRAINING_GROUPS].sort((a, b) => localized(a.label, locale).localeCompare(localized(b.label, locale), locale))
  for (const g of rows) {
    const row = document.createElement('label')
    row.className = 'row'
    row.dataset.group = g.id
    const name = document.createElement('span')
    name.textContent = localized(g.label, locale)
    const input = Object.assign(document.createElement('input'), { type: 'range', min: 0, max: 100, step: 5, value: state[g.id] })
    const out = document.createElement('output')
    out.textContent = state[g.id] ? `${state[g.id]}%` : '—'
    input.addEventListener('input', () => {
      state[g.id] = Number(input.value)
      clearPresets()
      apply()
    })
    row.append(name, input, out)
    el.appendChild(row)
  }
}

function renderExercises() {
  const el = $('#presets')
  el.replaceChildren()
  for (const [label, acts] of EXERCISES) {
    const b = document.createElement('button')
    b.textContent = localized(label, locale)
    b.addEventListener('click', () => {
      for (const k of Object.keys(state)) state[k] = acts[k] ?? 0
      extra = []
      clearPresets()
      b.classList.add('on')
      viewer.setPose(null)
      apply()
      // the best view for these muscles (what an application stores per exercise)
      viewer.autoView()
      document.querySelectorAll('#views button').forEach((x) => x.classList.remove('on'))
    })
    el.appendChild(b)
  }
}

// poses of the loaded model (they change with the sex)
function renderPoses() {
  const el = $('#poses')
  el.replaceChildren()
  const stand = document.createElement('button')
  stand.textContent = t('standing')
  stand.classList.toggle('on', !viewer.pose)
  stand.addEventListener('click', () => { clearPresets(); stand.classList.add('on'); viewer.setPose(null) })
  el.appendChild(stand)
  const byName = new Map(TRAINING_GROUPS.map((g) => [g.label.en, g.id]))
  for (const pose of viewer.poses) {
    const b = document.createElement('button')
    b.textContent = pose.label
    b.classList.toggle('on', viewer.pose === pose.id)
    b.addEventListener('click', () => {
      for (const k of Object.keys(state)) state[k] = 0
      extra = []
      for (const a of poseActivations(pose)) {
        const id = byName.get(a.muscle)
        if (id) state[id] = a.activation
        else extra.push(a)
      }
      clearPresets()
      b.classList.add('on')
      viewer.setPose(pose.id, { view: true })
      document.querySelectorAll('#views button').forEach((x) => x.classList.toggle('on', x.dataset.v === pose.view))
      apply()
    })
    el.appendChild(b)
  }
}

function renderText() {
  document.documentElement.lang = locale
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t)
  document.querySelectorAll('#lang button').forEach((b) => b.classList.toggle('on', b.dataset.v === locale))
  showSelection(lastPick)
}

let lastPick = null
function showSelection(d) {
  if (!d) { info.textContent = t('tap'); return }
  const side = d.side === 'left' ? t('sideL') : d.side === 'right' ? t('sideR') : ''
  info.replaceChildren()
  const b = document.createElement('b')
  b.textContent = d.label
  info.append(b, [d.groupLabel, side].filter(Boolean).map((x) => ` · ${x}`).join(''))
  if (d.activation) {
    const a = document.createElement('b')
    a.textContent = `${d.activation}%`
    info.append(' · ', a)
  }
}

// stage bar
function seg(id, fn) {
  const el = $(id)
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button')
    if (!b) return
    el.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b))
    fn(b.dataset.v)
  })
}
seg('#sex', (v) => viewer.setModel(v).then(renderPoses))
seg('#views', (v) => viewer.setView(v))
seg('#lang', (v) => {
  locale = v
  viewer.setLocale(v)
  lastPick = lastPick ? viewer.partInfo(lastPick.index) : null
  renderText()
  renderGroups()
  renderExercises()
  renderPoses()
})
$('#bones').addEventListener('change', (e) => viewer.setShowBones(e.target.checked))
$('#focus').addEventListener('change', (e) => viewer.setFocus(e.target.checked ? 1 : 0))
$('#rotate').addEventListener('change', (e) => viewer.setAutoRotate(e.target.checked))
$('#clear').addEventListener('click', () => { for (const k of Object.keys(state)) state[k] = 0; extra = []; clearPresets(); apply() })

viewer.addEventListener('select', (e) => { lastPick = e.detail; showSelection(e.detail) })
// FFMI: the range changes with the sex (15–32 male, 12–26 female)
const ffmiInput = $('#ffmi')
const ffmiOut = $('#ffmi-out')
ffmiInput.addEventListener('input', () => {
  viewer.setFfmi(Number(ffmiInput.value))
  ffmiOut.textContent = ffmiInput.value
})
function syncFfmi() {
  const r = viewer.ffmiRange
  if (!r) return
  ffmiInput.min = r.min
  ffmiInput.max = r.max
  ffmiInput.value = viewer.ffmi
  ffmiOut.textContent = String(viewer.ffmi)
}

viewer.addEventListener('load', () => { renderPoses(); syncFfmi(); window.ready = true })
renderText()
renderGroups()
renderExercises()
apply()
