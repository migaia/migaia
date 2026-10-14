/**
 * The one Node builtin the file plugin loads lazily (`append` in `plugins/file.ts`). Logger
 * typechecks against the ES library without Node types, so this declares only the member it calls.
 * It is a compile-time input only and is never emitted; tests use the real `@types/node`.
 */
declare module 'node:fs/promises' {
  export function appendFile(path: string, data: string, encoding: 'utf8'): Promise<void>
}
