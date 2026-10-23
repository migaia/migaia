import { captureStorageTemplatePieces } from './template.js'
import type { StorageStageKind } from './stage-kind.js'
import type { ITransactionScope } from './transaction.js'
import type { IOperationContext } from './context.js'
import { isUint8Array } from '@migaia/utils/bytes'
import { StorageContractError, StorageContractErrorCode } from './errors.js'
import { StorageContractErrorText } from './error-text.js'
/** SQL observations bind to the original transaction owner and never execute statements. */
export type ISqlStageObserver = Readonly<{
  readonly kind: typeof StorageStageKind.sql
  forTransaction: (scope: Omit<ITransactionScope, 'use'>) => ISqlStageObserver
  beforeSql?: (parameterCount: number, sqlBytes: number) => void | PromiseLike<void>
  afterSql?: (elapsedMs: number, rows: number | bigint) => void | PromiseLike<void>
  onSqlError?: (code?: string) => void | PromiseLike<void>
  report: (error: unknown) => undefined
}>

/** Fragment identity is type-opaque; only the private node table grants runtime authenticity. */
declare const sqlFragmentBrand: unique symbol
/** Shared native SQL values retain booleans and bigint without promising backend-specific columns. */
export type ISqlValue = null | string | number | bigint | boolean | Uint8Array
/** Dynamic default rows share only the declared native scalar domain. */
export type ISqlRow = Readonly<Record<string, ISqlValue>>
/** Shared execution reports changes; insertion identity remains a backend-specific refinement. */
export type ISqlRunResult = { readonly changes: number | bigint }
/** Pure immutable SQL composition owns no connection or execution terminal. */
export type ISqlFragment = { readonly [sqlFragmentBrand]: true }
/** Every interpolation is either a native bound scalar or an authentic existing fragment. */
export type ISqlInput = ISqlValue | ISqlFragment
/** A bound query retains fragment identity while its original backend owns actual execution. */
export type ISqlQuery<
  TRow extends object & { readonly [K in keyof TRow]: ISqlValue } = ISqlRow,
  TResult extends ISqlRunResult = ISqlRunResult
> = ISqlFragment & {
  all(ctx?: IOperationContext): Promise<readonly TRow[]>
  get(ctx?: IOperationContext): Promise<TRow | undefined>
  run(ctx?: IOperationContext): Promise<TResult>
}
/** Row and result parameters preserve each backend's native domain without erasing shared inputs. */
export type ISqlTag<
  TValue extends ISqlValue = ISqlValue,
  TResult extends ISqlRunResult = ISqlRunResult
> = {
  <TRow extends object & { readonly [K in keyof TRow]: TValue } = Readonly<Record<string, TValue>>>(
    strings: TemplateStringsArray,
    ...values: readonly ISqlInput[]
  ): ISqlQuery<TRow, TResult>
  id(...parts: readonly [string, ...string[]]): ISqlFragment
  join(fragments: readonly ISqlFragment[], separator?: ISqlFragment): ISqlFragment
  readonly empty: ISqlFragment
}
/** An execution-local pure projection contains no connection, cursor or disposal authority. */
export type ICompiledStorageSql = {
  readonly text: string
  readonly values: readonly ISqlValue[]
}
/** The only common executor shape; drivers, connections and cleanup remain with backend owners. */
export type ISqlExecutor<
  TValue extends ISqlValue = ISqlValue,
  TResult extends ISqlRunResult = ISqlRunResult
> = { readonly sql: ISqlTag<TValue, TResult> }
/** Stable native SQL endpoints are shared by finite transaction projections and their owner. */
export const SqlQueryMethod = { all: 'all', get: 'get', run: 'run' } as const
/** Read-only terminal replacement keeps the exact original fragment node and native result shape. */
export type IStorageSqlQueryTerminals<TRow extends object, TResult extends ISqlRunResult> = {
  all(ctx?: IOperationContext): Promise<readonly TRow[]>
  get(ctx?: IOperationContext): Promise<TRow | undefined>
  run(ctx?: IOperationContext): Promise<TResult>
}
/** Private node tags distinguish immutable composition references from copied bound values. */
const SqlNodeKind = { sequence: 'sequence', binding: 'binding' } as const
/** A node stores only new input and references; it never expands an accumulated SQL prefix. */
type ISqlNode = {
  readonly kind: typeof SqlNodeKind.sequence
  readonly pieces: readonly ISqlPiece[]
}
/** Static text and real shared nodes retain native insertion order. */
type ISqlPiece =
  | string
  | ISqlNode
  | { readonly kind: typeof SqlNodeKind.binding; readonly value: ISqlValue }
/** One weak identity table owns all fragments without a global strong text or driver cache. */
const sqlNodes = new WeakMap<object, ISqlNode>()

/** Registered input errors retain the exact native reflection or byte-copy cause. */
function invalidSqlArgument(cause?: unknown): StorageContractError {
  return new StorageContractError(
    StorageContractErrorCode.invalidArgument,
    { cause },
    StorageContractErrorText.sqlArgument
  )
}
/** Creates one frozen identity over an immutable node graph, with no execution authority. */
function registerSqlFragment(pieces: readonly ISqlPiece[]): ISqlFragment {
  /** Public objects contain no forgeable node, parameter or driver fields. */
  const fragment = Object.freeze({}) as ISqlFragment
  sqlNodes.set(
    fragment,
    Object.freeze({ kind: SqlNodeKind.sequence, pieces: Object.freeze(pieces) })
  )
  return fragment
}
/** Empty composition has one canonical frozen identity and contributes no separators. */
const emptySqlFragment = registerSqlFragment([])
/** IN-style SQL lists use a comma and space unless the caller supplies another authentic fragment. */
const sqlJoinSeparator = registerSqlFragment([', '])

/** Validates private fragment identity without trusting a public brand or shape. */
function sqlNode(fragment: unknown): ISqlNode {
  /** Primitive and forged objects never become SQL text. */
  const node =
    typeof fragment === 'object' && fragment !== null ? sqlNodes.get(fragment) : undefined
  if (node === undefined) throw invalidSqlArgument()
  return node
}
/** Captures a native scalar once; byte views are copied before a caller can mutate the source. */
function sqlInputPiece(value: unknown): ISqlPiece {
  if (typeof value === 'object' && value !== null && sqlNodes.has(value))
    return sqlNodes.get(value)!
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean'
  )
    return Object.freeze({ kind: SqlNodeKind.binding, value })
  if (isUint8Array(value))
    return Object.freeze({ kind: SqlNodeKind.binding, value: new Uint8Array(value) })
  throw invalidSqlArgument()
}
/** Captures frozen template arrays and their inserted values without expanding child fragments. */
function sqlFragmentTag(
  strings: TemplateStringsArray,
  ...values: readonly ISqlInput[]
): ISqlFragment {
  /** The shared template owner retains the original field order and per-value SQL capture. */
  const pieces = captureStorageTemplatePieces(strings, values, sqlInputPiece, invalidSqlArgument)
  return pieces.length === 1 && pieces[0] === '' ? emptySqlFragment : registerSqlFragment(pieces)
}
/** Quotes every identifier component independently; values cannot become identifiers accidentally. */
function sqlIdentifier(...parts: readonly [string, ...string[]]): ISqlFragment {
  if (parts.length === 0 || parts.some((part) => typeof part !== 'string' || part.length === 0))
    throw invalidSqlArgument()
  return registerSqlFragment([parts.map((part) => `"${part.replaceAll('"', '""')}"`).join('.')])
}
/** Stores child references in output order; no subtree or parameter prefix is copied. */
function joinSqlFragments(
  fragments: readonly ISqlFragment[],
  separator: ISqlFragment = sqlJoinSeparator
): ISqlFragment {
  try {
    if (!Array.isArray(fragments)) throw invalidSqlArgument()
    /** The separator is authentic even for an empty input, retaining normal argument admission. */
    const between = sqlNode(separator)
    /** The caller's dense list length is captured once before each position is captured once. */
    const length = fragments.length
    /** Nodes retain repeated references at every occurrence rather than deduplicating identities. */
    const pieces: ISqlPiece[] = []
    for (let index = 0; index < length; index++) {
      if (!Object.hasOwn(fragments, index)) throw invalidSqlArgument()
      /** This one child read cannot be changed by a later mutation of the caller's list. */
      const node = sqlNode(fragments[index])
      if (index > 0) pieces.push(between)
      pieces.push(node)
    }
    return length === 0 ? emptySqlFragment : registerSqlFragment(pieces)
  } catch (cause) {
    if (cause instanceof StorageContractError) throw cause
    throw invalidSqlArgument(cause)
  }
}
/**
 * Pure tagged SQL construction. It captures scalar/byte bindings, authentic child references and
 * quoted identifiers without opening a connection, scanning a partial statement or adding
 * all/get/run.
 */
export const sqlFragment: Pick<ISqlTag, 'id' | 'join' | 'empty'> & {
  (strings: TemplateStringsArray, ...values: readonly ISqlInput[]): ISqlFragment
} = Object.freeze(
  Object.assign(sqlFragmentTag, {
    id: sqlIdentifier,
    join: joinSqlFragments,
    empty: emptySqlFragment
  })
)

/** Dialect values affect placeholders and lexical quoting, never native connection selection. */
const SqlDialect = { sqlite: 'sqlite', postgres: 'postgres' } as const
/** Only the initial command and optional EXPLAIN/schema prefix participate in ownership guards. */
const SqlWord = {
  explain: 'EXPLAIN',
  query: 'QUERY',
  plan: 'PLAN',
  pragma: 'PRAGMA',
  journalMode: 'JOURNAL_MODE',
  begin: 'BEGIN',
  commit: 'COMMIT',
  end: 'END',
  rollback: 'ROLLBACK',
  savepoint: 'SAVEPOINT',
  release: 'RELEASE',
  abort: 'ABORT',
  start: 'START',
  transaction: 'TRANSACTION',
  prepare: 'PREPARE',
  set: 'SET',
  session: 'SESSION',
  characteristics: 'CHARACTERISTICS',
  as: 'AS'
} as const
/** Eight tokens cover EXPLAIN QUERY PLAN PRAGMA schema . journal_mode and its assignment opener. */
const SQL_PREFIX_TOKENS = 8
/** The lexical guard retains only the bounded command prefix, never a parsed SQL execution plan. */
type ISqlToken = { readonly text: string; readonly word: boolean; readonly pragmaName: boolean }
/** Explicit traversal frames retain one child position per depth rather than copying old prefixes. */
type ISqlFrame = { readonly node: ISqlNode; index: number }

/** Malformed statement text is rejected inside the backend's original operation admission. */
function invalidSqlStatement(): StorageContractError {
  return new StorageContractError(
    StorageContractErrorCode.invalidArgument,
    {},
    StorageContractErrorText.sqlStatement
  )
}
/** SQL identifiers include non-ASCII code units; delimiter handling stays independent of locale. */
function isSqlIdentifierStart(character: string | undefined): boolean {
  return character !== undefined && (/[A-Za-z_]/.test(character) || character.charCodeAt(0) >= 128)
}
/** Native unquoted identifiers additionally accept decimal digits and dollar characters. */
function isSqlIdentifierPart(character: string | undefined): boolean {
  return character !== undefined && (isSqlIdentifierStart(character) || /[0-9$]/.test(character))
}
/**
 * Scans one complete statement, respecting dialect quotes/comments before applying the fixed
 * transaction/journal ownership guards. This never parses or optimizes the SQL execution plan.
 */
function assertSingleSqlStatement(text: string, dialect: 'sqlite' | 'postgres'): void {
  /** Only a fixed prefix is retained while every source code unit is consumed once. */
  const prefix: ISqlToken[] = []
  /** A trailing separator is allowed only after actual statement content. */
  let terminated = false
  /** Comments and whitespace alone do not constitute a SQL statement. */
  let hasContent = false
  /** The cursor advances monotonically, including nested PostgreSQL block comments. */
  let index = 0
  /** Prefix admission is bounded independently of statement size. */
  const token = (value: ISqlToken): void => {
    if (terminated) throw invalidSqlStatement()
    hasContent = true
    if (prefix.length < SQL_PREFIX_TOKENS) prefix.push(value)
  }
  while (index < text.length) {
    /** The current scalar syntax character belongs to this one lexer iteration. */
    const character = text[index]!
    if (/\s/.test(character)) {
      index++
      continue
    }
    if (character === '-' && text[index + 1] === '-') {
      index += 2
      while (index < text.length && text[index] !== '\n' && text[index] !== '\r') index++
      continue
    }
    if (character === '/' && text[index + 1] === '*') {
      index += 2
      /** SQLite ends at the first closer; PostgreSQL tracks genuine nested block comments. */
      let depth = 1
      while (index < text.length && depth > 0) {
        if (dialect === SqlDialect.postgres && text[index] === '/' && text[index + 1] === '*') {
          depth++
          index += 2
        } else if (text[index] === '*' && text[index + 1] === '/') {
          depth--
          index += 2
        } else index++
      }
      if (depth !== 0) throw invalidSqlStatement()
      continue
    }
    if (character === ';') {
      if (!hasContent || terminated) throw invalidSqlStatement()
      terminated = true
      index++
      continue
    }
    if (
      character === "'" ||
      character === '"' ||
      (dialect === SqlDialect.sqlite && (character === '`' || character === '['))
    ) {
      /**
       * Quoted pragma names, including SQLite single-quoted names, are decoded for the ownership
       * guard.
       */
      const identifier = character !== "'"
      /** Square-bracket quoting has a distinct terminator and no doubled-close escape in SQLite. */
      const closer = character === '[' ? ']' : character
      /** PostgreSQL E strings, unlike standard strings or identifiers, consume backslash escapes. */
      const escapes =
        dialect === SqlDialect.postgres &&
        character === "'" &&
        (text[index - 1] === 'E' || text[index - 1] === 'e') &&
        !isSqlIdentifierPart(text[index - 2])
      /** Identifier parts join once; arbitrary string contents need no retained copy. */
      const parts: string[] = []
      /** A closing delimiter must actually be observed, including at the final source position. */
      let closed = false
      index++
      while (index < text.length) {
        if (escapes && text[index] === '\\') {
          index += 2
          continue
        }
        if (text[index] === closer) {
          if (character !== '[' && text[index + 1] === closer) {
            if (identifier || dialect === SqlDialect.sqlite) parts.push(closer)
            index += 2
            continue
          }
          index++
          closed = true
          break
        }
        if (identifier || dialect === SqlDialect.sqlite) parts.push(text[index]!)
        index++
      }
      if (!closed) throw invalidSqlStatement()
      token({
        text: parts.join(''),
        word: false,
        pragmaName: identifier || dialect === SqlDialect.sqlite
      })
      continue
    }
    if (dialect === SqlDialect.postgres && character === '$') {
      /** A dollar quote tag follows the native identifier domain without dollar in the tag itself. */
      let end = index + 1
      if (isSqlIdentifierStart(text[end])) {
        end++
        while (isSqlIdentifierPart(text[end]) && text[end] !== '$') end++
      }
      if (text[end] === '$') {
        /** Native substring search locates one exact delimiter; its body is never tokenized as SQL. */
        const delimiter = text.slice(index, end + 1)
        /** No closing delimiter means an incomplete statement, rather than a hidden second command. */
        const close = text.indexOf(delimiter, end + 1)
        if (close < 0) throw invalidSqlStatement()
        index = close + delimiter.length
        token({ text: '', word: false, pragmaName: false })
        continue
      }
    }
    if (isSqlIdentifierStart(character)) {
      /** Each unquoted token is consumed as one unit; command matching uses ASCII keywords only. */
      const start = index++
      while (isSqlIdentifierPart(text[index])) index++
      token({ text: text.slice(start, index), word: true, pragmaName: true })
      continue
    }
    token({ text: character, word: false, pragmaName: false })
    index++
  }
  if (!hasContent) throw invalidSqlStatement()
  /** Optional explain prefixes cannot disguise transaction control or journal mutation. */
  let command = 0
  if (prefix[command]?.word && prefix[command]!.text.toUpperCase() === SqlWord.explain) {
    command++
    if (
      prefix[command]?.word &&
      prefix[command]!.text.toUpperCase() === SqlWord.query &&
      prefix[command + 1]?.word &&
      prefix[command + 1]!.text.toUpperCase() === SqlWord.plan
    )
      command += 2
  }
  /** Only unquoted leading keywords are commands; quoted lookalikes stay native SQL operands. */
  const first = prefix[command]
  if (first?.word) {
    /** The original transaction owner exclusively issues these native control statements. */
    const word = first.text.toUpperCase()
    if (
      word === SqlWord.begin ||
      word === SqlWord.commit ||
      word === SqlWord.end ||
      word === SqlWord.rollback ||
      word === SqlWord.savepoint ||
      word === SqlWord.release
    )
      throw invalidSqlStatement()
    if (dialect === SqlDialect.postgres) {
      /** Only actual unquoted transaction prefixes are reserved; ordinary PREPARE/SET stay valid. */
      const wordAt = (offset: number, expected: string): boolean =>
        prefix[command + offset]?.word === true &&
        prefix[command + offset]!.text.toUpperCase() === expected
      if (
        word === SqlWord.abort ||
        ((word === SqlWord.start || word === SqlWord.prepare) && wordAt(1, SqlWord.transaction)) ||
        (word === SqlWord.set &&
          (wordAt(1, SqlWord.transaction) ||
            (wordAt(1, SqlWord.session) &&
              wordAt(2, SqlWord.characteristics) &&
              wordAt(3, SqlWord.as) &&
              wordAt(4, SqlWord.transaction))))
      )
        throw invalidSqlStatement()
    }
    if (dialect === SqlDialect.sqlite && word === SqlWord.pragma) {
      /** Native pragma names optionally have one quoted or unquoted schema qualifier. */
      let name = command + 1
      if (prefix[name]?.pragmaName && prefix[name + 1]?.text === '.') name += 2
      if (
        prefix[name]?.pragmaName &&
        prefix[name]!.text.toUpperCase() === SqlWord.journalMode &&
        (prefix[name + 1]?.text === '=' || prefix[name + 1]?.text === '(')
      )
        throw invalidSqlStatement()
    }
  }
}
/** Performs one explicit-stack flatten and contiguous dialect binding sequence for a real query. */
function compileSqlNode(node: ISqlNode, dialect: 'sqlite' | 'postgres'): ICompiledStorageSql {
  /** Static chunks are joined once, so chained fragments never repeatedly copy their prefixes. */
  const text: string[] = []
  /** Each actual occurrence retains its own parameter position, including repeated child nodes. */
  const values: ISqlValue[] = []
  /** Frames grow with composition depth instead of the JavaScript call stack. */
  const frames: ISqlFrame[] = [{ node, index: 0 }]
  while (frames.length > 0) {
    /** The current frame is retained until every piece has been emitted exactly once. */
    const frame = frames[frames.length - 1]!
    if (frame.index === frame.node.pieces.length) {
      frames.pop()
      continue
    }
    /** Child references are traversed at every occurrence, never deduplicated. */
    const piece = frame.node.pieces[frame.index++]!
    if (typeof piece === 'string') text.push(piece)
    else if (piece.kind === SqlNodeKind.sequence) frames.push({ node: piece, index: 0 })
    else {
      values.push(piece.value)
      text.push(dialect === SqlDialect.sqlite ? '?' : `$${values.length}`)
    }
  }
  /** The first complete rendered text is scanned only after its backend's original admission. */
  const rendered = text.join('')
  assertSingleSqlStatement(rendered, dialect)
  return Object.freeze({ text: rendered, values: Object.freeze(values) })
}
/**
 * Binds shared composition to original backend terminals. Each callback must enter its original
 * operation/transaction owner before calling prepare; its exact Promise is returned unchanged. No
 * connection, driver cache, lease, cancellation timer or disposal owner is created here.
 */
export function createSqlTag<
  TValue extends ISqlValue = ISqlValue,
  TResult extends ISqlRunResult = ISqlRunResult
>(options: {
  readonly dialect: 'sqlite' | 'postgres'
  readonly all: (
    prepare: () => ICompiledStorageSql,
    ctx?: IOperationContext
  ) => Promise<readonly Readonly<Record<string, TValue>>[]>
  readonly get: (
    prepare: () => ICompiledStorageSql,
    ctx?: IOperationContext
  ) => Promise<Readonly<Record<string, TValue>> | undefined>
  readonly run: (prepare: () => ICompiledStorageSql, ctx?: IOperationContext) => Promise<TResult>
}): ISqlTag<TValue, TResult> {
  /** Capture the backend's descriptor only once; query calls do not re-read borrowed getters. */
  let captured: typeof options
  try {
    if (typeof options !== 'object' || options === null || Array.isArray(options))
      throw invalidSqlArgument()
    captured = { dialect: options.dialect, all: options.all, get: options.get, run: options.run }
    if (
      (captured.dialect !== SqlDialect.sqlite && captured.dialect !== SqlDialect.postgres) ||
      typeof captured.all !== 'function' ||
      typeof captured.get !== 'function' ||
      typeof captured.run !== 'function'
    )
      throw invalidSqlArgument()
  } catch (cause) {
    if (cause instanceof StorageContractError) throw cause
    throw invalidSqlArgument(cause)
  }
  /** One bound identity belongs to one immutable node and one closure-local compiled projection. */
  const tag = <
    TRow extends object & { readonly [K in keyof TRow]: TValue } = Readonly<Record<string, TValue>>
  >(
    strings: TemplateStringsArray,
    ...values: readonly ISqlInput[]
  ): ISqlQuery<TRow, TResult> => {
    /** The same fragment registry admits pure and executable nodes; no parallel brand is accepted. */
    const node = sqlNode(sqlFragmentTag(strings, ...values))
    /** The cache is scoped only to this query's lifetime and never retains native statements. */
    let compiled: ICompiledStorageSql | undefined
    /** Each native execution receives fresh mutable byte copies, independent of prior execution. */
    const prepare = (): ICompiledStorageSql => {
      compiled ??= compileSqlNode(node, captured.dialect)
      return Object.freeze({
        text: compiled.text,
        values: Object.freeze(
          compiled.values.map((value) => (isUint8Array(value) ? new Uint8Array(value) : value))
        )
      })
    }
    /** Wrappers only select an original callback and preserve its receiver, context and Promise. */
    const query: ISqlQuery<TRow, TResult> = {
      all: (ctx) =>
        Reflect.apply(captured.all, options, [prepare, ctx]) as Promise<readonly TRow[]>,
      get: (ctx) =>
        Reflect.apply(captured.get, options, [prepare, ctx]) as Promise<TRow | undefined>,
      run: (ctx) => Reflect.apply(captured.run, options, [prepare, ctx])
    } as ISqlQuery<TRow, TResult>
    sqlNodes.set(query, node)
    return Object.freeze(query)
  }
  return Object.freeze(
    Object.assign(tag, { id: sqlIdentifier, join: joinSqlFragments, empty: emptySqlFragment })
  )
}

/**
 * Derives only execution endpoints over an authentic existing fragment node. The original SQL
 * identity table, scanner and backend preparation remain canonical; no driver or scope is created.
 */
export function deriveStorageSqlQuery<
  TRow extends object & { readonly [K in keyof TRow]: ISqlValue } = ISqlRow,
  TResult extends ISqlRunResult = ISqlRunResult
>(
  fragment: ISqlFragment,
  terminals: IStorageSqlQueryTerminals<TRow, TResult>
): ISqlQuery<TRow, TResult> {
  /** Authentication retains the original node graph rather than expanding or compiling it. */
  const node = sqlNode(fragment)
  try {
    /** Borrowed terminal getters are captured once, before publication of the derived identity. */
    const all = terminals.all
    /** The original caller continues to own its native callbacks and their Promise results. */
    const get = terminals.get
    /** Write execution is delegated through that same captured native endpoint. */
    const run = terminals.run
    if (typeof all !== 'function' || typeof get !== 'function' || typeof run !== 'function')
      throw invalidSqlArgument()
    /** The original receiver, context and Promise are forwarded without async assimilation. */
    const query = {
      all: (ctx?: IOperationContext) => Reflect.apply(all, terminals, [ctx]),
      get: (ctx?: IOperationContext) => Reflect.apply(get, terminals, [ctx]),
      run: (ctx?: IOperationContext) => Reflect.apply(run, terminals, [ctx])
    } as ISqlQuery<TRow, TResult>
    sqlNodes.set(query, node)
    return Object.freeze(query)
  } catch (cause) {
    if (cause instanceof StorageContractError) throw cause
    throw invalidSqlArgument(cause)
  }
}
