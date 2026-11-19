/**
 * Serves the platform fixture's client page for the whole-program acceptance: bundles
 * `<dir>/client/main.tsx` for the browser (production, code splitting for the part chunks, public
 * `PARTOM_PUBLIC_*` variables inlined) and serves it on 127.0.0.1. Prints `{ url }`. Usage: `bun
 * client-server.ts <project dir> <port>`.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Project directory and port. */
const [dir, port] = process.argv.slice(2) as [string, string]

/** Bundle output directory. */
const out = mkdtempSync(join(tmpdir(), 'client-page-'))

/** Bundler result. */
const result = await Bun.build({
  entrypoints: [join(dir, 'client', 'main.tsx')],
  outdir: out,
  target: 'browser',
  format: 'esm',
  splitting: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  env: 'PARTOM_PUBLIC_*'
})
if (!result.success) {
  console.error(result.logs.map(String).join('\n'))
  process.exit(2)
}

/** Page shell. */
const html =
  '<!doctype html><html><head><meta charset="utf-8"><title>Orders client</title></head>' +
  '<body><div id="app"></div><div id="boom"></div><script type="module" src="/main.js"></script></body></html>'

/** Server. */
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: Number(port),
  fetch: (request) => {
    /** Request path. */
    const path = new URL(request.url).pathname
    if (path === '/') return new Response(html, { headers: { 'content-type': 'text/html' } })
    /** Bundle file. */
    const file = Bun.file(join(out, path.slice(1)))
    return new Response(file, { headers: { 'content-type': 'text/javascript' } })
  }
})
console.log(JSON.stringify({ url: `http://127.0.0.1:${server.port}/` }))
