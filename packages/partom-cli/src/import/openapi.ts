/** Reading an OpenAPI 3.x document and resolving its internal `$ref` pointers. */
import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { PartCliErrorCode } from '../error-code.ts'
import { createPartCliError, PartCliText } from '../errors.ts'
import { ImportReason } from './text.ts'

/** A plain JSON object of the document. */
export type IJsonObject = Readonly<Record<string, unknown>>

/** One uncertain item of the import report. */
export type IUncertain = { readonly pointer: string; readonly reason: ImportReason }

/** True for a non-array object. */
export function isObject(value: unknown): value is IJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Parses the file by extension; YAML through Bun's parser. */
function parseText(path: string, text: string): unknown {
  /** Lower-case extension. */
  const extension = extname(path).toLowerCase()
  return extension === '.yaml' || extension === '.yml' ? Bun.YAML.parse(text) : JSON.parse(text)
}

/**
 * Reads an OpenAPI 3.x document. A parse failure, an `openapi` field not starting with `3.` or a
 * missing `paths` object is `IMPORT_INVALID` (exit 2), the parse error on `cause`.
 */
export function readOpenApi(path: string): IJsonObject {
  /** Parsed document. */
  let document: unknown
  try {
    document = parseText(path, readFileSync(path, 'utf8'))
  } catch (cause) {
    throw createPartCliError(PartCliErrorCode.importInvalid, PartCliText.importInvalid(path), cause)
  }
  if (
    !isObject(document) ||
    typeof document.openapi !== 'string' ||
    !document.openapi.startsWith('3.') ||
    !isObject(document.paths)
  )
    throw createPartCliError(PartCliErrorCode.importInvalid, PartCliText.importInvalid(path))
  return document
}

/** JSON Pointer escaping of one segment. */
export function pointerSegment(segment: string): string {
  return segment.replaceAll('~', '~0').replaceAll('/', '~1')
}

/** Decodes one JSON Pointer segment. */
function decodeSegment(segment: string): string {
  return segment.replaceAll('~1', '/').replaceAll('~0', '~')
}

/**
 * Resolves internal `$ref` pointers of one document. Each segment is read as an own property only,
 * so `constructor` or `__proto__` never reach prototype members. Results are memoised per pointer
 * and a pointer being resolved is tracked to detect cycles, so each target is inlined once.
 */
export class RefResolver {
  /** Document root. */
  readonly #document: IJsonObject
  /** Uncertain items collected while resolving. */
  readonly #uncertain: IUncertain[]
  /** Inlined schemas by pointer. */
  readonly #inlined = new Map<string, unknown>()
  /** Pointers currently being inlined. */
  readonly #active = new Set<string>()

  /** Binds the resolver to a document and a report list. */
  constructor(document: IJsonObject, uncertain: IUncertain[]) {
    this.#document = document
    this.#uncertain = uncertain
  }

  /** Target of an internal pointer, or undefined (reported) when it is external or missing. */
  target(ref: string, at: string): unknown {
    if (!ref.startsWith('#/')) {
      this.#uncertain.push({ pointer: at, reason: ImportReason.externalRef })
      return undefined
    }
    /** Current value along the pointer. */
    let current: unknown = this.#document
    for (const raw of ref.slice(2).split('/')) {
      /** Decoded segment. */
      const segment = decodeSegment(raw)
      if (!isObject(current) || !Object.hasOwn(current, segment)) {
        this.#uncertain.push({ pointer: at, reason: ImportReason.missingRef })
        return undefined
      }
      current = current[segment]
    }
    return current
  }

  /**
   * A copy of a schema with every internal `$ref` replaced by its target. Unresolvable references
   * and cycles become `{}` (any value) and are reported.
   */
  inline(schema: unknown, at: string): unknown {
    if (Array.isArray(schema))
      return schema.map((item, index) => this.inline(item, `${at}/${index}`))
    if (!isObject(schema)) return schema
    if (typeof schema.$ref === 'string') return this.#inlineRef(schema.$ref, at)
    /** Copy with inlined members. */
    const copy: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(schema))
      copy[key] = this.inline(value, `${at}/${pointerSegment(key)}`)
    return copy
  }

  /** Inlines one reference, memoised; a reference back into itself is a cycle. */
  #inlineRef(ref: string, at: string): unknown {
    if (this.#inlined.has(ref)) return this.#inlined.get(ref)
    if (this.#active.has(ref)) {
      this.#uncertain.push({ pointer: at, reason: ImportReason.cyclicRef })
      return {}
    }
    /** Target of the reference. */
    const target = this.target(ref, at)
    if (target === undefined) return {}
    this.#active.add(ref)
    /** Inlined target. */
    const inlined = this.inline(target, ref.slice(1))
    this.#active.delete(ref)
    this.#inlined.set(ref, inlined)
    return inlined
  }
}
