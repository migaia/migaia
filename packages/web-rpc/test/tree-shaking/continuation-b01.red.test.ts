import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  reviewedRetainedInventory,
  type IRetainedConsumer
} from '../fixtures/tree-shaking/retained-inventory.js'

type IRetainedEntry = { readonly moduleCount: number; readonly modules: readonly string[] }
type IRetainedInventory = Readonly<Record<IRetainedConsumer, IRetainedEntry>>

/** WRC-C-B01 freezes the real consumer graph after each ownership extraction batch. */
describe('WRC-C-B01 retained graph contracts', () => {
  const script = resolve(import.meta.dirname, '../tree-shaking-retained.mjs')
  const inventory = JSON.parse(
    execFileSync(process.execPath, [script], { encoding: 'utf8' })
  ) as IRetainedInventory

  it('matches every reviewed core/client/provider/full/custom module path exactly', () => {
    for (const consumer of Object.keys(reviewedRetainedInventory) as IRetainedConsumer[]) {
      expect(inventory[consumer].moduleCount).toBe(reviewedRetainedInventory[consumer].length)
      expect(inventory[consumer].modules).toEqual(reviewedRetainedInventory[consumer])
    }
  })

  it('keeps bare core free from legacy and concrete owners', () => {
    expect(inventory.core.modules).not.toContain('src/factory.ts')
    expect(inventory.core.modules).not.toContain('src/endpoint.ts')
    expect(inventory.core.modules.some((module) => module.includes('provider-executor'))).toBe(
      false
    )
  })

  it('excludes legacy and unselected owners from retained client', () => {
    const forbiddenModules = inventory.client.modules.filter(
      (module) =>
        module === 'src/factory.ts' ||
        module === 'src/endpoint.ts' ||
        module === 'src/internal/provider.ts' ||
        module === 'src/internal/provider-admission.ts' ||
        module === 'src/internal/provider-attachment.ts' ||
        module === 'src/internal/provider-executor.ts' ||
        module === 'src/internal/discovery-registry.ts' ||
        module === 'src/internal/control-task-registry.ts' ||
        module === 'src/internal/chunk.ts'
    )
    expect(forbiddenModules).toEqual([])
  })

  it('keeps provider security closure but excludes legacy and unrelated owners', () => {
    expect(inventory.provider.modules).toContain('src/internal/provider-executor.ts')
    expect(inventory.provider.modules).toContain('src/internal/provider-admission.ts')
    expect(inventory.provider.modules).toContain('src/internal/identity.ts')
    const forbiddenModules = inventory.provider.modules.filter(
      (module) =>
        module === 'src/factory.ts' ||
        module === 'src/endpoint.ts' ||
        /discovery-registry|control-task-registry|internal\/chunk/.test(module)
    )
    expect(forbiddenModules).toEqual([])
  })
})
