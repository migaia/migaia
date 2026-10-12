import { expectTypeOf } from 'vitest'
import { defineHost } from '@migaia/plugin-host'
import { createProcessPlugin } from '@migaia/rpc-process'

/** A literal registration keeps its remote method types while retaining lifecycle events. */
type IApi = { double(value: number): number }
/** The public plugin factory supplies the exact literal-name Host registration type. */
declare const plugin: ReturnType<typeof createProcessPlugin<IApi, Record<never, never>, 'worker'>>
/** No native source is acquired by this compile-only Host contract. */
const host = defineHost<Record<string, never>, never, readonly [typeof plugin]>({
  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
})

expectTypeOf(host.process!.on).toBeFunction()
expectTypeOf(host.process!.watch).toBeFunction()
host.process!.on('ready', () => undefined)
