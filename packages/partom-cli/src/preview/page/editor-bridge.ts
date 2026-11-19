/**
 * Editor bridge of `partom preview --editor` (protocol `editor-bridge` 1). The page owns one host
 * with the project's plugins, devtools and the project's remote modules as `remote:modules`. It
 * accepts messages only from the editor origin: `blueprint` updates and mounts a document,
 * `modules` hot-replaces remote modules by name; every update's issues go back to the editor.
 */
import { EditorMessage, PREVIEW_LOADS_KEY } from '../constants.ts'

/** A plugin as the page sees it. */
type IPagePlugin = { readonly name?: string }

/** One issue as the page forwards it; `cause` is dropped because it may not clone. */
type IForwardedIssue = Readonly<Record<string, unknown>>

/** Host surface the bridge uses. */
type IBridgeHost = {
  readonly blueprint: {
    update(input: unknown): Promise<{
      readonly blueprintId: string
      readonly tree: unknown
      readonly issues: readonly IForwardedIssue[]
    }>
  }
  mount(target: unknown, blueprintId: string): { unmount(): void }
}

/** What the generated editor entry hands to the bridge. */
export type IEditorDeps = {
  readonly origin: string
  readonly plugins: readonly IPagePlugin[]
  readonly createPartHost: (options: {
    readonly plugins: readonly IPagePlugin[]
  }) => Promise<unknown>
  readonly loadRemoteModules: (
    host: unknown,
    refs: readonly unknown[],
    options: object
  ) => Promise<void>
  readonly shared: Readonly<Record<string, unknown>>
}

/** Rule of a message the page cannot read. */
const INVALID_RULE = 'SNAPSHOT_INVALID'

/** Forwardable copy of an issue. */
function forwardIssue(issue: IForwardedIssue): IForwardedIssue {
  /** Issue without its cause. */
  const { cause: _cause, ...rest } = issue
  return rest
}

/** Error fields the editor shows for a failed module load. */
function errorFields(error: unknown): { source?: unknown; code?: unknown; message: string } {
  /** Error-like view. */
  const value = (error ?? {}) as { source?: unknown; code?: unknown; message?: unknown }
  return { source: value.source, code: value.code, message: String(value.message ?? error) }
}

/** The page side of the bridge: one host, one mount at a time, messages from the editor only. */
export class EditorBridgePage {
  /** Bridge dependencies. */
  readonly #deps: IEditorDeps
  /** Mount container. */
  readonly #root: HTMLElement
  /** Host of the preview. */
  #host: IBridgeHost | undefined
  /** Blueprint currently mounted and its handle. */
  #mounted: { readonly id: string; readonly handle: { unmount(): void } } | undefined
  /** Message work, serialized so updates apply in arrival order. */
  #queue: Promise<void> = Promise.resolve()

  /** Binds the bridge to its dependencies and container. */
  constructor(deps: IEditorDeps, root: HTMLElement) {
    this.#deps = deps
    this.#root = root
  }

  /** Creates the host, listens for editor messages and tells the editor the page is ready. */
  async start(): Promise<void> {
    /** Page loads in this tab, for checking that hot updates never reload the page. */
    const loads = Number(sessionStorage.getItem(PREVIEW_LOADS_KEY) ?? '0') + 1
    sessionStorage.setItem(PREVIEW_LOADS_KEY, String(loads))
    this.#host = (await this.#deps.createPartHost({ plugins: this.#deps.plugins })) as IBridgeHost
    window.addEventListener('message', this)
    this.#post({ kind: EditorMessage.ready })
  }

  /** Message listener: ignores other origins, queues editor messages. */
  handleEvent(event: Event): void {
    /** Message event. */
    const message = event as MessageEvent
    if (message.origin !== this.#deps.origin) return
    this.#queue = this.#queue.then(() => this.#handle(message.data))
  }

  /** Handles one editor message. */
  async #handle(data: unknown): Promise<void> {
    /** Message fields. */
    const message = (data ?? {}) as {
      kind?: unknown
      document?: unknown
      modules?: unknown
      base?: unknown
      token?: unknown
    }
    if (
      message.kind === EditorMessage.blueprint &&
      typeof message.document === 'object' &&
      message.document !== null
    )
      return this.#blueprint(message.document)
    if (
      message.kind === EditorMessage.modules &&
      Array.isArray(message.modules) &&
      typeof message.base === 'string'
    )
      return this.#modules(
        message.modules,
        message.base,
        typeof message.token === 'string' ? message.token : undefined
      )
    this.#post({
      kind: EditorMessage.issues,
      blueprintId: '',
      issues: [
        {
          address: '',
          facet: '',
          path: '',
          code: INVALID_RULE,
          rule: INVALID_RULE,
          messageKey: INVALID_RULE,
          severity: 'error'
        }
      ]
    })
  }

  /** Updates (first time: loads) a blueprint, mounts it when it resolved, and reports its issues. */
  async #blueprint(document: unknown): Promise<void> {
    /** Host. */
    const host = this.#host as IBridgeHost
    /** Update result. */
    let result: Awaited<ReturnType<IBridgeHost['blueprint']['update']>>
    try {
      result = await host.blueprint.update(document)
    } catch (error) {
      this.#post({
        kind: EditorMessage.issues,
        blueprintId: String((document as { id?: unknown }).id ?? ''),
        issues: [
          {
            address: '',
            facet: '',
            path: '',
            code: INVALID_RULE,
            rule: INVALID_RULE,
            messageKey: errorFields(error).message,
            severity: 'error'
          }
        ]
      })
      return
    }
    if (result.tree !== undefined && this.#mounted?.id !== result.blueprintId) {
      this.#mounted?.handle.unmount()
      this.#mounted = { id: result.blueprintId, handle: host.mount(this.#root, result.blueprintId) }
    }
    this.#post({
      kind: EditorMessage.issues,
      blueprintId: result.blueprintId,
      issues: result.issues.map(forwardIssue)
    })
  }

  /** Loads draft modules over `remote:modules` (same-name replacement); every module at tier `page`. */
  async #modules(
    modules: readonly unknown[],
    base: string,
    token: string | undefined
  ): Promise<void> {
    /** Trust: the preview runs on the developer's machine, so every module runs at tier `page`. */
    const trust = Object.fromEntries(
      modules.map((module) => [(module as { name: string }).name, { tier: 'page' }])
    )
    try {
      await this.#deps.loadRemoteModules(this.#host, modules, {
        base,
        ...(token === undefined ? {} : { token }),
        shared: this.#deps.shared,
        trust
      })
      this.#post({ kind: EditorMessage.modulesLoaded })
    } catch (error) {
      this.#post({ kind: EditorMessage.modulesFailed, error: errorFields(error) })
    }
  }

  /** Posts to the editor origin only. */
  #post(message: unknown): void {
    window.parent.postMessage(message, this.#deps.origin)
  }
}
