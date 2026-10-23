import { expectTypeOf } from 'vitest'
import { defineHost } from '@migaia/plugin-host'
import { assembleThreadFixture } from './fixture.js'

/** A literal registration keeps its remote method types while retaining lifecycle events. */
type IApi = { double(value: number): number }
/** The public plugin factory supplies the exact literal-name Host registration type. */
declare const plugin: ReturnType<typeof assembleThreadFixture<IApi, Record<never, never>, 'worker'>>
/** No native source is acquired by this compile-only Host contract. */
const host = defineHost<Record<string, never>, never, readonly [typeof plugin]>({
  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
})

expectTypeOf(host.thread!.on).toBeFunction()
expectTypeOf(host.thread!.watch).toBeFunction()
host.thread!.on('ready', () => undefined)
