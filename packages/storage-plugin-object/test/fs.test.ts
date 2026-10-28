import { storageProbe } from '@migaia/storage-host/plugins/probe'
import { mkdtemp, rm, readdir, writeFile, readFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, onTestFinished, vi } from 'vitest'
import { createStorageHost, createOrgId } from '@migaia/storage-host'
import { blob } from '@migaia/storage-contract'
import { runConformance } from '@migaia/storage-contract/conformance'
import { objectBackendPlugin } from '../src/index.ts'
import { fsObjectDriver } from '../src/fs.ts'
import { objectPresignFeature } from '../src/features/presign.ts'
import { fileIo } from '../src/fs/node.ts'
import { ObjectNames } from '../src/constants.ts'

/** Each business case owns a real native directory and closes the host before fixture cleanup. */
async function installed() {
  const directory = await mkdtemp(join(tmpdir(), 'migaia-object-'))
  const host = await createStorageHost({
    plugins: [
      storageProbe(),
      objectBackendPlugin({ driver: fsObjectDriver({ root: directory }) })
    ] as const
  })
  onTestFinished(async () => {
    await host.dispose()
    await rm(directory, { recursive: true, force: true })
  })
  return { directory, host, api: host.backend('object').use(blob) }
}

runConformance(
  { describe, it, expect },
  {
    name: 'fresh native filesystem blob conformance',
    create: async () => (await installed()).host.backend('object'),
    capabilities: [blob],
    features: {
      syncRead: false,
      binary: false,
      records: false,
      transactions: false,
      iteration: false,
      secondaryIndexes: false,
      changeFeed: false,
      maxValueBytes: undefined,
      opaqueEntries: false
    }
  }
)

describe('native filesystem objects', () => {
  it('publishes immutable data/metadata snapshots, inclusive ranges and one content right', async () => {
    const { api, directory } = await installed()
    /** Native reads retain real file handles; the spy forwards every stream unchanged. */
    const nativeRead = vi.spyOn(fileIo, 'read')
    const nativeMetadata = vi.spyOn(fileIo, 'readText')
    onTestFinished(() => {
      nativeRead.mockRestore()
      nativeMetadata.mockRestore()
    })
    const bytes = new Uint8Array([1, 2, 3, 4])
    const metadata = { owner: 'Ada' }
    const pending = api.put('file', bytes, { contentType: 'application/octet-stream', metadata })
    bytes[0] = 9
    metadata.owner = 'later'
    const info = await pending
    expect(info).toMatchObject({ key: 'file', size: 4, metadata: { owner: 'Ada' } })
    expect(info.etag).toMatch(/^[0-9a-f]{64}$/)
    expect(info.updatedAt).toBeGreaterThan(0)
    /** The committed pointer and immutable generation must physically contain the accepted snapshot. */
    const physical = join(await realpath(directory), (await readdir(directory))[0]!)
    const pointer = JSON.parse(await readFile(join(physical, ObjectNames.pointer), 'utf8')) as {
      generation: string
    }
    const data = join(physical, pointer.generation + ObjectNames.data)
    const sidecar = join(physical, pointer.generation + ObjectNames.metadata)
    expect(new Uint8Array(await readFile(data))).toEqual(new Uint8Array([1, 2, 3, 4]))
    expect(JSON.parse(await readFile(sidecar, 'utf8')).info).toEqual(info)
    nativeMetadata.mockClear()
    expect(await api.head('file')).toEqual(info)
    expect(nativeMetadata).toHaveBeenCalledWith(join(physical, ObjectNames.pointer))
    expect(nativeMetadata).toHaveBeenCalledWith(sidecar)
    const snapshot = await api.get('file')
    const range = await api.get('file', { range: { start: 1, end: 2 } })
    expect(nativeRead).toHaveBeenCalledWith(data, 0, 3)
    expect(nativeRead).toHaveBeenCalledWith(data, 1, 2)
    expect(await range!.bytes()).toEqual(new Uint8Array([2, 3]))
    expect(range!.info.size).toBe(4)
    /** A public stream consumes the same native generation instead of a separate byte-value cache. */
    const streamed = await api.get('file')
    expect(new Uint8Array(await new Response(streamed!.stream()).arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3, 4])
    )
    const empty = await api.get('file', { range: { start: 4 } })
    expect(await empty!.bytes()).toEqual(new Uint8Array())
    await api.put('file', new Uint8Array([7]))
    expect(await snapshot!.bytes()).toEqual(new Uint8Array([1, 2, 3, 4]))
    await expect(snapshot!.bytes()).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(await api.remove('file')).toBe(true)
    expect(await readdir(physical)).not.toContain(ObjectNames.pointer)
    expect(await api.remove('file')).toBe(false)
    expect(await api.head('file')).toBeUndefined()
    expect(await api.get('file')).toBeUndefined()
  })

  it('uses native conditional publication under the original shared key owner', async () => {
    const { api } = await installed()
    const previous = await api.put('file', new Uint8Array([0]))
    const outcomes = await Promise.allSettled([
      api.put('file', new Uint8Array([1]), { ifMatch: previous.etag }),
      api.put('file', new Uint8Array([2]), { ifMatch: previous.etag })
    ])
    expect(outcomes.filter((item) => item.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.find((item) => item.status === 'rejected')).toMatchObject({
      reason: { code: 'WRITE_CONFLICT' }
    })
    const stream = new ReadableStream<Uint8Array>({}, { highWaterMark: 0 })
    const take = vi.spyOn(stream, 'getReader')
    await expect(api.put('file', stream, { ifNoneMatch: true })).rejects.toMatchObject({
      code: 'WRITE_CONFLICT'
    })
    expect(take).not.toHaveBeenCalled()
    const same = await api.head('file')
    const current = await api.get('file')
    const body = await current!.bytes()
    await expect(api.put('file', body, { ifMatch: same!.etag })).resolves.toMatchObject({
      etag: same!.etag
    })
    await expect(api.put('file', new Uint8Array(), { ifMatch: 'missing' })).rejects.toMatchObject({
      code: 'WRITE_CONFLICT'
    })
  })

  it('attaches object codes to native upload failures without replacing their type, identity or stack', async () => {
    const { api } = await installed()
    for (const error of [
      new TypeError('upload source type failure'),
      new RangeError('upload source range failure'),
      new DOMException('upload source platform failure', 'DataError')
    ]) {
      const stack = error.stack
      const source = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.error(error)
        }
      })
      await expect(api.put('failed', source)).rejects.toBe(error)
      expect(error).toMatchObject({ source: 'storage.backend.object', code: 'OBJECT_FAILED' })
      expect(error.stack).toBe(stack)
      expect(await api.head('failed')).toBeUndefined()
    }
    const identified = new TypeError('upload source already has another identity')
    Object.defineProperties(identified, {
      source: { value: 'fixture.other-package' },
      code: { value: 'OTHER_FAILURE' }
    })
    for (const error of [Object.freeze(new TypeError('upload source is frozen')), identified]) {
      const stack = error.stack
      const source = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.error(error)
        }
      })
      const failure = await api.put('failed', source).then(
        () => undefined,
        (cause: unknown) => cause
      )
      expect(failure).toBeInstanceOf(TypeError)
      expect(failure).toMatchObject({
        source: 'storage.backend.object',
        code: 'OBJECT_FAILED',
        cause: error,
        stack: expect.any(String)
      })
      expect(error.stack).toBe(stack)
      expect(await api.head('failed')).toBeUndefined()
    }
  })

  it('orders UTF-16 logical keys, binds cursors and isolates organization prefix deletion', async () => {
    const { host, api, directory } = await installed()
    const org = createOrgId()
    const other = host.org(org).backend('object').use(blob)
    const keys = ['prefix/\uffff', 'prefix/\ud800', 'prefix/aa', 'prefix/a', 'other']
    for (const key of keys) await api.put(key, new Uint8Array([1]))
    await other.put('prefix/a', new Uint8Array([2]))
    /** Public paging must enumerate the actual directory rather than an in-process key catalogue. */
    const entries = vi.spyOn(fileIo, 'entries')
    onTestFinished(() => entries.mockRestore())
    const first = await api.list({ prefix: 'prefix/', limit: 2 })
    expect(entries).toHaveBeenCalledWith(await realpath(directory))
    expect(first.items.map((item) => item.key)).toEqual(['prefix/a', 'prefix/aa'])
    expect(first.next).toEqual(expect.any(String))
    const second = await api.list({ prefix: 'prefix/', limit: 2, after: first.next })
    expect(second.items.map((item) => item.key)).toEqual(['prefix/\ud800', 'prefix/\uffff'])
    expect(second.next).toBeUndefined()
    await expect(api.list({ after: first.next })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT'
    })
    await expect(other.list({ prefix: 'prefix/', after: first.next })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT'
    })
    expect(await api.removeByPrefix('prefix/')).toBe(4)
    /** Only the root's unselected object and the other organization's object remain committed. */
    const remaining = await Promise.all(
      (await readdir(directory)).map((name) => readdir(join(directory, name)))
    )
    expect(remaining.filter((names) => names.includes(ObjectNames.pointer))).toHaveLength(2)
    expect((await other.list()).items).toHaveLength(1)
    await host.dropOrg(org)
    expect((await other.list()).items).toHaveLength(0)
    expect((await api.list()).items.map((item) => item.key)).toEqual(['other'])
  })

  it('cancels accepted uploads on deadline and closes unconsumed get resources on disposal', async () => {
    const { host, api } = await installed()
    const cancel = vi.fn()
    const source = new ReadableStream<Uint8Array>({ cancel }, { highWaterMark: 0 })
    await expect(api.put('never', source, { ctx: { timeoutMs: 20 } })).rejects.toMatchObject({
      code: 'ABORTED'
    })
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(await api.head('never')).toBeUndefined()
    await api.put('file', new Uint8Array([1]))
    const object = await api.get('file')
    const disposal = host.dispose()
    expect(host.dispose()).toBe(disposal)
    await disposal
    await expect(object!.bytes()).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(api.head('file')).rejects.toMatchObject({ code: 'STORE_DISPOSED' })
  })

  it('releases the realpath installation identity and cleans only unreferenced generations on restart', async () => {
    const { host, directory, api } = await installed()
    await api.put('file', new Uint8Array([1]))
    await expect(
      createStorageHost({
        plugins: [
          storageProbe(),
          objectBackendPlugin({ driver: fsObjectDriver({ root: directory }) })
        ]
      })
    ).rejects.toThrow()
    const directories = await readdir(directory)
    const physical = join(directory, directories[0]!)
    const current = await readFile(join(physical, 'current'), 'utf8')
    await writeFile(join(physical, 'orphan.tmp'), 'incomplete upload')
    await host.dispose()
    const next = await createStorageHost({
      plugins: [
        storageProbe(),
        objectBackendPlugin({ driver: fsObjectDriver({ root: directory }) })
      ] as const
    })
    try {
      expect(await readFile(join(physical, 'current'), 'utf8')).toBe(current)
      expect(await readdir(physical)).not.toContain('orphan.tmp')
      expect(await (await next.backend('object').use(blob).get('file'))!.bytes()).toEqual(
        new Uint8Array([1])
      )
    } finally {
      await next.dispose()
    }
  })

  it('keeps corrupt committed metadata visible as an object error and rejects S3-only features', async () => {
    const { directory, api } = await installed()
    await api.put('file', new Uint8Array([1]))
    const physical = join(directory, (await readdir(directory))[0]!)
    await writeFile(join(physical, 'current'), 'invalid pointer')
    await expect(api.head('file')).rejects.toMatchObject({
      source: 'storage.backend.object',
      code: 'OBJECT_DATA_INVALID',
      cause: expect.any(Error)
    })
    await expect(
      createStorageHost({
        plugins: [
          storageProbe(),
          objectBackendPlugin(
            { driver: fsObjectDriver({ root: join(directory, 'feature') }) },
            { presign: objectPresignFeature() }
          )
        ]
      })
    ).rejects.toThrow()
  })

  it('observes each logical call once and never publishes content or physical keys', async () => {
    const { host, api } = await installed()
    await expect(api.head('invalid-context', { timeoutMs: -1 })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT'
    })
    const before: unknown[] = []
    const after: unknown[] = []
    const errors: unknown[] = []
    host.extensions.observe('beforeStorageOperation', (event) => {
      before.push(event)
    })
    host.extensions.observe('afterStorageOperation', (event) => {
      after.push(event)
    })
    host.extensions.observe('onStorageOperationError', (event) => {
      errors.push(event)
    })
    await api.put('secret-key', new Uint8Array([1]), { metadata: { secret: 'content' } })
    await api.list()
    await expect(
      api.put('secret-key', new Uint8Array([2]), { ifNoneMatch: true })
    ).rejects.toMatchObject({ code: 'WRITE_CONFLICT' })
    expect(before).toHaveLength(3)
    expect(after).toHaveLength(2)
    expect(errors).toHaveLength(1)
    expect(JSON.stringify([...before, ...after, ...errors])).not.toMatch(
      /secret-key|content|metadata|etag/
    )
  })
})
