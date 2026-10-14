import { createReactiveError, tagReactiveError } from '../errors.js'
import { ReactiveErrorCode } from '../error-code.js'
import { ReactiveErrorText } from '../error-text.js'

// Monotonic version counter shared by memo invalidation, stale-check shortcuts, and time-travel anchors.
export class VersionClock {
  #version = 0
  #maxVersion: number

  /**
   * The production limit is `Number.MAX_SAFE_INTEGER`. Even one million real changes per second
   * takes about 285 years to exhaust it. Resetting the counter would collide with live node
   * versions and cause missed updates, so exhaustion stops writes. Dispose nodes held by stores or
   * scopes, discard the old runtime, and create another runtime. Terminal disconnection consumes no
   * version, so exhaustion does not prevent cleanup.
   *
   * `maxVersion` reduces the limit for deterministic tests. `Runtime` keeps the default limit.
   */
  constructor(maxVersion = Number.MAX_SAFE_INTEGER) {
    if (!Number.isSafeInteger(maxVersion) || maxVersion < 1) {
      throw tagReactiveError(
        new RangeError(ReactiveErrorText.maximumReactiveVersionInvalid),
        ReactiveErrorCode.invalidOption
      )
    }
    this.#maxVersion = maxVersion
  }

  /** Allocates the next version when a signal or computed value changes. */
  next(): number {
    if (this.#version >= this.#maxVersion) {
      throw createReactiveError(
        ReactiveErrorCode.versionExhausted,
        ReactiveErrorText.versionClockExhausted
      )
    }
    return ++this.#version
  }

  /** Reads the current version without consuming another version. */
  current(): number {
    return this.#version
  }
}
