import { UtilsErrorCode } from './error-code.js'
import { UtilsErrorText } from './error-text.js'
import { attachErrorIdentity } from './error.js'
import { readObjectPathSegments } from './internal/object-path.js'
import {
  parseObjectPath,
  type IObjectPathInput,
  type IObjectPathTuple,
  type IObjectPathValue
} from './object-path.js'

/** Stable stage tags for the collector's ordered, single-pass evaluator. */
const CollectorStageKind = {
  field: 'field',
  like: 'like',
  equals: 'equals',
  oneOf: 'oneOf',
  where: 'where',
  distinctBy: 'distinctBy',
  skip: 'skip',
  take: 'take'
} as const

/** Actions available before and after a field scope is selected. */
export type ICollectorActions<T, Self> = {
  readonly result: readonly T[]

  fieldBy<const P extends readonly [IObjectPathInput<T>, ...IObjectPathInput<T>[]]>(
    ...paths: P
  ): IFieldCollector<T, P[number]>

  where(predicate: (source: T) => boolean): Self
  distinctBy<P extends IObjectPathInput<T>>(path: P): Self
  skip(count: number): Self
  take(count: number): Self
}

/**
 * Collector state before a field scope enables field-dependent predicates. An interface is required
 * because TypeScript rejects the equivalent directly recursive alias.
 */
export interface ICollector<T> extends ICollectorActions<T, ICollector<T>> {}

/**
 * Collector state whose values are inferred from the latest `fieldBy`. An interface is required to
 * preserve its recursive fluent return type.
 */
export interface IFieldCollector<T, P extends IObjectPathInput<T>> extends ICollectorActions<
  T,
  IFieldCollector<T, P>
> {
  like(query: string): IFieldCollector<T, P>
  equals(value: IObjectPathValue<T, P>): IFieldCollector<T, P>
  oneOf(value: IObjectPathValue<T, P>, ...values: IObjectPathValue<T, P>[]): IFieldCollector<T, P>
}

type IFieldStage = {
  readonly kind: typeof CollectorStageKind.field
  readonly fields: readonly IObjectPathTuple[]
}

type ILikeStage = {
  readonly kind: typeof CollectorStageKind.like
  readonly fields: readonly IObjectPathTuple[]
  readonly query: string
}

type IEqualsStage = {
  readonly kind: typeof CollectorStageKind.equals
  readonly fields: readonly IObjectPathTuple[]
  readonly value: unknown
}

type IOneOfStage = {
  readonly kind: typeof CollectorStageKind.oneOf
  readonly fields: readonly IObjectPathTuple[]
  readonly values: readonly unknown[]
}

type IWhereStage<T> = {
  readonly kind: typeof CollectorStageKind.where
  readonly predicate: (source: T) => boolean
}

type IDistinctByStage = {
  readonly kind: typeof CollectorStageKind.distinctBy
  readonly path: IObjectPathTuple
  readonly seen: Set<unknown>
}

type ISkipStage = {
  readonly kind: typeof CollectorStageKind.skip
  readonly count: number
  remaining: number
}

type ITakeStage = {
  readonly kind: typeof CollectorStageKind.take
  readonly count: number
  remaining: number
}

type IFieldPredicateStage = ILikeStage | IEqualsStage | IOneOfStage
type ICollectStage<T> =
  | IFieldStage
  | IFieldPredicateStage
  | IWhereStage<T>
  | IDistinctByStage
  | ISkipStage
  | ITakeStage

/** Creates a package-coded TypeError for invalid collector arguments. */
function invalidType(field: string, expectation: string): TypeError {
  return attachErrorIdentity(new TypeError(UtilsErrorText.invalidArgument(field, expectation)), {
    source: '@migaia/utils',
    code: UtilsErrorCode.invalidArgument
  })
}

/** Creates a package-coded RangeError while preserving its native runtime type. */
function invalidRange(field: string, expectation: string): RangeError {
  return attachErrorIdentity(new RangeError(UtilsErrorText.invalidArgument(field, expectation)), {
    source: '@migaia/utils',
    code: UtilsErrorCode.invalidArgument
  })
}

/** Creates the stable error used when evaluation attempts to mutate or re-read its collector. */
function reentrantCollector(): TypeError {
  return attachErrorIdentity(new TypeError(UtilsErrorText.reentrantCall), {
    source: '@migaia/utils',
    code: UtilsErrorCode.reentrantCall
  })
}

/** Validates JavaScript callers before delegating to the canonical safe path parser. */
function parseCollectorPath(path: string | IObjectPathTuple): IObjectPathTuple {
  if (typeof path !== 'string' && !Array.isArray(path))
    throw invalidType('path', 'a string or readonly segment tuple')
  return parseObjectPath(path)
}

/** Returns whether one source exposes at least one defined field value. */
function hasDefinedField(source: unknown, fields: readonly IObjectPathTuple[]): boolean {
  for (const field of fields) if (readObjectPathSegments(source, field) !== undefined) return true
  return false
}

/** Applies one field predicate with OR semantics and short-circuits on its first match. */
function matchesFieldPredicate(source: unknown, stage: IFieldPredicateStage): boolean {
  for (const field of stage.fields) {
    const value = readObjectPathSegments(source, field)
    if (stage.kind === CollectorStageKind.like) {
      if (typeof value === 'string' && value.toLowerCase().includes(stage.query)) return true
      continue
    }
    if (stage.kind === CollectorStageKind.equals) {
      if (Object.is(value, stage.value)) return true
      continue
    }
    for (const candidate of stage.values) if (Object.is(value, candidate)) return true
  }
  return false
}

/**
 * Shares path reads for adjacent field stages while independently preserving presence and match.
 * This matters when one field is defined but another explicitly undefined field matches equality.
 */
function matchesFusedFieldPredicate(source: unknown, stage: IFieldPredicateStage): boolean {
  let hasDefined = false
  let matched = false
  for (const field of stage.fields) {
    const value = readObjectPathSegments(source, field)
    if (value !== undefined) hasDefined = true
    if (stage.kind === CollectorStageKind.like) {
      if (typeof value === 'string' && value.toLowerCase().includes(stage.query)) matched = true
    } else if (stage.kind === CollectorStageKind.equals) {
      if (Object.is(value, stage.value)) matched = true
    } else {
      for (const candidate of stage.values)
        if (Object.is(value, candidate)) {
          matched = true
          break
        }
    }
    if (hasDefined && matched) return true
  }
  return false
}

/** Lazily copies the accepted prefix only after the first source is rejected. */
function retainSource<T>(source: readonly T[], predicate: (value: T) => boolean): readonly T[] {
  let result: T[] | undefined
  for (let index = 0; index < source.length; index++) {
    const value = source[index]
    if (predicate(value)) {
      result?.push(value)
    } else if (result === undefined) {
      result = source.slice(0, index)
    }
  }
  return result ?? source
}

/** Evaluates a single stage without paying the general pipeline's inner dispatch cost. */
function evaluateSingleStage<T>(source: readonly T[], stage: ICollectStage<T>): readonly T[] {
  switch (stage.kind) {
    case CollectorStageKind.field:
      return retainSource(source, (value) => hasDefinedField(value, stage.fields))
    case CollectorStageKind.like:
    case CollectorStageKind.equals:
    case CollectorStageKind.oneOf:
      return retainSource(source, (value) => matchesFieldPredicate(value, stage))
    case CollectorStageKind.where:
      return retainSource(source, stage.predicate)
    case CollectorStageKind.distinctBy:
      stage.seen.clear()
      return retainSource(source, (value) => {
        const key = readObjectPathSegments(value, stage.path)
        if (key === undefined) return true
        if (stage.seen.has(key)) return false
        stage.seen.add(key)
        return true
      })
    case CollectorStageKind.skip:
      return stage.count === 0 ? source : source.slice(Math.min(stage.count, source.length))
    case CollectorStageKind.take:
      return stage.count >= source.length ? source : source.slice(0, stage.count)
  }
}

/** Detects the exact adjacent field/predicate shape that can safely share one path read. */
function isFusedFieldPair<T>(
  stages: readonly ICollectStage<T>[]
): stages is readonly [IFieldStage, IFieldPredicateStage] {
  if (stages.length !== 2 || stages[0].kind !== CollectorStageKind.field) return false
  const predicate = stages[1]
  return (
    (predicate.kind === CollectorStageKind.like ||
      predicate.kind === CollectorStageKind.equals ||
      predicate.kind === CollectorStageKind.oneOf) &&
    predicate.fields === stages[0].fields
  )
}

/** Evaluates an adjacent field/predicate pair while traversing every path at most once. */
function evaluateFusedFieldPair<T>(
  source: readonly T[],
  stage: IFieldPredicateStage
): readonly T[] {
  return retainSource(source, (value) => matchesFusedFieldPredicate(value, stage))
}

/** Resets stateful stages before a fresh revision is evaluated from the original source. */
function resetStatefulStages<T>(stages: readonly ICollectStage<T>[]): void {
  for (const stage of stages) {
    if (stage.kind === CollectorStageKind.distinctBy) stage.seen.clear()
    else if (stage.kind === CollectorStageKind.skip || stage.kind === CollectorStageKind.take)
      stage.remaining = stage.count
  }
}

/** Applies one stage to a source while retaining its ordered pipeline semantics. */
function acceptsStage<T>(source: T, stage: ICollectStage<T>): boolean | 'terminal' {
  switch (stage.kind) {
    case CollectorStageKind.field:
      return hasDefinedField(source, stage.fields)
    case CollectorStageKind.like:
    case CollectorStageKind.equals:
    case CollectorStageKind.oneOf:
      return matchesFieldPredicate(source, stage)
    case CollectorStageKind.where:
      return stage.predicate(source)
    case CollectorStageKind.distinctBy: {
      const key = readObjectPathSegments(source, stage.path)
      if (key === undefined) return true
      if (stage.seen.has(key)) return false
      stage.seen.add(key)
      return true
    }
    case CollectorStageKind.skip:
      if (stage.remaining === 0) return true
      stage.remaining--
      return false
    case CollectorStageKind.take:
      if (stage.remaining === 0) return 'terminal'
      stage.remaining--
      return true
  }
}

/** Executes arbitrary ordered stages in one source pass with copy-on-first-rejection output. */
function evaluateOrderedPipeline<T>(
  source: readonly T[],
  stages: readonly ICollectStage<T>[]
): readonly T[] {
  resetStatefulStages(stages)
  let result: T[] | undefined
  sourceLoop: for (let sourceIndex = 0; sourceIndex < source.length; sourceIndex++) {
    const value = source[sourceIndex]
    for (let stageIndex = 0; stageIndex < stages.length; stageIndex++) {
      const stage = stages[stageIndex]
      const nextStage = stages[stageIndex + 1]
      let accepted: boolean | 'terminal'
      if (
        stage.kind === CollectorStageKind.field &&
        nextStage !== undefined &&
        (nextStage.kind === CollectorStageKind.like ||
          nextStage.kind === CollectorStageKind.equals ||
          nextStage.kind === CollectorStageKind.oneOf) &&
        nextStage.fields === stage.fields
      ) {
        stageIndex++
        accepted = matchesFusedFieldPredicate(value, nextStage)
      } else {
        accepted = acceptsStage(value, stage)
      }
      if (accepted === 'terminal') {
        if (result === undefined) result = source.slice(0, sourceIndex)
        break sourceLoop
      }
      if (!accepted) {
        if (result === undefined) result = source.slice(0, sourceIndex)
        continue sourceLoop
      }
    }
    result?.push(value)
  }
  return result ?? source
}

/** Dispatches stable fixed fast paths without data-size thresholds or adaptive state. */
function evaluate<T>(source: readonly T[], stages: readonly ICollectStage<T>[]): readonly T[] {
  if (stages.length === 0) return source
  if (stages.length === 1) return evaluateSingleStage(source, stages[0])
  if (isFusedFieldPair(stages)) return evaluateFusedFieldPair(source, stages[1])
  return evaluateOrderedPipeline(source, stages)
}

/** Mutable query builder whose materialized result is cached per semantic revision. */
class Collector<T> {
  /** Borrowed immutable source scanned by each uncached revision. */
  readonly #source: readonly T[]
  /** Ordered semantic actions awaiting lazy evaluation. */
  readonly #stages: ICollectStage<T>[] = []
  /** Parsed paths selected by the latest `fieldBy` for following field predicates. */
  #activeFields: readonly IObjectPathTuple[] | undefined
  /** Revision incremented whenever an effective action changes query semantics. */
  #revision = 0
  /** Revision represented by the cached result, or -1 before the first evaluation. */
  #cacheRevision = -1
  /** Last successfully materialized result; failed evaluations never replace it. */
  #cachedResult: readonly T[]
  /** Guards callbacks from mutating or recursively evaluating the same collector. */
  #evaluating = false

  /** Borrows the caller-owned readonly array without copying it. */
  constructor(source: readonly T[]) {
    this.#source = source
    this.#cachedResult = source
  }

  /** Materializes one revision once and returns the same cached reference thereafter. */
  get result(): readonly T[] {
    if (this.#cacheRevision === this.#revision) return this.#cachedResult
    if (this.#evaluating) throw reentrantCollector()
    this.#evaluating = true
    try {
      const result = evaluate(this.#source, this.#stages)
      this.#cachedResult = result
      this.#cacheRevision = this.#revision
      return result
    } finally {
      this.#evaluating = false
    }
  }

  /** Selects, validates, and immediately adds a defined-field filter stage. */
  fieldBy<const P extends readonly [IObjectPathInput<T>, ...IObjectPathInput<T>[]]>(
    ...paths: P
  ): IFieldCollector<T, P[number]> {
    this.#assertMutable()
    if (paths.length === 0) throw invalidType('paths', 'at least one object path')
    const fields = paths.map((path) => parseCollectorPath(path))
    this.#activeFields = fields
    this.#append({ kind: CollectorStageKind.field, fields })
    return this as unknown as IFieldCollector<T, P[number]>
  }

  /** Adds a case-insensitive string predicate over the active field scope. */
  like(query: string): this {
    this.#assertMutable()
    if (typeof query !== 'string') throw invalidType('query', 'a string')
    const fields = this.#requireActiveFields()
    const normalized = query.trim().toLowerCase()
    if (normalized.length === 0) return this
    this.#append({
      kind: CollectorStageKind.like,
      fields,
      query: normalized
    })
    return this
  }

  /** Adds an `Object.is` equality predicate over the active field scope. */
  equals(value: unknown): this {
    this.#assertMutable()
    if (arguments.length === 0) throw invalidType('value', 'an explicit comparison value')
    this.#append({
      kind: CollectorStageKind.equals,
      fields: this.#requireActiveFields(),
      value
    })
    return this
  }

  /** Adds a fixed linear candidate scan over the active field scope. */
  oneOf(value: unknown, ...values: unknown[]): this {
    this.#assertMutable()
    if (arguments.length === 0) throw invalidType('values', 'at least one comparison value')
    this.#append({
      kind: CollectorStageKind.oneOf,
      fields: this.#requireActiveFields(),
      values: [value, ...values]
    })
    return this
  }

  /** Adds a caller predicate without injecting index or collector state. */
  where(predicate: (source: T) => boolean): this {
    this.#assertMutable()
    if (typeof predicate !== 'function') throw invalidType('predicate', 'a function')
    this.#append({ kind: CollectorStageKind.where, predicate })
    return this
  }

  /** Keeps the first source for each defined path value while preserving undefined keys. */
  distinctBy<P extends IObjectPathInput<T>>(path: P): this {
    this.#assertMutable()
    if (arguments.length === 0) throw invalidType('path', 'an object path')
    const parsedPath = parseCollectorPath(path)
    this.#append({ kind: CollectorStageKind.distinctBy, path: parsedPath, seen: new Set() })
    return this
  }

  /** Skips the requested number of sources that reach this ordered stage. */
  skip(count: number): this {
    this.#assertMutable()
    this.#assertCount('count', count)
    this.#append({ kind: CollectorStageKind.skip, count, remaining: count })
    return this
  }

  /** Keeps at most the requested number of sources that reach this ordered stage. */
  take(count: number): this {
    this.#assertMutable()
    this.#assertCount('count', count)
    this.#append({ kind: CollectorStageKind.take, count, remaining: count })
    return this
  }

  /** Rejects state changes while a user callback is participating in evaluation. */
  #assertMutable(): void {
    if (this.#evaluating) throw reentrantCollector()
  }

  /** Returns the active field scope or rejects JavaScript callers that bypass typestate. */
  #requireActiveFields(): readonly IObjectPathTuple[] {
    if (this.#activeFields === undefined)
      throw invalidType('field scope', 'fieldBy must be called first')
    return this.#activeFields
  }

  /** Validates integer window sizes without accepting Infinity or fractions. */
  #assertCount(field: string, count: number): void {
    if (!Number.isSafeInteger(count) || count < 0)
      throw invalidRange(field, 'a non-negative safe integer')
  }

  /** Appends one effective action and invalidates the previous result revision. */
  #append(stage: ICollectStage<T>): void {
    this.#stages.push(stage)
    this.#revision++
  }
}

/** Creates a lazy collector over a borrowed readonly array. */
export function collect<T>(dataSource: readonly T[]): ICollector<T> {
  if (!Array.isArray(dataSource)) throw invalidType('dataSource', 'a readonly array')
  return new Collector(dataSource) as ICollector<T>
}
