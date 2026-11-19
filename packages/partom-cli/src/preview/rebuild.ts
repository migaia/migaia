import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { bundleEntry } from '../harness.ts'
import { BUILD_FAILED } from './constants.ts'
import { runDoctorChild, type IDoctorBlueprint, type IDoctorFailure } from './doctor-child.ts'
import {
  editorEntrySource,
  pageEntrySource,
  runtimeModule,
  type IRemoteEntry
} from './page-entry.ts'

/** One live generation: its number, blueprints and parsed documents. */
export type IGeneration = {
  readonly number: number
  readonly blueprints: readonly IDoctorBlueprint[]
  /** Blueprint documents by id, read when the generation was built; `null` for unreadable files. */
  readonly documents: ReadonlyMap<string, unknown>
  /** Directory of the bundle output. */
  readonly dir: string
}

/** What a rebuild reports to the server. */
export type IRebuildListener = {
  /** A new generation is live. */
  live(generation: IGeneration): void
  /** A rebuild failed; the previous generation stays live. */
  failed(failure: IDoctorFailure): void
}

/** Rebuild inputs fixed for the whole preview run. */
export type IRebuildOptions = {
  readonly projectDir: string
  readonly configPath: string
  /** The `--config` value as given, passed on to the doctor child. */
  readonly config: string | undefined
  readonly previewDir: string
  /** Editor bridge mode: the editor origin and the remote module entries to bundle. */
  readonly editor?: { readonly origin: string; readonly remote: readonly IRemoteEntry[] }
}

/** Export conditions of the editor preview bundle, tried before `import`/`default`. */
const EDITOR_CONDITIONS = ['development'] as const

/** Reads blueprint documents of a generation; a file that is not JSON maps to `null`. */
async function readDocuments(
  projectDir: string,
  blueprints: readonly IDoctorBlueprint[]
): Promise<Map<string, unknown>> {
  /** Documents by id. */
  const documents = new Map<string, unknown>()
  for (const entry of blueprints) {
    try {
      documents.set(entry.id, await Bun.file(join(projectDir, entry.file)).json())
    } catch {
      // A file that stopped being JSON is reported by doctor; the page then has no document.
      documents.set(entry.id, null)
    }
  }
  return documents
}

/** First build log message of a failed bundle. */
function bundleMessage(cause: unknown): string {
  /** Build logs. */
  const logs = (cause as { errors?: readonly { message?: unknown }[] }).errors ?? []
  /** First message. */
  const first = logs[0]?.message
  return typeof first === 'string' ? first : String((cause as Error).message)
}

/**
 * Serial rebuilds with generations. At most one rebuild runs; changes during a rebuild set one
 * pending flag, and one more rebuild runs after it, so generations only increase and events never
 * overlap. A rebuild runs the doctor child and bundles the page into `<previewDir>/<generation>`;
 * only when both succeed does the generation go live and the previous directory get removed.
 */
export class Rebuilder {
  /** Fixed inputs. */
  readonly #options: IRebuildOptions
  /** Receiver of results. */
  readonly #listener: IRebuildListener
  /** Number of the next generation. */
  #next = 1
  /** Live generation, if any. */
  #live: IGeneration | undefined
  /** Whether a rebuild is running. */
  #running = false
  /** Whether another rebuild was requested while one ran. */
  #pending = false
  /** Whether shutdown started; no new rebuild starts after it. */
  #stopped = false
  /** Promise of the running rebuild loop, for waiting at shutdown. */
  #loop: Promise<void> = Promise.resolve()

  /** Captures inputs and the result receiver. */
  constructor(options: IRebuildOptions, listener: IRebuildListener) {
    this.#options = options
    this.#listener = listener
  }

  /** Live generation. */
  get live(): IGeneration | undefined {
    return this.#live
  }

  /** Requests a rebuild; merged into a pending one while a rebuild runs. */
  request(): void {
    if (this.#stopped) return
    if (this.#running) {
      this.#pending = true
      return
    }
    this.#running = true
    this.#loop = this.#drain()
  }

  /** Runs one rebuild now and returns its failure, if any; used once at startup. */
  async first(): Promise<IDoctorFailure | undefined> {
    this.#running = true
    try {
      return await this.#rebuild()
    } finally {
      this.#running = false
    }
  }

  /** Stops accepting requests and waits for the running rebuild to finish. */
  async settle(): Promise<void> {
    this.#stopped = true
    this.#pending = false
    await this.#loop
  }

  /**
   * Rebuilds until no request is pending. A rebuild that throws is reported like a failed one, so
   * the loop always ends with `#running` reset and later changes still rebuild.
   */
  async #drain(): Promise<void> {
    try {
      do {
        this.#pending = false
        /** Failure of this rebuild. */
        const failure = await this.#rebuildReported()
        if (failure !== undefined) this.#listener.failed(failure)
      } while (this.#pending && !this.#stopped)
    } finally {
      this.#running = false
    }
  }

  /** One rebuild with a thrown error turned into a failure. */
  async #rebuildReported(): Promise<IDoctorFailure | undefined> {
    try {
      return await this.#rebuild()
    } catch (cause) {
      return { code: BUILD_FAILED, message: String((cause as Error)?.message ?? cause) }
    }
  }

  /** Bundles the page of one generation: the editor bridge entry in editor mode, else the page. */
  async #bundle(dir: string): Promise<void> {
    /** Page runtime module. */
    const runtime = await runtimeModule(this.#options.previewDir)
    /** Editor mode settings. */
    const editor = this.#options.editor
    await bundleEntry(
      join(this.#options.previewDir, 'src'),
      dir,
      editor === undefined
        ? pageEntrySource(this.#options.configPath, runtime)
        : editorEntrySource(this.#options.configPath, runtime, editor.origin, editor.remote),
      editor === undefined ? [] : EDITOR_CONDITIONS
    )
  }

  /** One rebuild; returns the failure or makes a new generation live. */
  async #rebuild(): Promise<IDoctorFailure | undefined> {
    /** Doctor result. */
    const doctor = await runDoctorChild(this.#options.projectDir, this.#options.config)
    if (!doctor.ok) return doctor.failure
    /** Generation being built. */
    const number = this.#next
    this.#next += 1
    /** Output directory of the generation. */
    const dir = join(this.#options.previewDir, String(number))
    try {
      mkdirSync(dir, { recursive: true })
      await this.#bundle(dir)
    } catch (cause) {
      rmSync(dir, { recursive: true, force: true })
      return { code: BUILD_FAILED, message: bundleMessage(cause) }
    }
    /** Previous live generation. */
    const previous = this.#live
    this.#live = {
      number,
      blueprints: doctor.blueprints,
      documents: await readDocuments(this.#options.projectDir, doctor.blueprints),
      dir
    }
    if (previous !== undefined) rmSync(previous.dir, { recursive: true, force: true })
    this.#listener.live(this.#live)
    return undefined
  }
}
