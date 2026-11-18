import { LAYOUT_STORAGE_PREFIX } from './constants.ts'

/**
 * Sizes saved in this page, by storage key. Deliberately private module state: when `localStorage`
 * is unavailable or throws, sizes still survive a re-attach in the same page.
 */
const pageSizes = new Map<string, number>()

/** Storage key of one region's saved width. */
export function sizeKey(blueprintId: string, address: string, region: string): string {
  return `${LAYOUT_STORAGE_PREFIX}${blueprintId}:${address}:${region}`
}

/** Reads `localStorage`; an unavailable or throwing store reads as empty. */
function readStorage(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null
  } catch {
    // An unavailable store is a supported state, not an error: sizes then live only in this page.
    return null
  }
}

/**
 * Saved width of a region, or undefined when nothing valid is saved. A value that is not a number
 * inside `[min, max]` is ignored.
 */
export function readSavedSize(key: string, min: number, max: number): number | undefined {
  /** Candidate from this page first, then from storage. */
  const value = pageSizes.get(key) ?? Number(readStorage(key) || Number.NaN)
  return Number.isFinite(value) && value >= min && value <= max ? value : undefined
}

/** Saves a region width in this page and, when available, in `localStorage`. */
export function saveSize(key: string, value: number): void {
  pageSizes.set(key, value)
  try {
    globalThis.localStorage?.setItem(key, String(value))
  } catch {
    // Quota or privacy errors are a supported state: the page-local copy above still applies.
  }
}
