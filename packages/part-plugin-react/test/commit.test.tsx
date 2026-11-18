import { afterEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { mountBlueprint } from './fixtures/harness.ts'

/** Waits for React commits, effects and focus moves. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50))
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('commit-phase collaboration', () => {
  it('lets a component-managed Radix dialog own focus while writing its open state back', async () => {
    const errors: unknown[] = []
    const { host, container } = await mountBlueprint(
      { tag: 'radix-dialog@1', id: 'r', facets: { props: { title: 'Radix' } } },
      errors
    )
    const trigger = container.querySelector('button') as HTMLButtonElement
    await userEvent.click(trigger)
    await settle()
    expect(host.state.read('part.r.open')).toBe(true)
    expect(document.querySelector('[role="dialog"]')?.contains(document.activeElement)).toBe(true)
    await userEvent.keyboard('{Escape}')
    await settle()
    expect(host.state.read('part.r.open')).toBe(false)
    expect(document.activeElement).toBe(trigger)
    expect(errors).toEqual([])
    await host.dispose()
  })

  it('manages a native dialog through the DOM plugin and restores focus to its trigger', async () => {
    const errors: unknown[] = []
    const { host, container } = await mountBlueprint(
      {
        tag: 'page@1',
        id: 'p',
        children: [
          {
            tag: 'button@1',
            id: 'open',
            facets: {
              props: { label: 'Open native' },
              events: { click: { handler: 'open-native@1' } }
            }
          },
          {
            tag: 'native-dialog@1',
            id: 'n',
            facets: { props: { open: { $state: 'page.native' } } }
          }
        ]
      },
      errors
    )
    const trigger = container.querySelector('button') as HTMLButtonElement
    const dialog = container.querySelector('dialog') as HTMLDialogElement
    await userEvent.click(trigger)
    await settle()
    expect(dialog.matches(':modal')).toBe(true)
    expect(dialog.contains(document.activeElement)).toBe(true)
    await userEvent.keyboard('{Escape}')
    await settle()
    expect(host.state.read('page.native')).toBe(false)
    expect(dialog.open).toBe(false)
    expect(document.activeElement).toBe(trigger)
    expect(dialog.getAttribute('data-part-address')).toBe('p/n')
    expect(errors).toEqual([])
    await host.dispose()
    expect(document.adoptedStyleSheets.length).toBe(0)
  })
})
