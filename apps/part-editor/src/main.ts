#!/usr/bin/env bun
import { EditorServer } from './server.ts'
import { USAGE } from './text.ts'

/** Value after a flag, or undefined. */
function flag(argv: readonly string[], name: string): string | undefined {
  /** Position of the flag. */
  const index = argv.indexOf(name)
  return index === -1 ? undefined : argv[index + 1]
}

/** Runs `serve --service <url> --preview <url> [--port 0]` and prints `{ url }`. */
async function main(argv: readonly string[]): Promise<number> {
  /** Catalog URL. */
  const service = flag(argv, '--service')
  /** Preview URL. */
  const preview = flag(argv, '--preview')
  if (argv[0] !== 'serve' || service === undefined || preview === undefined) {
    console.error(USAGE)
    return 2
  }
  /** Started server URL. */
  const url = await new EditorServer({ service, preview }).start(Number(flag(argv, '--port') ?? 0))
  console.log(JSON.stringify({ url }))
  return 0
}

/** Exit code; the server keeps the process alive after a successful start. */
const code = await main(process.argv.slice(2))
if (code !== 0) process.exit(code)
