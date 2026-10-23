// Page for an <iframe>. Configured by the URL, then by postMessage.
//
//   embed.html?model=female&view=back&pose=back-pose&a=Chest:90,Triceps:50&locale=pt-BR&bg=%23101214
//
// URL parameters: model, view, pose, lod, locale, models (model folder), bg (background colour),
// rotate (auto-rotate), bones=0, credit=0, a (activations: name:percent[:left|right], comma
// separated), origin (see below).
//
// Messages accepted from the parent:
//   { type: 'body3d:set', activations?, model?, pose?, view?, focus?, ffmi?, body?, rings?, locale? }
//   (pose: an id of viewer.poses, or null to stand; without `view` the camera turns to the pose's
//   view. body: the person's measures, as in viewer.setBody. rings: draw the tape of each measure)
// Messages sent to the parent:
//   { type: 'body3d:ready' | 'body3d:select' | 'body3d:hover' | 'body3d:fit' | 'body3d:viewchange', detail }
//
// `?origin=https://app.example` restricts who may send and receive messages; without it, any
// page embedding the iframe controls what it shows. Nothing here reads personal data on its own:
// measures only arrive when the parent sends them, and the fit result (body3d:fit, which echoes
// them) only goes back when `origin` is set.
import { BodyViewer } from './viewer.js'

const q = new URLSearchParams(location.search)
const allowed = q.get('origin')
const target = allowed || '*'

function parseList(s) {
  if (!s) return []
  return s.split(',').map((item) => {
    const [muscle, pct, side] = item.split(':')
    return { muscle, activation: Number(pct ?? 100), ...(side ? { side } : {}) }
  })
}

const viewer = new BodyViewer(document.getElementById('body'), {
  model: q.get('model') || 'male',
  view: q.get('view') || 'front',
  pose: q.get('pose') || null,
  lod: q.get('lod') || 'auto',
  locale: q.get('locale') || 'en',
  modelBaseUrl: q.get('models') || new URL('./models/', location.href).href,
  background: q.get('bg') || null,
  autoRotate: q.has('rotate'),
  showBones: q.get('bones') !== '0',
  credit: q.get('credit') !== '0',
  activations: parseList(q.get('a'))
})

const post = (type, detail) => { if (parent !== window) parent.postMessage({ type, detail }, target) }
viewer.addEventListener('load', () => {
  window.ready = true
  post('body3d:ready', { model: viewer.options.model, poses: viewer.poses.map(({ id, label, view }) => ({ id, label, view })) })
})
viewer.addEventListener('select', (e) => post('body3d:select', e.detail))
viewer.addEventListener('hover', (e) => post('body3d:hover', e.detail))
viewer.addEventListener('viewchange', (e) => post('body3d:viewchange', e.detail))
viewer.addEventListener('fit', (e) => {
  if (!allowed) return
  const { weights, uncertainty: _uncertainty, ...detail } = e.detail
  post('body3d:fit', { ...detail, weights: Array.from(weights) })
})

addEventListener('message', async (e) => {
  if (allowed && e.origin !== allowed) return
  const m = e.data
  if (!m || m.type !== 'body3d:set') return
  if (m.locale) viewer.setLocale(m.locale)
  if (m.model && m.model !== viewer.options.model) await viewer.setModel(m.model)
  if (m.pose !== undefined) viewer.setPose(m.pose, { view: !m.view })
  if (m.view) viewer.setView(m.view)
  if (Array.isArray(m.activations)) viewer.setActivations(m.activations)
  if (typeof m.focus === 'number') viewer.setFocus(m.focus)
  if (m.body !== undefined) viewer.setBody(m.body)
  else if (m.ffmi !== undefined) viewer.setFfmi(m.ffmi)
  if (typeof m.rings === 'boolean') viewer.setMeasureRings(m.rings)
})

window.viewer = viewer
