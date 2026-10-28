/** The conditional Node writer requires only appendFile; portable declarations expose none of Node. */
declare module 'node:fs/promises' {
  /** Append one UTF-8 batch without truncating existing file contents. */
  export function appendFile(path: string, text: string, encoding: 'utf8'): Promise<void>
}
