// Renders the figures of the documentation and the paper into docs/images/.
//
//   npm run dev                 # in another terminal (port 5190)
//   node dev/figures.mjs [figure-id ...]
//
// Every panel is a screenshot of embed.html driven through the public API; panels are composed
// (with captions) on a canvas in the browser, so no image library is needed.
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const BASE = process.env.BODY3D_URL ?? 'http://localhost:5190'
const CHROME = process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: 'chrome' }
const OUT = fileURLToPath(new URL('../docs/images/', import.meta.url))
const BG = '#f3f4f3'
const only = process.argv.slice(2)

const browser = await chromium.launch(CHROME)
const context = await browser.newContext({ deviceScaleFactor: 2, reducedMotion: 'reduce' })

/** One panel: a fresh page, `run(viewer)` in it, a PNG buffer back. */
async function panel(query, run, { width = 300, height = 520 } = {}) {
  const page = await context.newPage()
  await page.setViewportSize({ width, height })
  await page.goto(`${BASE}/embed.html?${query}&credit=0&bg=${encodeURIComponent(BG)}`)
  await page.waitForFunction(() => window.ready === true, null, { timeout: 120000 })
  await page.evaluate(() => window.viewer.splitButton?.remove())
  if (run) await page.evaluate(`(${run.toString()})(window.viewer)`)
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  await page.waitForTimeout(200)
  const png = await page.screenshot()
  await page.close()
  return png
}

/** Composes panels in a grid with a caption under each, and writes docs/images/<name>.jpg. */
async function compose(name, panels, { cols = panels.length, captions = [] } = {}) {
  const page = await context.newPage()
  await page.setContent('<canvas></canvas>')
  const data = await page.evaluate(async ({ srcs, cols, captions, bg }) => {
    const load = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = src })
    const imgs = await Promise.all(srcs.map(load))
    const w = imgs[0].width, h = imgs[0].height
    const cap = captions.length ? 52 : 0
    const rows = Math.ceil(imgs.length / cols)
    const c = document.querySelector('canvas')
    c.width = w * cols
    c.height = (h + cap) * rows
    const g = c.getContext('2d')
    g.fillStyle = bg
    g.fillRect(0, 0, c.width, c.height)
    g.fillStyle = '#2b302e'
    g.textAlign = 'center'
    g.font = '500 26px system-ui, sans-serif'
    imgs.forEach((im, i) => {
      const x = (i % cols) * w, y = Math.floor(i / cols) * (h + cap)
      g.drawImage(im, x, y)
      if (captions[i]) g.fillText(captions[i], x + w / 2, y + h + 34)
    })
    return c.toDataURL('image/jpeg', 0.86)
  }, { srcs: panels.map((p) => `data:image/png;base64,${p.toString('base64')}`), cols, captions, bg: BG })
  await page.close()
  writeFileSync(`${OUT}${name}.jpg`, Buffer.from(data.split(',')[1], 'base64'))
  console.log('wrote', `docs/images/${name}.jpg`)
}

const act = (list) => `(v) => v.setActivations(${JSON.stringify(list)}, { animate: false })`
const FIGURES = {
  async hero() {
    const a = await panel('model=male&view=front-right', eval(act([{ muscle: 'Chest', activation: 100 }, { muscle: 'Anterior Deltoids', activation: 60 }, { muscle: 'Triceps', activation: 55 }])))
    const b = await panel('model=female&view=back-left', eval(act([{ muscle: 'Glutes', activation: 100 }, { muscle: 'Hamstrings', activation: 60 }, { muscle: 'Lower Back', activation: 40 }])))
    const c = await panel('model=male&view=back', (v) => { v.setPose('back-double-biceps', { animate: false }); v.setActivations(Object.entries(v.poses.find((p) => p.id === 'back-double-biceps').activations).map(([muscle, activation]) => ({ muscle, activation })), { animate: false }) })
    await compose('hero', [a, b, c])
  },
  async ffmi() {
    const male = [15, 20, 26, 32], female = [12, 17, 22, 26]
    const panels = [], captions = []
    for (const f of male) { panels.push(await panel('model=male&view=front', `(v) => v.setFfmi(${f}, { animate: false })`, { width: 240, height: 480 })); captions.push(`male · FFMI ${f}`) }
    for (const f of female) { panels.push(await panel('model=female&view=front', `(v) => v.setFfmi(${f}, { animate: false })`, { width: 240, height: 480 })); captions.push(`female · FFMI ${f}`) }
    await compose('ffmi-range', panels, { cols: 4, captions })
  },
  async poses() {
    const panels = [], captions = []
    for (const sex of ['male', 'female']) {
      const ids = sex === 'male'
        ? ['front-double-biceps', 'front-lat-spread', 'side-chest', 'back-double-biceps', 'side-triceps', 'abs-and-thigh']
        : ['front-pose', 'back-pose', 'side-pose', 'front-double-biceps', 'back-double-biceps', 'side-triceps']
      for (const id of ids) {
        panels.push(await panel(`model=${sex}`, `(v) => { v.setPose('${id}', { animate: false, view: true }); const p = v.poses.find((x) => x.id === '${id}'); v.setActivations(Object.entries(p.activations).map(([muscle, activation]) => ({ muscle, activation })), { animate: false }) }`, { width: 220, height: 400 }))
        captions.push(id)
      }
    }
    await compose('poses', panels, { cols: 6, captions })
  },
  async bestView() {
    const cases = [
      ['triceps', [{ muscle: 'Triceps', activation: 100 }, { muscle: 'Forearms', activation: 45 }]],
      ['bench press', [{ muscle: 'Chest', activation: 100 }, { muscle: 'Triceps', activation: 45 }, { muscle: 'Anterior Deltoids', activation: 45 }]],
      ['biceps curl', [{ muscle: 'Biceps', activation: 100 }, { muscle: 'Brachialis', activation: 45 }, { muscle: 'Forearms', activation: 45 }]],
      ['lateral raise', [{ muscle: 'Lateral Deltoids', activation: 100 }, { muscle: 'Trapezius', activation: 45 }]],
      ['hip abduction', [{ muscle: 'Abductors', activation: 100 }, { muscle: 'Glutes', activation: 45 }]],
      ['squat', [{ muscle: 'Quadriceps', activation: 100 }, { muscle: 'Glutes', activation: 100 }, { muscle: 'Adductors', activation: 45 }, { muscle: 'Lower Back', activation: 45 }]]
    ]
    const panels = []
    for (const [, list] of cases) panels.push(await panel('model=male', `(v) => { v.setActivations(${JSON.stringify(list)}, { animate: false }); v.autoView({ animate: false }) }`, { width: 240, height: 380 }))
    await compose('best-view', panels, { cols: 6, captions: cases.map(([n]) => n) })
  },
  async split() {
    const p = await panel('model=male&view=front-right', (v) => { v.setActivations([{ muscle: 'Chest', activation: 90 }, { muscle: 'Trapezius', activation: 70 }, { muscle: 'Lats', activation: 50 }], { animate: false }); v.setSplit(true) }, { width: 560, height: 520 })
    await compose('split-view', [p])
  },
  async fit() {
    const person = { heightCm: 178, weightKg: 84, bodyFatPercent: 14, bodyFatMethod: 'BIA' }
    const typical = await panel('model=male&view=front-left', `(v) => { v.setBody(${JSON.stringify({ ...person })}, { animate: false }) }`, { width: 300, height: 520 })
    const tapes = { RIGHT_BICEP: 42, LEFT_BICEP: 41.5, RIGHT_FOREARM: 32, RIGHT_THIGH: 57, LEFT_THIGH: 57, RIGHT_CALF: 37, NECK: 40, SHOULDERS: 124, HIPS: 99 }
    const fitted = await panel('model=male&view=front-left', `(v) => { v.setBody(${JSON.stringify({ ...person, girths: tapes })}, { animate: false }); v.setMeasureRings(true) }`, { width: 300, height: 520 })
    const legs = { RIGHT_BICEP: 33, LEFT_BICEP: 33, RIGHT_THIGH: 66, LEFT_THIGH: 66, RIGHT_CALF: 41, LEFT_CALF: 41 }
    const legsFit = await panel('model=male&view=front-left', `(v) => { v.setBody(${JSON.stringify({ ...person, girths: legs })}, { animate: false }); v.setMeasureRings(true) }`, { width: 300, height: 520 })
    await compose('tape-fit', [typical, fitted, legsFit], { captions: ['no tapes: typical body', 'big arms, small legs', 'big legs, small arms'] })
  },
  async latissimus() {
    const a = await panel('model=male&view=back', act([{ muscle: 'group:lats', activation: 100 }]), { width: 300, height: 520 })
    const b = await panel('model=male&view=back-right', act([{ muscle: 'group:lats', activation: 100 }]), { width: 300, height: 520 })
    const c = await panel('model=male&view=front', act([{ muscle: 'group:abs', activation: 100 }, { muscle: 'group:obliques', activation: 40 }]), { width: 300, height: 520 })
    await compose('synthesized', [a, b, c], { captions: ['latissimus dorsi (synthesized)', 'latissimus, 3/4', 'rectus abdominis (cut out)'] })
  }
}

mkdirSync(OUT, { recursive: true })
for (const [id, fn] of Object.entries(FIGURES)) {
  if (only.length && !only.includes(id)) continue
  await fn()
}
await browser.close()
