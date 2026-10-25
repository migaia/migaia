import { expectTypeOf } from 'vitest'
import type { IRpcNativeMemberControls } from '@migaia/rpc-host/sdk'
/** BC1 moves native lifecycle events to the actual transport-owned members extension. */
declare const members: IRpcNativeMemberControls<'thread'>
expectTypeOf(members.on).toBeFunction()
expectTypeOf(members.watch).toBeFunction()
members.on('ready', () => undefined)
