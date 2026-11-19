/** Name normalisation and collision handling for generated identifiers, ids and file names. */
import type { IUncertain } from './openapi.ts'
import { ImportReason } from './text.ts'

/** Kebab-case form keeping only `[a-z0-9-]`; empty input becomes `unnamed`. */
export function kebab(name: string): string {
  /** Lower-case words split at case changes and separators. */
  const value = name
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
  return value === '' ? 'unnamed' : value
}

/** CamelCase form keeping only `[A-Za-z0-9]`, starting with a letter (`op` prefix otherwise). */
export function camel(name: string): string {
  /** Words of the name. */
  const words = kebab(name).split('-')
  /** Joined words. */
  const joined = words
    .map((word, index) => (index === 0 ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`))
    .join('')
  return /^[a-z]/.test(joined) ? joined : `op${joined.charAt(0).toUpperCase()}${joined.slice(1)}`
}

/**
 * Hands out unique names in one name space. A taken name gets `-2`, `-3`… (or `2`, `3` for camel
 * names) in request order, and each collision is reported once.
 */
export class NameSpace {
  /** Names already handed out. */
  readonly #taken = new Set<string>()
  /** Report list. */
  readonly #uncertain: IUncertain[]
  /** Separator before the numeric suffix. */
  readonly #separator: string

  /** Creates a name space reporting into a list. */
  constructor(uncertain: IUncertain[], separator: '-' | '') {
    this.#uncertain = uncertain
    this.#separator = separator
  }

  /** A unique form of `name`; `pointer` locates the source for the report. */
  claim(name: string, pointer: string): string {
    /** Candidate name. */
    let candidate = name
    /** Next numeric suffix. */
    let suffix = 2
    while (this.#taken.has(candidate)) {
      candidate = `${name}${this.#separator}${suffix}`
      suffix += 1
    }
    if (candidate !== name) this.#uncertain.push({ pointer, reason: ImportReason.nameCollision })
    this.#taken.add(candidate)
    return candidate
  }
}
