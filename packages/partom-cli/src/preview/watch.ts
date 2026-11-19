import { watch, type FSWatcher } from 'node:fs'
import { isToolPath } from '../project.ts'
import { DEFAULT_BUILD_DIR } from '../release/text.ts'
import { REBUILD_DEBOUNCE_MS } from './constants.ts'

/**
 * Directory names whose changes never trigger a rebuild. `partom build` writes its output into the
 * project; without skipping it every release build would reload the preview.
 */
const IGNORED_SEGMENTS: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  'dist',
  DEFAULT_BUILD_DIR
])

/** Whether a changed path (relative to the project) should be ignored. */
export function isIgnoredPath(path: string): boolean {
  for (const segment of path.split(/[\\/]/)) if (IGNORED_SEGMENTS.has(segment)) return true
  return isToolPath(path)
}

/**
 * Recursive project watcher that merges changes arriving within the debounce window into one call
 * of `onChange`.
 */
export class ProjectWatcher {
  /** Underlying file watcher. */
  readonly #watcher: FSWatcher
  /** Receiver of merged changes. */
  readonly #onChange: () => void
  /** Pending debounce timer. */
  #timer: ReturnType<typeof setTimeout> | undefined

  /** Starts watching the project directory. */
  constructor(dir: string, onChange: () => void) {
    this.#onChange = onChange
    this.#watcher = watch(dir, { recursive: true }, (_event, file) => this.#changed(file))
  }

  /** Stops watching and drops a pending change; safe to call twice. */
  close(): void {
    clearTimeout(this.#timer)
    this.#timer = undefined
    this.#watcher.close()
  }

  /** Restarts the debounce window for a relevant change. */
  #changed(file: string | Buffer | null): void {
    if (file !== null && isIgnoredPath(String(file))) return
    clearTimeout(this.#timer)
    this.#timer = setTimeout(() => this.#fire(), REBUILD_DEBOUNCE_MS)
  }

  /** Delivers one merged change. */
  #fire(): void {
    this.#timer = undefined
    this.#onChange()
  }
}
