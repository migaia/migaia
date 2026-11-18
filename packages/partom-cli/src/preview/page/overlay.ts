import { PreviewText } from './text.ts'

/** Issue fields the overlay shows. */
export type IOverlayIssue = {
  readonly rule: string
  readonly address: string
  readonly messageKey: string
  readonly severity: 'error' | 'warning'
}

/** Attribute that marks the element highlighted from the overlay. */
const HIGHLIGHT_ATTRIBUTE = 'data-partom-highlight'

/** Page style of the highlight; the only style the preview adds outside its shadow root. */
const HIGHLIGHT_STYLE = `[${HIGHLIGHT_ATTRIBUTE}] { outline: 2px solid #e5484d; outline-offset: 2px }`

/** Style of the overlay inside its shadow root. */
const OVERLAY_STYLE = `
:host { all: initial; position: fixed; inset-block-end: 12px; inset-inline-end: 12px; z-index: 2147483647; font: 13px/1.4 system-ui, sans-serif }
section { background: #fff; color: #111; border: 1px solid #ccc; border-radius: 8px; padding: 8px 12px; max-width: 420px; max-height: 50vh; overflow: auto; box-shadow: 0 4px 16px rgb(0 0 0 / 0.15) }
h2 { font-size: 13px; margin: 8px 0 4px }
button { display: block; text-align: start; width: 100%; font: inherit; background: none; border: 0; padding: 2px 0; cursor: pointer; color: inherit }
button:hover, button:focus-visible { text-decoration: underline }
p { margin: 4px 0 }
`

/**
 * Issue overlay of the preview page. Its host element is appended to the end of `body` and its
 * content lives in an open shadow root, so page styles do not reach it, it carries no region
 * attribute (F6 skips it) and it comes after the page in Tab order.
 */
export class PreviewOverlay {
  /** Document the overlay belongs to. */
  readonly #document: Document
  /** Shadow content root, created on first show. */
  #section: HTMLElement | undefined

  /** Binds the overlay to a document; nothing is added until something is shown. */
  constructor(document: Document) {
    this.#document = document
  }

  /** Shows a blueprint's issues grouped by severity; `skipped` adds the not-mounted note. */
  showIssues(issues: readonly IOverlayIssue[], skipped: boolean): void {
    if (issues.length === 0) return
    /** Content root. */
    const section = this.#open()
    if (skipped) this.#line(section, 'p', PreviewText.skipped)
    this.#group(section, PreviewText.errors, issues, 'error')
    this.#group(section, PreviewText.warnings, issues, 'warning')
  }

  /** Shows a failed rebuild. */
  showBuildError(message: string): void {
    /** Content root. */
    const section = this.#open()
    this.#line(section, 'h2', PreviewText.buildError)
    this.#line(section, 'p', message)
  }

  /** One severity group with one button per issue. */
  #group(
    section: HTMLElement,
    heading: string,
    issues: readonly IOverlayIssue[],
    severity: IOverlayIssue['severity']
  ): void {
    /** Issues of this severity. */
    const selected = issues.filter((issue) => issue.severity === severity)
    if (selected.length === 0) return
    this.#line(section, 'h2', heading)
    for (const issue of selected) {
      /** Button highlighting the issue's element. */
      const button = this.#line(
        section,
        'button',
        PreviewText.issue(issue.rule, issue.address, issue.messageKey)
      )
      button.dataset.address = issue.address
      button.addEventListener('click', this)
    }
  }

  /** Highlights and scrolls to the element of a clicked issue. */
  handleEvent(event: Event): void {
    /** Address of the clicked issue. */
    const address = (event.currentTarget as HTMLElement).dataset.address ?? ''
    for (const marked of this.#document.querySelectorAll(`[${HIGHLIGHT_ATTRIBUTE}]`))
      marked.removeAttribute(HIGHLIGHT_ATTRIBUTE)
    /** Element of the address. */
    const target = this.#document.querySelector(`[data-part-address="${CSS.escape(address)}"]`)
    if (target === null) return
    target.setAttribute(HIGHLIGHT_ATTRIBUTE, '')
    target.scrollIntoView({ block: 'center' })
  }

  /** Appends a text element. */
  #line(parent: HTMLElement, tag: string, text: string): HTMLElement {
    /** New element. */
    const element = this.#document.createElement(tag)
    element.textContent = text
    parent.append(element)
    return element
  }

  /** Creates the host, shadow root and highlight style once. */
  #open(): HTMLElement {
    if (this.#section !== undefined) return this.#section
    /** Host element at the end of the body. */
    const host = this.#document.createElement('partom-overlay')
    /** Shadow root of the host. */
    const shadow = host.attachShadow({ mode: 'open' })
    /** Shadow style. */
    const style = this.#document.createElement('style')
    style.textContent = OVERLAY_STYLE
    this.#section = this.#document.createElement('section')
    shadow.append(style, this.#section)
    this.#document.body.append(host)
    /** Page style of the highlight outline. */
    const highlight = this.#document.createElement('style')
    highlight.textContent = HIGHLIGHT_STYLE
    this.#document.head.append(highlight)
    return this.#section
  }
}
