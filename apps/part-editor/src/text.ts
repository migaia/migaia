/** Usage printed for invalid arguments. */
export const USAGE =
  'usage: bun src/main.ts serve --service <catalog url> --preview <preview url> [--port 0]'

/** Global the page reads its configuration from; set by the served HTML. */
export const CONFIG_GLOBAL = '__PART_EDITOR__'

/** Message of a failed page bundle; the bundler logs are on `errors`. */
export const BUNDLE_FAILED = 'editor bundle failed'

/** Path of the bundled page module. */
export const APP_PATH = '/app.js'

/** HTML shell of the editor page; the config is inlined as JSON. */
export function pageHtml(config: unknown): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Part editor</title>
<style>
body{margin:0;font:13px system-ui,sans-serif;color:#1d1d1f}
.columns{display:grid;grid-template-columns:260px 1fr 1fr;height:calc(100vh - 32px)}
.columns>section{overflow:auto;border-right:1px solid #ddd;padding:8px}
.status{height:32px;display:flex;gap:12px;align-items:center;padding:0 8px;background:#f4f4f6;border-bottom:1px solid #ddd}
.node{cursor:pointer;padding:1px 4px}.node[aria-selected=true]{background:#dbe8ff}
.issue{color:#b00020}.field{display:flex;gap:6px;align-items:center;margin:4px 0}
.field label{min-width:90px}iframe{width:100%;height:100%;border:0}
</style></head>
<body><div id="root"></div>
<script>window.${CONFIG_GLOBAL} = ${JSON.stringify(config).replace(/</g, '\\u003c')}</script>
<script type="module" src="${APP_PATH}"></script>
</body></html>`
}

/**
 * Message kinds of the editor bridge (`editor-bridge` 1); the same values as `EditorMessage` in
 * `@migaia/partom-cli`'s preview constants, which own the page side.
 */
export const EditorMessage = {
  ready: 'ready',
  blueprint: 'blueprint',
  modules: 'modules',
  issues: 'issues',
  modulesLoaded: 'modules-loaded',
  modulesFailed: 'modules-failed'
} as const

/** Template of a new remote module. */
export function moduleTemplate(id: string): string {
  return `import { defineEffect } from '@migaia/part-host'\n\nexport default defineEffect({\n  id: '${id}',\n  run: (_event, ctx) => {\n    ctx.state.write('page.notice' as never, 'done' as never)\n  }\n})\n`
}
