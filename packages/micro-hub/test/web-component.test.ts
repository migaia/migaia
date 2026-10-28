// @vitest-environment jsdom
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { createMicroHub, getMicroHub, type IMicroApp } from '../src/index.ts'
import { MICRO_APP_CONTEXT, consumeMicroApp, provideMicroApp } from '../src/web-component/index.ts'

/** Clears each DOM tree after its provider and consumer have released their listeners. */
afterEach(async () => {
  document.body.replaceChildren()
  try {
    await getMicroHub().dispose()
  } catch (error) {
    if ((error as { code?: string }).code !== 'HUB_NOT_CREATED') throw error
  }
})

describe('web component context', () => {
  it('carries the standard context value brand for typed Lit consumers', () => {
    expectTypeOf(MICRO_APP_CONTEXT).toMatchTypeOf<{ __context__: IMicroApp }>()
    expect(MICRO_APP_CONTEXT).toBe('@migaia/micro-hub:app')
  })

  it('delivers an existing provider once and removes its listener on stop', () => {
    /** Real app handle delivered without a global lookup by the consumer. */
    const app = createMicroHub({ plugins: [] }).connect('shell')
    /** Provider and consumer participate in normal light DOM bubbling. */
    const parent = document.createElement('section')
    /** Nested requester receives the closest ancestor app. */
    const child = document.createElement('span')
    parent.append(child)
    document.body.append(parent)
    /** Callback proves synchronous one-time delivery. */
    const callback = vi.fn()
    /** Removing the provider prevents future request delivery. */
    const stopProvider = provideMicroApp(parent, app)
    /** Answered request's returned cancellation remains harmless. */
    const stopConsumer = consumeMicroApp(child, callback)
    expect(callback).toHaveBeenCalledExactlyOnceWith(app)
    stopConsumer()
    stopConsumer()
    stopProvider()
    stopProvider()
    /** A later consumer stays pending after provider removal. */
    const later = vi.fn()
    /** Pending record is explicitly released. */
    const cancel = consumeMicroApp(child, later)
    expect(later).not.toHaveBeenCalled()
    cancel()
  })

  it('replays a consumer request when its ancestor provider attaches later', () => {
    /** Provider appears after the custom element has already requested context. */
    const app = createMicroHub({ plugins: [] }).connect('shell')
    /** Ancestor tree exists before context provisioning. */
    const parent = document.createElement('section')
    /** Early consumer would otherwise lose the one-time DOM event. */
    const child = document.createElement('span')
    parent.append(child)
    document.body.append(parent)
    /** Callback is retained only until the request is answered or canceled. */
    const callback = vi.fn()
    /** Consumer is pending when the provider installs. */
    const cancel = consumeMicroApp(child, callback)
    expect(callback).not.toHaveBeenCalled()
    /** Provider replays the pending request on installation. */
    const stop = provideMicroApp(parent, app)
    expect(callback).toHaveBeenCalledExactlyOnceWith(app)
    cancel()
    stop()
  })

  it.each(['light', 'shadow'] as const)(
    'announces a late provider for external ContextRoot replay in %s DOM',
    (tree) => {
      /** Context request shape shared by an external consumer and its root fixture. */
      type IExternalRequest = Event & {
        context: unknown
        contextTarget: Element
        callback: (value: IMicroApp) => void
        subscribe: boolean
      }
      /** Real app supplied only after the external consumer has already connected. */
      const app = createMicroHub({ plugins: [] }).connect('shell')
      /** Provider lies below the external root in either light or shadow DOM. */
      const parent = document.createElement('section')
      /** Shadow host makes provider announcements cross a composed boundary. */
      const host = document.createElement('div')
      /** External consumer never calls consumeMicroApp or enters its private pending set. */
      const child = document.createElement('span')
      parent.append(child)
      if (tree === 'shadow') host.attachShadow({ mode: 'open' }).append(parent)
      else host.append(parent)
      document.body.append(host)
      /** Root stores one unanswered subscribing request, matching Lit ContextRoot admission. */
      let pending: IExternalRequest | undefined
      /** Matching announcement is inspected outside DOM callbacks so failed assertions propagate. */
      let announcement: (Event & { context: unknown; contextTarget: Element }) | undefined
      /** External root records requests only after they reach the root unanswered. */
      const record = (event: Event): void => {
        /** Original target survives shadow retargeting via the protocol extension. */
        const request = event as IExternalRequest
        if (request.subscribe === true) pending = request
      }
      /** Root responds to a matching provider announcement by redispatching from the consumer. */
      const replay = (event: Event): void => {
        /** Provider context selects the buffered request to replay. */
        const provider = event as Event & { context: unknown; contextTarget: Element }
        if (!pending || provider.context !== pending.context) return
        announcement = provider
        /** Clear the buffered record before redispatch, as Lit ContextRoot does. */
        const request = pending
        pending = undefined
        /** Replay is another subscribing protocol request from the original consumer. */
        const repeated = new Event('context-request', { bubbles: true, composed: true })
        Object.assign(repeated, {
          context: request.context,
          contextTarget: request.contextTarget,
          callback: request.callback,
          subscribe: true
        })
        request.contextTarget.dispatchEvent(repeated)
      }
      document.body.addEventListener('context-request', record)
      document.body.addEventListener('context-provider', replay)
      try {
        /** External consumer callback must receive the app through root-driven replay. */
        const callback = vi.fn()
        /** Subscribing early request is retained by the external root only. */
        const request = new Event('context-request', { bubbles: true, composed: true })
        Object.assign(request, {
          context: MICRO_APP_CONTEXT,
          contextTarget: child,
          callback,
          subscribe: true
        })
        child.dispatchEvent(request)
        expect(pending).toBe(request)
        expect(callback).not.toHaveBeenCalled()
        /** An unrelated context must not consume this root's pending app request. */
        const unrelated = new Event('context-provider', { bubbles: true, composed: true })
        Object.assign(unrelated, { context: 'unrelated', contextTarget: parent })
        parent.dispatchEvent(unrelated)
        expect(pending).toBe(request)
        expect(callback).not.toHaveBeenCalled()
        /** The listener must be installed before this call announces provider availability. */
        const stop = provideMicroApp(parent, app)
        try {
          expect(announcement).toMatchObject({
            context: MICRO_APP_CONTEXT,
            contextTarget: parent,
            bubbles: true,
            composed: true
          })
          expect(callback).toHaveBeenCalledExactlyOnceWith(app)
          expect(pending).toBeUndefined()
        } finally {
          stop()
        }
      } finally {
        document.body.removeEventListener('context-request', record)
        document.body.removeEventListener('context-provider', replay)
      }
    }
  )

  it('does not answer a canceled pending consumer or an unrelated subtree', () => {
    /** Context source shared only with its own descendants. */
    const app = createMicroHub({ plugins: [] }).connect('shell')
    /** Empty provider subtree cannot satisfy the unrelated consumer. */
    const parent = document.createElement('section')
    /** Requester outside the provider subtree remains independent. */
    const outside = document.createElement('span')
    /** Requester inside the provider subtree cancels before it appears. */
    const child = document.createElement('span')
    parent.append(child)
    document.body.append(parent, outside)
    /** Canceled callback must not be retained by replay. */
    const canceled = vi.fn()
    /** Unrelated callback must not receive this provider's app. */
    const unrelated = vi.fn()
    /** Caller owns cancellation of its early request. */
    const cancel = consumeMicroApp(child, canceled)
    /** Separate pending request stays outside this provider's subtree. */
    const cancelOutside = consumeMicroApp(outside, unrelated)
    cancel()
    cancel()
    /** Installation traverses pending requests without capturing unrelated nodes. */
    const stop = provideMicroApp(parent, app)
    expect(canceled).not.toHaveBeenCalled()
    expect(unrelated).not.toHaveBeenCalled()
    cancelOutside()
    stop()
  })

  it('crosses shadow roots for both immediate and late context provisioning', () => {
    /** Context remains the same across a shadow boundary. */
    const app = createMicroHub({ plugins: [] }).connect('shell')
    /** Light-DOM ancestor owns the context. */
    const parent = document.createElement('section')
    /** Shadow host carries the nested consumer. */
    const host = document.createElement('div')
    /** Shadow root requires composed DOM events and an ancestry fallback for replay. */
    const shadow = host.attachShadow({ mode: 'open' })
    /** Nested element sends the original context request. */
    const child = document.createElement('span')
    shadow.append(child)
    parent.append(host)
    document.body.append(parent)
    /** Callback receives late provisioning through the host ancestry. */
    const callback = vi.fn()
    /** Request precedes provider attachment. */
    const cancel = consumeMicroApp(child, callback)
    /** Provider handles both pending and subsequent composed requests. */
    const stop = provideMicroApp(parent, app)
    expect(callback).toHaveBeenCalledExactlyOnceWith(app)
    /** Subsequent consumer follows the event's composed path immediately. */
    const immediate = vi.fn()
    /** Answered request leaves no pending record. */
    const cancelImmediate = consumeMicroApp(child, immediate)
    expect(immediate).toHaveBeenCalledExactlyOnceWith(app)
    cancel()
    cancelImmediate()
    stop()
  })

  it('selects the nearest provider and skips a provider asking for its own context', () => {
    /** Two app handles distinguish the nearest provider from the outer provider. */
    const hub = createMicroHub({ plugins: [] })
    /** Outer app belongs to the parent provider. */
    const outerApp = hub.connect('outer')
    /** Inner app belongs to the nested provider. */
    const innerApp = hub.connect('inner')
    /** Outer provider root. */
    const outer = document.createElement('section')
    /** Nested provider is also allowed to consume its ancestor's context. */
    const inner = document.createElement('div')
    /** Descendant should be answered by the inner provider only. */
    const child = document.createElement('span')
    inner.append(child)
    outer.append(inner)
    document.body.append(outer)
    /** Outer context listener. */
    const stopOuter = provideMicroApp(outer, outerApp)
    /** Inner context listener. */
    const stopInner = provideMicroApp(inner, innerApp)
    /** Descendant callback must not bubble to the outer provider. */
    const childCallback = vi.fn()
    /** Provider-self request must continue toward the outer provider. */
    const selfCallback = vi.fn()
    consumeMicroApp(child, childCallback)()
    consumeMicroApp(inner, selfCallback)()
    expect(childCallback).toHaveBeenCalledExactlyOnceWith(innerApp)
    expect(selfCallback).toHaveBeenCalledExactlyOnceWith(outerApp)
    stopInner()
    stopOuter()
  })

  it('supports protocol events without the optional contextTarget extension', () => {
    /** Parent provider's app must satisfy a nested provider's self-request. */
    const hub = createMicroHub({ plugins: [] })
    /** Outer app provides ancestor context. */
    const outerApp = hub.connect('outer')
    /** Inner app must not answer its own protocol request. */
    const innerApp = hub.connect('inner')
    /** Ancestor carrying the real answer. */
    const outer = document.createElement('section')
    /** Protocol consumer that also provides context to its descendants. */
    const inner = document.createElement('div')
    outer.append(inner)
    document.body.append(outer)
    /** Parent listener handles the request after the self provider ignores it. */
    const stopOuter = provideMicroApp(outer, outerApp)
    /** Self provider listener exercises target fallback. */
    const stopInner = provideMicroApp(inner, innerApp)
    /** Callback belongs to a protocol consumer independent of this package's helper. */
    const callback = vi.fn()
    /** Standard protocol shape has context/callback and does not require contextTarget. */
    const request = new Event('context-request', { bubbles: true, composed: true })
    Object.assign(request, { context: MICRO_APP_CONTEXT, callback })
    inner.dispatchEvent(request)
    expect(callback).toHaveBeenCalledExactlyOnceWith(outerApp)
    stopInner()
    stopOuter()
  })

  it('ignores unrelated contexts and does not provide to its own pending request', () => {
    /** Provider app stays available only under its matching context key. */
    const app = createMicroHub({ plugins: [] }).connect('shell')
    /** Provider is also the requesting element. */
    const parent = document.createElement('section')
    document.body.append(parent)
    /** Its own early request needs an ancestor and cannot be replayed by itself. */
    const callback = vi.fn()
    /** Pending self-request is canceled explicitly. */
    const cancel = consumeMicroApp(parent, callback)
    /** Attaching on the same element must leave the self-request pending. */
    const stop = provideMicroApp(parent, app)
    /** Other protocol context keys pass through this listener unchanged. */
    const unrelated = new Event('context-request', { bubbles: true, composed: true })
    Object.assign(unrelated, { context: 'unrelated', callback })
    parent.dispatchEvent(unrelated)
    expect(callback).not.toHaveBeenCalled()
    cancel()
    stop()
  })
})
