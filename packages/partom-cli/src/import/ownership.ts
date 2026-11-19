/**
 * Ownership of generated files. The first line marks a file as generated and records the hash of
 * the rest; a file whose body no longer matches was edited by hand and is never overwritten.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

/** Prefix of the ownership line. */
export const GENERATED_MARKER = '// @partom-generated sha256:'
/**
 * Ownership key of a generated JSON file, which cannot carry a comment line. Its value is the
 * marker text and the hash of the document without this key; blueprint parsing ignores unknown top
 * keys.
 */
export const JSON_MARKER_KEY = '$partom'
/** Prefix of the JSON ownership value. */
const JSON_MARKER = '@partom-generated sha256:'

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

/** Full text of a generated JSON body: the ownership key first, then the body's own keys. */
function generatedJsonText(body: string): string {
  return `${JSON.stringify({ [JSON_MARKER_KEY]: `${JSON_MARKER}${hashOf(body)}`, ...(JSON.parse(body) as object) }, null, 2)}\n`
}

/** Whether existing JSON text is generated and its other keys are unchanged since generation. */
function isUntouchedJson(text: string): boolean {
  /** Parsed document, or undefined when it is not a JSON object. */
  let document: Record<string, unknown> | undefined
  try {
    /** Parsed value. */
    const parsed: unknown = JSON.parse(text)
    document =
      typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined
  } catch {
    return false
  }
  /** Ownership value. */
  const marker = document?.[JSON_MARKER_KEY]
  if (document === undefined || typeof marker !== 'string' || !marker.startsWith(JSON_MARKER))
    return false
  /** Document without the ownership key. */
  const { [JSON_MARKER_KEY]: _marker, ...rest } = document
  return marker.slice(JSON_MARKER.length) === hashOf(JSON.stringify(rest, null, 2))
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
 * by hand (or never generated) is taken over and left alone; identical text is not rewritten. A
 * `.json` path takes a JSON object text as `body` and records ownership in `$partom`.
 */
export function writeGenerated(out: string, path: string, body: string): WriteOutcome {
  /** Absolute output root. */
  const root = resolve(out)
  /** Absolute target. */
  const target = resolve(root, path)
  if (!target.startsWith(`${root}${sep}`)) return WriteOutcome.outside
  /** Whether the file is a JSON document. */
  const json = target.endsWith('.json')
  /** Full text to write. */
  const text = json ? generatedJsonText(body) : generatedText(body)
  if (existsSync(target)) {
    /** Current text. */
    const current = readFileSync(target, 'utf8')
    if (!(json ? isUntouchedJson(current) : isUntouched(current))) return WriteOutcome.takenOver
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
