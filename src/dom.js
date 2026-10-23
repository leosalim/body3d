/**
 * The viewer's DOM: canvas, tooltip, credit, split button and the no-WebGL fallback.
 *
 * Styles are inline (no stylesheet to ship) and read CSS custom properties from the container,
 * so the page themes the viewer: --b3d-tip-bg, --b3d-tip-fg, --b3d-tip-radius, --b3d-tip-shadow,
 * --b3d-button-bg, --b3d-button-fg, --b3d-button-border, --b3d-button-radius,
 * --b3d-button-shadow, --b3d-button-on-bg, --b3d-button-on-fg, --b3d-label-fg, --b3d-divider and
 * --b3d-credit-fg.
 */

/** BodyParts3D licence page (CC BY 4.0 requires attribution where the models are shown). */
export const CREDIT_URL = 'https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html'
export const CREDIT_TEXT = 'BodyParts3D © DBCLS · CC BY 4.0'

const SPLIT_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/><path d="M7 10l-2 2 2 2"/><path d="M17 10l2 2-2 2"/></svg>'

function el(tag, className, style, parent) {
  const e = document.createElement(tag)
  if (className) e.className = className
  Object.assign(e.style, style)
  parent?.appendChild(e)
  return e
}

export function createCanvas(container) {
  const canvas = el('canvas', 'b3d-canvas', { display: 'block', width: '100%', height: '100%', outline: 'none' }, container)
  canvas.setAttribute('role', 'img')
  return canvas
}

export function createTooltip(container) {
  return el('div', 'b3d-tip', {
    position: 'absolute', pointerEvents: 'none', display: 'none', zIndex: 2,
    padding: '6px 9px', borderRadius: 'var(--b3d-tip-radius, 8px)', font: 'inherit', fontSize: '12px', lineHeight: '1.3',
    background: 'var(--b3d-tip-bg, rgba(20,22,26,.88))', color: 'var(--b3d-tip-fg, #fff)',
    boxShadow: 'var(--b3d-tip-shadow, 0 2px 10px rgba(0,0,0,.25))', maxWidth: '220px', whiteSpace: 'normal'
  }, container)
}

export function createCredit(container) {
  const a = el('a', 'b3d-credit', {
    position: 'absolute', right: '6px', bottom: '4px', fontSize: '9px', opacity: '.55',
    color: 'var(--b3d-credit-fg, currentColor)', textDecoration: 'none', zIndex: 1
  }, container)
  a.href = CREDIT_URL
  a.target = '_blank'
  a.rel = 'noopener'
  a.textContent = CREDIT_TEXT
  return a
}

export function createSplitButton(container, onClick) {
  const b = el('button', 'b3d-split-button', {
    position: 'absolute', top: '8px', right: '8px', zIndex: 3, width: '34px', height: '34px',
    display: 'grid', placeItems: 'center', padding: '0', cursor: 'pointer', borderRadius: 'var(--b3d-button-radius, 10px)',
    border: '1px solid var(--b3d-button-border, rgba(0,0,0,.12))',
    background: 'var(--b3d-button-bg, rgba(255,255,255,.85))', color: 'var(--b3d-button-fg, #1d2321)',
    boxShadow: 'var(--b3d-button-shadow, 0 1px 3px rgba(0,0,0,.12))', backdropFilter: 'blur(6px)'
  }, container)
  b.type = 'button'
  b.setAttribute('aria-pressed', 'false')
  b.innerHTML = SPLIT_ICON
  b.addEventListener('click', onClick)
  return b
}

/** Pressed / released look of the split button. */
export function setSplitButtonState(button, on) {
  button.setAttribute('aria-pressed', String(on))
  button.style.background = on ? 'var(--b3d-button-on-bg, #1d2321)' : 'var(--b3d-button-bg, rgba(255,255,255,.85))'
  button.style.color = on ? 'var(--b3d-button-on-fg, #fff)' : 'var(--b3d-button-fg, #1d2321)'
}

export function createFallback(container, text) {
  const msg = el('div', 'b3d-fallback', {
    position: 'absolute', inset: '0', display: 'grid', placeItems: 'center',
    padding: '16px', textAlign: 'center', fontSize: '13px', opacity: '.7'
  }, container)
  msg.textContent = text
  return msg
}

/** The two halves of the split view: transparent panes that receive the pointer. */
export function createSplitPanes(container) {
  return ['left', 'right'].map((side) => el('div', `b3d-pane b3d-pane-${side}`, {
    position: 'absolute', top: '0', bottom: '0', width: '50%', zIndex: 1, [side]: '0', touchAction: 'none'
  }, container))
}

/** "your view" / "opposite side" captions over the halves of the split view. */
export function createPaneLabel(container, text, side) {
  const s = el('span', 'b3d-pane-label', {
    position: 'absolute', top: '12px', [side]: '25%', transform: side === 'right' ? 'translateX(50%)' : 'translateX(-50%)',
    fontSize: '11px', letterSpacing: '.04em', opacity: '.6', pointerEvents: 'none', zIndex: 2,
    color: 'var(--b3d-label-fg, currentColor)', whiteSpace: 'nowrap'
  }, container)
  s.textContent = text
  return s
}

export function createDivider(container) {
  return el('div', 'b3d-divider', {
    position: 'absolute', top: '10%', bottom: '10%', left: '50%', width: '1px',
    background: 'var(--b3d-divider, rgba(0,0,0,.12))', pointerEvents: 'none', zIndex: 2
  }, container)
}

/**
 * Fills the tooltip for a part: its label, the group (and side) on a second line, the activation
 * on a third. Built from text nodes — labels never reach `innerHTML`.
 * @param {HTMLElement} tip
 * @param {{ label: string, groupLabel: string | null, side: 'left' | 'right' | null, activation: number }} info
 * @param {{ left: string, right: string, activation: string }} strings
 */
export function fillTooltip(tip, info, strings) {
  tip.replaceChildren(document.createTextNode(info.label))
  const side = info.side === 'left' ? strings.left : info.side === 'right' ? strings.right : ''
  const second = info.groupLabel && info.groupLabel !== info.label ? (side ? `${info.groupLabel} · ${side}` : info.groupLabel) : side
  if (second) {
    tip.append(document.createElement('br'))
    const s = document.createElement('span')
    s.style.opacity = '.75'
    s.textContent = second
    tip.append(s)
  }
  if (info.activation > 0) {
    tip.append(document.createElement('br'))
    const [before, after] = strings.activation.split('{pct}')
    const b = document.createElement('b')
    b.textContent = `${info.activation}%`
    tip.append(before, b, after ?? '')
  }
}

/** Places the tooltip next to the pointer, inside the container. */
export function placeTooltip(tip, container, clientX, clientY) {
  tip.style.display = 'block'
  const rect = container.getBoundingClientRect()
  const x = clientX - rect.left, y = clientY - rect.top
  const tw = tip.offsetWidth, th = tip.offsetHeight
  tip.style.left = `${Math.min(Math.max(4, x + 12), rect.width - tw - 4)}px`
  tip.style.top = `${Math.min(Math.max(4, y - th - 10), rect.height - th - 4)}px`
}
