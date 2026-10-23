// A study of the automatic view with people who teach exercise (docs/validation/studies.md).
//
//   npm run dev                                       # in another terminal (port 5190)
//   node dev/view-study.mjs build <exercises.json> <dir> [--count 30] [--codes a,b,…] [--lang en|pt-BR]
//   node dev/view-study.mjs analyze <dir> <answers.json> … [--json out.json]
//
// build: picks the exercises — `--codes`, or `--count` of the most popular ones stratified by the
// azimuth bestView() chooses —, renders each from the eight azimuths bestView() considers (whole
// body, low camera, no zoom) and writes <dir>/index.html, a page that works offline: every rater
// picks the view that best shows the exercise's muscles, marks the others that would also do,
// says when one side is not enough, and downloads their answers. The algorithm's choices stay out
// of the page, in <dir>/key.json. The catalog is a JSON array of `{ code, name, popularity,
// primaryMuscles, secondaryMuscles }` (the format of dev/evaluate-views.mjs).
//
// analyze: agreement between raters (Fleiss' κ, mean pairwise agreement) and between the
// algorithm and the raters (its azimuth is the rater's best; is among the rater's acceptable
// views; matches the majority of the raters), per exercise and overall.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const YAWS = [0, 45, 90, 135, 180, -135, -90, -45]
const [command, ...rest] = process.argv.slice(2)
const opt = (k, d) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : d }

// ------------------------------------------------------------------ build

/** Quotas per azimuth proportional to `counts` (largest remainder), at least one per azimuth seen. */
function quotas(counts, total) {
  const keys = Object.keys(counts)
  const sum = keys.reduce((s, k) => s + counts[k], 0)
  const q = Object.fromEntries(keys.map((k) => [k, Math.max(1, Math.floor(total * counts[k] / sum))]))
  const order = [...keys].sort((a, b) => (total * counts[b] / sum) % 1 - (total * counts[a] / sum) % 1)
  for (let i = 0; keys.reduce((s, k) => s + q[k], 0) < total; i++) q[order[i % order.length]]++
  for (let i = 0; keys.reduce((s, k) => s + q[k], 0) > total; i++) {
    const k = [...keys].sort((a, b) => q[b] - q[a])[0]
    q[k]--
  }
  return q
}

async function build(file, dir) {
  if (!file || !dir) throw new Error('build: <exercises.json> <dir>')
  const count = Number(opt('--count', 30))
  const codes = opt('--codes')?.split(',')
  const lang = opt('--lang', 'en')
  const BASE = process.env.BODY3D_URL ?? 'http://localhost:5190'
  const CHROME = process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: 'chrome' }
  const catalog = JSON.parse(readFileSync(file, 'utf8'))
    .filter((e) => (e.primaryMuscles ?? []).length)
    .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0) || a.code.localeCompare(b.code))
  mkdirSync(join(dir, 'img'), { recursive: true })

  const browser = await chromium.launch(CHROME)
  const page = await browser.newPage({ viewport: { width: 200, height: 300 } })
  await page.goto(`${BASE}/embed.html?model=male&credit=0&bg=%23eef0ee`)
  await page.waitForFunction(() => window.ready === true, null, { timeout: 120000 })
  await page.evaluate(async () => {
    window.fromExercise = (await import('/src/activation.js')).fromExercise
    window.FRONT_VIEW = (await import('/src/views.js')).FRONT_VIEW
    window.viewer.splitButton?.remove()
  })
  const best = (e) => page.evaluate((ex) => {
    const v = window.viewer
    v.setActivations(window.fromExercise({ primaryMuscles: ex.primaryMuscles ?? [], secondaryMuscles: ex.secondaryMuscles ?? [] }),
      { animate: false })
    return v.bestView()
  }, e)

  // the algorithm's view of the candidates (most popular first), then the stratified pick
  const pool = codes ? catalog.filter((e) => codes.includes(e.code)) : catalog.slice(0, Math.max(count * 4, 100))
  for (const e of pool) e.algorithm = await best(e)
  let chosen = pool
  if (!codes) {
    const byYaw = {}
    for (const e of pool) (byYaw[e.algorithm.yaw] ??= []).push(e)
    const q = quotas(Object.fromEntries(Object.entries(byYaw).map(([y, l]) => [y, l.length])), count)
    chosen = Object.entries(byYaw).flatMap(([y, l]) => l.slice(0, q[y]))
  }
  console.log(`${chosen.length} exercises; algorithm's azimuths:`,
    JSON.stringify(chosen.reduce((m, e) => ({ ...m, [e.algorithm.yaw]: (m[e.algorithm.yaw] ?? 0) + 1 }), {})))

  const items = []
  for (const [i, e] of chosen.entries()) {
    await page.evaluate((ex) => window.viewer.setActivations(window.fromExercise({
      primaryMuscles: ex.primaryMuscles ?? [], secondaryMuscles: ex.secondaryMuscles ?? []
    }), { animate: false }), e)
    for (const yaw of YAWS) {
      await page.evaluate((y) => { window.viewer.setView({ ...window.FRONT_VIEW, yaw: y }, { animate: false }); window.viewer.render() }, yaw)
      await page.waitForTimeout(40)
      await page.screenshot({ path: join(dir, 'img', `${i}_${yaw}.jpg`), type: 'jpeg', quality: 82 })
    }
    const names = (l) => (l ?? []).map((m) => m.name ?? m)
    items.push({ id: i, code: e.code, name: e.name, primary: names(e.primaryMuscles), secondary: names(e.secondaryMuscles) })
  }
  await browser.close()
  writeFileSync(join(dir, 'key.json'), JSON.stringify({
    yaws: YAWS, exercises: chosen.map((e, i) => ({ id: i, code: e.code, name: e.name, algorithm: e.algorithm }))
  }, null, 2) + '\n')
  writeFileSync(join(dir, 'index.html'), page_(items, lang))
  console.log(`wrote ${join(dir, 'index.html')} and key.json — send the folder (without key.json) to the raters`)
}

const STRINGS = {
  en: {
    title: 'Which view shows the exercise best?',
    intro: 'For each exercise, click the picture that best shows the muscles it works (highlighted). ' +
      'Tick “also fine” under any other picture that would do. Tick “needs both sides” when no single view is enough. ' +
      'When you finish, download your answers and send the file back.',
    rater: 'Your name', primary: 'Primary', secondary: 'Secondary', ok: 'also fine', both: 'needs both sides',
    progress: (n, t) => `${n} of ${t} answered`, download: 'Download answers',
    yaws: { 0: 'front', 45: 'front ¾ (its left)', 90: 'left side', 135: 'back ¾ (its left)', 180: 'back',
      '-135': 'back ¾ (its right)', '-90': 'right side', '-45': 'front ¾ (its right)' }
  },
  'pt-BR': {
    title: 'Qual vista mostra melhor o exercício?',
    intro: 'Em cada exercício, clique na imagem que melhor mostra os músculos trabalhados (em destaque). ' +
      'Marque “também serve” embaixo de outras imagens que serviriam. Marque “precisa dos dois lados” quando nenhuma vista ' +
      'sozinha basta. No fim, baixe suas respostas e envie o arquivo.',
    rater: 'Seu nome', primary: 'Principais', secondary: 'Secundários', ok: 'também serve', both: 'precisa dos dois lados',
    progress: (n, t) => `${n} de ${t} respondidos`, download: 'Baixar respostas',
    yaws: { 0: 'frente', 45: 'frente ¾ (esq. do corpo)', 90: 'lado esquerdo', 135: 'costas ¾ (esq. do corpo)', 180: 'costas',
      '-135': 'costas ¾ (dir. do corpo)', '-90': 'lado direito', '-45': 'frente ¾ (dir. do corpo)' }
  }
}

/** The rater's page: self-contained, pictures in img/, answers kept in the browser until downloaded. */
function page_(items, lang) {
  const t = STRINGS[lang] ?? STRINGS.en
  const data = JSON.stringify({ items, yaws: YAWS, t: { ...t, progress: null } })
  const progress = t.progress.toString()
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${t.title}</title>
<style>
  :root { --bg: #f7f7f5; --fg: #1d1f1e; --muted: #5e6461; --line: #d5d8d5; --accent: #c2410c; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.45 system-ui, sans-serif; }
  main { max-width: 1100px; margin: 0 auto; padding: 16px; }
  header { position: sticky; top: 0; background: var(--bg); padding: 8px 0; border-bottom: 1px solid var(--line); z-index: 1;
    display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
  section { margin: 20px 0 28px; }
  h2 { margin: 0 0 4px; font-size: 18px; }
  .muscles { color: var(--muted); margin-bottom: 10px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 8px; }
  figure { margin: 0; text-align: center; font-size: 12px; color: var(--muted); }
  figure button { display: block; width: 100%; padding: 0; border: 3px solid transparent; border-radius: 6px; background: none; cursor: pointer; }
  figure button[aria-pressed="true"] { border-color: var(--accent); }
  figure img { display: block; width: 100%; border-radius: 3px; }
  label { cursor: pointer; }
  input[type=text] { font: inherit; padding: 4px 8px; }
  #download { font: inherit; padding: 6px 14px; }
</style></head>
<body><main>
<h1>${t.title}</h1><p>${t.intro}</p>
<header><label>${t.rater}: <input id="rater" type="text" autocomplete="name"></label>
<span id="progress"></span><button id="download" type="button">${t.download}</button></header>
<div id="list"></div>
</main>
<script>
const D = ${data}
const progressText = ${progress}
const key = 'body3d-view-study'
let state = {}
try { state = JSON.parse(localStorage.getItem(key)) || {} } catch {}
state.answers ??= {}
const save = () => { try { localStorage.setItem(key, JSON.stringify(state)) } catch {} }
const rater = document.getElementById('rater')
rater.value = state.rater || ''
rater.oninput = () => { state.rater = rater.value; save() }
// a different order for every rater, so fatigue does not fall on the same exercises
const order = D.items.map((x) => x.id).sort(() => Math.random() - 0.5)
const list = document.getElementById('list')
for (const id of order) {
  const it = D.items.find((x) => x.id === id)
  const a = (state.answers[it.code] ??= { best: null, ok: [], both: false })
  const s = document.createElement('section')
  const h = document.createElement('h2'); h.textContent = it.name; s.append(h)
  const m = document.createElement('div'); m.className = 'muscles'
  m.textContent = D.t.primary + ': ' + it.primary.join(', ') + (it.secondary.length ? ' · ' + D.t.secondary + ': ' + it.secondary.join(', ') : '')
  s.append(m)
  const grid = document.createElement('div'); grid.className = 'grid'
  const buttons = []
  for (const yaw of D.yaws) {
    const f = document.createElement('figure')
    const b = document.createElement('button'); b.type = 'button'
    b.setAttribute('aria-pressed', String(a.best === yaw))
    b.setAttribute('aria-label', D.t.yaws[yaw])
    const img = document.createElement('img'); img.src = 'img/' + it.id + '_' + yaw + '.jpg'; img.alt = D.t.yaws[yaw]; img.loading = 'lazy'
    b.append(img)
    b.onclick = () => { a.best = yaw; buttons.forEach((x) => x.setAttribute('aria-pressed', String(x === b))); save(); count() }
    buttons.push(b)
    const cap = document.createElement('figcaption'); cap.textContent = D.t.yaws[yaw]
    const l = document.createElement('label'); const c = document.createElement('input'); c.type = 'checkbox'
    c.checked = a.ok.includes(yaw)
    c.onchange = () => { a.ok = c.checked ? [...new Set([...a.ok, yaw])] : a.ok.filter((y) => y !== yaw); save() }
    l.append(c, ' ' + D.t.ok)
    f.append(b, cap, l); grid.append(f)
  }
  s.append(grid)
  const lb = document.createElement('label'); const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = a.both
  cb.onchange = () => { a.both = cb.checked; save() }
  lb.append(cb, ' ' + D.t.both); s.append(lb)
  list.append(s)
}
function count() {
  const n = D.items.filter((it) => state.answers[it.code]?.best != null).length
  document.getElementById('progress').textContent = progressText(n, D.items.length)
}
count()
document.getElementById('download').onclick = () => {
  const blob = new Blob([JSON.stringify({ rater: state.rater || '', answers: state.answers }, null, 2)], { type: 'application/json' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
  a.download = 'views-' + (state.rater || 'rater').replace(/[^\\w-]+/g, '_') + '.json'; a.click()
}
</script></body></html>
`
}

// ------------------------------------------------------------------ analyze

/** Fleiss' κ for items × categories counts (every item rated by the same number of raters). */
function fleissKappa(counts) {
  const N = counts.length
  const n = counts[0].reduce((s, x) => s + x, 0)
  const k = counts[0].length
  const p = new Array(k).fill(0)
  let Pbar = 0
  for (const row of counts) {
    row.forEach((c, j) => { p[j] += c / (N * n) })
    Pbar += (row.reduce((s, c) => s + c * c, 0) - n) / (n * (n - 1)) / N
  }
  const Pe = p.reduce((s, x) => s + x * x, 0)
  return (Pbar - Pe) / (1 - Pe)
}

function analyze(dir, files) {
  if (!dir || !files.length) throw new Error('analyze: <dir> <answers.json> …')
  const key = JSON.parse(readFileSync(join(dir, 'key.json'), 'utf8'))
  const raters = files.map((f) => JSON.parse(readFileSync(f, 'utf8')))
  const answered = key.exercises.filter((e) => raters.every((r) => r.answers[e.code]?.best != null))
  const rows = answered.map((e) => {
    const bests = raters.map((r) => r.answers[e.code].best)
    const okSets = raters.map((r) => new Set([r.answers[e.code].best, ...(r.answers[e.code].ok ?? [])]))
    const tally = key.yaws.map((y) => bests.filter((b) => b === y).length)
    const top = Math.max(...tally)
    const modes = key.yaws.filter((_, j) => tally[j] === top)
    return {
      code: e.code, name: e.name, algorithm: e.algorithm.yaw, modes, tally,
      algorithmIsBest: bests.filter((b) => b === e.algorithm.yaw).length / raters.length,
      algorithmAcceptable: okSets.filter((s) => s.has(e.algorithm.yaw)).length / raters.length,
      algorithmIsMajority: modes.includes(e.algorithm.yaw) && top > raters.length / 2,
      bothSides: raters.filter((r) => r.answers[e.code].both).length / raters.length
    }
  })
  const mean = (a) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length)
  // agreement on the best view: pairs of raters vs (algorithm, rater) pairs
  let pairs = 0, agree = 0
  for (const e of answered) {
    for (let i = 0; i < raters.length; i++) {
      for (let j = i + 1; j < raters.length; j++) {
        pairs++
        if (raters[i].answers[e.code].best === raters[j].answers[e.code].best) agree++
      }
    }
  }
  const summary = {
    raters: raters.length, exercises: answered.length,
    fleissKappa: raters.length > 1 ? fleissKappa(rows.map((r) => r.tally)) : null,
    raterRaterAgreement: pairs ? agree / pairs : null,
    algorithmRaterAgreement: mean(rows.map((r) => r.algorithmIsBest)),
    algorithmAcceptable: mean(rows.map((r) => r.algorithmAcceptable)),
    algorithmMajority: mean(rows.map((r) => (r.algorithmIsMajority ? 1 : 0))),
    rows
  }
  const pc = (x) => (x == null ? '—' : `${Math.round(100 * x)} %`)
  console.log(`${summary.raters} raters, ${summary.exercises} exercises answered by all`)
  console.log(`  raters among themselves: same best view ${pc(summary.raterRaterAgreement)} of pairs, ` +
    `Fleiss κ ${summary.fleissKappa == null ? '—' : summary.fleissKappa.toFixed(2)}`)
  console.log(`  algorithm vs raters: same best view ${pc(summary.algorithmRaterAgreement)}, among the acceptable views ` +
    `${pc(summary.algorithmAcceptable)}, matches a strict majority ${pc(summary.algorithmMajority)} of the exercises`)
  console.log('  exercise                           algorithm   raters (best)                      acceptable   both sides')
  for (const r of rows) {
    const t = key.yaws.map((y, j) => (r.tally[j] ? `${y}:${r.tally[j]}` : null)).filter(Boolean).join(' ')
    console.log(`  ${r.code.slice(0, 34).padEnd(34)} ${String(r.algorithm).padStart(6)}      ${t.padEnd(34)} ${pc(r.algorithmAcceptable).padStart(6)}       ${pc(r.bothSides)}`)
  }
  const jsonAt = rest.indexOf('--json')
  if (jsonAt >= 0) writeFileSync(rest[jsonAt + 1], JSON.stringify(summary, null, 2) + '\n')
}

// ------------------------------------------------------------------ main (after the constants above)

if (command === 'build') await build(rest[0], rest[1])
else if (command === 'analyze') analyze(rest[0], rest.slice(1).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--json'))
else {
  console.error('usage: node dev/view-study.mjs build <exercises.json> <dir> [--count 30] [--codes a,b] [--lang en|pt-BR]\n' +
    '       node dev/view-study.mjs analyze <dir> <answers.json> … [--json out.json]')
  process.exit(1)
}
