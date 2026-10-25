/** Existing native child control helpers observe fork/IPC/kill; business remains actual RPC. */
import { fork, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { deserializeRpcWireError } from '@migaia/rpc-contract/protocol'
import { deferred } from '@migaia/utils/promise'

/** One original startup observation owns only its child and three exact native listeners. */
class SocketStartup {
  /** The actual independent child remains the sole native process resource. */
  readonly #child: ChildProcess
  /** Original ready/failure observation is one Promise, without a timer or extra protocol. */
  readonly #pending = deferred<ChildProcess>()
  /** Expose the same actual child once its existing ready control message arrives. */
  readonly value: Promise<ChildProcess>

  /** Attach the original native callbacks before waiting for the child control message. */
  constructor(child: ChildProcess) {
    this.#child = child
    this.value = this.#pending.promise
    child.on('message', this.#message)
    child.once('exit', this.#exit)
    child.once('error', this.#failure)
  }
  /** Startup terminal paths remove only this observation's own listeners. */
  #stop(): void {
    this.#child.off('message', this.#message)
    this.#child.off('exit', this.#exit)
    this.#child.off('error', this.#failure)
  }
  /** Keep the original native failure without replacing its identity. */
  readonly #failure = (error: unknown): void => {
    this.#stop()
    this.#pending.reject(error)
  }
  /** Original fixture exit text remains local test data. */
  readonly #exit = (code: number | null): void =>
    this.#failure(new Error(`fixture exited before ready: ${code}`))
  /** Only the original fixture's ready or failure message settles this startup observation. */
  readonly #message = (value: unknown): void => {
    const event = value as { event?: string; error?: unknown }
    if (event.event === 'ready') {
      this.#stop()
      this.#pending.resolve(this.#child)
    } else if (event.event === 'failed') this.#failure(deserializeRpcWireError(event.error))
  }
}

/** Original diagnostic correlation is process-local test control, never an RPC request registry. */
let commandId = 0
/** One actual IPC command owns its original response listener and send callback. */
class NativeCommand<T> {
  /** The actual child process receives only the existing fixture control command. */
  readonly #child: ChildProcess
  /** One original scalar correlates the response without changing its business operation. */
  readonly #id = ++commandId
  /** Each command retains exactly the original result Promise. */
  readonly #pending = deferred<T>()
  /** Callers observe only the result returned by the child's actual public RPC operation. */
  readonly value: Promise<T>

  /** Preserve listener-before-send ordering and the existing operation/method/payload fields. */
  constructor(child: ChildProcess, operation: string, method?: string, payload?: unknown) {
    this.#child = child
    this.value = this.#pending.promise
    child.on('message', this.#receive)
    child.send({ id: this.#id, operation, method, payload }, this.#sent)
  }
  /** Original IPC send failure removes the matching observer and preserves its native error. */
  readonly #sent = (error: Error | null): void => {
    if (error) {
      this.#child.off('message', this.#receive)
      this.#pending.reject(error)
    }
  }
  /** New-profile flat error data restores the canonical Error/cause chain at this IPC boundary. */
  readonly #receive = (value: unknown): void => {
    const response = value as { id?: number; result?: unknown; error?: unknown }
    if (response.id !== this.#id) return
    this.#child.off('message', this.#receive)
    if (response.error) this.#pending.reject(deserializeRpcWireError(response.error))
    else this.#pending.resolve(response.result as T)
  }
}

/** Fork the unchanged socket fixture and retain its original actual native process receipt. */
export function socketProcess(
  mode: 'listen' | 'connect',
  target: string,
  token: string,
  name: string
): Promise<ChildProcess> {
  const child = fork(
    fileURLToPath(new URL('./fixtures/host-plugin-socket.ts', import.meta.url)),
    [mode, target, token, name],
    {
      execArgv: [],
      env: { PATH: process.env.PATH },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc']
    }
  )
  return new SocketStartup(child).value
}
/** Correlate one existing command while all requested business executes over actual native RPC. */
export function command<T = unknown>(
  child: ChildProcess,
  operation: string,
  method?: string,
  payload?: unknown
): Promise<T> {
  return new NativeCommand<T>(child, operation, method, payload).value
}
/** Resume a stopped original process before killing and observing that actual native exit. */
export async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  if (process.platform !== 'win32') child.kill('SIGCONT')
  child.kill('SIGKILL')
  await exited
}
/** Consume only the original public iterator without changing its lifetime or cancellation. */
export async function collect(iterator: AsyncIterableIterator<unknown>): Promise<unknown[]> {
  const values: unknown[] = []
  for await (const value of iterator) values.push(value)
  return values
}
