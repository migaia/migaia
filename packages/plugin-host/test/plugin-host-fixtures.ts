/** Owns shared fixture construction; test assertions remain in their focused suites. */
import { vi, type Mock } from 'vitest'
import { PluginHost } from '../src/host-runtime.ts'
import { PluginHostError } from '../src/error-text.ts'
import { PluginHost as PublicPluginHost } from '../src/index.ts'
import type { IPluginConstraint } from '../src/plugin-definition-types.ts'
import type { IPluginHostCore } from '../src/plugin-core-types.ts'
import type { IPluginHostOptions } from '../src/host-options-types.ts'

/** Minimal domain core supplied by the original numeric host cases. */
export type IExt = { marker?: string } & Pick<IPluginHostCore<number>, 'onDispose' | 'usePipeline'>

/** Narrows the original fixture's stage-registration callback shape. */
export type IStageCore = IExt & {
  usePipeline: (stage: (value: number, next: (value: number) => void) => void) => unknown
}

/** Numeric host preserves the original pipeline result and deadline policy. */
export class Host extends PluginHost<IExt, number> {
  /** Supplies an explicit unbounded test policy while preserving test overrides. */
  constructor(options: any = {}) {
    super({
      ...options,
      execution: options.execution ?? { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
  }

  /** Returns the terminal result without adding an await to synchronous pipelines. */
  run(value: number): number | Promise<number> {
    /** Terminal value assigned by the existing pipeline callback. */
    let result = value
    /** Exact pipeline result decides whether this method returns synchronously. */
    const output = this.runPipeline(value, (next) => {
      result = next
    })
    return output instanceof Promise ? output.then(() => result) : result
  }
}

/** Native Feature host exposes the original synchronous installation seam. */
export class FeatureHost extends PublicPluginHost<{}> {
  /** Supplies the same unbounded lifecycle policy for native Feature integration checks. */
  constructor(
    options: Omit<IPluginHostOptions, 'execution'> &
      Partial<Pick<IPluginHostOptions, 'execution'>> = {}
  ) {
    super({
      ...options,
      execution: options.execution ?? { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
  }

  /** Installs native Feature definitions through the existing synchronous path. */
  installSync(plugins: readonly IPluginConstraint<{}>[]) {
    return this.useSync(plugins)
  }
}

/** Builds the original structural-plugin fixture without altering its admitted fields. */
export const plugin = (
  name: string,
  install: (core: IExt) => unknown,
  extra: Record<string, unknown> = {}
) => ({ name, install, ...extra }) as never

/** Records attempts to translate disposal errors through the protected host hook. */
export class TranslatingHost extends PluginHost<Record<string, never>> {
  /** Per-instance receipt proves whether the host invokes the translation hook. */
  readonly translations: Mock = vi.fn()

  /** Supplies an explicit unbounded test policy while preserving test overrides. */
  constructor(options: any = {}) {
    super({
      ...options,
      execution: options.execution ?? { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
  }

  /** Keeps the original error reachable if the protected translation hook is invoked. */
  protected override translateDisposalError(error: PluginHostError): Error {
    this.translations(error)
    return new Error('translated disposal', { cause: error })
  }
}
