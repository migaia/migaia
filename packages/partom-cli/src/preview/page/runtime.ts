/**
 * Browser runtime of `partom preview`, bundled into every generation's page script. The generated
 * entry imports the project's config and part packages and calls `startPreviewPage`; this module
 * imports nothing from the project, so the executable can embed it pre-bundled.
 */
import { PAGE_ROOT_ID, PreviewEvent, PreviewRoute } from '../constants.ts'
import { PreviewOverlay, type IOverlayIssue } from './overlay.ts'
import { PreviewText } from './text.ts'

/** A plugin as the page sees it: only its name is read, for de-duplication. */
type IPagePlugin = { readonly name?: string }

/** Host surface the page uses. */
type IPageHost = {
  readonly blueprint: { load(input: unknown): Promise<{ readonly blueprintId: string }> }
  mount(target: unknown, blueprintId: string): unknown
}

/** What the generated entry hands to the runtime: config and the project's host and renderers. */
export type IPreviewDeps = {
  readonly config: { readonly plugins: readonly IPagePlugin[] }
  readonly createPartHost: (options: {
    readonly plugins: readonly IPagePlugin[]
  }) => Promise<IPageHost>
  readonly domPlugin: IPagePlugin
  readonly reactPlugin: IPagePlugin
}

/** One entry of `/api/blueprints`. */
type IListEntry = {
  readonly id: string
  readonly file: string
  readonly errors: number
  readonly warnings: number
}

/** Reloads on `reload` and shows `build-error` in the overlay. */
class EventListenerBridge {
  /** Overlay used for build errors. */
  readonly #overlay: PreviewOverlay

  /** Binds the bridge to the page overlay. */
  constructor(overlay: PreviewOverlay) {
    this.#overlay = overlay
  }

  /** Handles one Server-Sent Event. */
  handleEvent(event: Event): void {
    if (event.type === PreviewEvent.reload) {
      location.reload()
      return
    }
    /** Event payload. */
    const data = JSON.parse((event as MessageEvent<string>).data) as {
      message?: string
      code?: string
    }
    this.#overlay.showBuildError([data.code, data.message].filter(Boolean).join(': '))
  }
}

/** Renders the home page: one link per blueprint with its issue counts. */
async function renderHome(root: HTMLElement): Promise<void> {
  document.title = PreviewText.homeTitle
  /** Blueprint list. */
  const list = (await (await fetch(PreviewRoute.api)).json()) as { blueprints: IListEntry[] }
  /** Heading. */
  const heading = document.createElement('h1')
  heading.textContent = PreviewText.homeHeading
  root.append(heading)
  if (list.blueprints.length === 0) {
    /** Empty note. */
    const empty = document.createElement('p')
    empty.textContent = PreviewText.homeEmpty
    root.append(empty)
    return
  }
  /** Link list. */
  const items = document.createElement('ul')
  for (const entry of list.blueprints) {
    /** List item. */
    const item = document.createElement('li')
    /** Link to the preview page. */
    const link = document.createElement('a')
    link.href = `${PreviewRoute.blueprint}${encodeURIComponent(entry.id)}`
    link.textContent = entry.id
    item.append(link, ` — ${entry.file} — ${PreviewText.counts(entry.errors, entry.warnings)}`)
    items.append(item)
  }
  root.append(items)
}

/**
 * Renders one blueprint: shows its issues in the overlay and, without static errors, mounts it with
 * the config's plugins plus the project's DOM and React plugins (once each).
 */
async function renderBlueprint(
  root: HTMLElement,
  id: string,
  deps: IPreviewDeps,
  overlay: PreviewOverlay
): Promise<void> {
  document.title = id
  /** Document and issues of the blueprint. */
  const detail = (await (await fetch(`${PreviewRoute.api}/${encodeURIComponent(id)}`)).json()) as {
    document: unknown
    issues: IOverlayIssue[]
  }
  /** Whether a static error stops the mount. */
  const blocked = detail.issues.some((issue) => issue.severity === 'error')
  overlay.showIssues(detail.issues, blocked)
  if (blocked) return
  /** Config plugins other than the DOM and React plugins added below. */
  const plugins = deps.config.plugins.filter(
    (plugin) => plugin.name !== deps.domPlugin.name && plugin.name !== deps.reactPlugin.name
  )
  /** Host of the preview. */
  const host = await deps.createPartHost({
    plugins: [deps.domPlugin, deps.reactPlugin, ...plugins]
  })
  /** Load result. */
  const loaded = await host.blueprint.load(detail.document)
  host.mount(root, loaded.blueprintId)
}

/** Starts the page: event stream, then the home page or a blueprint page by path. */
export async function startPreviewPage(deps: IPreviewDeps): Promise<void> {
  /** Issue and build-error overlay. */
  const overlay = new PreviewOverlay(document)
  /** Event stream of the server. */
  const events = new EventSource(PreviewRoute.events)
  /** Listener object for both events. */
  const bridge = new EventListenerBridge(overlay)
  events.addEventListener(PreviewEvent.reload, bridge)
  events.addEventListener(PreviewEvent.buildError, bridge)
  /** Mount container. */
  const root = document.getElementById(PAGE_ROOT_ID) as HTMLElement
  /** Path of the page. */
  const path = location.pathname
  if (path.startsWith(PreviewRoute.blueprint))
    await renderBlueprint(
      root,
      decodeURIComponent(path.slice(PreviewRoute.blueprint.length)),
      deps,
      overlay
    )
  else await renderHome(root)
}
