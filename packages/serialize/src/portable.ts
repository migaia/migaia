/** Portable public contracts and default instances; policy and traversal have separate owners. */
import { isUint8Array } from '@migaia/utils/bytes'
import { bytesToBase64url, isCanonicalBase64url } from './base64.ts'
import type { ICodecValue } from './codec.ts'
import { PortableWalker } from './portable-walker.ts'
import {
  projectionStrategy,
  assertionStrategy,
  codecStrategy,
  collectionsStrategy,
  restoreCollectionsStrategy
} from './portable-strategies.ts'

/** Factory tools keep binary detection and canonical base64url in the codec owner. */
type IPortableWalkerContext = Readonly<{
  /** Rejects through the strategy's violation policy while preserving the supplied cause. */
  reject: (reason: string, cause?: unknown) => never
  /** Checks only the current invocation's ancestor path, not previously completed sibling values. */
  isAncestor: (value: object) => boolean
  /** Canonical byte-brand check available to the caller's binary admission. */
  isUint8Array: typeof isUint8Array
  /** Produces an unpadded base64url spelling for a strategy choosing inline bytes. */
  bytesToBase64url: typeof bytesToBase64url
  /** Tests the full canonical unpadded spelling, including unused tail bits. */
  isCanonicalBase64url: typeof isCanonicalBase64url
  /** Invocation-owned rejection guard, absent when native binary needs no extra admission. */
  beforeNativeBinary?: () => never
}>

/**
 * Binary outcomes are unboxed: inline text or borrowed native storage, with no descriptor
 * allocation.
 */
export type IPortableBinaryResult = string | Uint8Array | ArrayBuffer

/** Returning a primitive directly avoids a transient scalar admission object on hot paths. */
type IPortablePrimitive = null | string | boolean | number

/** A deferred violation lets projection finish before legacy validation chooses its failure. */
type IPortableScalar = Readonly<{ value: unknown; violation?: string }>

/** Record admission supplies captured or lazy entries; an omitted output means validation only. */
type IPortableRecord = Readonly<{
  entries: Iterable<readonly [string, unknown]>
  output?: Record<string, unknown>
  tag?: string
  hasBinary?: boolean
  validate?: (output: Record<string, unknown>) => string | undefined
}>

/** Explicit lexical ownership lets a caller retain a visitor without observing another array frame. */
type IPortableOwnedVisit = (
  value: unknown,
  depth: number,
  ancestors: Set<object>,
  guard: (() => never) | undefined,
  bounds: boolean
) => unknown

/**
 * Policy owned by the caller, resolved once at factory creation. Hooks never recurse themselves.
 * Scalar/array/record validation may return a deferred violation to preserve projection failure
 * priority; immediate violations call context.reject. The violation hook throws the caller's own
 * coded native error and retains the supplied original failure on cause.
 */
export type IPortableWalkerStrategy = Readonly<{
  /** Maximum root-zero traversal depth; defaults to Infinity, otherwise a nonnegative safe integer. */
  maxDepth?: number
  /**
   * Projects primitives or returns a value with a deferred violation; called before container
   * admission.
   */
  scalar: (value: unknown, context: IPortableWalkerContext) => IPortableScalar | IPortablePrimitive
  /**
   * Supplies record entries and optional output/tag policy; undefined selects the array hook. An
   * omitted record output validates in place, while a supplied output receives projected fields.
   */
  record: (value: object, context: IPortableWalkerContext) => IPortableRecord | undefined
  /** Optional per-field admission before visiting a record child; defaults to accepting every key. */
  key?: (key: string, context: IPortableWalkerContext) => void
  /** Output field writer; defaults to defining a writable own enumerable data property. */
  write?: (output: Record<string, unknown>, key: string, child: unknown) => void
  /**
   * Optional final projection, default identity; the boolean proves native rather than inline
   * binary descendants.
   */
  finish?: (value: unknown, hasNativeBinary: boolean) => unknown
  /** Required error owner; must throw the caller's failure and retain an explicitly supplied cause. */
  violation: (reason: string, cause?: unknown) => never
}> &
  (
    | Readonly<{
        /**
         * Optional array projector, default map; use visit for children instead of recursing in the
         * strategy.
         */
        array?: (
          value: unknown[],
          visit: (child: unknown) => unknown,
          context: IPortableWalkerContext
        ) => unknown[] | Readonly<{ value: unknown[]; length?: number; violation?: string }>
        /** Mutually exclusive with the ordinary array hook. */
        arrayValue?: never
      }>
    | Readonly<{
        /** Mutually exclusive with the raw arrayValue hook. */
        array?: never
        /**
         * Raw array projection with explicit visitor ownership; it replaces the ordinary array
         * hook.
         */
        arrayValue: (
          value: unknown[],
          visit: IPortableOwnedVisit,
          childDepth: number,
          ancestors: Set<object>,
          guard: (() => never) | undefined,
          bounds: boolean,
          context: IPortableWalkerContext
        ) => unknown
      }>
  ) &
  (
    | Readonly<{
        /**
         * Returns inline base64url text for binary input, or undefined to continue container
         * admission.
         */
        binary: (value: object, context: IPortableWalkerContext) => string | undefined
        /** Native storage cannot be returned without its intrinsic length reader. */
        nativeByteLength?: never
      }>
    | Readonly<{
        /**
         * Returns inline text or borrowed native storage, retaining native identity; undefined
         * selects containers.
         */
        binary: (
          value: object,
          context: IPortableWalkerContext
        ) => IPortableBinaryResult | undefined
        /** Read the admitted native object's length through its owner's intrinsic slot accessor. */
        nativeByteLength: (value: Uint8Array | ArrayBuffer) => number
      }>
  )

/**
 * Callable projection returning a frozen metadata record: value, conservative byteUpperBound, and
 * hasBinary for inline or native bytes. Optional active ancestors are caller-owned, initialDepth
 * defaults to zero, and a per-call native guard is exposed to strategy admission. The value method
 * uses the same traversal without allocating metadata; payload freezing belongs to the strategy.
 */
type IPortableWalker = {
  (
    value: unknown,
    active?: Set<object>,
    initialDepth?: number,
    beforeNativeBinary?: () => never
  ): Readonly<{ value: unknown; byteUpperBound: number; hasBinary: boolean }>
  value: (
    value: unknown,
    active?: Set<object>,
    initialDepth?: number,
    beforeNativeBinary?: () => never
  ) => unknown
}

/**
 * Create one specialized synchronous walker. Policy callbacks and context are bound once. Node
 * accounting stays in primitive invocation slots instead of allocating a result/context per node.
 * Nested calls save/restore the slots in finally; no caller graph survives a completed invocation.
 * Returns both a metadata-producing callable and its value-only method. The strategy owns shape,
 * prototype, binary, and error policies; this factory does not impose a single portable profile.
 */
export function createPortableWalker(strategy: IPortableWalkerStrategy): IPortableWalker {
  return new PortableWalker(strategy).result
}

/** Module-level default instances capture policy once; callers allocate only invocation state. */
const projectPortable = /* @__PURE__ */ createPortableWalker(projectionStrategy)
/** Standalone assertion retains caller identity and the historical validation policy. */
const validatePortable = /* @__PURE__ */ createPortableWalker(assertionStrategy)
/** Format codecs share the single fused default instance. */
const normalizeCodecPortable = /* @__PURE__ */ createPortableWalker(codecStrategy)
/** Collection encoding shares the ordinary scalar, record, array, and bytes policies. */
const projectCollections = /* @__PURE__ */ createPortableWalker(collectionsStrategy)
/** Restoration adds collection construction after the same recursive admission. */
const restoreCollections = /* @__PURE__ */ createPortableWalker(restoreCollectionsStrategy)

/**
 * Validates the decoded portable profile in place without cloning or freezing. Finite primitives,
 * arrays, ordinary/null-prototype records, and legacy bytes tags are accepted; unsupported values
 * or cycles throw INVALID_OPTION. Getters are observed, and access failures may pass through for an
 * enclosing codec to normalize. Optional active supplies an existing ancestor set, initially
 * empty.
 */
export function assertPortableValue(value: unknown, active = new Set<object>()): void {
  validatePortable.value(value, active)
}

/**
 * Validates using assertPortableValue and returns the exact original value as ICodecValue; byte
 * tags remain records.
 */
export function asCodecValue(value: unknown): ICodecValue {
  assertPortableValue(value)
  return value as ICodecValue
}

/**
 * Builds the legacy mutable projection: record keys are visited in sorted order and Uint8Array
 * becomes a bytes-tag record. Getters run, repeated sibling references are copied separately, and
 * cycles or unsupported binary containers reject. This intermediate projection may still contain
 * values outside ICodecValue; use asCodecValue or a format codec for final portable validation.
 */
export function toPortableValue(value: unknown, active = new Set<object>()): unknown {
  return projectPortable.value(value, active)
}

/** Fused format projection preserves property enumeration order without comparison sorting. */
export function toCodecPortableValue(value: unknown): ICodecValue {
  return normalizeCodecPortable.value(value) as ICodecValue
}

/** Package-internal collection projection reuses the portable walker and reserved-field owner. */
export function toCollectionsPortableValue(value: unknown): ICodecValue {
  return projectCollections.value(value) as ICodecValue
}

/** Package-internal restoration retains bytes records while restoring nested Map and Set values. */
export function fromCollectionsPortableValue(value: unknown): unknown {
  return restoreCollections.value(value)
}
