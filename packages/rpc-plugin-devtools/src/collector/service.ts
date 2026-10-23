import { normalizePortable } from '@migaia/rpc-contract'
import { serializeRpcError } from '@migaia/rpc-contract/errors'
import type { IRpcContext } from '@migaia/rpc-host'
import { RpcDevtoolsErrorCode } from '../error-code.js'
import { RpcDevtoolsErrorText } from '../error-text.js'
import { identifyDevtoolsError } from '../errors.js'
import type { IRpcDevtools } from '../collector-types.js'
import type { IRpcDevtoolsQuery } from '../contract/service.js'
import type { IRpcDevtoolsRecord } from '../contract/record.js'
import type { IRuntimePeerProvide } from '@migaia/rpc-host/plugin'

/** Boundary callbacks reuse the collector's one lifecycle owner and independent record ring. */
export type ICollectorServiceOwner = Pick<
  IRpcDevtools,
  'describe' | 'stats' | 'record' | 'clear' | 'pause' | 'resume' | 'exportRecord'
> & {
  query(input?: IRpcDevtoolsQuery, content?: boolean): ReturnType<IRpcDevtools['query']>
  watch(
    input?: Omit<IRpcDevtoolsQuery, 'afterSeq' | 'limit'>,
    content?: boolean,
    signal?: IRpcContext['signal']
  ): ReturnType<IRpcDevtools['watch']>
  stopRecord(content: boolean): IRpcDevtoolsRecord
  /** The collector owns exclusion of actual service endpoint identities. */
  excludeEndpoint(endpointId: string): void
}

/** Service results become plain portable wire data only at the remote boundary. */
function portableResult<T>(value: T): T {
  try {
    /** JSON's representation removes undefined/functions and class prototypes without hot-path work. */
    const text = JSON.stringify(value, function (key, field: unknown): unknown {
      /** The original data slot preserves byte/Error identity before an optional toJSON conversion. */
      const original: unknown = Object.getOwnPropertyDescriptor(this, key)?.value ?? field
      if (original instanceof Error)
        return serializeRpcError(original, {
          /** A failed error projection becomes the service's visible coded conversion failure. */
          report: (failure) => {
            throw failure.error
          }
        })
      if (original instanceof Uint8Array) return normalizePortable(original)
      // A wire byte view changes representation while sharing the original backing.
      if (original instanceof ArrayBuffer) return normalizePortable(new Uint8Array(original))
      if (typeof field === 'bigint') return field.toString()
      return field
    })
    return JSON.parse(text) as T
  } catch (cause) {
    throw identifyDevtoolsError(
      new TypeError(RpcDevtoolsErrorText.serviceResultInvalid, { cause }),
      RpcDevtoolsErrorCode.serviceResultInvalid
    )
  }
}

/** A real service boundary enforces portable data, content exposure and actual self identity. */
export function createCollectorService(
  owner: ICollectorServiceOwner,
  exposeContent: boolean
): IRuntimePeerProvide {
  /**
   * Runtime providers append the original context; direct local service use has no serving
   * identity.
   */
  const identify = (context: IRpcContext | undefined): void => {
    if (context !== undefined) owner.excludeEndpoint(context.localEndpointId)
  }
  return {
    describe: (_input: unknown, context?: IRpcContext) => {
      identify(context)
      return portableResult(owner.describe())
    },
    query: (input?: IRpcDevtoolsQuery, context?: IRpcContext) => {
      identify(context)
      return portableResult(owner.query(input, exposeContent))
    },
    async *watch(input?: Omit<IRpcDevtoolsQuery, 'afterSeq' | 'limit'>, context?: IRpcContext) {
      identify(context)
      for await (const batch of owner.watch(input, exposeContent, context?.signal))
        yield portableResult(batch)
    },
    stats: (_input: unknown, context?: IRpcContext) => {
      identify(context)
      return portableResult(owner.stats())
    },
    record: {
      start: (input?: Readonly<{ maxEvents?: number }>, context?: IRpcContext) => {
        identify(context)
        owner.record(input)
      },
      stop: (_input: unknown, context?: IRpcContext) => {
        identify(context)
        return owner.exportRecord(owner.stopRecord(exposeContent))
      }
    },
    clear: (_input: unknown, context?: IRpcContext) => {
      identify(context)
      owner.clear()
    },
    pause: (_input: unknown, context?: IRpcContext) => {
      identify(context)
      owner.pause()
    },
    resume: (_input: unknown, context?: IRpcContext) => {
      identify(context)
      owner.resume()
    }
  }
}
