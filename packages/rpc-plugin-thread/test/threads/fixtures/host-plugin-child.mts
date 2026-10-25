import { threadId } from 'node:worker_threads'
import { createRpcHost, type IRpcHost } from '@migaia/rpc-host'
import { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'

/** The actual native Worker supplies thread identity; its host claims only the genuine parent. */
const child = await isThreadChild()
/** Explicit return typing avoids deriving the host's API from a callback that reads this same host. */
let opening: Promise<
  IRpcHost<Record<never, never>, readonly [ReturnType<typeof threadPlugin<'thread'>>]>
>
opening = createRpcHost({
  plugins: [threadPlugin({ connectToParent: true })],
  provide: {
    echo: (value: unknown) => value,
    identity: () => ({ threadId, pid: process.pid, child }),
    sequence: async function* () {
      yield 1
      yield 2
    },
    reverse: async (value: number): Promise<unknown> =>
      (await opening).thread.request('parentEcho', value),
    reverseStream: async function* () {
      yield* (await opening).thread.stream('parentSequence') as AsyncIterableIterator<unknown>
    },
    exposed: async (value: number): Promise<unknown> =>
      (await opening).thread.request('math.double', value)
  },
  report: () => undefined
})
await opening
