import { createPartHost, definePart, definePartPlugin, type IPartHost } from '@migaia/part-host'
import { domPlugin } from '@migaia/part-plugin-dom'
import type { ReactNode, Ref } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { bindReactComponent, reactPlugin } from '../src/index.ts'

/** Waits for React commits, layout effects and scroll events. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 60))
}

/** Scrolling table: a 200px container around a table body that receives the rows. */
function ScrollTable(props: {
  readonly ref?: Ref<HTMLDivElement>
  readonly children?: ReactNode
}): ReactNode {
  return (
    <div ref={props.ref} data-scroll="" style={{ height: 200, overflowY: 'auto' }}>
      <table style={{ borderCollapse: 'collapse' }}>
        <tbody>{props.children}</tbody>
      </table>
    </div>
  )
}

/** One 20px row. */
function Row(props: {
  readonly ref?: Ref<HTMLTableRowElement>
  readonly label?: unknown
}): ReactNode {
  return (
    <tr ref={props.ref} style={{ height: 20 }}>
      <td style={{ padding: 0, height: 20 }}>{String(props.label)}</td>
    </tr>
  )
}

/** Parts and bindings of the test. */
const table = definePart({ id: 'table@1' })
const row = definePart({ id: 'row@1' })
const plugin = definePartPlugin({
  name: 'virtual-fixtures',
  parts: [table, row],
  implementations: [bindReactComponent(table, ScrollTable), bindReactComponent(row, Row)]
})

/** Rows `r0 … r(n-1)`. */
function rows(count: number): { id: string; label: string }[] {
  return Array.from({ length: count }, (_, index) => ({ id: `r${index}`, label: `Row ${index}` }))
}

/** Mounts a table whose template is virtual unless `plain`, returning the host. */
async function mount(plain: boolean, count: number): Promise<IPartHost> {
  /** Host with DOM, React and fixture plugins. */
  const host = await createPartHost({ plugins: [domPlugin, reactPlugin, plugin] })
  host.state.write('page.rows', rows(count))
  await host.blueprint.load({
    id: 'bp',
    version: 1,
    root: {
      tag: 'table@1',
      id: 'table',
      template: {
        rowKey: 'id',
        rows: { $state: 'page.rows' },
        ...(plain ? {} : { virtual: { rowHeight: 20, overscan: 2 } }),
        node: { tag: 'row@1', id: 'row', facets: { props: { label: { $row: 'label' } } } }
      }
    }
  })
  /** Mount container. */
  const container = document.createElement('div')
  document.body.append(container)
  host.mount(container, 'bp')
  await settle()
  return host
}

/** Rendered row elements. */
function renderedRows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-part-address*="@row:"]')]
}

/** Total inline height of the spacers. */
function spacerHeight(): number {
  return [...document.querySelectorAll<HTMLElement>('[data-part-spacer]')].reduce(
    (sum, spacer) => sum + Number.parseFloat(spacer.style.height || '0'),
    0
  )
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('virtual template rows', () => {
  it('renders only visible rows plus overscan, follows scrolling and clamps when rows shrink', async () => {
    /** Host under test. */
    const host = await mount(false, 10000)
    expect(renderedRows()).toHaveLength(12)
    /** Scroll container. */
    const scroller = document.querySelector('[data-scroll]') as HTMLElement
    scroller.scrollTop = 4000
    scroller.dispatchEvent(new Event('scroll'))
    await settle()
    expect(renderedRows()[0]?.getAttribute('data-part-address')).toBe('table/row@row:r198')
    expect(spacerHeight() + renderedRows().length * 20).toBe(200000)
    for (const spacer of document.querySelectorAll('[data-part-spacer]')) {
      expect(spacer.tagName).toBe('TR')
      expect(spacer.getAttribute('aria-hidden')).toBe('true')
    }
    host.state.write('page.rows', rows(50))
    await settle()
    scroller.dispatchEvent(new Event('scroll'))
    await settle()
    expect(scroller.scrollTop).toBe(scroller.scrollHeight - scroller.clientHeight)
    expect(spacerHeight() + renderedRows().length * 20).toBe(1000)
    await host.dispose()
  })

  it('renders every row without virtual settings', async () => {
    /** Host under test. */
    const host = await mount(true, 300)
    expect(renderedRows()).toHaveLength(300)
    expect(document.querySelectorAll('[data-part-spacer]')).toHaveLength(0)
    await host.dispose()
  })
})
