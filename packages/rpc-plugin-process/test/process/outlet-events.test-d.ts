import { expectTypeOf } from 'vitest'
import { runtimeTestHost } from '../../../rpc-host/test/runtime-api/fixture.js'

/** The ordinary native fixture declares its actual static process/thread registration inventory. */
declare const host: ReturnType<typeof runtimeTestHost>

expectTypeOf(host.process!.on).toBeFunction()
expectTypeOf(host.process!.watch).toBeFunction()
host.process!.on('ready', () => undefined)
