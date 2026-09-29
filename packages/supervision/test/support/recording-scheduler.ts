import { createManualScheduler, type IManualScheduler } from '@migaia/utils/scheduler'

/** Deterministic scheduler with observable unref hints on scheduled tasks. */
export function createRecordingScheduler(): IManualScheduler & { readonly unrefCalls: number } {
  const manual = createManualScheduler()
  let unrefCalls = 0
  return {
    now: () => manual.now(),
    advance: (ms) => manual.advance(ms),
    get pendingCount() {
      return manual.pendingCount
    },
    get unrefCalls() {
      return unrefCalls
    },
    schedule(callback, delayMs) {
      const task = manual.schedule(callback, delayMs)
      return {
        cancel: () => task.cancel(),
        unref: () => {
          unrefCalls++
        }
      }
    }
  }
}
