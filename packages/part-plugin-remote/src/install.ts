import {
  checkDelivery,
  parseSnapshot,
  type IBlueprint,
  type ICapabilityManifest,
  type IPartSnapshot
} from '@migaia/part-contract'
import type { IPartHost } from '@migaia/part-host'
import { preloadChunks, type IChunkLoaders } from './chunks.ts'
import { PartRemoteErrorCode } from './error-code.ts'
import { createPartRemoteError } from './errors.ts'
import type { IsolatedChannel } from './isolated-runner.ts'
import {
  currentRemoteModules,
  installRemoteModules,
  prepareModules,
  type IIsolatedModule,
  type IModuleSource,
  type IRemoteModuleEntry
} from './modules.ts'
import { PartRemoteText, REMOTE_MODULES_PLUGIN, RejectReason } from './text.ts'

/** A version the host accepted: its snapshot and what was installed for it. */
export type IAcceptedVersion = {
  readonly tag: string
  /** Snapshot hash (`hashBytes` of the snapshot bytes). */
  readonly snapshot: string
  readonly bytes: Uint8Array
  readonly parsed: IPartSnapshot
  readonly entries: readonly IRemoteModuleEntry[]
  readonly isolated: readonly IIsolatedModule[]
  /** Module bytes by id, cached once the version is accepted. */
  readonly modules: ReadonlyMap<string, Uint8Array>
}

/** What the installer needs besides the host. */
export type IInstallerOptions = {
  readonly manifest: ICapabilityManifest
  readonly chunks?: IChunkLoaders
  readonly source: IModuleSource
  readonly channel: IsolatedChannel
  /** Registers the channel as the host's isolated runner; called before isolated modules install. */
  readonly useIsolation: () => void
}

/** Wraps a failure as REMOTE_VERSION_REJECTED; integrity failures keep their own code. */
function rejected(tag: string, reason: string, cause: unknown, fields = {}): Error {
  if ((cause as { code?: unknown } | null)?.code === PartRemoteErrorCode.moduleIntegrity)
    return cause as Error
  return createPartRemoteError(
    PartRemoteErrorCode.versionRejected,
    PartRemoteText.versionRejected(tag, reason),
    cause,
    { tag, ...fields }
  )
}

/**
 * Installs versions into one host: delivery check, chunk preload, module fetch and import, then
 * remote definitions and blueprint updates. The install check of each blueprint is the host's own
 * `blueprint.update` pass (authored and resolved rules of every installed rule set); an error there
 * rolls the version back.
 */
export class VersionInstaller {
  /** Host receiving versions. */
  readonly #host: IPartHost
  /** Installer options. */
  readonly #options: IInstallerOptions
  /** Part ids whose chunks were loaded. */
  readonly #loadedChunks = new Set<string>()

  /** Binds the installer to a host. */
  constructor(host: IPartHost, options: IInstallerOptions) {
    this.#host = host
    this.#options = options
  }

  /**
   * Checks and installs snapshot `bytes` (hash `snapshot`) over `current`. On success the new
   * version is returned; on failure the host is restored to `current` and the error is thrown.
   */
  async install(
    bytes: Uint8Array,
    snapshot: string,
    current: IAcceptedVersion | undefined
  ): Promise<IAcceptedVersion> {
    /** Parsed snapshot. */
    const parsed = this.#parse(bytes)
    /** Tag of the version. */
    const tag = parsed.lock.tag
    /** Delivery check. */
    const delivery = checkDelivery(parsed, this.#options.manifest)
    if (!delivery.ok)
      throw rejected(
        tag,
        PartRemoteText.missingReason(delivery.missing),
        new TypeError(delivery.missing.join(', ')),
        {
          missing: delivery.missing
        }
      )
    try {
      await preloadChunks(this.#options.chunks, parsed.lock.definitions, this.#loadedChunks)
    } catch (cause) {
      throw rejected(tag, RejectReason.chunks, cause)
    }
    /** Fetched, verified and imported modules. */
    const prepared = await prepareModules(parsed.lock.modules, this.#options.source).catch(
      (cause: unknown) => Promise.reject(rejected(tag, RejectReason.modules, cause))
    )
    /** The accepted version, if installation completes. */
    const next: IAcceptedVersion = {
      tag,
      snapshot,
      bytes,
      parsed,
      entries: prepared.entries,
      isolated: prepared.isolated,
      modules: prepared.bytes
    }
    /** Blueprint ids updated so far, for rollback. */
    const updated: string[] = []
    try {
      await this.#installDefinitions(next)
      for (const blueprint of parsed.blueprints) {
        updated.push(blueprint.id)
        await this.#update(blueprint)
      }
    } catch (cause) {
      await this.#restore(current, updated)
      throw rejected(tag, RejectReason.install, cause)
    }
    return next
  }

  /** Parses snapshot bytes; a malformed snapshot is rejected with its tag unknown. */
  #parse(bytes: Uint8Array): IPartSnapshot {
    try {
      return parseSnapshot(bytes)
    } catch (cause) {
      throw rejected('', RejectReason.install, cause)
    }
  }

  /**
   * Hands the Worker the version's isolated modules first (when any exist or a Worker runs), then
   * installs every definition as one `remote:modules` plugin.
   */
  async #installDefinitions(version: IAcceptedVersion): Promise<void> {
    if (version.isolated.length > 0 || this.#options.channel.active) {
      this.#options.useIsolation()
      await this.#options.channel.load(version.isolated)
    }
    await installRemoteModules(this.#host, version.entries)
  }

  /** Updates one blueprint; an error result throws so the version rolls back. */
  async #update(blueprint: IBlueprint): Promise<void> {
    /** Host result. */
    const result = await this.#host.blueprint.update(blueprint)
    /** Error issues of the pass. */
    const errors = result.issues.filter((issue) => issue.severity === 'error')
    if (errors.length > 0)
      throw createPartRemoteError(
        PartRemoteErrorCode.versionRejected,
        PartRemoteText.blueprintFailed(blueprint.id),
        new AggregateError(errors, PartRemoteText.blueprintFailed(blueprint.id))
      )
  }

  /**
   * Restores `current` after a failed install: updated blueprints get their old documents back
   * (blueprints new in the failed version stay loaded; unmounting them is the application's), the
   * old `remote:modules` returns (or is removed on a first install) and the Worker reloads the old
   * isolated modules.
   */
  async #restore(current: IAcceptedVersion | undefined, updated: readonly string[]): Promise<void> {
    if (current === undefined) {
      if (currentRemoteModules(this.#host) !== undefined)
        await this.#host.unUse(REMOTE_MODULES_PLUGIN)
      if (this.#options.channel.active) await this.#options.channel.load([])
      return
    }
    await this.#installDefinitions(current)
    /** Old documents by id. */
    const before = new Map(current.parsed.blueprints.map((blueprint) => [blueprint.id, blueprint]))
    for (const id of updated) {
      /** Old document of the blueprint. */
      const old = before.get(id)
      if (old !== undefined) await this.#host.blueprint.update(old)
    }
  }
}
