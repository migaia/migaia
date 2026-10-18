// @ts-expect-error SS-C01 removes a mode vocabulary consumed by no public protocol.
import { SharedWaitMode } from '../src/index.js'
// @ts-expect-error SS-C01 removes the corresponding unused type vocabulary.
import type { ISharedWaitMode } from '../src/index.js'

void SharedWaitMode
/** Compile-only marker proving consumers cannot retain the retired annotation. */
export type IRemovedMode = ISharedWaitMode
