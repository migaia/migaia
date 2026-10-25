import { expect, it } from 'vitest'
import { walkErrorCauses } from '@migaia/utils/error'
import { createAdapterWebByteIO } from '../../dist/process/web-byte-stream.js'
import { createNodeProcessLauncher } from '../../src/process/adapters/node-child-process.js'
import { listenProcessByteChannel } from '../../src/process/adapters/node-socket.js'

/** Native stream hooks expose physical cleanup independently of channel bookkeeping. */
/** Allocate only this case's original observations before installing native-shaped callbacks. */
function streamPairFixtureState() {
  const counts = { cancels: 0, aborts: 0 }
  return { counts }
}

/** Own one test resource's mutable observations without sharing a factory closure. */
class StreamPairFixture {
  /** Counts, native events and construction inputs belong only to this fixture instance. */
  #state: ReturnType<typeof streamPairFixtureState>
  /** Existing consumers retain the same observable fixture surface and callback identities. */
  readonly value
  /** Install the original native-shaped callbacks after their observations exist. */
  constructor() {
    this.#state = streamPairFixtureState()

    this.value = {
      counts: this.#state.counts,
      readable: new ReadableStream<Uint8Array>({
        cancel: () => {
          this.#state.counts.cancels++
        }
      }),
      writable: new WritableStream<Uint8Array>({
        abort: () => {
          this.#state.counts.aborts++
        }
      })
    }
  }
}

/** Create one independent owner for the existing native-boundary fixture. */
function streamPair() {
  return new StreamPairFixture().value
}

it('publishes one close settlement before invoking a reentrant listener', async () => {
  /** The public stream adapter owns the real native reader and writer. */
  const pair = streamPair()
  /** No internal helper or synthetic transport participates in this close operation. */
  const channel = createAdapterWebByteIO(pair.readable, pair.writable)
  /** The callback reenters only once, exposing the original missing close publication. */
  let notifications = 0
  /** The nested public call must join the exact original completion. */
  let nested: void | Promise<void> = undefined
  channel.onClose(() => {
    if (++notifications === 1) nested = channel.close()
  })
  /** Repeat public calls share completion and trigger no extra physical operations. */
  const closing = channel.close()
  await closing
  expect(nested).toBe(closing)
  expect(channel.close()).toBe(closing)
  expect(notifications).toBe(1)
  expect(pair.counts).toEqual({ cancels: 1, aborts: 1 })
})

it('releases both native streams when one close observer throws', async () => {
  /** Native callbacks prove cleanup still runs after the user callback fails. */
  const pair = streamPair()
  /** This exact original callback exception must remain reachable from close rejection. */
  const original = new TypeError('audit close observer failed')
  /** A second observer must still receive the terminal notification once. */
  let second = 0
  /** Only the public close operation owns cleanup. */
  const channel = createAdapterWebByteIO(pair.readable, pair.writable)
  channel.onClose(() => {
    throw original
  })
  channel.onClose(() => {
    second++
  })
  /** One rejected completion exposes both semantic identity and the original callback failure. */
  const closing = channel.close()
  await expect(closing).rejects.toMatchObject({
    source: 'rpc.transport.process',
    code: 'PROCESS_CHANNEL_CLOSED'
  })
  await expect(closing).rejects.toSatisfy((error) => walkErrorCauses(error).includes(original))
  expect(second).toBe(1)
  expect(pair.counts).toEqual({ cancels: 1, aborts: 1 })
})

it('releases its acquired reader when the actual writable stream is already locked', () => {
  /** One caller-held writer triggers the native acquisition failure without an invalid fake port. */
  const pair = streamPair()
  /** This writer remains owned by the caller throughout the failed construction. */
  const writer = pair.writable.getWriter()
  try {
    expect(() => createAdapterWebByteIO(pair.readable, pair.writable)).toThrow(TypeError)
    expect(pair.readable.locked).toBe(false)
  } finally {
    writer.releaseLock()
  }
})

it('classifies a synchronous native spawn failure while retaining TypeError', async () => {
  /** Native spawn rejects this NUL command before acquiring a child process. */
  const operation = createNodeProcessLauncher().launch(
    {
      command: 'audit\0invalid',
      args: [],
      env: { inherit: [], set: {} },
      stdio: { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' }
    },
    { signal: new AbortController().signal, output: () => undefined }
  )
  await expect(operation).rejects.toBeInstanceOf(TypeError)
  await expect(operation).rejects.toMatchObject({
    source: 'rpc.transport.process',
    code: 'PROCESS_CHANNEL_CONNECT_FAILED'
  })
})

it('classifies the managed Unix parent read failure before binding', async () => {
  /** The intentionally missing parent is only inspected; no socket or owner file is written. */
  const address = new URL('./audit-absent-parent/service.sock', import.meta.url).pathname
  await expect(
    listenProcessByteChannel({
      address,
      serviceId: 'audit',
      onConnection: () => undefined,
      report: () => undefined
    })
  ).rejects.toMatchObject({
    source: 'rpc.transport.process',
    code: 'PROCESS_CHANNEL_LISTEN_FAILED'
  })
})

it('classifies actual bind reports and shares the native listener close Promise', async () => {
  /** The public listener occupies an ephemeral loopback port without filesystem side effects. */
  const errors: unknown[] = []
  /** Raw bind ownership is independent of the Host's authenticated Session admission. */
  const options = {
    onConnection: () => undefined,
    report: (error: unknown) => {
      errors.push(error)
    }
  }
  /** This listener owns the only physical server used by the collision. */
  const listener = await listenProcessByteChannel({ ...options, address: 'tcp://127.0.0.1:0' })
  try {
    await expect(
      listenProcessByteChannel({ ...options, address: listener.address })
    ).rejects.toMatchObject({ code: 'PROCESS_CHANNEL_LISTEN_FAILED' })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({
      source: 'rpc.transport.process',
      code: 'PROCESS_CHANNEL_LISTEN_FAILED'
    })
    /** The underlying listener release executes once while every caller joins the same result. */
    const first = listener.close()
    expect(listener.close()).toBe(first)
    await first
  } finally {
    await listener.close()
  }
})
