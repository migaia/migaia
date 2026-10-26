/** Original keyed-group completion survives a refusal by the genuine installed signer. */
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { it, vi } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { auth } from '@migaia/rpc-host/plugins/auth'
import { idempotency, type IRpcOutcomeLookup } from '@migaia/rpc-host/plugins/idempotency'
import { timeout } from '@migaia/rpc-host/features/timeout'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { coreMemoryServer } from '../host/core-fixture.js'
import { RuntimeApiFixtureText } from '../fixtures/runtime-api-text.js'

/** Sign the original complete authentication input with the same public fixture material. */
function signature(value: unknown): string {
  return createHmac('sha256', 'group-terminal-public-fixture-key')
    .update(JSON.stringify(value))
    .digest('hex')
}

/** Verify the genuine signed input without reconstructing any protocol or nonce fields. */
function verify(value: unknown): unknown {
  /** The actual paired signer supplies this opaque authentication wrapper. */
  const frame = value as { value: unknown; signature: string }
  assert.equal(frame.signature, signature(frame.value))
  return frame.value
}

it('a genuine response signing failure retains the completed keyed group', async () => {
  /** Only the original provider changes business effects or arms its one signing refusal. */
  const state = {
    effects: 0,
    refuse: false,
    signFailure: new RangeError(RuntimeApiFixtureText.lateAuthentication),
    failures: [] as unknown[]
  }
  /** The actual listener lends the two original physical endpoints and Session installation. */
  const server = coreMemoryServer('terminal-provider')
  /** The provider owns the genuine signer and keyed store; no reply or outcome is synthesized. */
  const host = await createRpcHost({
    ...server.options,
    plugins: [
      auth({
        sign: (value) => {
          if (state.refuse && state.effects === 2) {
            state.refuse = false
            throw state.signFailure
          }
          return { value, signature: signature(value) }
        },
        verify
      }),
      idempotency(),
      server.transport
    ],
    provide: { value: () => ++state.effects },
    report: (error) => state.failures.push(error)
  })
  /** The caller uses the same real paired transform and normal namespace outcome extension. */
  const client = await server.connect('terminal-caller', {
    plugins: [
      auth({ sign: (value) => ({ value, signature: signature(value) }), verify }),
      idempotency()
    ],
    report: (error) => state.failures.push(error)
  })
  try {
    state.refuse = true
    /** The original 50ms deadline observes the lost reply without cancelling completed business. */
    await assert.rejects(
      client.host.memory.group([{ method: 'value' }, { method: 'value' }], {
        idempotencyKey: 'completed-without-reply',
        timeout: timeout({ ms: 50 })
      }),
      { code: RpcCoreErrorCode.deadlineExceeded }
    )
    assert.equal(state.effects, 2)
    await vi.waitFor(() =>
      assert.ok(
        state.failures.some(
          (error) =>
            error !== null &&
            typeof error === 'object' &&
            Reflect.get(error, 'code') === RpcCoreErrorCode.authenticationFailed &&
            Reflect.get(error, 'cause') === state.signFailure
        ),
        'the original authentication owner rejected response preparation'
      )
    )
    /** The genuine remote query reads the original already-sealed store entry. */
    const lookup = Reflect.get(client.host.memory, 'outcome') as IRpcOutcomeLookup
    /** The existing dynamic test connection erases its cold Feature's namespace extension type. */
    const outcome = await lookup('completed-without-reply')
    assert.equal(
      Reflect.get(outcome, 'state'),
      'done',
      'failed response preparation cannot delete done'
    )
    /** Reusing the original group body and key must replay rather than repeat either effect. */
    const repeated = await client.host.memory.group([{ method: 'value' }, { method: 'value' }], {
      idempotencyKey: 'completed-without-reply'
    })
    assert.ok(Array.isArray(repeated))
    assert.deepEqual(
      repeated.map((step: { state: string }) => step.state),
      ['success', 'success']
    )
    assert.equal(state.effects, 2, 'the same business key must never execute again')
  } finally {
    await Promise.all([client.host.close(), host.close()])
  }
})
