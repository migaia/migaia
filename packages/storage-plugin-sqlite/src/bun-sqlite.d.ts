/** Minimal builtin declaration keeps Bun's hard runtime requirement out of the neutral root. */
declare module 'bun:sqlite' {
  export class Database {
    constructor(path: string, options: { safeIntegers: true })
    exec(text: string): unknown
    prepare(text: string): import('./driver.ts').INativeStatement
    close(throwOnError: true): void
  }
}
