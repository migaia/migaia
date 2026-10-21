import type { IMicroApp } from '../types.js'

/**
 * Context key of the app handle in the Web Components Community Group Context Protocol. A string
 * (not a symbol) so Lit's `@consume({ context: MICRO_APP_CONTEXT })` and other implementations
 * match it with `===`.
 */
export const MICRO_APP_CONTEXT = '@migaia/micro-hub:app' as '@migaia/micro-hub:app' & {
  __context__: IMicroApp
}

/** Event type defined by the Context Protocol. */
const CONTEXT_REQUEST = 'context-request'

/** Provider-availability event consumed by Lit's ContextRoot to replay early requests. */
const CONTEXT_PROVIDER = 'context-provider'

/** Callback shape defined by the Context Protocol. */
type IContextCallback = (value: IMicroApp, unsubscribe?: () => void) => void

/** `context-request` event as the protocol defines it; bubbles and crosses shadow roots. */
class ContextRequestEvent extends Event {
  /** Requested context key. */
  readonly context: unknown
  /** Element that asked; providers ignore requests from themselves. */
  readonly contextTarget: Element
  /** Receives the provided value. */
  readonly callback: IContextCallback
  /** This package never asks for updates: an app handle does not change. */
  readonly subscribe = false

  constructor(context: unknown, contextTarget: Element, callback: IContextCallback) {
    super(CONTEXT_REQUEST, { bubbles: true, composed: true })
    this.context = context
    this.contextTarget = contextTarget
    this.callback = callback
  }
}

/** Announces a ready provider using the event shape expected by external context roots. */
class ContextProviderEvent extends Event {
  /** Context key whose previously unanswered requests may now be replayed. */
  readonly context = MICRO_APP_CONTEXT
  /** Original provider element, preserved when a shadow boundary retargets the event. */
  readonly contextTarget: Element

  /** Announces the ready provider from its original element across composed DOM boundaries. */
  constructor(contextTarget: Element) {
    super(CONTEXT_PROVIDER, { bubbles: true, composed: true })
    this.contextTarget = contextTarget
  }
}

/** A consumer whose request no provider answered yet. */
type IPendingRequest = { readonly element: Element; readonly callback: (app: IMicroApp) => void }

/** Requests waiting for a provider that is attached later; drained by {@link provideMicroApp}. */
const pending = new Set<IPendingRequest>()

/** True when `node` is `ancestor` or below it, crossing shadow roots upward. */
function isInside(ancestor: Element, node: Node): boolean {
  /** Current node of the upward walk. */
  let current: Node | null = node
  while (current) {
    if (current === ancestor) return true
    current =
      current.parentNode ??
      (typeof ShadowRoot !== 'undefined' && current instanceof ShadowRoot ? current.host : null)
  }
  return false
}

/**
 * Asks the nearest provider above `element` for the app handle. When no provider answers yet, the
 * request waits and a later {@link provideMicroApp} on an ancestor answers it.
 *
 * Returns a function that cancels a still-pending request.
 */
export function consumeMicroApp(element: Element, callback: (app: IMicroApp) => void): () => void {
  /** Set when a provider answered, synchronously or later. */
  let answered = false
  /** Pending record kept until a provider appears. */
  const request: IPendingRequest = {
    element,
    callback: (app) => {
      if (answered) return
      answered = true
      pending.delete(request)
      callback(app)
    }
  }
  element.dispatchEvent(
    new ContextRequestEvent(MICRO_APP_CONTEXT, element, (app) => request.callback(app))
  )
  if (!answered) pending.add(request)
  return () => {
    pending.delete(request)
  }
}

/**
 * Makes `element` provide `app` to every descendant (light and shadow DOM) that consumes the micro
 * app context, including consumers that asked before this call. Announces availability so an
 * external ContextRoot can replay its own buffered requests. Returns a function that stops
 * providing.
 */
export function provideMicroApp(element: Element, app: IMicroApp): () => void {
  /** Answers matching requests from descendants and stops them at this provider. */
  const listener = (event: Event): void => {
    const request = event as ContextRequestEvent
    /** Protocol implementations may omit Lit's original-target extension. */
    const target = request.contextTarget ?? event.composedPath()[0]
    if (request.context !== MICRO_APP_CONTEXT || target === element) return
    event.stopImmediatePropagation()
    request.callback(app)
  }
  element.addEventListener(CONTEXT_REQUEST, listener)
  element.dispatchEvent(new ContextProviderEvent(element))
  // Deleting the current entry while iterating a Set is safe; answered requests remove themselves.
  for (const request of pending) {
    if (request.element !== element && isInside(element, request.element)) request.callback(app)
  }
  return () => element.removeEventListener(CONTEXT_REQUEST, listener)
}
