import { nativeFixture, nativeWorkerFor, nativeErrorListenerCount } from './fixture.js'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { LifecycleErrorCode, LifecycleErrorText } from '@migaia/lifecycle'
import {
  serializeErrorChain,
  UtilsAbortError,
  UtilsErrorCode,
  walkErrorCauses
} from '@migaia/utils/error'
import { createNodeThreadLauncher } from '../../src/threads/adapters/node.js'

/** Native exit fixture has no RPC protocol or Vitest runtime in the Worker. */
const entry = fileURLToPath(new URL('./fixtures/lifecycle-worker.mjs', import.meta.url))

describe('Node thread launcher', () => {
  it('source domains preserves a real worker provider error chain', async () => {
    /** The existing runtime fixture owns the real Worker, RPC provider and Host lifetime. */
    const fixture = nativeFixture({}, { sourceDomainFailure: true })
    try {
      /** Public request rejects only after the Worker-side provider throws its package error. */
      const feature = await fixture.install()
      /** Observe the received rejection while permitting the assertion to distinguish success. */
      const received = await feature.read(['source-domain']).then(
        () => undefined,
        (error: unknown) => error
      )
      expect(received).toBeInstanceOf(Error)
      /** Locate the original error by native family and code, outside any local RPC wrapper. */
      const remoteFailure = walkErrorCauses(received).find(
        (error) =>
          error !== null &&
          typeof error === 'object' &&
          Reflect.get(error, 'name') === 'AbortError' &&
          Reflect.get(error, 'code') === UtilsErrorCode.aborted
      )
      expect.soft(remoteFailure, 'SOURCE_DOMAIN_REMOTE_SOURCE_CHAIN').toMatchObject({
        source: 'foundation.utils',
        code: UtilsErrorCode.aborted,
        name: 'AbortError',
        message: new UtilsAbortError().message,
        cause: {
          source: 'lifecycle',
          code: LifecycleErrorCode.scopeTerminal,
          message: LifecycleErrorText.scopeTerminal
        }
      })
      /** Serialize the complete received graph, including wrappers and every preserved cause. */
      const serialized = serializeErrorChain(received)
      expect
        .soft(JSON.stringify(serialized), 'SOURCE_DOMAIN_SERIALIZED_CHAIN')
        .not.toContain('@migaia/')
    } finally {
      await fixture.close()
      await Promise.all(fixture.handles.map((handle) => handle.exited))
    }
  })
  it('classifies native Worker option rejection and retains the native diagnostic on cause', async () => {
    /** A rejected native runtime flag fails construction before any Worker can be acquired. */
    const launching = createNodeThreadLauncher({ execArgv: ['--eval'] }).launch(
      { entry },
      { signal: new AbortController().signal }
    )
    await expect(launching).rejects.toBeInstanceOf(Error)
    await expect(launching).rejects.toMatchObject({
      source: 'rpc.endpoint',
      code: 'INVALID_CONFIG',
      cause: {
        code: 'ERR_WORKER_INVALID_EXEC_ARGV',
        name: 'Error',
        message: expect.stringContaining('invalid execArgv'),
        stack: expect.any(String)
      }
    })
    await expect(launching).rejects.toHaveProperty('cause', expect.any(Error))
  })
  it('captures threadId once and resolves only after native exit', async () => {
    const launcher = createNodeThreadLauncher()
    const handle = await launcher.launch({ entry }, { signal: new AbortController().signal })
    /** Observe the actual native Worker beneath the production messaging shim. */
    const worker = nativeWorkerFor(handle)
    expect(nativeErrorListenerCount(handle)).toBe(1)
    expect(worker.listenerCount('error')).toBe(1)
    /** Native method spies prove arguments and lifecycle calls after shim adaptation. */
    const postMessage = vi.spyOn(worker, 'postMessage')
    const terminate = vi.spyOn(worker, 'terminate')
    handle.port.postMessage({ fixture: 'portable probe' }, undefined)
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({ fixture: 'portable probe' }, undefined)
    await new Promise((resolve) => {
      const receive = (message: unknown): void => {
        handle.port.off('message', receive)
        resolve(message)
      }
      handle.port.on('message', receive)
    })
    const id = handle.identity.threadId
    let exited = false
    void handle.exited.then(() => {
      exited = true
    })
    handle.terminate()
    handle.terminate()
    expect(terminate).toHaveBeenCalledTimes(1)
    expect(exited).toBe(false)
    await handle.exited
    expect(nativeWorkerFor(handle).threadId).toBe(-1)
    expect(handle.identity.threadId).toBe(id)
    expect(id).toBeGreaterThan(0)
    expect(nativeWorkerFor(handle).listenerCount('error')).toBe(0)
    postMessage.mockRestore()
    terminate.mockRestore()
  })
  it.each(['natural', 'error'] as const)(
    'keeps host alive on %s exit and retains original failure',
    async (mode) => {
      const handle = await createNodeThreadLauncher().launch(
        { entry, data: { mode } },
        { signal: new AbortController().signal }
      )
      const status = await handle.exited
      if (mode === 'error')
        expect(status.error).toMatchObject({
          message: 'thread original failure',
          stack: expect.any(String)
        })
      else expect(status).toEqual({ code: 0 })
    }
  )
  it('forwards heap limit and classifies actual Worker OOM after exit', async () => {
    const handle = await createNodeThreadLauncher().launch(
      { entry, data: { mode: 'heap' }, limits: { heapBytes: 8 * 1024 * 1024 } },
      { signal: new AbortController().signal }
    )
    expect(await handle.exited).toMatchObject({
      code: 1,
      limit: 'heapBytes',
      error: { code: 'ERR_WORKER_OUT_OF_MEMORY' }
    })
  })
  it('rejects relative entry and pre-aborted launch before constructing a Worker', async () => {
    const launcher = createNodeThreadLauncher()
    await expect(
      launcher.launch({ entry: './worker.mjs' }, { signal: new AbortController().signal })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG', detail: { field: 'spec.entry' } })
    const controller = new AbortController()
    const reason = new Error('launch cancelled')
    controller.abort(reason)
    await expect(launcher.launch({ entry }, { signal: controller.signal })).rejects.toBe(reason)
  })
  it('conveys unique launcher addresses while retaining the original portable data', async () => {
    const launcher = createNodeThreadLauncher()
    const launched = await Promise.all(
      [1, 2].map(async (value) => {
        const handle = await launcher.launch(
          { entry, data: { mode: 'echo', value } },
          { signal: new AbortController().signal }
        )
        /** Listener attaches in the launch continuation, before any Worker macrotask message. */
        const message = new Promise<unknown>((resolve) => {
          const receive = (value: unknown): void => {
            handle.port.off('message', receive)
            resolve(value)
          }
          handle.port.on('message', receive)
        })
        return { handle, message }
      })
    )
    const handles = launched.map(({ handle }) => handle)
    try {
      expect(handles[0]!.identity.fingerprint).not.toBe(handles[1]!.identity.fingerprint)
      for (const [index, handle] of handles.entries()) {
        const bootstrap = await launched[index]!.message
        expect(bootstrap).toEqual({
          peerId: handle.identity.fingerprint,
          data: { mode: 'echo', value: index + 1 }
        })
      }
    } finally {
      for (const handle of handles) handle.terminate()
      await Promise.all(handles.map((handle) => handle.exited))
    }
  })
})
