import { parentPort } from 'node:worker_threads'
import {
  createRpcHost,
  type IRpcHost,
  type IRpcContext,
  type IRpcNamespace
} from '@migaia/rpc-host'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { serializeErrorChain } from '@migaia/utils'
import { deferred } from '@migaia/utils/promise'

/** Original native child business owns actual invocation observations, never protocol execution. */
class NativeCoroutineService {
  /** Native Worker execution selects its real parent port; processes borrow actual stdin/stdout. */
  readonly #family = parentPort ? 'thread' : 'process'
  /** Reverse methods borrow the genuine committed child Host. */
  #host: IRpcHost | undefined
  /** Notify delivery is observed at the provider independently from physical send completion. */
  readonly #notices: unknown[] = []
  /** Original waiting count is cumulative provider entry, not current active invocation count. */
  #waiting = 0
  /** Only actual provider signal abort increments this independent cancellation receipt. */
  #cancelled = 0

  /** Resolve only the actual single parent namespace; no Peer or runtime facade is constructed. */
  #parent(): IRpcNamespace {
    return this.#host![this.#family]
  }
  /** Echo original portable payload through the actual native provider. */
  readonly #read = (payload: unknown) => payload
  /** Preserve independent original notification receipt. */
  readonly #notice = (payload: unknown): void => {
    this.#notices.push(payload)
  };
  /** Yield the original provider's exact ordered values. */
  *#values() {
    yield 1
    yield 2
    yield 3
  }
  /** Wait only for the exact canonical incoming cancellation reason. */
  readonly #wait = (_payload: unknown, context: IRpcContext) => {
    /** The original request owns one settlement, observed before the caller can abort. */
    const result = deferred<void>()
    this.#waiting += 1
    /** Cancellation belongs to this actual request and rejects with its exact signal reason. */
    const abort = () => {
      this.#cancelled += 1
      result.reject(context.signal.reason)
    }
    if (context.signal.aborted) abort()
    else context.signal.addEventListener('abort', abort, { once: true })
    return result.promise
  }
  /** Reverse scalar requests enter the real parent's forwarding provider. */
  readonly #reverse = (payload: unknown) =>
    this.#parent().send('parent', 'parent.read', payload as never)
  /** Reverse notify retains physical completion and actual parent delivery. */
  readonly #reverseNotice = (payload: unknown) =>
    this.#parent().notify('parent.notice', payload as never, { targetId: 'parent' })
  /** The one actual parent member retains the original reverse stream selection. */
  readonly #reverseValues = () =>
    this.#parent().stream('parent.values') as AsyncIterableIterator<unknown>
  /** Forward the actual native caller's canonical abort signal into reverse parent RPC. */
  readonly #reverseWait = (payload: unknown, context: IRpcContext) =>
    this.#parent().send('parent', 'parent.wait', payload as never, { signal: context.signal })
  /** Copy only original business observations; no mutable provider state leaves this process. */
  readonly #stats = () => ({
    notices: [...this.#notices],
    waiting: this.#waiting,
    cancelled: this.#cancelled
  })
  /** Preserve diagnostic source, code, native type, stack and complete bounded error graph. */
  readonly #report = (error: unknown): void => {
    process.stderr.write(
      `${JSON.stringify(serializeErrorChain(error, { fields: ['name', 'source', 'code', 'reason', 'message', 'stack'] }))}\n`
    )
  }
  /** Native parent bootstrap and all codec/Session execution remain their unique production owners. */
  async run(): Promise<void> {
    this.#host = await createRpcHost({
      plugins: [
        this.#family === 'thread'
          ? threadPlugin({ connectToParent: true })
          : processPlugin({ connectToParent: true })
      ],
      provide: {
        service: {
          read: this.#read,
          notice: this.#notice,
          values: () => this.#values(),
          wait: this.#wait,
          reverse: this.#reverse,
          reverseNotice: this.#reverseNotice,
          reverseValues: this.#reverseValues,
          reverseWait: this.#reverseWait,
          stats: this.#stats
        }
      },
      report: this.#report
    })
    /** Installation has committed before this immediate original reverse readiness call. */
    await this.#parent().send('parent', 'parent.ready')
  }
}

await new NativeCoroutineService().run()
