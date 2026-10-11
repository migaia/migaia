import { identityCodecV1 } from '@migaia/serialize/codec'
import { rpcProtocolV1 } from '@migaia/rpc-contract'
import { messageFramerV1 } from '@migaia/rpc-contract/framing'
import { readCanonicalMiddlewareProof } from './json-object-port.js'
import { RpcFastMiddlewareNames } from './plugin-shared-keys.js'
import type { IRpcEndpointOptions, IRpcSelectedComponents } from './endpoint-options.js'
import type { IEndpointMiddlewareSnapshot } from './endpoint-bootstrap.js'

/** Only foundational factory identities authorize omission of generic encode/framing fanout. */
const codecs = new WeakMap<object, ((value: unknown) => unknown) | undefined>([
  [identityCodecV1, identityCodecV1.decode]
])
/** Arbitrary frozen descriptors with matching metadata remain on the complete frame path. */
const framers = new WeakSet<object>([messageFramerV1])
/** Codec provenance stays separate from permission to omit protocol/framer fanout. */
type IFastComponentProof = Readonly<{
  fast: boolean
  decode: ((value: unknown) => unknown) | undefined
}>
/** Proof transfers from original identities to the single immutable component snapshot. */
const components = new WeakMap<object, IFastComponentProof>()
/** Actual native encoder resources belong to canonical codec identities, never metadata flags. */
const inlineEncoders = new WeakMap<object, (bytes: Uint8Array) => string>()
/** Final component admission retains the encoder held by its exact original codec owner. */
const componentInlineEncoders = new WeakMap<object, (bytes: Uint8Array) => string>()
/** Proof belongs to final endpoint options; public configuration never carries a trust flag. */
const endpoints = new WeakSet<object>()

/** Registers the exact foundational codec without adding a public option or descriptor property. */
export function registerFastCodec<T extends object>(
  codec: T,
  inlineEncoder?: (bytes: Uint8Array) => string,
  decodedMetadata?: (value: unknown) => unknown
): T {
  codecs.set(codec, decodedMetadata ?? codecs.get(codec))
  if (inlineEncoder) inlineEncoders.set(codec, inlineEncoder)
  return codec
}

/** Registers one canonical whole-frame identity before the ordinary snapshot copies it. */
export function registerFastFramer<T extends object>(framer: T): T {
  framers.add(framer)
  return framer
}

/** Admits a selected snapshot only after all original component identities are canonical. */
export function proveFastComponents(
  snapshot: IRpcSelectedComponents,
  protocol: unknown,
  codec: unknown,
  framer: unknown
): void {
  if (typeof codec === 'object' && codec !== null && codecs.has(codec)) {
    /** A JSON decoder creates data even when a custom protocol/framer must keep full processing. */
    const fast =
      protocol === rpcProtocolV1 &&
      typeof framer === 'object' &&
      framer !== null &&
      framers.has(framer)
    components.set(snapshot, { fast, decode: codecs.get(codec) })
    /** An absent resource retains the existing pure encoder rather than inventing a host claim. */
    const encoder = inlineEncoders.get(codec)
    if (fast && encoder) componentInlineEncoders.set(snapshot, encoder)
  }
}

/** Finalizes eligibility after ordinary validation; unknown/custom/authenticated paths stay full. */
export function proveFastEndpoint(
  options: IRpcEndpointOptions<string>,
  snapshot: IRpcSelectedComponents,
  middlewares: readonly IEndpointMiddlewareSnapshot[],
  firstPartyFeatures: boolean,
  customScheduler: boolean
): void {
  if (
    customScheduler ||
    !firstPartyFeatures ||
    !hasFastComponents(snapshot) ||
    options.authentication ||
    options.uuid?.generate ||
    options.contract ||
    options.hooks ||
    options.idempotency
  )
    return
  if (
    !middlewares.every((middleware) => {
      if (middleware.kind !== 'legacy' || !RpcFastMiddlewareNames.has(middleware.name)) return false
      /** Proof was transferred while bootstrap read and copied this descriptor once. */
      const proof = readCanonicalMiddlewareProof(middleware.plugin)
      return (
        proof === true ||
        (typeof proof === 'object' &&
          (codecs.has(proof) || framers.has(proof) || proof === rpcProtocolV1))
      )
    })
  )
    return
  endpoints.add(options)
}

/** Runtime branch selection reads only the package's finalized weak identity proof. */
export function hasFastEndpoint(options: object): boolean {
  return endpoints.has(options)
}

/** Batch grouping reuses component provenance even when authentication requires the full path. */
export function hasFastComponents(snapshot: object): boolean {
  return components.get(snapshot)?.fast === true
}

/**
 * The selected original decoder proves JSON data by construction. Identity decoding requires the
 * receive owner to hold the actual native clone carrier and exclude live authentication transforms.
 * Descriptor labels, copied methods and caller options cannot transfer either factory proof.
 */
export function hasDecodedRuntimeMetadata(snapshot: object, cloned: boolean): boolean {
  /** The held operation came from the canonical codec factory before descriptor snapshots. */
  const proof = components.get(snapshot)
  /** Identity cannot sanitize a custom framer's live result, even after a native clone boundary. */
  const decode = proof?.decode
  return (
    decode !== undefined && (decode !== identityCodecV1.decode || (cloned && proof?.fast === true))
  )
}

/** Read only the actual encoder retained during canonical component admission. */
export function readFastInlineEncoder(
  snapshot: object
): ((bytes: Uint8Array) => string) | undefined {
  return componentInlineEncoders.get(snapshot)
}
