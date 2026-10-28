import { TrayErrorCode } from '../error-code.ts'
import { createTrayError } from '../errors.ts'
import type { ITrayInstance } from './typing.ts'

/** Compile-time identity cannot replace the runtime WeakMap authority. */
declare const trayRoutingPolicyBrand: unique symbol
/** Read-only policy identity; the synchronous pick callback stays module-private. */
export type ITrayRoutingPolicy<TName extends string = string> = Readonly<{
  /** Portable registration name; the synchronous picker itself stays in the parent realm. */
  name: TName
  /** Type-only marker; structural copies have no runtime policy authority. */
  [trayRoutingPolicyBrand]: true
}>
/** Parent-owned selection context; sequence counts earlier picks for one host/policy pair. */
export type ITrayRoutingContext = Readonly<{
  /** Definition name whose current ready admissions form the candidate set. */
  host: string
  /** Zero-based attempted-pick sequence for this registry's host/policy pair. */
  sequence: number
}>
/** Pure selection callback consumes only ready candidate snapshots and returns one id. */
export type ITrayRoutingPick = (
  candidates: readonly ITrayInstance[],
  context: ITrayRoutingContext
) => string
/** Trusted selection metadata is available only for identities authored by this module. */
const policies = new WeakMap<object, ITrayRoutingPick>()
/** 内置 policy 名称保留给 Tray 父端 routing registry 的常驻 policy。 */
export const TrayRoutingBuiltinName = {
  roundRobin: 'roundRobin',
  leastInFlight: 'leastInFlight'
} as const
/** Function/object members cannot become addressable members on the callable namespace. */
const reservedNames = new Set([
  ...Object.values(TrayRoutingBuiltinName),
  'name',
  'length',
  'prototype',
  'apply',
  'bind',
  'call',
  'caller',
  'arguments',
  'constructor',
  'toString',
  'valueOf',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString'
])

/**
 * Defines a frozen trusted policy without running pick. name must start with a lowercase letter,
 * contain only letters/digits afterwards, and avoid built-in/function member names. Invalid input
 * throws TRAY_ROUTING_INVALID synchronously. Register the identity on the parent and declare it in
 * child host routing tuples. At dispatch pick receives frozen ready candidates in spawn order and
 * must synchronously return one candidate id; failure never retries the call on another instance.
 */
export function defineRoutingPolicy<const TName extends string>(
  name: TName,
  pick: ITrayRoutingPick
): ITrayRoutingPolicy<TName> {
  if (
    typeof name !== 'string' ||
    !/^[a-z][A-Za-z0-9]*$/.test(name) ||
    reservedNames.has(name) ||
    typeof pick !== 'function'
  )
    throw createTrayError(TrayErrorCode.routingInvalid)
  return authorPolicy(name, pick)
}

/** One brand owner authors custom and reserved built-in identities without duplicating trust. */
function authorPolicy<const TName extends string>(
  name: TName,
  pick: ITrayRoutingPick
): ITrayRoutingPolicy<TName> {
  /** Frozen identity contains no callback or mutable registry state. */
  const policy = Object.freeze({ name }) as ITrayRoutingPolicy<TName>
  policies.set(policy, pick)
  return policy
}

/**
 * Built-in cyclic policy; callable/member routing forms share its host-local sequence without
 * registration.
 */
export const roundRobin = authorPolicy(
  TrayRoutingBuiltinName.roundRobin,
  (candidates, context) => candidates[context.sequence % candidates.length]!.id
)
/**
 * Built-in policy selecting the least pending business sends; ties retain spawn order, not CPU
 * load.
 */
export const leastInFlight = authorPolicy(
  TrayRoutingBuiltinName.leastInFlight,
  (candidates) =>
    candidates.reduce((best, candidate) => (candidate.inFlight < best.inFlight ? candidate : best))
      .id
)

/** Internal trust lookup rejects structural copies without reading their properties. */
export function readRoutingPolicy(value: unknown): ITrayRoutingPick | undefined {
  return policies.get(value as object)
}
