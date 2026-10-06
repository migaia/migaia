import assert from 'node:assert/strict'
import { it } from 'vitest'
import { RpcCapability } from '../../src/contract/wire-constants.js'
import { RpcSerializationError, RpcCoreErrorCode, tagRpcError } from '../../src/core/errors.js'
import { compileRuntimeMethods } from '../../src/remote/runtime-api/catalog.js'
import { readRuntimePeerConnection } from '../../src/remote/runtime-api/peer.js'
import { connected, RuntimeApiFixtureText } from './fixture.js'
import { setTimeout as delay } from 'node:timers/promises'

it('[A5] notify business rejection and nonportable result report without changing send settlement', async () => {
  /** A genuine native business rejection stays independent of notification transport completion. */
  const original = new RangeError(RuntimeApiFixtureText.notifyFailure)
  /** The original report port acknowledges the handler error without a fixture poll or dispatcher. */
  let reportBusiness!: (error: unknown) => void
  /** This barrier observes the exact native instance rather than a reconstructed wire error. */
  const businessReported = new Promise<unknown>((resolve) => {
    reportBusiness = resolve
  })
  /** Result normalization reports a separate factory-created error through the same owner. */
  let reportResult!: (error: unknown) => void
  /** The result error is observed independently from the already fulfilled physical send. */
  const resultReported = new Promise<unknown>((resolve) => {
    reportResult = resolve
  })
  /** All methods use the real shared provider/outbound owner and explicit automatic whitelist. */
  const fixture = await connected(
    {},
    {
      reject: () => {
        throw original
      },
      invalid: () => () => 1,
      healthy: () => 'healthy'
    },
    undefined,
    undefined,
    (error) => {
      if (error === original) reportBusiness(error)
      if (error instanceof RpcSerializationError) reportResult(error)
    }
  )
  try {
    assert.equal(
      await fixture.peers[0].notify('reject'),
      undefined,
      '[A5] physical send fulfills despite business rejection'
    )
    assert.equal(
      await businessReported,
      original,
      '[A5] business failure reaches the canonical local report unchanged'
    )
    assert.equal(await fixture.peers[0].notify('invalid'), undefined)
    assert.ok(
      (await resultReported) instanceof RpcSerializationError,
      '[A5] nonportable notify results use the original reported failure path'
    )
    assert.equal(
      await fixture.peers[0].request('healthy'),
      'healthy',
      '[A5] failed notify business never poisons the connection'
    )
  } finally {
    await fixture.close()
  }
})

it('[A10] both directions retain native AggregateError type and ordered coded children', async () => {
  /** Canonical tagging attaches identity without replacing the application's native child. */
  const first = tagRpcError(
    new TypeError(RuntimeApiFixtureText.aggregateType),
    RpcCoreErrorCode.invalidConfig
  )
  /** A distinct native child independently proves ordered errors[] and stack transfer. */
  const second = tagRpcError(
    new RangeError(RuntimeApiFixtureText.aggregateRange),
    RpcCoreErrorCode.invalidConfig
  )
  /** The actual business exception contains both an ordered child list and an original cause. */
  const original = tagRpcError(
    new AggregateError([first, second], RuntimeApiFixtureText.aggregateFailure, { cause: first }),
    RpcCoreErrorCode.internal
  )
  /** Different real endpoints serialize the same immutable native business failure independently. */
  const fixture = await connected(
    {
      fail: () => {
        throw original
      }
    },
    {
      fail: () => {
        throw original
      }
    }
  )
  try {
    for (const peer of fixture.peers) {
      await assert.rejects(peer.request('fail'), (error: unknown) => {
        /** The canonical response wrapper retains its original serialized business node as cause. */
        const failure = error as Error & {
          code?: string
          cause?: AggregateError & { source?: string; code?: string }
        }
        assert.equal(failure.code, 'INTERNAL')
        assert.ok(
          failure.cause instanceof AggregateError,
          '[A10] receiver restores the native AggregateError type'
        )
        assert.equal(failure.cause.source, original.source)
        assert.equal(failure.cause.code, original.code)
        assert.equal(failure.cause.message, original.message)
        assert.equal(failure.cause.stack, original.stack)
        assert.equal(failure.cause.errors.length, 2)
        for (const [index, child] of [first, second].entries()) {
          /** Each restored child retains the exact serialized fields, including its original stack. */
          const restored: Error & { source?: string; code?: string } = failure.cause.errors[index]
          assert.ok(index === 0 ? restored instanceof TypeError : restored instanceof RangeError)
          assert.equal(restored.name, child.name)
          assert.equal(restored.source, child.source)
          assert.equal(restored.code, child.code)
          assert.equal(restored.message, child.message)
          assert.equal(restored.stack, child.stack)
        }
        assert.equal((failure.cause.cause as Error).stack, first.stack)
        return true
      })
    }
    assert.equal(
      original.errors[0],
      first,
      '[A10] local ordered children retain native object identity'
    )
    assert.equal(original.errors[1], second)
    assert.equal(original.cause, first)
    assert.equal(
      fixture.failures.filter((error) => error === original).length,
      2,
      '[A10] each side reports its original business failure once'
    )
  } finally {
    await fixture.close()
  }
})

it('[A6] asynchronous generators keep order and cancellation runs original cleanup once', async () => {
  /** Native finally execution is independent evidence of the remote iterator lifecycle. */
  let cleanups = 0
  /** Cleanup completion is observed without polling or creating a fixture stream owner. */
  let finish!: () => void
  /** The genuine remote generator acknowledges its original finally block. */
  const finished = new Promise<void>((resolve) => {
    finish = resolve
  })
  /** The shared factory registers this same method for all caller-selected modes. */
  const fixture = await connected(
    {},
    {
      values: async function* () {
        try {
          yield await Promise.resolve(1)
          yield 2
        } finally {
          cleanups += 1
          finish()
        }
      }
    }
  )
  try {
    /** Return is forwarded to the original canonical iterator rather than an async facade. */
    const iterator = fixture.peers[0].stream('values')
    assert.deepEqual(await iterator.next(), { done: false, value: 1 })
    await iterator.return?.()
    await finished
    await iterator.return?.()
    assert.equal(cleanups, 1, '[A6] duplicate cancellation cannot repeat generator cleanup')
    assert.equal((await iterator.next()).done, true)
  } finally {
    await fixture.close()
  }
})

it('[A10] nonportable parameters reject before the actual business handler runs', async () => {
  /** Provider execution independently distinguishes payload admission from business failure. */
  let calls = 0
  /** This ordinary portable baseline runs through the real canonical wire first. */
  const fixture = await connected(
    {},
    {
      echo: (payload) => {
        calls += 1
        return payload
      }
    }
  )
  try {
    assert.equal(await fixture.peers[0].request('echo', 'ready'), 'ready')
    calls = 0
    for (const payload of [() => 1, Symbol('nonportable'), new Map([['x', 1]])]) {
      assert.throws(
        () => fixture.peers[0].request('echo', payload),
        { code: 'INVALID_ENVELOPE' },
        '[A10] the existing portable owner rejects unsupported values'
      )
    }
    assert.equal(calls, 0, '[A10] rejected parameters never enter the provider')
  } finally {
    await fixture.close()
  }
})

it('[A7] the result wrapper preserves its local cause while child contract summaries keep secrets out of the wire', async () => {
  /** A native failure belongs to the application getter and must remain locally reachable. */
  const secret = new RangeError(RuntimeApiFixtureText.resultGetterFailure)
  /** This getter is a real result-normalization failure, rather than a handler throw. */
  const result = Object.defineProperty({}, 'value', {
    enumerable: true,
    get: () => {
      throw secret
    }
  })
  /** The original provider executor reports the wrapper independently of its serialized response. */
  const fixture = await connected({}, { result: () => result })
  try {
    await assert.rejects(fixture.peers[0].request('result'), (error: unknown) => {
      /** Only the factory-created wrapper opts in to bounded cause serialization. */
      const failure = error as {
        code?: string
        cause?: { cause?: { code?: string; cause?: unknown } }
      }
      assert.equal(failure.code, 'PAYLOAD_INVALID')
      assert.equal(failure.cause?.cause?.code, 'INVALID_ENVELOPE')
      assert.equal(
        failure.cause?.cause?.cause,
        undefined,
        '[A7] the child trusted summary keeps its original secret boundary'
      )
      assert.equal(JSON.stringify(error).includes(secret.message), false)
      return true
    })
    /** Local reporting keeps the original getter failure under the unchanged native cause chain. */
    const reported = fixture.failures.find((error) => error instanceof RpcSerializationError) as
      | RpcSerializationError
      | undefined
    assert.ok(reported)
    assert.equal(
      (reported.cause as { cause?: unknown }).cause,
      secret,
      '[A7] the original local error instance stays reachable'
    )
  } finally {
    await fixture.close()
  }
})

it('[A4][A8] different automatic directories expose only explicit nested methods and support reverse requests', async () => {
  /** Business execution is measured independently of the directory shape. */
  let saved = 0
  /** Only the explicit doc tree becomes the parent whitelist. */
  const fixture = await connected(
    {
      doc: {
        save: () => {
          saved += 1
          return 'saved'
        }
      }
    },
    { math: { add: (payload) => Number(payload) + 1 } }
  )
  try {
    assert.deepEqual(
      (await fixture.peers[0].describe()).methods,
      ['doc.save'],
      '[A4] parent directory contains only its explicit own method'
    )
    assert.deepEqual(
      (await fixture.peers[1].describe()).methods,
      ['math.add'],
      '[A4] child directory differs without a handshake rejection'
    )
    assert.equal(
      await fixture.peers[1].request('doc.save'),
      'saved',
      '[A8] reverse request runs the parent method'
    )
    assert.equal(saved, 1)
    assert.equal(await fixture.peers[0].request('math.add', 4), 5)
    assert.throws(
      () => fixture.peers[1].request('doc.hidden'),
      { code: 'PROVIDER_NOT_FOUND' },
      '[A8] hidden members never execute'
    )
    assert.equal(saved, 1)
  } finally {
    await fixture.close()
  }
})

it('[A5] notify settles on physical send while its ordinary provider remains blocked', async () => {
  /** A notify send deadline cannot become a remote business controller deadline. */
  let businessAborted = false
  /** A real business barrier distinguishes physical send from business completion. */
  let release!: () => void
  /** Provider completion remains unresolved until after notification settlement has been observed. */
  const blocked = new Promise<string>((resolve) => {
    release = () => resolve('done')
  })
  /** Reentry signals actual business start, avoiding timers or polling. */
  let started!: () => void
  /** The ordinary function is used by both caller modes without a duplicate registration. */
  const running = new Promise<void>((resolve) => {
    started = resolve
  })
  /** Returning a Promise does not assign a fixed request-only mode. */
  const fixture = await connected(
    {},
    {
      work: (_payload, context) => {
        context.signal.addEventListener(
          'abort',
          () => {
            businessAborted = true
          },
          { once: true }
        )
        started()
        return blocked
      }
    }
  )
  try {
    /** Send cancellation no longer controls business execution after physical completion. */
    const controller = new AbortController()
    await fixture.peers[0].notify('work', undefined, { signal: controller.signal, timeoutMs: 20 })
    controller.abort(new Error(RuntimeApiFixtureText.postCommitCancellation))
    await running
    await delay(30)
    assert.equal(
      businessAborted,
      false,
      '[A5][A56] completed notify controls never cancel its business provider'
    )
    release()
    assert.equal(
      await fixture.peers[0].request('work'),
      'done',
      '[A5] the same ordinary method accepts both modes'
    )
  } finally {
    release()
    await fixture.close()
  }
})

it('[A6][A7] one logical generator streams in order but scalar invocation keeps PAYLOAD_INVALID and its cause', async () => {
  /** Both native generator forms belong to the existing stream owner. */
  const fixture = await connected(
    {},
    {
      values: function* () {
        yield 1
        yield 2
      },
      scalar: () => 3
    }
  )
  try {
    /** Iteration observes actual yields rather than a collected scalar reply. */
    const values: unknown[] = []
    for await (const value of fixture.peers[0].stream('values')) values.push(value)
    assert.deepEqual(values, [1, 2], '[A6] canonical stream yields remain ordered')
    await assert.rejects(fixture.peers[0].request('values'), (failure: unknown) => {
      assert.equal(
        (failure as { code?: string }).code,
        'PAYLOAD_INVALID',
        '[A6] only scalar result normalization changes the wire failure code'
      )
      assert.ok(
        (failure as { cause?: unknown }).cause,
        '[A6] the original normalization cause remains reachable'
      )
      return true
    })
    await assert.rejects(
      fixture.peers[0].stream('scalar').next(),
      { code: 'PAYLOAD_INVALID' },
      '[A7] scalar values do not silently become a stream'
    )
  } finally {
    await fixture.close()
  }
})

it('[A9] child reenters the explicitly exposed parent while servicing a parent request', async () => {
  /** The child captures the actual factory result only after construction has completed. */
  let callback!: () => Promise<unknown>
  /** Both directions execute through the same actual outbound/provider owners. */
  const fixture = await connected({ doc: { save: () => 'saved' } }, { run: () => callback() })
  callback = () => fixture.peers[1].request('doc.save')
  try {
    assert.equal(
      await fixture.peers[0].request('run'),
      'saved',
      '[A9] nested reverse request is not serialized behind the original request'
    )
  } finally {
    await fixture.close()
  }
})

it('[A4][A8] descriptor validation never reads getters or exposes inherited and reserved methods', () => {
  /** A rejected accessor must never execute during construction. */
  let reads = 0
  /** Only a data descriptor may enter the automatic whitelist. */
  const accessor = Object.defineProperty({}, 'secret', {
    enumerable: true,
    get: () => {
      reads += 1
      return () => 1
    }
  })
  assert.throws(
    () => compileRuntimeMethods(accessor),
    { code: 'INVALID_CONFIG' },
    '[A4] accessor provide is rejected'
  )
  assert.equal(reads, 0, '[A4] no application getter executes')
  assert.throws(
    () => compileRuntimeMethods(Object.create({ hidden: () => 1 })),
    { code: 'INVALID_CONFIG' },
    '[A8] inherited members cannot enter the whitelist'
  )
  assert.throws(
    () => compileRuntimeMethods({ migaia: { remote: { runtime: { describe: () => 1 } } } }),
    { code: 'INVALID_CONFIG' },
    '[A8] reserved control namespace is rejected'
  )
})

it('[A31][A32] removing stream from either actual offer preserves ordinary calls and rejects stream', async () => {
  /** The actual remote offer retains runtime description but omits stream capability. */
  const fixture = await connected({}, { echo: (payload) => payload }, undefined, [
    RpcCapability.runtimeApi,
    RpcCapability.batch
  ])
  try {
    assert.equal(
      await fixture.peers[0].request('echo', 'ok'),
      'ok',
      '[A31] independent batch/runtime agreement still permits scalar calls'
    )
    assert.deepEqual(
      readRuntimePeerConnection(fixture.peers[1]).directory.localDescription.methods[0]!
        .supportedModes,
      ['request', 'notify'],
      '[A32] uninstalled stream is absent from the directory'
    )
    assert.throws(
      () => fixture.peers[0].stream('echo'),
      { code: 'CAPABILITY_UNSUPPORTED' },
      '[A32] a local stream offer cannot invent remote stream support'
    )
  } finally {
    await fixture.close()
  }
})

it('[A7][A10] handler-thrown RpcSerializationError keeps INTERNAL while original local and wire causes remain traceable', async () => {
  /** Handler exceptions must stay outside the result-normalization catch. */
  const cause = new RangeError(RuntimeApiFixtureText.businessRange)
  /** This coded error was made by application code, not the trusted result-validation wrapper. */
  const original = new RpcSerializationError(RuntimeApiFixtureText.businessSerialization, cause)
  /** Both directions use the same actual owner rather than a reconstructed fixture exception. */
  const fixture = await connected(
    {
      fail: () => {
        throw original
      }
    },
    {
      fail: () => {
        throw original
      }
    }
  )
  try {
    for (const peer of fixture.peers) {
      await assert.rejects(peer.request('fail'), (error: unknown) => {
        /** Public top-level behavior is inherited from the existing generic provider failure path. */
        const failure = error as {
          code?: string
          cause?: {
            name?: string
            source?: string
            code?: string
            message?: string
            stack?: string
            cause?: { name?: string; message?: string; stack?: string }
          }
        }
        assert.equal(
          failure.code,
          'INTERNAL',
          '[A7] a business RpcSerializationError is not reclassified as result PAYLOAD_INVALID'
        )
        assert.equal(
          failure.cause?.name,
          'RpcSerializationError',
          '[A10] the original error name crosses the actual wire'
        )
        assert.equal(
          failure.cause?.code,
          'PAYLOAD_INVALID',
          '[A10] the original coded node remains on the cause chain'
        )
        assert.equal(
          failure.cause?.source,
          original.source,
          '[A10] the original package source crosses the wire'
        )
        assert.equal(failure.cause?.message, original.message)
        assert.equal(
          failure.cause?.stack,
          original.stack,
          '[A10] the receiver does not regenerate the original stack'
        )
        assert.equal(failure.cause?.cause?.name, 'RangeError')
        assert.equal(failure.cause?.cause?.message, cause.message)
        assert.equal(failure.cause?.cause?.stack, cause.stack)
        return true
      })
    }
    assert.equal(original.cause, cause, '[A10] the local original cause keeps object identity')
    assert.ok(
      fixture.failures.includes(original),
      '[A10] canonical local reporting retains the original handler error instance'
    )
  } finally {
    await fixture.close()
  }
})
