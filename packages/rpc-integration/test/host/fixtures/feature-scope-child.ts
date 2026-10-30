import { rpcFeaturesPlugin } from '@migaia/rpc-host/sdk'
/** Children use the actual native source and the same canonical authentication Feature. */
import { createRpcHost } from '@migaia/rpc-host'
import { authFeature } from '@migaia/rpc-host/plugins/auth'
import type { IRpcTransportPlugin } from '@migaia/rpc-host/sdk'
import { RpcError } from '@migaia/rpc-contract/errors'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import type { IRpcFlowContext } from '@migaia/rpc-contract/interfaces'

/** Fixed fixture values distinguish actual Process and Thread capability selection. */
export const FeatureScopeFixture = {
  hostKey: 'a25-key-A',
  processKey: 'a25-key-B',
  marker: 'a25-scope-probe',
  signatureInvalid: 'fixture signature belongs to another flow scope'
} as const

/** The real transform proves key selection without retaining payloads or adding a diagnostic path. */
export function featureScopeAuth(
  key: string,
  signed?: (value: string, context: IRpcFlowContext) => void
) {
  return authFeature({
    encodedType: 'string',
    sign: (value, context) => {
      /** The configured representation supplies strings before this actual transform runs. */
      const plaintext = String(value)
      signed?.(plaintext, context)
      return `${key}:${plaintext}`
    },
    verify: (value) => {
      /** A wrong Host/default key cannot pass the child's actual verifier. */
      const prefix = `${key}:`
      if (typeof value !== 'string' || !value.startsWith(prefix))
        throw new RpcError(
          RpcCoreErrorCode.authenticationFailed,
          FeatureScopeFixture.signatureInvalid
        )
      return value.slice(prefix.length)
    }
  })
}

/** Only the public Host constructs the provider and its actual parent connection. */
export async function runFeatureScopeChild(
  plugin: IRpcTransportPlugin<'native', object, true>,
  key: string
): Promise<void> {
  await createRpcHost({
    plugins: [
      rpcFeaturesPlugin({ features: { feature1: featureScopeAuth(key) } }),
      plugin
    ] as const,
    provide: { echo: (value: unknown) => value },
    report: () => undefined
  })
}
