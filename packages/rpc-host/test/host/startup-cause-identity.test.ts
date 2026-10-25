/** Construction preserves the original thrown Error even when it also implements then. */
import { expect, it } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { defineTransportPlugin } from '@migaia/rpc-host/sdk'

it('rejects with the original thenable startup error without assimilating its then method', async () => {
  /** A supported Error can carry a user method without becoming a successful operation result. */
  const state = { assimilations: 0 }
  /** This is the exact native acquisition failure, not a returned promise. */
  const primary = Object.assign(new Error('native startup failure'), {
    // oxlint-disable-next-line unicorn/no-thenable -- This thrown Error is the actual regression input.
    then() {
      state.assimilations += 1
    }
  })
  /** The genuine native installation transaction catches and rolls back this original throw. */
  const transport = defineTransportPlugin({
    name: 'thenable-startup-failure',
    namespace: 'memory',
    open() {
      throw primary
    }
  })
  /** Throwing the error through an async rejection must never await it as a successful value. */
  let received: unknown
  try {
    await createRpcHost({ plugins: [transport], report: () => undefined })
  } catch (error) {
    received = error
  }
  expect(received).toBe(primary)
  expect(state.assimilations).toBe(0)
})
