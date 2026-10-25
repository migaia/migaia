/** Original ingress rejection and late-verification business assertions use genuine native Sessions. */
import { createRpcHost } from '@migaia/rpc-host'
import auth from '@migaia/rpc-host/features/auth'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { deferred, type IDeferred } from '@migaia/utils/promise'
import { assert, expect, it, vi } from 'vitest'
import { coreMemoryServer } from '../host/core-fixture.js'

/** One configured verifier suspension borrows the original transform input without parsing it. */
type IIngressVerification = {
  entered: IDeferred<unknown>
  release: IDeferred<void>
}

/** Application-owned verification gates never restore frames or dispatch business themselves. */
class IngressVerifier {
  /** Only the next actual verification borrows this explicitly armed application gate. */
  #pending: IIngressVerification | undefined

  /** Arm after a real barrier reply, so startup directory traffic cannot consume the gate. */
  hold(): IIngressVerification {
    /** The original callback retains the opaque input until its own application gate settles. */
    const pending = { entered: deferred<unknown>(), release: deferred<void>() }
    this.#pending = pending
    return pending
  }

  /** Pass through ordinary signatures; held signatures keep their original value and rejection. */
  readonly verify = (value: unknown): unknown | Promise<unknown> => {
    /** Each gate is consumed once by the actual configured auth callback. */
    const pending = this.#pending
    this.#pending = undefined
    if (!pending) return value
    pending.entered.resolve(value)
    return pending.release.promise.then(() => value)
  }
}

it('rejecting ingress verification releases the next call; close prevents a late verifier from dispatching', async () => {
  /** Only the real provider records business execution; physical writes alone cannot add entries. */
  const delivered: unknown[] = []
  /** Authentication reports retain their real native wrapper and original verifier cause. */
  const failures: unknown[] = []
  /** The configured application verifier supplies the original asynchronous protection boundary. */
  const verifier = new IngressVerifier()
  /** The existing listener owns the accepted Session and native lifecycle handle. */
  const server = coreMemoryServer('provider')
  /** The public host installs actual Auth and an actual provider without injecting dispatcher ports. */
  const host = await createRpcHost({
    ...server.options,
    plugins: [auth({ sign: (value) => value, verify: verifier.verify }), ...server.options.plugins],
    report: (error) => failures.push(error),
    provide: {
      barrier: (value, context) => context.success(value),
      echo: (value, context) => {
        delivered.push(value)
        return context.success(value)
      }
    }
  })
  /** This original client completes both genuine handshakes through the same native pair. */
  const client = await server.connect('caller', {
    plugins: [auth({ sign: (value) => value, verify: (value) => value })]
  })
  /** A finally release must never leave a configured verification callback retaining native leases. */
  const gates: IIngressVerification[] = []
  /** Original public request promises remain observed until actual source retirement settles them. */
  const outcomes: Promise<unknown>[] = []
  /** A passthrough spy observes real physical submission, without reading protected metadata. */
  const writes = vi.spyOn(client.pair[1], 'write')
  try {
    /** A real round trip joins preceding directory work in both original physical receive tails. */
    await client.host.memory.send('provider', 'barrier', 'before-verification')
    /** This actual accepted handle remains authoritative after its public lookup retires. */
    const accepted = server.lookup('caller')
    assert(accepted)
    /** The rejected first input keeps the exact original application error on the reported chain. */
    const rejected = verifier.hold()
    gates.push(rejected)
    writes.mockClear()
    outcomes.push(
      client.host.memory.send('provider', 'echo', 'rejected').catch((error: unknown) => error)
    )
    await rejected.entered.promise
    /** The second actual request keeps its ordinary request task and genuine caller generation. */
    const ready = client.host.memory.send('provider', 'echo', 'ready')
    outcomes.push(ready.catch((error: unknown) => error))
    await vi.waitFor(() => expect(writes).toHaveBeenCalledTimes(2))
    await Promise.resolve()
    await Promise.resolve()
    expect(delivered).toEqual([])
    /** The actual Auth owner reports this rejection and lets the Session's next physical slot run. */
    const original = new Error('fixture verification rejected')
    rejected.release.reject(original)
    await expect(ready).resolves.toBe('ready')
    await vi.waitFor(() => expect(delivered).toEqual(['ready']))
    expect(failures).toContainEqual(
      expect.objectContaining({
        source: 'rpc.endpoint',
        code: RpcCoreErrorCode.authenticationFailed,
        cause: original
      })
    )
    /** A later configured verifier is suspended before its payload can reach the real provider. */
    const late = verifier.hold()
    gates.push(late)
    outcomes.push(
      client.host.memory.send('provider', 'echo', 'late').catch((error: unknown) => error)
    )
    await late.entered.promise
    /** Original Session close physically retires the source, then joins its admitted receive tail. */
    const closing = accepted.handle.close()
    expect(accepted.handle.close()).toBe(closing)
    await vi.waitFor(() => expect(client.pair[0].closed).toBe(true))
    late.release.resolve()
    await closing
    await Promise.resolve()
    await Promise.resolve()
    expect(delivered).toEqual(['ready'])
  } finally {
    for (const gate of gates) gate.release.resolve()
    await Promise.all([client.host.close(), host.close()])
    await Promise.all(outcomes)
    writes.mockRestore()
  }
})
