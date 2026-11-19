/**
 * Ownership of generated files. The first line marks a file as generated and records the hash of
 * the rest; a file whose body no longer matches was edited by hand and is never overwritten.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

/** Prefix of the ownership line. */
export const GENERATED_MARKER = '// @partom-generated sha256:'

/** Outcome of writing one generated file. */
export const WriteOutcome = {
  written: 'written',
  unchanged: 'unchanged',
  takenOver: 'takenOver',
  outside: 'outside'
} as const

/** One write outcome. */
export type WriteOutcome = keyof typeof WriteOutcome

/** Hash of a generated body. */
function hashOf(body: string): string {
  return createHash('sha256').update(body).digest('hex')
}

/** Full file text of a generated body: the ownership line followed by the body. */
export function generatedText(body: string): string {
  return `${GENERATED_MARKER}${hashOf(body)}\n${body}`
}

/** Whether existing file text is generated and untouched since generation. */
export function isUntouched(text: string): boolean {
  /** End of the first line. */
  const newline = text.indexOf('\n')
  if (newline < 0 || !text.startsWith(GENERATED_MARKER)) return false
  return text.slice(GENERATED_MARKER.length, newline) === hashOf(text.slice(newline + 1))
}

/** Whether existing file text carries the ownership line at all. */
export function isGenerated(text: string): boolean {
  return text.startsWith(GENERATED_MARKER)
}

/**
 * Writes a generated file under `out`. A path that resolves outside `out` is refused; a file edited
 * by hand (or never generated) is taken over and left alone; identical text is not rewritten.
 */
export function writeGenerated(out: string, path: string, body: string): WriteOutcome {
  /** Absolute output root. */
  const root = resolve(out)
  /** Absolute target. */
  const target = resolve(root, path)
  if (!target.startsWith(`${root}${sep}`)) return WriteOutcome.outside
  /** Full text to write. */
  const text = generatedText(body)
  if (existsSync(target)) {
    /** Current text. */
    const current = readFileSync(target, 'utf8')
    if (!isUntouched(current)) return WriteOutcome.takenOver
    if (current === text) return WriteOutcome.unchanged
  }
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, text)
  return WriteOutcome.written
}

/** Every file under a directory, as paths relative to it; recursion depth is the tree depth. */
function filesUnder(root: string, directory: string, found: string[]): void {
  if (!existsSync(directory)) return
  for (const name of readdirSync(directory)) {
    /** Absolute path of the entry. */
    const path = join(directory, name)
    if (statSync(path).isDirectory()) filesUnder(root, path, found)
    else found.push(relative(root, path))
  }
}

/** Generated files under `out` (by marker) that are not in `current`, as relative paths. */
export function staleFiles(out: string, current: ReadonlySet<string>): string[] {
  /** Every file under the output directory. */
  const found: string[] = []
  filesUnder(resolve(out), resolve(out), found)
  return found.filter(
    (path) =>
      path.endsWith('.ts') &&
      !current.has(path) &&
      isGenerated(readFileSync(join(resolve(out), path), 'utf8'))
  )
}
