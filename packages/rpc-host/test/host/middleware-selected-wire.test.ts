/** Selected wire business uses the canonical codec, installed plugins and original native IO. */
import { defineHost } from '@migaia/plugin-host'
import { createRpcHost } from '@migaia/rpc-host'
import { RpcJsonCarrierCodec } from '@migaia/rpc-host/sdk'
import { chunk } from '@migaia/rpc-host/plugins/chunk'
import { auth } from '@migaia/rpc-host/plugins/auth'
import { schema } from '@migaia/rpc-host/plugins/schema'
import { deferred } from '@migaia/utils/promise'
import { walkErrorCauses } from '@migaia/utils/error'
import { RpcCarrierFrameKind } from '@migaia/rpc-contract/protocol'
import type { IRpcCarrierFrame } from '@migaia/rpc-contract/interfaces'
import { expect, it, vi } from 'vitest'
import { coreMemoryServer } from './core-fixture.js'
import { MemoryCarrier } from '../fixtures/core-carrier.js'

// C023 parser behavior, C104 Unicode values and C118 fragment boundaries use actual public hooks.
it('keeps selected schema parsing and Unicode fragment boundaries on the actual public pipeline', async () => {
  /** Only the original application parser contributes this business trace entry. */
  const trace: string[] = []
  /** The real schema plugin retains this original parser receiver for input and successful output. */
  const parser = {
    parse(value: unknown) {
      trace.push('contract.schema.parse')
      return value
    }
  }
  /** Original selected encoders now belong to the sole four-stage carrier codec. */
  const server = coreMemoryServer('selected-wire-left', 'selected-wire-left', 'memory', [], [], {
    create: () => new RpcJsonCarrierCodec(),
    nativeBinary: false
  })
  /** The second original batch remains independent from the first batch's receive-size quota. */
  const rightServer = coreMemoryServer(
    'selected-wire-eight',
    'selected-wire-eight',
    'memory',
    [],
    [],
    {
      create: () => new RpcJsonCarrierCodec(),
      nativeBinary: false
    }
  )
  /** Both original local configurations install concurrently on their independent public Hosts. */
  const [left, right] = await Promise.all([
    createRpcHost({
      ...server.options,
      plugins: [
        chunk({ chunkBytes: 4 }),
        schema({ schemas: { echo: { params: parser, result: parser } } }),
        server.transport
      ],
      provide: { echo: (value: unknown) => value }
    }),
    createRpcHost({
      ...rightServer.options,
      plugins: [chunk({ chunkBytes: 8 }), rightServer.transport],
      provide: { echo: (value: unknown) => value }
    })
  ])
  /** A real peer matches each independent batch's original fragment receiving bound. */
  const [connected, rightConnected] = await Promise.all([
    server.connect('selected-wire-left-peer', { plugins: [chunk({ chunkBytes: 4 })] }),
    rightServer.connect('selected-wire-eight-peer', { plugins: [chunk({ chunkBytes: 8 })] })
  ])
  /** This passthrough spy observes the original post-hook physical write, without another codec. */
  const written = vi.spyOn(connected.pair[0], 'write')
  /** Observe the caller's actual SDK encoder after handshake traffic, without replacing its work. */
  const encoding = vi.spyOn(connected.pair[1].codec, 'encode')
  /** Exclude all earlier native traffic when observing fragments of this exact caller request. */
  const requestTraceStart = connected.pair[1].trace.length
  try {
    /** The exact original payload contains single-unit and surrogate-pair characters. */
    const value = 'A¢中😀'
    expect(await connected.host.memory.request('echo', value)).toBe(value)
    expect(await rightConnected.host.memory.request('echo', value)).toBe(value)
    /** One logical request is encoded once before the genuine chunk hook emits its fragments. */
    const encodes = encoding.mock.calls.length
    expect(encodes).toBe(1)
    expect(
      connected.pair[1].trace
        .slice(requestTraceStart)
        .filter((event) => event === 'write:extension').length
    ).toBeGreaterThan(1)
    expect(trace.at(-1)).toBe('contract.schema.parse')
    /** Only actual chunk extension writes from the four-unit native endpoint are inspected. */
    const frames = written.mock.calls
      .map(([frame]) => frame)
      .filter(
        (frame) => frame.kind === RpcCarrierFrameKind.extension && frame.extension === 'chunk@1'
      )
    expect(frames.length).toBeGreaterThan(1)
    expect(
      frames.every((frame) => (frame.data as { readonly data: string }).data.length <= 4)
    ).toBe(true)
  } finally {
    encoding.mockRestore()
    written.mockRestore()
    await Promise.all([
      left.close(),
      right.close(),
      connected.host.close(),
      rightConnected.host.close()
    ])
  }
})

it('reports transport failure from an actual negotiated chunk fragment write', async () => {
  /** Both existing physical endpoints borrow the genuine SDK JSON codec before native attach. */
  const listener = coreMemoryServer('chunk-write-failure', undefined, 'memory', [], [], {
    create: () => new RpcJsonCarrierCodec(),
    nativeBinary: false
  })
  /** The real provider and caller negotiate the same installed chunk extension before the fault. */
  const server = await createRpcHost({
    ...listener.options,
    plugins: [chunk({ chunkBytes: 4 }), listener.transport],
    provide: { echo: (value) => value }
  })
  try {
    /** This is the original connected public Host, not a fabricated sender or selected framer. */
    const client = await listener.connect('chunk-write-caller', {
      plugins: [chunk({ chunkBytes: 4 })]
    })
    /** Keep the original raw native failure at the existing carrier's physical write boundary. */
    const failure = new Error('frame send failed')
    /** Borrow the actual failed frame only to prove the fault occurred on a negotiated fragment. */
    let failedFrame: IRpcCarrierFrame | undefined
    /** Ready traffic has finished; the next genuine physical write carries this business request. */
    const writing = vi.spyOn(client.pair[1], 'write').mockImplementationOnce((frame) => {
      failedFrame = frame
      throw failure
    })
    try {
      await expect(
        client.host.memory.request('echo', 'A¢中😀', { timeout: false })
      ).rejects.toMatchObject({ code: 'TRANSPORT' })
      expect(failedFrame).toMatchObject({
        kind: RpcCarrierFrameKind.extension,
        extension: 'chunk@1'
      })
    } finally {
      writing.mockRestore()
      await client.host.close()
    }
  } finally {
    await server.close()
  }
})

// C024 subscription acquisition/removal and C104/C118 native disposal keep their actual owners.
it('keeps acquired native subscriptions and concurrent disposal identities without optional legacy roles', async () => {
  /** Observe actual native subscriptions without replacing the original receiver or remover. */
  const subscribed = vi.spyOn(MemoryCarrier.prototype, 'subscribe')
  /** These two genuine native Hosts retain their separate disposal Promise identities. */
  const left = defineHost({
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  /** Concurrent native installation must not share another Host's close receipt. */
  const right = defineHost({
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  /** No removed optional protocol or contract role participates in either native installation. */
  const leftServer = coreMemoryServer('selected-wire-native-left')
  /** This independent real source owns the second native resource subject. */
  const rightServer = coreMemoryServer('selected-wire-native-right')
  try {
    await Promise.all([left.use(leftServer.transport), right.use(rightServer.transport)])
    /** Real public connections acquire the original physical endpoint subscriptions. */
    const connections = await Promise.all([
      leftServer.connect('selected-native-client-left'),
      rightServer.connect('selected-native-client-right')
    ])
    try {
      /** Count only the first actual server carrier, as the original endpoint-local counter did. */
      const acquired = subscribed.mock.contexts.filter(
        (carrier) => carrier === connections[0]!.pair[0]
      ).length
      expect(acquired - connections[0]!.pair[0].unsubscribed).toBeGreaterThan(0)
      /** Both original native subjects publish their own exact cached disposal Promise. */
      const leftDispose = left.dispose()
      /** Closing the other native Host cannot replace the first Host's completion. */
      const rightDispose = right.dispose()
      expect(left.dispose()).toBe(leftDispose)
      expect(right.dispose()).toBe(rightDispose)
      await Promise.all([leftDispose, rightDispose])
      expect(acquired - connections[0]!.pair[0].unsubscribed).toBe(0)
    } finally {
      await Promise.all(connections.map((connection) => connection.host.close()))
    }
  } finally {
    await Promise.all([left.dispose(), right.dispose()])
    subscribed.mockRestore()
  }
})

it('preserves the original long echo payload through two real eight-unit chunk peers', async () => {
  /** Both original endpoints borrow the genuine inline JSON codec before native attachment. */
  const listener = coreMemoryServer('chunk-server', 'chunk-server', 'memory', [], [], {
    create: () => new RpcJsonCarrierCodec(),
    nativeBinary: false
  })
  /** The original provider runs behind the actual public Host and its installed chunk owner. */
  const provider = await createRpcHost({
    ...listener.options,
    plugins: [chunk({ chunkBytes: 8 }), listener.transport],
    provide: { echo: (value) => value }
  })
  try {
    /** The independent caller negotiates the same original eight-unit fragment boundary. */
    const client = await listener.connect('chunk-client', {
      plugins: [chunk({ chunkBytes: 8 })]
    })
    try {
      await expect(
        client.host.memory.send('chunk-server', 'echo', 'discovery-and-chunk'.repeat(8))
      ).resolves.toBe('discovery-and-chunk'.repeat(8))
    } finally {
      await client.host.close()
    }
  } finally {
    await provider.close()
  }
})

it('preserves the original object echo between two independent public hosts', async () => {
  /** One original native pair connects these two actual Hosts without an endpoint facade. */
  const listener = coreMemoryServer('provider-runtime')
  /** The provider keeps the original identity projection through its real public registration. */
  const provider = await createRpcHost({
    ...listener.options,
    provide: { echo: (value) => value }
  })
  try {
    /** This caller is its own public Host, not a method projection of the provider. */
    const client = await listener.connect('client-runtime')
    try {
      await expect(
        client.host.memory.send('provider-runtime', 'echo', { value: 1 })
      ).resolves.toEqual({ value: 1 })
    } finally {
      await client.host.close()
    }
  } finally {
    await provider.close()
  }
})

// RPC-TEST-BB5D8E228A37-C004: actual whole-message Auth follows negotiated chunk reassembly.
it('rejects a forged business signature after real chunk assembly and admits a fresh trusted control', async () => {
  /** The original application signer and verifier share this one fixture signature vocabulary. */
  const signatures = { trusted: 'trusted', forged: 'forged' } as const
  /** Application counters and the exact verifier failure belong to these original callbacks. */
  const state = {
    forge: false,
    providerCalls: 0,
    verificationAttempts: 0,
    failure: new Error('forged chunk'),
    reported: deferred<unknown>()
  }
  /** This is the original trusted-signature check, not a new frame validator or parser. */
  const verify = (frame: unknown) => {
    state.verificationAttempts += 1
    /** The supplied verifier alone interprets its original application signature wrapper. */
    const candidate = frame as { readonly value?: unknown; readonly signature?: string }
    if (candidate.signature !== signatures.trusted) throw state.failure
    return candidate.value
  }
  /** The receiving side always signs trusted replies; only the armed business sender forges. */
  const serverAuthentication = auth({
    sign: (value) => ({ value, signature: signatures.trusted }),
    verify
  })
  /** Ready handshakes use trusted signatures before the original business fault is armed. */
  const clientAuthentication = auth({
    sign: (value) => ({ value, signature: state.forge ? signatures.forged : signatures.trusted }),
    verify
  })
  /** Each native installation gets its own actual one-unit assembler and original size bound. */
  const chunks = chunk({ chunkBytes: 1, maxMessageBytes: 1_024 })
  /** Both original pairs use the same canonical codec rather than a synthetic physical grammar. */
  const codec = { create: () => new RpcJsonCarrierCodec(), nativeBinary: false }
  /** A provider call is observable only after actual assembly, verification and metadata admission. */
  const echo = (value: unknown) => {
    state.providerCalls += 1
    return value
  }
  /** The real Host report confirms the business verifier failed through its original native cause. */
  const report = (error: unknown) => {
    state.reported.resolve(error)
  }
  /** Short real identities keep the original1024-unit limit independent from label overhead. */
  const badListener = coreMemoryServer('b', 'b', 'memory', [], [], codec)
  /** Actual source failure and cleanup remain with this public Host and its native installation. */
  const badServer = await createRpcHost({
    ...badListener.options,
    plugins: [serverAuthentication, chunks, badListener.transport],
    provide: { echo },
    report
  })
  /** This original sender has finished both real handshakes before its fault can be armed. */
  const badClient = await badListener.connect('c', { plugins: [clientAuthentication, chunks] })
  /** Rejection is observed immediately, including when source retirement settles the caller later. */
  let badPending: Promise<unknown> | undefined
  try {
    state.verificationAttempts = 0
    state.forge = true
    /** Exclude all startup traffic while retaining the actual post-hook native fragment trace. */
    const requestTraceStart = badClient.pair[1].trace.length
    badPending = badClient.host.memory
      .send('b', 'echo', 'fragmented')
      .catch((error: unknown) => error)
    /** Preserve the actual diagnostic object so only the verifier's cause can satisfy the barrier. */
    const reported = await state.reported.promise
    expect(walkErrorCauses(reported)).toContain(state.failure)
    expect(state.providerCalls).toBe(0)
    expect(state.verificationAttempts).toBeGreaterThan(0)
    expect(
      badClient.pair[1].trace
        .slice(requestTraceStart)
        .filter((event) => event === 'write:extension').length
    ).toBeGreaterThan(0)
  } finally {
    state.forge = false
    await Promise.all([badClient.host.close(), badServer.close()])
    await badPending
  }
  /** A fresh genuine pair reuses the same supported Auth/chunk configuration with trusted signing. */
  const goodListener = coreMemoryServer('g', 'g', 'memory', [], [], codec)
  /** This independent provider is actual control traffic rather than a restored fake endpoint. */
  const goodServer = await createRpcHost({
    ...goodListener.options,
    plugins: [serverAuthentication, chunks, goodListener.transport],
    provide: { echo },
    report
  })
  try {
    /** A fresh native source negotiates the same one-unit chunk capability independently. */
    const goodClient = await goodListener.connect('d', { plugins: [clientAuthentication, chunks] })
    try {
      /** The original payload must survive the real valid control unchanged. */
      const requestTraceStart = goodClient.pair[1].trace.length
      await expect(goodClient.host.memory.send('g', 'echo', 'fragmented')).resolves.toBe(
        'fragmented'
      )
      expect(state.providerCalls).toBe(1)
      expect(
        goodClient.pair[1].trace
          .slice(requestTraceStart)
          .filter((event) => event === 'write:extension').length
      ).toBeGreaterThan(0)
    } finally {
      await goodClient.host.close()
    }
  } finally {
    await goodServer.close()
  }
})

// RPC-TEST-771320C3619A-C001 retains application values, protection order and terminal rejection.
it('preserves contract endpoint roundtrips and protection before actual writes', async () => {
  /** Only genuine Auth callbacks and original physical writes contribute these observations. */
  const physicalEvents: string[] = []
  /** Each acquired native carrier uses the canonical JSON codec and inline storage facts. */
  const codec = { create: () => new RpcJsonCarrierCodec(), nativeBinary: false }
  /** The original receiving identity owns the real provider and its native transport. */
  const listener = coreMemoryServer('contract-server', 'contract-server', 'memory', [], [], codec)
  /** Server transforms remain real complete Auth hooks, with their original identity transform. */
  const serverAuthentication = auth({
    sign: (frame) => {
      physicalEvents.push('server:protect')
      return frame
    },
    verify: (frame) => {
      physicalEvents.push('server:unprotect')
      return frame
    }
  })
  /** The independent caller owns its own complete Auth instance and original callbacks. */
  const clientAuthentication = auth({
    sign: (frame) => {
      physicalEvents.push('client:protect')
      return frame
    },
    verify: (frame) => {
      physicalEvents.push('client:unprotect')
      return frame
    }
  })
  /** Actual negotiation installs chunk4 before any business traffic on the provider. */
  const server = await createRpcHost({
    ...listener.options,
    plugins: [serverAuthentication, chunk({ chunkBytes: 4 }), listener.transport],
    provide: { echo: (value: unknown) => value }
  })
  try {
    /** Both original Hosts have genuinely accepted their peer before the warm call. */
    const client = await listener.connect('contract-client', {
      plugins: [clientAuthentication, chunk({ chunkBytes: 4 })]
    })
    /** The original held namespace remains the same caller after its public Root closes. */
    const namespace = client.host.memory
    /** MemoryCarrier.write is its original arrow operation with the native receiver already held. */
    const serverWrite = client.pair[0].write
    /** The opposite real physical writer remains independent from the server's write owner. */
    const clientWrite = client.pair[1].write
    /** Passthrough observation preserves the actual server frame, options and completion Promise. */
    const serverWriting = vi.spyOn(client.pair[0], 'write').mockImplementation((...args) => {
      physicalEvents.push('server:send')
      return serverWrite(...args)
    })
    /** Only the original caller's actual physical handoff contributes client send observations. */
    const clientWriting = vi.spyOn(client.pair[1], 'write').mockImplementation((...args) => {
      physicalEvents.push('client:send')
      return clientWrite(...args)
    })
    try {
      await expect(namespace.send('contract-server', 'echo', 'warm')).resolves.toBe('warm')
      /** Earlier handshake and warm traffic cannot satisfy the original business ordering matcher. */
      physicalEvents.length = 0
      await expect(namespace.send('contract-server', 'echo', { value: 'hello' })).resolves.toEqual({
        value: 'hello'
      })
      for (const side of ['client', 'server'] as const)
        expect(physicalEvents.indexOf(`${side}:send`)).toBeGreaterThan(
          physicalEvents.lastIndexOf(`${side}:protect`)
        )
    } finally {
      clientWriting.mockRestore()
      serverWriting.mockRestore()
      await client.host.close()
      await server.close()
    }
    await expect(
      Promise.resolve().then(() => namespace.send('contract-server', 'echo', null))
    ).rejects.toMatchObject({ code: 'ENDPOINT_DISPOSED' })
  } finally {
    await server.close()
  }
})
