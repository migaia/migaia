import { defineFlowPlugin } from '@migaia/rpc-host/sdk'
import type { IRpcDirectory, IRpcWireError } from '@migaia/rpc-contract/protocol'
import { fileURLToPath } from 'node:url'

/** Every entry is an independent language fixture, including the handwritten TS oracle. */
export const peers = [
  {
    language: 'python',
    id: 'python-peer',
    command: 'python3',
    args: ['-B', fileURLToPath(new URL('./python/peer.py', import.meta.url)), '--business']
  },
  {
    language: 'rust',
    id: 'rust-peer',
    command: fileURLToPath(new URL('./rust/run.sh', import.meta.url)),
    args: ['--business']
  },
  {
    language: 'go',
    id: 'go-peer',
    command: fileURLToPath(new URL('./go/run.sh', import.meta.url)),
    args: ['--business']
  },
  {
    language: 'ts-reference',
    id: 'ts-peer',
    command: fileURLToPath(new URL('./ts-reference/run.sh', import.meta.url)),
    args: []
  }
] as const

/** Capture original admitted wire facts without replacing a carrier, codec or readiness result. */
export class NativeInteropObservations {
  /** Last actual remote handshake directory, retained only for this case's assertions. */
  #directory: IRpcDirectory | undefined
  /** Original flat error emitted by the foreign provider, before local restoration. */
  #error: IRpcWireError | undefined

  /** The real cold flow receiver returns every original value unchanged. */
  readonly plugin = defineFlowPlugin({
    name: 'native-interop-observation',
    setup: () => ({
      hooks: {
        handshake: (value, context) => {
          if (context.direction === 'inbound' && value.step !== 'reject')
            this.#directory = value.directory
          return value
        },
        envelope: {
          inbound: (value) => {
            /** Metadata has already passed the native JSON decoder; this hook never grants authority. */
            const message = value.message
            if (
              message &&
              typeof message === 'object' &&
              'kind' in message &&
              message.kind === 'error' &&
              'error' in message
            )
              this.#error = message.error as IRpcWireError
            return value
          }
        }
      }
    })
  })

  /** Read the exact received directory; successful public calls prove actual Host admission. */
  get directory(): IRpcDirectory | undefined {
    return this.#directory
  }

  /** Read the original foreign wire graph for native field/cause assertions. */
  get error(): IRpcWireError | undefined {
    return this.#error
  }
}
