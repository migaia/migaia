import { TrayErrorCode } from '../error-code.js'
import { createTrayError } from '../errors.js'
import type { ITrayInstance } from './typing.js'

/** Compile-time identity cannot replace the runtime WeakMap authority. */
declare const trayRoutingPolicyBrand: unique symbol
/** Read-only policy identity; the synchronous pick callback stays module-private. */
export type ITrayRoutingPolicy<TName extends string = string> = Readonly<{
  name: TName
  [trayRoutingPolicyBrand]: true
}>
/** Parent-owned selection context; sequence counts earlier picks for one host/policy pair. */
export type ITrayRoutingContext = Readonly<{ host: string; sequence: number }>
/** Pure selection callback consumes only ready candidate snapshots and returns one id. */
export type ITrayRoutingPick = (
  candidates: readonly ITrayInstance[],
  context: ITrayRoutingContext
) => string
/** Trusted selection metadata is available only for identities authored by this module. */
const policies = new WeakMap<object, ITrayRoutingPick>()
/** Built-in names are reserved for the mesh owner's always-available policies. */
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

/** Defines a named policy without invoking pick; invalid names or callbacks reject synchronously. */
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
  /** Frozen identity contains no callback or mutable registry state. */
  const policy = Object.freeze({ name }) as ITrayRoutingPolicy<TName>
  policies.set(policy, pick)
  return policy
}

/** Internal trust lookup rejects structural copies without reading their properties. */
export function readRoutingPolicy(value: unknown): ITrayRoutingPick | undefined {
  return policies.get(value as object)
}
