import { hashBytes, type ICapabilityManifest } from '@migaia/part-contract'
import {
  definePartPlugin,
  partCorePlugin,
  type IGenerationSignal,
  type IIsolatedRunner,
  type IPartHost,
  type IPartPlugin
} from '@migaia/part-host'
import { defineFeature } from '@migaia/plugin-host/features'
import { SnapshotCache, type ICacheBackend } from './cache.ts'
import type { IChunkLoaders } from './chunks.ts'
import { fetchSnapshot, projectBase, type IClientTarget } from './client.ts'
import { VersionInstaller, type IAcceptedVersion } from './install.ts'
import {
  defaultIsolatedWorker,
  IsolatedChannel,
  type IIsolatedWorkerFactory
} from './isolated-runner.ts'
import type { ISharedRuntime, ITrust } from './modules.ts'
import { DEFAULT_REVALIDATE_MS, REMOTE_PLUGIN } from './text.ts'

/** Options of `remotePlugin`. */
export type IRemoteOptions = IClientTarget & {
  readonly manifest: ICapabilityManifest
  readonly shared: ISharedRuntime
  readonly trust?: ITrust
  /** Byte channel of a storage-host backend (`backend(id)`), IndexedDB in browsers. */
  readonly cache: ICacheBackend
  /** Snapshot bytes inlined at build time, used when the cache is empty. */
  readonly fallback?: Uint8Array
  readonly chunks?: IChunkLoaders
  readonly revalidateMs?: number
  /** Creates the isolated Worker; defaults to the package's Worker script next to this module. */
  readonly isolatedWorker?: IIsolatedWorkerFactory
}

/** Version identity reported by `current()`. */
export type IRemoteCurrent = { readonly tag: string; readonly snapshot: string }

/** Core Features the client uses. */
type IClientDeps = {
  readonly runtime: { host(): IPartHost }
  readonly diagnostics: { report(error: unknown, address?: string): void }
  readonly effect: { setIsolatedRunner(runner: IIsolatedRunner | undefined): void }
}

/** True for the abort of a stopped client, which is never reported. */
function isAbort(error: unknown, signal: AbortSignal): boolean {
  return (
    signal.aborted &&
    (error === signal.reason || (error as { name?: unknown })?.name === 'AbortError')
  )
}

/**
 * Feature `remote`: keeps one host on the latest good version of a project environment. Boot uses
 * the cached version, else the inlined fallback, else the first fetch; then the snapshot is
 * revalidated with ETag in the background, on a timer, when the page becomes visible and on
 * `revalidate()`. One revalidation runs at a time. Failures keep the current version and are
 * reported once through the host's diagnostics.
 */
export class RemoteClient {
  /** Host receiving versions. */
  readonly #host: IPartHost
  /** Core Features. */
  readonly #deps: IClientDeps
  /** Plugin options. */
  readonly #options: IRemoteOptions
  /** Snapshot and module byte cache. */
  readonly #cache: SnapshotCache
  /** Isolated Worker channel. */
  readonly #channel: IsolatedChannel
  /** Version installer. */
  readonly #installer: VersionInstaller
  /** Cancels requests on stop. */
  readonly #abort = new AbortController()
  /** Current accepted version. */
  #current: IAcceptedVersion | undefined
  /** First-usable-version promise. */
  #ready: Promise<void> | undefined
  /** Revalidation in flight, shared by concurrent callers. */
  #inflight: Promise<void> | undefined
  /** Revalidation timer. */
  #timer: ReturnType<typeof setInterval> | undefined
  /** Visibility listener; revalidates when the page becomes visible. */
  readonly #onVisible = (): void => {
    if (globalThis.document?.visibilityState === 'visible') void this.#background()
  }

  /** Wires the client to its host Features and options. */
  constructor(deps: IClientDeps, options: IRemoteOptions) {
    this.#deps = deps
    this.#host = deps.runtime.host()
    this.#options = options
    this.#cache = new SnapshotCache(options.cache, options.project, options.env)
    this.#channel = new IsolatedChannel(options.isolatedWorker ?? defaultIsolatedWorker)
    this.#installer = new VersionInstaller(this.#host, {
      manifest: options.manifest,
      ...(options.chunks === undefined ? {} : { chunks: options.chunks }),
      source: {
        base: projectBase(options),
        ...(options.token === undefined ? {} : { token: options.token }),
        shared: options.shared,
        ...(options.trust === undefined ? {} : { trust: options.trust }),
        cache: this.#cache
      },
      channel: this.#channel,
      useIsolation: () => this.#useIsolation()
    })
  }

  /** Resolves once the first usable version is installed; rejects when none could be. */
  ready(): Promise<void> {
    return this.#ready ?? Promise.resolve()
  }

  /** Revalidates now; joins a revalidation already in flight. Rejects with the failure. */
  revalidate(): Promise<void> {
    this.#inflight ??= this.#revalidate().finally(() => {
      this.#inflight = undefined
    })
    return this.#inflight
  }

  /** Tag and snapshot hash of the current version. */
  current(): IRemoteCurrent | undefined {
    return this.#current === undefined
      ? undefined
      : { tag: this.#current.tag, snapshot: this.#current.snapshot }
  }

  /** Starts boot, the timer and the visibility listener; everything stops when `signal` aborts. */
  start(signal: IGenerationSignal): void {
    signal.addEventListener('abort', () => void this.#stop(), { once: true })
    this.#ready = this.#boot()
    this.#ready.catch(() => undefined)
  }

  /** Boot order: cached version, else fallback, else the first fetch; then background revalidation. */
  async #boot(): Promise<void> {
    /** Cached snapshot bytes. */
    const cached = await this.#cache.snapshot()
    if (cached !== null) await this.#accept(cached).catch((error: unknown) => this.#report(error))
    if (this.#current === undefined && this.#options.fallback !== undefined)
      await this.#accept(this.#options.fallback).catch((error: unknown) => this.#report(error))
    try {
      if (this.#current === undefined) await this.revalidate()
      else void this.#background()
    } finally {
      this.#schedule()
    }
  }

  /** Installs snapshot bytes over the current version and caches the result. */
  async #accept(bytes: Uint8Array): Promise<void> {
    /** Snapshot hash. */
    const snapshot = await hashBytes(bytes)
    // A stopped client must not install into a host generation that is going away.
    if (snapshot === this.#current?.snapshot || this.#abort.signal.aborted) return
    /** Previous version. */
    const previous = this.#current
    /** Installed version. */
    const next = await this.#installer.install(bytes, snapshot, previous)
    this.#current = next
    await this.#cache.store(bytes, next.modules, droppedModules(previous, next))
    this.#host.diagnostics.setContext({ version: next.tag, snapshot })
  }

  /**
   * One revalidation: request with the current hash, install on 200; a failure is reported and
   * rethrown.
   */
  async #revalidate(): Promise<void> {
    try {
      /** Fetch outcome. */
      const result = await fetchSnapshot(this.#options, this.#current?.snapshot, this.#abort.signal)
      if (result.status === 'changed') await this.#accept(result.bytes)
    } catch (error) {
      // Every failed revalidation is reported once, whoever asked for it; the caller still sees it.
      this.#report(error)
      throw error
    }
  }

  /** Revalidation whose failure is not thrown; `#revalidate` already reported it. */
  async #background(): Promise<void> {
    await this.revalidate().catch(() => undefined)
  }

  /** Reports a failure once through the host's diagnostics; the abort of a stop is not reported. */
  #report(error: unknown): void {
    if (!isAbort(error, this.#abort.signal)) this.#deps.diagnostics.report(error)
  }

  /** Starts the revalidation timer and the visibility listener. */
  #schedule(): void {
    if (this.#abort.signal.aborted) return
    this.#timer = setInterval(
      () => void this.#background(),
      this.#options.revalidateMs ?? DEFAULT_REVALIDATE_MS
    )
    globalThis.document?.addEventListener('visibilitychange', this.#onVisible)
  }

  /** Registers the channel as the host's isolated runner. */
  #useIsolation(): void {
    this.#deps.effect.setIsolatedRunner((effectId, event, ctx) =>
      this.#channel.run(effectId, event, ctx)
    )
  }

  /** Cancels requests, removes the timer and listener and closes the Worker. */
  async #stop(): Promise<void> {
    this.#abort.abort()
    clearInterval(this.#timer)
    globalThis.document?.removeEventListener('visibilitychange', this.#onVisible)
    if (this.#channel.active) this.#deps.effect.setIsolatedRunner(undefined)
    await this.#channel.close()
  }
}

/** Module ids the previous version cached that the next version no longer uses. */
function droppedModules(previous: IAcceptedVersion | undefined, next: IAcceptedVersion): string[] {
  if (previous === undefined) return []
  return [...previous.modules.keys()].filter((id) => !next.modules.has(id))
}

/** `onInstall` of the remote plugin: starts the client of this generation. */
function startClient(features: Readonly<Record<string, unknown>>, signal: IGenerationSignal): void {
  ;(features.remote as RemoteClient).start(signal)
}

/**
 * Remote delivery plugin. It provides Feature `remote` (`ready`, `revalidate`, `current`) and keeps
 * the host on the latest good version of `<service>/p/<project>/env/<env>`.
 */
export function remotePlugin(options: IRemoteOptions): IPartPlugin {
  return definePartPlugin({
    name: REMOTE_PLUGIN,
    features: {
      remote: defineFeature((_core, deps: IClientDeps) => new RemoteClient(deps, options), {
        runtime: partCorePlugin.getFeature('runtime'),
        diagnostics: partCorePlugin.getFeature('diagnostics'),
        effect: partCorePlugin.getFeature('effect')
      } as never)
    },
    onInstall: startClient
  })
}
