import { existsSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { PAGE_ROOT_ID, PAGE_SCRIPT, PreviewEvent, PreviewRoute } from './constants.ts'
import type { IDoctorFailure } from './doctor-child.ts'
import type { IIssue } from '@migaia/part-contract'
import type { IGeneration } from './rebuild.ts'

/** Encoder of Server-Sent Event frames. */
const ENCODER = new TextEncoder()

/** One connected `/events` client. */
class SseClient implements UnderlyingDefaultSource<Uint8Array> {
  /** Hub the client belongs to. */
  readonly #hub: SseHub
  /** Stream controller, set when the stream starts. */
  #controller: ReadableStreamDefaultController<Uint8Array> | undefined

  /** Binds the client to its hub. */
  constructor(hub: SseHub) {
    this.#hub = hub
  }

  /** Registers the client when its stream starts. */
  start(controller: ReadableStreamDefaultController<Uint8Array>): void {
    this.#controller = controller
    this.#hub.add(this)
    controller.enqueue(ENCODER.encode(': connected\n\n'))
  }

  /** Unregisters the client when the browser goes away. */
  cancel(): void {
    this.#hub.remove(this)
  }

  /** Sends one frame; a closed stream unregisters the client. */
  send(frame: Uint8Array): void {
    try {
      this.#controller?.enqueue(frame)
    } catch {
      // The browser closed the stream between frames; the client is simply gone.
      this.#hub.remove(this)
    }
  }

  /** Ends the stream. */
  close(): void {
    try {
      this.#controller?.close()
    } catch {
      // Already closed by the browser; nothing left to end.
    }
  }
}

/** Connected event clients and broadcast. */
export class SseHub {
  /** Connected clients. */
  readonly #clients = new Set<SseClient>()

  /** Adds a client. */
  add(client: SseClient): void {
    this.#clients.add(client)
  }

  /** Removes a client. */
  remove(client: SseClient): void {
    this.#clients.delete(client)
  }

  /** Response streaming events to one new client. */
  connect(): Response {
    return new Response(new ReadableStream(new SseClient(this)), {
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' }
    })
  }

  /** Sends one event to every client. */
  broadcast(event: string, data: unknown): void {
    /** Encoded frame. */
    const frame = ENCODER.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    for (const client of this.#clients) client.send(frame)
  }

  /** Ends every stream. */
  closeAll(): void {
    for (const client of this.#clients) client.close()
    this.#clients.clear()
  }
}

/** Error and warning counts of a blueprint's issues. */
export function issueCounts(issues: readonly IIssue[]): {
  readonly errors: number
  readonly warnings: number
} {
  /** Number of errors. */
  let errors = 0
  for (const issue of issues) if (issue.severity === 'error') errors += 1
  return { errors, warnings: issues.length - errors }
}

/** Response for a missing resource. */
function notFound(): Response {
  return new Response(null, { status: 404 })
}

/** HTML of both pages; the script is the live generation's bundle. */
function pageHtml(generation: IGeneration): Response {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body><div id="${PAGE_ROOT_ID}"></div><script type="module" src="${PreviewRoute.assets}${generation.number}/${PAGE_SCRIPT}"></script></body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } }
  )
}

/**
 * Read-only routes of the preview server. Every answer comes from the live generation; there is no
 * write route.
 */
export class PreviewRoutes {
  /** Event clients. */
  readonly hub = new SseHub()
  /** Live generation, replaced by the server after each successful rebuild. */
  generation: IGeneration | undefined

  /** Pushes `reload` for a new generation. */
  live(generation: IGeneration): void {
    this.generation = generation
    this.hub.broadcast(PreviewEvent.reload, { generation: generation.number })
  }

  /** Pushes `build-error` for a failed rebuild; the live generation stays. */
  failed(failure: IDoctorFailure): void {
    this.hub.broadcast(PreviewEvent.buildError, {
      generation: this.generation?.number ?? 0,
      code: failure.code,
      message: failure.message
    })
  }

  /** Answers one request. */
  fetch(request: Request): Response {
    if (request.method !== 'GET') return notFound()
    /** Request path. */
    const path = new URL(request.url).pathname
    /** Live generation. */
    const generation = this.generation
    if (path === PreviewRoute.events) return this.hub.connect()
    if (generation === undefined) return notFound()
    if (path === '/') return pageHtml(generation)
    if (path.startsWith(PreviewRoute.blueprint))
      return this.#find(generation, path.slice(PreviewRoute.blueprint.length)) === undefined
        ? notFound()
        : pageHtml(generation)
    if (path.startsWith(PreviewRoute.assets))
      return this.#asset(generation, path.slice(PreviewRoute.assets.length))
    if (path === PreviewRoute.api) return this.#list(generation)
    if (path.startsWith(`${PreviewRoute.api}/`))
      return this.#detail(generation, path.slice(PreviewRoute.api.length + 1))
    return notFound()
  }

  /** Blueprint entry by URL-encoded id. */
  #find(generation: IGeneration, encoded: string): IGeneration['blueprints'][number] | undefined {
    /** Decoded id. */
    const id = decodeURIComponent(encoded)
    return generation.blueprints.find((entry) => entry.id === id)
  }

  /** `/assets/<generation>/<file>`: files of the live generation only. */
  #asset(generation: IGeneration, rest: string): Response {
    /** Position of the generation separator. */
    const slash = rest.indexOf('/')
    if (rest.slice(0, slash) !== String(generation.number)) return notFound()
    /** Path inside the generation directory, kept inside it. */
    const file = normalize(rest.slice(slash + 1))
    if (file.startsWith('..') || file.startsWith('/')) return notFound()
    /** File on disk. */
    const disk = join(generation.dir, file)
    return existsSync(disk) ? new Response(Bun.file(disk)) : notFound()
  }

  /** `/api/blueprints`: ids, files and issue counts. */
  #list(generation: IGeneration): Response {
    return Response.json({
      generation: generation.number,
      blueprints: generation.blueprints.map((entry) => ({
        id: entry.id,
        file: entry.file,
        ...issueCounts(entry.issues)
      }))
    })
  }

  /** `/api/blueprints/<id>`: document and issues of one blueprint. */
  #detail(generation: IGeneration, encoded: string): Response {
    /** Blueprint entry. */
    const entry = this.#find(generation, encoded)
    if (entry === undefined) return notFound()
    return Response.json({
      generation: generation.number,
      document: generation.documents.get(entry.id) ?? null,
      issues: entry.issues
    })
  }
}
