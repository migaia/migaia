import { join } from 'node:path'
import { APP_PATH, BUNDLE_FAILED, pageHtml } from './text.ts'

/** Page configuration handed to the browser. */
export type IEditorConfig = { readonly service: string; readonly preview: string }

/**
 * Serves the editor on 127.0.0.1: the HTML shell with its config and the page bundle built once
 * with `Bun.build` from `src/app/index.tsx` (React from the workspace).
 */
export class EditorServer {
  /** Page configuration. */
  readonly #config: IEditorConfig
  /** Built page module. */
  #bundle: Blob | undefined
  /** Running server. */
  #server: ReturnType<typeof Bun.serve> | undefined

  /** Holds the configuration; nothing starts until `start`. */
  constructor(config: IEditorConfig) {
    this.#config = config
  }

  /** Builds the page bundle and starts listening; returns the page URL. */
  async start(port: number): Promise<string> {
    /** Bundler result. */
    const result = await Bun.build({
      entrypoints: [join(import.meta.dir, 'app', 'index.tsx')],
      target: 'browser',
      format: 'esm',
      define: { 'process.env.NODE_ENV': '"production"' }
    })
    if (!result.success) throw new AggregateError(result.logs, BUNDLE_FAILED)
    this.#bundle = result.outputs[0]
    this.#server = Bun.serve({
      hostname: '127.0.0.1',
      port,
      fetch: (request) => this.#respond(request)
    })
    return `http://127.0.0.1:${this.#server.port}/`
  }

  /** Answers the shell, the bundle or 404. */
  #respond(request: Request): Response {
    /** Request path. */
    const path = new URL(request.url).pathname
    if (path === APP_PATH)
      return new Response(this.#bundle, { headers: { 'content-type': 'text/javascript' } })
    if (path === '/')
      return new Response(pageHtml(this.#config), { headers: { 'content-type': 'text/html' } })
    return new Response(null, { status: 404 })
  }
}
