import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** App directory. */
export const APP = join(import.meta.dirname, '..')
/** Fixture project with remote modules, shared with partom-cli tests. */
export const PROJECT = join(
  APP,
  '..',
  '..',
  'packages',
  'partom-cli',
  'test',
  'fixtures',
  'remote-modules'
)
/** Partom CLI source entry. */
const PARTOM = join(APP, '..', '..', 'packages', 'partom-cli', 'src', 'cli.ts')

/** A running catalog with its data directory. */
export type ICatalog = {
  readonly url: string
  readonly data: string
  readonly child: ChildProcess
  stop(): Promise<void>
}

/** Starts `bun src/main.ts serve` on a random port and waits for its `{ url }` line. */
export async function startCatalog(
  extra: string[] = [],
  data = mkdtempSync(join(tmpdir(), 'catalog-'))
): Promise<ICatalog> {
  /** Server process. */
  const child = spawn(
    'bun',
    [join(APP, 'src', 'main.ts'), 'serve', '--data', data, '--port', '0', ...extra],
    {
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )
  /** First stdout line. */
  const url = await new Promise<string>((resolve, reject) => {
    child.stdout?.once('data', (chunk: Buffer) =>
      resolve((JSON.parse(chunk.toString().split('\n')[0] as string) as { url: string }).url)
    )
    child.once('exit', (code) => reject(new Error(`catalog exited ${code}`)))
  })
  return {
    url,
    data,
    child,
    stop: async () => {
      child.kill('SIGTERM')
      await new Promise((resolve) => child.once('exit', resolve))
    }
  }
}

/** Removes a data directory. */
export function removeData(catalog: ICatalog): void {
  rmSync(catalog.data, { recursive: true, force: true })
}

/** Runs a one-shot catalog command and returns stdout. */
export function catalogCommand(data: string, args: string[]): string {
  return spawnSync('bun', [join(APP, 'src', 'main.ts'), ...args, '--data', data], {
    encoding: 'utf8'
  }).stdout.trim()
}

/** Creates a token. */
export function token(
  data: string,
  envs: string,
  scope: 'read' | 'write',
  actor = 'alice',
  project = 'orders'
): string {
  return catalogCommand(data, [
    'token',
    'create',
    '--project',
    project,
    '--envs',
    envs,
    '--scope',
    scope,
    '--actor',
    actor
  ])
}

/** Fetch with an optional bearer token. */
export function call(
  url: string,
  path: string,
  init: RequestInit & { token?: string } = {}
): Promise<Response> {
  /** Headers with the token. */
  const headers = new Headers(init.headers)
  if (init.token !== undefined) headers.set('authorization', `Bearer ${init.token}`)
  return fetch(`${url}${path}`, { ...init, headers })
}

/** `sha256-<base64url>` of bytes, as the contract computes it. */
export function sha256(bytes: Uint8Array): string {
  return `sha256-${createHash('sha256').update(bytes).digest('base64url')}`
}

/** Built remote module ready to upload. */
export type IBuiltModule = {
  readonly ref: {
    name: string
    id: string
    url: string
    integrity: string
    exports: { id: string; kind: string }[]
  }
  readonly bytes: Uint8Array
  readonly source: string
}

/** Builds a fixture module with `partom remote build`. */
export function buildModule(name: string): IBuiltModule {
  /** Output directory. */
  const out = mkdtempSync(join(tmpdir(), 'catalog-module-'))
  try {
    /** Entry path. */
    const entry = join(PROJECT, 'remote', name)
    /** Build report. */
    const report = JSON.parse(
      spawnSync(
        'bun',
        [
          PARTOM,
          'remote',
          'build',
          entry,
          '--out',
          out,
          '--root',
          join(PROJECT, 'remote'),
          '--project',
          PROJECT
        ],
        {
          encoding: 'utf8'
        }
      ).stdout
    ) as { modules: IBuiltModule['ref'][] }
    /** Reference. */
    const ref = report.modules[0] as IBuiltModule['ref']
    return { ref, bytes: readFileSync(join(out, ref.url)), source: readFileSync(entry, 'utf8') }
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
}

/** The orders page blueprint with a button label and a click handler. */
export function ordersPage(
  label = 'Create order',
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: 'orders-page',
    version: 1,
    root: {
      tag: 'page@1',
      id: 'page',
      children: [
        {
          tag: 'button@1',
          id: 'create',
          facets: { props: { label, ...extra }, events: { click: { handler: 'notify@1' } } }
        },
        { tag: 'button@1', id: 'other', facets: { props: { label: 'Other' } } }
      ]
    }
  }
}

/** Descriptors every fixture snapshot carries. */
const DESCRIPTORS = [
  { kind: 'part', id: 'page@1' },
  { kind: 'part', id: 'button@1' },
  { kind: 'effect', id: 'notify@1' }
]

/** Snapshot bytes for blueprints and modules. */
export function snapshotBytes(
  tag: string,
  blueprints: Record<string, unknown>[],
  modules: IBuiltModule[],
  definitions = ['page@1', 'button@1', 'notify@1']
): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      lock: {
        format: 1,
        project: 'orders',
        tag,
        blueprints: blueprints.map((blueprint) => ({
          id: blueprint.id,
          version: 1,
          hash: sha256(new TextEncoder().encode(JSON.stringify(blueprint)))
        })),
        definitions,
        modules: modules.map((module) => module.ref)
      },
      blueprints,
      descriptors: DESCRIPTORS
    })
  )
}

/** Uploads modules, the snapshot and the sources; returns the snapshot hash. */
export async function upload(
  url: string,
  write: string,
  bytes: Uint8Array,
  modules: IBuiltModule[]
): Promise<string> {
  for (const module of modules)
    await call(url, `/p/orders/${module.ref.url}`, {
      method: 'PUT',
      body: module.bytes,
      token: write
    })
  /** Snapshot hash. */
  const hash = sha256(bytes)
  /** Upload response. */
  const response = await call(url, `/p/orders/snapshots/${hash}`, {
    method: 'PUT',
    body: bytes,
    token: write
  })
  if (!response.ok) throw new Error(await response.text())
  await call(url, `/p/orders/snapshots/${hash}/sources`, {
    method: 'PUT',
    token: write,
    body: JSON.stringify({
      modules: modules.map((module) => ({ name: module.ref.name, source: module.source }))
    })
  })
  return hash
}

/** Publishes a snapshot to an environment. */
export function publish(
  url: string,
  write: string,
  env: string,
  snapshot: string
): Promise<Response> {
  return call(url, `/p/orders/env/${env}/publish`, {
    method: 'POST',
    token: write,
    body: JSON.stringify({ snapshot })
  })
}
