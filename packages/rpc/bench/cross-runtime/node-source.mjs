/** Node 24 runs actual TS through the required minimal relative-extension resolver. */
import { register } from 'node:module'
register(new URL('./probe/resolve-hook.mjs', import.meta.url), import.meta.url)
await import(new URL('./endpoint.ts', import.meta.url))
