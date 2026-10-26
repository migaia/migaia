import { createRpcHost, type IRpcHost, type IRpcWarning } from '@migaia/rpc-host'
import type { IRpcHostPlugin } from '@migaia/rpc-host/sdk'

/** The public child service returns only identity decisions and error counts, never native tokens. */
export type IIdentitySnapshot = Readonly<{
  self: Readonly<{ name: string; instanceId: string }>
  warnings: readonly IRpcWarning[]
  reports: number
}>

/** All three native families expose the same public provider and configured child identity. */
export class NativeIdentityChild {
  /** Actual child warning deliveries remain separate from background error reports. */
  readonly #warnings: IRpcWarning[] = []
  /** Unexpected native/Host failures remain observable throughout the child's lifetime. */
  readonly #reports: unknown[] = []
  /** Only successfully opened public hosts enter this child's cleanup owner. */
  #host: IRpcHost | undefined
  /** The default-sink case intentionally omits the public onWarning option. */
  readonly #collectWarnings: boolean

  /** Select the public warning destination before native child construction begins. */
  constructor(collectWarnings = true) {
    this.#collectWarnings = collectWarnings
  }

  /** Open the actual supplied native child source without rewriting its explicit self. */
  async open(plugin: IRpcHostPlugin): Promise<void> {
    this.#host = await createRpcHost({
      self: { name: 'math-child', instanceId: 'configured-child-instance' },
      ...(this.#collectWarnings
        ? { onWarning: (warning: IRpcWarning) => this.#warnings.push(warning) }
        : {}),
      report: (error) => this.#reports.push(error),
      plugins: [plugin],
      provide: { inspect: this.inspect }
    })
  }

  /** Business requests inspect the actual accepted public self after construction has completed. */
  readonly inspect = (): IIdentitySnapshot => ({
    self: this.#host!.self,
    warnings: this.#warnings,
    reports: this.#reports.length
  })

  /** Coroutine task cleanup joins the actual child Host's existing close Promise. */
  async close(): Promise<void> {
    await this.#host?.close()
  }
}
