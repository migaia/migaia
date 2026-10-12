import { createThreadPeer } from '@migaia/rpc-threads'
import { appendFileSync } from 'node:fs'
import { threadId } from 'node:worker_threads'

/**
 * Record the actual business execution before exiting this real Worker.
 *
 * @param {{ journal: string }} input Test-owned journal under rpc-pool/test.
 * @returns {never} The native Worker exits without completing the request.
 */
function crash(input) {
  appendFileSync(input.journal, 'crash\n')
  process.exit(1)
}

/**
 * Return a scalar through the real public Peer and its negotiated endpoint.
 *
 * @param {number} value Portable fixture payload.
 * @returns {number} The unchanged business value.
 */
function echo(value) {
  return value
}

await createThreadPeer({ provide: { echo, crash, identity: () => threadId } })
