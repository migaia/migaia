import { createRpcHost } from '@migaia/rpc-host'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import { idempotency } from '@migaia/rpc-host/plugins/idempotency'
import { threadId } from 'node:worker_threads'

/** Each generation reports its native thread id; `crash` ends the thread without replying. */
await createRpcHost({
  provide: {
    thread: () => threadId,
    /** Yields the thread id once, so the stream call shape has a real generator to reach. */
    threads: async function* () {
      yield threadId
    },
    /** Never settles, so a caller observes how an in-flight call ends when the thread dies. */
    wait: () => new Promise<never>(() => {}),
    crash: () => process.exit(1)
  },
  plugins: [threadPlugin({ connectToParent: true, features: [idempotency()] })]
})
