// Computes the default view of every exercise of a catalog with viewer.bestView().
//
//   npm run dev        # in another terminal (port 5190)
//   node dev/evaluate-views.mjs <exercises.json> <out-dir> [--write] [--only code1,code2]
//
// The catalog is a JSON array of `{ code, name, primaryMuscles, secondaryMuscles }` (muscles as
// names the viewer resolves, or `{ name }` objects). For every exercise: activations from the
// catalog (primaries 100 %, secondaries 45 %), `bestView()` on the default male model, a
// 180×270 picture of the chosen view and a row in views.tsv — look at the pictures before
// trusting the views. With --write, the `view` field of each entry is written back into the
// JSON (only where it changed; entries without muscles get no view = automatic).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { chromium } from 'playwright-core'

const [file, out, ...flags] = process.argv.slice(2)
if (!file || !out) {
  console.error('usage: node dev/evaluate-views.mjs <exercises.json> <out-dir> [--write] [--only code1,code2]')
  process.exit(1)
}
const write = flags.includes('--write')
const only = flags.includes('--only') ? flags[flags.indexOf('--only') + 1].split(',') : null
const BASE = process.env.BODY3D_URL ?? 'http://localhost:5190'
const CHROME = process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: 'chrome' }

const catalog = JSON.parse(readFileSync(file, 'utf8'))
const list = catalog.filter((e) => !only || only.includes(e.code))
mkdirSync(out, { recursive: true })

const browser = await chromium.launch(CHROME)
const page = await browser.newPage({ viewport: { width: 180, height: 270 } })
await page.goto(`${BASE}/embed.html?model=male&credit=0&bg=%23e9ecea`)
await page.waitForFunction(() => window.ready === true, null, { timeout: 120000 })
await page.evaluate(async () => {
  const m = await import('/src/activation.js')
  window.fromExercise = m.fromExercise
  window.viewer.splitButton?.remove()
})

const rows = ['code\tname\tyaw\tpitch\tzoom\tfocus\tprimary\tsecondary']
const views = {}
for (const [i, ex] of list.entries()) {
  const spec = await page.evaluate((e) => {
    const v = window.viewer
    v.setActivations(window.fromExercise({
      primaryMuscles: e.primaryMuscles ?? [], secondaryMuscles: e.secondaryMuscles ?? []
    }), { animate: false })
    const s = v.bestView()
    v.setView(s, { animate: false })
    v.render()
    return s
  }, ex)
  await page.waitForTimeout(60)
  await page.screenshot({ path: `${out}/${String(i).padStart(3, '0')}_${ex.code}.png` })
  views[ex.code] = spec
  const names = (l) => (l ?? []).map((m) => m.name ?? m).join(', ')
  rows.push([ex.code, ex.name, spec.yaw, spec.pitch, spec.zoom, spec.focus.join(' '),
    names(ex.primaryMuscles), names(ex.secondaryMuscles)].join('\t'))
}
writeFileSync(`${out}/views.tsv`, rows.join('\n') + '\n')
await browser.close()

if (write) {
  let changed = 0
  for (const e of catalog) {
    const v = views[e.code]
    if (!v || JSON.stringify(e.view) === JSON.stringify(v)) continue
    e.view = v
    changed++
  }
  writeFileSync(file, JSON.stringify(catalog, null, 2) + '\n')
  console.log(`${file}: ${changed} view(s) written`)
}
console.log(`${list.length} exercises evaluated → ${out}`)
