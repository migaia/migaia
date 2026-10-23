import { asyncDisposeKey } from '@migaia/plugin-host'
import { describe, expect, it, vi } from 'vitest'
import { deferred, type IAbortSignal } from '@migaia/utils/promise'
import {
  createTransactionOwner,
  defineConcurrencyPolicy,
  ConcurrencyPolicy,
  lockKey,
  runWithConcurrency,
  StorageStageKind,
  snapshotConcurrencyLockKeys,
  snapshotConcurrencyLockRange,
  type IConcurrencyAttempt,
  type IConcurrencyAttemptContext,
  type IConcurrencyHolder,
  type IConcurrencyStageObserver,
  type ITransactionOptions
} from '@migaia/storage-contract'
import {
  createStorageHost,
  definePlugin,
  defineStorageBackendKind,
  StorageError,
  StorageErrorCode,
  type IStoragePluginCore
} from '../src/index.js'
import type { IBackendKeyLockPort, IBackendChangeController } from '../src/authoring/backend.js'
import { catalog } from './helpers/catalog.js'

/** The actual native catalog and original transaction metadata supply one real installation. */
async function fixture(shared?: IBackendKeyLockPort) {
  /** Port creation is captured only through its installation-only core. */
  let port!: IBackendKeyLockPort
  /** Native state remains owned by the ordinary backend registration. */
  let state!: ReturnType<typeof catalog>
  /** Retain one original core only to test late construction rejection. */
  let installedCore!: IStoragePluginCore
  /** The actual controller owns direct closure and the original native map cleanup. */
  let controller!: IBackendChangeController
  /** Kind identity is independent of the native client's diagnostic name. */
  const kind = defineStorageBackendKind<ReturnType<typeof catalog>['store']>()('catalog')
  /** Named descriptor retains actual store inference without granting a standalone constructor. */
  const descriptor = (core: IStoragePluginCore) => ({
    kind,
    featureExpose: () => ({ getClient: () => undefined }),
    install: () => {
      installedCore = core
      state = catalog(core)
      /** Preserve the original map disposer while the actual controller acquires its lifetime. */
      const nativeDispose = state.store.dispose
      controller = core.createChangeController({ backend: 'catalog', finalize: nativeDispose })
      state.store.dispose = () => controller.dispose()
      createTransactionOwner(
        state.store,
        (cause) => new StorageError(StorageErrorCode.extensionFailed, { cause })
      )
      port = shared ?? core.createKeyLockPort()
      core.registerStore(state.store)
      core.registerChangeController(state.store, controller)
      return {}
    }
  })
  /** The physical owner is explicit in each test; core creation does not auto-close a shared port. */
  const host = await createStorageHost({ plugins: [definePlugin('locks', descriptor)] })
  return { host, port, state, core: installedCore, controller }
}

/** Holder metadata is native-backend input, never a provider-global attempt counter. */
const holder = (owner: string): IConcurrencyHolder => ({
  status: 'held',
  owner,
  label: owner,
  since: 1,
  scope: 'local'
})

/** Drive the same public decision loop and authentic context used by real backend attempts. */
function run<R>(
  current: Awaited<ReturnType<typeof fixture>>,
  owner: string,
  options: ITransactionOptions,
  native: (ctx: IConcurrencyAttemptContext) => Promise<IConcurrencyAttempt<R>>,
  stages?: IConcurrencyStageObserver,
  admissionSignal?: IAbortSignal
) {
  return runWithConcurrency(
    { store: current.state.store, options },
    {
      attempt: (ctx) =>
        current.port.attempt(ctx, holder(owner), { attempt: native }, stages, admissionSignal)
    }
  )
}

describe('the shared local key-lock provider', () => {
  it('keeps native vector and RDF locks distinct from record tuples in the same original provider', async () => {
    const current = await fixture()
    await using _host = current.host
    await using port = current.port
    /** Ground identity is validated by the contract's existing RDF owner. */
    const quad = {
      subject: { termType: 'NamedNode', value: 'urn:subject' },
      predicate: { termType: 'NamedNode', value: 'urn:predicate' },
      object: { termType: 'NamedNode', value: 'urn:object' },
      graph: { termType: 'DefaultGraph', value: '' }
    } as const
    /** Retain actual native lifetime while inspecting and contending on both new finite buckets. */
    const entered = deferred<void>()
    const finish = deferred<void>()
    const pending = run(
      current,
      'native',
      { lock: [lockKey.rdf(quad), lockKey.vector('collection', 'point')] },
      async () => {
        entered.resolve()
        await finish.promise
        return { status: 'committed', value: 'complete' }
      }
    )
    await entered.promise
    try {
      expect(port.inspectLocks().map(({ key }) => key.channel)).toEqual(['vector', 'rdf'])
      for (const key of [lockKey.vector('collection', 'point'), lockKey.rdf(quad)]) {
        const captured = snapshotConcurrencyLockKeys([key], 'catalog')
        expect(port.probe(captured.identities)?.key).toEqual(key)
        await expect(
          run(
            current,
            'conflict',
            { lock: [key], concurrency: ConcurrencyPolicy.fail() },
            async () => ({ status: 'committed', value: 'wrong' })
          )
        ).rejects.toMatchObject({ code: 'LOCK_REJECTED' })
      }
      await expect(
        run(current, 'record', { lock: [lockKey.record(['collection', 'point'])] }, async () => ({
          status: 'committed',
          value: 'record'
        }))
      ).resolves.toBe('record')
    } finally {
      finish.resolve()
      await expect(pending).resolves.toBe('complete')
    }
    expect(port.inspectLocks()).toEqual([])
  })

  it('tries atomically, allows unrelated native work and retains locks through actual cleanup', async () => {
    /** Resource acquisition uses the actual backend core and canonical loop. */
    const current = await fixture()
    await using _host = current.host
    await using port = current.port
    /** This native attempt remains active until its original cleanup finishes. */
    const entered = deferred<void>()
    /** Releasing the original native work must precede logical release observation. */
    const finish = deferred<void>()
    /** Observe actual occupancy rather than a callback or Promise approximation. */
    const order: string[] = []
    /** Stage failures are report-only at the provider's real Map boundary. */
    const report = vi.fn(() => undefined)
    /** The acquired callback can inspect the true table before native work begins. */
    const stages: IConcurrencyStageObserver = {
      kind: StorageStageKind.concurrency,
      report,
      onLockAcquired: (attempt, count) => {
        expect(attempt).toBe(1)
        expect(count).toBe(2)
        expect(port.inspectLocks()).toHaveLength(2)
        order.push('acquired')
      },
      onLockReleased: (attempt, count) => {
        expect(attempt).toBe(1)
        expect(count).toBe(2)
        expect(port.inspectLocks()).toHaveLength(0)
        order.push('released')
      }
    }
    /** Unsorted input exercises the original canonical identity list rather than backend sorting. */
    const pending = run(
      current,
      'first',
      { lock: [lockKey.record(new Date(2)), lockKey.text('same')] },
      async () => {
        order.push('native')
        entered.resolve()
        await finish.promise
        order.push('cleanup')
        return { status: 'committed', value: 'first' }
      },
      stages
    )
    await entered.promise
    expect(port.inspectLocks().map((row) => row.key.channel)).toEqual(['text', 'record'])
    /** Inspection is a detached key snapshot, including Date's mutable internal slot. */
    const recordKey = port.inspectLocks()[1]!.key
    expect(recordKey.channel).toBe('record')
    if (recordKey.channel !== 'record') expect.fail()
    const record = recordKey.key as Date
    record.setTime(99)
    const nextRecordKey = port.inspectLocks()[1]!.key
    if (nextRecordKey.channel !== 'record') expect.fail()
    expect((nextRecordKey.key as Date).getTime()).toBe(2)
    await expect(
      run(
        current,
        'blocked',
        { lock: [lockKey.text('same')], concurrency: ConcurrencyPolicy.fail() },
        async () => ({ status: 'committed', value: 'wrong' })
      )
    ).rejects.toMatchObject({
      code: 'LOCK_REJECTED',
      holder: expect.objectContaining({ owner: 'first' })
    })
    await expect(
      run(current, 'other', { lock: [lockKey.bytes('independent')] }, async () => ({
        status: 'committed',
        value: 'other'
      }))
    ).resolves.toBe('other')
    expect(order).toEqual(['acquired', 'native'])
    finish.resolve()
    await expect(pending).resolves.toBe('first')
    expect(order).toEqual(['acquired', 'native', 'cleanup', 'released'])
    expect(report).not.toHaveBeenCalled()
  })

  it('waits for async root ranges without replaying native attempts or blocking other channels', async () => {
    /** The original owner supplies authentic contexts and a shared physical lock table. */
    const current = await fixture()
    await using _host = current.host
    await using port = current.port
    /** The first actual native attempt retains its record lease until real cleanup ends. */
    const entered = deferred<void>()
    /** Release is deliberately later than the root range's original wait decision. */
    const release = deferred<void>()
    /** Observing the policy proves the root saw the original held record. */
    const decided = deferred<void>()
    /** An optimistic root respects existing locks without creating its own held row. */
    const decide = vi.fn(() => {
      decided.resolve()
      return { action: 'wait' } as const
    })
    /** Root native work must not begin until the original holder releases. */
    const native = vi.fn(async () => ({ status: 'committed', value: 'root' }) as const)
    /** The protected record falls inside a canonical typed prefix range. */
    const holding = run(
      current,
      'record-owner',
      { lock: [lockKey.record(['tenant', 1])] },
      async () => {
        entered.resolve()
        await release.promise
        return { status: 'committed', value: 'held' }
      }
    )
    await entered.promise
    /** Range bounds come from the original contract encoder, with no backend encoding. */
    const ranges = [
      {
        channel: 'record' as const,
        ...snapshotConcurrencyLockRange({ channel: 'record', prefix: ['tenant'] }, 'catalog')
      }
    ]
    /** The same original loop retries admission once, then waits inside the existing FIFO. */
    const pending = runWithConcurrency(
      {
        store: current.state.store,
        options: {
          concurrency: defineConcurrencyPolicy({
            name: 'root-range-wait',
            locking: 'optimistic',
            decide
          })
        }
      },
      {
        attempt: (ctx) =>
          port.attempt(ctx, holder('root'), { attempt: native }, undefined, undefined, ranges)
      }
    )
    await decided.promise
    expect(native).not.toHaveBeenCalled()
    await expect(
      run(current, 'text-owner', { lock: [lockKey.text('tenant')] }, async () => ({
        status: 'committed',
        value: 'text'
      }))
    ).resolves.toBe('text')
    expect(decide).toHaveBeenCalledTimes(1)
    expect(native).not.toHaveBeenCalled()
    release.resolve()
    await expect(holding).resolves.toBe('held')
    await expect(pending).resolves.toBe('root')
    expect(native).toHaveBeenCalledTimes(1)
    expect(decide).toHaveBeenCalledTimes(1)
    expect(port.inspectLocks()).toEqual([])
  })

  it('uses only the original FIFO for wait decisions and prevents cancelled queued native work', async () => {
    const current = await fixture()
    await using _host = current.host
    await using port = current.port
    /** The first native attempt retains its real held key while later decisions wait. */
    const entered = deferred<void>()
    /** Releasing the original resource allows exactly the queued waiters to acquire. */
    const release = deferred<void>()
    /** Each authentic waiting attempt has entered the provider before cancellation is triggered. */
    const admissions = deferred<void>()
    /** Record native entry order, independently of client Promise creation. */
    const order: string[] = []
    /** Three wait admissions precede release, including a cancelled middle FIFO entry. */
    let waiting = 0
    /** A genuine preset delegates waiting to the sole existing loop. */
    const policy = ConcurrencyPolicy.wait()
    /** Cancellation retains its original reason without starting the queued native callback. */
    const abort = new AbortController()
    const first = run(current, 'holder', { lock: [lockKey.text('key')] }, async () => {
      entered.resolve()
      await release.promise
      return { status: 'committed', value: undefined }
    })
    await entered.promise
    /** Waiters share one logical identity and the same original provider. */
    const wait = (name: string, signal?: AbortSignal) =>
      runWithConcurrency(
        {
          store: current.state.store,
          options: { lock: [lockKey.text('key')], concurrency: policy, signal }
        },
        {
          attempt: (ctx) => {
            /** The public port starts this actual admission before the observation resolves. */
            const pending = port.attempt(ctx, holder(name), {
              attempt: async () => {
                order.push(name)
                return { status: 'committed', value: name }
              }
            })
            if (ctx.admission === 'wait' && ++waiting === 3) admissions.resolve()
            return pending
          }
        }
      )
    const left = wait('left')
    const middle = wait('cancelled', abort.signal)
    /** Observe rejection immediately so the cancellation itself cannot create an unhandled result. */
    const cancelled = expect(middle).rejects.toMatchObject({ code: 'ABORTED', cause: 'cancel' })
    const right = wait('right')
    await admissions.promise
    abort.abort('cancel')
    await cancelled
    /** A logical wait deadline must also remove its actual queued entry without native work. */
    const timed = vi.fn(async () => ({ status: 'committed' as const, value: 'timeout' }))
    await expect(
      run(
        current,
        'timeout',
        {
          lock: [lockKey.text('key')],
          concurrency: ConcurrencyPolicy.wait({ timeoutMs: 1 })
        },
        timed
      )
    ).rejects.toMatchObject({ code: 'LOCK_TIMEOUT' })
    expect(timed).not.toHaveBeenCalled()
    expect(order).toEqual([])
    release.resolve()
    await Promise.all([first, left, right])
    expect(order).toEqual(['left', 'right'])
    expect(port.inspectLocks()).toEqual([])
  })

  it('removes only a closing member queued admission while another member retains its lock', async () => {
    /** Two original backend registrations share the same physical provider. */
    const current = await fixture()
    await using _firstHost = current.host
    await using port = current.port
    /** This second member owns its own controller but has no authority to close the shared port. */
    const member = await fixture(port)
    await using _secondHost = member.host
    /** The unrelated first member keeps its native interval active. */
    const entered = deferred<void>()
    /** Only the actual native terminal releases its key. */
    const finish = deferred<void>()
    const first = run(current, 'holder', { lock: [lockKey.text('shared')] }, async () => {
      entered.resolve()
      await finish.promise
      return { status: 'committed', value: 'first' }
    })
    await entered.promise
    /** Observe the real wait admission after it has reached the original FIFO. */
    const queued = deferred<void>()
    /** Closing this member must prevent the native callback entirely. */
    const native = vi.fn(async () => ({ status: 'committed' as const, value: 'wrong' }))
    /** The member controller retains this original accepted operation until actual cleanup. */
    const release = member.controller.beginMutation()
    const pending = runWithConcurrency(
      {
        store: member.state.store,
        options: {
          lock: [lockKey.text('shared')],
          concurrency: ConcurrencyPolicy.wait()
        }
      },
      {
        attempt: (ctx) => {
          /** Only the optional member signal bridges to this actual queued admission. */
          const result = port.attempt(
            ctx,
            holder('member'),
            { attempt: native },
            undefined,
            member.controller.closingSignal
          )
          if (ctx.admission === 'wait') queued.resolve()
          return result
        }
      }
    ).finally(release)
    /** Rejection is observed before closure notifies the queued task. */
    const rejected = expect(pending).rejects.toMatchObject({
      code: 'ABORTED',
      cause: expect.objectContaining({ code: 'STORE_DISPOSED' })
    })
    await queued.promise
    /** Direct backend disposal stops this member without ending another member's ownership. */
    const closed = member.state.store.dispose()
    await Promise.all([rejected, closed])
    expect(native).not.toHaveBeenCalled()
    expect(port.inspectLocks()).toHaveLength(1)
    expect(port.inspectLocks()[0]!.holder).toMatchObject({ owner: 'holder' })
    finish.resolve()
    await expect(first).resolves.toBe('first')
  })

  it('probes exact identities and rechecks root ranges after the original acquisition observation', async () => {
    const current = await fixture()
    await using _host = current.host
    await using port = current.port
    /** A stage can synchronously admit a different physical lock before the root mutation starts. */
    const entered = deferred<void>()
    const finish = deferred<void>()
    /** This native holder stays alive through the final range recheck and the original FIFO wait. */
    let late: Promise<string> | undefined
    let mutations = 0
    const bounds = {
      channel: 'text' as const,
      ...snapshotConcurrencyLockRange({ channel: 'text' }, 'catalog')
    }
    const root = runWithConcurrency(
      {
        store: current.state.store,
        options: { lock: [lockKey.bytes('gate')], concurrency: ConcurrencyPolicy.wait() }
      },
      {
        attempt: (ctx) =>
          port.attemptWrite(
            ctx,
            holder('root'),
            () => ++mutations,
            {
              kind: StorageStageKind.concurrency,
              report: () => undefined,
              onLockAcquired: () => {
                if (late) return
                late = run(current, 'late', { lock: [lockKey.text('busy')] }, async () => {
                  entered.resolve()
                  await finish.promise
                  return { status: 'committed', value: 'late' }
                })
              }
            },
            undefined,
            [bounds]
          )
      }
    )
    await entered.promise
    try {
      const identity = snapshotConcurrencyLockKeys([lockKey.text('busy')], 'catalog')
      expect(port.probe(identity.identities)).toMatchObject({
        key: lockKey.text('busy'),
        holder: { owner: 'late' },
        expired: false
      })
      expect(port.probe([], [bounds])).toMatchObject({ holder: { owner: 'late' } })
      expect(
        port.probe(
          [],
          [{ channel: 'record', ...snapshotConcurrencyLockRange({ channel: 'record' }, 'catalog') }]
        )
      ).toBeUndefined()
      expect(mutations).toBe(0)
      finish.resolve()
      await expect(root).resolves.toBe(1)
      await expect(late).resolves.toBe('late')
      expect(mutations).toBe(1)
      expect(port.probe(identity.identities)).toBeUndefined()
    } finally {
      finish.resolve()
      await Promise.allSettled([root, ...(late ? [late] : [])])
    }
  })

  it('excludes only the current authentic held lease while still finding another range holder', async () => {
    const current = await fixture()
    await using _host = current.host
    await using port = current.port
    /** Two independent native attempts own separate entries in the same physical text bucket. */
    const firstEntered = deferred<void>()
    const otherEntered = deferred<void>()
    const inspect = deferred<void>()
    const finish = deferred<void>()
    const ranges = [
      { channel: 'text' as const, ...snapshotConcurrencyLockRange({ channel: 'text' }, 'catalog') }
    ]
    const firstId = snapshotConcurrencyLockKeys([lockKey.text('first')], 'catalog').identities
    const otherId = snapshotConcurrencyLockKeys([lockKey.text('other')], 'catalog').identities
    let expired!: IConcurrencyAttemptContext
    const first = run(current, 'first', { lock: [lockKey.text('first')] }, async (ctx) => {
      expired = ctx
      firstEntered.resolve()
      await inspect.promise
      expect(port.probe(firstId, undefined, ctx)).toBeUndefined()
      expect(port.probe([], ranges, ctx)).toMatchObject({ holder: { owner: 'other' } })
      expect(() => port.probe([], ranges, {} as IConcurrencyAttemptContext)).toThrowError(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' })
      )
      return { status: 'committed', value: 'first' }
    })
    await firstEntered.promise
    const other = run(current, 'other', { lock: [lockKey.text('other')] }, async () => {
      otherEntered.resolve()
      await finish.promise
      return { status: 'committed', value: 'other' }
    })
    await otherEntered.promise
    try {
      /** An optimistic declaration grants no held-key exemption from a different attempt. */
      await expect(
        run(
          current,
          'optimistic',
          { lock: [lockKey.text('other')], concurrency: ConcurrencyPolicy.optimistic() },
          async (ctx) => {
            expect(port.probe(otherId, undefined, ctx)).toMatchObject({
              holder: { owner: 'other' }
            })
            return { status: 'committed', value: 'optimistic' }
          }
        )
      ).resolves.toBe('optimistic')
      inspect.resolve()
      await expect(first).resolves.toBe('first')
      expect(() => port.probe([], ranges, expired)).toThrowError(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' })
      )
    } finally {
      inspect.resolve()
      finish.resolve()
      await Promise.allSettled([first, other])
    }
  })

  it('does not start a root mutation when its acquired observer aborts the original operation', async () => {
    const current = await fixture()
    await using _host = current.host
    await using port = current.port
    /** The real acquired observation can synchronously cancel the original operation budget. */
    const abort = new AbortController()
    const reason = new Error('cancel before root native mutation')
    const native = vi.fn(() => 1)
    await expect(
      runWithConcurrency(
        {
          store: current.state.store,
          options: { lock: [lockKey.text('root')], signal: abort.signal }
        },
        {
          attempt: (ctx) =>
            port.attemptWrite(ctx, holder('root'), native, {
              kind: StorageStageKind.concurrency,
              report: () => undefined,
              onLockAcquired: () => abort.abort(reason)
            })
        }
      )
    ).rejects.toMatchObject({ code: 'ABORTED', cause: reason })
    expect(native).not.toHaveBeenCalled()
    expect(
      port.probe(snapshotConcurrencyLockKeys([lockKey.text('root')], 'catalog').identities)
    ).toBeUndefined()
  })

  it('retains original logical leases through physical admission and actual physical cleanup', async () => {
    const current = await fixture()
    await using _host = current.host
    await using port = current.port
    /** Existing backend physical admission owns its own ready and cleanup intervals. */
    const entered = deferred<void>()
    const ready = deferred<void>()
    const wrote = deferred<void>()
    const cleanup = deferred<void>()
    const identities = snapshotConcurrencyLockKeys([lockKey.text('physical')], 'catalog').identities
    let writes = 0
    const pending = runWithConcurrency(
      { store: current.state.store, options: { lock: [lockKey.text('physical')] } },
      {
        attempt: (ctx) =>
          port.attemptWrite(
            ctx,
            holder('physical'),
            () => ++writes,
            undefined,
            undefined,
            undefined,
            async (commit) => {
              entered.resolve()
              await ready.promise
              const result = commit()
              wrote.resolve()
              await cleanup.promise
              return result
            }
          )
      }
    )
    await entered.promise
    try {
      expect(port.probe(identities)).toMatchObject({ holder: { owner: 'physical' } })
      expect(writes).toBe(0)
      ready.resolve()
      await wrote.promise
      expect(writes).toBe(1)
      expect(port.probe(identities)).toBeDefined()
      cleanup.resolve()
      await expect(pending).resolves.toBe(1)
      expect(port.probe(identities)).toBeUndefined()
    } finally {
      ready.resolve()
      cleanup.resolve()
      await Promise.allSettled([pending])
    }
  })

  it.each(['operation', 'member'] as const)(
    'rechecks %s cancellation after physical admission before native mutation',
    async (kind) => {
      const current = await fixture()
      await using _host = current.host
      await using port = current.port
      const abort = new AbortController()
      const reason = new Error('abort physical root wait')
      const entered = deferred<void>()
      const ready = deferred<void>()
      const native = vi.fn(() => 1)
      const release = current.controller.beginMutation()
      const pending = runWithConcurrency(
        {
          store: current.state.store,
          options: { lock: [lockKey.text('physical')], signal: abort.signal }
        },
        {
          attempt: (ctx) =>
            port.attemptWrite(
              ctx,
              holder('physical'),
              native,
              undefined,
              current.controller.closingSignal,
              undefined,
              async (commit) => {
                entered.resolve()
                await ready.promise
                return commit()
              }
            )
        }
      ).finally(release)
      const rejected = expect(pending).rejects.toMatchObject({
        code: 'ABORTED',
        cause: kind === 'operation' ? reason : expect.objectContaining({ code: 'STORE_DISPOSED' })
      })
      await entered.promise
      const closing = kind === 'member' ? current.controller.dispose() : undefined
      if (kind === 'operation') abort.abort(reason)
      ready.resolve()
      await Promise.all([rejected, closing])
      expect(native).not.toHaveBeenCalled()
      expect(
        port.probe(snapshotConcurrencyLockKeys([lockKey.text('physical')], 'catalog').identities)
      ).toBeUndefined()
    }
  )

  it('keeps optimistic work unlocked and reports failed resource observers without affecting results', async () => {
    const current = await fixture()
    await using _host = current.host
    await using port = current.port
    /** A failing observer remains an observation rather than a policy or lifecycle owner. */
    const failure = new Error('observer failure')
    /** One report channel receives the exact same thrown error. */
    const report = vi.fn(() => undefined)
    /** Optimistic execution creates no logical lock even when it declares a key. */
    const acquired = vi.fn()
    await expect(
      run(
        current,
        'optimistic',
        { lock: [lockKey.text('key')], concurrency: ConcurrencyPolicy.optimistic() },
        async () => {
          expect(port.inspectLocks()).toEqual([])
          return { status: 'committed', value: 7 }
        },
        { kind: StorageStageKind.concurrency, report, onLockAcquired: acquired }
      )
    ).resolves.toBe(7)
    expect(acquired).not.toHaveBeenCalled()
    await expect(
      run(
        current,
        'pessimistic',
        { lock: [lockKey.text('key')] },
        async () => ({ status: 'committed', value: 8 }),
        {
          kind: StorageStageKind.concurrency,
          report,
          onLockAcquired: () => {
            throw failure
          }
        }
      )
    ).resolves.toBe(8)
    expect(report).toHaveBeenCalledExactlyOnceWith(failure)
  })

  it('retains physical ownership, drains accepted native work and caches both cleanup Promises', async () => {
    const current = await fixture()
    /** Construction authority ends with the original installation window. */
    expect(() => current.core.createKeyLockPort()).toThrowError(
      expect.objectContaining({ code: 'RESOURCE_OUTSIDE_INSTALL' })
    )
    /** The original registration owns its map, while its physical port remains separately owned. */
    await current.host.dispose()
    expect(current.port.inspectLocks()).toEqual([])
    /** A second original registration retains the shared physical provider after its creator ends. */
    const active = await fixture(current.port)
    await using _host = active.host
    /** Accepted native work must finish before physical port cleanup completes. */
    const entered = deferred<void>()
    /** Cancellation cannot be mistaken for the native terminal or release. */
    const finish = deferred<void>()
    /** This member retains the same accepted native work through direct disposal. */
    const release = active.controller.beginMutation()
    const pending = run(
      active,
      'native',
      { lock: [lockKey.text('key')] },
      async () => {
        entered.resolve()
        await finish.promise
        return { status: 'committed', value: 42 }
      },
      undefined,
      active.controller.closingSignal
    ).finally(release)
    await entered.promise
    /** Member closure does not release an already-entered native attempt. */
    const closing = active.controller.dispose()
    expect(current.port.inspectLocks()).toHaveLength(1)
    /** The two resource entries retain independent cached Promise identities. */
    const disposal = current.port.dispose()
    expect(current.port.dispose()).toBe(disposal)
    const symbolic = current.port[asyncDisposeKey]()
    expect(current.port[asyncDisposeKey]()).toBe(symbolic)
    expect(symbolic).not.toBe(disposal)
    /** A closed port rejects new work without running its native callback. */
    const late = vi.fn(async () => ({ status: 'committed' as const, value: 0 }))
    await expect(run(active, 'late', { lock: [lockKey.text('late')] }, late)).rejects.toMatchObject(
      { code: 'STORE_DISPOSED' }
    )
    expect(late).not.toHaveBeenCalled()
    /** The primary cleanup is still pending while the actual native terminal is blocked. */
    let settled = false
    void disposal.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    finish.resolve()
    await expect(pending).resolves.toBe(42)
    await Promise.all([disposal, symbolic, closing])
    expect(settled).toBe(true)
  })
})
