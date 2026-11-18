import { createPartHost, definePart, definePartPlugin, type IPartHost } from '@migaia/part-host'
import { layoutsPlugin, navContentLayout, navTreeContentLayout } from '@migaia/part-layouts'
import { domPlugin } from '@migaia/part-plugin-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { bindReactComponent, reactPlugin } from '../src/index.ts'
import { Button } from './fixtures/components.tsx'

/** Waits for React commits and microtasks. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 30))
}

afterEach(() => {
  document.body.replaceChildren()
  localStorage.clear()
})

/** Bound button part placed in regions. */
const buttonPart = definePart({ id: 'button@1' })

/** Plugin with the button part and its binding. */
const contentPlugin = definePartPlugin({
  name: 'content',
  parts: [buttonPart],
  implementations: [bindReactComponent(buttonPart, Button)]
})

/** Plugin binding nav-content@1 to a plain component, so the layout renders as a normal part. */
const boundLayoutPlugin = definePartPlugin({
  name: 'bound-layout',
  implementations: [
    bindReactComponent(navContentLayout, (props: { readonly children?: unknown }) => (
      <section data-bound-layout="">{props.children as never}</section>
    ))
  ]
})

/** Mounts a blueprint root with layouts, DOM, React and content plugins. */
async function mount(
  root: unknown,
  extra: readonly ReturnType<typeof definePartPlugin>[] = []
): Promise<{
  readonly host: IPartHost
  readonly errors: unknown[]
  readonly unmount: () => void
}> {
  /** Errors reported by the host. */
  const errors: unknown[] = []
  /** Host under test. */
  const host = await createPartHost({
    plugins: [layoutsPlugin, domPlugin, reactPlugin, contentPlugin, ...extra],
    onError: (error) => errors.push(error)
  })
  /** Load result. */
  const loaded = await host.blueprint.load({ id: 'bp', version: 1, root })
  expect(loaded.issues).toEqual([])
  /** Mount container. */
  const container = document.createElement('div')
  document.body.append(container)
  /** Mount handle. */
  const handle = host.mount(container, 'bp')
  await settle()
  return { host, errors, unmount: () => handle.unmount() }
}

/** Button node with a label. */
function button(id: string): unknown {
  return { tag: 'button@1', id, facets: { props: { label: id } } }
}

/** Nav-tree-content@1 root with one button per region. */
function navTree(props: Record<string, unknown> = {}): unknown {
  return {
    tag: navTreeContentLayout.descriptor.id,
    id: 'shell',
    facets: {
      props,
      slots: { nav: [button('menu')], tree: [button('toc')], content: [button('body')] }
    }
  }
}

describe('layout rendering', () => {
  it('renders landmarks, separator and toggles and attaches layout behaviour', async () => {
    const { host, errors } = await mount(navTree())
    const navs = Array.from(document.querySelectorAll('nav'))
    expect(navs.map((nav) => nav.getAttribute('aria-label'))).toEqual([
      'Main navigation',
      'Contents'
    ])
    expect(document.querySelectorAll('main')).toHaveLength(1)
    expect(navs[0]?.textContent).toBe('menu')
    expect(navs[1]?.textContent).toBe('toc')
    expect(document.querySelector('main')?.textContent).toBe('body')
    expect(navs[1]?.nextElementSibling?.getAttribute('role')).toBe('separator')
    expect(document.querySelectorAll('[data-part-toggle]')).toHaveLength(2)
    expect(getComputedStyle(navs[1]?.parentElement as HTMLElement).display).toBe('grid')
    expect(errors).toEqual([])
    await host.dispose()
    expect(document.adoptedStyleSheets.length).toBe(0)
  })

  it('uses blueprint labels and renders a bound layout as a normal part', async () => {
    const labelled = await mount(navTree({ labels: { nav: '主导航' } }))
    expect(document.querySelector('nav')?.getAttribute('aria-label')).toBe('主导航')
    await labelled.host.dispose()
    document.body.replaceChildren()

    const bound = await mount(
      {
        tag: navContentLayout.descriptor.id,
        id: 'shell',
        facets: { slots: { nav: [button('menu')], content: [button('body')] } }
      },
      [boundLayoutPlugin]
    )
    expect(document.querySelector('[data-bound-layout]')).not.toBeNull()
    expect(document.querySelector('[role="separator"]')).toBeNull()
    expect(document.querySelector('nav')).toBeNull()
    await bound.host.dispose()
  })

  it('releases the layout rules on unmount', async () => {
    const { host, unmount } = await mount(navTree())
    /** Text of every adopted rule. */
    const rules = (): string =>
      document.adoptedStyleSheets
        .flatMap((sheet) => Array.from(sheet.cssRules, (rule) => rule.cssText))
        .join('\n')
    expect(rules()).toContain('grid-template-columns')
    unmount()
    await settle()
    expect(rules()).not.toContain('grid-template-columns')
    await host.dispose()
  })
})

describe('skip link and nested layouts', () => {
  it('focuses the skip link first and moves focus to main on Enter', async () => {
    const { host } = await mount(navTree())
    await userEvent.keyboard('{Tab}')
    const skip = document.activeElement as HTMLElement
    expect(skip.textContent).toBe('Skip to main content')
    expect(skip.getBoundingClientRect().width).toBeGreaterThan(1)
    await userEvent.keyboard('{Enter}')
    expect(document.activeElement).toBe(document.querySelector('main'))
    await host.dispose()
  })

  it('renders one main landmark and one skip link for nested layouts', async () => {
    const { host } = await mount({
      tag: 'single@1',
      id: 'outer',
      facets: {
        props: { skipLabel: '跳到主内容' },
        slots: {
          content: [
            {
              tag: 'nav-content@1',
              id: 'inner',
              facets: { slots: { nav: [button('menu')], content: [button('body')] } }
            }
          ]
        }
      }
    })
    expect(document.querySelectorAll('main')).toHaveLength(1)
    expect(document.querySelectorAll('[data-part-skip]')).toHaveLength(1)
    expect(document.querySelector('[data-part-skip]')?.textContent).toBe('跳到主内容')
    const inner = document.querySelector('main [data-part-region="content"]')
    expect(inner?.tagName).toBe('DIV')
    await host.dispose()
  })
})
