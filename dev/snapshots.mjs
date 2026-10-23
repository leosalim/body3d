// Visual regression harness for the viewer.
//
//   npm run dev                                   # in another terminal (port 5190)
//   node dev/snapshots.mjs <out-dir>              # render every scenario
//   node dev/snapshots.mjs <out-dir> --compare <baseline-dir>
//
// Each scenario loads embed.html, drives the public API of `window.viewer` with
// animations off (prefers-reduced-motion), saves a PNG and a JSON of what the API
// returned (picked part, saved view, best view, fit summary). With --compare, every
// PNG is diffed pixel by pixel against the baseline and every JSON field by value;
// the script exits with code 1 when something differs. Run it before and after a
// change to the viewer to see exactly what moved.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const out = args[0]
const baseline = args.includes('--compare') ? args[args.indexOf('--compare') + 1] : null
const BASE = process.env.BODY3D_URL ?? 'http://localhost:5190'
const CHROME = process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: 'chrome' }
// labels drawn on the canvas (split view) and returned by partInfo follow the locale
const LOCALE = args.includes('--locale') ? args[args.indexOf('--locale') + 1] : 'pt-BR'
if (!out) {
  console.error('usage: node dev/snapshots.mjs <out-dir> [--compare <baseline-dir>]')
  process.exit(2)
}

/**
 * Scenarios. `url` is the embed.html query; `run` executes in the page with `v` = viewer and
 * returns JSON-serialisable data to record. Only the public API is used, so the same file
 * runs against any version of the viewer.
 */
const SCENARIOS = [
  { id: 'male-front-rest', url: 'model=male&view=front' },
  { id: 'female-back-rest', url: 'model=female&view=back' },
  { id: 'male-back-lats', url: 'model=male&view=back',
    run: (v) => { v.setActivations([{ muscle: 'Dorsais', activation: 100 }, { muscle: 'Bíceps', activation: 50 }], { animate: false }) } },
  { id: 'female-quarter-glutes', url: 'model=female&view=back-left',
    run: (v) => { v.setActivations([{ muscle: 'glutes', activation: 100 }, { muscle: 'Posteriores da coxa', activation: 60 },
      { muscle: 'rectus-femoris', activation: 40, side: 'left' }], { animate: false }) } },
  { id: 'male-pose-double-biceps', url: 'model=male&view=front',
    run: (v) => { v.setPose('front-double-biceps', { animate: false }); v.setActivations(Object.entries(v.poses[0].activations).map(([muscle, activation]) => ({ muscle, activation })), { animate: false }) } },
  { id: 'female-pose-back', url: 'model=female&view=back',
    run: (v) => { v.setPose('back-pose', { animate: false }) } },
  { id: 'male-pose-side-chest', url: 'model=male&view=left',
    run: (v) => { v.setPose('side-chest', { animate: false }) } },
  { id: 'male-auto-triceps', url: 'model=male',
    run: (v) => {
      v.setActivations([{ muscle: 'Tríceps', activation: 100 }, { muscle: 'Antebraços', activation: 45 }], { animate: false })
      const best = v.bestView()
      v.setView(best, { animate: false })
      return { best, view: v.getView() }
    } },
  { id: 'male-auto-lateral-raise', url: 'model=male',
    run: (v) => {
      v.setActivations([{ muscle: 'Deltoide lateral', activation: 100 }, { muscle: 'Trapézio', activation: 45 }], { animate: false })
      v.autoView({ animate: false })
      return { view: v.getView() }
    } },
  { id: 'female-auto-chest', url: 'model=female',
    run: (v) => {
      v.setActivations([{ muscle: 'Peitoral', activation: 100 }, { muscle: 'Tríceps', activation: 45 }, { muscle: 'Deltoide anterior', activation: 45 }], { animate: false })
      return { best: v.bestView() }
    } },
  { id: 'male-split', url: 'model=male&view=front-right',
    run: (v) => { v.setActivations([{ muscle: 'Peitoral', activation: 90 }, { muscle: 'Trapézio', activation: 70 }], { animate: false }); v.setSplit(true) } },
  { id: 'male-ffmi-15', url: 'model=male',
    run: (v) => { v.setFfmi(15, { animate: false }); return { ffmi: v.ffmi, range: v.ffmiRange } } },
  { id: 'female-ffmi-26', url: 'model=female',
    run: (v) => { v.setFfmi(26, { animate: false }); return { ffmi: v.ffmi, range: v.ffmiRange } } },
  { id: 'male-fit-rings', url: 'model=male&view=front-left',
    run: (v) => {
      v.setBody({ sex: 'male', heightCm: 178, weightKg: 84, bodyFatPercent: 14, bodyFatMethod: 'BIA', ffmi: 22.6,
        girths: { RIGHT_BICEP: 40, LEFT_BICEP: 39.5, RIGHT_THIGH: 61, LEFT_THIGH: 60.5, RIGHT_CALF: 39, NECK: 39, SHOULDERS: 122, HIPS: 100 } },
      { animate: false })
      v.setMeasureRings(true)
      const f = v.bodyFit
      return { ffmi: f.ffmi, measured: f.measured, iterations: f.iterations,
        weights: Array.from(f.weights, (x) => Math.round(x * 1e4) / 1e4),
        sites: f.sites.map((s) => ({ codes: s.codes, status: s.status, fittedCm: s.fittedCm, expectedCm: s.expectedCm })) }
    } },
  { id: 'male-focus-select', url: 'model=male&view=front',
    run: (v) => {
      v.setActivations([{ muscle: 'Bíceps', activation: 100 }, { muscle: 'Braquial', activation: 70 }], { animate: false })
      v.setFocus(1)
      const i = v.parts.findIndex((p) => p.id === 'biceps-long-head_l')
      v.select(i)
      return { picked: v.partInfo(i), unknown: v.unknown }
    } },
  { id: 'male-lite-front', url: 'model=male&view=front&lod=lite',
    run: (v) => { v.setActivations([{ muscle: 'Quadríceps', activation: 100 }, { muscle: 'Abdômen', activation: 60 }], { animate: false }) } },
  { id: 'male-saved-view', url: 'model=male',
    run: (v) => { v.setView({ yaw: -120, pitch: 12, zoom: 1.4, focus: [0.05, 0.2, 0] }, { animate: false }); return { view: v.getView() } } }
]

mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ ...CHROME, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const context = await browser.newContext({ viewport: { width: 360, height: 540 }, deviceScaleFactor: 1, reducedMotion: 'reduce' })
const results = {}
for (const s of SCENARIOS) {
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  // a missing resource is reported by URL (the console message has none); the favicon is not ours
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()) })
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) errors.push(`${r.status()} ${r.url()}`) })
  await page.goto(`${BASE}/embed.html?${s.url}&locale=${LOCALE}&bg=%23e9ecea`)
  await page.waitForFunction(() => window.ready === true, null, { timeout: 120000 })
  const data = s.run ? await page.evaluate(`(${s.run.toString()})(window.viewer)`) : null
  // two frames: the viewer renders on requestAnimationFrame when something changed
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  await page.waitForTimeout(150)
  await page.screenshot({ path: `${out}/${s.id}.png` })
  results[s.id] = { data: data ?? null, errors }
  await page.close()
}
writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2) + '\n')

let failed = 0
if (baseline) {
  const prev = JSON.parse(readFileSync(`${baseline}/results.json`, 'utf8'))
  const page = await context.newPage()
  await page.setContent('<canvas></canvas>')
  for (const s of SCENARIOS) {
    const a = `${baseline}/${s.id}.png`, b = `${out}/${s.id}.png`
    if (!existsSync(a)) { console.log(`${s.id}: no baseline`); continue }
    const diff = await page.evaluate(async ([pa, pb]) => {
      const load = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src })
      const [ia, ib] = await Promise.all([load(pa), load(pb)])
      if (ia.width !== ib.width || ia.height !== ib.height) return { size: true }
      const c = document.querySelector('canvas')
      c.width = ia.width; c.height = ia.height
      const g = c.getContext('2d', { willReadFrequently: true })
      g.drawImage(ia, 0, 0); const da = g.getImageData(0, 0, c.width, c.height).data
      g.clearRect(0, 0, c.width, c.height)
      g.drawImage(ib, 0, 0); const db = g.getImageData(0, 0, c.width, c.height).data
      let n = 0, max = 0
      for (let i = 0; i < da.length; i += 4) {
        const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]))
        if (d > 2) n++
        if (d > max) max = d
      }
      return { pixels: n, max }
    }, [`data:image/png;base64,${readFileSync(a).toString('base64')}`, `data:image/png;base64,${readFileSync(b).toString('base64')}`])
    const sameData = JSON.stringify(prev[s.id]?.data ?? null) === JSON.stringify(results[s.id].data)
    const errs = results[s.id].errors
    const ok = !diff.size && diff.pixels === 0 && sameData && !errs.length
    if (!ok) failed++
    console.log(`${ok ? 'same' : 'DIFF'}  ${s.id.padEnd(26)} pixels ${diff.size ? 'size differs' : `${diff.pixels} (max Δ ${diff.max})`}` +
      `${sameData ? '' : '  data differs'}${errs.length ? `  errors: ${errs.join(' | ')}` : ''}`)
    if (!sameData) {
      console.log('    before:', JSON.stringify(prev[s.id]?.data))
      console.log('    after: ', JSON.stringify(results[s.id].data))
    }
  }
}
await browser.close()
for (const [id, r] of Object.entries(results)) if (r.errors.length) console.log(`${id}: page errors: ${r.errors.join(' | ')}`)
console.log(`${SCENARIOS.length} scenarios → ${out}${baseline ? `; ${failed} differ from ${baseline}` : ''}`)
process.exit(failed ? 1 : 0)
