import { afterEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { renderCounts } from './fixtures/components.tsx'
import { mountBlueprint, received } from './fixtures/harness.ts'

/** Waits for React commits and microtasks. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 30))
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('rendering', () => {
  it('re-renders only the node whose bound state changed and survives double unmount', async () => {
    const { host, container } = await mountBlueprint({
      tag: 'page@1',
      id: 'p',
      children: ['a', 'b', 'c'].map((id) => ({
        tag: 'button@1',
        id,
        facets: { props: { label: { $state: `page.${id}` } } }
      }))
    })
    host.state.write('page.a', 'A')
    host.state.write('page.b', 'B')
    host.state.write('page.c', 'C')
    await settle()
    renderCounts.clear()
    host.state.write('page.a', 'A2')
    await settle()
    expect([...renderCounts.entries()]).toEqual([['A2', 1]])
    expect(container.textContent).toContain('A2')

    const second = document.createElement('div')
    document.body.append(second)
    const extra = host.mount(second, 'bp')
    await settle()
    extra.unmount()
    extra.unmount()
    await settle()
    expect(second.textContent).toBe('')
    host.state.write('page.b', 'B2')
    await settle()
    expect(container.textContent).toContain('B2')
    await host.dispose()
  })
})

describe('binding', () => {
  it('passes cva variants, forwards component events and isolates an unbound part', async () => {
    const errors: unknown[] = []
    received.length = 0
    const { host, container } = await mountBlueprint(
      {
        tag: 'page@1',
        id: 'p',
        children: [
          {
            tag: 'button@1',
            id: 'danger',
            facets: { props: { variant: 'destructive', label: 'Delete' } }
          },
          {
            tag: 'combobox@1',
            id: 'fruit',
            facets: { events: { valueChange: { handler: 'record@1' } } }
          },
          { tag: 'unbound@1', id: 'ghost' }
        ]
      },
      errors
    )
    expect(container.querySelector('button')?.className).toContain('bg-destructive')
    await userEvent.type(container.querySelector('input') as HTMLInputElement, 'a')
    await settle()
    expect(received).toEqual([{ address: 'p/fruit', name: 'valueChange', detail: 'a' }])
    expect(errors).toEqual([
      expect.objectContaining({ code: 'BINDING_MISSING', source: 'part.react' })
    ])
    expect(container.querySelector('input')).not.toBeNull()
    await host.dispose()
  })

  it('renders one instance per template row and routes delegated events to the row instance', async () => {
    const errors: unknown[] = []
    received.length = 0
    const { host, container } = await mountBlueprint(
      {
        tag: 'list@1',
        id: 'rows',
        template: {
          rowKey: 'id',
          rows: { $state: 'page.rows' },
          node: {
            tag: 'item@1',
            id: 'item',
            facets: {
              props: { label: { $row: 'name' } },
              events: { click: { handler: 'record@1' } },
              style: { '--part-item-accent': '#ff0000' }
            }
          }
        }
      },
      errors
    )
    host.state.write('page.rows', [
      { id: 1, name: 'one' },
      { id: 'a/b', name: 'two' }
    ])
    await settle()
    const items = [...container.querySelectorAll('li')]
    expect(items.map((item) => item.textContent)).toEqual(['one', 'two'])
    expect(items.map((item) => item.getAttribute('data-part-address'))).toEqual([
      'rows/item@row:1',
      'rows/item@row:a%2Fb'
    ])
    expect(getComputedStyle(items[1] as HTMLLIElement).getPropertyValue('--part-item-accent')).toBe(
      '#ff0000'
    )

    await userEvent.click(items[1]?.querySelector('span') as HTMLSpanElement)
    await settle()
    expect(received).toEqual([
      { address: 'rows/item@row:a%2Fb', name: 'click', detail: undefined, rowKey: 'a/b' }
    ])

    host.state.write('page.rows', [{ id: 3, name: 'three' }])
    await settle()
    expect([...container.querySelectorAll('li')].map((item) => item.textContent)).toEqual(['three'])
    expect(errors).toEqual([])
    await host.dispose()
  })
})
