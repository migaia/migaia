import { expectTypeOf } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { processPlugin } from '@migaia/rpc-plugin-process'

/** Construction is typechecked but never executed in this declaration-only contract fixture. */
async function nativeHost() {
  return createRpcHost({
    plugins: [processPlugin({ spawn: { entry: 'process-events-fixture.mjs' } })]
  })
}
/** Native member controls belong to the declared Process namespace's members projection. */
declare const host: Awaited<ReturnType<typeof nativeHost>>

expectTypeOf(host.process.members.on).toBeFunction()
expectTypeOf(host.process.members.watch).toBeFunction()
host.process.members.on('ready', () => undefined)
