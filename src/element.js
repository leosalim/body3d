import { BodyViewer } from './viewer.js'

/**
 * The viewer as a custom element, for frameworks without a wrapper.
 *
 *   defineBodyElement()                       // registers <body3d-viewer>
 *   <body3d-viewer model="female" view="back" locale="pt-BR"></body3d-viewer>
 *   element.activations = [{ muscle: 'Glutes', activation: 100 }]
 *
 * Attributes: model, view, pose, lod, locale, model-base-url, background, auto-rotate,
 * no-bones, no-tooltip, no-credit, measure-rings (model, view, pose, locale, auto-rotate,
 * no-bones and measure-rings react to changes). Properties: `activations` (array), `body` (the
 * person's measures, as in viewer.setBody), `viewer` (the BodyViewer). Events: body3d-load,
 * body3d-select, body3d-hover, body3d-error, body3d-fit, body3d-viewchange (detail = the
 * viewer event's detail).
 *
 * In Vue, declare the tag a custom element (`compilerOptions.isCustomElement`) and pass the list
 * as a property (`:activations.prop="list"`).
 *
 * @param {string} [tag]  element name (must contain a hyphen)
 */
export function defineBodyElement(tag = 'body3d-viewer') {
  if (customElements.get(tag)) return customElements.get(tag)

  class BodyViewerElement extends HTMLElement {
    static observedAttributes = ['model', 'view', 'pose', 'locale', 'auto-rotate', 'no-bones', 'measure-rings']

    constructor() {
      super()
      this._activations = []
      this._body = null
    }

    connectedCallback() {
      if (this.viewer) return
      if (!this.style.display) this.style.display = 'block'
      const a = (n) => this.getAttribute(n)
      this.viewer = new BodyViewer(this, {
        model: a('model') || 'male',
        view: a('view') || 'front',
        pose: a('pose') || null,
        lod: a('lod') || 'auto',
        locale: a('locale') || 'en',
        modelBaseUrl: a('model-base-url') || null,
        background: a('background') || null,
        autoRotate: this.hasAttribute('auto-rotate'),
        showBones: !this.hasAttribute('no-bones'),
        tooltip: !this.hasAttribute('no-tooltip'),
        credit: !this.hasAttribute('no-credit'),
        measureRings: this.hasAttribute('measure-rings'),
        activations: this._activations,
        body: this._body
      })
      for (const ev of ['load', 'select', 'hover', 'error', 'fit', 'viewchange']) {
        this.viewer.addEventListener(ev, (e) => this.dispatchEvent(new CustomEvent(`body3d-${ev}`, { detail: e.detail, bubbles: true })))
      }
    }

    disconnectedCallback() {
      // frameworks may move the element in the DOM: dispose only if it really left
      queueMicrotask(() => {
        if (!this.isConnected && this.viewer) { this.viewer.dispose(); this.viewer = null }
      })
    }

    attributeChangedCallback(name, old, value) {
      if (!this.viewer || old === value) return
      if (name === 'model') this.viewer.setModel(value || 'male').catch(() => {})
      if (name === 'view') this.viewer.setView(value || 'front')
      if (name === 'pose') this.viewer.setPose(value || null)
      if (name === 'locale') this.viewer.setLocale(value || 'en')
      if (name === 'auto-rotate') this.viewer.setAutoRotate(value !== null)
      if (name === 'no-bones') this.viewer.setShowBones(value === null)
      if (name === 'measure-rings') this.viewer.setMeasureRings(value !== null)
    }

    get activations() { return this._activations }
    set activations(list) {
      this._activations = Array.isArray(list) ? list : []
      this.viewer?.setActivations(this._activations)
    }

    get body() { return this._body }
    set body(input) {
      this._body = input ?? null
      this.viewer?.setBody(this._body)
    }
  }

  customElements.define(tag, BodyViewerElement)
  return BodyViewerElement
}
