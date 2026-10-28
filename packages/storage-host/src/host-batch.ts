// One install batch of a storage host: PluginHost transaction, journal bootstrap and publication (see ./storage-host.ts).
import { STORAGE_JOURNAL_BOOTSTRAP_PREFIX } from './state-constants.ts'
import {
  definePlugin as defineNativePlugin,
  type IPluginConstraint,
  type IPluginHostCore
} from '@migaia/plugin-host'
import { StorageError } from './errors.ts'
import { StorageHostErrorCode } from '@migaia/storage-contract/error-code'
import { StorageErrorText } from './error-text.ts'
import { readStorageNativePluginMetadata } from './contracts.ts'
import type { IStorageBackendPluginHandle } from './types.ts'
import { pluginNameFromBackendId } from './names.ts'
import type {
  IStorageHostCore,
  IStorageInstallBatchContext,
  IStorageInstallEntryResult,
  IStorageBatchToken,
  IStorageNativeRegistrationContext,
  StorageHost
} from './storage-host.ts'

/** Run install batches through PluginHost and publish what each batch committed. */
export class StorageHostBatch {
  /** The host whose registry, extensions and journal owner a batch updates. */
  readonly #owner: StorageHost<any>

  /** Capture the owning host. */
  constructor(owner: StorageHost<any>) {
    this.#owner = owner
  }

  /** Reject a cancelled or losing batch before the next publication step. */
  assertBatchOwner(batchToken: IStorageBatchToken): void {
    if (
      !batchToken.active ||
      this.#owner.activeBatchToken !== batchToken ||
      this.#owner.state !== 'installing'
    ) {
      throw new StorageError(
        StorageHostErrorCode.storageHostDisposed,
        {},
        StorageErrorText.storageHostDisposed
      )
    }
  }

  /** Install one native batch using the canonical PluginHost transaction and existing deadline. */
  async runInstallBatch(
    plugins: readonly IStorageBackendPluginHandle[],
    batchToken: IStorageBatchToken
  ): Promise<void> {
    this.assertBatchOwner(batchToken)
    /** Resolve only trusted plugin identities before constructing backends. */
    const nativeMetadata = plugins.map((plugin) => {
      /** Read the captured storage-owned metadata without invoking native getters. */
      const metadata = readStorageNativePluginMetadata(plugin)
      if (metadata === undefined)
        throw new StorageError(
          StorageHostErrorCode.backendPluginInvalid,
          {},
          StorageErrorText.backendPluginInvalid
        )
      return metadata
    })
    this.#owner.journalOwner.admitJournalConfiguration(plugins)
    /**
     * Storage owns duplicate backend admission before any backend factory or PluginHost install
     * runs.
     */
    const admittedBackendIds = new Set(this.#owner.registry.keys())
    for (const [index] of plugins.entries()) {
      /** Check duplicate public ids independently of native name encoding. */
      const backendId = nativeMetadata[index]!.id
      if (admittedBackendIds.has(backendId))
        throw new StorageError(
          StorageHostErrorCode.backendDuplicate,
          {},
          StorageErrorText.backendDuplicate
        )
      admittedBackendIds.add(backendId)
    }
    this.assertBatchOwner(batchToken)
    /** Only the final original batch preparation admits already completed candidate reads. */
    const installState = { batchToken, preparingJournal: false } as IStorageInstallBatchContext
    /** Each batch entry retains exactly one original store handoff. */
    installState.nativeContexts = new Map<number, IStorageNativeRegistrationContext>()
    /** Materialize original definitions in the same order as native registration. */
    const entries = plugins.map((plugin, index) =>
      this.#owner.installer.createInstallEntry(installState, plugin, nativeMetadata[index]!, index)
    )
    /** Pass only the original definitions to the canonical install batch. */
    const materialized = entries.map((entry) => entry.plugin)
    /** A final original registration prepares candidates before the atomic public registry swap. */
    installState.installedJournalPipeline = false
    const candidates = [...installState.nativeContexts.values()]
    if (
      this.#owner.journalOwner.journal !== undefined &&
      (candidates.length !== 0 || !this.#owner.journalOwner.journalOrgs?.has(this.#owner.orgId))
    ) {
      materialized.push(
        defineNativePlugin(
          STORAGE_JOURNAL_BOOTSTRAP_PREFIX + (nativeMetadata[0]?.id ?? this.#owner.orgId),
          (core) => ({
            install: () => this.installJournalBootstrap(installState, candidates, core)
          })
        ) as (typeof materialized)[number]
      )
    }
    this.#owner.inner.setNativeContexts(
      new Map(
        [...installState.nativeContexts].map(([index, context]) => [
          pluginNameFromBackendId(nativeMetadata[index]!.id),
          context
        ])
      )
    )
    /** Committed native handles retain their original guarded extension methods. */
    const innerHandles = await this.#owner.inner.use(
      ...(materialized as IPluginConstraint<IStorageHostCore>[])
    )
    this.assertBatchOwner(batchToken)
    if (installState.installedJournalPipeline)
      this.#owner.journalOwner.journalPipelineInstalled = true
    this.publishInstallBatch(plugins, installState, entries, innerHandles)
  }

  /** Atomically publish the native handles only after the original PluginHost batch commits. */
  publishInstallBatch(
    plugins: readonly IStorageBackendPluginHandle[],
    installState: IStorageInstallBatchContext,
    entries: readonly IStorageInstallEntryResult[],
    innerHandles: readonly { readonly extensions: object }[]
  ): void {
    /** Prepare the next store registry before its atomic public swap. */
    const nextRegistry = new Map(this.#owner.registry)
    /** Merge original guarded descriptors without rebuilding extension methods. */
    const nextExtensions = Object.create(null) as Record<PropertyKey, unknown>
    for (const source of [
      this.#owner.publishedExtensions,
      ...innerHandles.map((handle) => handle.extensions)
    ])
      for (const key of Reflect.ownKeys(source)) {
        Object.defineProperty(nextExtensions, key, Object.getOwnPropertyDescriptor(source, key)!)
      }
    for (const [index] of plugins.entries()) {
      /** Retain only this entry original trusted definition metadata. */
      const native = installState.nativeContexts.get(index)
      this.#owner.extensionKeys.set(native!.id, Reflect.ownKeys(innerHandles[index]!.extensions))
      this.#owner.detectContexts.add(native!)
      if (native!.getKind() !== undefined) {
        nextRegistry.set(native!.id, entries[index]!.storeCell.get())
        this.#owner.storeContexts.set(entries[index]!.storeCell.get(), {
          context: native!,
          native: entries[index]!.storeCell.get()
        })
      }
    }
    this.#owner.registry = nextRegistry
    this.#owner.publishedExtensions = nextExtensions
    if (!this.#owner.detectRunning) this.#owner.detectPromise = undefined
  }

  /** Prepare journal candidates within the original batch deadline before native publication. */
  async installJournalBootstrap(
    installState: IStorageInstallBatchContext,
    candidates: readonly IStorageNativeRegistrationContext[],
    core: Pick<IPluginHostCore<never>, 'useAsyncPipeline'>
  ): Promise<Record<string, never>> {
    await this.prepareInstallJournal(installState, candidates)
    if (!this.#owner.journalOwner.journalPipelineInstalled) {
      core.useAsyncPipeline(async (input, next) => next(input))
      installState.installedJournalPipeline = true
    }
    return {}
  }

  /** Grant only the original bootstrap's temporary prepared-candidate authority. */
  async prepareInstallJournal(
    installState: IStorageInstallBatchContext,
    candidates: readonly IStorageNativeRegistrationContext[]
  ): Promise<void> {
    installState.preparingJournal = true
    try {
      await this.#owner.journalOwner.journalOptions(this.#owner.orgId, candidates)
      for (const context of candidates)
        if (context.getKind() !== undefined)
          await this.#owner.journalOwner.prepareJournalBackend(
            context,
            this.#owner.orgId,
            candidates
          ).promise
    } finally {
      installState.preparingJournal = false
    }
  }
}
