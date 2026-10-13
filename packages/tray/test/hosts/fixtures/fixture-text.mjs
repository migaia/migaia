/** Shared fixture identities keep business failures and child diagnostics independently observable. */
export const FixtureText = Object.freeze({
  businessSource: '@fixture/tray',
  businessCode: 'SVC_FAILED',
  businessMessage: 'fixture service failed',
  causeCode: 'SVC_CAUSE',
  causeMessage: 'fixture service cause',
  crashCode: 'BOOM',
  crashMessage: 'fixture instance crash',
  initCode: 'INIT_FAILED',
  initMessage: 'fixture init failed',
  cleanupCode: 'CLEANUP_FAILED',
  cleanupMessage: 'fixture cleanup failed',
  launchMessage: 'fixture background launch failed',
  livenessChannel: 'tray-host-fixture-live'
})

/**
 * Creates the fixture's native coded error without replacing its identity or stack.
 *
 * @param {string} code Scenario-specific fixture code.
 * @param {string} message Stable fixture diagnostic.
 * @param {unknown} [cause] Original cause retained by the native Error.
 * @returns {Error & { source: string; code: string }} Coded native error.
 */
export function fixtureError(code, message, cause) {
  /** Native construction retains the original cause and stack. */
  const error = new Error(message, cause === undefined ? undefined : { cause })
  Object.defineProperties(error, {
    source: { value: FixtureText.businessSource, enumerable: true },
    code: { value: code, enumerable: true }
  })
  return /** @type {Error & { source: string; code: string }} */ (error)
}
import { BroadcastChannel, threadId } from 'node:worker_threads'

/**
 * Opens the native liveness channel used by all directly invoked Worker fixtures.
 *
 * @returns {BroadcastChannel} Unreferenced channel owned by the Worker realm.
 */
export function startLiveness() {
  /** Probe replies identify the actual native Worker, independent from registry records. */
  const channel = new BroadcastChannel(FixtureText.livenessChannel)
  channel.unref()
  channel.onmessage = (event) => {
    if (event.data?.ping) channel.postMessage({ pong: event.data.ping, threadId })
  }
  return channel
}
