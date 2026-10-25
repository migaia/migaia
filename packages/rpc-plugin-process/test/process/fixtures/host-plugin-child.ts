import { createRpcHost } from '@migaia/rpc-host'
import { processPlugin } from '@migaia/rpc-plugin-process'

/** The native child keeps the actual parent transport and its inferred process namespace. */
const transport = processPlugin({ connectToParent: true })
/** The child holds one genuine parent connection and its own local provider declaration. */
const opening: ReturnType<typeof createRpcHost<unknown, readonly [typeof transport]>> =
  createRpcHost({
    plugins: [transport],
    provide: {
      echo: (value: unknown) => value,
      pid: () => process.pid,
      sequence: async function* () {
        yield 1
        yield 2
      },
      exposed: async (value: number) => (await opening).process.request('app.double', value),
      reverse: async (value: unknown) =>
        (await opening).process.request('parentEcho', value as number),
      reverseStream: async function* () {
        const host = await opening
        for await (const value of host.process.stream(
          'parentSequence'
        ) as AsyncIterableIterator<unknown>)
          yield value
      }
    },
    report: () => undefined
  })
await opening
