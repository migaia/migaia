// @ts-expect-error V1 exposes canonical named operations, not a redundant aggregate.
import type rpcV1 from '../src/contract/v1/index.js'
// @ts-expect-error Call the original framer accept/close directly.
import type { createReassembler } from '../src/contract/framing/index.js'
// @ts-expect-error The dedicated facade alias no longer describes a public boundary.
import type { IRpcReassembler } from '../src/contract/framing/index.js'
// @ts-expect-error Whole string carrier users use the canonical guarded framer.
import type { processStringFramer } from '../src/contract/framing/index.js'

/** Keeps all negative imports part of the package's existing test typecheck. */
export type IRetiredContractExports = [
  typeof rpcV1,
  typeof createReassembler,
  IRpcReassembler<unknown, unknown>,
  typeof processStringFramer
]
