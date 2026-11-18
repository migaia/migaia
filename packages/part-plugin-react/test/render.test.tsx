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
})
