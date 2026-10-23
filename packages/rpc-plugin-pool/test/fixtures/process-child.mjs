import { processPlugin } from '@migaia/rpc-plugin-process'
import { createRpcHost } from '@migaia/rpc-host'
import { appendFileSync } from 'node:fs'

/**
 * Double a business value through the existing automatic stdio bootstrap path.
 *
 * @param {number} value Portable fixture payload.
 * @returns {number} Twice the original value.
 */
function double(value) {
  return value * 2
}

/** Record each actual child execution before returning its one scalar process identity. */
async function pid(input) {
  appendFileSync(input.journal, `${input.value}\n`)
  await new Promise((resolve) => setTimeout(resolve, 20))
  return process.pid
}

await createRpcHost({
  plugins: [processPlugin({ connectToParent: true })],
  provide: { math: { double }, pid, identity: () => process.pid }
})
