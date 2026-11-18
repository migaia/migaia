import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { chromium, type Browser } from 'playwright-core'
import { browserPath } from '../src/harness.ts'
import { BUN, FIXTURES } from './run.ts'

/** CLI source entry run through Bun. */
export const CLI = join(import.meta.dirname, '..', 'src', 'cli.ts')

/**
 * Copies the preview fixture next to the other fixtures, so its relative imports and the
 * repository's packages still resolve, and returns the copy's directory.
 */
export function copyPreviewApp(): string {
  /** Fresh copy directory. */
  const dir = mkdtempSync(join(FIXTURES, 'preview-run-'))
  cpSync(join(FIXTURES, 'preview-app'), dir, { recursive: true })
  return dir
}

/** Removes a fixture copy. */
export function removeCopy(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}

/** Writes a file of a fixture copy. */
export function write(dir: string, file: string, text: string): void {
  writeFileSync(join(dir, file), text)
}

/** A running `partom preview` child with its printed URL lines. */
export class PreviewProcess {
  /** Child process. */
  readonly child: ChildProcess
  /** URL lines printed on stdout, in order. */
  readonly urls: string[] = []
  /** Collected stderr text. */
  stderr = ''
  /** Exit code once the child ended. */
  readonly exited: Promise<number>

  /** Starts the preview with the given command and arguments in a directory. */
  constructor(
    dir: string,
    args: readonly string[],
    command: readonly string[] = [BUN, CLI],
    env: Readonly<Record<string, string>> = {}
  ) {
    this.child = spawn(command[0] as string, [...command.slice(1), 'preview', ...args], {
      cwd: dir,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    this.exited = once(this.child, 'exit').then(([code]) => (code as number | null) ?? -1)
    createInterface({ input: this.child.stdout as NodeJS.ReadableStream }).on('line', (line) =>
      this.#line(line)
    )
    this.child.stderr?.on('data', (chunk: Buffer) => this.#err(chunk))
  }

  /** Waits for `count` URL lines, or for the child to exit; returns the exit code if it exited. */
  async ready(count = 1): Promise<number | undefined> {
    /** Deadline of the wait. */
    const deadline = Date.now() + 120000
    while (this.urls.length < count && Date.now() < deadline) {
      /** Exit code if the child ended meanwhile. */
      const code = await Promise.race([this.exited, sleep(100).then(() => undefined)])
      if (code !== undefined) return code
    }
    return undefined
  }

  /** Base URL. */
  get base(): string {
    return this.urls[0] ?? ''
  }

  /** Error code printed on stderr by a failed start. */
  errorCode(): string | undefined {
    /** Last stderr line. */
    const last = this.stderr.trim().split('\n').pop() ?? ''
    try {
      return (JSON.parse(last) as { error?: { code?: string } }).error?.code
    } catch {
      // Not JSON: the start did not fail with a coded error.
      return undefined
    }
  }

  /** Sends SIGINT and returns the exit code. */
  async stop(): Promise<number> {
    if (this.child.exitCode === null) this.child.kill('SIGINT')
    return await this.exited
  }

  /** Records one stdout line. */
  #line(line: string): void {
    try {
      /** Printed object. */
      const parsed = JSON.parse(line) as { url?: string }
      if (parsed.url !== undefined) this.urls.push(parsed.url)
    } catch {
      // Other stdout lines are not part of the contract.
    }
  }

  /** Records stderr text. */
  #err(chunk: Buffer): void {
    this.stderr += chunk.toString()
  }
}

/** One Server-Sent Event as received. */
export type IReceivedEvent = { readonly event: string; readonly data: Record<string, unknown> }

/** Subscribes to `/events` and records every event. */
export class EventRecorder {
  /** Received events. */
  readonly events: IReceivedEvent[] = []
  /** Abort switch of the stream. */
  readonly #abort = new AbortController()
  /** Partial frame text. */
  #buffer = ''

  /** Opens the stream. */
  async open(base: string): Promise<void> {
    /** Stream response. */
    const response = await fetch(`${base}events`, { signal: this.#abort.signal })
    void this.#read(response.body as ReadableStream<Uint8Array>)
  }

  /** Events of one name. */
  named(event: string): readonly IReceivedEvent[] {
    return this.events.filter((entry) => entry.event === event)
  }

  /** Closes the stream. */
  close(): void {
    this.#abort.abort()
  }

  /** Reads frames until the stream ends. */
  async #read(body: ReadableStream<Uint8Array>): Promise<void> {
    /** Text decoder. */
    const decoder = new TextDecoder()
    try {
      for await (const chunk of body) this.#parse(decoder.decode(chunk, { stream: true }))
    } catch {
      // Closing the stream ends the loop with an abort error.
    }
  }

  /** Splits complete frames out of the buffer. */
  #parse(text: string): void {
    this.#buffer += text
    /** Frames ended by a blank line. */
    const frames = this.#buffer.split('\n\n')
    this.#buffer = frames.pop() ?? ''
    for (const frame of frames) {
      /** Event name line. */
      const event = /^event: (.*)$/m.exec(frame)?.[1]
      /** Data line. */
      const data = /^data: (.*)$/m.exec(frame)?.[1]
      if (event !== undefined && data !== undefined)
        this.events.push({ event, data: JSON.parse(data) as Record<string, unknown> })
    }
  }
}

/** Resolves after a delay. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Waits until a condition holds or the timeout passes; returns whether it held. */
export async function until(condition: () => boolean, timeoutMs: number): Promise<boolean> {
  /** Deadline. */
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (condition()) return true
    await sleep(50)
  }
  return condition()
}

/** Launches the headless browser the CLI itself would use. */
export function launchBrowser(): Promise<Browser> {
  return chromium.launch({ executablePath: browserPath(undefined), headless: true })
}
