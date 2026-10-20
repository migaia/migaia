// @ts-expect-error hides the private wait-race outcome vocabulary.
import { SsrWorkOutcome } from '../src/index.js'
// @ts-expect-error removes the unused public mirror type.
import type { ISsrWorkOutcome } from '../src/index.js'

void SsrWorkOutcome
/** Compile-only assertion that consumers cannot retain the private-race annotation. */
export type IRemovedOutcome = ISsrWorkOutcome
