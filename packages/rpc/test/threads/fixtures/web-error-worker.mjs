import { receiveThreadData } from '../../../dist/threads/index.js'

/**
 * Stable fixture diagnostic identifies the deliberate uncaught error observed by platform
 * listeners.
 */
const failureText = 'platform Worker uncaught fixture'

/** A real runtime error occurs after private preparation completes, outside any RPC provider. */
await receiveThreadData(self, () => undefined)
setTimeout(() => {
  throw new Error(failureText)
}, 10)
