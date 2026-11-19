/**
 * Node side of the browser tests: builds the fixture modules with the real `partom remote build`
 * and starts a fake catalog on `127.0.0.1` (random port). Tests switch its snapshot answers and
 * read its request log through `/control/*`.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { TestProject } from 'vitest/node'
import type { IRemoteModuleRef } from '@migaia/part-contract'

/**
 * Snapshot answer of one environment: bytes with their ETag, an error status, or a dropped
 * connection.
 */
type IAnswer =
  | { readonly mode: 'ok'; readonly body: Buffer }
  | { readonly mode: 'status'; readonly status: number }

/** Package directory. */
const PACKAGE_DIR = resolve(import.meta.dirname, '..')

/** Fixture project directory (its node_modules resolve through the package). */
const FIXTURES = join(PACKAGE_DIR, 'test', 'fixtures')

/** Every `.ts` file under a directory, recursively. */
function entries(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts'))
    .map((file) => join(dir, file))
}

/** Builds one fixture root and returns its references; built files land in `out/m/`. */
function build(root: string, out: string): IRemoteModuleRef[] {
  /** Child result. */
  const result = spawnSync(
    'bun',
    [
      join(PACKAGE_DIR, '..', 'partom-cli', 'src', 'cli.ts'),
      'remote',
      'build',
      ...entries(join(FIXTURES, root)),
      '--out',
      out,
      '--root',
      join(FIXTURES, root),
      '--project',
      FIXTURES
    ],
    { encoding: 'utf8' }
  )
  if (result.status !== 0) throw new Error(`remote build failed: ${result.stdout}${result.stderr}`)
  return (JSON.parse(result.stdout) as { modules: IRemoteModuleRef[] }).modules
}

/** `sha256-<base64url>` of bytes, the same value as `hashBytes`. */
function hashOf(bytes: Buffer): string {
  return `sha256-${createHash('sha256').update(bytes).digest('base64url')}`
}

/** Reads a request body. */
async function bodyOf(request: IncomingMessage): Promise<Buffer> {
  /** Collected chunks. */
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

/** Fake catalog state. */
class FakeCatalog {
  /** Snapshot answers by `<project>/<env>`. */
  readonly answers = new Map<string, IAnswer>()
  /** Request log: `METHOD path`. */
  requests: string[] = []
  /** True while the service drops every catalog request. */
  down = false
  /** Built module bytes by file name. */
  readonly modules = new Map<string, Buffer>()

  /** Handles one request. */
  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    /** Path of the request. */
    const path = new URL(request.url ?? '/', 'http://x').pathname
    response.setHeader('access-control-allow-origin', '*')
    response.setHeader('access-control-allow-headers', 'authorization, if-none-match, content-type')
    response.setHeader('access-control-expose-headers', 'etag')
    if (request.method === 'OPTIONS') return void response.end()
    if (path.startsWith('/control/')) return this.#control(path, request, response)
    this.requests.push(`${request.method} ${path}`)
    if (this.down) return void request.socket.destroy()
    /** Snapshot route match. */
    const snapshot = /^\/p\/([^/]+)\/env\/([^/]+)\/snapshot$/.exec(path)
    if (snapshot !== null) return this.#snapshot(`${snapshot[1]}/${snapshot[2]}`, request, response)
    /** Module route match. */
    const module = /^\/p\/[^/]+\/m\/([^/]+)$/.exec(path)
    /** Module bytes. */
    const bytes = module === null ? undefined : this.modules.get(module[1] as string)
    if (bytes === undefined) return void response.writeHead(404).end()
    response.writeHead(200, { 'content-type': 'text/javascript' }).end(bytes)
  }

  /** Answers a snapshot request with ETag and 304 support. */
  #snapshot(key: string, request: IncomingMessage, response: ServerResponse): void {
    /** Configured answer. */
    const answer = this.answers.get(key)
    if (answer === undefined) return void response.writeHead(404).end()
    if (answer.mode === 'status') return void response.writeHead(answer.status).end()
    /** Quoted ETag of the bytes. */
    const etag = `"${hashOf(answer.body)}"`
    if (request.headers['if-none-match'] === etag)
      return void response.writeHead(304, { etag }).end()
    response.writeHead(200, { etag, 'content-type': 'application/json' }).end(answer.body)
  }

  /** Control routes used by the tests. */
  async #control(path: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    /** Request log before this call changes it. */
    const requests = this.requests
    /** JSON body of the control call. */
    const body =
      request.method === 'POST' ? JSON.parse((await bodyOf(request)).toString('utf8') || '{}') : {}
    if (path === '/control/answer')
      this.answers.set(
        `${body.project}/${body.env}`,
        body.status === undefined
          ? { mode: 'ok', body: Buffer.from(body.snapshot, 'utf8') }
          : { mode: 'status', status: body.status }
      )
    else if (path === '/control/down') this.down = body.down === true
    else if (path === '/control/reset') this.requests = []
    response
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ requests }))
  }
}

/** Builds fixtures, starts the fake catalog and provides its address and module references. */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  /** Build output root. */
  const out = mkdtempSync(join(tmpdir(), 'part-remote-'))
  /** Fake catalog. */
  const catalog = new FakeCatalog()
  /** References per fixture root. */
  const refs: Record<string, IRemoteModuleRef[]> = {}
  for (const root of ['remote', 'v2']) {
    refs[root] = build(root, join(out, root))
    for (const file of readdirSync(join(out, root, 'm')))
      catalog.modules.set(file, readFileSync(join(out, root, 'm', file)))
  }
  /** HTTP server. */
  const server = createServer((request, response) => void catalog.handle(request, response))
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  /** Bound port. */
  const port = (server.address() as { port: number }).port
  project.provide('service', `http://127.0.0.1:${port}`)
  project.provide('modules', refs as never)
  return async () => {
    // The browser may still hold keep-alive or pending revalidation requests; `close` alone waits
    // for them forever, so they are dropped first.
    server.closeAllConnections()
    await new Promise<void>((done) => server.close(() => done()))
    rmSync(out, { recursive: true, force: true })
  }
}
