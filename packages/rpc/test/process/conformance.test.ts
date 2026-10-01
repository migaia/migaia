import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { inspect } from 'node:util'
import { serializeRpcError } from '@migaia/rpc/contract'
import { closeSync, openSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, beforeAll } from 'vitest'
import { dialProcessByteChannel } from '@migaia/rpc/process/adapters/node-socket'
import { createProcessTransport } from '@migaia/rpc/process'
import { createJsonRpcRemoteChannel } from '@migaia/rpc/bridge/jsonrpc'
import { systemScheduler } from '@migaia/utils/scheduler'
import {
  peers,
  expected,
  businessVectors,
  evidence,
  bridgeContract,
  offer,
  client,
  business,
  wireFrames,
  bridgeFrames
} from './fixtures/conformance-business.js'

beforeAll(async () => {
  const { admitConformanceToolchains } = await import(
    new URL('./fixtures/conformance-toolchains.mjs', import.meta.url).href
  )
  const receipt = admitConformanceToolchains()
  writeFileSync(join(evidence, 'toolchains.json'), JSON.stringify(receipt, null, 2))
  if (!receipt.accepted) throw new Error(JSON.stringify(receipt))
})

describe('[A3] independent JSON-RPC business through public process facades', () => {
  for (const peer of peers.slice(0, 3))
    for (const host of [false, true]) {
      it(`${peer.language} JSON-RPC owned stdio Host=${host}`, async () => {
        const active = await client(peer, host, randomUUID(), undefined, true)
        try {
          await business(active, peer.id, true)
        } finally {
          await active.close()
          for (const handle of active.handles) await handle.exited
          writeFileSync(
            join(evidence, `${peer.language}-jsonrpc-stdio-${host}.stderr.log`),
            Buffer.concat(active.output)
          )
          writeFileSync(
            join(evidence, `${peer.language}-jsonrpc-stdio-${host}.frames.bin`),
            Buffer.concat(active.stdout)
          )
        }
        const frames = bridgeFrames(active.sent)
        expect(Buffer.concat(active.sent)[0]).toBe(67)
        expect(frames[0].method).toBe('migaia.hello')
        expect(frames.some((frame) => frame.method === 'migaia.describe')).toBe(true)
        const request = frames.find(
          (frame) => frame.method === 'migaia.invoke' && frame.params.method === 'p.f.request'
        )
        expect(request.id).toEqual(expect.any(String))
        expect(request.params.meta.idempotencyKey).toBe('h-bridge-key')
        expect(request.params.meta.timeoutMs).toBeGreaterThan(0)
        expect(request.params.meta.timeoutMs).toBeLessThanOrEqual(1000)
        expect(
          frames
            .filter(
              (frame) => frame.method === 'migaia.invoke' && frame.params.method === 'peer.trace'
            )
            .map((frame) => frame.params.meta?.trace ?? null)
        ).toEqual(['h-trace-one', 'h-trace-two', null])
        const notifications = frames.filter(
          (frame) => frame.method === 'migaia.invoke' && frame.params.method === 'p.f.oneWay'
        )
        expect(notifications).toHaveLength(expected.oneWay.inputs.length)
        expect(
          notifications.every((frame) => frame.id === undefined && frame.params.meta === undefined)
        ).toBe(true)
        const cancels = frames.filter((frame) => frame.method === 'migaia.cancel')
        expect(cancels).toHaveLength(1)
        expect(cancels[0]).not.toHaveProperty('id')
        expect(frames.findIndex((frame) => frame.id === cancels[0].params.id)).toBeLessThan(
          frames.indexOf(cancels[0])
        )
        expect(frames.every((frame) => frame.jsonrpc === '2.0' && frame.kind === undefined)).toBe(
          true
        )
        expect(active.handles).toHaveLength(1)
      }, 15000)
      it(`${peer.language} JSON-RPC borrowed Unix Host=${host}`, async () => {
        const directory = await mkdtemp(join(tmpdir(), 'rpc-h-bridge-'))
        const token = randomUUID()
        const authPath = join(directory, 'auth')
        writeFileSync(authPath, token, { mode: 0o600 })
        const fd = openSync(authPath, 'r')
        const address = join(directory, 'peer.sock')
        const child = spawn(
          peer.command,
          [
            ...peer.args,
            '--jsonrpc',
            '--listen-unix',
            address,
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
                new Error('bridge peer exited before ready: ' + Buffer.concat(output).toString())
              )
            )
          })
          /** A denied JSON-RPC hello preserves fixed errors and cannot poison the next session. */
          const deniedToken = randomUUID()
          const denied = await dialProcessByteChannel({ address })
          const deniedFrames: Uint8Array[] = []
          denied.onData((chunk) => deniedFrames.push(chunk.slice()))
          const deniedReports: unknown[] = []
          let deniedError: unknown
          try {
            await expect(
              createJsonRpcRemoteChannel({
                byte: denied,
                peerId: peer.id,
                target: host
                  ? { kind: 'host', catalog: { p: bridgeContract } }
                  : { kind: 'plugin', contract: bridgeContract },
                offer: {
                  versions: [{ major: 1, minor: 1 }],
                  capabilities: [],
                  peer: { id: 'caller', runtime: 'node' }
                },
                token: deniedToken,
                scheduler: systemScheduler,
                wallClock: { timestamp: () => Date.now() },
                ipc: {
                  connectionId: 'denied-bridge',
                  sessionId: 'denied-bridge',
                  log: () => undefined
                },
                report: (error) => deniedReports.push(error)
              }).catch((error) => {
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
              wire: bridgeFrames(deniedFrames),
              serialized: serializeRpcError(deniedError, { report: () => undefined })
            },
            { depth: null, showHidden: true }
          )
          for (let offset = 0; offset <= deniedToken.length - 6; offset++)
            expect(deniedSnapshot).not.toContain(deniedToken.slice(offset, offset + 6))
          for (let index = 0; index < 2; index++) {
            const active = await client(peer, host, token, address, true)
            try {
              if (index === 0) await business(active, peer.id, true)
              else expect(await active.feature.request(['still-alive'])).toBe('still-alive')
            } finally {
              await active.close()
              writeFileSync(
                join(evidence, `${peer.language}-jsonrpc-socket-${host}-${index}.frames.bin`),
                Buffer.concat(active.stdout)
              )
            }
            expect(child.exitCode).toBeNull()
            expect(active.reports).toHaveLength(index === 0 ? 1 : 0)
            expect(
              bridgeFrames(active.sent).every(
                (frame) => frame.jsonrpc === '2.0' && frame.kind === undefined
              )
            ).toBe(true)
          }
        } finally {
          child.kill()
          await exited
          writeFileSync(
            join(evidence, `${peer.language}-jsonrpc-socket-${host}.stderr.log`),
            Buffer.concat(output)
          )
          await rm(directory, { recursive: true, force: true })
        }
      }, 15000)
    }
})

describe('[A1] independent native business peers through public process facades', () => {
  for (const peer of peers)
    for (const host of businessVectors.hostProfiles as boolean[]) {
      it(`${peer.language} owned stdio Host=${host}`, async () => {
        const active = await client(peer, host, randomUUID())
        try {
          await business(active, peer.id)
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
        expect(outcome.code === 0 || outcome.signal === 'SIGKILL').toBe(true)
        expect(Buffer.concat(active.output).toString()).toContain('READY')
        const frames = wireFrames(active.sent)
        const closeAt = frames.findIndex(
          (frame) => frame.kind === 'variation' && frame.data.route.variation === 'close'
        )
        expect(closeAt).toBeGreaterThan(-1)
        expect(
          frames.filter(
            (frame) => frame.kind === 'variation' && frame.data.route.variation === 'close'
          )
        ).toHaveLength(1)
        expect(frames.slice(closeAt + 1).filter((frame) => frame.kind === 'request')).toHaveLength(
          0
        )
        expect(active.reports).toMatchObject([
          {
            source: '@migaia/supervision',
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
              createProcessTransport(denied, {
                role: 'initiator',
                peerId: peer.id,
                offer: { ...offer, auth: deniedToken },
                report: (error) => deniedReports.push(error),
                ipc: { connectionId: 'denied', sessionId: 'denied', log: () => undefined }
              }).catch((error) => {
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
                      (frame) => frame.kind === 'request' && String(frame.method).startsWith('p.f.')
                    )
                    .every((frame) => frame.data.route.trace === undefined)
                ).toBe(true)
              } else expect(await active.feature.request(['still-alive'])).toBe('still-alive')
            } finally {
              await active.close()
              writeFileSync(
                join(evidence, `${peer.language}-socket-${host}-${index}.frames.bin`),
                Buffer.concat(active.stdout)
              )
            }
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

describe('[A1] default native health stays idle without restarting', () => {
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
          frames.filter(
            (frame) => frame.kind === 'variation' && frame.data.route.variation === 'pong'
          ).length
        ).toBeGreaterThanOrEqual(3)
        expect(await active.feature.request(['after-idle'])).toBe('after-idle')
      } finally {
        await active.close()
        for (const handle of active.handles) await handle.exited
      }
    }, 25000)
})
