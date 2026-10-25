import { deferred } from '@migaia/utils/promise'
import { serializeRpcWireError } from '@migaia/rpc-contract/protocol'
import { createRpcHost } from '@migaia/rpc-host'
import { processPlugin } from '@migaia/rpc-plugin-process'

/** Only test control uses Node IPC; all business calls use the actual native RPC socket. */
const [mode, target, token, name] = process.argv.slice(2)
let touches = 0
let verified = 0
/** The real producer waits on business completion that test control can explicitly release. */
const streamReleased = deferred<void>()
const configuration =
  mode === 'listen'
    ? {
        listen: target!,
        token,
        verify: (auth: unknown) => {
          verified++
          if (auth !== token) throw new Error('fixture auth rejected')
          return String(auth)
        }
      }
    : { connect: { target: target!, timeoutMs: 500 }, token }
/** The same native recipe preserves its actual process namespace in the fixture's host type. */
const transport = processPlugin(configuration)
let host:
  | Awaited<ReturnType<typeof createRpcHost<unknown, readonly [typeof transport]>>>
  | undefined
try {
  host = await createRpcHost({
    self: { name: name!, instanceId: `${name}-${process.pid}` },
    plugins: [transport],
    provide: {
      echo: (value: unknown) => value,
      pid: () => process.pid,
      touch: (value: unknown) => ({ name, count: ++touches, value }),
      count: () => touches,
      sequence: async function* () {
        yield name
        yield process.pid
      },
      heldSequence: async function* () {
        yield name
        await streamReleased.promise
        yield process.pid
      }
    },
    report: () => undefined
  })
  process.send?.({ event: 'ready', pid: process.pid })
  process.on('message', async (value) => {
    const command = value as { id: number; operation: string; method?: string; payload?: never }
    try {
      /** The command drives the actual host stream; IPC carries only its observed result. */
      if (command.operation === 'stream') {
        const values: unknown[] = []
        for await (const item of host!.process.stream(
          command.method!,
          command.payload
        ) as AsyncIterable<unknown>)
          values.push(item)
        process.send?.({ id: command.id, result: values })
        return
      }
      if (command.operation === 'release-stream') {
        streamReleased.resolve()
        process.send?.({ id: command.id })
        return
      }
      const result =
        command.operation === 'stats'
          ? { verified }
          : command.operation === 'close'
            ? await host!.close()
            : await host!.process.request(command.method!, command.payload)
      process.send?.({ id: command.id, result })
      if (command.operation === 'close') process.disconnect()
    } catch (error) {
      process.send?.({
        id: command.id,
        error: serializeRpcWireError(error, { report: (failure) => console.error(failure.error) })
      })
    }
  })
  process.on('disconnect', () => {
    void host!.close()
  })
} catch (error) {
  process.send?.({
    event: 'failed',
    error: serializeRpcWireError(error, { report: (failure) => console.error(failure.error) })
  })
  process.disconnect?.()
  process.exitCode = 1
}
