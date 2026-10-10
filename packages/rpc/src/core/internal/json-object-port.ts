import type {
  IRpcEnvelope,
  IRpcFramer,
  IRpcProtocol,
  IRpcSerializedError
} from '../../contract/index.js'
import type { ICodec } from '@migaia/serialize/codec'
import type { IRpcInboundMessage, IRpcSendOptions } from '../transport.js'
import type { IRpcSelectedComponents } from './endpoint-options.js'

/** One bridge-owned object port shares the public transport's routing and lifetime. */
export type IRpcJsonObjectPort = Readonly<{
  readonly protocol: IRpcProtocol<IRpcEnvelope, string, number>
  readonly publicCodec: object
  readonly publicFramer: object
  readonly codec: ICodec<IRpcEnvelope, unknown>
  readonly framer: IRpcFramer<unknown, unknown, string, number>
  /** Only the factory-held format operation can require complete original response errors. */
  readonly responseError?: (error: unknown) => IRpcSerializedError
  readonly send: (value: unknown, options?: IRpcSendOptions) => void | Promise<void>
  readonly subscribe: (listener: (message: IRpcInboundMessage) => void) => () => void
}>

/** Final transport identities retain no business payload and are revoked by bridge close. */
const ports = new WeakMap<object, IRpcJsonObjectPort>()
/** Canonical tokens optionally retain their paired descriptor; has() distinguishes unknown tokens. */
const middlewares = new WeakMap<object, object | undefined>()
/** Canonical Feature tokens are signed by their package-owned factories only. */
const features = new WeakSet<object>()
/** Only descriptors published by a paired bridge factory may contribute encoded domains. */
const descriptors = new WeakSet<object>()
/** Candidates retain original identity through the public descriptor snapshot phase. */
const candidates = new WeakMap<IRpcSelectedComponents, IRpcJsonObjectPort>()
/** Endpoint snapshots retain their chosen runtime port without changing public metadata. */
const selected = new WeakMap<IRpcSelectedComponents, IRpcJsonObjectPort>()

/** Registers the factory's final gated transport and returns its idempotent close disposer. */
export function registerJsonObjectPort(transport: object, port: IRpcJsonObjectPort): () => void {
  ports.set(transport, port)
  descriptors.add(port.protocol)
  descriptors.add(port.publicCodec)
  descriptors.add(port.publicFramer)
  return () => {
    if (ports.get(transport) === port) ports.delete(transport)
  }
}

/** Reads a candidate using exact identities before public descriptor snapshots are made. */
export function readJsonObjectPort(
  transport: object,
  protocol: unknown,
  codec: unknown,
  framer: unknown
): IRpcJsonObjectPort | undefined {
  const port = ports.get(transport)
  return port !== undefined &&
    port.protocol === protocol &&
    port.publicCodec === codec &&
    port.publicFramer === framer
    ? port
    : undefined
}

/** Signs one canonical middleware after its existing configuration reads have finished. */
export function registerJsonObjectMiddleware<T extends object>(middleware: T): T {
  middlewares.set(middleware, undefined)
  return middleware
}

/** Unknown middleware descriptors retain the complete public string path. */
export function isJsonObjectMiddleware(middleware: object): boolean {
  const descriptor = middlewares.get(middleware)
  return middlewares.has(middleware) && (descriptor === undefined || descriptors.has(descriptor))
}

/** Signs one first-party Feature without trusting public policy metadata. */
export function registerJsonObjectFeature<T extends object>(feature: T): T {
  features.add(feature)
  return feature
}

/** Unknown Feature definitions retain the complete public string path. */
export function isJsonObjectFeature(feature: object): boolean {
  return features.has(feature)
}

/** Commits a private port only after ordinary configuration and direction checks pass. */
export function selectJsonObjectPort(
  components: IRpcSelectedComponents,
  port: IRpcJsonObjectPort
): void {
  selected.set(components, port)
}

/** Sender and receiver share the endpoint's same once-selected runtime port. */
export function selectedJsonObjectPort(
  components: IRpcSelectedComponents
): IRpcJsonObjectPort | undefined {
  return selected.get(components)
}

/** Drops endpoint runtime references when the existing resource scope releases its receiver. */
export function releaseJsonObjectSelection(components: IRpcSelectedComponents): void {
  selected.delete(components)
  candidates.delete(components)
}

/** Keeps non-paired descriptor middleware on the original string path, including shadows. */
export function registerJsonObjectDescriptorMiddleware<T extends object>(
  middleware: T,
  descriptor: object
): T {
  middlewares.set(middleware, descriptor)
  return middleware
}

/** Retains a pre-snapshot candidate without enabling any runtime bypass. */
export function rememberJsonObjectCandidate(
  components: IRpcSelectedComponents,
  port: IRpcJsonObjectPort
): void {
  candidates.set(components, port)
}

/** Reads the candidate after every ordinary construction check has completed. */
export function jsonObjectCandidate(
  components: IRpcSelectedComponents
): IRpcJsonObjectPort | undefined {
  return candidates.get(components)
}

/** Stable label used by the existing endpoint resource scope to release private selection. */
export const JsonObjectSelectionResource = 'JSON object selection'

/** Reads exact factory proof without re-reading any caller-owned descriptor properties. */
export function readCanonicalMiddlewareProof(value: object): true | object | false {
  return middlewares.has(value) ? (middlewares.get(value) ?? true) : false
}
