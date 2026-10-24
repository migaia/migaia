/**
 * Fixture emit of maintained fixtures/web-binary-endpoint.ts for runtimes requiring concrete
 * .js/.mjs specifiers; production is unchanged.
 */
import { createRuntimeApiEndpoint } from '../../../../rpc-host/dist/core/runtime-api-endpoint.js'
import { codec } from '../../../../rpc-host/dist/core/middleware/codec.js'
import { framer } from '../../../../rpc-host/dist/core/middleware/framer.js'
import { connect } from '../../../../rpc-host/dist/core/middleware/connect.js'
import { abort } from '../../../../rpc-host/dist/core/middleware/abort.js'
import { timeout } from '../../../../rpc-host/dist/core/middleware/timeout.js'
import { hooks } from '../../../../rpc-host/dist/core/middleware/hooks.js'
import { authentication } from '../../../../rpc-host/dist/core/middleware/authentication.js'
import { attachErrorIdentity } from '@migaia/utils/error'
import fixture from './managed-binary-key.json' with { type: 'json' }
/** This fixture's verifier owns its failure; production authentication supplies Core's wrapper. */
const VERIFIER_SOURCE = '@example/web-binary-verifier'
/** Failed HMAC verification is local adapter diagnosis, not Core operation identity. */
const VerifierErrorCode = { signatureInvalid: 'SIGNATURE_INVALID' }
/** Fixture presentation preserves its earlier wording without publishing a message contract. */
const VerifierErrorText = { signatureInvalid: 'Inbound frame authentication failed' }
/** A genuine runtime key is imported lazily after the original Worker listener is installed. */
let key
/** Actual WebCrypto signs the original protected envelope; no fixture replay or codec exists. */
function signingKey() {
  return (key ??= crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(fixture.key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  ))
}
/** Compose only the same built canonical roots on both actual Web/Bun native sides. */
export async function webBinaryEndpoint(channel, id, report) {
  /** The real auth configuration supplies primitives to the original per-frame owner. */
  const endpoint = createRuntimeApiEndpoint(
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
            const signed = value
            if (
              !(await crypto.subtle.verify(
                'HMAC',
                await signingKey(),
                new Uint8Array(signed.signature),
                new TextEncoder().encode(JSON.stringify(signed.body))
              ))
            )
              throw attachErrorIdentity(new Error(VerifierErrorText.signatureInvalid), {
                source: VERIFIER_SOURCE,
                code: VerifierErrorCode.signatureInvalid
              })
            return signed.body
          }
        })
      ]
    },
    channel
  )
  await endpoint.ready
  return {
    endpoint: endpoint,
    oneWay: endpoint,
    stream: endpoint.stream
  }
}
