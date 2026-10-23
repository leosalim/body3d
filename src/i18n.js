/**
 * Interface strings and localized labels.
 *
 * The viewer ships English (`en`, the default) and Brazilian Portuguese (`pt-BR`). Anatomical
 * labels come from the catalog (`catalog.generated.js`), which carries both. Another language
 * needs `strings` (interface text) and, for anatomical names, labels added in
 * `pipeline/anatomy.py`; without them the English label is shown.
 */

/** Interface text per locale. `{name}` placeholders are filled by `format`. */
export const STRINGS = {
  en: {
    modelLabel: '3D muscle model',
    modelLabelActive: '3D muscle model. Activation: {list}.',
    modelLabelRest: '3D muscle model, no activation.',
    noWebgl: 'Your browser could not open the 3D model (WebGL is unavailable).',
    splitTitle: 'Front and back side by side',
    splitAria: 'Show the opposite side alongside',
    yourView: 'your view',
    oppositeSide: 'opposite side',
    left: 'left',
    right: 'right',
    activation: '{pct} activation'  // {pct} is drawn in bold as "60%"
  },
  'pt-BR': {
    modelLabel: 'Modelo 3D dos músculos',
    modelLabelActive: 'Modelo 3D dos músculos. Ativação: {list}.',
    modelLabelRest: 'Modelo 3D dos músculos, sem ativação.',
    noWebgl: 'Seu navegador não conseguiu abrir o modelo 3D (WebGL indisponível).',
    splitTitle: 'Frente e verso lado a lado',
    splitAria: 'Mostrar o lado oposto ao lado',
    yourView: 'sua vista',
    oppositeSide: 'lado oposto',
    left: 'esquerdo',
    right: 'direito',
    activation: '{pct} de ativação'
  }
}

/** Locales with built-in strings and anatomical labels. */
export const LOCALES = Object.keys(STRINGS)

/**
 * Canonical locale for a tag: `pt`, `pt-br` and `pt_BR` give `pt-BR`; anything starting with
 * `en`, or unknown, gives `en`. A tag with strings registered through `options.strings` is kept.
 * @param {string | null | undefined} tag
 * @param {Record<string, object>} [extra]  locales added by the caller
 */
export function resolveLocale(tag, extra = {}) {
  if (!tag) return 'en'
  const t = String(tag).replace('_', '-')
  if (extra[t] || STRINGS[t]) return t
  const lower = t.toLowerCase()
  if (lower === 'pt' || lower.startsWith('pt-')) return 'pt-BR'
  return 'en'
}

/**
 * Interface strings for a locale, with overrides: `{ 'pt-BR': { yourView: 'você' } }`, or a
 * whole new locale.
 */
export function stringsFor(locale, overrides = {}) {
  return { ...STRINGS.en, ...STRINGS[locale], ...overrides[locale] }
}

/** Picks the text for `locale` from a `{ en, 'pt-BR' }` label (a plain string passes through). */
export function localized(label, locale) {
  if (label == null || typeof label === 'string') return label ?? null
  return label[locale] ?? label.en ?? Object.values(label)[0] ?? null
}

/** Fills `{name}` placeholders. */
export function format(template, values) {
  return template.replace(/\{(\w+)\}/g, (_, k) => (values[k] ?? ''))
}
