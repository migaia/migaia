import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { expect, it } from 'vitest'

/** Explicit guide metadata keeps explanatory pitfalls typechecked without executing them. */
type IDocExampleMode = 'run' | 'check'

/** All authored programs compile; executable examples use actual built package entries. */
it('compiles and executes every distinct bilingual guide example', () => {
  /** Temporary modules resolve the same real package entries as the owning package's tests. */
  const directory = mkdtempSync(resolve('test', '.cache-docs-'))
  try {
    /** Identical bilingual programs share work only when their execution declarations agree. */
    const examples = new Map<string, IDocExampleMode>()
    for (const name of ['README.md', 'README.en.md', 'USEGUIDE.md', 'USEGUIDE.en.md']) {
      /** Each document contributes its authored programs in reading order. */
      const markdown = readFileSync(name, 'utf8')
      for (const match of markdown.matchAll(
        /```ts(?:[ \t]+doc-test=(run|check))?\n([\s\S]*?)\n```/g
      )) {
        /** Unmarked TypeScript keeps the runner's original executable-example behavior. */
        const mode = (match[1] ?? 'run') as IDocExampleMode
        /** Comments remain part of the program, including each localized pitfalls explanation. */
        const code = match[2]!
        expect(examples.get(code) ?? mode).toBe(mode)
        examples.set(code, mode)
      }
    }
    /** Every program, including check-only pitfalls, enters the same strict compiler invocation. */
    const files: string[] = []
    for (const [index, code] of [...examples.keys()].entries()) {
      /** One module per distinct authored program avoids cross-example globals. */
      const file = join(directory, `example-${index}.mts`)
      writeFileSync(file, code)
      files.push(file)
    }
    execFileSync(
      'rtk',
      [
        'proxy',
        'pnpm',
        'exec',
        'tsc',
        '--ignoreConfig',
        '--strict',
        '--noEmit',
        '--skipLibCheck',
        '--target',
        'ES2022',
        '--module',
        'ESNext',
        '--moduleResolution',
        'Bundler',
        '--lib',
        'ES2024,DOM,ESNext.Disposable',
        '--esModuleInterop',
        ...files
      ],
      { stdio: 'inherit' }
    )
    /** Exact business output covers all six executable programs in document order. */
    const outputs: string[] = []
    for (const [index, mode] of [...examples.values()].entries()) {
      if (mode === 'check') continue
      /** Preserve complete stdout so an extra or missing business result also fails the check. */
      const output = execFileSync('rtk', ['proxy', 'node', files[index]!], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      })
      outputs.push(output)
    }
    expect(outputs).toEqual([
      '{ answer: 1 } 1\n',
      "{ name: 'Ada' }\ntrue\n",
      'ready\n',
      '{ revision: 2 }\n{ revision: 3 }\n{ revision: 2 }\n',
      '500\nundefined\n',
      "{ text: 'Answer' }\n"
    ])
    expect([...examples.values()].filter((mode) => mode === 'check')).toHaveLength(2)
    expect(examples.size).toBe(8)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}, 30000)
