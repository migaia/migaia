import { ADDRESS_ATTRIBUTE } from '@migaia/part-plugin-dom'
import { HIGHLIGHT_ATTRIBUTE, PANEL_ATTRIBUTE, PANEL_MARKER, PanelPart, PanelText } from './text.ts'
import {
  bindingsOf,
  derivesView,
  jsonText,
  eventsView,
  stateView,
  stepsView,
  type IStateSurface,
  type ITraceSurface
} from './views.ts'

/** Feature surface of the devtools plugin. */
export type IDevtools = {
  open(): void
  close(): void
  select(address: string): void
  selected(): string | undefined
}

/**
 * The inspection panel of one host: a Shadow DOM host element under `document.body`, an address
 * list from `trace.addresses()` with a filter, and the selected address's enhancement steps,
 * resolved configuration, bound state, derives and events. Reads only the host's Features.
 */
export class DevtoolsPanel implements IDevtools {
  /** Trace Feature of the host. */
  readonly #trace: ITraceSurface
  /** State Feature of the host. */
  readonly #state: IStateSurface
  /** Panel host element while open. */
  #element: HTMLElement | undefined
  /** Selected address. */
  #selected: string | undefined
  /** Address filter text. */
  #filter = ''
  /** Whether the next page click picks an address. */
  #picking = false
  /** Removal of the trace subscription. */
  #unsubscribe: (() => void) | undefined
  /** Keyboard listener toggling the panel. */
  readonly #onKey = (event: KeyboardEvent): void => this.#key(event)
  /** Capture-phase click listener of the pick mode. */
  readonly #onClick = (event: MouseEvent): void => this.#click(event)

  /** Binds the panel to the host's trace and state Features. */
  constructor(trace: ITraceSurface, state: IStateSurface) {
    this.#trace = trace
    this.#state = state
  }

  /** Starts listening for the toggle shortcut and page clicks. */
  attach(): void {
    document.addEventListener('keydown', this.#onKey)
    document.addEventListener('click', this.#onClick, true)
  }

  /** Removes the panel, listeners and subscription (plugin removal or host dispose). */
  dispose(): void {
    this.close()
    document.removeEventListener('keydown', this.#onKey)
    document.removeEventListener('click', this.#onClick, true)
  }

  /** Opens the panel and subscribes to trace updates. */
  open(): void {
    if (this.#element !== undefined) return
    /** Host element of the shadow tree. */
    const element = document.createElement('div')
    element.setAttribute(PANEL_ATTRIBUTE, PANEL_MARKER)
    element.attachShadow({ mode: 'open' })
    document.body.append(element)
    this.#element = element
    this.#unsubscribe = this.#trace.subscribe(() => this.render())
    this.render()
  }

  /** Closes the panel and clears the highlight. */
  close(): void {
    this.#unsubscribe?.()
    this.#unsubscribe = undefined
    this.#element?.remove()
    this.#element = undefined
    this.#highlight(undefined)
  }

  /** Selects an address and highlights its element. */
  select(address: string): void {
    this.#selected = address
    this.#highlight(address)
    this.render()
  }

  /** Selected address. */
  selected(): string | undefined {
    return this.#selected
  }

  /** Toggles the panel on Alt+Shift+D. */
  #key(event: KeyboardEvent): void {
    if (!(event.altKey && event.shiftKey && event.code === 'KeyD')) return
    if (this.#element === undefined) this.open()
    else this.close()
  }

  /** In pick mode, selects the nearest addressed ancestor of the clicked element. */
  #click(event: MouseEvent): void {
    if (!this.#picking || this.#element?.contains(event.target as Node) === true) return
    /** Nearest addressed element. */
    const target = (event.target as Element | null)?.closest(`[${ADDRESS_ATTRIBUTE}]`)
    if (target === null || target === undefined) return
    this.#picking = false
    event.preventDefault()
    event.stopPropagation()
    this.select(target.getAttribute(ADDRESS_ATTRIBUTE) as string)
  }

  /** Moves the highlight outline to the element of an address. */
  #highlight(address: string | undefined): void {
    for (const element of document.querySelectorAll(`[${HIGHLIGHT_ATTRIBUTE}]`)) {
      element.removeAttribute(HIGHLIGHT_ATTRIBUTE)
      ;(element as HTMLElement).style.outline = ''
    }
    if (address === undefined) return
    /** Element of the address. */
    const element = document.querySelector<HTMLElement>(
      `[${ADDRESS_ATTRIBUTE}="${CSS.escape(address)}"]`
    )
    element?.setAttribute(HIGHLIGHT_ATTRIBUTE, '')
    if (element !== null) element.style.outline = '2px solid #e11d48'
  }

  /** Section with a heading and content, marked with `data-part`. */
  #section(part: string, title: string, content: HTMLElement): HTMLElement {
    /** Section element. */
    const section = document.createElement('section')
    section.dataset.part = part
    /** Heading. */
    const heading = document.createElement('h3')
    heading.textContent = title
    section.append(heading, content)
    return section
  }

  /** Address list filtered by the current filter text. */
  #tree(): HTMLElement {
    /** List element. */
    const list = document.createElement('ul')
    for (const address of this.#trace.addresses()) {
      if (this.#filter !== '' && !address.includes(this.#filter)) continue
      /** Entry button. */
      const button = document.createElement('button')
      button.textContent = address
      button.dataset.address = address
      button.addEventListener('click', () => this.select(address))
      /** List item. */
      const item = document.createElement('li')
      item.style.paddingLeft = `${address.split('/').length - 1}em`
      item.append(button)
      list.append(item)
    }
    return list
  }

  /** Controls: pick button and filter input. */
  #controls(): HTMLElement {
    /** Toolbar. */
    const bar = document.createElement('div')
    /** Pick button. */
    const pick = document.createElement('button')
    pick.textContent = PanelText.pick
    pick.dataset.part = PanelPart.pick
    pick.addEventListener('click', () => void (this.#picking = true))
    /** Filter input. */
    const filter = document.createElement('input')
    filter.placeholder = PanelText.filter
    filter.dataset.part = PanelPart.filter
    filter.value = this.#filter
    filter.addEventListener('input', () => {
      this.#filter = filter.value
      this.render()
    })
    bar.append(pick, filter)
    return bar
  }

  /** Re-renders the shadow tree. */
  render(): void {
    /** Shadow root of the open panel. */
    const root = this.#element?.shadowRoot
    if (root === undefined || root === null) return
    /** Panel content. */
    const panel = document.createElement('div')
    panel.style.cssText =
      'position:fixed;right:0;top:0;bottom:0;width:360px;overflow:auto;background:#fff;color:#111;font:12px monospace;padding:8px;border-left:1px solid #ccc;z-index:2147483647'
    panel.append(this.#controls(), this.#section(PanelPart.tree, PanelText.title, this.#tree()))
    /** Selected address. */
    const address = this.#selected
    if (address !== undefined) {
      /** Resolved configuration. */
      const resolved = this.#trace.resolved(address)
      /** Bindings in the configuration. */
      const bindings = bindingsOf(resolved)
      /** Resolved JSON block. */
      const config = document.createElement('pre')
      config.textContent = jsonText(resolved)
      panel.append(
        this.#section(PanelPart.steps, PanelText.steps, stepsView(document, this.#trace, address)),
        this.#section(PanelPart.resolved, PanelText.resolved, config),
        this.#section(
          PanelPart.state,
          PanelText.state,
          stateView(document, this.#state, bindings.states)
        ),
        this.#section(
          PanelPart.derives,
          PanelText.derives,
          derivesView(document, this.#trace, bindings.derives)
        ),
        this.#section(
          PanelPart.events,
          PanelText.events,
          eventsView(document, this.#trace, address)
        )
      )
    }
    root.replaceChildren(panel)
  }
}
