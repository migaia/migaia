import { array, number } from '../src/index.js'
// @ts-expect-error removes the duplicate mode constant.
import { WasmFieldMode } from '../src/index.js'
// @ts-expect-error removes the duplicate sync-only type mirror.
import type { IWasmFieldMode } from '../src/index.js'
// @ts-expect-error keeps shared cancellation classification private.
import { assertWasmFieldNotAborted } from '../src/index.js'

// @ts-expect-error removes the unused item argument and old three-argument ordering.
array(number(), 2, 1)
// @ts-expect-error the first argument is now the numeric length.
array(number(), 2)
void WasmFieldMode
void assertWasmFieldNotAborted
/** Compile-only marker proving the duplicate mode type cannot return to the public surface. */
export type IRemovedMode = IWasmFieldMode
