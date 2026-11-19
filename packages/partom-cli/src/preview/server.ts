import { rmSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { ExitCode, flag, type IArgs } from '../args.ts'
import { PartCliErrorCode, type IPartCliErrorCode } from '../error-code.ts'
import { createPartCliError, PartCliText } from '../errors.ts'
import { Project } from '../project.ts'
import {
  BUILD_FAILED,
  PREVIEW_DIR,
  PREVIEW_PORT_FIRST,
  PREVIEW_PORT_LAST,
  PreviewRoute
} from './constants.ts'
import type { IDoctorBlueprint } from './doctor-child.ts'
import { Rebuilder, type IRebuildOptions } from './rebuild.ts'
import { releaseData } from '../release/child.ts'
import { remoteEntries } from '../release/collect.ts'
import { ReleaseMode } from '../release/text.ts'
import { PreviewRoutes } from './routes.ts'
import { ProjectWatcher } from './watch.ts'

/** Loopback host; the preview never listens on other interfaces. */
const HOST = '127.0.0.1'

/** Whether an error from `Bun.serve` means the port is taken. */
function isAddressInUse(error: unknown): boolean {
  return (error as { code?: unknown } | undefined)?.code === 'EADDRINUSE'
}

/** Starts the server on the given port, or the first free one of 4400–4419. */
function listen(routes: PreviewRoutes, port: number | undefined): ReturnType<typeof Bun.serve> {
  /** Ports to try in order. */
  const candidates: number[] = []
  if (port !== undefined) candidates.push(port)
  else
    for (let next = PREVIEW_PORT_FIRST; next <= PREVIEW_PORT_LAST; next += 1) candidates.push(next)
  for (const candidate of candidates) {
    try {
      return Bun.serve({
        hostname: HOST,
        port: candidate,
        idleTimeout: 0,
        fetch: (request) => routes.fetch(request)
      })
    } catch (error) {
      if (!isAddressInUse(error)) throw error
    }
  }
  throw createPartCliError(
    PartCliErrorCode.portInUse,
    PartCliText.portInUse(
      port === undefined ? `${PREVIEW_PORT_FIRST}-${PREVIEW_PORT_LAST}` : String(port)
    )
  )
}

/** Blueprint matching a target: by id, or by file path relative to the working directory. */
function findTarget(
  blueprints: readonly IDoctorBlueprint[],
  projectDir: string,
  target: string
): IDoctorBlueprint {
  /** Absolute path the target names, when read as a file. */
  const asFile = resolve(target)
  /** Matching blueprint. */
  const match = blueprints.find(
    (entry) => entry.id === target || resolve(projectDir, entry.file) === asFile
  )
  if (match === undefined)
    throw createPartCliError(
      PartCliErrorCode.blueprintNotFound,
      PartCliText.blueprintNotFound(target)
    )
  return match
}

/** Parses `--port`; a value that is not a port number is a usage error. */
function portOf(args: IArgs): number | undefined {
  /** Raw flag value. */
  const raw = flag(args, '--port')
  if (raw === undefined) return undefined
  /** Parsed port. */
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw createPartCliError(PartCliErrorCode.usageInvalid, PartCliText.usage)
  return port
}

/**
 * One preview run: project checks, first rebuild, loopback server, watcher, and the shutdown that a
 * signal triggers. Resources are released in reverse order: event streams, watcher, server,
 * rebuilds, preview directory.
 */
class PreviewSession {
  /** Routes and event hub. */
  readonly #routes = new PreviewRoutes()
  /** Preview working directory. */
  readonly #dir: string
  /** Running server. */
  #server: ReturnType<typeof Bun.serve> | undefined
  /** File watcher. */
  #watcher: ProjectWatcher | undefined
  /** Rebuilds. */
  readonly #rebuilder: Rebuilder
  /** Resolves the run's exit code at shutdown. */
  readonly #done: PromiseWithResolvers<number> = Promise.withResolvers<number>()
  /** Whether shutdown started. */
  #closing = false

  /** Prepares the preview directory and rebuild inputs; `editor` selects the bridge mode. */
  constructor(
    project: Project,
    configPath: string,
    config: string | undefined,
    editor: IRebuildOptions['editor']
  ) {
    this.#dir = join(project.dir, PREVIEW_DIR)
    rmSync(this.#dir, { recursive: true, force: true })
    this.#rebuilder = new Rebuilder(
      {
        projectDir: project.dir,
        configPath,
        config,
        previewDir: this.#dir,
        ...(editor === undefined ? {} : { editor })
      },
      this.#routes
    )
  }

  /**
   * Builds the first generation, resolves the target, starts serving and watching, and prints the
   * URL lines. Startup failures remove the preview directory and propagate.
   */
  async start(
    project: Project,
    target: string | undefined,
    port: number | undefined
  ): Promise<void> {
    try {
      /** First rebuild's failure. */
      const failure = await this.#rebuilder.first()
      if (failure !== undefined)
        throw createPartCliError(
          failure.code === BUILD_FAILED
            ? PartCliErrorCode.harnessFailed
            : (failure.code as IPartCliErrorCode),
          failure.message
        )
      if (this.#closing) {
        // A signal arrived during the first rebuild: stop() already ran, so only remove the
        // generation that rebuild may have written.
        rmSync(this.#dir, { recursive: true, force: true })
        return
      }
      /** Live generation after the first rebuild; the rebuild already handed it to the routes. */
      const generation = this.#rebuilder.live
      if (generation === undefined)
        throw createPartCliError(PartCliErrorCode.harnessFailed, PartCliText.harnessFailed)
      /** Target blueprint, when one was named. */
      const chosen =
        target === undefined ? undefined : findTarget(generation.blueprints, project.dir, target)
      this.#server = listen(this.#routes, port)
      /** Base URL. */
      const base = `http://${HOST}:${this.#server.port}/`
      console.log(JSON.stringify({ url: base }))
      if (chosen !== undefined)
        console.log(
          JSON.stringify({
            url: `${base}${PreviewRoute.blueprint.slice(1)}${encodeURIComponent(chosen.id)}`
          })
        )
      this.#watcher = new ProjectWatcher(project.dir, () => this.#rebuilder.request())
    } catch (error) {
      this.#server?.stop(true)
      rmSync(this.#dir, { recursive: true, force: true })
      throw error
    }
  }

  /** Exit code promise, resolved by `stop`. */
  get done(): Promise<number> {
    return this.#done.promise
  }

  /** Shuts down once; repeated signals do nothing. */
  async stop(): Promise<void> {
    if (this.#closing) return
    this.#closing = true
    this.#routes.hub.closeAll()
    this.#watcher?.close()
    this.#server?.stop(true)
    await this.#rebuilder.settle()
    rmSync(this.#dir, { recursive: true, force: true })
    this.#done.resolve(ExitCode.ok)
  }

  /** Signal listener for SIGINT and SIGTERM; a field so the same function can be removed. */
  readonly onSignal = (): void => void this.stop()
}

/**
 * Editor bridge settings of `--editor --editor-origin <url>`, with the project's remote module
 * entries read through the release child; undefined without `--editor`.
 */
async function editorMode(
  args: IArgs,
  dir: string,
  config: string | undefined
): Promise<IRebuildOptions['editor']> {
  if (!args.flags.has('--editor')) return undefined
  /** Editor origin. */
  const origin = flag(args, '--editor-origin')
  if (origin === undefined || origin === '')
    throw createPartCliError(PartCliErrorCode.usageInvalid, PartCliText.usage)
  /** Release settings. */
  const data = await releaseData(dir, config, [ReleaseMode.release])
  /** Remote module root. */
  const root = data.release.remote === undefined ? dir : resolve(dir, data.release.remote.root)
  return {
    origin: new URL(origin).origin,
    remote: remoteEntries(dir, data.release).map((file) => ({
      name: relative(root, file).split(sep).join('/'),
      file
    }))
  }
}

/**
 * Runs `partom preview [<id|file>] [--port <n>] [--config <path>]`. Resolves project dependencies
 * and the config first (exit 2 on failure), then serves until SIGINT or SIGTERM and returns 0.
 */
export async function previewCommand(args: IArgs): Promise<number> {
  /** Project of the working directory; a missing dependency throws here. */
  const project = new Project(flag(args, '--project') ?? process.cwd())
  /** Explicit config flag. */
  const config = flag(args, '--config')
  /** Config path; a missing config throws here. */
  const configPath = project.configPath(config)
  /** Port flag. */
  const port = portOf(args)
  /** Preview run. */
  const session = new PreviewSession(
    project,
    configPath,
    config,
    await editorMode(args, project.dir, config)
  )
  process.on('SIGINT', session.onSignal)
  process.on('SIGTERM', session.onSignal)
  try {
    await session.start(project, args.positional[1], port)
    return await session.done
  } finally {
    process.off('SIGINT', session.onSignal)
    process.off('SIGTERM', session.onSignal)
  }
}
