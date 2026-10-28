// @ts-expect-error Codec output types are owned by storage-contract.
import type { IPersistCodecOutput } from '../src/index.ts'
import { PersistState, type IPersistState } from '../src/index.ts'
// @ts-expect-error Internal active is not a public state constant.
void PersistState.active
// @ts-expect-error Public state subsets do not expose the private active projection.
const activeState: IPersistState = 'active'
void activeState
export type IRetiredCodecOutput = IPersistCodecOutput
