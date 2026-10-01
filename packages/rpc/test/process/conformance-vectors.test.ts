import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { evidence, peers } from './fixtures/conformance-business.js'
import { randomUUID } from 'node:crypto'
import { createProcessTransport, createNativeProcessOffer } from '@migaia/rpc/process'
import { createNodeProcessLauncher } from '@migaia/rpc/process/adapters/node-child-process'
import { endpointFor } from './peers/ts/runtime.js'

/** These published vector groups are the precise R2 independent-evaluation scope. */
const vectorFiles = [
  'frozen/1.0/handshake.json',
  'frozen/1.0/control.json',
  'frozen/1.0/envelope.json',
  'handshake.json',
  'control.json',
  'envelope.json',
  'stream.json',
  'error-chain.json',
  'remote-contract.json',
  'remote-host-control.json',
  'stream-framing.json'
]
/** Every applicable case ID must appear in a real independent selftest receipt. */
const requiredIds = [
  ...new Set(
    vectorFiles.flatMap((file) => {
      const vector = JSON.parse(
        readFileSync(new URL(`../../schema/vectors/${file}`, import.meta.url), 'utf8')
      )
      return Object.values(vector).flatMap((section) =>
        Array.isArray(section)
          ? section
              .filter((value) => value && typeof value === 'object' && typeof value.id === 'string')
              .map((value) => value.id as string)
          : []
      )
    })
  )
]

beforeAll(async () => {
  const { admitConformanceToolchains } = await import(
    new URL('./fixtures/conformance-toolchains.mjs', import.meta.url).href
  )
  const receipt = admitConformanceToolchains()
  writeFileSync(join(evidence, 'vectors-toolchains.json'), JSON.stringify(receipt, null, 2))
  if (!receipt.accepted) throw new Error(JSON.stringify(receipt))
})

describe('[A2] published vectors evaluated by independent language owners', () => {
  for (const peer of peers.slice(0, 4))
    it(`${peer.language} missing negotiated stream capability rejects before its first physical write`, async () => {
      /** The public proposal deliberately omits stream while preserving native mandatory controls. */
      const token = randomUUID()
      const handle = await createNodeProcessLauncher().launch(
        {
          command: peer.command,
          args: [...peer.args, '--stdio', '--bootstrap', 'stdin'],
          env: { inherit: ['PATH'], set: {} },
          stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
          bootstrap: { via: 'stdin', payload: new TextEncoder().encode(token) }
        },
        { signal: new AbortController().signal, output: () => undefined }
      )
      const byte = handle.channel!
      const write = byte.write
      let writes = 0
      Object.assign(byte, {
        write: async (chunk: Uint8Array) => {
          writes++
          await write(chunk)
        }
      })
      const channel = await createProcessTransport(byte, {
        role: 'initiator',
        peerId: peer.id,
        offer: {
          ...createNativeProcessOffer({
            peer: { id: 'caller', runtime: 'node' },
            stream: false,
            capabilities: ['abort@1', 'wire-error@1']
          }),
          auth: token
        },
        report: () => undefined,
        ipc: { connectionId: 'missing-stream', sessionId: 'missing-stream', log: () => undefined }
      })
      const runtime = await endpointFor(channel, 'caller')
      try {
        expect(channel.agreement.capabilities).not.toContain('stream@1')
        const before = writes
        await expect(
          runtime.stream!.open(peer.id, 'p.f.generator', ['no-stream']).next()
        ).rejects.toMatchObject({ source: '@migaia/rpc/core', code: 'CAPABILITY_CONFLICT' })
        expect(writes).toBe(before)
      } finally {
        await runtime.endpoint.dispose()
        await channel.close()
        handle.terminate('force')
        await handle.exited
      }
    }, 15000)
  for (const peer of peers.slice(0, 3))
    it(`${peer.language} executes each applicable case oracle and retains its raw receipt`, () => {
      /** Selftests own acceptance, first pointer, error graph, warning order and wire-byte oracles. */
      const args = peer.language === 'python' ? peer.args.slice(0, 2) : peer.args.slice(0, 1)
      const output = execFileSync(
        peer.command,
        [
          ...args,
          '--selftest',
          '--vectors',
          new URL('../../schema/vectors', import.meta.url).pathname
        ],
        {
          encoding: 'utf8',
          env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
          timeout: 30000
        }
      )
      writeFileSync(join(evidence, `vectors-${peer.language}.log`), output)
      expect(output).not.toMatch(/^FAIL /m)
      expect(output).toMatch(/failed=0/)
      const rows = output.split('\n')
      expect(
        rows.filter((line) => line.startsWith('PASS ') && line.endsWith('/warnings/sequence'))
      ).toHaveLength(2)
      for (const id of requiredIds)
        expect(
          rows.some(
            (line) =>
              (line.startsWith('PASS ') || (id === 'absent' && line.startsWith('SKIP '))) &&
              (line.endsWith('/' + id) ||
                line.includes('/' + id + '/') ||
                (id === 'absent' && line.includes('/absent:')))
          ),
          `${peer.language} missing applicable vector ${id}`
        ).toBe(true)
      /** Only the explicitly identified non-value thrown case may be skipped. */
      for (const row of rows.filter((line) => line.startsWith('SKIP ')))
        expect(row).toContain('absent')
    }, 30000)
  it('TS reference executes the existing public vector owners', () => {
    /**
     * Public TS tests consume canonical package factories rather than another protocol
     * implementation.
     */
    const output = execFileSync(
      'sh',
      [new URL('./peers/ts/selftest.sh', import.meta.url).pathname],
      { encoding: 'utf8', timeout: 30000 }
    )
    writeFileSync(join(evidence, 'vectors-typescript.log'), output)
    expect(output).toMatch(/Test Files\s+5 passed/)
    expect(output).not.toMatch(/Tests\s+\d+ failed/)
  }, 30000)
})
