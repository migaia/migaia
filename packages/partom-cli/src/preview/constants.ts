/**
 * Contract strings and limits of `partom preview`, shared by the server and the page runtime. Route
 * prefixes and event names are the only protocol between them.
 */
export const PreviewRoute = {
  /** Preview page of one blueprint: `/b/<id>`. */
  blueprint: '/b/',
  /** Bundle output of one generation: `/assets/<generation>/<file>`. */
  assets: '/assets/',
  /** Blueprint list: `/api/blueprints`; one blueprint: `/api/blueprints/<id>`. */
  api: '/api/blueprints',
  /** Server-Sent Events stream. */
  events: '/events'
} as const

/** Server-Sent Event names pushed on `/events`. */
export const PreviewEvent = {
  /** A new generation is live; the page reloads. */
  reload: 'reload',
  /** A rebuild failed; the page keeps its content and shows the error. */
  buildError: 'build-error'
} as const

/** Directory, inside the project, that holds every preview generation; nothing else writes it. */
export const PREVIEW_DIR = '.partom-preview'

/** First port tried when `--port` is not given. */
export const PREVIEW_PORT_FIRST = 4400

/** Last port tried when `--port` is not given. */
export const PREVIEW_PORT_LAST = 4419

/** Quiet period that merges file changes into one rebuild, in milliseconds. */
export const REBUILD_DEBOUNCE_MS = 100

/** Name of the bundled page script inside a generation directory. */
export const PAGE_SCRIPT = 'entry.js'

/** Element id of the container the preview page mounts into. */
export const PAGE_ROOT_ID = 'partom-root'

/**
 * Code carried by a `build-error` event when bundling the page failed. Doctor failures carry the
 * child's own error code instead. This is event data, never a thrown error.
 */
export const BUILD_FAILED = 'BUILD_FAILED'
