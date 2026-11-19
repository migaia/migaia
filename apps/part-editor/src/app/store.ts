import {
  mergeBlueprint,
  type IBlueprint,
  type IChangesetArtifact,
  type IChangesetResult,
  type IDescriptor,
  type IIssue,
  type IJsonPatchOperation,
  type IMergeConflict,
  type IRemoteModuleRef
} from '@migaia/part-contract'
import { CatalogApi, type IApiResult, type IDraftView } from './api.ts'
import type { PreviewBridge } from './preview.ts'
import { EditorDocument } from './document.ts'
import { authoredIssues, mergedIssues } from './issues.ts'

/** Session storage key of the write token; the token never goes to local storage. */
export const TOKEN_KEY = 'part-editor.token'

/** Session storage key of the project name. */
export const PROJECT_KEY = 'part-editor.project'

/** Page phases. */
export const Phase = { login: 'login', loading: 'loading', ready: 'ready' } as const

/** One page phase. */
export type Phase = keyof typeof Phase

/** Status bar messages. */
export const StatusText = {
  unauthorized: (status: number): string => `token rejected (${status})`,
  failed: (status: number, body: string): string => `catalog request failed (${status}): ${body}`,
  saved: 'saved',
  rejected: 'some artifacts were rejected',
  previewFailed: (message: string): string => `preview could not load the modules: ${message}`,
  merged: 'merged with the newer draft; save again',
  conflicts: (count: number): string => `${count} conflicts; choose a side and save again`,
  moduleConflicts: (names: readonly string[]): string =>
    `changed on the server meanwhile: ${names.join(', ')}; saving again keeps your version`,
  draftConflicts: (count: number): string => `dev moved to a new version; ${count} conflicts`
} as const

/**
 * One remote module being edited: draft source (absent for build-only modules), base hash and
 * build.
 */
export type IEditorModule = {
  readonly name: string
  readonly source: string | undefined
  readonly base: string | null
  readonly built?: IRemoteModuleRef
  readonly dirty: boolean
}

/** A merge conflict waiting for the user's choice. */
export type IPendingConflict = IMergeConflict & {
  readonly blueprint: string
  /** Server document to take the conflicted group from when the user keeps theirs. */
  readonly theirs: IBlueprint
}

/**
 * Editor state: session, loaded draft and catalog, documents being edited, selection, issues from
 * the local rule run and the preview, and save results. Views subscribe and read `snapshot()`.
 */
export class EditorStore {
  /** Catalog base URL. */
  readonly #service: string
  /** Listeners notified after each change. */
  readonly #listeners = new Set<() => void>()
  /** Change counter; views compare it to re-render. */
  #version = 0
  /** Page phase. */
  phase: Phase = Phase.login
  /** Status bar text. */
  status = ''
  /** Catalog client of the session. */
  api: CatalogApi | undefined
  /** Project of the session. */
  project = ''
  /** Loaded draft. */
  draft: IDraftView | undefined
  /** Catalog descriptors (dev snapshot plus draft module exports). */
  descriptors: readonly IDescriptor[] = []
  /** Documents by blueprint id, in draft order. */
  readonly documents = new Map<string, EditorDocument>()
  /** Selected blueprint id. */
  selected: string | undefined
  /** Selected node address. */
  address: string | undefined
  /** Issues the preview sent back, by blueprint id. */
  readonly previewIssues = new Map<string, readonly IIssue[]>()
  /** Per-artifact outcome of the last save. */
  lastResult: IChangesetResult | undefined
  /** Conflicts waiting for a choice. */
  conflicts: IPendingConflict[] = []
  /** Remote modules of the draft plus new local ones, by name. */
  readonly modules = new Map<string, IEditorModule>()
  /** Selected module name; the middle column edits it instead of a node. */
  module: string | undefined
  /** Save issues of each module, by name. */
  readonly moduleIssues = new Map<string, readonly IIssue[]>()
  /** Preview bridge, once the iframe exists. */
  #bridge: PreviewBridge | undefined
  /** Token of the session, sent to the preview with module references. */
  #token = ''

  /** Binds the store to the catalog. */
  constructor(service: string) {
    this.#service = service
  }

  /** Subscribes to changes; returns the removal. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /** Change counter for `useSyncExternalStore`. */
  snapshot(): number {
    return this.#version
  }

  /** Notifies every listener. */
  changed(): void {
    this.#version += 1
    for (const listener of this.#listeners) listener()
  }

  /** Token and project kept for this tab, if any. */
  remembered(): { readonly token: string; readonly project: string } | undefined {
    /** Stored token. */
    const token = sessionStorage.getItem(TOKEN_KEY)
    /** Stored project. */
    const project = sessionStorage.getItem(PROJECT_KEY)
    return token === null || project === null ? undefined : { token, project }
  }

  /** Starts a session: stores the token for this tab only and loads the draft and the catalog. */
  async login(token: string, project: string): Promise<void> {
    sessionStorage.setItem(TOKEN_KEY, token)
    sessionStorage.setItem(PROJECT_KEY, project)
    this.api = new CatalogApi(this.#service, project, token)
    this.project = project
    this.#token = token
    this.phase = Phase.loading
    this.changed()
    await this.load()
  }

  /** Loads the draft and the catalog; a 401 returns to the token form. */
  async load(): Promise<void> {
    /** Draft. */
    const draft = await (this.api as CatalogApi).draft()
    /** Catalog. */
    const catalog = draft.ok ? await (this.api as CatalogApi).catalog() : draft
    if (!draft.ok || !catalog.ok)
      return this.#failed((draft.ok ? catalog : draft) as Extract<IApiResult<never>, { ok: false }>)
    this.draft = draft.value
    this.descriptors = catalog.value
    this.documents.clear()
    for (const item of draft.value.blueprints)
      this.documents.set(item.id, new EditorDocument(item.document, item.hash))
    this.modules.clear()
    for (const item of draft.value.modules)
      this.modules.set(item.name, {
        name: item.name,
        source: item.source,
        base: item.hash,
        built: item.built,
        dirty: false
      })
    this.selected ??= draft.value.blueprints[0]?.id
    this.phase = Phase.ready
    this.status =
      draft.value.conflicts.length > 0
        ? StatusText.draftConflicts(draft.value.conflicts.length)
        : ''
    this.changed()
  }

  /** Records a failed call: 401/403 return to the token form, others go to the status bar. */
  #failed(result: Extract<IApiResult<never>, { ok: false }>): void {
    if (result.status === 401 || result.status === 403) {
      sessionStorage.removeItem(TOKEN_KEY)
      this.phase = Phase.login
      this.status = StatusText.unauthorized(result.status)
    } else this.status = StatusText.failed(result.status, result.body)
    this.changed()
  }

  /** Document of the selected blueprint. */
  document(): EditorDocument | undefined {
    return this.selected === undefined ? undefined : this.documents.get(this.selected)
  }

  /** Descriptor by id. */
  descriptor(id: string): IDescriptor | undefined {
    return this.descriptors.find((descriptor) => descriptor.id === id)
  }

  /** Selects a blueprint. */
  selectBlueprint(id: string): void {
    this.selected = id
    this.address = undefined
    this.module = undefined
    this.#sendBlueprint()
    this.changed()
  }

  /** Selects a module for editing. */
  selectModule(name: string): void {
    this.module = name
    this.changed()
  }

  /** Replaces the source of a module (a module without source is read-only). */
  editModule(name: string, source: string): void {
    /** Module. */
    const module = this.modules.get(name)
    if (module === undefined || module.source === undefined) return
    this.modules.set(name, { ...module, source, dirty: true })
    this.changed()
  }

  /** Adds a new module from the template; an existing name is only selected. */
  newModule(name: string, source: string): void {
    if (!this.modules.has(name)) this.modules.set(name, { name, source, base: null, dirty: true })
    this.module = name
    this.changed()
  }

  /** Connects the preview bridge. */
  attachPreview(bridge: PreviewBridge): void {
    this.#bridge = bridge
  }

  /** The preview could not load modules: shown in the status bar. */
  previewFailed(message: string): void {
    this.status = StatusText.previewFailed(message)
    this.changed()
  }

  /** The preview is ready: sends the selected blueprint. */
  previewReady(): void {
    this.#sendBlueprint()
  }

  /** Sends the selected document to the preview. */
  #sendBlueprint(): void {
    /** Selected document. */
    const document = this.document()
    if (document !== undefined) this.#bridge?.blueprint(document.current)
  }

  /** Selects a node address. */
  selectAddress(address: string): void {
    this.address = address
    this.module = undefined
    this.changed()
  }

  /** Applies operations to the selected document. */
  edit(operations: readonly IJsonPatchOperation[]): void {
    if (operations.length === 0) return
    this.document()?.apply(operations)
    this.#sendBlueprint()
    this.changed()
  }

  /** Issues of the selected document: local authored run merged with the preview's. */
  issues(): IIssue[] {
    /** Selected document. */
    const document = this.document()
    if (document === undefined) return []
    return mergedIssues(
      authoredIssues(document.current, this.descriptors),
      this.previewIssues.get(document.id) ?? []
    )
  }

  /** Applies an issue's fix and drops the preview issue it answers until the next preview report. */
  fix(issue: IIssue): void {
    if (issue.fix === undefined) return
    /** Selected document. */
    const document = this.document()
    if (document === undefined) return
    this.previewIssues.set(
      document.id,
      (this.previewIssues.get(document.id) ?? []).filter((item) => item !== issue)
    )
    this.edit(issue.fix)
  }

  /** Records the issues the preview reported for a blueprint. */
  setPreviewIssues(blueprintId: string, issues: readonly IIssue[]): void {
    this.previewIssues.set(blueprintId, issues)
    this.changed()
  }

  /** Changeset artifacts of every edited blueprint: one whole-root replacement over its base. */
  #artifacts(): IChangesetArtifact[] {
    /** Artifacts. */
    const artifacts: IChangesetArtifact[] = []
    for (const document of this.documents.values())
      if (document.dirty)
        artifacts.push({
          kind: 'blueprint',
          id: document.id,
          base: document.base,
          patch: [{ op: 'replace', path: '/root', value: document.current.root }]
        })
    for (const module of this.modules.values())
      if (module.dirty && module.source !== undefined)
        artifacts.push({
          kind: 'module',
          name: module.name,
          base: module.base,
          source: module.source
        })
    return artifacts
  }

  /** Saves pending edits as one changeset; a conflict merges with the newer draft. */
  async save(): Promise<void> {
    /** Artifacts to send. */
    const artifacts = this.#artifacts()
    if (artifacts.length === 0 || this.api === undefined || this.draft === undefined) return
    /** Result. */
    const result = await this.api.changeset({
      project: this.project,
      provenance: { authorKind: 'human' },
      artifacts
    })
    if (!result.ok) return this.#failed(result)
    this.lastResult = result.value
    for (const item of result.value.artifacts)
      if (this.modules.has(item.key)) this.moduleIssues.set(item.key, item.issues)
    if (result.value.artifacts.some((item) => item.status === 'conflict')) await this.#merge()
    else {
      await this.#refresh(
        new Set(
          result.value.artifacts
            .filter((item) => item.status === 'accepted')
            .map((item) => item.key)
        )
      )
      this.status = result.value.ok ? StatusText.saved : StatusText.rejected
    }
    this.changed()
  }

  /**
   * Re-reads the draft after a save: accepted blueprints take their new hash, accepted modules
   * their new hash and build, and the preview loads the accepted modules before the blueprint.
   */
  async #refresh(accepted: ReadonlySet<string>): Promise<void> {
    /** Fresh draft. */
    const fresh = await (this.api as CatalogApi).draft()
    if (!fresh.ok) return this.#failed(fresh)
    this.draft = fresh.value
    for (const item of fresh.value.blueprints)
      if (accepted.has(item.id)) this.documents.get(item.id)?.saved(item.hash)
    /** Built references of the accepted modules. */
    const refs: IRemoteModuleRef[] = []
    for (const item of fresh.value.modules)
      if (accepted.has(item.name)) {
        this.modules.set(item.name, {
          name: item.name,
          source: item.source,
          base: item.hash,
          built: item.built,
          dirty: false
        })
        refs.push(item.built)
      }
    /** Catalog with the new module exports. */
    const catalog = await (this.api as CatalogApi).catalog()
    if (catalog.ok) this.descriptors = catalog.value
    this.#bridge?.modules(refs, (this.api as CatalogApi).base, this.#token)
    this.#sendBlueprint()
  }

  /**
   * Re-reads the draft and merges every dirty document three ways (read, local, server). Without
   * conflicts the merge becomes the new local document over the new base; conflicts wait for a
   * choice and keep the local values meanwhile.
   */
  async #merge(): Promise<void> {
    /** Fresh draft. */
    const fresh = await (this.api as CatalogApi).draft()
    if (!fresh.ok) return this.#failed(fresh)
    this.draft = fresh.value
    this.conflicts = []
    for (const item of fresh.value.blueprints) {
      /** Local document. */
      const document = this.documents.get(item.id)
      if (document === undefined || !document.dirty) {
        this.documents.set(item.id, new EditorDocument(item.document, item.hash))
        continue
      }
      /** Merge result. */
      const merged = mergeBlueprint(document.read, document.current, item.document)
      document.rebase(item.document, item.hash, merged.merged)
      for (const conflict of merged.conflicts)
        this.conflicts.push({ ...conflict, blueprint: item.id, theirs: item.document })
    }
    /** Edited modules the server changed meanwhile; module sources cannot be merged. */
    const overwritten = this.#rebaseModules(fresh.value.modules)
    if (this.conflicts.length > 0) this.status = StatusText.conflicts(this.conflicts.length)
    else if (overwritten.length > 0) this.status = StatusText.moduleConflicts(overwritten)
    else this.status = StatusText.merged
    this.#sendBlueprint()
  }

  /**
   * Moves modules onto the fresh draft: unedited ones take the server version; edited ones keep the
   * local source over the server's hash, so the next save replaces the server version. Returns the
   * names of edited modules whose server version changed, for the status text.
   */
  #rebaseModules(fresh: IDraftView['modules']): string[] {
    /** Edited modules whose server hash moved. */
    const overwritten: string[] = []
    for (const item of fresh) {
      /** Local module. */
      const local = this.modules.get(item.name)
      if (local === undefined || !local.dirty) {
        this.modules.set(item.name, {
          name: item.name,
          source: item.source,
          base: item.hash,
          built: item.built,
          dirty: false
        })
      } else if (local.base !== item.hash) {
        this.modules.set(item.name, { ...local, base: item.hash })
        overwritten.push(item.name)
      }
    }
    return overwritten
  }

  /** Resolves one conflict: keeps the local value, or takes the server's group value. */
  resolve(conflict: IPendingConflict, keep: 'ours' | 'theirs'): void {
    this.conflicts = this.conflicts.filter((item) => item !== conflict)
    if (keep === 'theirs') {
      /** Document of the conflict. */
      const document = this.documents.get(conflict.blueprint)
      /** Server value at the conflict pointer; absent when the server removed it. */
      const value = valueAt(conflict.theirs, conflict.path)
      document?.apply([
        value === undefined
          ? { op: 'remove', path: conflict.path }
          : { op: 'replace', path: conflict.path, value }
      ])
      this.#sendBlueprint()
    }
    this.changed()
  }
}

/** Value at a JSON Pointer of a document. */
function valueAt(document: unknown, pointer: string): unknown {
  /** Cursor. */
  let cursor = document as Record<string, unknown> | undefined
  for (const raw of pointer.split('/').slice(1))
    cursor = cursor?.[raw.replace(/~1/g, '/').replace(/~0/g, '~')] as
      | Record<string, unknown>
      | undefined
  return cursor
}
