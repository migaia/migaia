/** Real batch ingress preserves each replay refusal and its original physical write failure. */
import { createRpcHost } from '@migaia/rpc-host'
import { authFeature } from '@migaia/rpc-host/plugins/auth'
import { batchFeature } from '@migaia/rpc-host/plugins/batch'
import { RpcJsonCarrierCodec } from '@migaia/rpc-host/sdk'
import { IpcSendClass, type IRpcCarrierFrame } from '@migaia/rpc-contract/interfaces'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { RpcWireKind, type IRpcSemanticFrame } from '@migaia/rpc-contract/protocol'
import { assert, expect, it, vi } from 'vitest'
import { RpcBatchExtension } from '../../dist/features/batch/constants.js'
import { coreMemoryServer } from '../host/core-fixture.ts'

it('reports each native batch replay refusal and its exact physical write failure independently', async () => {
  /** Explicit numeric retention keeps the completed seed in the configured replay capacity. */
  let calls = 0
  /** Only the receiving public Host's original diagnostic outlet contributes to this oracle. */
  const failures: unknown[] = []
  /** Credentials-only Auth retains replay policy without a second signed-payload representation. */
  const authentication = authFeature({
    credentials: 'batch-custody-credential',
    verifyCredentials: (value) => {
      expect(value).toBe('batch-custody-credential')
    },
    retain: 310_000,
    maxReplayEntriesPerPeer: 1
  })
  /** Both original physical endpoints use the actual once-only JSON codec and batch extension. */
  const server = coreMemoryServer(
    'batch-custody-server',
    'batch-custody-server',
    'memory',
    [],
    [],
    {
      create: () => new RpcJsonCarrierCodec(),
      nativeBinary: false
    }
  )
  /** Native installation owns the sole Auth ledger, Batch owner and actual provider. */
  const host = await createRpcHost({
    ...server.options,
    plugins: [authentication, batchFeature(), server.transport],
    report: (error) => failures.push(error),
    provide: {
      echo: (value: string) => {
        calls += 1
        return value
      }
    }
  })
  /** The client allocates every real task and retains both original caller operations. */
  const client = await server.connect('batch-custody-client', {
    plugins: [authentication, batchFeature()]
  })
  /** Both refused response writes must preserve this identical original native failure. */
  const cause = new Error('fixture refusal write failure')
  /** Real carrier facts distinguish business responses from native handshake/directory control. */
  const output = {
    send: client.pair[0].write,
    fail: false,
    writes: [] as IRpcCarrierFrame[]
  }
  /** The unchanged physical implementation owns delivery until this exact refusal is enabled. */
  const writing = vi.spyOn(client.pair[0], 'write').mockImplementation((frame, options) => {
    if (options?.sendClass === IpcSendClass.data) {
      output.writes.push(frame)
      if (output.fail) return Promise.reject(cause)
    }
    return output.send(frame, options)
  })
  /** Default spies borrow original admitted messages and original output identities without parsing. */
  const responses = vi.spyOn(client.pair[0].codec, 'encode')
  /** Each original public call is encoded once by its own Session before the physical capture. */
  const requests = vi.spyOn(client.pair[1].codec, 'encode')
  /** This finite two-frame stimulus retains opaque original codec outputs, not an admission queue. */
  const members: IRpcCarrierFrame[] = []
  /** Physical capture temporarily withholds only the two new data calls from separate delivery. */
  const input = { send: client.pair[1].write, capture: false }
  /** Control traffic keeps its original delivery and lifecycle throughout the same connection. */
  const sending = vi.spyOn(client.pair[1], 'write').mockImplementation((frame, options) => {
    if (input.capture && options?.sendClass === IpcSendClass.data) {
      members.push(frame)
      return Promise.resolve()
    }
    return input.send(frame, options)
  })
  /** Rejection handlers attach immediately; final Host close settles these undeliverable replies. */
  const pending: Promise<unknown>[] = []
  try {
    await expect(client.host.memory.send('batch-custody-server', 'echo', 'seed')).resolves.toBe(
      'seed'
    )
    await vi.waitFor(() => expect(output.writes).toHaveLength(1))
    expect(calls).toBe(1)
    output.fail = true
    input.capture = true
    requests.mockClear()
    pending.push(
      client.host.memory.send('batch-custody-server', 'echo', 'one').catch((error) => error),
      client.host.memory.send('batch-custody-server', 'echo', 'two').catch((error) => error)
    )
    await vi.waitFor(() => expect(members).toHaveLength(2))
    input.capture = false
    /** Real original task inputs identify the same once-encoded physical members. */
    const callsInBatch = requests.mock.calls.map(([prepared]) => {
      /** Ordinary string calls have no binary manifest or authentication transform wrapper. */
      const message = prepared.message as IRpcSemanticFrame
      assert(message.kind === RpcWireKind.call)
      return message
    })
    expect(callsInBatch).toHaveLength(2)
    expect(members).toEqual(requests.mock.results.map((result) => result.value))
    /** No second decoder/restore/encoder touches the original opaque strings before real ingress. */
    await input.send({
      kind: 'extension',
      extension: RpcBatchExtension,
      data: { frames: members }
    })
    await vi.waitFor(() =>
      expect(
        failures.filter((error) => (error as { code?: string }).code === RpcCoreErrorCode.transport)
      ).toHaveLength(2)
    )
    expect(calls).toBe(1)
    expect(output.writes).toHaveLength(3)
    /** Changes only response DTO spelling; both original task correlations keep OVERLOADED. */
    const refused = responses.mock.calls
      .map(([prepared]) => prepared.message as IRpcSemanticFrame)
      .filter((message) => message.kind === RpcWireKind.error)
    expect(refused.map((message) => message.id)).toEqual(callsInBatch.map((message) => message.id))
    expect(refused.map((message) => message.error.nodes[message.error.root]?.code)).toEqual([
      RpcCoreErrorCode.overloaded,
      RpcCoreErrorCode.overloaded
    ])
    /** Each member reports its own dispatch refusal as well as its failed physical terminal. */
    await vi.waitFor(() => expect(failures).toHaveLength(4))
    expect(
      failures.filter((error) => (error as { code?: string }).code === RpcCoreErrorCode.overloaded)
    ).toHaveLength(2)
    for (const error of failures.filter(
      (error) => (error as { code?: string }).code === RpcCoreErrorCode.transport
    )) {
      expect(error).toMatchObject({ code: RpcCoreErrorCode.transport, cause })
      expect((error as Error).cause).toBe(cause)
    }
  } finally {
    sending.mockRestore()
    writing.mockRestore()
    requests.mockRestore()
    responses.mockRestore()
    await Promise.all([client.host.close(), host.close()])
    await Promise.all(pending)
  }
})
