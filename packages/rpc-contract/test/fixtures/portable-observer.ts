import { vi } from 'vitest'
import * as portableOwner from '../../dist/contract/normalize.js'

/** Observe the existing built normalization owner across public re-exports and private calls. */
export function observePortableNormalization() {
  return vi.spyOn(portableOwner, 'normalizePortable')
}
