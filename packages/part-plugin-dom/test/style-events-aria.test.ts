import { defineEffect, definePart, definePartPlugin } from '@migaia/part-host'
import { afterEach, describe, expect, it } from 'vitest'
import { PartDomErrorCode } from '../src/index.ts'
import { createDomHarness, element, nodeOf } from './fixtures.ts'

afterEach(() => {
  document.body.replaceChildren()
})

describe('style sheet', () => {
  it('keeps one sheet, layers rules per address and replaces declarations', async () => {
    const { host, dom } = await createDomHarness()
    const a = element<HTMLDivElement>('div', document.body, { 'data-part-address': 'a"]x' })
    const b = element<HTMLDivElement>('div', document.body, { 'data-part-address': 'b' })
    dom.stylesheet.apply([
      { address: 'a"]x', layer: 'parts', declarations: { color: 'rgb(255, 0, 0)', margin: '1px' } },
      { address: 'a"]x', layer: 'blueprint', declarations: { color: 'rgb(0, 0, 255)' } },
      { address: 'b', layer: 'parts', declarations: { color: 'rgb(0, 128, 0)' } }
    ])
    const sheetCount = document.adoptedStyleSheets.length
    dom.stylesheet.apply([
      { address: 'a"]x', layer: 'parts', declarations: { color: 'rgb(0, 128, 0)' } }
    ])
    expect(document.adoptedStyleSheets).toHaveLength(sheetCount)
    expect(getComputedStyle(a).color).toBe('rgb(0, 0, 255)')
    expect(getComputedStyle(a).marginTop).toBe('0px')
    dom.stylesheet.remove('b')
    expect(getComputedStyle(b).color).not.toBe('rgb(0, 128, 0)')
    expect(document.querySelectorAll('[style]')).toHaveLength(0)
    await host.dispose()
    expect(document.adoptedStyleSheets).toHaveLength(sheetCount - 1)
  })
})

describe('events', () => {
  it('applies modifiers, honours once, dispatches custom events and reports only unreported failures', async () => {
    const errors: unknown[] = []
    const clicks: unknown[] = []
    const plugin = definePartPlugin({
      name: 'orders',
      parts: [definePart({ id: 'button@1' })],
      effects: [
        defineEffect({ id: 'click@1', run: (event) => void clicks.push(event.name) }),
        defineEffect({
          id: 'fails@1',
          run: () => {
            throw new Error('boom')
          }
        })
      ]
    })
    const { host, dom } = await createDomHarness({
      plugins: [plugin],
      onError: (error) => errors.push(error)
    })
    await host.blueprint.load({
      id: 'bp',
      version: 1,
      root: {
        tag: 'button@1',
        id: 'b',
        facets: { events: { click: { handler: 'click@1' }, fail: { handler: 'fails@1' } } }
      }
    })
    const button = element<HTMLButtonElement>('button', document.body)
    const link = element<HTMLAnchorElement>('a', button, { href: '#x' })
    dom.events.subscribe('b', link, 'click', {
      handler: 'click@1',
      modifiers: ['prevent'],
      once: true
    })
    const first = new MouseEvent('click', { bubbles: true, cancelable: true })
    link.dispatchEvent(first)
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(first.defaultPrevented).toBe(true)
    expect(clicks).toEqual(['click'])

    const stopper = element<HTMLDivElement>('div', document.body)
    stopper.addEventListener('click', (event) => event.stopPropagation())
    const outsideTarget = element<HTMLSpanElement>('span', stopper)
    const removeOutside = dom.events.subscribe('b', button, 'click', {
      handler: 'click@1',
      modifiers: ['outside']
    })
    link.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    outsideTarget.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(clicks).toEqual(['click', 'click'])
    removeOutside()
    outsideTarget.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(clicks).toEqual(['click', 'click'])

    let reached = false
    button.addEventListener('orders:row-expand', () => (reached = true))
    dom.events.dispatchCustom(
      link,
      'orders:row-expand',
      { kind: 'custom', bubbles: true },
      { id: 1 }
    )
    expect(reached).toBe(true)
    expect(() =>
      dom.events.dispatchCustom(link, 'row-expand', { kind: 'custom' }, undefined)
    ).toThrow(
      expect.objectContaining({
        code: PartDomErrorCode.customEventUnnamespaced,
        source: 'part.dom'
      })
    )

    dom.events.subscribe('b', button, 'fail', { handler: 'fails@1' })
    button.dispatchEvent(new CustomEvent('fail'))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ code: 'EFFECT_FAILED' })
    await host.dispose()
  })
})

describe('aria', () => {
  it('resolves relations to ids, writes tab index and the address attribute', async () => {
    const { host, dom } = await createDomHarness()
    const input = element<HTMLInputElement>('input', document.body)
    const list = element<HTMLUListElement>('ul', document.body)
    dom.aria.apply(input, nodeOf('c/input', {}, { derivedAria: { controls: 'c/list' } }))
    dom.aria.apply(list, nodeOf('c/list', {}))
    expect(input.getAttribute('aria-controls')).toBe(list.id)
    expect(input.getAttribute('data-part-address')).toBe('c/input')
    const options = ['a', 'b', 'c'].map((name, index) => {
      const option = element<HTMLLIElement>('li', list)
      dom.aria.apply(option, nodeOf(`c/list/${name}`, {}, { tabIndex: index === 0 ? 0 : -1 }))
      return option
    })
    expect(options.map((option) => option.tabIndex)).toEqual([0, -1, -1])
    await host.dispose()
  })
})

/** Vite's eager raw glob, available on import.meta in browser-mode tests. */
type IGlob = (pattern: string, options: Record<string, unknown>) => unknown

describe('framework independence', () => {
  it('has no React import in the source', () => {
    const files = (import.meta as unknown as { glob: IGlob }).glob('../src/**/*.ts', {
      query: '?raw',
      import: 'default',
      eager: true
    }) as Record<string, string>
    expect(Object.values(files).filter((text) => /from ['"]react/.test(text))).toEqual([])
  })
})
