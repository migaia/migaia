/** Business providers shared by every topology leaf, with counters that prove single execution. */
import { RpcProbeStage } from '@migaia/rpc-contract/interfaces'
import type { IRpcContext } from '@migaia/rpc-host'
import {
  HopAuthCounter,
  LeafFailure,
  Topology,
  TopologyRecorder,
  binaryPattern,
  type ITopologyLeafSnapshot
} from './topology-vocabulary.ts'

/** Describe an abort reason as a portable string for the inspect snapshot. */
function describeReason(reason: unknown): string {
  if (reason instanceof Error) return reason.message
  return String(reason)
}

/** One leaf's providers and the counters its inspect provider reports. */
export class TopologyLeaf {
  /** Probe recorder for this leaf's inbound message rows. */
  readonly recorder = new TopologyRecorder()
  /** Transform counts of auth on this leaf's parent hop, when installed. */
  readonly auth = new HopAuthCounter()
  /** Instance id of the leaf host; set once its host opens. */
  #instanceId = ''
  /** Business echo executions on this leaf. */
  #echoCalls = 0
  /** Coded failure executions on this leaf. */
  #failCalls = 0
  /** Abortable wait executions on this leaf. */
  #waitCalls = 0
  /** Abort reasons each wait observed on its own context signal. */
  readonly #aborts: string[] = []
  /** Streams started by the first `next()`. */
  #streamsOpened = 0
  /** Streams whose generator `finally` ran after cancellation or completion. */
  #streamsFinalized = 0

  /** Record the opened host's instance id for snapshots. */
  bind(instanceId: string): void {
    this.#instanceId = instanceId
  }

  /** Build the provider object installed by every leaf host. */
  providers() {
    return {
      [Topology.ready]: () => true,
      [Topology.echo]: (value: unknown) => {
        this.#echoCalls += 1
        return { value, leaf: this.#instanceId, seq: this.#echoCalls }
      },
      [Topology.fail]: () => {
        this.#failCalls += 1
        throw TopologyLeaf.#failure()
      },
      [Topology.wait]: (_value: unknown, context: IRpcContext) => this.#wait(context),
      [Topology.remaining]: (_value: unknown, context: IRpcContext) => ({
        timeoutMs: context.timeoutMs ?? null
      }),
      [Topology.bytes]: (bytes: Uint8Array) => TopologyLeaf.#compare(bytes),
      [Topology.ticks]: () => this.#ticks(),
      [Topology.ticksFail]: () => TopologyLeaf.#ticksFail(),
      [Topology.inspect]: (): ITopologyLeafSnapshot => this.snapshot()
    }
  }

  /** Report this leaf's counters and copied message rows. */
  snapshot(): ITopologyLeafSnapshot {
    return {
      instanceId: this.#instanceId,
      pid: globalThis.process?.pid ?? 0,
      echoCalls: this.#echoCalls,
      failCalls: this.#failCalls,
      waitCalls: this.#waitCalls,
      aborts: [...this.#aborts],
      streamsOpened: this.#streamsOpened,
      streamsFinalized: this.#streamsFinalized,
      messages: this.recorder.snapshot().filter((event) => event.stage === RpcProbeStage.message),
      auth: this.auth.snapshot()
    }
  }

  /** Build the coded leaf failure with a reachable native root cause. */
  static #failure(): Error {
    /** The failure crossing every hop; source and code are attached, not rebuilt. */
    const error = new Error(LeafFailure.message, { cause: new TypeError(LeafFailure.rootMessage) })
    Object.defineProperty(error, 'source', { value: LeafFailure.source, enumerable: true })
    Object.defineProperty(error, 'code', { value: LeafFailure.code, enumerable: true })
    return error
  }

  /** Wait until the caller's abort reaches this leaf, then record and rethrow its reason. */
  #wait(context: IRpcContext): Promise<never> {
    this.#waitCalls += 1
    return new Promise<never>((_resolve, reject) => {
      /** Settle once with the exact reason delivered to this leaf. */
      const abort = () => {
        this.#aborts.push(describeReason(context.signal.reason))
        reject(context.signal.reason)
      }
      if (context.signal.aborted) abort()
      else context.signal.addEventListener('abort', abort, { once: true })
    })
  }

  /** Count bytes that differ from the shared pattern. */
  static #compare(bytes: Uint8Array): { length: number; mismatches: number } {
    /** Expected bytes of the same length. */
    const expected = binaryPattern(bytes.length)
    /** Positions whose byte differs from the pattern. */
    let mismatches = 0
    for (let index = 0; index < bytes.length; index++) {
      if (bytes[index] !== expected[index]) mismatches += 1
    }
    return { length: bytes.length, mismatches }
  }

  /** Yield two values, then fail with the coded leaf failure mid-stream. */
  static async *#ticksFail(): AsyncGenerator<number> {
    yield 0
    yield 1
    throw TopologyLeaf.#failure()
  }

  /** Yield an unbounded sequence until the consumer cancels; `finally` records cleanup. */
  async *#ticks(): AsyncGenerator<number> {
    this.#streamsOpened += 1
    try {
      for (let value = 0; ; value++) {
        yield value
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
    } finally {
      this.#streamsFinalized += 1
    }
  }
}
