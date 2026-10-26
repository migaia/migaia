/** Shared vocabulary and observation for the mixed-carrier forwarding topology tests. */
import { RpcProbeDirection, RpcProbeOutcome, RpcProbeStage } from '@migaia/rpc-contract/interfaces'
import { probe, type IRpcProbeEventView } from '@migaia/rpc-host/plugins/probe'
import type { IRpcNamespace } from '@migaia/rpc-host'

/** Peer names, provider names and the business trace shared by every topology node. */
export const Topology = {
  /** Native peer names selected by each public source recipe. */
  b: 'b',
  c: 'c',
  d: 'd',
  coroutine: 'co',
  python: 'py',
  /** Provider names on forwarding hosts and leaves. */
  ready: 'ready',
  /** A27 starts c only after b's original parent, pool and coroutine have committed. */
  installThread: 'installThread',
  /** Explicit held-forward methods form the ruled loop without reflected directory routes. */
  loop: 'loop',
  /** Fixture setup installs c's held forward only after b's real public method is announced. */
  prepareLoop: 'prepareLoop',
  inspect: 'inspect',
  echo: 'echo',
  fail: 'fail',
  wait: 'wait',
  remaining: 'remaining',
  bytes: 'bytes',
  ticks: 'ticks',
  ticksFail: 'ticksFail',
  crash: 'crash',
  shutdown: 'shutdown',
  /** One trace separates business calls from readiness and inspection calls. */
  trace: 'forward-topology'
} as const

/** The coded business failure a leaf throws; its root cause must survive every hop. */
export const LeafFailure = {
  source: 'app.topology',
  code: 'LEAF_FAILED',
  message: 'leaf failed',
  rootMessage: 'leaf root cause'
} as const

/** Fixture setup failure is distinct from the actual FORWARD_LOOP business refusal under test. */
const TopologyLoopText = {
  unavailable: 'Explicit loop method was not published before setup expired'
} as const

/** Wait only for the actual public loop capability; directory publication is asynchronous. */
export async function topologyLoopMethod(namespace: IRpcNamespace, peer: string) {
  /** One fixture setup waits at most two seconds without sending readiness stimulus frames. */
  const deadline = Date.now() + 2000
  while (Date.now() < deadline) {
    /** Read the current public tree instead of retaining the pre-announcement projection. */
    const methods = namespace.peers[peer]
    if (methods && typeof Reflect.get(methods, Topology.loop) === 'function')
      return Reflect.get(methods, Topology.loop)
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(TopologyLoopText.unavailable)
}

/** Ordinary application options passed to the forwarding host through its native recipe. */
export type ITopologyOptions = Readonly<{
  /** Only the loop case explicitly publishes the two mutually forwarding business methods. */
  loop?: boolean
  /** Installs auth only on the b–c thread hop; `mismatch` gives c a different secret. */
  hopAuth?: 'match' | 'mismatch'
  /**
   * Spawns b's child process d; optional so a failed child start cannot take b down for the other
   * topologies.
   */
  childProcess?: boolean
  /** Spawns the Python foreign leaf. */
  python?: boolean
}>

/** Secrets used by the hop-scoped auth assertion. */
export const HopSecret = { shared: 'topology-hop-secret', other: 'topology-other-secret' } as const

/** The credential verifier's original native cause survives the installation and RPC boundaries. */
export const HopAuthText = { credentialRefused: 'hop credential refused' } as const

/** Counts of identity sign and verify transforms run by one side of the auth hop. */
export class HopAuthCounter {
  /** Outbound messages this side signed. */
  signed = 0
  /** Inbound messages this side verified. */
  verified = 0

  /**
   * Build auth options that send `secret`, accept only the shared secret, and count transforms.
   *
   * @param secret Credential this side presents to its peer.
   */
  options(secret: string) {
    return {
      credentials: secret,
      verifyCredentials: (presented: unknown) => {
        if (presented !== HopSecret.shared) throw new Error(HopAuthText.credentialRefused)
      },
      sign: (value: unknown) => {
        this.signed += 1
        return value
      },
      verify: (value: unknown) => {
        this.verified += 1
        return value
      }
    }
  }

  /** Portable copy of the counters. */
  snapshot(): { signed: number; verified: number } {
    return { signed: this.signed, verified: this.verified }
  }
}

/**
 * Build the deterministic byte pattern both ends compare against.
 *
 * @param length Number of bytes; the binary assertion uses 1 MiB.
 * @returns A fresh array whose byte `i` is `(i * 31 + 7) & 0xff`.
 */
export function binaryPattern(length: number): Uint8Array {
  /** Fresh output owned by the caller; it may be transferred. */
  const bytes = new Uint8Array(length)
  for (let index = 0; index < length; index++) bytes[index] = (index * 31 + 7) & 0xff
  return bytes
}

/** Portable copy of one forward or message probe event. */
export type ITopologyProbeEvent = Readonly<{
  stage: RpcProbeStage
  /** Public interaction kind and message identity pair stream creation with its actual settlement. */
  kind: number
  messageId: string
  direction: RpcProbeDirection
  outcome: RpcProbeOutcome
  hop: number
  route: readonly string[]
  rejection: string
}>

/** Per-leaf counters a leaf returns from its inspect provider. */
export type ITopologyLeafSnapshot = Readonly<{
  instanceId: string
  pid: number
  echoCalls: number
  failCalls: number
  waitCalls: number
  aborts: readonly string[]
  streamsOpened: number
  streamsFinalized: number
  messages: readonly ITopologyProbeEvent[]
  auth: Readonly<{ signed: number; verified: number }>
}>

/** Copies trace-filtered probe rows; views are borrowed only for the callback. */
export class TopologyRecorder {
  /** Copied rows in arrival order. */
  readonly #events: ITopologyProbeEvent[] = []
  /** The public probe plugin observing forward and message stages on this host. */
  readonly plugin = probe({
    stages: ['forward', 'message'],
    emit: (view) => {
      if (view.trace === Topology.trace) this.#events.push(TopologyRecorder.#copy(view))
    }
  })

  /** Copy only portable fields before the borrowed view is reused. */
  static #copy(view: IRpcProbeEventView): ITopologyProbeEvent {
    return {
      stage: view.stage as RpcProbeStage,
      kind: view.kind,
      messageId: view.messageId ?? '',
      direction: view.direction as RpcProbeDirection,
      outcome: view.outcome as RpcProbeOutcome,
      hop: view.hop,
      route: view.route ? [...view.route] : [],
      rejection: view.rejection ?? ''
    }
  }

  /** Return a copy of rows recorded so far. */
  snapshot(): ITopologyProbeEvent[] {
    return [...this.#events]
  }
}
