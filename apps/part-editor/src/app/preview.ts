import type { IBlueprint, IIssue, IRemoteModuleRef } from '@migaia/part-contract'
import { EditorMessage } from '../text.ts'

/** What the bridge reports back to the store. */
export type IBridgeListener = {
  /** The page reported the issues of a blueprint update. */
  issues(blueprintId: string, issues: readonly IIssue[]): void
  /** Module loading failed in the page. */
  failed(message: string): void
  /** The page is ready (first load); the store sends the current state. */
  ready(): void
}

/**
 * Editor side of the preview bridge (`editor-bridge` 1). It talks to the iframe's window at the
 * preview origin only. When modules and a blueprint change together, modules go first and the
 * blueprint waits for `modules-loaded`; after `modules-failed` the blueprint is not sent.
 */
export class PreviewBridge {
  /** Preview origin. */
  readonly #origin: string
  /** Receiver of page reports. */
  readonly #listener: IBridgeListener
  /** Preview window, once the iframe exists. */
  #target: Window | undefined
  /** Whether the page reported ready. */
  #ready = false
  /** Blueprint waiting for a module load to finish. */
  #waiting: IBlueprint | undefined
  /** Whether a module load is in flight. */
  #loading = false

  /** Binds the bridge to the preview origin and starts listening for page messages. */
  constructor(preview: string, listener: IBridgeListener) {
    this.#origin = new URL(preview).origin
    this.#listener = listener
    window.addEventListener('message', this)
  }

  /** Sets the iframe's window. */
  attach(target: Window | null): void {
    this.#target = target ?? undefined
  }

  /** Page message listener: other origins are ignored. */
  handleEvent(event: Event): void {
    /** Message event. */
    const message = event as MessageEvent
    if (message.origin !== this.#origin) return
    /** Message fields. */
    const data = (message.data ?? {}) as {
      kind?: unknown
      blueprintId?: unknown
      issues?: unknown
      error?: { message?: unknown }
    }
    if (data.kind === EditorMessage.ready) {
      this.#ready = true
      this.#listener.ready()
    } else if (data.kind === EditorMessage.issues && Array.isArray(data.issues))
      this.#listener.issues(String(data.blueprintId ?? ''), data.issues as IIssue[])
    else if (data.kind === EditorMessage.modulesLoaded) {
      this.#loading = false
      /** Blueprint released by the load. */
      const waiting = this.#waiting
      this.#waiting = undefined
      if (waiting !== undefined) this.blueprint(waiting)
    } else if (data.kind === EditorMessage.modulesFailed) {
      this.#loading = false
      this.#waiting = undefined
      this.#listener.failed(String(data.error?.message ?? ''))
    }
  }

  /** Sends a blueprint now, or after the module load in flight. */
  blueprint(document: IBlueprint): void {
    if (!this.#ready) return
    if (this.#loading) {
      this.#waiting = document
      return
    }
    this.#post({ kind: EditorMessage.blueprint, document })
  }

  /**
   * Sends draft module references to load over `remote:modules`; the token goes to the preview
   * origin only.
   */
  modules(modules: readonly IRemoteModuleRef[], base: string, token: string): void {
    if (!this.#ready || modules.length === 0) return
    this.#loading = true
    this.#post({ kind: EditorMessage.modules, modules, base, token })
  }

  /** Posts to the preview origin. */
  #post(message: unknown): void {
    this.#target?.postMessage(message, this.#origin)
  }
}
