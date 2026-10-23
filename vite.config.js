import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { transform } from 'esbuild'

const r = (p) => fileURLToPath(new URL(p, import.meta.url))

// `vite build`                   → dist/app: the demo page + embed.html (a static site)
// `vite build --mode lib`        → dist/lib/body3d.js: ESM for bundlers, `three` left external
//                                  (a peer dependency: the application's copy is shared) + models/
// `vite build --mode standalone` → dist/lib/body3d.standalone.js: ESM with three.js inside, for
//                                  plain pages without a bundler
export default defineConfig(({ mode }) => {
  if (mode === 'lib' || mode === 'standalone') {
    const standalone = mode === 'standalone'
    return {
      publicDir: false,
      build: {
        outDir: 'dist/lib',
        emptyOutDir: !standalone,          // the standalone build runs second and adds its file
        minify: 'esbuild',
        chunkSizeWarningLimit: 1200,
        lib: {
          entry: r('./src/index.js'),
          formats: ['es'],
          fileName: () => (standalone ? 'body3d.standalone.js' : 'body3d.js')
        },
        rollupOptions: {
          external: standalone ? [] : [/^three(\/.*)?$/],
          output: { inlineDynamicImports: true }
        }
      },
      plugins: [{
        // Vite does not minify whitespace in ESM libraries (it keeps them tree-shakeable); the
        // standalone bundle carries all of three.js, so there is nothing to keep
        name: 'minify-standalone',
        async renderChunk(code) {
          if (!standalone) return null
          return (await transform(code, { minify: true, format: 'esm', target: 'es2020' })).code
        }
      }, {
        name: 'copy-models',
        apply: 'build',
        writeBundle() {
          if (standalone) return
          const dest = r('./dist/lib/models')
          mkdirSync(dest, { recursive: true })
          for (const f of readdirSync(r('./public/models'))) {
            if (f.endsWith('.glb')) copyFileSync(r(`./public/models/${f}`), `${dest}/${f}`)
          }
        }
      }]
    }
  }
  return {
    base: './',
    build: {
      outDir: 'dist/app',
      emptyOutDir: true,
      chunkSizeWarningLimit: 800, // three.js: ~170 kB gzipped
      rollupOptions: { input: { index: r('./index.html'), embed: r('./embed.html') } }
    },
    server: { port: 5190 }
  }
})
