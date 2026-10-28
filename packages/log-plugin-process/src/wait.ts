import type { IScheduler, IScheduledTask } from '@migaia/utils/scheduler'

/** One group wait owns its returned task, including synchronous scheduler callbacks. */
export class ProcessWait {
  /** The caller races this Promise against existing host operations. */
  readonly promise: Promise<void>
  /** A returned task is retained even when its callback ran before schedule returned. */
  #task: IScheduledTask | undefined
  /** Native fulfillment is captured before the scheduler can call back synchronously. */
  #resolve!: () => void

  /** Arm the existing graceful wait without inventing another timeout policy. */
  constructor(scheduler: IScheduler, ms: number) {
    this.promise = new Promise<void>((resolve, reject) => this.#arm(scheduler, ms, resolve, reject))
  }

  /** A stable field callback belongs to this wait instance rather than an assigned closure table. */
  readonly #complete = (): void => this.#resolve()

  /** Scheduler admission errors reject the wait and remain visible to the group's cleanup owner. */
  #arm(
    scheduler: IScheduler,
    ms: number,
    resolve: () => void,
    reject: (error: unknown) => void
  ): void {
    this.#resolve = resolve
    try {
      this.#task = scheduler.schedule(this.#complete, ms)
    } catch (error) {
      reject(error)
    }
  }

  /** Clear ownership before cancellation so a throwing getter/call is never retried. */
  cancel(): void {
    /** The exact returned task is cancelled once after either race branch settles. */
    const task = this.#task
    this.#task = undefined
    task?.cancel()
  }
}
