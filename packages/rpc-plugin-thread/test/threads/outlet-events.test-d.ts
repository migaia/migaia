import { expectTypeOf } from 'vitest'
import { runtimeTestHost } from '../../../rpc-host/test/runtime-api/public-host.js'
/** Canonical ordinary-Host registration metadata retains actual outlet lifecycle events. */
const host = runtimeTestHost({
  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
})
expectTypeOf(host.thread!.on).toBeFunction()
expectTypeOf(host.thread!.watch).toBeFunction()
host.thread!.on('ready', () => undefined)
