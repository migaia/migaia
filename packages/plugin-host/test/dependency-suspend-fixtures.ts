/** Owns shared fixture construction; test assertions remain in their focused suites. */
import { MiddlewarePipelineMode } from '@migaia/middleware-pipeline'
import { PluginHost } from '../src/index.js'

/** Retains exact recovery failures without depending on diagnostic prose. */
export type IRecoveryDiagnostic = { code?: string; error?: unknown }

/** Runs the synchronous pipeline used to observe suspension visibility. */
export class SuspendHost extends PluginHost<Record<string, never>, number> {
  /** Returns the terminal pipeline value while preserving synchronous execution. */
  run(value: number): number {
    /** Terminal value assigned by the existing pipeline callback. */
    let result = value
    this.runPipeline(value, (next) => {
      result = next
    })
    return result
  }
}

/** Runs asynchronous recovery scenarios and reports their original errors. */
export class RecoveryHost extends PluginHost<Record<string, never>, number> {
  /** Binds recovery diagnostics to the receipt owned by the calling test. */
  constructor(diagnostics: IRecoveryDiagnostic[]) {
    super({
      execution,
      pipeline: { mode: MiddlewarePipelineMode.async },
      diagnostic: (_message, code, error) => diagnostics.push({ code, error })
    })
  }

  /** Returns the terminal value after the asynchronous pipeline drains. */
  async run(value: number): Promise<number> {
    /** Terminal value assigned by the existing pipeline callback. */
    let result = value
    await this.runPipeline(value, (next) => {
      result = next
    })
    return result
  }
}

/** Disables unrelated wall-clock deadlines for dependency-order assertions. */
export const execution = {
  mutationTimeoutMs: false as const,
  pipelineDrainTimeoutMs: false as const
}
