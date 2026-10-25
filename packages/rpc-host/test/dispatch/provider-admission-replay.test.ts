/** Original replay and capacity business assertions use actual installed flows and native ingress. */
import { createRpcHost, type IRpcContext } from '@migaia/rpc-host'
import auth from '@migaia/rpc-host/plugins/auth'
import limits from '@migaia/rpc-host/plugins/limits'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { deserializeRpcWireError, type IRpcSemanticFrame } from '@migaia/rpc-contract/protocol'
import type { IRpcProviderRejection } from '@migaia/rpc-contract/errors'
import { deferred } from '@migaia/utils/promise'
import { assert, expect, it, vi } from 'vitest'
import { MemoryCarrier } from '../fixtures/core-carrier.js'
import { coreMemoryServer } from '../host/core-fixture.js'

/** The real handshake verifier recognizes only this fixture's portable credential. */
const replayCredential = 'provider-replay-fixture-credential'
/** Each Host installs its own Auth owner; no sign/verify counter wrapper alters raw replay input. */
const replayAuthentication = auth({
  credentials: replayCredential,
  verifyCredentials: (credentials) => {
    if (credentials !== replayCredential) throw new Error('unrecognized replay fixture credentials')
  }
})

/** Borrow the original allocated call/task rather than manufacturing a caller or generation. */
function admittedCall(carrier: MemoryCarrier, method: string) {
  /** The actual identity medium records precisely what its original write delivered. */
  const frame = carrier.written.find(
    (value) => value.kind === 'call' && value.task.method === method
  )
  assert(frame?.kind === 'call')
  return frame
}

// RPC-TEST-366FF2AC3AFB-C081: same completed task must not execute again; no key is invented.
it('installed replay suppresses a completed task repeated at actual ingress', async () => {
  /** This original provider alone owns the execution observation. */
  let executions = 0
  /** The actual listener admits the original caller before either duplicate is delivered. */
  const server = coreMemoryServer('provider-admission-fixture')
  /** BC3 moves the original optional replay policy to its real complete plugin owner. */
  const host = await createRpcHost({
    ...server.options,
    plugins: [replayAuthentication, ...server.options.plugins],
    provide: {
      echo: (_value, context) => {
        executions += 1
        return context.success('once')
      },
      barrier: (value, context) => context.success(value)
    }
  })
  /** Both original physical endpoints and their canonical Sessions are genuinely ready. */
  const client = await server.connect('r70-client', { plugins: [replayAuthentication] })
  try {
    await client.host.memory.send('provider-admission-fixture', 'echo', 'r70-data')
    /** A real later reply lets the original provider terminal/cleanup finish before task replay. */
    await client.host.memory.send('provider-admission-fixture', 'barrier', 'after-first-completion')
    /** Exact task replay follows the original terminal, without adding idempotency-key metadata. */
    const request = admittedCall(client.pair[1], 'echo')
    await client.pair[1].write({ kind: 'message', data: request })
    await client.host.memory.send('provider-admission-fixture', 'barrier', 'after-duplicate')
    expect(executions).toBe(1)
  } finally {
    await Promise.all([client.host.close(), host.close()])
  }
})

// RPC-TEST-366FF2AC3AFB-C085: reentrant delivery occurs inside the original synchronous provider.
it('installed replay preserves one execution for the original reentrant task', async () => {
  /** Reentry reads the original physical frame only after public send has written it. */
  let resend: (() => Promise<void>) | undefined
  /** Observe the actual native duplicate write without creating another reply or pending owner. */
  let reentered: Promise<void> | undefined
  /** Only the original echo provider can increment this business count. */
  let executions = 0
  /** The genuine listener supplies the one accepted source for both deliveries. */
  const server = coreMemoryServer('provider-admission-fixture')
  /** The actual installed optional replay plugin receives both real envelopes. */
  const host = await createRpcHost({
    ...server.options,
    plugins: [replayAuthentication, ...server.options.plugins],
    provide: {
      echo: (_value, context) => {
        executions += 1
        if (executions === 1) reentered = resend?.()
        return context.success('reentrant')
      },
      barrier: (value, context) => context.success(value)
    }
  })
  /** This actual client has the original carrier that the provider reenters. */
  const client = await server.connect('r70-client', { plugins: [replayAuthentication] })
  resend = () =>
    client.pair[1].write({ kind: 'message', data: admittedCall(client.pair[1], 'echo') })
  try {
    await client.host.memory.send('provider-admission-fixture', 'echo', 'r70-data')
    await reentered
    await client.host.memory.send('provider-admission-fixture', 'barrier', 'after-reentry')
    expect(executions).toBe(1)
  } finally {
    await Promise.all([client.host.close(), host.close()])
  }
})

// RPC-TEST-366FF2AC3AFB-C090: private providerState snapshots retire; business/frame counts remain.
it('concurrent task replay executes once and sends one terminal on its original subscription', async () => {
  /** Spy passthrough observes the genuine subscription receipt without changing the fixture. */
  const subscription = vi.spyOn(MemoryCarrier.prototype, 'subscribe')
  /** The original business provider holds one real invocation until both inputs have arrived. */
  const release = deferred<void>()
  /** Entry is reported by the actual provider, independently from physical call completion. */
  const started = deferred<void>()
  /** Only genuine echo business changes this value. */
  let executions = 0
  /** This original listener owns the accepted source and no test-side replay registry. */
  const server = coreMemoryServer('provider-admission-fixture')
  /** The actual optional replay implementation is installed before the native transport starts. */
  const host = await createRpcHost({
    ...server.options,
    plugins: [replayAuthentication, ...server.options.plugins],
    provide: {
      echo: async (_value, context) => {
        executions += 1
        started.resolve()
        await release.promise
        return context.success('concurrent-once')
      },
      barrier: (value, context) => context.success(value)
    }
  })
  /** The same original two native endpoints complete both genuine Session handshakes. */
  const client = await server.connect('r70-client', { plugins: [replayAuthentication] })
  try {
    /** This public call remains pending in its original native/provider owner. */
    const pending = client.host.memory.send('provider-admission-fixture', 'echo', 'r70-data')
    await started.promise
    /** The duplicate retains the complete actual request, including caller/target generations. */
    const request = admittedCall(client.pair[1], 'echo')
    await client.pair[1].write({ kind: 'message', data: request })
    await client.host.memory.send('provider-admission-fixture', 'barrier', 'while-held')
    release.resolve()
    await pending
    await client.host.memory.send('provider-admission-fixture', 'barrier', 'after-completion')
    expect(executions).toBe(1)
    /** Only actual physical terminals correlated to the original task contribute to uniqueness. */
    const messages = client.pair[0].written.filter(
      (frame) => (frame.kind === 'result' || frame.kind === 'error') && frame.id === request.id
    )
    expect(messages).toHaveLength(1)
    expect(
      subscription.mock.contexts.filter((carrier) => carrier === client.pair[0]).length -
        client.pair[0].unsubscribed
    ).toBe(1)
  } finally {
    release.resolve()
    await Promise.all([client.host.close(), host.close()])
    subscription.mockRestore()
  }
})

// RPC-TEST-366FF2AC3AFB-C091: real optional limits retain their original default per-peer capacity64.
it('native admission rejects one of65 unique calls and releases all64 running providers', async () => {
  /** Original subscribe passthrough and remover counts observe only this actual server endpoint. */
  const subscription = vi.spyOn(MemoryCarrier.prototype, 'subscribe')
  /** All admitted real providers wait on this original application-owned business gate. */
  const release = deferred<void>()
  /** The native provider signals the original64-business concurrency point. */
  const reachedCapacity = deferred<void>()
  /** The existing limits rejection callback proves the distinct65th admission was processed. */
  const refused = deferred<void>()
  /** Current provider concurrency is distinct from the65 originating client promises. */
  let active = 0
  /** Preserve the exact original observed maximum. */
  let maximumActive = 0
  /** The existing listener keeps all65 tasks on one genuine admitted caller. */
  const server = coreMemoryServer('provider-admission-fixture')
  /** Default actual limits are256 globally and64 per peer; no tighter surrogate policy is used. */
  const host = await createRpcHost({
    ...server.options,
    plugins: [
      limits({ onRejected: () => refused.resolve() }),
      replayAuthentication,
      ...server.options.plugins
    ],
    provide: {
      echo: async (_value, context) => {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        if (maximumActive === 64) reachedCapacity.resolve()
        await release.promise
        active -= 1
        return context.success('capacity')
      }
    }
  })
  /** All capacity observations refer to this actual accepted server-side source. */
  const client = await server.connect('r70-client', { plugins: [replayAuthentication] })
  /** Observe every real rejection immediately while keeping its original error object unchanged. */
  const outcomes: Promise<unknown>[] = []
  try {
    for (let index = 0; index < 65; index += 1)
      outcomes.push(
        client.host.memory
          .send('provider-admission-fixture', 'echo', 'r70-data')
          .catch((error) => error)
      )
    await reachedCapacity.promise
    await refused.promise
    release.resolve()
    await Promise.all(outcomes)
    expect(maximumActive).toBe(64)
    expect(active).toBe(0)
    /** New flat errors preserve the root semantic code from the actual physical server reply. */
    const messages = client.pair[0].written.filter(
      (frame): frame is Extract<IRpcSemanticFrame, { kind: 'error' }> =>
        frame.kind === 'error' &&
        frame.error.nodes[frame.error.root]?.code === RpcCoreErrorCode.overloaded
    )
    expect(messages).toHaveLength(1)
    expect(
      subscription.mock.contexts.filter((carrier) => carrier === client.pair[0]).length -
        client.pair[0].unsubscribed
    ).toBe(1)
  } finally {
    release.resolve()
    await Promise.all(outcomes)
    await Promise.all([client.host.close(), host.close()])
    subscription.mockRestore()
  }
})

// RPC-TEST-784B581CEDC7-C015: actual limits and Auth replace only the old injected refusal ports.
it.each([
  { reason: 'concurrency', mode: 'request' },
  { reason: 'concurrency', mode: 'notify' },
  { reason: 'replayLedgerFull', mode: 'request' },
  { reason: 'replayLedgerFull', mode: 'notify' }
] as const)(
  'refuses $reason for a $mode on its original accepted source',
  async ({ reason, mode }) => {
    /** Only actual business entry can establish the occupied provider lease. */
    const entered = deferred<void>()
    /** Concurrency work remains active until this original application gate is released. */
    const release = deferred<void>()
    /** Replay rows complete their first call; Auth alone retains its completed request identity. */
    const occupiedGate = reason === 'concurrency' ? release.promise : undefined
    /** The real policy observer establishes that the distinct attempted task was processed. */
    const refused = deferred<void>()
    /** Canonical local refusal records remain separate from business payload and physical replies. */
    const notices: IRpcProviderRejection[] = []
    /** Each selected policy receives the original plain callback with no private controller access. */
    const onRejected = (notice: IRpcProviderRejection) => {
      notices.push(notice)
      refused.resolve()
    }
    /** This distinct method must not run when the other real method occupies capacity. */
    const provider = vi.fn((_value: unknown, context: IRpcContext) => context.success(null))
    /** Both attempted methods enter the same original native source and canonical Session. */
    const listener = coreMemoryServer('host')
    /** Credential-only Auth leaves task replay independent from a signed counter wrapper. */
    const authentication =
      reason === 'replayLedgerFull'
        ? auth({
            credentials: replayCredential,
            verifyCredentials: (credentials) => {
              if (credentials !== replayCredential)
                throw new Error('unrecognized replay fixture credentials')
            },
            maxReplayEntriesPerPeer: 1,
            onRejected
          })
        : replayAuthentication
    /** Limits owns only concurrency; replay rows install no tighter surrogate provider quota. */
    const host = await createRpcHost({
      ...listener.options,
      plugins: [
        authentication,
        ...(reason === 'concurrency' ? [limits({ maxGlobal: 1, maxPerPeer: 1, onRejected })] : []),
        ...listener.options.plugins
      ],
      provide: {
        occupied: async (_value, context) => {
          entered.resolve()
          await occupiedGate
          return context.success('occupied')
        },
        test: provider
      }
    })
    /** The actual admitted peer id supplies the old Auth observer's verified-peer fixture value. */
    const client = await listener.connect(
      'peer',
      { plugins: [replayAuthentication] },
      'verified-peer'
    )
    /** This is the first actual call, not a fabricated capacity lease or completed-ledger entry. */
    const occupied = client.host.memory.send('host', 'occupied', null)
    /** Observe cleanup failure immediately while retaining the original caller Promise. */
    const occupiedOutcome = occupied.catch((error: unknown) => error)
    try {
      if (reason === 'concurrency') await entered.promise
      else await occupied
      /** Plain directed notify selects the original dispatchOnly no-ACK lifetime. */
      const dispatchOnly = mode === 'notify'
      if (dispatchOnly) await client.host.memory.notify('test', null, { targetId: 'host' })
      else
        await expect(client.host.memory.send('host', 'test', null)).rejects.toMatchObject({
          code: 'OVERLOADED'
        })
      await refused.promise
      expect(notices).toEqual([
        expect.objectContaining({
          verifiedPeerKey:
            reason === 'concurrency'
              ? JSON.stringify(['memory', 'verified-peer'])
              : 'verified-peer',
          controllerKey: expect.any(String),
          method: 'test',
          reason
        })
      ])
      expect(Object.keys(notices[0] as object).sort()).toEqual([
        'controllerKey',
        'method',
        'reason',
        'verifiedPeerKey'
      ])
      expect(provider).not.toHaveBeenCalled()
      /** Only terminals for the actual attempted task count; directory and occupied replies do not. */
      const request = admittedCall(client.pair[1], 'test')
      /** The real wire task confirms this input uses notify rather than a scalar request shortcut. */
      expect(request.task.mode).toBe(mode)
      /** The original server endpoint records the original error reply without a fake send callback. */
      const sent = client.pair[0].written.filter(
        (frame) =>
          (frame.kind === 'result' || frame.kind === 'error') &&
          frame.id === request.id &&
          frame.route.receiverId === request.route.senderId &&
          frame.task.mode === request.task.mode
      )
      expect(sent).toHaveLength(dispatchOnly ? 0 : 1)
      if (!dispatchOnly) {
        /** BC2 removes ok:false DTO spelling; the same actual physical error keeps OVERLOADED. */
        const response = sent[0]
        assert(response?.kind === 'error')
        expect(deserializeRpcWireError(response.error)).toMatchObject({ code: 'OVERLOADED' })
      }
    } finally {
      release.resolve()
      await occupiedOutcome
      await Promise.all([client.host.close(), host.close()])
    }
  }
)
