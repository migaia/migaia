/** Original canonical registration texts remain public even after their legacy SDK owners leave. */
import { expect, it } from 'vitest'
import { RpcCoreErrorText } from '@migaia/rpc-contract/errors'

// RPC-TEST-06477F67FF15-C001-A003 and C002-A002 retain their exact public text predicates.
it('preserves the original canonical control registration texts', () => {
  expect(RpcCoreErrorText.variationHandlerDuplicate('abort')).toBe(
    'variation handler already registered: abort'
  )
  expect(RpcCoreErrorText.manualQueryListenerDuplicate).toBe(
    'only one manual query listener may be registered'
  )
})
