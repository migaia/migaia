/** Function-form mutation composition does not relax canonical keys for ordinary object surfaces. */
import { defineHost } from '../src/index.ts'

/** These declarations are typechecked without creating additional runtime Hosts. */
function surfaceTypes(): void {
  /** The legacy object form cannot replace native mutation or identity entries. */
  defineHost({
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } },
    surface: {
      // @ts-expect-error Object-form use remains reserved.
      use: () => undefined
    }
  })
  defineHost({
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } },
    // @ts-expect-error A factory may replace only use/unUse, not another canonical member.
    surface: (_native) => ({ revision: 42 })
  })
}
void surfaceTypes
