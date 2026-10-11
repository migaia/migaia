import { createEndpoint } from '@migaia/rpc-core'
import { createStringFramer } from '@migaia/rpc-contract/framing'
import { defineJsonCodec } from '@migaia/serialize/codecs/json'
import { connect } from '@migaia/rpc-core'
import { timeout } from '@migaia/rpc-core'
import { uuid } from '@migaia/rpc-core'
import { ping } from '@migaia/rpc-core'
import { authentication } from '@migaia/rpc-core'
import { abort } from '@migaia/rpc-core'
import { contract } from '@migaia/rpc-core'
import type { IRpcContractConfig } from '@migaia/rpc-core'
import type { IRpcProvider } from '@migaia/rpc-core'
import type { IRpcEndpoint } from '@migaia/rpc-core'
import type { IRpcTransport } from '@migaia/rpc-core'

export const createRpc = <TDiscoveryMode extends 'automatic' | 'manual' = 'automatic'>(
  id: string,
  targetIds: readonly string[],
  transport: IRpcTransport,
  provider: Readonly<Record<string, IRpcProvider>> = {},
  identity?: {
    readonly uniqueTargetId: string
    readonly identifier?: (context: { readonly data?: unknown }) => boolean
  },
  fixedUuid?: string | (() => string),
  authenticated = false,
  contractConfig?: IRpcContractConfig,
  chunkConfig?: { readonly chunkSize?: number },
  discoveryMode: TDiscoveryMode = 'automatic' as TDiscoveryMode
): Promise<IRpcEndpoint<string, TDiscoveryMode, true>> =>
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
  }) as Promise<IRpcEndpoint<string, TDiscoveryMode, true>>

export const echoProvider: IRpcProvider = (context) => context.success(context.data)

/** Providers used by adapter terminal-state E2E scenarios. */
export const terminalProviders: Readonly<Record<string, IRpcProvider>> = {
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
