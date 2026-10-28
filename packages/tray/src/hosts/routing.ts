/**
 * Admit routing policies and select from one current candidate snapshot; registry owns instance
 * lifetime.
 */
import { createTrayError } from '../errors.ts'
import { TrayErrorCode } from '../error-code.ts'
import { TrayInstanceState } from './constants.ts'
import {
  roundRobin,
  leastInFlight,
  readRoutingPolicy,
  type ITrayRoutingPolicy
} from './routing-policy.ts'
import type { ITrayRegistry, ITrayRecord } from './parent/registry.ts'
import type { IAnyTrayHost, ITrayRouting, ITrayRoutedRemote } from './typing.ts'

/** Shared built-ins are authored by the same policy WeakMap as custom identities. */
export const builtInRouting: readonly [
  ITrayRoutingPolicy<'roundRobin'>,
  ITrayRoutingPolicy<'leastInFlight'>
] = Object.freeze([roundRobin, leastInFlight])

/** Capture the union of registered tuples; duplicate identities may repeat, duplicate names may not. */
export function createRoutingRegistry(
  hosts: readonly IAnyTrayHost[],
  declared: readonly ITrayRoutingPolicy[],
  registry: ITrayRegistry
) {
  return new RoutingRegistry(hosts, declared, registry)
}
/** Owns policy authority and per-host cursors; candidate membership remains registry-owned. */
class RoutingRegistry {
  /** Branded identity is checked before any policy can participate in routing. */
  readonly #policies = new Map<string, ITrayRoutingPolicy>()
  /** Pick attempts count independently for each host/policy pair. */
  readonly #sequences = new Map<string, Map<string, number>>()
  /** Ready candidates are read from the current admission owner on every pick. */
  readonly #registry: ITrayRegistry
  /** Frozen names define both callable namespace forms without exposing policy callbacks. */
  readonly names: readonly string[]
  /** Capture all declared policies in original order and reject duplicate authority. */
  constructor(
    hosts: readonly IAnyTrayHost[],
    declared: readonly ITrayRoutingPolicy[],
    registry: ITrayRegistry
  ) {
    this.#registry = registry
    for (const policy of [
      ...builtInRouting,
      ...declared,
      ...hosts.flatMap((host) => host.routing ?? [])
    ]) {
      if (
        !readRoutingPolicy(policy) ||
        (this.#policies.has(policy.name) && this.#policies.get(policy.name) !== policy)
      )
        throw createTrayError(TrayErrorCode.routingInvalid)
      this.#policies.set(policy.name, policy)
    }
    this.names = Object.freeze([...this.#policies.keys()])
  }
  /**
   * Pick one current ready admission; business calls never retry or migrate. The policy contract
   * receives every ready candidate in the target host, requiring one O(h) snapshot pass over that
   * host's admissions rather than all registry records; returned id lookup remains O(1).
   */
  pick = (host: string, name: string): ITrayRecord => {
    const policy = this.#policies.get(name)
    if (!policy) throw createTrayError(TrayErrorCode.routingUnknown)
    /** Map insertion order is the admission's spawn order. */
    const candidates: ITrayRecord[] = []
    /** Index only this snapshot so policy reentrancy cannot admit a later same-id replacement. */
    const candidateIds = new Map<string, ITrayRecord>()
    for (const record of this.#registry.recordsForHost(host))
      if (record.state === TrayInstanceState.ready && !record.removed) {
        candidates.push(record)
        candidateIds.set(record.id, record)
      }
    if (!candidates.length) throw createTrayError(TrayErrorCode.hostUnavailable)
    /** Sequence state belongs to this registry and one host name. */
    let hostSequences = this.#sequences.get(host)
    if (!hostSequences) {
      hostSequences = new Map()
      this.#sequences.set(host, hostSequences)
    }
    /** Increment before invoking the user callback so every attempted pick is counted. */
    const sequence = hostSequences.get(name) ?? 0
    hostSequences.set(name, sequence + 1)
    /** Candidate snapshots cannot mutate registry metadata. */
    let id: string
    try {
      id = readRoutingPolicy(policy)!(
        Object.freeze(candidates.map(this.#registry.snapshot)),
        Object.freeze({ host, sequence })
      )
    } catch (error) {
      throw createTrayError(TrayErrorCode.routingInvalid, error)
    }
    const selected = candidateIds.get(id)
    if (!selected) throw createTrayError(TrayErrorCode.routingInvalid)
    return selected
  }
}

/** Build one frozen arrow function with exact own members; unknown names never manufacture routes. */
export function createRoutingNamespace<
  TNames extends string,
  THosts extends readonly IAnyTrayHost[]
>(
  names: readonly TNames[],
  route: (name: string, host: IAnyTrayHost) => ITrayRoutedRemote<IAnyTrayHost>
): ITrayRouting<TNames, THosts> {
  return new RoutingNamespace(names, route).routing as ITrayRouting<TNames, THosts>
}

/** Own callable routing authority while preserving its frozen arrow shape and exact own members. */
class RoutingNamespace {
  /** Both member and callable forms validate the same closed name registration set. */
  readonly #allowed: ReadonlySet<string>
  /** Parent or child owner performs the original routing work after name admission. */
  readonly #route: (name: string, host: IAnyTrayHost) => ITrayRoutedRemote<IAnyTrayHost>
  /** Arrow keeps arity two, no prototype, and its original receiver-independent behavior. */
  readonly routing = (name: string, host: IAnyTrayHost) => {
    if (!this.#allowed.has(name)) throw createTrayError(TrayErrorCode.routingUnknown)
    return this.#route(name, host)
  }

  /** Install one own arity-one member per admitted name before freezing the original callable. */
  constructor(
    names: readonly string[],
    route: (name: string, host: IAnyTrayHost) => ITrayRoutedRemote<IAnyTrayHost>
  ) {
    this.#allowed = new Set(names)
    this.#route = route
    for (const name of this.#allowed)
      Object.defineProperty(this.routing, name, {
        value: (host: IAnyTrayHost) => this.routing(name, host),
        enumerable: true
      })
    Object.freeze(this.routing)
  }
}
