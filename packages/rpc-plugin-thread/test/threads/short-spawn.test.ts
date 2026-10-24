import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import { isThreadChild } from '../../src/threads/child.js'
import { expandThreadSpawn } from '../../src/threads/short-spawn.js'
import { threadRuntimeResource } from '../../src/threads/runtime-resource.js'

/** The main module runs outside Vitest so self-entry resolution sees a supported native entry. */
const fixture = fileURLToPath(new URL('./fixtures/short-spawn-host.mjs', import.meta.url))

/** Execute one complete public operation with native Worker construction and bounded cleanup. */
function runFixture(mode: string): Record<string, unknown> {
  /** Worker runtime flags inherit through the original Node launcher. */
  const output = execFileSync(process.execPath, ['--no-warnings', fixture, mode], {
    encoding: 'utf8',
    timeout: 15_000
  })
  return JSON.parse(output.trim().split('\n').at(-1)!)
}

/** A different Worker entry remains usable when the parent has only an eval module. */
function runEval(entry: string | URL): Record<string, unknown> {
  /** Built ESM is loaded exactly, without depending on the eval module's resolution location. */
  const library = new URL('../../dist/threads/index.js', import.meta.url)
  /** The real host root is independently loaded by the eval consumer. */
  const hostLibrary = new URL('../../../rpc-host/dist/index.js', import.meta.url)
  /** Runtime JavaScript arguments are data passed to execFile, never interpolated into a shell. */
  const spawn =
    entry instanceof URL ? `new URL(${JSON.stringify(entry.href)})` : JSON.stringify(entry)
  /** The child must run its selected entry rather than this parent controller. */
  const program = `
    const [{ createRpcHost }, { threadPlugin }] = await Promise.all([import(${JSON.stringify(hostLibrary.href)}), import(${JSON.stringify(library.href)})]);
    const peer = await createRpcHost({ plugins: [threadPlugin({ spawn: ${spawn} })] });
    try {
      console.log(JSON.stringify({
        value: await peer.request('double', 21),
        flags: await peer.request('flags')
      }));
    } finally { await peer.close(); }
  `
  /** File Workers reject eval-only flags such as input-type; ordinary runtime flags stay present. */
  const output = execFileSync(
    process.execPath,
    ['--no-warnings', '--input-type=module', '--eval', program],
    { encoding: 'utf8', timeout: 15_000 }
  )
  return JSON.parse(output.trim().split('\n').at(-1)!)
}

describe('thread source shorthand', () => {
  it.each(['self', 'path', 'typescript', 'short'])('%s uses the public Peer path', (mode) => {
    expect(runFixture(mode)).toMatchObject({ value: 42, child: true })
  })

  it('self spawn retains runtime flags and guarded module execution', () => {
    expect(runFixture('self')).toMatchObject({ flags: ['--no-warnings'] })
  })

  it.each(['path', 'url'] as const)(
    'eval starts an explicit %s without controller flags',
    (kind) => {
      /** The same actual service entry proves path normalization and exact URL handling. */
      const entry = new URL('./fixtures/short-spawn-worker.mjs', import.meta.url)
      expect(runEval(kind === 'path' ? fileURLToPath(entry) : entry)).toEqual({
        value: 42,
        flags: ['--no-warnings']
      })
    }
  )

  it('absolute filesystem punctuation is encoded without becoming URL query or fragment', async () => {
    /** Native path conversion preserves a real filesystem basename rather than parsing it as a URI. */
    const path = fileURLToPath(new URL('./fixtures/', import.meta.url)) + 'worker #1?.mjs'
    /** Expansion performs no filesystem read or Worker construction for this nonexistent fixture. */
    const source = await expandThreadSpawn({ spawn: path }, threadRuntimeResource)
    expect(source.spec.entry).toBe(pathToFileURL(path).href)
  })

  it('Plugin accepts the same short URL without separate launch wiring', () => {
    expect(runFixture('plugin')).toEqual({ value: 42 })
  })

  it('Node .ts entry retains the original unresolved .js cause', () => {
    expect(runFixture('missing-js').codes).toContain('ERR_MODULE_NOT_FOUND')
  })

  it('the native parent is not a library child', async () => {
    expect(await isThreadChild()).toBe(false)
  })

  it('self spawn rejects a test runner main module before native acquisition', async () => {
    /** The failure must occur before a caller-held runtime loader can construct a Worker. */
    const load = vi.spyOn(threadRuntimeResource, 'load')
    await expect(createRpcHost({ plugins: [threadPlugin({ spawn: true })] })).rejects.toMatchObject(
      {
        code: 'INVALID_CONFIG'
      }
    )
    expect(load).not.toHaveBeenCalled()
    load.mockRestore()
  })

  it('browser shorthand requires a URL and preserves its exact entry', async () => {
    /**
     * Preserve the native test host while hiding only the production runtime selector's Node
     * marker.
     */
    const nativeProcess = process
    /** Vite and Vitest still require platform and nextTick during asynchronous adapter imports. */
    const browserProcess = {
      ...nativeProcess,
      versions: { ...nativeProcess.versions, node: undefined }
    }
    vi.stubGlobal('process', browserProcess)
    try {
      await expect(async () =>
        createRpcHost({ plugins: [threadPlugin({ spawn: true })] })
      ).rejects.toMatchObject({
        code: 'INVALID_CONFIG'
      })
      await expect(async () =>
        createRpcHost({ plugins: [threadPlugin({ spawn: './worker.ts' })] })
      ).rejects.toMatchObject({
        code: 'INVALID_CONFIG'
      })
      /** A query/fragment is part of the exact browser module URL rather than an inferred path. */
      const entry = new URL('https://example.test/worker.js?revision=1#module')
      /** Inspect expansion only: no browser Worker can run in this native test process. */
      const source = await expandThreadSpawn({ spawn: entry }, threadRuntimeResource)
      expect(source.spec.entry).toBe(entry.href)
      expect(source.supervisor?.isolation).toBe('best-effort')
      expect(source.launcher.capabilities).toMatchObject({ termination: 'unsupported' })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
