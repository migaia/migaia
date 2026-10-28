/** Original provider error atoms use real namespaces, physical replies and the public report port. */
import { createRpcHost, type IRpcContext } from '@migaia/rpc-host'
import { schemaFeature } from '@migaia/rpc-host/plugins/schema'
import { timeoutFeature } from '@migaia/rpc-host/features/timeout'
import { RpcError } from '@migaia/rpc-contract/errors'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { deserializeRpcWireError } from '@migaia/rpc-contract/protocol'
import { deferred } from '@migaia/utils/promise'
import { assert, expect, it } from 'vitest'
import { connectedCoreHosts, coreMemoryServer } from '../host/core-fixture.ts'

/** Preserve the original two delivery turns before inspecting reports or absent late terminals. */
async function settleProviderDelivery(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

/** The async row retains the original single business yield before rejecting its exact primary. */
async function rejectAfterYield(primary: Error): Promise<never> {
  await Promise.resolve()
  throw primary
}

/** The business method alone owns its original entry, late result and completion observations. */
class LateProviderResult {
  /** Actual provider entry is the prerequisite for closing its independently owned Host. */
  readonly entered = deferred<void>()
  /** Business completion remains observable after the original physical source has retired. */
  readonly finished = deferred<void>()
  /** Only the test's original application outcome resolves or rejects this business result. */
  readonly result = deferred<unknown>()

  /** Keep business pending through retirement without inventing a provider/controller owner. */
  readonly run = async (_value: unknown, context: IRpcContext) => {
    this.entered.resolve()
    try {
      return context.success(await this.result.promise)
    } finally {
      this.finished.resolve()
    }
  }
}

it.each(['sync', 'async'] as const)(
  '%s provider failure preserves raw reporting and the correlated INTERNAL code',
  async (mode) => {
    /** The original native exception must be the object delivered to the public diagnostic sink. */
    const primary = new Error(
      mode === 'sync' ? 'synchronous provider failure' : 'late provider rejection'
    )
    /** Only the provider Host contributes to this original one-error report expectation. */
    const reports: unknown[] = []
    /** Both variants enter the actual provider catalog rather than a raw private result callback. */
    const fixture = await connectedCoreHosts(
      {},
      {
        echo: () => {
          if (mode === 'sync') throw primary
          return rejectAfterYield(primary)
        }
      },
      () => undefined,
      undefined,
      (error) => reports.push(error)
    )
    try {
      /** Capture actual caller rejection so every original report precedes its response matcher. */
      const received: unknown = await fixture.a.memory.send('b', 'echo').catch((error) => error)
      await settleProviderDelivery()
      expect(reports).toEqual([primary])
      expect(primary.stack).toEqual(expect.any(String))
      /** Correlation is borrowed from the real outgoing call, never fabricated by the fixture. */
      const call = fixture.pair[0].written.find((frame) => frame.kind === 'call')
      assert(call?.kind === 'call')
      /** Changes response DTO spelling; the same actual error graph retains its public code. */
      const response = fixture.pair[1].written.find(
        (frame) => frame.kind === 'error' && frame.id === call.id
      )
      assert(response?.kind === 'error')
      expect(deserializeRpcWireError(response.error)).toMatchObject({
        code: RpcCoreErrorCode.internal
      })
      expect(received).toMatchObject({ code: RpcCoreErrorCode.internal })
    } finally {
      await fixture.close()
    }
  }
)

it.each(['sync', 'async'] as const)(
  '%s provider RpcError preserves the primary graph, native cause and exact report',
  async (mode) => {
    /** These are the original provider-owned primary and native cause before serialization. */
    const cause = new Error(`serialized ${mode} cause`)
    /** The canonical public error class is unchanged from the original business input. */
    const primary = new RpcError(RpcCoreErrorCode.internal, `serialized ${mode} primary`, cause)
    /** The public diagnostic channel observes the primary independently from its flat wire graph. */
    const reports: unknown[] = []
    /** Genuine namespace dispatch is the only execution and result owner. */
    const fixture = await connectedCoreHosts(
      {},
      {
        echo: () => {
          if (mode === 'sync') throw primary
          return rejectAfterYield(primary)
        }
      },
      () => undefined,
      undefined,
      (error) => reports.push(error)
    )
    try {
      await expect(fixture.a.memory.send('b', 'echo')).rejects.toMatchObject({
        name: 'RpcError',
        source: 'rpc.endpoint',
        code: RpcCoreErrorCode.internal,
        message: primary.message,
        stack: primary.stack,
        cause: expect.objectContaining({
          name: 'Error',
          message: cause.message,
          stack: cause.stack
        })
      })
      await settleProviderDelivery()
      expect(reports).toEqual([primary])
      /** The original physical terminal carries the same primary/cause graph across syntax. */
      const response = fixture.pair[1].written.find((frame) => frame.kind === 'error')
      assert(response?.kind === 'error')
      expect(deserializeRpcWireError(response.error)).toMatchObject({
        name: 'RpcError',
        source: 'rpc.endpoint',
        code: RpcCoreErrorCode.internal,
        message: primary.message,
        stack: primary.stack,
        cause: expect.objectContaining({
          name: 'Error',
          message: cause.message,
          stack: cause.stack
        })
      })
    } finally {
      await fixture.close()
    }
  }
)

it.each(['params', 'result'] as const)(
  '%s schema failure preserves the serialized native family and parser cause',
  async (side) => {
    /** The original parser failure remains reachable through the public schema error cause. */
    const parserCause = new Error(`${side} schema cause`)
    /** The params-rejection row retains the original zero-business-execution assertion. */
    let executions = 0
    /** The existing native listener supplies actual source/task/handshake admission. */
    const server = coreMemoryServer('provider-admission-fixture')
    /** Parser receivers are borrowed directly by the actual optional schema owner. */
    const parser = {
      parse: () => {
        throw parserCause
      }
    }
    /** The other side accepts the original value without replacing the configured parser. */
    const identity = { parse: (value: unknown) => value }
    /** Plugin-before-transport is a supported cold installation, with no private contract config. */
    const host = await createRpcHost({
      ...server.options,
      plugins: [
        schemaFeature({
          schemas: {
            echo: {
              params: side === 'params' ? parser : identity,
              result: side === 'result' ? parser : identity
            }
          }
        }),
        server.transport
      ],
      provide: {
        echo: (_value, context) => {
          executions += 1
          return context.success('schema-result')
        }
      }
    })
    /** A complete timeout instance bounds a missing physical reply without changing its matcher. */
    const client = await server.connect('r70-client')
    try {
      await expect(
        client.host.memory.send('provider-admission-fixture', 'echo', undefined, {
          timeout: timeoutFeature({ ms: 1000 })
        })
      ).rejects.toMatchObject({
        name: 'RpcSchemaValidationError',
        source: 'rpc.endpoint',
        code: RpcCoreErrorCode.schemaInvalid,
        stack: expect.any(String),
        cause: expect.objectContaining({
          name: 'Error',
          message: parserCause.message,
          stack: expect.any(String)
        })
      })
      if (side === 'params') expect(executions).toBe(0)
      /** Flat graphs preserve the original serialized schema error and parser-cause atoms. */
      const response = client.pair[0].written.find((frame) => frame.kind === 'error')
      assert(response?.kind === 'error')
      expect(deserializeRpcWireError(response.error)).toMatchObject({
        name: 'RpcSchemaValidationError',
        source: 'rpc.endpoint',
        code: RpcCoreErrorCode.schemaInvalid,
        stack: expect.any(String),
        cause: expect.objectContaining({
          name: 'Error',
          message: parserCause.message,
          stack: expect.any(String)
        })
      })
    } finally {
      await client.host.close()
      await host.close()
    }
  }
)

it.each(['shape', 'overflow'] as const)(
  'provider transfer %s preserves the native contract failure graph and report',
  async (kind) => {
    /** The old two invalid transfer inputs are unchanged application data at context.success. */
    const transfer =
      kind === 'shape'
        ? ('not-an-array' as unknown as readonly unknown[])
        : Array.from({ length: 65 }, () => ({}))
    /** The real provider report is compared to the actual serialized terminal's native fields. */
    const reports: unknown[] = []
    /** No raw unbranded result record bypasses the current public provider context. */
    const fixture = await connectedCoreHosts(
      {},
      { echo: (_value, context) => context.success('invalid-transfer', { transfer }) },
      () => undefined,
      undefined,
      (error) => reports.push(error)
    )
    try {
      /** Restores the remote contract error directly, without the old scalar wrapper. */
      const received: unknown = await fixture.a.memory.send('b', 'echo').catch((error) => error)
      await settleProviderDelivery()
      expect(reports).toHaveLength(1)
      expect(reports[0]).toMatchObject({
        name: 'RpcContractError',
        source: 'rpc.endpoint',
        code: RpcCoreErrorCode.contractInvalid,
        message: expect.any(String),
        stack: expect.any(String)
      })
      /** Match the real report's fields rather than deriving an error from a public code string. */
      const reportError = reports[0] as Error & { source: string; code: string }
      /** This is the genuine provider response, not a fixture-generated refusal. */
      const response = fixture.pair[1].written.find((frame) => frame.kind === 'error')
      assert(response?.kind === 'error')
      expect(deserializeRpcWireError(response.error)).toMatchObject({
        name: reportError.name,
        source: reportError.source,
        code: reportError.code,
        message: reportError.message,
        stack: reportError.stack
      })
      expect(received).toMatchObject({ code: RpcCoreErrorCode.contractInvalid })
    } finally {
      await fixture.close()
    }
  }
)

it.each(['resolve', 'reject', 'native-reject'] as const)(
  'post-terminal late %s preserves reports and sends no response',
  async (mode) => {
    /** The same original native cause is inspected independently from the report identity. */
    const cause = new Error('late native cause')
    /** Only the native-error row uses the exact original coded provider exception. */
    const primary =
      mode === 'native-reject'
        ? new RpcError(RpcCoreErrorCode.internal, 'late native primary', cause)
        : new Error('post-terminal late rejection')
    /** This explicit business owner cannot complete until the original late outcome is released. */
    const provider = new LateProviderResult()
    /** Reports come solely from the original provider's public Host, after physical retirement. */
    const reports: unknown[] = []
    /** The original carrier remains observable after its actual provider Host is closed. */
    const fixture = await connectedCoreHosts(
      {},
      { echo: provider.run },
      () => undefined,
      undefined,
      (error) => reports.push(error)
    )
    /** Observe the genuine caller rejection before the original remote physical source closes. */
    const pending = Promise.allSettled([fixture.a.memory.send('b', 'echo')])
    try {
      await provider.entered.promise
      /** The real call, rather than a guessed id, identifies all forbidden late physical terminals. */
      const call = fixture.pair[0].written.find((frame) => frame.kind === 'call')
      assert(call?.kind === 'call')
      /** Actual Root retirement precedes the original late business outcome. */
      const dispose = fixture.b.close()
      await dispose
      if (mode === 'resolve') provider.result.resolve('late-resolve')
      else provider.result.reject(primary)
      await provider.finished.promise
      await pending
      await settleProviderDelivery()
      if (mode !== 'resolve') expect(reports).toEqual([primary])
      if (mode === 'native-reject') expect(primary.cause).toBe(cause)
      expect(
        fixture.pair[1].written.filter(
          (frame) => (frame.kind === 'result' || frame.kind === 'error') && frame.id === call.id
        )
      ).toEqual([])
    } finally {
      provider.result.resolve('late-resolve')
      await pending
      await fixture.close()
    }
  }
)
