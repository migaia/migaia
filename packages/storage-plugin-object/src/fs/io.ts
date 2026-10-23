/** Native adapters expose filesystem effects only; object layout and blob rules stay shared. */
export type IObjectFileIo = {
  root(path: string): Promise<string>
  mkdir(path: string): Promise<void>
  readText(path: string): Promise<string>
  writeText(path: string, text: string): Promise<void>
  write(path: string, source: ReadableStream<Uint8Array>): Promise<void>
  read(
    path: string,
    start: number,
    end: number
  ): Promise<{ readonly source: ReadableStream<Uint8Array>; readonly close: () => Promise<void> }>
  rename(from: string, to: string): Promise<void>
  remove(path: string): Promise<void>
  entries(path: string): Promise<readonly { readonly name: string; readonly directory: boolean }[]>
}
