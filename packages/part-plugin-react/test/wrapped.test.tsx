import { createPartHost, defineEffect, definePart, definePartPlugin } from '@migaia/part-host'
import { domPlugin } from '@migaia/part-plugin-dom'
import { forwardRef, lazy, memo, type ReactNode, type Ref } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { bindReactComponent, PartReactErrorCode, reactPlugin } from '../src/index.ts'

/** Function component that takes `ref` as a prop. */
function Plain(props: { readonly ref?: Ref<HTMLDivElement> }): ReactNode {
  return <div ref={props.ref}>plain</div>
}

/** Same element through `forwardRef`. */
const Fwd = forwardRef<HTMLDivElement>(function Fwd(_props, ref) {
  return <div ref={ref}>fwd</div>
})

/** Higher-order component that drops `ref`. */
function withNothing(Inner: typeof Plain): (props: Record<string, unknown>) => ReactNode {
  return function WithNothing(): ReactNode {
    return <Inner />
  }
}

/** Container part without a bound element check (query). */
function Page(props: { readonly children?: ReactNode }): ReactNode {
  return <section>{props.children}</section>
}

/** Parts under test. */
const parts = {
  page: definePart({ id: 'page@1' }),
  memoPlain: definePart({ id: 'memo-plain@1' }),
  fwd: definePart({ id: 'fwd@1' }),
  memoFwd: definePart({ id: 'memo-fwd@1' }),
  lazy: definePart({ id: 'lazy@1' }),
  nothing: definePart({ id: 'nothing@1' })
}

/** Addresses whose `outside` subscription ran. */
const outside: string[] = []

/** Plugin binding the wrapped components; `queryNothing` binds the HOC with `element: 'query'`. */
function plugin(queryNothing: boolean) {
  return definePartPlugin({
    name: 'wrapped',
    parts: Object.values(parts),
    implementations: [
      bindReactComponent(parts.page, Page, { element: 'query' }),
      bindReactComponent(parts.memoPlain, memo(Plain)),
      bindReactComponent(parts.fwd, Fwd),
      bindReactComponent(parts.memoFwd, memo(Fwd)),
      bindReactComponent(
        parts.lazy,
        lazy(() => import('./fixtures/lazy-target.tsx'))
      ),
      bindReactComponent(
        parts.nothing,
        withNothing(Plain),
        queryNothing ? { element: 'query' } : {}
      )
    ],
    effects: [
      defineEffect({ id: 'hit-outside@1', run: (event) => void outside.push(event.address) })
    ]
  })
}

/** Blueprint with one node per wrapped part, each listening for outside clicks. */
const root = {
  tag: 'page@1',
  id: 'p',
  children: ['memo-plain', 'fwd', 'memo-fwd', 'lazy', 'nothing'].map((id) => ({
    tag: `${id}@1`,
    id,
    facets: { events: { 'click.outside': { handler: 'hit-outside@1' } } }
  }))
}

/** Waits for commits, lazy loading and microtasks. */
function settle(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Mounts the blueprint and returns the host, its container and reported errors. */
async function mount(queryNothing: boolean) {
  const errors: unknown[] = []
  const host = await createPartHost({
    plugins: [domPlugin, reactPlugin, plugin(queryNothing)],
    onError: (error) => errors.push(error)
  })
  const loaded = await host.blueprint.load({ id: 'bp', version: 1, root })
  if (loaded.tree === undefined) throw new Error(JSON.stringify(loaded.issues))
  const container = document.createElement('div')
  document.body.append(container)
  const mounted = host.mount(container, 'bp')
  await settle(200)
  return { host, container, errors, mounted }
}

/** Missing-element reports among errors. */
function missing(errors: readonly unknown[]): { message: string }[] {
  return errors.filter(
    (error) => (error as { code?: unknown }).code === PartReactErrorCode.elementMissing
  ) as { message: string }[]
}

afterEach(() => {
  document.body.replaceChildren()
  outside.length = 0
})

describe('wrapped components (A8)', () => {
  it('binds memo, forwardRef and lazy, and reports a component that drops ref', async () => {
    const { host, container, errors, mounted } = await mount(false)
    for (const id of ['memo-plain', 'fwd', 'memo-fwd', 'lazy'])
      expect(container.querySelector(`[data-part-address="p/${id}"]`)).not.toBeNull()
    expect(missing(errors)).toHaveLength(1)
    expect(missing(errors)[0]?.message).toContain('p/nothing')
    expect(missing(errors)[0]?.message).toContain('nothing@1')
    document.body.click()
    await settle()
    expect([...outside].sort()).toEqual(['p/fwd', 'p/lazy', 'p/memo-fwd', 'p/memo-plain'])
    mounted.unmount()
    await settle()
    host.mount(container, 'bp')
    await settle(200)
    expect(missing(errors)).toHaveLength(2)
    await host.dispose()
  })

  it('does not report the same component bound with element: query', async () => {
    const { host, errors } = await mount(true)
    expect(missing(errors)).toHaveLength(0)
    document.body.click()
    await settle()
    expect(outside).toContain('p/nothing')
    await host.dispose()
  })
})
