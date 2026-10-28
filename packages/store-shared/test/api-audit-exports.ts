// @ts-expect-error removes a mode vocabulary consumed by no public protocol.
import { SharedWaitMode } from '../src/index.ts'
// @ts-expect-error removes the corresponding unused type vocabulary.
import type { ISharedWaitMode } from '../src/index.ts'

void SharedWaitMode
/** Compile-only marker proving consumers cannot retain the retired annotation. */
export type IRemovedMode = ISharedWaitMode
