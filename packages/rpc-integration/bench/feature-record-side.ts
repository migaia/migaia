/** Bundle this same fixture against exactly one selected source root, never workspace dist output. */
import { strict as assert } from 'node:assert'
import { createRpcHost } from '@migaia/rpc-host'
import * as sdk from '@migaia/rpc-host/sdk'
import { timeoutFeature } from '@migaia/rpc-host/features/timeout'
import { retryFeature } from '@migaia/rpc-host/features/retry'
import { limitsFeature } from '@migaia/rpc-host/plugins/limits'
import {
  RpcContractErrorCode,
  RpcCoreErrorCode,
  RpcRemoteLayerErrorCode
} from '@migaia/rpc-contract/error-code'
import { RpcProviderRejectionReason } from '@migaia/rpc-contract/errors'
import type { IRpcCarrierWriteOptions } from '@migaia/rpc-contract/interfaces'
import type {
  IFeatureRecordSession,
  IFailureObservation,
  IMeasurementPhase,
  ISideModule
} from './feature-record.ts'

/** Build-time provenance is injected independently into A and B's self-contained bundles. */
declare const FEATURE_RECORD_SOURCE_ROOT: string
/** The exact source revision is descriptive; B additionally identifies its dirty candidate. */
declare const FEATURE_RECORD_REVISION: string
/** A uses historical arrays and root flow Features; B uses record assembly. */
declare const FEATURE_RECORD_FORM: boolean

/** The fixture keeps one common runtime adapter for the two intentionally incompatible APIs. */
type IHost = Readonly<{
  memory: Readonly<{ send(id: string, method: string, data: unknown): Promise<unknown> }>
  close(): Promise<void>
}>
/** Only the supported SDK construction boundary is erased across the old and new signatures. */
type IApi = Readonly<{
  createRpcMessageCarrier: typeof sdk.createRpcMessageCarrier
  defineTransportPlugin(definition: Readonly<Record<string, unknown>>): unknown
  rpcFeaturesPlugin(options: Readonly<{ features: Readonly<Record<string, unknown>> }>): unknown
}>
/** Native attachment remains the real SDK context in each independent bundled implementation. */
type IContext = Parameters<Parameters<typeof sdk.defineTransportPlugin>[0]['open']>[0]

/** Stable fixture identities and payload carry no credentials or caller-provided data. */
const fixture = {
  namespace: 'memory',
  server: 'feature-record-server',
  client: 'feature-record-client',
  method: 'api.echo',
  payload: 'feature-record-payload',
  timeoutMs: 30_000,
  attempts: 2,
  providerCapacity: 64
} as const

/** One synchronous in-memory physical endpoint lends IO only; SDK owns codecs and Sessions. */
class MemoryIO {
  /** The opposite endpoint receives the original encoded whole frame. */
  #peer: MemoryIO | undefined
  /** Exactly one native carrier subscription owns delivery at a time. */
  #message: ((value: unknown) => void) | undefined
  /** Original physical EOF notifies only the opposite native endpoint. */
  #ended: ((reason?: unknown) => void) | undefined
  /** Physical close stays idempotent independently of semantic Session shutdown. */
  #closed = false

  /** Link both endpoints before constructing their real SDK carriers. */
  link(peer: MemoryIO): void {
    this.#peer = peer
  }

  /** Complete the original handoff callback before delivering the frame to its physical peer. */
  async send(
    value: unknown,
    _transfer?: readonly ArrayBuffer[],
    options?: IRpcCarrierWriteOptions
  ) {
    assert(!this.#closed, 'memory IO is closed')
    if (options?.signal?.aborted) throw options.signal.reason
    await options?.onWriteStart?.()
    this.#peer!.#message!(value)
  }

  /** The canonical message carrier owns this exact listener receipt. */
  onMessage(listener: (value: unknown) => void): () => void {
    this.#message = listener
    return () => {
      if (this.#message === listener) this.#message = undefined
    }
  }

  /** Retire only the same native EOF listener installed by the carrier. */
  onClose(listener: (reason?: unknown) => void): () => void {
    this.#ended = listener
    return () => {
      if (this.#ended === listener) this.#ended = undefined
    }
  }

  /** The same physical EOF closes the opposite SDK carrier without an extra resource manager. */
  close(reason?: unknown): void {
    if (this.#closed) return
    this.#closed = true
    /** Only the linked endpoint receives this physical EOF. */
    const peer = this.#peer
    if (peer) peer.#ended?.(reason)
  }
}

/** Each measurement gets two fresh real Hosts with timeout, retry and executing limits flow. */
class FeatureRecordSession implements IFeatureRecordSession {
  /** Runtime casts isolate intentional public API changes from identical measurement behavior. */
  readonly #api = sdk as unknown as IApi
  /** Both physical endpoints are independent of the actual RPC and feature installation owners. */
  readonly #serverIO = new MemoryIO()
  /** Native whole-message delivery is synchronous after its real write-start handoff. */
  readonly #clientIO = new MemoryIO()
  /** The actual listening transport lends attachment authority after installation. */
  #serverContext: IContext | undefined
  /** The public server remains the sole provider and accepted-Session owner. */
  #server: IHost | undefined
  /** Only this public client issues measured business calls. */
  #client: IHost | undefined
  /** Report and existing limits rejection events retain their original errors and reason enums. */
  readonly #failures: IFailureObservation[] = []
  /** Every event is attributable to setup, warmup, measurement or cleanup. */
  #phase: IMeasurementPhase = 'setup'
  /** Serial call ordinal correlates limits onRejected with the original caller failure. */
  #operation = 0
  /** This is measured client concurrency, kept distinct from provider execution concurrency. */
  #clientActive = 0
  /** Peak client activity is observed rather than inferred from a requested lane count. */
  #clientPeak = 0
  /** The actual provider method counts its own entry and exit. */
  #providerActive = 0
  /** Provider concurrency is independently observed in the business method. */
  #providerPeak = 0
  /** Successful business count detects missing calls independently of the timer. */
  #providerCalls = 0

  /** Set the observation phase before any of its actual work begins. */
  phase(value: IMeasurementPhase): void {
    this.#phase = value
  }

  /** Preserve exact original diagnostics; driver performs redaction and full chain classification. */
  readonly #report = (error: unknown): void => {
    this.#failures.push({ kind: 'report', phase: this.#phase, operation: this.#operation, error })
  }

  /** Existing reason channel distinguishes provider-capacity branches sharing OVERLOADED. */
  readonly #rejected = (error: unknown): void => {
    this.#failures.push({
      kind: 'provider-rejection',
      phase: this.#phase,
      operation: this.#operation,
      error
    })
  }

  /** Both API forms install the same call policies at transport scope and limits at host scope. */
  #plugins(open: (context: IContext) => unknown): readonly unknown[] {
    /** The identical executing limits owner supplies its existing rejection reason channel. */
    const quotas = limitsFeature({
      maxGlobal: fixture.providerCapacity,
      maxPerPeer: fixture.providerCapacity,
      onRejected: this.#rejected
    })
    /** B makes assembly explicit; A uses the supported historical root flow Feature form. */
    const flow = FEATURE_RECORD_FORM
      ? this.#api.rpcFeaturesPlugin({ features: { quotas } })
      : quotas
    /** Timer and retry facts execute in both variants, without invoking either Feature directly. */
    const timeout = timeoutFeature({ ms: fixture.timeoutMs })
    /** The same total-attempt limit remains active throughout every measured real RPC call. */
    const retry = retryFeature({ attempts: fixture.attempts })
    return [
      flow,
      this.#api.defineTransportPlugin({
        name: fixture.namespace,
        namespace: fixture.namespace,
        features: FEATURE_RECORD_FORM
          ? { callBudget: timeout, replacement: retry }
          : [timeout, retry],
        open
      })
    ]
  }

  /** The genuine server transport stores SDK attachment authority without opening a second Host. */
  readonly #listen = (context: IContext) => {
    this.#serverContext = context
    return { dispose: () => undefined }
  }

  /** Both original Sessions subscribe before joining the actual common handshake. */
  readonly #connect = async (context: IContext) => {
    /** Server carrier uses the selected implementation's real codec and native message owner. */
    const serverCarrier = this.#api.createRpcMessageCarrier({
      id: fixture.server,
      io: this.#serverIO,
      report: this.#report
    })
    /** Client owns a distinct real carrier and Session, never a direct provider invocation. */
    const clientCarrier = this.#api.createRpcMessageCarrier({
      id: fixture.client,
      io: this.#clientIO,
      report: this.#report
    })
    /** Both endpoint lifetimes remain registered in their original public Hosts. */
    const accepted = this.#serverContext!.attach(serverCarrier)
    /** The actual client context alone attaches its physical endpoint. */
    const connected = context.attach(clientCarrier)
    await Promise.all([accepted.ready, connected.ready])
    return { dispose: () => undefined }
  }

  /** The real provider observes its own concurrency and returns the original fixed business value. */
  readonly #echo = (payload: unknown): unknown => {
    this.#providerActive += 1
    this.#providerPeak = Math.max(this.#providerPeak, this.#providerActive)
    this.#providerCalls += 1
    this.#providerActive -= 1
    return payload
  }

  /** Acquire fresh independent Hosts before warmup or timing; failed acquisition is still closable. */
  async open(): Promise<void> {
    this.#serverIO.link(this.#clientIO)
    this.#clientIO.link(this.#serverIO)
    /** Both source forms call their own independently bundled public factory. */
    const create = createRpcHost as unknown as (
      options: Readonly<Record<string, unknown>>
    ) => Promise<IHost>
    this.#server = await create({
      self: { name: fixture.server, instanceId: fixture.server },
      plugins: this.#plugins(this.#listen),
      provide: { api: { echo: this.#echo } },
      contract: {
        schemaVersion: 1,
        plugin: 'api',
        features: { work: { methods: { echo: { mode: 'request', idempotent: true } } } }
      },
      report: this.#report
    })
    this.#client = await create({
      self: { name: fixture.client, instanceId: fixture.client },
      plugins: this.#plugins(this.#connect),
      report: this.#report
    })
  }

  /** One awaited public send exercises actual origin, timeout/retry, codec, flow and provider paths. */
  async invoke(): Promise<void> {
    this.#operation += 1
    this.#clientActive += 1
    this.#clientPeak = Math.max(this.#clientPeak, this.#clientActive)
    try {
      assert.equal(
        await this.#client!.memory.send(fixture.server, fixture.method, fixture.payload),
        fixture.payload
      )
    } finally {
      this.#clientActive -= 1
    }
  }

  /** Expose observed concurrency separately for client and provider, plus actual business count. */
  statistics() {
    return {
      clientPeak: this.#clientPeak,
      providerPeak: this.#providerPeak,
      providerCalls: this.#providerCalls
    }
  }

  /** Every report or rejection remains available even when setup, measurement or cleanup fails. */
  failures(): readonly IFailureObservation[] {
    return this.#failures
  }

  /** Cleanup remains outside timing and attempts both actual public owners. */
  async close(): Promise<void> {
    /** Successful and failed creation both retain only the real Hosts already acquired. */
    const results = await Promise.allSettled([this.#client?.close(), this.#server?.close()])
    for (const result of results) if (result.status === 'rejected') this.#report(result.reason)
    this.#clientIO.close()
    this.#serverIO.close()
  }
}

/** Each import identifies its exact isolated source root and intentionally selected API adapter. */
export const provenance = {
  sourceRoot: FEATURE_RECORD_SOURCE_ROOT,
  revision: FEATURE_RECORD_REVISION,
  form: FEATURE_RECORD_FORM ? 'record' : 'array'
} as const

/** Enumerate observable code domains before measuring, including shared-code reason distinctions. */
export const failureVocabulary: ISideModule['failureVocabulary'] = {
  codes: {
    'rpc.endpoint': Object.values(RpcCoreErrorCode),
    'rpc.contract': Object.values(RpcContractErrorCode),
    'rpc.remote': Object.values(RpcRemoteLayerErrorCode)
  },
  sharedCodes: {
    OVERLOADED: {
      reasons: Object.values(RpcProviderRejectionReason),
      observedChannel: 'limitsFeature.onRejected; record original reason with phase and operation',
      supportedBranches: ['concurrency'],
      absentPolicies: [
        'auth replay ledger',
        'groups',
        'ordered provider queues',
        'native process capacity'
      ]
    }
  }
}

/** The driver uses a new pair for every A, A2 or B run in the same process. */
export function createSession(): IFeatureRecordSession {
  return new FeatureRecordSession()
}
