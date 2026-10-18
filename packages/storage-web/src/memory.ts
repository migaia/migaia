/**
 * Provides the DOM-free subpath exporting only the in-memory `memoryStorageHost` backend. Stays
 * separate from the root error/namespace entry and the explicit DOM backend subpaths. SSR, Node,
 * and tests import `@migaia/storage-web/memory` without exposing IndexedDB or Web Storage DOM types
 * to compilation fixtures that do not include DOM libraries.
 */
export { memoryStorageHost } from './backends/memory.js'
