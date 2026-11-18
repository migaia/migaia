import { afterEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { createDomHarness, element, nodeOf } from './fixtures.ts'

afterEach(() => {
  document.body.replaceChildren()
})

describe('focus', () => {
  it('makes the background inert while a modal part is open and restores focus on close', async () => {
    const { host, dom } = await createDomHarness()
    const main = element<HTMLElement>('main', document.body)
    const trigger = element<HTMLButtonElement>('button', main, { 'data-part-address': 'p/open' })
    const other = element<HTMLButtonElement>('button', main, { 'data-part-address': 'p/other' })
    const dialog = element<HTMLDialogElement>('dialog', document.body, {
      'data-part-address': 'p/d'
    })
    element<HTMLButtonElement>('button', dialog)
    const modal = nodeOf('p/d', { layer: 'top', focus: { restore: true } })

    trigger.focus()
    dom.focus.open('p/d', dialog, modal)
    dom.layer.open('p/d', dialog, modal, () => undefined)
    expect(main.inert).toBe(true)
    expect(dialog.contains(document.activeElement)).toBe(true)
    dom.layer.close('p/d')
    dom.focus.close('p/d')
    expect(main.inert).toBe(false)
    expect(document.activeElement).toBe(trigger)

    trigger.focus()
    dom.focus.open('p/d', dialog, modal)
    dom.layer.open('p/d', dialog, modal, () => undefined)
    trigger.remove()
    dom.layer.close('p/d')
    dom.focus.close('p/d')
    expect(document.activeElement).toBe(other)
    expect(document.activeElement).not.toBe(document.body)
    await host.dispose()
  })
})

describe('layers', () => {
  it('stacks a dropdown above a modal, closes the top on Escape, and keeps stacked z-index through style updates', async () => {
    const { host, dom } = await createDomHarness()
    const dismissed: string[] = []
    const dialog = element<HTMLDialogElement>('dialog', document.body, { 'data-part-address': 'm' })
    const dropdown = element<HTMLDivElement>('div', dialog, { 'data-part-address': 'm/p' })
    dropdown.textContent = 'options'
    dom.layer.open('m', dialog, nodeOf('m', { layer: 'top' }), (address) => dismissed.push(address))
    dom.layer.open('m/p', dropdown, nodeOf('m/p', { layer: 'dropdown' }), (address) =>
      dismissed.push(address)
    )
    expect(dialog.matches(':modal')).toBe(true)
    expect(dropdown.matches(':popover-open')).toBe(true)
    const box = dropdown.getBoundingClientRect()
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    expect(hit === dropdown || dropdown.contains(hit)).toBe(true)

    await userEvent.keyboard('{Escape}')
    expect(dismissed).toEqual(['m/p'])
    expect(dom.layer.top()).toBe('m')
    await userEvent.keyboard('{Escape}')
    expect(dismissed).toEqual(['m/p', 'm'])
    expect(dialog.open).toBe(false)
    expect(() => dom.layer.close('m/p')).not.toThrow()

    const menu = element<HTMLDivElement>('div', document.body, { 'data-part-address': 'menu' })
    dom.layer.open('menu', menu, nodeOf('menu', { layer: 'dropdown' }), () => undefined)
    expect(getComputedStyle(menu).zIndex).toBe('1000')
    expect(menu.hasAttribute('style')).toBe(false)
    dom.stylesheet.apply([{ address: 'menu', layer: 'blueprint', declarations: { color: 'red' } }])
    expect(getComputedStyle(menu).zIndex).toBe('1000')
    dom.layer.close('menu')
    expect(getComputedStyle(menu).zIndex).toBe('auto')
    await host.dispose()
  })
})
