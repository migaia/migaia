import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { matrixFixture } from './matrix-fixture.js'
import { processPlugin } from '@migaia/rpc-plugin-process'

describe('real Node parent-loss ownership', () => {
  it.each(['graceful', 'hung', 'explicit'] as const)(
    'real Node parent-loss %s uses original manual grace deadline',
    async (mode) => {
      const test = await matrixFixture()
      if (!test.spawn) throw new Error('spawn required')
      const plugin = processPlugin({
        ...test.settings,
        spawn: {
          ...test.spawn,
          supervision: {
            ...test.spawn.supervision,
            spec: {
              ...test.spec,
              env: {
                inherit: [],
                set: {
                  RPC_PARENT_LOSS: mode,
                  RPC_CLOCK_GATE: join(test.directory, 'clock99'),
                  RPC_CLOCK_FINAL_GATE: join(test.directory, 'clock100')
                }
              }
            }
          }
        }
      })
      try {
        await test.host.use(plugin)
        if (mode === 'explicit') {
          await test.outlet.request('p', 'p.f.request', ['explicit-close'])
          await vi.waitFor(() => expect(test.chunks.join('')).toContain('matrix:explicit-closed'))
          expect(test.chunks.join(''), 'parent loss contract').not.toContain('matrix:exit:')
          expect(test.chunks.join('')).not.toContain('matrix:parent-lost')
        } else {
          await test.rawChannels[0]!.close()
          await vi.waitFor(() => expect(test.chunks.join('')).toContain('matrix:endpoint-dispose'))
          if (mode === 'graceful') {
            await vi.waitFor(() => expect(test.chunks.join('')).toContain('matrix:exit:0'))
          } else {
            expect(test.chunks.join(''), 'parent loss contract').toContain('matrix:grace-scheduled')
            await test.gate('clock99')
            await vi.waitFor(() => expect(test.chunks.join('')).toContain('matrix:clock:99'))
            expect(test.chunks.join(''), 'parent loss contract').not.toContain('matrix:exit:')
            await test.gate('clock100')
            await vi.waitFor(() => expect(test.chunks.join('')).toContain('matrix:clock:100'))
            expect(test.chunks.join('')).toContain('matrix:exit:1')
          }
          expect(test.chunks.join('').split('matrix:exit:').length - 1).toBe(1)
          expect(test.chunks.join('').split('matrix:parent-lost').length - 1).toBe(1)
        }
        expect(test.chunks.join('').split('matrix:endpoint-dispose').length - 1).toBe(1)
        expect(test.chunks.join('').split('matrix:service-close').length - 1).toBe(1)
      } finally {
        await test.cleanup()
      }
      expect(test.budget.inUse).toBe(0)
    },
    20000
  )
})
