import { createRuntimeApiEndpoint } from '../../../dist/core/internal/runtime-api-endpoint.js'
import {
  codec,
  framer,
  connect,
  abort,
  timeout,
  hooks,
  authentication,
  RpcAuthenticationError,
  type IRpcEndpoint
} from '../../../dist/core/index.js'
import { RpcMiddlewareErrorText } from '../../../dist/core/middleware/error-text.js'
import type { IRemoteChannel } from '../../../dist/remote/types.js'
import fixture from './managed-binary-key.json'

/** A genuine runtime key is imported lazily after the original Worker listener is installed. */
let key: Promise<CryptoKey> | undefined

/** Actual WebCrypto signs the original protected envelope; no fixture replay or codec exists. */
function signingKey(): Promise<CryptoKey> {
  return (key ??= crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(fixture.key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  ))
}

/** Compose only the same built canonical roots on both actual Web/Bun native sides. */
export async function webBinaryEndpoint(
  channel: IRemoteChannel,
  id: string,
  report: (error: unknown) => void
) {
  /** The real auth configuration supplies primitives to the original per-frame owner. */
  const endpoint = await createRuntimeApiEndpoint(
    {
      id,
      scheduler: channel.scheduler,
      transport: channel.transport,
      targetIds: [channel.peerId],
      middlewares: [
        codec(channel.pipeline.codec),
        framer(channel.pipeline.framer),
        connect({ transport: channel.transport }),
        abort(),
        timeout(),
        hooks({ onHookError: report }),
        authentication({
          sign: async (body) => ({
            body,
            signature: [
              ...new Uint8Array(
                await crypto.subtle.sign(
                  'HMAC',
                  await signingKey(),
                  new TextEncoder().encode(JSON.stringify(body))
                )
              )
            ]
          }),
          verify: async (value) => {
            const signed = value as { body: unknown; signature: number[] }
            if (
              !(await crypto.subtle.verify(
                'HMAC',
                await signingKey(),
                new Uint8Array(signed.signature),
                new TextEncoder().encode(JSON.stringify(signed.body))
              ))
            )
              throw new RpcAuthenticationError(
                RpcMiddlewareErrorText.inboundFrameAuthenticationFailed
              )
            return signed.body
          }
        })
      ]
    },
    { supports: () => true },
    true
  )
  return {
    endpoint: endpoint as unknown as IRpcEndpoint,
    oneWay: endpoint,
    stream: endpoint.stream
  }
}
