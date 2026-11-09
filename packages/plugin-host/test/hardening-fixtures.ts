import { nativeModules } from './native-modules.ts'
/** Owns shared fixture construction; test assertions remain in their focused suites. */
import { PluginHost } from '../src/index.ts'

/** Exposes synchronous installation under the hardening suite's existing deadline policy. */
export class Host extends PluginHost<
  Record<string, never>,
  string,
  readonly [],
  Record<never, never>,
  typeof nativeModules
> {
  /** Supplies an explicit unbounded test policy while preserving test overrides. */
  constructor(options: any = {}) {
    super({
      modules: nativeModules,
      pipeline: { mode: 'sync' },
      ...options,
      execution: options.execution ?? { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
  }

  /** Installs the admitted batch through the existing synchronous host entry. */
  install(plugins: readonly any[]) {
    return this.useSync(plugins)
  }
}
