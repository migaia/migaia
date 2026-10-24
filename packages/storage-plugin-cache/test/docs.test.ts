import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { expect, it } from 'vitest'

/** All authored code examples compile and run against actual built package entries. */
it('compiles and executes every distinct bilingual guide example', () => {
  const directory = mkdtempSync(resolve('test', '.cache-docs-'))
  try {
    const examples = new Set<string>()
    for (const name of ['README.md', 'README.en.md', 'USEGUIDE.md', 'USEGUIDE.en.md']) {
      const markdown = readFileSync(name, 'utf8')
      for (const match of markdown.matchAll(/```ts\n([\s\S]*?)\n```/g)) examples.add(match[1]!)
    }
    const files: string[] = []
    for (const [index, code] of [...examples].entries()) {
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
    for (const [index, code] of [...examples].entries()) {
      const output = execFileSync('rtk', ['proxy', 'node', files[index]!], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      })
      expect(output).toContain(
        code.includes('semanticCacheFeature')
          ? 'Answer'
          : code.includes('stampedeLock')
            ? 'Hello'
            : '42'
      )
    }
    expect(examples.size).toBe(3)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}, 30000)
