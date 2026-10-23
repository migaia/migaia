import { threadPlugin } from '@migaia/rpc-plugin-thread'
import { createRpcHost } from '@migaia/rpc-host'
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

/** Record one actual native execution and keep it busy long enough to admit all three members. */
async function pid(input) {
  appendFileSync(input.journal, `${input.value}\n`)
  await new Promise((resolve) => setTimeout(resolve, 20))
  return threadId
}

await createRpcHost({
  plugins: [threadPlugin({ connectToParent: true })],
  provide: { echo, crash, pid, identity: () => threadId }
})
