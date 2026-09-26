import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { IRetainedConsumer } from '../fixtures/tree-shaking/retained-inventory.js'

type IRetainedEntry = { readonly moduleCount: number; readonly modules: readonly string[] }
type IRetainedInventory = Readonly<Record<IRetainedConsumer, IRetainedEntry>>

/** WRC-C-B01 freezes the real consumer graph after each ownership extraction batch. */
describe('WRC-C-B01 retained graph contracts', () => {
  /** Invokes the existing full retained probe without historical inventory inputs. */
  const script = resolve(import.meta.dirname, '../tree-shaking-retained.mjs')
  /** Reads the normal selected-consumer graph reported by the canonical retained probe. */
  const inventory = JSON.parse(
    execFileSync(process.execPath, [script], { encoding: 'utf8' })
  ) as IRetainedInventory
  /** Reads the existing causal owner report for an independently structured current closure. */
  const retainedProbe = JSON.parse(
    execFileSync(process.execPath, [resolve(import.meta.dirname, 'core-retained-causal.mjs')], {
      encoding: 'utf8'
    })
  ) as { readonly consumers: IRetainedInventory }

  it('matches every current core/client/provider/full/custom module path exactly', () => {
    for (const consumer of Object.keys(inventory) as IRetainedConsumer[]) {
      expect(inventory[consumer].moduleCount).toBe(retainedProbe.consumers[consumer].moduleCount)
      expect(inventory[consumer].modules).toEqual(retainedProbe.consumers[consumer].modules)
    }
  })

  it('keeps bare core free from legacy and concrete owners', () => {
    expect(inventory.core.modules).not.toContain('src/core/factory.ts')
    expect(inventory.core.modules).not.toContain('src/core/endpoint.ts')
    expect(inventory.core.modules.some((module) => module.includes('provider-executor'))).toBe(
      false
    )
  })

  it('excludes legacy and unselected owners from retained client', () => {
    const forbiddenModules = inventory.client.modules.filter(
      (module) =>
        module === 'src/core/factory.ts' ||
        module === 'src/core/endpoint.ts' ||
        module === 'src/core/internal/provider.ts' ||
        module === 'src/core/internal/provider-admission.ts' ||
        module === 'src/core/internal/provider-attachment.ts' ||
        module === 'src/core/internal/provider-executor.ts' ||
        module === 'src/core/internal/discovery-registry.ts' ||
        module === 'src/core/internal/control-task-registry.ts' ||
        module === 'src/core/internal/chunk.ts'
    )
    expect(forbiddenModules).toEqual([])
  })

  it('keeps provider security closure but excludes legacy and unrelated owners', () => {
    expect(inventory.provider.modules).toContain('src/core/internal/provider-executor.ts')
    expect(inventory.provider.modules).toContain('src/core/internal/provider-admission.ts')
    expect(inventory.provider.modules).toContain('src/core/internal/identity.ts')
    const forbiddenModules = inventory.provider.modules.filter(
      (module) =>
        module === 'src/core/factory.ts' ||
        module === 'src/core/endpoint.ts' ||
        /discovery-registry|control-task-registry|internal\/chunk/.test(module)
    )
    expect(forbiddenModules).toEqual([])
  })
})
