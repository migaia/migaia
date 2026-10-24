import { createTrayError } from '../errors.js'
import { TrayErrorCode } from '../error-code.js'
import { TrayInstanceState } from './constants.js'
import {
  roundRobin,
  leastInFlight,
  readRoutingPolicy,
  type ITrayRoutingPolicy
} from './routing-policy.js'
import type { ITrayRegistry, ITrayRecord } from './parent/registry.js'
import type { IAnyTrayHost, ITrayRouting, ITrayRoutedRemote } from './typing.js'

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
  /** Pick one current ready admission; business calls never retry or migrate. */
  pick = (host: string, name: string): ITrayRecord => {
    const policy = this.#policies.get(name)
    if (!policy) throw createTrayError(TrayErrorCode.routingUnknown)
    /** Map insertion order is the admission's spawn order. */
    const candidates: ITrayRecord[] = []
    for (const record of this.#registry.records.values())
      if (
        record.definition.name === host &&
        record.state === TrayInstanceState.ready &&
        !record.removed
      )
        candidates.push(record)
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
    const selected = candidates.find((record) => record.id === id)
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
  /** The closed registration set is checked for both member and callable forms. */
  const allowed = new Set<string>(names)
  /** Arrow shape has callable arity two and no mutable receiver dependency. */
  const routing = (name: string, host: IAnyTrayHost) => {
    if (!allowed.has(name)) throw createTrayError(TrayErrorCode.routingUnknown)
    return route(name, host)
  }
  for (const name of allowed)
    Object.defineProperty(routing, name, {
      value: (host: IAnyTrayHost) => routing(name, host),
      enumerable: true
    })
  return Object.freeze(routing) as ITrayRouting<TNames, THosts>
}
