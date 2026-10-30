import { rpcFeaturesPlugin } from '@migaia/rpc-host/sdk'
/** Derived policy effects execute in their installed flow owners over actual Process native IO. */
import { MessageChannel, type MessagePort } from 'node:worker_threads'
import { expect, it, vi } from 'vitest'
import { deferred } from '@migaia/utils/promise'
import { createManualScheduler } from '@migaia/utils/testing'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createRpcHost } from '@migaia/rpc-host'
import { authFeature } from '@migaia/rpc-host/plugins/auth'
import {
  idempotencyFeature,
  createRpcIdempotencyStore,
  type IRpcIdempotencyStore
} from '@migaia/rpc-host/plugins/idempotency'
import { limitsFeature } from '@migaia/rpc-host/plugins/limits'
import { defineTransportPlugin, type IRpcTransportSetupContext } from '@migaia/rpc-host/sdk'
import type { IRpcSessionHandle } from '@migaia/rpc-contract/interfaces'
import { createProcessCarrier } from '../../dist/process/carrier.js'
import type { IProcessMessageChannel } from '../../dist/process/types.js'

/** Original native ports supply physical writes and close events without any RPC state. */
function processPort(port: MessagePort): IProcessMessageChannel {
  return {
    kind: 'message',
    send: (value) => port.postMessage(value),
    onMessage(listener) {
      port.on('message', listener)
      return () => {
        port.off('message', listener)
      }
    },
    onClose(listener) {
      /** Native close has no fabricated Process failure reason. */
      const closed = (): void => listener()
      port.on('close', closed)
      return () => {
        port.off('close', closed)
      }
    },
    close: () => port.close()
  }
}

/** Original SDK attachment and installed flow plugins own every actual server policy operation. */
class NativePolicyServer {
  /** Distinct provider identities fence shared external storage across actual Hosts. */
  readonly #name: string
  /** The complete caller store remains the sole original claim/seal owner. */
  readonly #store: IRpcIdempotencyStore
  /** Original native setup attaches later independently acquired MessagePorts. */
  #context: IRpcTransportSetupContext | undefined
  /** Only these original Session handles are detached at source retirement. */
  readonly #sessions: IRpcSessionHandle[] = []
  /** Public roots retain native physical and provider cleanup authority. */
  readonly #hosts: { close(): Promise<void> }[] = []
  /** Acquired native resources also close if root construction fails before adoption. */
  readonly #ports: MessagePort[] = []
  /** Real provider side effects distinguish replay from execution in another scope. */
  calls = 0
  /** This counts actual entered providers rather than client in-flight promises. */
  active = 0
  /** The actual third provider proves the selected native concurrency3 policy. */
  readonly full = deferred<void>()
  /** Finally releases every original held business operation. */
  readonly release = deferred<void>()
  /** Original native/report failures remain independently observable. */
  readonly reports: unknown[] = []

  /** Retain the explicit actual provider identity and caller-owned store. */
  constructor(name: string, store: IRpcIdempotencyStore) {
    this.#name = name
    this.#store = store
  }
  /** Install real flow owners before any native Session may dispatch business. */
  async open(): Promise<void> {
    /** This source borrows actual Host setup without a synthetic peer facade. */
    const source = defineTransportPlugin({
      name: `${this.#name}-source`,
      namespace: 'process',
      open: (context) => {
        this.#context = context
        return {
          dispose: async () => {
            await Promise.all(this.#sessions.map((handle) => context.detach(handle)))
          }
        }
      }
    })
    /** Stable-principal and independent-provider scopes execute in the original dispatch pipeline. */
    const host = await createRpcHost({
      self: { name: this.#name, instanceId: this.#name },
      plugins: [
        rpcFeaturesPlugin({
          features: {
            idempotency: idempotencyFeature({ store: this.#store }),
            limits: limitsFeature({ maxGlobal: 3, maxPerPeer: 3 }),
            auth: authFeature({
              verifyCredentials: (credential) => ({
                principalId: credential === 'bob-token' ? 'bob' : 'alice'
              })
            })
          }
        }),
        source
      ],
      provide: {
        echo: () => ++this.calls,
        hold: async () => {
          this.active += 1
          if (this.active === 3) this.full.resolve()
          try {
            await this.release.promise
            return 7
          } finally {
            this.active -= 1
          }
        }
      },
      report: (error) => this.reports.push(error)
    })
    this.#hosts.push(host)
  }
  /** Acquire original native IO and join both actual Sessions' bilateral admission. */
  async connect(name: string, credential: string) {
    /** These independent native ports carry every actual hello, call and result. */
    const ports = new MessageChannel()
    this.#ports.push(ports.port1, ports.port2)
    /** Server source attaches the actual Process carrier without copying Session state. */
    const server = this.#context!.attach(
      createProcessCarrier(processPort(ports.port1), this.#context!, {
        id: `${this.#name}-${name}`
      })
    )
    this.#sessions.push(server)
    /** The independent caller lends its opposite native port to its own original Session. */
    const source = defineTransportPlugin({
      name: `${name}-source`,
      namespace: 'process',
      open: async (context) => {
        /** This actual caller handle has no fake handshake or old identity options. */
        const handle = context.attach(
          createProcessCarrier(processPort(ports.port2), context, { id: `${name}-${this.#name}` })
        )
        await handle.ready
        return { dispose: () => context.detach(handle) }
      }
    })
    /** Explicit credentials receive the old unit's explicitly supplied identity input only. */
    const client = await createRpcHost({
      self: { name, instanceId: name },
      plugins: [
        rpcFeaturesPlugin({ features: { auth: authFeature({ credentials: credential }) } }),
        source
      ],
      report: (error) => this.reports.push(error)
    })
    this.#hosts.push(client)
    await server.ready
    return client
  }
  /** Release original business before joining actual roots and native ports. */
  async close(): Promise<void> {
    this.release.resolve()
    try {
      await Promise.all(this.#hosts.map((host) => host.close()))
    } finally {
      for (const port of this.#ports) port.close()
    }
  }
}

it('isolates owners sharing a real store and retains verified principal policy across native connections', async () => {
  /** The original complete store alone owns claims, retained outcomes and eviction. */
  const original = createRpcIdempotencyStore()
  /** Actual scope strings are observed at the supported caller-owned claim port. */
  const scopes: string[] = []
  /** Delegation preserves the original store's exact claim and does not implement another ledger. */
  const claim: IRpcIdempotencyStore['claim'] = (...args) => {
    scopes.push(args[0])
    return original.claim(...args)
  }
  /** All other original store operations and state remain unchanged. */
  const store: IRpcIdempotencyStore = {
    claim,
    lookup: original.lookup,
    readRuntimeFacts: original.readRuntimeFacts
  }
  /** The original manual backend observes exact timer release after native cleanup. */
  const scheduler = createManualScheduler()
  /** Session/call owners still schedule their own work; no extra policy timer exists. */
  const clock = vi
    .spyOn(systemScheduler, 'schedule')
    .mockImplementation((run, delay) => scheduler.schedule(run, delay))
  /** One actual provider and a distinct owner borrow the same complete caller store. */
  const owner = new NativePolicyServer('policy-owner', store)
  /** A different logical provider must preserve its own scope for the same principal. */
  const otherOwner = new NativePolicyServer('foreign-owner', store)
  /** All original held provider results remain immediately observed. */
  const pending: Promise<unknown>[] = []
  try {
    await Promise.all([owner.open(), otherOwner.open()])
    /** Different native connections and bearer values still verify as the same principal. */
    const first = await owner.connect('first', 'first-token')
    /** Replacement physical identity must not erase stable-principal outcome scope. */
    const replacement = await owner.connect('replacement', 'replacement-token')
    /** Another verified principal remains isolated in the same actual store. */
    const otherPrincipal = await owner.connect('other-principal', 'bob-token')
    /** The same principal reaches a different actual provider owner. */
    const foreign = await otherOwner.connect('foreign', 'first-token')
    expect(
      await first.process.send('policy-owner', 'echo', undefined, { idempotencyKey: 'key' })
    ).toBe(1)
    expect(
      await replacement.process.send('policy-owner', 'echo', undefined, { idempotencyKey: 'key' })
    ).toBe(1)
    expect(
      await otherPrincipal.process.send('policy-owner', 'echo', undefined, {
        idempotencyKey: 'key'
      })
    ).toBe(2)
    expect(
      await foreign.process.send('foreign-owner', 'echo', undefined, { idempotencyKey: 'key' })
    ).toBe(1)
    expect(scopes[0]).toBe(scopes[1])
    expect(scopes[0]).not.toBe(scopes[2])
    expect(scopes[0]).not.toBe(scopes[3])
    expect(scopes[0]).not.toContain('first-token')
    expect(owner.reports).toEqual([])
    expect(otherOwner.reports).toEqual([])
    for (let index = 0; index < 3; index++) {
      pending.push(first.process.send('policy-owner', 'hold'))
      void pending[index]!.catch(() => undefined)
    }
    await owner.full.promise
    expect(owner.active).toBe(3)
    await expect(first.process.send('policy-owner', 'hold')).rejects.toMatchObject({
      code: 'OVERLOADED'
    })
    owner.release.resolve()
    expect(await Promise.all(pending)).toEqual([7, 7, 7])
    expect(owner.reports).toEqual([expect.objectContaining({ code: 'OVERLOADED' })])
  } finally {
    owner.release.resolve()
    otherOwner.release.resolve()
    await Promise.allSettled(pending)
    await Promise.all([owner.close(), otherOwner.close()])
    clock.mockRestore()
  }
  expect(scheduler.pendingCount).toBe(0)
})
