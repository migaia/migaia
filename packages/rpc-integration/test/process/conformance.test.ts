import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { inspect } from 'node:util'
import { serializeRpcError } from '@migaia/rpc-contract/errors'
import { closeSync, openSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, beforeAll } from 'vitest'
import { dialProcessByteChannel } from '../../../rpc-plugin-process/dist/process/adapters/node-socket.js'
import {
  peers,
  expected,
  businessVectors,
  evidence,
  client,
  business,
  wireFrames,
  installBusinessClient
} from './fixtures/conformance-business.js'

beforeAll(async () => {
  const { admitConformanceToolchains } = await import(
    new URL(
      '../../../rpc-plugin-process/test/process/fixtures/conformance-toolchains.mjs',
      import.meta.url
    ).href
  )
  const receipt = admitConformanceToolchains()
  writeFileSync(join(evidence, 'toolchains.json'), JSON.stringify(receipt, null, 2))
  if (!receipt.accepted) throw new Error(JSON.stringify(receipt))
})

describe('independent native business peers through public process facades', () => {
  for (const peer of peers)
    for (const host of businessVectors.hostProfiles as boolean[]) {
      it(`${peer.language} owned stdio Host=${host}`, async () => {
        const active = await client(peer, host, randomUUID())
        /** Freeze sent bytes when native exit is observed, excluding any later teardown writes. */
        const sentBeforeExit = active.handles[0]!.exited.then(() => Buffer.concat(active.sent))
        try {
          await business(active, peer.id)
          if (['python', 'go', 'rust'].includes(peer.language)) {
            /** Original bridge business metadata now uses the sole native task/options grammar. */
            const native = wireFrames(active.sent)
            const request = native.find(
              (frame) => frame.kind === 'call' && frame.task.method === 'p.f.request'
            )
            expect(request.id).toEqual(expect.any(String))
            expect(request.options.idempotencyKey).toBe('h-bridge-key')
            expect(request.options.remainingMs).toBeGreaterThan(0)
            expect(request.options.remainingMs).toBeLessThanOrEqual(1000)
            expect(
              native
                .filter((frame) => frame.kind === 'call' && frame.task.method === 'peer.trace')
                .map((frame) => frame.route.trace ?? null)
            ).toEqual(['h-trace-one', 'h-trace-two', null])
            expect(
              native.filter(
                (frame) =>
                  frame.kind === 'call' &&
                  frame.task.mode === 'notify' &&
                  frame.task.method === 'p.f.oneWay'
              )
            ).toHaveLength(expected.oneWay.inputs.length)
            const cancels = native.filter((frame) => frame.kind === 'cancel')
            expect(cancels).toHaveLength(1)
            expect(
              native.findIndex((frame) => frame.kind === 'call' && frame.id === cancels[0].id)
            ).toBeLessThan(native.indexOf(cancels[0]))
          }
        } finally {
          await active.close()
          for (const handle of active.handles) await handle.exited
          writeFileSync(
            join(evidence, `${peer.language}-stdio-${host}.stderr.log`),
            Buffer.concat(active.output)
          )
          writeFileSync(
            join(evidence, `${peer.language}-stdio-${host}.stdout.bin`),
            Buffer.concat(active.stdout)
          )
        }
        expect(active.handles).toHaveLength(1)
        const outcome = await active.handles[0]!.exited
        /** Retain the actual native exit before judging ownership; signals are never inferred. */
        writeFileSync(
          join(evidence, `${peer.language}-stdio-${host}.exit.json`),
          JSON.stringify(outcome)
        )
        expect(
          outcome.code === 0 || outcome.signal === 'SIGTERM' || outcome.signal === 'SIGKILL'
        ).toBe(true)
        if (outcome.signal !== null) {
          expect(
            wireFrames([await sentBeforeExit]).some(
              (frame) => frame.kind === 'control' && frame.operation === 'close'
            ),
            'close control must be sent before a native signal exit'
          ).toBe(true)
        }
        expect(Buffer.concat(active.output).toString()).toContain('READY')
        const frames = wireFrames(active.sent)
        const closeAt = frames.findIndex(
          (frame) => frame.kind === 'control' && frame.operation === 'close'
        )
        expect(closeAt).toBeGreaterThan(-1)
        expect(
          frames.filter((frame) => frame.kind === 'control' && frame.operation === 'close')
        ).toHaveLength(1)
        expect(frames.slice(closeAt + 1).filter((frame) => frame.kind === 'call')).toHaveLength(0)
        expect(wireFrames(active.stdout).filter((frame) => frame.kind === 'call')).toHaveLength(0)
        expect(active.reports).toMatchObject([
          {
            source: 'supervision',
            code: 'CAPABILITY_UNSUPPORTED',
            detail: { capability: 'termination', level: 'unsupported', kind: 'process' }
          }
        ])
      }, 15000)
      it(`${peer.language} borrowed Unix listener Host=${host}`, async () => {
        const directory = await mkdtemp(join(tmpdir(), 'rpc-h-'))
        const token = randomUUID()
        const authPath = join(directory, 'auth')
        writeFileSync(authPath, token, { mode: 0o600 })
        const fd = openSync(authPath, 'r')
        const child = spawn(
          peer.command,
          [
            ...peer.args,
            '--listen-unix',
            join(directory, 'peer.sock'),
            '--auth-fd',
            '3',
            ...(host ? ['--host'] : [])
          ],
          { stdio: ['ignore', 'pipe', 'pipe', fd] }
        )
        closeSync(fd)
        const exited = once(child, 'close')
        const output: Buffer[] = []
        child.stderr!.on('data', (chunk) => output.push(chunk))
        try {
          await new Promise<void>((resolve, reject) => {
            child.stderr!.on('data', (chunk) => {
              if (chunk.toString().includes('READY')) resolve()
            })
            child.once('error', reject)
            child.once('exit', () =>
              reject(
                new Error('business peer exited before ready: ' + Buffer.concat(output).toString())
              )
            )
          })
          /** Failed authentication must not affect a later valid session on this same listener. */
          const denied = await dialProcessByteChannel({ address: join(directory, 'peer.sock') })
          const deniedToken = randomUUID()
          const deniedFrames: Uint8Array[] = []
          denied.onData((chunk) => deniedFrames.push(chunk.slice()))
          const deniedReports: unknown[] = []
          let deniedError: unknown
          try {
            await expect(
              installBusinessClient(
                { reports: deniedReports },
                {
                  kind: 'connect',
                  address: join(directory, 'peer.sock'),
                  token: deniedToken,
                  dial: async () => denied
                }
              ).catch((error) => {
                deniedError = error
                throw error
              })
            ).rejects.toBeInstanceOf(Error)
          } finally {
            await denied.close()
          }
          const deniedSnapshot = inspect(
            {
              error: deniedError,
              reports: deniedReports,
              wire: wireFrames(deniedFrames),
              serialized: serializeRpcError(deniedError, { report: () => undefined })
            },
            { depth: null, showHidden: true }
          )
          for (let offset = 0; offset <= deniedToken.length - 6; offset++)
            expect(deniedSnapshot).not.toContain(deniedToken.slice(offset, offset + 6))
          for (let index = 0; index < 2; index++) {
            const active = await client(peer, host, token, join(directory, 'peer.sock'))
            try {
              if (index === 0) {
                await business(active, peer.id)
                expect(
                  wireFrames(active.sent)
                    .filter(
                      (frame) =>
                        frame.kind === 'call' && String(frame.task.method).startsWith('p.f.')
                    )
                    .every((frame) => frame.route.trace === undefined)
                ).toBe(true)
              } else
                expect(await active.namespace.request('p.f.request', ['still-alive'])).toBe(
                  'still-alive'
                )
            } finally {
              await active.close()
              writeFileSync(
                join(evidence, `${peer.language}-socket-${host}-${index}.frames.bin`),
                Buffer.concat(active.stdout)
              )
            }
            expect(
              wireFrames(active.sent).filter(
                (frame) => frame.kind === 'control' && frame.operation === 'close'
              )
            ).toHaveLength(1)
            expect(wireFrames(active.stdout).filter((frame) => frame.kind === 'call')).toHaveLength(
              0
            )
            expect(active.reports).toEqual([])
            expect(child.exitCode).toBeNull()
          }
        } finally {
          child.kill()
          await exited
          writeFileSync(
            join(evidence, `${peer.language}-socket-${host}.stderr.log`),
            Buffer.concat(output)
          )
          await rm(directory, { recursive: true, force: true })
        }
        expect(Buffer.concat(output).toString()).toContain('READY')
      }, 15000)
    }
})

describe('default native health stays idle without restarting', () => {
  for (const peer of peers)
    it.concurrent(`${peer.language} default 20s health`, async () => {
      const active = await client(peer, false, randomUUID())
      try {
        const pid = active.handles[0]!.identity
        await new Promise((resolve) => setTimeout(resolve, 20000))
        expect(active.handles).toHaveLength(1)
        expect(active.handles[0]!.identity).toBe(pid)
        const frames = wireFrames(active.stdout)
        expect(
          frames.filter((frame) => frame.kind === 'control' && frame.operation === 'pong').length
        ).toBeGreaterThanOrEqual(3)
        expect(await active.namespace.request('p.f.request', ['after-idle'])).toBe('after-idle')
      } finally {
        await active.close()
        for (const handle of active.handles) await handle.exited
      }
    }, 25000)
})
