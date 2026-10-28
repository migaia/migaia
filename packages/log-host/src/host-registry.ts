import type { LogHost } from './host.ts'

/** Frozen facade identity resolves to its actual owner without a reverse runtime dependency. */
export const logHostOwners = new WeakMap<object, LogHost>()
