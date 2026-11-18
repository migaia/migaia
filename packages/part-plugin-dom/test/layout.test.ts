import type { ILayoutBehavior, IPartFacets } from '@migaia/part-contract'
import { afterEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { layoutRegionId, type IDomFeatures, type ILayoutHandle } from '../src/index.ts'
import { createDomHarness, element, nodeOf } from './fixtures.ts'

/** Page style the tests own: no body margin and a fixed-height test container. */
const PAGE_STYLE = 'body { margin: 0 } [data-test-root] { height: 400px }'

afterEach(() => {
  document.body.replaceChildren()
  document.head.querySelectorAll('style').forEach((style) => style.remove())
  localStorage.clear()
})

/** Nav-content style layout: resizable navigation before main, collapsing below 720 px. */
const navContent: ILayoutBehavior = {
  direction: 'row',
  regions: [
    {
      name: 'nav',
      landmark: 'navigation',
      label: 'Main navigation',
      resizable: true,
      size: { default: 240, min: 160, max: 480 },
      collapseBelow: 720
    },
    { name: 'content', landmark: 'main' }
  ]
}

/** Element tag per region landmark used in these tests. */
const TAGS: Readonly<Record<string, string>> = {
  navigation: 'nav',
  main: 'main',
  complementary: 'aside'
}

/** Rendered layout plus its attach handle. */
type IRendered = { readonly handle: ILayoutHandle; readonly root: HTMLElement }

/**
 * Renders a layout the way a renderer would: root, skip link, regions with one button each,
 * separators and toggles, then returns the handle without attaching.
 */
function render(
  address: string,
  layout: ILayoutBehavior,
  options: { readonly width?: number; readonly config?: IPartFacets; readonly empty?: string } = {}
): IRendered {
  if (document.head.querySelector('style') === null) {
    /** Test-owned page style. */
    const style = document.createElement('style')
    style.textContent = PAGE_STYLE
    document.head.append(style)
  }
  /** Sizing wrapper; tests change its class to resize the layout. */
  const wrapper = element<HTMLDivElement>('div', document.body)
  wrapper.className = `w${options.width ?? 1000}`
  ensureWidthRule(options.width ?? 1000)
  /** Layout root. */
  const root = element<HTMLDivElement>('div', wrapper, {
    'data-part-address': address,
    'data-test-root': ''
  })
  /** Main region name. */
  const main = layout.regions.find((region) => region.landmark === 'main')?.name ?? ''
  /** Skip link. */
  const skip = element<HTMLAnchorElement>('a', root, {
    'data-part-skip': '',
    href: `#${layoutRegionId(address, main)}`
  })
  skip.textContent = 'Skip to main content'
  /** Collected elements. */
  const regions: Record<string, HTMLElement> = {}
  /** Separator elements. */
  const separators: Record<string, HTMLElement> = {}
  /** Toggle elements. */
  const toggles: Record<string, HTMLElement> = {}
  for (const region of layout.regions) {
    regions[region.name] = element(TAGS[region.landmark] ?? 'section', root, {
      id: layoutRegionId(address, region.name)
    })
    if (options.empty !== region.name)
      element<HTMLButtonElement>('button', regions[region.name] as HTMLElement).textContent =
        region.name
    if (region.resizable === true) separators[region.name] = element('div', root)
    if (region.collapseBelow !== undefined) toggles[region.name] = element('button', root)
  }
  return {
    root,
    handle: {
      blueprintId: 'bp',
      node: nodeOf(address, { layout }, { config: options.config ?? {} }),
      element: root,
      regions,
      separators,
      toggles,
      skip
    }
  }
}

/** Adds a width rule for wrapper class `w<width>` once. */
function ensureWidthRule(width: number): void {
  /** Test style element. */
  const style = document.head.querySelector('style') as HTMLStyleElement
  if (!style.textContent?.includes(`.w${width} `))
    style.textContent += ` .w${width} { width: ${width}px }`
}

/** Resizes a rendered layout and waits for the observer. */
async function resize(rendered: IRendered, width: number): Promise<void> {
  ensureWidthRule(width)
  ;(rendered.root.parentElement as HTMLElement).className = `w${width}`
  await waitFrames()
}

/** Waits two animation frames so ResizeObserver callbacks run. */
async function waitFrames(): Promise<void> {
  await new Promise((resolve) => requestAnimationFrame(resolve))
  await new Promise((resolve) => requestAnimationFrame(resolve))
}

/** Rendered width of an element. */
function width(target: HTMLElement): number {
  return Math.round(target.getBoundingClientRect().width)
}

/** Layout feature of a fresh harness. */
async function layoutFeature(): Promise<{
  readonly dom: IDomFeatures
  readonly dispose: () => Promise<unknown>
  readonly errors: unknown[]
}> {
  /** Errors reported by the host. */
  const errors: unknown[] = []
  const { host, dom } = await createDomHarness({ onError: (error) => errors.push(error) })
  return { dom, dispose: () => host.dispose(), errors }
}

describe('layout regions and grid', () => {
  it('lays out regions, separator, toggles and skip link through the layout layer', async () => {
    const { dom, dispose } = await layoutFeature()
    const rendered = render('page/shell', navContent)
    const undo = dom.layout.attach(rendered.handle)
    const { root, handle } = rendered
    const nav = handle.regions.nav as HTMLElement
    const content = handle.regions.content as HTMLElement
    const separator = handle.separators.nav as HTMLElement
    expect(getComputedStyle(root).display).toBe('grid')
    expect(width(nav)).toBe(240)
    expect(width(separator)).toBe(6)
    expect(Math.round(separator.getBoundingClientRect().left)).toBe(240)
    expect(Math.round(content.getBoundingClientRect().left)).toBe(246)
    expect(width(content)).toBe(1000 - 246)
    expect(getComputedStyle(content).overflowY).toBe('auto')
    expect(content.id).toBe(layoutRegionId('page/shell', 'content'))
    expect(nav.getAttribute('aria-label')).toBe('Main navigation')
    expect(document.querySelectorAll('[style]')).toHaveLength(0)
    const skip = handle.skip as HTMLElement
    expect([width(skip), Math.round(skip.getBoundingClientRect().height)]).toEqual([1, 1])
    await userEvent.keyboard('{Tab}')
    expect(document.activeElement).toBe(skip)
    expect(width(skip)).toBeGreaterThan(1)

    undo()
    expect(getComputedStyle(root).display).toBe('block')
    await dispose()
  })

  it('gives two navigation regions their own labels, blueprint labels first', async () => {
    const { dom, dispose } = await layoutFeature()
    const layout: ILayoutBehavior = {
      direction: 'row',
      regions: [
        { name: 'nav', landmark: 'navigation', label: 'Main navigation' },
        { name: 'tree', landmark: 'navigation', label: 'Contents' },
        { name: 'content', landmark: 'main' }
      ]
    }
    const rendered = render('p', layout, { config: { props: { labels: { nav: '主导航' } } } })
    dom.layout.attach(rendered.handle)
    expect(rendered.handle.regions.nav?.getAttribute('aria-label')).toBe('主导航')
    expect(rendered.handle.regions.tree?.getAttribute('aria-label')).toBe('Contents')
    await dispose()
  })
})

describe('layout separators and saved sizes', () => {
  it('resizes by keyboard and pointer within range and restores the saved width', async () => {
    const { dom, dispose, errors } = await layoutFeature()
    const first = render('page/shell', navContent)
    const undo = dom.layout.attach(first.handle)
    const separator = first.handle.separators.nav as HTMLElement
    const nav = first.handle.regions.nav as HTMLElement
    expect(separator.getAttribute('role')).toBe('separator')
    expect(separator.getAttribute('aria-orientation')).toBe('vertical')
    expect(separator.getAttribute('aria-controls')).toBe(nav.id)
    separator.focus()
    /** Width and aria-valuenow after each step. */
    const seen: [number, string | null][] = []
    for (const keys of ['{ArrowRight>5/}', '{Shift>}{ArrowRight}{/Shift}', '{End}']) {
      await userEvent.keyboard(keys)
      seen.push([width(nav), separator.getAttribute('aria-valuenow')])
    }
    const box = separator.getBoundingClientRect()
    const x = box.left + box.width / 2
    const y = box.top + box.height / 2
    separator.dispatchEvent(
      new PointerEvent('pointerdown', { pointerId: 1, clientX: x, clientY: y, bubbles: true })
    )
    separator.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 1,
        clientX: x - 1000,
        clientY: y,
        bubbles: true
      })
    )
    separator.dispatchEvent(
      new PointerEvent('pointerup', { pointerId: 1, clientX: x - 1000, clientY: y, bubbles: true })
    )
    seen.push([width(nav), separator.getAttribute('aria-valuenow')])
    expect(seen).toEqual([
      [290, '290'],
      [340, '340'],
      [480, '480'],
      [160, '160']
    ])
    undo()
    document.body.replaceChildren()

    const second = render('page/shell', navContent)
    dom.layout.attach(second.handle)
    expect(width(second.handle.regions.nav as HTMLElement)).toBe(160)
    expect(errors).toEqual([])
    await dispose()
  })

  it('keeps adjusting when storage throws and ignores invalid saved values', async () => {
    const { dom, dispose, errors } = await layoutFeature()
    localStorage.setItem('part-layout:bp:other/shell:nav', 'abc')
    const rendered = render('other/shell', navContent)
    dom.layout.attach(rendered.handle)
    expect(width(rendered.handle.regions.nav as HTMLElement)).toBe(240)
    const setItem = Storage.prototype.setItem
    Storage.prototype.setItem = () => {
      throw new DOMException('full', 'QuotaExceededError')
    }
    try {
      ;(rendered.handle.separators.nav as HTMLElement).focus()
      await userEvent.keyboard('{ArrowRight}')
      expect(width(rendered.handle.regions.nav as HTMLElement)).toBe(250)
    } finally {
      Storage.prototype.setItem = setItem
    }
    expect(errors).toEqual([])
    await dispose()
  })

  it('places the separator between main and a region after main', async () => {
    const { dom, dispose } = await layoutFeature()
    const layout: ILayoutBehavior = {
      direction: 'row',
      regions: [
        { name: 'content', landmark: 'main' },
        {
          name: 'side',
          landmark: 'complementary',
          resizable: true,
          size: { default: 200, min: 100, max: 300 }
        }
      ]
    }
    const rendered = render('p/side', layout)
    dom.layout.attach(rendered.handle)
    const side = rendered.handle.regions.side as HTMLElement
    const separator = rendered.handle.separators.side as HTMLElement
    const content = rendered.handle.regions.content as HTMLElement
    expect(Math.round(separator.getBoundingClientRect().left)).toBe(
      Math.round(content.getBoundingClientRect().right)
    )
    expect(Math.round(separator.getBoundingClientRect().right)).toBe(
      Math.round(side.getBoundingClientRect().left)
    )
    separator.focus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(width(side)).toBe(210)
    await dispose()
  })
})

describe('layout collapse', () => {
  it('collapses into a popover drawer, restores focus, and expands when wide again', async () => {
    const { dom, dispose } = await layoutFeature()
    const rendered = render('page/shell', navContent)
    dom.layout.attach(rendered.handle)
    const nav = rendered.handle.regions.nav as HTMLElement
    const toggle = rendered.handle.toggles.nav as HTMLElement
    expect(getComputedStyle(toggle).display).toBe('none')

    await resize(rendered, 600)
    expect(nav.getAttribute('data-collapsed')).toBe('true')
    expect(getComputedStyle(rendered.root).gridTemplateColumns.split(' ')[0]).toBe('0px')
    expect(getComputedStyle(toggle).display).not.toBe('none')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.textContent).toBe('Main navigation')

    await userEvent.click(toggle)
    await waitFrames()
    expect(nav.matches(':popover-open')).toBe(true)
    expect(document.activeElement).toBe(nav.querySelector('button'))
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    await userEvent.keyboard('{Escape}')
    await waitFrames()
    expect(nav.matches(':popover-open')).toBe(false)
    expect(document.activeElement).toBe(toggle)

    await userEvent.click(toggle)
    await waitFrames()
    expect(nav.matches(':popover-open')).toBe(true)
    await userEvent.click(toggle)
    await waitFrames()
    expect(nav.matches(':popover-open')).toBe(false)

    await userEvent.click(toggle)
    await waitFrames()
    expect(nav.matches(':popover-open')).toBe(true)
    await resize(rendered, 1000)
    expect(nav.matches(':popover-open')).toBe(false)
    expect(nav.hasAttribute('popover')).toBe(false)
    expect(nav.hasAttribute('data-collapsed')).toBe(false)
    expect(getComputedStyle(toggle).display).toBe('none')
    await dispose()
  })
})

describe('layout F6 region cycle', () => {
  /** Three regions, the middle one without focusable content. */
  const three: ILayoutBehavior = {
    direction: 'row',
    regions: [
      { name: 'a', landmark: 'navigation', label: 'A' },
      { name: 'b', landmark: 'complementary', label: 'B' },
      { name: 'c', landmark: 'main' }
    ]
  }

  it('moves between regions, wraps, enters from outside and skips collapsed regions', async () => {
    const { dom, dispose } = await layoutFeature()
    const rendered = render('p', three)
    dom.layout.attach(rendered.handle)
    const { a, b, c } = rendered.handle.regions as Record<string, HTMLElement>
    const inA = a?.querySelector('button') as HTMLElement
    inA.focus()
    /** Region holding focus after each key. */
    const visited: (HTMLElement | undefined)[] = []
    for (const keys of ['{F6}', '{F6}', '{F6}', '{Shift>}{F6}{/Shift}']) {
      await userEvent.keyboard(keys)
      visited.push([a, b, c].find((region) => region?.contains(document.activeElement)))
    }
    expect(visited).toEqual([b, c, a, c])

    ;(document.activeElement as HTMLElement).blur()
    await userEvent.keyboard('{F6}')
    expect(a?.contains(document.activeElement)).toBe(true)
    ;(document.activeElement as HTMLElement).blur()
    await userEvent.keyboard('{Shift>}{F6}{/Shift}')
    expect(c?.contains(document.activeElement)).toBe(true)
    await dispose()
  })

  it('focuses an empty region itself and skips collapsed regions', async () => {
    const { dom, dispose } = await layoutFeature()
    const rendered = render('p', three, { empty: 'b' })
    dom.layout.attach(rendered.handle)
    const { a, b, c } = rendered.handle.regions as Record<string, HTMLElement>
    ;((a as HTMLElement).querySelector('button') as HTMLElement).focus()
    await userEvent.keyboard('{F6}')
    expect(document.activeElement).toBe(b)
    expect(b?.getAttribute('tabindex')).toBe('-1')
    b?.setAttribute('data-collapsed', 'true')
    ;((a as HTMLElement).querySelector('button') as HTMLElement).focus()
    await userEvent.keyboard('{F6}')
    expect(c?.contains(document.activeElement)).toBe(true)
    await dispose()
  })

  it('shares one document listener across hosts', async () => {
    const first = await layoutFeature()
    const second = await layoutFeature()
    const one = render('one', three)
    const two = render('two', three)
    first.dom.layout.attach(one.handle)
    second.dom.layout.attach(two.handle)
    ;((one.handle.regions.a as HTMLElement).querySelector('button') as HTMLElement).focus()
    await userEvent.keyboard('{F6}')
    expect(one.handle.regions.b?.contains(document.activeElement)).toBe(true)
    await first.dispose()
    await second.dispose()
  })
})
