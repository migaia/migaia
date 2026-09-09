import { createEndpoint } from '../../src/index'
import { createStringFramer } from '@migaia/rpc-contract/framing'
import { defineJsonCodec } from '@migaia/serialize/codecs/json'
import { connect } from '../../src/middleware/connect'
import { timeout } from '../../src/middleware/timeout'
import { uuid } from '../../src/middleware/uuid'
import { ping } from '../../src/middleware/ping'
import { authentication } from '../../src/middleware/authentication'
import { abort } from '../../src/middleware/abort'
import { contract } from '../../src/middleware/contract'
import type { IWebRpcContractConfig } from '../../src/typing'
import type { IWebRpcProvider } from '../../src/typing'
import type { IWebRpcEndpoint } from '../../src/typing'
import type { IWebRpcTransport } from '../../src/transport'

export const createRpc = <TDiscoveryMode extends 'automatic' | 'manual' = 'automatic'>(
  id: string,
  targetIds: readonly string[],
  transport: IWebRpcTransport,
  provider: Readonly<Record<string, IWebRpcProvider>> = {},
  identity?: {
    readonly uniqueTargetId: string
    readonly identifier?: (context: { readonly data?: unknown }) => boolean
  },
  fixedUuid?: string | (() => string),
  authenticated = false,
  contractConfig?: IWebRpcContractConfig,
  chunkConfig?: { readonly chunkSize?: number },
  discoveryMode: TDiscoveryMode = 'automatic' as TDiscoveryMode
): Promise<IWebRpcEndpoint<string, TDiscoveryMode, true>> =>
  createEndpoint({
    id,
    targetIds,
    provider,
    ...(chunkConfig?.chunkSize === undefined
      ? {}
      : {
          codec: defineJsonCodec({ version: 1 }),
          framer: createStringFramer({ chunkBytes: chunkConfig.chunkSize })
        }),
    middlewares: [
      connect({
        transport,
        discoveryMode,
        ...(identity
          ? {
              useBaseIdVerifyOnly: false,
              uniqueTargetId: identity.uniqueTargetId,
              identifier: identity.identifier ?? (() => true)
            }
          : {})
      }),
      ...(authenticated
        ? [
            authentication({
              sign: (value) => ({ value, signature: 'trusted' }),
              verify: (value) => {
                const candidate = value as { signature?: unknown; value?: unknown }
                if (candidate.signature !== 'trusted') throw new Error('invalid signature')
                return candidate.value
              }
            })
          ]
        : []),
      timeout({ timeoutMs: 2_000 }),
      abort(),
      ping(),
      ...(contractConfig === undefined ? [] : [contract(contractConfig)]),
      ...(fixedUuid === undefined
        ? []
        : [uuid({ generate: typeof fixedUuid === 'function' ? fixedUuid : () => fixedUuid })])
    ]
  }) as Promise<IWebRpcEndpoint<string, TDiscoveryMode, true>>

export const echoProvider: IWebRpcProvider = (context) => context.success(context.data)

/** Providers used by adapter terminal-state E2E scenarios. */
export const terminalProviders: Readonly<Record<string, IWebRpcProvider>> = {
  echo: echoProvider,
  fail: (context) => context.failed('remote failure', 'REMOTE_FAILURE'),
  hang: async () => await new Promise<never>(() => undefined)
}

export const installErrorGuards = (): string[] => {
  const errors: string[] = []
  globalThis.addEventListener('error', (event) => errors.push(String(event.error ?? event.message)))
  globalThis.addEventListener('unhandledrejection', (event) => errors.push(String(event.reason)))
  return errors
}
