import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'

/** Noncanonical JSON distinguishes a parsed/serialized echo from a raw byte echo. */
const inputText = ' [ 1, "baseline", null ] '
/** Canonical payload proves the bare peer did real JSON work while preserving its value. */
const outputText = '[1,"baseline",null]'
/** All foreign peers share the published fixture directory and bridge framing. */
const peerRoot = new URL('./peers/', import.meta.url)

/** Run one isolated EOF-terminated echo; startup and failure diagnostics never contain secrets. */
async function echoed(command: string, args: string[], contentLength: boolean): Promise<Buffer> {
  /** A dedicated descriptor satisfies the same bootstrap used by paired RPC peers. */
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe', 'pipe'] })
  /** Physical bytes are retained only for this one nonsecret fixture. */
  const chunks: Buffer[] = []
  /** Process diagnostics explain a failed fixture without losing its exit code. */
  let diagnostics = ''
  child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
  child.stderr.on('data', (chunk: Buffer) => {
    diagnostics += chunk.toString()
  })
  /** Listener registration precedes input so early failures cannot escape the assertion. */
  const exited = new Promise<void>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code) => {
      try {
        assert.equal(code, 0, diagnostics)
        resolve()
      } catch (error) {
        reject(error)
      }
    })
  })
  /** Authentication is local fixture data and never part of the echoed business payload. */
  const authentication = child.stdio[3] as Writable
  authentication.end('baseline-local')
  /** The native and bridge fixtures differ only in their physical length prefix. */
  const body = Buffer.from(inputText)
  /** Allocate the complete tiny fixture once before passing it to the isolated peer. */
  const frame = contentLength
    ? Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body])
    : Buffer.alloc(body.length + 4)
  if (!contentLength) {
    frame.writeUInt32BE(body.length)
    frame.set(body, 4)
  }
  child.stdin.end(frame)
  try {
    await exited
    return Buffer.concat(chunks)
  } finally {
    if (child.exitCode === null) child.kill()
  }
}

describe('[A10] release peer and JSON bare baseline', () => {
  for (const language of ['python', 'rust', 'go']) {
    it(`${language} parses and serializes a bare JSON payload once before physical reply`, async () => {
      /** Launch wrappers select fixed optimized binaries before the measured request. */
      const command = language === 'python' ? 'python3' : 'sh'
      /** No business envelope is present, so RPC dispatch cannot satisfy this discriminator. */
      const args =
        language === 'python'
          ? ['-B', fileURLToPath(new URL('python/peer.py', peerRoot)), '--business']
          : [fileURLToPath(new URL(`${language}/run.sh`, peerRoot)), '--business']
      args.push('--stdio', '--jsonrpc', '--bare-jsonrpc', '--auth-fd', '3')
      /** Returned bytes must reflect JSON serialization, not unchanged input whitespace. */
      const actual = await echoed(command, args, true)
      expect(actual.toString()).toBe(
        `Content-Length: ${Buffer.byteLength(outputText)}\r\n\r\n${outputText}`
      )
    }, 30_000)
  }

  for (const runtime of [process.execPath, 'bun']) {
    it(`${runtime} parses and serializes native bare JSON before physical reply`, async () => {
      /** Both JS runtimes execute emitted JavaScript rather than a TypeScript source loader. */
      const actual = await echoed(
        runtime,
        [fileURLToPath(new URL('../../bench/bare-node.mjs', import.meta.url)), '--echo'],
        false
      )
      expect(actual.readUInt32BE(0)).toBe(Buffer.byteLength(outputText))
      expect(actual.subarray(4).toString()).toBe(outputText)
    })
  }
})
