import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/** Collects every TypeScript source file below one package source root. */
function collectSourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? collectSourceFiles(path) : path.endsWith('.ts') ? [path] : []
  })
}

/** Reads source text once so every closed-world assertion observes one snapshot. */
function readSources(directory) {
  return collectSourceFiles(directory)
    .sort()
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n')
}

describe('TLAR-T19 closed-world architecture boundary', () => {
  it('keeps one Host/Graph owner and excludes raw platform or domain runtime paths', () => {
    const packageDirectory = resolve(import.meta.dirname, '..')
    const tray = readSources(join(packageDirectory, 'src'))
    const capability = readSources(resolve(packageDirectory, '../capability/src'))
    const pluginHost = readSources(resolve(packageDirectory, '../plugin-host/src'))
    const runtime = readFileSync(join(packageDirectory, 'src/runtime/create-runtime.ts'), 'utf8')
    const loader = readFileSync(join(packageDirectory, 'src/loader/load-into-host.ts'), 'utf8')
    const adapter = readFileSync(join(packageDirectory, 'src/adapter/define-adapter.ts'), 'utf8')

    expect((tray.match(/createDynamicCapabilityGraph(?:<[^>]+>)?\s*\(/g) ?? []).length).toBe(1)
    expect(tray).not.toMatch(/new\s+PluginHost\s*\(/)
    expect(tray).not.toMatch(/createManualScheduler\s*\(/)
    expect(runtime).not.toMatch(/createDynamicCapabilityGraph|new\s+PluginHost|createEventHub/)
    expect(loader).not.toMatch(/createDynamicCapabilityGraph|new\s+PluginHost|createRuntime/)
    expect(adapter).not.toMatch(/createDynamicCapabilityGraph|new\s+PluginHost|createRuntime/)
    expect(capability).not.toMatch(/@migaia\/(?:tray|plugin-host)/)
    expect(pluginHost).not.toMatch(/@migaia\/tray/)
    expect(tray).not.toMatch(
      /(?:node:|window\.|document\.|\bWorker\b|fetch\(|@migaia\/(?:store|reactive))/
    )
    expect(runtime).not.toMatch(/(?:setTimeout\s*\(|setInterval\s*\(|runPipeline\s*\()/)
    expect(runtime).not.toMatch(/\b(?:rawHost|concreteHost|hostEscape)\b/)
  })
})
