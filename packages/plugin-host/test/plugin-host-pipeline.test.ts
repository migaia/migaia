import { describe, expect, it } from 'vitest'

import { PluginHostError } from '../src/error-text.js'
import { GENERATOR_CONTINUE as hostContinue } from '@migaia/middleware-pipeline'
import { type IStageCore, Host, plugin } from './plugin-host-fixtures.js'

describe('PluginHost', () => {
  it('makes dispose idempotent and rejects terminal mutations', async () => {
    const host = new Host()
    await host.use(plugin('a', () => ({})))
    const first = host.dispose()
    expect(host.dispose()).toBe(first)
    await first
    expect(() => host.use(plugin('b', () => ({})))).toThrow(PluginHostError)
    expect(() => host.unUse('a')).toThrow(PluginHostError)
  })

  it('supports all pipeline registration APIs without mode mismatch errors', async () => {
    const sync = new Host({ pipeline: { mode: 'sync' } })
    sync.usePipeline((value, next) => next(value + 1))
    expect(sync.run(1)).toBe(2)
    const asyncHost = new Host({ pipeline: { mode: 'async' } })
    asyncHost.useAsyncPipeline(async (value, next) => next(value + 1))
    await expect(asyncHost.run(1)).resolves.toBe(2)
    const generator = new Host({ pipeline: { mode: 'generator' } })
    generator.useGeneratorPipeline(function* (value) {
      return value + 1
    })
    expect(generator.run(1)).toBe(2)
    const asyncGenerator = new Host({ pipeline: { mode: 'async-generator' } })
    asyncGenerator.useAsyncGeneratorPipeline(async function* (value) {
      return value + 1
    })
    await expect(asyncGenerator.run(1)).resolves.toBe(2)
  })

  it('rejects pipeline execution after host disposal', async () => {
    const sync = new Host()
    await sync.dispose()
    expect(() => sync.run(1)).toThrow(PluginHostError)
    const asyncHost = new Host({ pipeline: { mode: 'async' } })
    await asyncHost.dispose()
    await expect(asyncHost.run(1)).rejects.toBeInstanceOf(PluginHostError)
    const asyncGeneratorHost = new Host({ pipeline: { mode: 'async-generator' } })
    await asyncGeneratorHost.dispose()
    await expect(asyncGeneratorHost.run(1)).rejects.toBeInstanceOf(PluginHostError)
  })

  it('runs an async-generator pipeline end-to-end, taking only the last yield on CONTINUE', async () => {
    const host = new Host({ pipeline: { mode: 'async-generator' } })
    host.useAsyncGeneratorPipeline(async function* (value) {
      yield value + 1
      await Promise.resolve()
      yield value + 2 // last yield: consumed only if the stage returns CONTINUE
      return hostContinue
    })
    host.useAsyncGeneratorPipeline(async function* (value) {
      return value * 2
    })
    await expect(host.run(1)).resolves.toBe(6) // (1 + 2) * 2
  })

  it('rejects nested stage registration during async-generator pipeline execution', async () => {
    const host = new Host({ pipeline: { mode: 'async-generator' } })
    host.useAsyncGeneratorPipeline(async function* (value) {
      expect(() =>
        host.useAsyncGeneratorPipeline(async function* (nextValue) {
          return nextValue
        })
      ).toThrow(PluginHostError)
      return value
    })
    await expect(host.run(1)).resolves.toBe(1)
  })

  it('lifts a generator stage registered against an async-generator host', async () => {
    const host = new Host({ pipeline: { mode: 'async-generator' } })
    host.useGeneratorPipeline(function* (value) {
      yield value + 1
      return hostContinue
    })
    host.useAsyncGeneratorPipeline(async function* (value) {
      return value * 2
    })
    await expect(host.run(1)).resolves.toBe(4)
  })

  it('stops an in-flight async-generator pipeline once the host is disposed mid-run', async () => {
    const host = new Host({ pipeline: { mode: 'async-generator' } })
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let resumed = false
    host.useAsyncGeneratorPipeline(async function* (value) {
      yield value
      await gate
      resumed = true // must never run: dispose() settles before the gate releases
      return value
    })
    const run = host.run(1)
    await host.dispose()
    release()
    await expect(run).rejects.toBeInstanceOf(PluginHostError)
    expect(resumed).toBe(false)
  })

  it('removes plugin pipeline stages on unUse', async () => {
    const host = new Host()
    const stage = (_value: number, next: (value: number) => void) => next(99)
    const owned = plugin('owned', (core) => {
      ;(core as IStageCore).usePipeline(stage)
      return {}
    })
    await host.use(owned)
    expect(host.run(1)).toBe(99)
    await host.unUse('owned')
    expect(host.run(1)).toBe(1)
    await host.use(owned)
    expect(host.run(1)).toBe(99)
  })
})
