import { RpcCapability } from '@migaia/rpc-contract'
import { createRuntimeEndpointComposition } from '../../../../rpc-host/dist/core/runtime-api-endpoint.js'
import { createStringFramer } from '@migaia/rpc-contract/framing'
import { defineJsonCodec } from '@migaia/serialize/codecs/json'
import { connect } from '../../../../rpc-host/dist/core/middleware/connect.js'
import { timeout } from '../../../../rpc-host/dist/core/middleware/timeout.js'
import { uuid } from '../../../../rpc-host/test/fixtures/core-role/uuid.js'
import { ping } from '../../../../rpc-host/dist/core/middleware/ping.js'
import { authentication } from '../../../../rpc-host/dist/core/middleware/authentication.js'
import { abort } from '../../../../rpc-host/dist/core/middleware/abort.js'
import { contract } from '../../../../rpc-host/test/fixtures/core-role/contract.js'
import type { IRpcContractConfig } from '../../../../rpc-host/dist/core/typing.js'
import type { IRpcProvider } from '../../../../rpc-host/dist/core/typing.js'
import type { IRpcEndpoint } from '../../../../rpc-host/dist/core/typing.js'
import type { IRpcTransport } from '../../../../rpc-host/dist/core/transport.js'

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
  createRuntimeEndpointComposition(
    {
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
    },
    { peerId: targetIds[0] ?? id, agreement: { capabilities: [RpcCapability.ping] } }
  ).installing as Promise<IRpcEndpoint<string, TDiscoveryMode, true>>

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
