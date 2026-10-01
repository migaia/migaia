import { describe, expect, it, vi } from 'vitest'
import { matrixFixture, matrixDependency, type IMatrixFeature } from './matrix-fixture.js'

describe('I15 real native generation departure', () => {
  it.concurrent.each([false, true])(
    '[A5] real %s departure rejects inflight request and stream; proxy resumes only after describe',
    async (borrowed) => {
      const test = await matrixFixture({ borrowed, gated: true })
      const dependent = matrixDependency(test)
      try {
        const [installed, dependentHandle] = await test.host.use(test.plugin, dependent.definition)
        const proxy = installed.getFeature('f') as IMatrixFeature
        expect(await dependent.immediate).toBe('child:ready')
        const request = proxy.request(['pending']).catch((error: unknown) => error)
        const stream = proxy.generator(['departed'])
        expect(await stream.next()).toEqual({ done: false, value: 'departed:1' })
        expect(await stream.next()).toEqual({ done: false, value: 'departed:2' })
        const next = stream.next().catch((error: unknown) => error)
        await vi.waitFor(() => expect(test.chunks.join('')).toContain('matrix:request-entered'))
        await test.closeGate('describe')
        if (borrowed) await test.rawChannels[0]!.close()
        else {
          await proxy.request(['exit'])
          expect(await test.handles[0]!.exited).toMatchObject({ code: 9 })
        }
        await vi.waitFor(() => expect(test.disable).toHaveBeenCalledTimes(1))
        const departed = await request
        expect(departed, 'SDD_BASE_RED_CONTRACT:A5').toMatchObject({
          code: 'REMOTE_RESULT_UNKNOWN',
          detail: { generation: 1 },
          cause: expect.anything()
        })
        expect(await next).toMatchObject({ code: 'STREAM_RESULT_UNKNOWN' })
        const closed = await proxy.request(['closed']).catch((error: unknown) => error)
        expect(closed).toMatchObject({
          code: 'REMOTE_CLOSED',
          detail: { generation: 1 },
          cause: expect.anything()
        })
        expect(() => dependentHandle.getFeature('use')).toThrowError(
          expect.objectContaining({ code: 'PLUGIN_SUSPENDED' })
        )
        const before = test.business
        await proxy.request(['again-closed']).catch(() => undefined)
        expect(test.business).toBe(before)
        test.scheduler.advance(1)
        await vi.waitFor(() =>
          expect(test.chunks.join('').split('matrix:describe-entered').length - 1).toBe(2)
        )
        expect(test.enable).not.toHaveBeenCalled()
        expect(() => dependentHandle.getFeature('use')).toThrowError(
          expect.objectContaining({ code: 'PLUGIN_SUSPENDED' })
        )
        await test.gate('describe')
        await vi.waitFor(
          async () => expect(await proxy.request(['restored'])).toBe('child:restored'),
          { timeout: 5000 }
        )
        expect(installed.getFeature('f')).toBe(proxy)
        expect(dependent.install).toHaveBeenCalledTimes(1)
        expect(test.enable).toHaveBeenCalledTimes(1)
        expect(test.timeline.filter((entry) => entry === 'disable' || entry === 'enable')).toEqual([
          'disable',
          'enable'
        ])
        expect(test.chunks.join('').split('matrix:request-entered').length - 1).toBe(1)
        expect(test.chunks.join('').split('matrix:stream-entered:departed').length - 1).toBe(1)
        expect(await stream.next()).toEqual({ done: true, value: undefined })
        if (borrowed) {
          process.kill(test.handles[0]!.identity.pid!, 0)
          expect(await proxy.request(['peer-live'])).toBe('child:peer-live')
        }
      } finally {
        await test.cleanup()
      }
      expect(test.budget.inUse).toBe(0)
    },
    20000
  )
})
