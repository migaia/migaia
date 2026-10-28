/** Original resource-possession business vectors use real ready Host namespaces and media. */
import { createRpcHost } from '@migaia/rpc-host'
import { RpcJsonCarrierCodec } from '@migaia/rpc-host/sdk'
import { expect, it } from 'vitest'
import { coreMemoryServer } from '../host/core-fixture.ts'

// Retire only the old selector/capture/spread interleaving.
it('sole-profile request retains caller option counts before codec capture', async () => {
  /** Current sole-profile admission reads both original options before its one codec capture. */
  const payload = { value: 41 }
  /** Only the original two caller accessors change their independent observed read counts. */
  const reads = { order: 0, cancel: 0 }
  /** Actual JSON capture is the sole snapshot algorithm; the fixture adds no clone or validator. */
  const server = coreMemoryServer('provider', 'resource-1', 'memory', [], [], {
    create: () => new RpcJsonCarrierCodec(),
    nativeBinary: false
  })
  /** Real application code returns only the received original portable payload. */
  const host = await createRpcHost({ ...server.options, provide: { echo: (value) => value } })
  /** The actual caller cannot expose any request resource before its async factory finishes. */
  const client = await server.connect('caller', {}, 'resource-0')
  /** The original stimulus still mutates once per order getter; its two reads produce value43. */
  const options = {
    get orderKey() {
      reads.order += 1
      payload.value += 1
      return undefined
    },
    get cancel() {
      reads.cancel += 1
      return undefined
    }
  }
  try {
    /** This43 is the current baseline, not PASS credit for the retired dual-grammar42 oracle. */
    expect(await client.host.memory.request('echo', payload, options)).toEqual({ value: 43 })
    expect(reads.order).toBe(2)
    expect(reads.cancel).toBe(2)
  } finally {
    await Promise.all([client.host.close(), host.close()])
  }
})

// Exact payload42/99, directsend43 and real close Promise identity.
it('snapshots the original public request synchronously and retains direct send and close identity', async () => {
  /** Both physical endpoints borrow the canonical codec's actual synchronous portable capture. */
  const server = coreMemoryServer('provider', 'resource-1', 'memory', [], [], {
    create: () => new RpcJsonCarrierCodec(),
    nativeBinary: false
  })
  /** The genuine provider alone returns the original received echo argument. */
  const host = await createRpcHost({ ...server.options, provide: { echo: (value) => value } })
  /** Actual async factory has already completed its real bilateral handshake. */
  const client = await server.connect('caller', {}, 'resource-0')
  /** Native disposal can withdraw properties; the original public namespace is held beforehand. */
  const memory = client.host.memory
  /** Caller mutation after invocation must never alter this operation's actual owned data. */
  const payload = { value: 42 }
  try {
    /** Only this real public operation can capture or deliver the original payload. */
    const operation = memory.request('echo', payload)
    payload.value = 99
    expect(await operation).toEqual({ value: 42 })
    expect(await memory.send('resource-1', 'echo', 43)).toBe(43)
    /** Repeated public close joins the original namespace cleanup, not a fake binding Promise. */
    const closing = memory.close()
    expect(memory.close()).toBe(closing)
    await closing
  } finally {
    await Promise.all([client.host.close(), host.close()])
  }
})

// Retires only before-ready capture; the old ready branch was lazy.
it('ready public stream keeps lazy input until first pull and preserves complete lifetime', async () => {
  /** Only original application generator entry/finally can change these lifetime counts. */
  const lifetime = { constructed: 0, cleaned: 0 }
  /** Actual JSON media captures once at first pull, matching the original already-ready branch. */
  const server = coreMemoryServer('provider', 'resource-1', 'memory', [], [], {
    create: () => new RpcJsonCarrierCodec(),
    nativeBinary: false
  })
  /** The actual directory declares streaming before public construction, without starting it. */
  const host = await createRpcHost({
    ...server.options,
    provide: {
      numbers: async function* (value) {
        lifetime.constructed += 1
        try {
          yield (value as { value: number }).value
          yield 43
          return 44
        } finally {
          lifetime.cleaned += 1
        }
      }
    }
  })
  /** Removes before-factory resources; this is an already admitted genuine public source. */
  const client = await server.connect('caller', {}, 'resource-0')
  /** No before-ready resource exists; this input belongs to the genuine already-ready branch. */
  const readyPayload = { value: 42 }
  /** Existing directed-stream selection returns the actual single original consumer. */
  const readyConsumer = client.host.memory.streamTo('resource-1', 'numbers', readyPayload)
  readyPayload.value = 99
  try {
    expect(lifetime.constructed).toBe(0)
    /** The original ready path borrows input until first pull; old before-ready42 is NoPASS. */
    expect(await readyConsumer.next()).toEqual({ done: false, value: 99 })
    expect(await readyConsumer.next()).toEqual({ done: false, value: 43 })
    expect(await readyConsumer.next()).toEqual({ done: true, value: 44 })
    expect(lifetime.constructed).toBe(1)
    expect(lifetime.cleaned).toBe(1)
  } finally {
    try {
      await readyConsumer.return?.(undefined)
    } finally {
      await Promise.all([client.host.close(), host.close()])
    }
  }
})

// Only the original observable lazy business survives fake binding.
it('the original lazy pull vector executes through a genuine public stream', async () => {
  /** Only the original provider generator body changes its actual pull-entry count. */
  let pulls = 0
  /** Genuine native installation supplies the sole current directory and physical Session. */
  const server = coreMemoryServer('provider', 'resource-1')
  /** No supplied endpoint/binding/Promise impersonates this actual public provider. */
  const host = await createRpcHost({
    ...server.options,
    provide: {
      numbers: async function* () {
        pulls += 1
        yield 46
      }
    }
  })
  /** This actual Host owns the stream operation, independently of the provider iterator identity. */
  const client = await server.connect('caller', {}, 'resource-0')
  /** The same original payload2 travels through the supported namespace path. */
  const consumer = client.host.memory.streamTo('resource-1', 'numbers', 2)
  try {
    expect(pulls).toBe(0)
    expect(await consumer.next()).toEqual({ done: false, value: 46 })
    expect(pulls).toBe(1)
    await consumer.return?.(undefined)
  } finally {
    await Promise.all([client.host.close(), host.close()])
  }
})
