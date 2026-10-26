/** Original verifier rejection and token privacy use the actual current native auth installation. */
import { expect, it, vi } from 'vitest'
import { inspect } from 'node:util'
import { walkErrorCauses } from '@migaia/utils/error'
import { createRpcStreamFrameDecoder } from '@migaia/rpc-host/sdk'
import { RpcWireHandshakeStep } from '@migaia/rpc-contract/protocol'
import { NativeSocketAuth } from './fixtures/native-socket-auth.js'
import { deferred } from '@migaia/utils/promise'

it('closes an actual pending native verifier without reporting owner cancellation', async () => {
  /** The genuine TCP candidate reaches its configured async native admission before close. */
  const entered = deferred<void>()
  /** This user verifier can finish after its actual listening Host has already been removed. */
  const verified = deferred<string>()
  /** Application auth is absent so the observed lifecycle belongs only to the native listener. */
  const fixture = new NativeSocketAuth(false)
  const server = await fixture.listen(() => {
    entered.resolve()
    return verified.promise
  })
  /** Client failure is observed before its physical socket is intentionally closed. */
  const pending = fixture.connect('review32-pending-verifier').catch((error: unknown) => error)
  try {
    await entered.promise
    await server.close()
    verified.resolve('late-native-principal')
    await pending
    await fixture.admitted.promise
    expect(fixture.context?.lookup('dialer-route')).toBeUndefined()
    expect(fixture.reports, inspect(fixture.reports, { depth: 5 })).toEqual([])
  } finally {
    verified.resolve('late-native-principal')
    await fixture.close()
  }
})

it('rejects verifier failure with fixed wire error and no token in diagnostics', async () => {
  /** The original adversarial credential remains local fixture data on the real native recipe. */
  const token = 'secret-token-only-in-hello'
  /** The public hosts and original Process carrier supply readiness, reports and actual wire bytes. */
  const fixture = new NativeSocketAuth()
  await fixture.listen(() => {
    throw new Error(token)
  })
  try {
    /** Both outcomes come from actual public client startup and native server admission. */
    const attempts = await Promise.allSettled([
      fixture.connect(token).then(() => undefined),
      fixture.connection
    ])
    expect(attempts.map((result) => result.status)).toEqual(['rejected', 'rejected'])
    /** The canonical framer reads actual original raw writes without recreating wire admission. */
    const frames: string[] = []
    /** Only a real rejection frame can satisfy the original fixed-wire-error assertion. */
    const decoder = createRpcStreamFrameDecoder({
      onFrame: (bytes) => {
        frames.push(new TextDecoder().decode(bytes))
      },
      onError: (error) => {
        throw error
      }
    })
    for (const write of fixture.writes) decoder.push(write)
    /**
     * Current bilateral negotiation may write more frames; the original rejecting wire fact
     * remains.
     */
    const rejectText = frames.find((text) => JSON.parse(text).step === RpcWireHandshakeStep.reject)
    expect(rejectText).toContain('PROCESS_CHANNEL_AUTH_REJECTED')
    expect(rejectText).not.toContain(token)
    expect(JSON.stringify(fixture.reports)).not.toContain(token)
    expect(fixture.reports).toEqual([
      expect.objectContaining({
        source: 'rpc.transport.process',
        code: 'PROCESS_CHANNEL_AUTH_REJECTED'
      })
    ])
  } finally {
    await fixture.close()
  }
})

it('admits the native token once without an application auth plugin', async () => {
  /** Only the native configured verifier decides connection admission in this case. */
  const token = 'native-only-valid-credential'
  /** Verification is a user configuration callback, not a method on the native ingress recipe. */
  const receivers: unknown[] = []
  /** Real native verification is counted independently from every later semantic handshake. */
  const verify = vi.fn(function (this: unknown, credential: unknown) {
    receivers.push(this)
    expect(credential).toBe(token)
    return 'native-only-principal'
  })
  /** This explicitly installs no application authentication plugin on either actual root. */
  const fixture = new NativeSocketAuth(false)
  await fixture.listen(verify)
  try {
    /** Native connection proof completes before the actual no-auth Session can serve business. */
    const client = await fixture.connect(token)
    expect(await client.process.send('listener-route', 'echo', 42)).toBe(42)
    expect(verify).toHaveBeenCalledExactlyOnceWith(
      token,
      expect.objectContaining({ id: 'dialer-route' })
    )
    expect(fixture.context!.lookup('dialer-route')!.view.authentication?.principalId).toBe(
      'native-only-principal'
    )
    expect(fixture.reports).toEqual([])
    expect(receivers).toEqual([undefined])
  } finally {
    await fixture.close()
  }
})

it('rejects the native wrong token without application auth and keeps secret verifier errors private', async () => {
  /** Public error graphs must contain neither the configured nor the received credential. */
  const expected = 'native-only-expected-credential'
  /** An actual wrong credential crosses the same native byte owner as a normal client. */
  const received = 'native-only-wrong-credential'
  /** Deliberately secret-bearing application verifier failures must never become public causes. */
  const fixture = new NativeSocketAuth(false)
  await fixture.listen((credential) => {
    if (credential !== expected) throw new Error(`${expected}:${received}`)
    return 'native-only-principal'
  })
  try {
    /** This is the real public construction error, retaining its original native cause objects. */
    const error = await fixture.connect(received).then(
      () => undefined,
      (failure: unknown) => failure
    )
    expect(error).toMatchObject({ code: 'REMOTE_START_FAILED' })
    expect(walkErrorCauses(error)).toContainEqual(
      expect.objectContaining({
        source: 'rpc.transport.process',
        code: 'PROCESS_CHANNEL_AUTH_REJECTED'
      })
    )
    /** Native server rejection is the original real report, not a synthesized fixture exception. */
    const reported = await fixture.connection.catch((failure: unknown) => failure)
    expect(reported).toMatchObject({
      source: 'rpc.transport.process',
      code: 'PROCESS_CHANNEL_AUTH_REJECTED'
    })
    expect(
      inspect([error, reported, fixture.reports], { depth: null, showHidden: true })
    ).not.toContain(expected)
    expect(
      inspect([error, reported, fixture.reports], { depth: null, showHidden: true })
    ).not.toContain(received)
    expect(fixture.context?.lookup('dialer-route')).toBeUndefined()
  } finally {
    await fixture.close()
  }
})

it('keeps two native credentials private and isolated when the application resolver reads them', async () => {
  /** Distinct actual connections share one listener and one installed application auth owner. */
  const tokens = ['native-connection-alpha', 'native-connection-beta'] as const
  /** Existing application verifier input records only actual credentials seen per physical Session. */
  const seen = new Map<string, Set<unknown>>()
  /** The existing credentials(context) resolver in this fixture borrows Root's private Session slot. */
  const fixture = new NativeSocketAuth(true, (credential, _peer, context) => {
    /** Each actual carrier retains its own application credential observations across hello/accept. */
    let values = seen.get(context.carrierId)
    if (!values) {
      values = new Set()
      seen.set(context.carrierId, values)
    }
    values.add(credential)
  })
  await fixture.listen((credential) => {
    if (credential === tokens[0]) return 'principal-alpha'
    if (credential === tokens[1]) return 'principal-beta'
    throw new Error('unexpected native fixture credential')
  })
  try {
    /** Native roots remain independent even though they enter the same server's source context. */
    const alpha = await fixture.connect(tokens[0], 'caller-alpha')
    /** The second original connection must not inherit the first one's private credential cell. */
    const beta = await fixture.connect(tokens[1], 'caller-beta')
    expect(await alpha.process.send('listener-route', 'echo', 1)).toBe(1)
    expect(await beta.process.send('listener-route', 'echo', 2)).toBe(2)
    expect([...seen.values()].map((values) => [...values])).toEqual([[tokens[0]], [tokens[1]]])
    /** Only admitted principal metadata is public; native credentials never join this view. */
    const views = [
      fixture.context!.lookup('caller-alpha')!.view,
      fixture.context!.lookup('caller-beta')!.view
    ]
    expect(views.map((view) => view.authentication?.principalId)).toEqual([
      'principal-alpha',
      'principal-beta'
    ])
    expect(JSON.stringify(views)).not.toContain(tokens[0])
    expect(JSON.stringify(views)).not.toContain(tokens[1])
    expect(fixture.reports).toEqual([])
  } finally {
    await fixture.close()
  }
})
