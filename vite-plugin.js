// Vite plugin for applications that bundle body3d from source.
//
//   import { body3d } from 'body3d/vite'            // or a relative path to vite-plugin.js
//   export default defineConfig({ plugins: [vue(), body3d()] })
//   import { createBodyViewer } from '@body3d'      // in the application
//
// It aliases `@body3d` to the library source (bundled with the application; `three` comes from
// the application's node_modules — see `dedupe`), serves the models at /body3d/models/ in dev
// and copies them to <outDir>/body3d/models in the build — the application's own origin, so a
// Content-Security-Policy with `connect-src 'self'` already allows them.
import { createReadStream, copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const MODELS = resolve(ROOT, 'public', 'models')
const BASE = '/body3d/models/'

/**
 * @param {{ lods?: ('high' | 'lite')[] }} [options]  resolutions copied by the build (default:
 *   both; a native app may ship only the lite one)
 */
export function body3d({ lods = ['high', 'lite'] } = {}) {
  const wanted = (f) => f.endsWith('.glb') && lods.includes(f.includes('-lite') ? 'lite' : 'high')
  return {
    name: 'body3d',
    config() {
      return {
        resolve: {
          alias: { '@body3d': resolve(ROOT, 'src', 'index.js') },
          dedupe: ['three']
        },
        // setting `allow` replaces Vite's default (the application root, where vite runs): put the
        // root back and add body3d. No `import 'vite'` here — a Docker build may copy this file
        // without node_modules next to it
        server: { fs: { allow: [process.cwd(), ROOT] } }
      }
    },
    configureServer(server) {
      server.middlewares.use(BASE, (req, res, next) => {
        const file = resolve(MODELS, decodeURIComponent(req.url.split('?')[0].replace(/^\/+/, '')))
        if (!file.startsWith(MODELS + sep) || !existsSync(file)) return next()
        res.setHeader('Content-Type', 'model/gltf-binary')
        createReadStream(file).pipe(res)
      })
    },
    writeBundle(output) {
      const dest = resolve(output.dir, BASE.replace(/^\/+/, ''))
      mkdirSync(dest, { recursive: true })
      for (const f of readdirSync(MODELS)) if (wanted(f)) copyFileSync(resolve(MODELS, f), resolve(dest, f))
    }
  }
}
