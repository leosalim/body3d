import js from '@eslint/js'
import globals from 'globals'

export default [
  { ignores: ['dist/**', 'node_modules/**', 'paper/**', 'src/*.generated.js'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module'
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }]
    }
  },
  // the library and the pages run in the browser
  { files: ['src/**/*.js', 'dev/**/*.js', 'vite.config.js'], languageOptions: { globals: { ...globals.browser } } },
  // tools, tests and the Vite plugin run in Node
  { files: ['dev/**/*.mjs', 'test/**/*.mjs', 'vite-plugin.js', 'vite.config.js', 'eslint.config.js'], languageOptions: { globals: { ...globals.node } } },
  // Playwright scripts: their callbacks run inside the page
  { files: ['dev/evaluate-views.mjs', 'dev/snapshots.mjs', 'dev/figures.mjs', 'dev/view-study.mjs'], languageOptions: { globals: { ...globals.node, ...globals.browser } } }
]
