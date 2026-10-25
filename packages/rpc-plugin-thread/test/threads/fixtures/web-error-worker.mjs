import { readThreadBootstrap } from '../../../dist/threads/bootstrap.js'

/**
 * Stable fixture diagnostic identifies the deliberate uncaught error observed by platform
 * listeners.
 */
const failureText = 'platform Worker uncaught fixture'

/** The actual first native message is admitted by the unique pure bootstrap projector. */
const initial = await new Promise((resolve) => {
  self.addEventListener('message', (event) => resolve(event.data), { once: true })
})
readThreadBootstrap(initial)
/** A real runtime error occurs after private initialization, outside any RPC provider. */
setTimeout(() => {
  throw new Error(failureText)
}, 10)
