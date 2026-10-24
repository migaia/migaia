import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import {
  createSqlTag,
  deriveStorageSqlQuery,
  sqlFragment,
  createTransactionOwner,
  runTransactionOperation,
  type ICompiledStorageSql,
  type ISqlValue,
  type ISqlRunResult,
  type ISqlExecutor,
  type ISqlTag,
  type ISqlFragment,
  type IOperationContext,
  type IStorageBase
} from '../src/index.js'

/** One local native adapter records only prepared input, with no database or alternate owner. */
function setup(dialect: 'sqlite' | 'postgres' = 'sqlite') {
  /** Prepared projections reach the original native callback only after lexical admission. */
  const prepared: ICompiledStorageSql[] = []
  /** Each terminal uses the same real preparation and preserves the declared native row/result. */
  const tag = createSqlTag({
    dialect,
    all: async (prepare) => {
      prepared.push(prepare())
      return [{ value: 1 }]
    },
    get: async (prepare) => {
      prepared.push(prepare())
      return { value: 1 }
    },
    run: async (prepare) => {
      prepared.push(prepare())
      return { changes: 1n }
    }
  })
  return { tag, prepared }
}
/** Supplies an actual frozen template shape for malformed and lexical admission cases. */
function template(text: string): TemplateStringsArray {
  return Object.freeze(Object.assign([text], { raw: Object.freeze([text]) }))
}

describe('shared SQL composition and original execution', () => {
  it('derives terminals over the same authentic fragment without invoking or recompiling its source', async () => {
    const fixture = setup('postgres')
    const input = new Uint8Array([1])
    const original = fixture.tag`SELECT ${input}`
    const promise = Promise.resolve([{ value: 9 }])
    const context = { pageSize: 2 }
    const callbacks = {
      all(this: object, ctx?: IOperationContext) {
        expect(this).toBe(callbacks)
        expect(ctx).toBe(context)
        return promise
      },
      get: async () => ({ value: 9 }),
      run: async () => ({ changes: 9 })
    }
    const derived = deriveStorageSqlQuery(original, callbacks)
    input.fill(99)

    expect(derived.all(context)).toBe(promise)
    expect(fixture.prepared).toEqual([])
    await fixture.tag`${derived}`.run()
    expect(fixture.prepared).toEqual([{ text: 'SELECT $1', values: [new Uint8Array([1])] }])
    expect(() => deriveStorageSqlQuery({} as ISqlFragment, callbacks)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
  })

  it('binds values, escapes identifier segments and shares pure and bound fragment identity', async () => {
    const fixture = setup()
    const source = new Uint8Array([1, 2])
    const child = sqlFragment`x = ${'a; COMMIT'} AND data = ${source}`
    const joined = sqlFragment.join([child, child], sqlFragment` OR `)
    const query = fixture.tag`SELECT ${sqlFragment.id('a"b', 'column')} FROM ${sqlFragment.id('table')} WHERE ${joined} AND n = ${7n} AND flag = ${true}`
    source.fill(99)
    expect(fixture.prepared).toEqual([])

    expect('all' in child).toBe(false)
    expect('get' in child).toBe(false)
    expect('run' in child).toBe(false)

    await query.all()
    expect(fixture.prepared[0]!.text).toBe(
      'SELECT "a""b"."column" FROM "table" WHERE x = ? AND data = ? OR x = ? AND data = ? AND n = ? AND flag = ?'
    )
    expect(fixture.prepared[0]!.values).toEqual([
      'a; COMMIT',
      new Uint8Array([1, 2]),
      'a; COMMIT',
      new Uint8Array([1, 2]),
      7n,
      true
    ])
    expect(fixture.prepared[0]!.values[1]).not.toBe(fixture.prepared[0]!.values[3])
    ;(fixture.prepared[0]!.values[1] as Uint8Array).fill(77)
    await query.get()
    expect(fixture.prepared[1]!.values[1]).toEqual(new Uint8Array([1, 2]))

    const nested = fixture.tag`SELECT 1 WHERE EXISTS (${query})`
    await nested.run()
    expect(fixture.prepared[2]!.values).toEqual(fixture.prepared[1]!.values)
  })

  it('retains deep immutable branches and repeated occurrences with contiguous PostgreSQL bindings', async () => {
    const fixture = setup('postgres')
    let chain = sqlFragment`SELECT ${0}`
    for (let index = 1; index < 2000; index++) chain = sqlFragment`${chain}, ${index}`
    const left = fixture.tag`${chain}, ${'left'}`
    const right = fixture.tag`${chain}, ${'right'}`
    await left.run()
    await right.run()
    expect(fixture.prepared[0]!.text).toContain('$2000, $2001')
    expect(fixture.prepared[0]!.values).toEqual([
      ...Array.from({ length: 2000 }, (_, index) => index),
      'left'
    ])
    expect(fixture.prepared[1]!.values.at(-1)).toBe('right')
    const repeated = fixture.tag`SELECT ${sqlFragment.join([sqlFragment`${2}`, sqlFragment`${3}`, sqlFragment`${2}`])}${sqlFragment.empty}`
    await repeated.run()
    expect(fixture.prepared[2]).toEqual({ text: 'SELECT $1, $2, $3', values: [2, 3, 2] })
    expect(sqlFragment.join([])).toBe(sqlFragment.empty)
  })

  it('preserves original native receiver, context and Promise identity', async () => {
    const native = Promise.resolve([{ native: true }])
    const context: IOperationContext = { pageSize: 2 }
    const order: string[] = []
    const options = {
      dialect: 'postgres' as const,
      all(prepare: () => ICompiledStorageSql, ctx?: IOperationContext) {
        expect(this).toBe(options)
        expect(ctx).toBe(context)
        order.push('admitted')
        expect(prepare()).toEqual({ text: 'SELECT $1', values: [1] })
        order.push('native')
        return native
      },
      get: async () => undefined,
      run: async () => ({ changes: 0 })
    }
    const query = createSqlTag(options)`SELECT ${1}`
    expect(order).toEqual([])
    expect(query.all(context)).toBe(native)
    expect(order).toEqual(['admitted', 'native'])
  })

  it('rejects invalid templates, values, fragments and identifiers during construction without execution', () => {
    const fixture = setup()
    for (const value of [undefined, {}, new Date(), () => 1, Symbol('bad')])
      expect(() => fixture.tag`SELECT ${value as ISqlValue}`).toThrowError(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' })
      )
    expect(() => fixture.tag(['SELECT 1'] as unknown as TemplateStringsArray)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    expect(() =>
      fixture.tag(Object.freeze(['SELECT 1']) as unknown as TemplateStringsArray)
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    expect(() => sqlFragment.join([{} as ISqlFragment])).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    expect(() => sqlFragment.id('')).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    expect(fixture.prepared).toEqual([])
  })

  it.each([
    `SELECT ';', 'it''s;fine', "semi;colon", \`semi;colon\`, [semi;colon]; -- trailing`,
    `/* leading */ SELECT 1 /* ; BEGIN */; /* tail */`,
    `PRAGMA journal_mode;`,
    `PRAGMA 'journal_mode';`,
    `PRAGMA 'main'.'journal_mode';`,
    `EXPLAIN QUERY PLAN PRAGMA "main"."journal_mode"`,
    `SELECT "BEGIN", 'COMMIT'`
  ])('accepts SQLite quote/comment boundaries %s', async (text) => {
    const fixture = setup()
    await fixture.tag(template(text)).run()
    expect(fixture.prepared[0]!.text).toBe(text)
  })

  it.each(['BEGIN', 'COMMIT', 'END', 'ROLLBACK', 'SAVEPOINT', 'RELEASE'])(
    'rejects native transaction control %s at every execution terminal',
    async (command) => {
      const fixture = setup()
      const query = fixture.tag(template(` /* prefix */ ${command.toLowerCase()}`))
      for (const execute of [() => query.all(), () => query.get(), () => query.run()])
        await expect(execute()).rejects.toMatchObject({
          source: '@migaia/storage-contract',
          code: 'INVALID_ARGUMENT'
        })
      expect(fixture.prepared).toEqual([])
    }
  )

  it.each([
    '',
    ' -- comments only',
    'SELECT 1; SELECT 2',
    'SELECT 1;;',
    "SELECT 'unclosed",
    'SELECT "unclosed',
    'SELECT 1 /* unclosed',
    'CREATE TRIGGER t AFTER INSERT ON x BEGIN SELECT 1; SELECT 2; END',
    'PRAGMA journal_mode=WAL',
    `PRAGMA 'journal_mode'=OFF`,
    `PRAGMA 'main'.'journal_mode'(OFF)`,
    `PRAGMA main.'journal_mode'=OFF`,
    `EXPLAIN PRAGMA 'journal_mode'=OFF`,
    `EXPLAIN QUERY PLAN PRAGMA 'main'.'journal_mode'(OFF)`,
    'PRAGMA journal_mode(WAL)',
    'PRAGMA main.journal_mode = WAL',
    'PRAGMA [main].[journal_mode](WAL)',
    'PRAGMA "main"."journal_mode"=WAL',
    'EXPLAIN PRAGMA journal_mode(WAL)',
    'EXPLAIN QUERY PLAN PRAGMA "main"."journal_mode" /* gap */ = WAL',
    'EXPLAIN /* gap */ COMMIT'
  ])(
    'rejects disallowed SQLite text after admission before native preparation %s',
    async (text) => {
      const fixture = setup()
      const query = fixture.tag(template(text))
      expect(fixture.prepared).toEqual([])
      await expect(query.run()).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
      expect(fixture.prepared).toEqual([])
    }
  )

  it.each([
    `SELECT $tag$semi; '/* literal */$tag$, $$semi;quote'$$; /* trailing */`,
    String.raw`SELECT E'escaped\';still string', 'standard\', "semi;identifier"`,
    `/* outer /* nested */ outer */ SELECT ${1}; -- done`
  ])(
    'accepts PostgreSQL quoting without mistaking literal semicolons for commands %s',
    async (text) => {
      const fixture = setup('postgres')
      await fixture.tag(template(text)).run()
      expect(fixture.prepared[0]!.text).toBe(text)
    }
  )

  it.each([
    'ABORT',
    'START TRANSACTION',
    "PREPARE TRANSACTION 'detached'",
    'SET TRANSACTION READ ONLY',
    'SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY'
  ])('rejects PostgreSQL transaction ownership aliases %s', async (text) => {
    const fixture = setup('postgres')
    await expect(fixture.tag(template(text)).run()).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT'
    })
    expect(fixture.prepared).toEqual([])
  })

  it('does not reserve ordinary PostgreSQL PREPARE or unrelated SET statements', async () => {
    const fixture = setup('postgres')
    await fixture.tag`PREPARE lookup AS SELECT 1`.run()
    await fixture.tag`SET application_name = 'reader'`.run()
    expect(fixture.prepared).toHaveLength(2)
  })

  it('preserves precise native row/result domains while pure fragments expose no terminal', () => {
    type ISqliteValue = Exclude<ISqlValue, boolean>
    type ISqliteResult = ISqlRunResult & { readonly lastInsertRowid: bigint }
    const tag = createSqlTag<ISqliteValue, ISqliteResult>({
      dialect: 'sqlite',
      all: async () => [],
      get: async () => undefined,
      run: async () => ({ changes: 1, lastInsertRowid: 9n })
    })
    type IRow = { readonly id: number; readonly name?: string }
    const query = tag<IRow>`SELECT id,name FROM users WHERE active=${true}`
    expectTypeOf<ReturnType<typeof query.all>>().toEqualTypeOf<Promise<readonly IRow[]>>()
    expectTypeOf<ReturnType<typeof query.get>>().toEqualTypeOf<Promise<IRow | undefined>>()
    expectTypeOf<Awaited<ReturnType<typeof query.run>>['lastInsertRowid']>().toEqualTypeOf<bigint>()
    expectTypeOf(tag).toMatchTypeOf<ISqlTag<ISqliteValue, ISqliteResult>>()
    expectTypeOf({ sql: tag }).toMatchTypeOf<ISqlExecutor>()
    /** Compile-only invalid row declarations never execute unsupported operations. */
    function invalidRows() {
      // @ts-expect-error SQLite rows retain their native non-boolean output domain.
      void tag<{ active: boolean }>`SELECT 1`
      // @ts-expect-error Date is not a shared native SQL column.
      void tag<{ date: Date }>`SELECT 1`
      // @ts-expect-error Scalar rows cannot represent SQL column objects.
      void tag<number>`SELECT 1`
      // @ts-expect-error Pure fragments never obtain execution authority.
      sqlFragment`SELECT 1`.all()
      // @ts-expect-error Shared run results do not promise a backend-specific insertion id.
      setup('postgres').tag`SELECT 1`.run().then((result) => result.lastInsertRowid)
    }
    void invalidRows
  })

  it('registers scanner failure with the original transaction owner and rejects saved queries after close', async () => {
    /** Only the backend supplies a real resource and its original transaction normalization. */
    const base: IStorageBase = {
      backend: 'sql-fixture',
      capabilities: {
        syncRead: false,
        binary: false,
        records: false,
        transactions: true,
        iteration: false,
        secondaryIndexes: false,
        changeFeed: false,
        opaqueEntries: false,
        maxValueBytes: undefined
      },
      dispose: async () => undefined,
      [Symbol.asyncDispose]: async () => undefined
    }
    const onFailure = vi.fn()
    const native = vi.fn()
    const normalize = (
      error: unknown
    ): Error & { readonly source: string; readonly code: string } =>
      error instanceof Error && 'source' in error && 'code' in error
        ? (error as Error & { readonly source: string; readonly code: string })
        : Object.assign(new Error('fixture failed', { cause: error }), {
            source: 'sql-fixture',
            code: 'TRANSACTION_FAILED'
          })
    const owner = createTransactionOwner<unknown, ISqlExecutor>(base, normalize)
    const createScope = (): ISqlExecutor => {
      const scope: ISqlExecutor = {
        sql: createSqlTag({
          dialect: 'sqlite',
          all: (prepare) =>
            runTransactionOperation(scope, () => {
              prepare()
              native()
              return []
            }),
          get: (prepare) =>
            runTransactionOperation(scope, () => {
              prepare()
              native()
              return undefined
            }),
          run: (prepare) =>
            runTransactionOperation(scope, () => {
              prepare()
              native()
              return { changes: 0 }
            })
        })
      }
      return scope
    }
    const scope = createScope()
    const controller = owner.register(scope, { createScope, onFailure })
    const query = scope.sql`COMMIT`
    const failed = query.run()
    const original = await failed.catch((error: unknown) => error)
    expect(original).toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(onFailure).toHaveBeenCalledWith(original)
    controller.stopAdmission()
    await expect(controller.runFinalizers()).rejects.toBe(original)
    expect(native).not.toHaveBeenCalled()
    controller.close()
    await expect(query.run()).rejects.toMatchObject({ code: 'TRANSACTION_FAILED' })
  })
})
