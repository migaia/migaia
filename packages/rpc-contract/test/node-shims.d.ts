declare module 'node:fs' {
  export type IDirent = {
    readonly name: string
    isDirectory: () => boolean
  }
  export function readFileSync(path: string, encoding: 'utf8'): string
  export function readdirSync(path: string, options: { withFileTypes: true }): IDirent[]
}

declare module 'node:path' {
  export function dirname(path: string): string
  export function join(...parts: string[]): string
}

declare module 'node:vm' {
  export function createContext(sandbox?: object): object
  export function runInContext(code: string, context: object): unknown
}

interface ImportMeta {
  readonly url: string
}
