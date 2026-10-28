import { detectServerRuntime, ServerRuntime } from '@migaia/utils'
import type { IFileWriter } from './typing.ts'

/** Node and Bun share appendFile; Bun's own Node compatibility implementation preserves append. */
class NodeFileWriter implements IFileWriter {
  /** Load Node's native module only when the selected server writer actually appends. */
  async append(path: string, text: string): Promise<void> {
    /** The built-in append capability is borrowed independently for each operation. */
    const fs = await import('node:fs/promises')
    await fs.appendFile(path, text, 'utf8')
  }
}

/** Deno exposes the existing native append option without importing Node compatibility modules. */
type IDenoFiles = {
  writeTextFile(path: string, text: string, options: { append: boolean }): Promise<void>
}

/** Deno's native writer retains its original capability receiver. */
class DenoFileWriter implements IFileWriter {
  /** The native capability belongs to the host, not this output's lifecycle. */
  #deno: IDenoFiles
  /** Borrow the native Deno filesystem without resolving a Node module. */
  constructor(deno: IDenoFiles) {
    this.#deno = deno
  }
  /** Append using Deno's native option rather than a replacement/overwrite write. */
  async append(path: string, text: string): Promise<void> {
    await this.#deno.writeTextFile(path, text, { append: true })
  }
}

/** Select native server capabilities once; unsupported defaults remain explicit creation errors. */
export function nativeFileWriter(): IFileWriter | undefined {
  /** The canonical runtime detector gives Deno precedence over compatibility process globals. */
  const runtime = detectServerRuntime()
  if (runtime === ServerRuntime.deno)
    return new DenoFileWriter((globalThis as unknown as { Deno: IDenoFiles }).Deno)
  if (runtime === ServerRuntime.node || runtime === ServerRuntime.bun) return new NodeFileWriter()
  return undefined
}
