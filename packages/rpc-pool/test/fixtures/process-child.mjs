import { createProcessPeer } from '@migaia/rpc-process'

/**
 * Double a business value through the existing automatic stdio bootstrap path.
 *
 * @param {number} value Portable fixture payload.
 * @returns {number} Twice the original value.
 */
function double(value) {
  return value * 2
}

await createProcessPeer({ provide: { math: { double }, identity: () => process.pid } })
