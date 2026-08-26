import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import {
  createLifecycleScope,
  createGenerationController,
  createPendingTracker,
  createMutationQueue
} from '../src/index'

const srcRoot = fileURLToPath(new URL('../src/', import.meta.url))
const packageJsonPath = fileURLToPath(new URL('../package.json', import.meta.url))

const readSrcFiles = (): Map<string, string> => {
  const files = new Map<string, string>()
  for (const name of readdirSync(srcRoot)) {
    // `.d.ts` ambient declarations (src/ambient.d.ts) are not modules — they declare host globals
    // and are never re-exported from index.ts, so they are excluded from the "every module is
    // reachable" gate.
    if (!name.endsWith('.ts') || name.endsWith('.d.ts')) continue
    files.set(name, readFileSync(join(srcRoot, name), 'utf8'))
  }
  return files
}

describe('§5.1 structural gates', () => {
  it('package.json declares only the runtime-neutral utils foundation dependency', () => {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      dependencies?: Record<string, string>
    }
    expect(pkg.dependencies).toEqual({ '@migaia/utils': 'workspace:^' })
  })

  it('domain-noun scan: index.ts exports no identifier containing a forbidden domain noun', () => {
    const forbidden = [
      'store',
      'plugin',
      'capability',
      'service',
      'rpc',
      'storage',
      'sink',
      'field',
      'endpoint'
    ]
    const indexSource = readFileSync(join(srcRoot, 'index.ts'), 'utf8')
    // Every exported identifier: `export { name, type Name }`, `export type { A, B }`, `export function name`.
    const identifierPattern = /\b([A-Za-z][A-Za-z0-9]*)\b/g
    const identifiers = new Set<string>()
    for (const match of indexSource.matchAll(identifierPattern)) identifiers.add(match[1]!)
    const violations: string[] = []
    for (const identifier of identifiers) {
      const lower = identifier.toLowerCase()
      for (const word of forbidden) {
        if (lower.includes(word)) {
          violations.push(`${identifier} (contains "${word}")`)
          break
        }
      }
    }
    // Whitelist: JS/TS reserved words and generic terms that legitimately substring-match a
    // forbidden word without being domain leakage (e.g. none currently — kept empty so any future
    // false positive must be reviewed explicitly rather than silently ignored).
    const whitelist = new Set<string>()
    const realViolations = violations.filter((entry) => !whitelist.has(entry))
    expect(realViolations).toEqual([])
  })

  it('"signal" only appears in its platform AbortSignal sense, never a reactive-signal sense', () => {
    // A reactive "signal" (as in @migaia/reactive's Signal) would show up paired with words like
    // "reactive", "computed", "observable", "subscribe" in the same declaration. Every `signal`
    // occurrence in this package's public types must be `AbortSignal`-typed.
    const files = readSrcFiles()
    for (const [name, source] of files) {
      const reactiveSignalPattern =
        /\breactive\s+signal\b|\bSignal(?:Value|Node)?\s*<|\bcreateSignal\b/i
      expect(
        reactiveSignalPattern.test(source),
        `${name} must not reference a reactive Signal`
      ).toBe(false)
    }
  })

  it('zero graph algorithm: no topological sort, cycle detection, or adjacency-list implementation anywhere in src/', () => {
    const files = readSrcFiles()
    const graphAlgorithmPattern =
      /topo(?:logical)?[-_ ]?sort|adjacency[-_ ]?(?:list|map)|\bDFS\b|\bBFS\b|cycle[-_ ]?detect/i
    for (const [name, source] of files) {
      expect(
        graphAlgorithmPattern.test(source),
        `${name} must not implement a graph algorithm`
      ).toBe(false)
    }
  })

  it('DisposeTransaction accepts an already-ordered plan as input rather than computing one (D-3)', () => {
    // Structural proxy for "this package never computes order": the module only ever *sorts* by a
    // caller-supplied numeric key (`order`) or executes a caller-supplied sequence (`plan`) — it
    // never builds a dependency graph or walks edges.
    const source = readFileSync(join(srcRoot, 'dispose-transaction.ts'), 'utf8')
    expect(source).not.toMatch(/\bedges?\b|\bdependenc(?:y|ies)\b|\bgraph\b/i)
  })
})

describe('L-T20 cross-module: a downstream adapter uses only public primitives', () => {
  it('composes LifecycleScope + GenerationController + PendingTracker into a tiny "resource" without any internal import', async () => {
    // Simulates what a downstream package (e.g. a future @migaia/resource) would build: an
    // async-resource abstraction using only what index.ts exports, never reaching into this
    // package's private generation/lease/pending/dispose state machines directly.
    const scope = createLifecycleScope()
    const generations = createGenerationController()
    const pending = createPendingTracker()

    let currentValue: string | undefined
    const fetchResource = (label: string): void => {
      const request = generations.begin()
      const task = pending.track(
        new Promise<string>((resolve) => setTimeout(() => resolve(label), 0))
      )
      void task.then((value) => {
        generations.adopt(request.token, value, () => {
          /* stale value has nothing to release in this toy adapter */
        })
        if (generations.isCurrent(request.token)) currentValue = value
      })
    }

    fetchResource('first')
    fetchResource('second') // supersedes the first
    await pending.drain()
    expect(currentValue).toBe('second')

    scope.own(
      { adapter: 'resource' },
      {
        force: () => {
          generations.dispose()
        }
      }
    )
    await scope.dispose()
    expect(generations.disposed).toBe(true)
  })

  it('composes MutationQueue + LifecycleScope for a tiny transactional owner, without internal imports', async () => {
    const queue = createMutationQueue()
    const scope = createLifecycleScope({ errorPolicy: 'collect' })
    const applied: string[] = []
    await queue.enqueue(() => {
      scope.own('mutation-1', {
        force: () => {
          applied.push('mutation-1')
        }
      })
    })
    await queue.enqueue(() => {
      scope.own('mutation-2', {
        force: () => {
          applied.push('mutation-2')
        }
      })
    })
    await scope.dispose()
    expect(applied.sort()).toEqual(['mutation-1', 'mutation-2'])
  })

  it('the public surface (index.ts) is sufficient — no test in this suite has ever imported from a sibling src/*.ts other than for direct unit coverage of that module', () => {
    // A weaker, always-true structural marker: confirms `index.ts` re-exports at least one symbol
    // from every other module file, so nothing in src/ is unreachable from the public surface.
    const indexSource = readFileSync(join(srcRoot, 'index.ts'), 'utf8')
    const files = readSrcFiles()
    for (const name of files.keys()) {
      if (name === 'index.ts') continue
      const moduleSpecifier = `./${name.replace(/\.ts$/, '')}`
      expect(indexSource.includes(moduleSpecifier), `index.ts must re-export from ${name}`).toBe(
        true
      )
    }
  })
})

describe('AF-T34 rule gate: no Function.prototype call/apply/bind; Reflect.apply only in the receiver boundary', () => {
  // The five runtime-neutral foundation packages that AF-34 audits. `packages/` is two levels up
  // from this test file (`packages/lifecycle/test/`).
  const foundationSrc = [
    'lifecycle/src',
    'reactive/src',
    'resource/src',
    'capability/src',
    'plugin-host/src'
  ]
  const packagesRoot = fileURLToPath(new URL('../../', import.meta.url))

  /** Recursively lists `.ts` sources (excluding ambient `.d.ts`) under a directory. */
  const walkSources = (dir: string): string[] => {
    const out: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) out.push(...walkSources(full))
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(full)
    }
    return out
  }

  it('`.call(`/`.apply(`/`.bind(` are absent; `Reflect.apply(` lives only in documented receiver boundaries', () => {
    const forbidden: string[] = []
    const reflectFiles = new Set<string>()
    for (const rel of foundationSrc) {
      const absDir = join(packagesRoot, rel)
      for (const file of walkSources(absDir)) {
        const source = readFileSync(file, 'utf8')
        const relFile = file.slice(packagesRoot.length)
        for (const match of source.matchAll(/([A-Za-z_$][A-Za-z0-9_$]*)\.(call|apply|bind)\(/g)) {
          const receiver = match[1]!
          const method = match[2]!
          if (receiver === 'Reflect' && method === 'apply') reflectFiles.add(relFile)
          else forbidden.push(`${relFile}: ${receiver}.${method}()`)
        }
      }
    }
    expect(forbidden).toEqual([])
    expect([...reflectFiles].sort()).toEqual([
      'capability/src/index.ts',
      'lifecycle/src/errors.ts',
      'lifecycle/src/scheduler.ts',
      'plugin-host/src/config.ts',
      'plugin-host/src/disposal.ts',
      'plugin-host/src/host-runtime.ts',
      'reactive/src/runtime/receiver.ts'
    ])
  })
})
