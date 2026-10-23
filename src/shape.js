/**
 * Body shape: the morph-target weights of one loaded model.
 *
 * The model carries one morph target per fit region (`meta.body.regions`): weight 0 is the
 * region at the model's minimum FFMI, 1 at its maximum, all equal reproduce the uniform body of
 * an FFMI (`meta.body.ffmi.table`). A shape comes from the person's tape measures (fit.js), or
 * from an FFMI alone — the typical body of that FFMI (calibrated on ANSUR II when the model has
 * a calibration). Models built before the regions (one `ffmi` morph) still load.
 */
import { prepareFitModel, fitBody, priorWeights, uniformWeight } from './fit.js'

const fitModels = new WeakMap()

/** Fit data of a model (prepared once per loaded GLB). */
export function fitModelFor(body) {
  if (!body?.fit) return null
  if (!fitModels.has(body)) fitModels.set(body, prepareFitModel(body))
  return fitModels.get(body)
}

/** Is there anything to fit? Tapes, or body fat / FFMI (weight and height alone draw the default body). */
export function hasBodyData(input) {
  return !!input && (Object.keys(input.girths ?? {}).length > 0 || input.bodyFatPercent != null || input.ffmi != null)
}

export class BodyShape {
  /**
   * @param {import('three').Mesh[]} meshes  every mesh of the model (those with morph targets are used)
   * @param {object} body  `extras.body` of the GLB
   */
  constructor(meshes, body) {
    this.body = body ?? null
    this.meshes = meshes.filter((m) => m.morphTargetInfluences?.length)
    this.regions = body?.regions ?? []
    this.fitModel = fitModelFor(body)
    // region index → morph-target index in each mesh (only the regions that move that mesh)
    this.maps = this.meshes.map((m) => {
      const dict = m.morphTargetDictionary ?? {}
      return Int16Array.from(this.regions, (r) => dict[r] ?? -1)
    })
    // GLB from before the regions: a single morph, the FFMI one
    this.legacy = !this.regions.length && this.meshes.some((m) => m.morphTargetDictionary?.ffmi != null)
    this.weights = null
  }

  /** Drawable range `{ min, max, default }` in normalized FFMI, or null. */
  get range() {
    const f = this.body?.ffmi
    return f ? { min: f.min, max: f.max, default: f.default } : null
  }

  /** Writes region weights into the morph influences. */
  set(weights) {
    this.weights = Float64Array.from(weights)
    if (this.legacy) {
      for (const m of this.meshes) m.morphTargetInfluences[0] = weights[0]
      return
    }
    this.meshes.forEach((m, k) => {
      const map = this.maps[k]
      for (let r = 0; r < map.length; r++) if (map[r] >= 0) m.morphTargetInfluences[map[r]] = weights[r]
    })
  }

  /**
   * Weights for a person: the fit to `body` (tape measures, body fat, FFMI) when there is
   * something to fit, else the typical body of `ffmi` (clamped to the range; null = the model
   * default).
   * @returns {{ weights: Float64Array, fit: object | null, ffmi: number | null }}
   */
  resolve({ ffmi = null, body = null } = {}) {
    if (this.legacy) {
      return { weights: Float64Array.of(this.legacyWeight(body?.ffmi ?? ffmi)), fit: null, ffmi: null }
    }
    if (this.fitModel && hasBodyData(body)) {
      try {
        const fit = fitBody(this.fitModel, body)
        return { weights: fit.weights, fit, ffmi: fit.ffmi }
      } catch (err) {
        console.error('[body3d] the tape-measure fit failed; drawing the FFMI body', err)
      }
    }
    const r = this.range
    const f = r ? Math.min(r.max, Math.max(r.min, body?.ffmi ?? ffmi ?? r.default)) : null
    const weights = this.fitModel && f != null ? priorWeights(this.fitModel, f).w
      : new Float64Array(this.regions.length).fill(this.body?.defaultWeight ?? 0)
    return { weights, fit: null, ffmi: f }
  }

  /** Weight of the single FFMI morph of a pre-region model. */
  legacyWeight(ffmi) {
    const f = this.body?.ffmi
    if (!f?.table?.length) return this.body?.defaultWeight ?? 0
    return uniformWeight({ table: f.table }, Math.min(f.max, Math.max(f.min, ffmi ?? f.default)))
  }
}
