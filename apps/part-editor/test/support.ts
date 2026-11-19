import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Repository root. */
const ROOT = join(import.meta.dirname, '..', '..', '..')
/** Bun pinned by the CLI package. */
export const BUN = join(ROOT, 'packages', 'partom-cli', 'node_modules', '.bin', 'bun')
/** CLI source entry. */
const PARTOM = join(ROOT, 'packages', 'partom-cli', 'src', 'cli.ts')
/** Catalog entry. */
const CATALOG = join(ROOT, 'apps', 'part-catalog', 'src', 'main.ts')
/** Editor entry. */
const EDITOR = join(import.meta.dirname, '..', 'src', 'main.ts')
/** Client page server of the whole-program acceptance. */
const CLIENT_SERVER = join(import.meta.dirname, 'client-server.ts')
/** Fixture project. */
const FIXTURE = join(import.meta.dirname, 'fixtures', 'platform-app')
/** Node_modules the fixture's packages resolve from (the CLI package has every project package). */
const PROJECT_MODULES = join(ROOT, 'packages', 'partom-cli', 'node_modules')

/**
 * Orders API base the fixture config reads in the browser (`PARTOM_PUBLIC_*` is inlined into the
 * page). Nothing listens there; the tests never load the orders list.
 */
export const ORDERS_API_URL = 'http://127.0.0.1:59999/'

/** Result of one process run. */
export type IRun = { readonly code: number; readonly stdout: string; readonly stderr: string }

/** A free loopback port. */
export function freePort(): Promise<number> {
  /** Probe server. */
  const server = createServer()
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      /** Bound port. */
      const port = (server.address() as { port: number }).port
      server.close(() => resolve(port))
    })
  )
}

/** Starts a child (`command[0]` with the rest as arguments) and resolves with its first `{ url }`. */
function startChild(
  command: readonly string[],
  cwd?: string,
  env: Readonly<Record<string, string>> = {}
): Promise<{ child: ChildProcess; url: string }> {
  /** Child process. */
  const child = spawn(command[0] as string, command.slice(1), {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env }
  })
  return new Promise((resolve, reject) => {
    child.stdout?.once('data', (chunk: Buffer) =>
      resolve({
        child,
        url: (JSON.parse(chunk.toString().split('\n')[0] as string) as { url: string }).url
      })
    )
    child.once('exit', (code) => reject(new Error(`child exited ${code}`)))
  })
}

/** Stops a child and waits for it. */
async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  await new Promise((resolve) => child.once('exit', resolve))
}

/**
 * The platform under test: a git copy of the fixture tagged `v1`, built and published to a running
 * catalog's `dev`, and the editor server. The catalog allows the editor's origin.
 */
export class Platform {
  /** Project copy. */
  readonly dir: string
  /** Catalog data directory. */
  readonly data: string
  /** Running children. */
  readonly #children: ChildProcess[] = []
  /** Catalog URL. */
  catalogUrl = ''
  /** Editor URL. */
  editorUrl = ''
  /** Write token for every environment. */
  token = ''

  /** Copies the fixture and makes it a git repository tagged `v1`. */
  constructor() {
    this.dir = mkdtempSync(join(tmpdir(), 'platform-app-'))
    this.data = mkdtempSync(join(tmpdir(), 'platform-catalog-'))
    cpSync(FIXTURE, this.dir, { recursive: true })
    symlinkSync(PROJECT_MODULES, join(this.dir, 'node_modules'))
    writeFileSync(
      join(this.dir, '.gitignore'),
      'node_modules\npartom-build/\n.partom-tmp/\n.partom-config-*/\n.partom-preview/\n'
    )
    this.git(['init', '-q'])
    this.commit('v1')
    this.git(['tag', 'v1'])
  }

  /** Runs git in the copy. */
  git(args: readonly string[]): string {
    return spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
      cwd: this.dir,
      encoding: 'utf8'
    }).stdout
  }

  /** Commits everything. */
  commit(message: string): void {
    this.git(['add', '-A'])
    this.git(['commit', '-qm', message])
  }

  /** Command running `partom`: the source CLI through Bun, or the compiled executable. */
  #command: readonly string[] = [BUN, PARTOM]
  /** Catalog child, stopped separately in the whole-program acceptance. */
  #catalog: ChildProcess | undefined

  /** Runs every later `partom` through `command` (for example the compiled executable). */
  useCommand(command: readonly string[]): void {
    this.#command = command
  }

  /** Stops the catalog service only. */
  async stopCatalog(): Promise<void> {
    if (this.#catalog !== undefined) await stopChild(this.#catalog)
  }

  /** Starts the client page server of the fixture on `port`; returns its URL. */
  async startClient(port: number): Promise<string> {
    /** Client page server. */
    const client = await startChild([BUN, CLIENT_SERVER, this.dir, String(port)], this.dir, {
      PARTOM_PUBLIC_ORDERS_API_URL: ORDERS_API_URL
    })
    this.#children.push(client.child)
    return client.url
  }

  /** Reads a project file. */
  read(path: string): string {
    return readFileSync(join(this.dir, path), 'utf8')
  }

  /** Runs `partom` in the copy with the write token. */
  partom(args: readonly string[]): IRun {
    /** Child result. */
    const result = spawnSync(this.#command[0] as string, [...this.#command.slice(1), ...args], {
      cwd: this.dir,
      encoding: 'utf8',
      timeout: 300000,
      env: { ...process.env, PARTOM_TOKEN: this.token }
    })
    return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr }
  }

  /**
   * Starts the catalog (allowing the editor, the preview and `origins`), creates the token, builds
   * and publishes `v1` to `dev`, then starts `partom preview --editor` (when `previewPort` is set)
   * and the editor.
   */
  async start(
    editorPort: number,
    previewPort?: number,
    origins: readonly string[] = [],
    options: { readonly publicDev?: boolean } = {}
  ): Promise<void> {
    /** Editor origin. */
    const editorOrigin = `http://127.0.0.1:${editorPort}`
    /** Preview URL. */
    const preview = previewPort === undefined ? 'about:blank' : `http://127.0.0.1:${previewPort}/`
    /** Catalog. */
    const catalog = await startChild([
      BUN,
      CATALOG,
      'serve',
      '--data',
      this.data,
      '--port',
      '0',
      '--project-dir',
      this.dir,
      ...[editorOrigin, `http://127.0.0.1:${previewPort ?? 0}`, ...origins].flatMap((origin) => [
        '--allow-origin',
        origin
      ])
    ])
    this.#children.push(catalog.child)
    this.#catalog = catalog.child
    this.catalogUrl = catalog.url.replace(/\/$/, '')
    this.token = spawnSync(
      BUN,
      [
        CATALOG,
        'token',
        'create',
        '--data',
        this.data,
        '--project',
        'orders',
        '--envs',
        'dev,staging,prod',
        '--scope',
        'write',
        '--actor',
        'alice'
      ],
      { encoding: 'utf8' }
    ).stdout.trim()
    if (options.publicDev === true)
      spawnSync(
        BUN,
        [
          CATALOG,
          'env',
          'set',
          '--data',
          this.data,
          '--project',
          'orders',
          '--env',
          'dev',
          '--public-read',
          'true'
        ],
        { encoding: 'utf8' }
      )
    for (const args of [['build'], ['publish', '--service', this.catalogUrl, '--env', 'dev']]) {
      /** Command run. */
      const run = this.partom(args)
      if (run.code !== 0) throw new Error(`partom ${args[0]} failed: ${run.stdout}${run.stderr}`)
    }
    if (previewPort !== undefined) {
      /** Preview of the project in editor bridge mode. */
      const previewChild = await startChild(
        [
          ...this.#command,
          'preview',
          '--editor',
          '--editor-origin',
          editorOrigin,
          '--port',
          String(previewPort)
        ],
        this.dir,
        { PARTOM_PUBLIC_ORDERS_API_URL: ORDERS_API_URL }
      )
      this.#children.push(previewChild.child)
    }
    /** Editor. */
    const editor = await startChild([
      BUN,
      EDITOR,
      'serve',
      '--service',
      this.catalogUrl,
      '--preview',
      preview,
      '--port',
      String(editorPort)
    ])
    this.#children.push(editor.child)
    this.editorUrl = editor.url
  }

  /** Reads the catalog draft. */
  async draft(): Promise<{
    base: { tag: string }
    blueprints: { id: string; hash: string; document: unknown }[]
  }> {
    return (await (
      await fetch(`${this.catalogUrl}/p/orders/drafts`, {
        headers: { authorization: `Bearer ${this.token}` }
      })
    ).json()) as never
  }

  /** Stops every child and removes the copies. */
  async stop(): Promise<void> {
    for (const child of this.#children) await stopChild(child)
    rmSync(this.dir, { recursive: true, force: true })
    rmSync(this.data, { recursive: true, force: true })
  }
}
