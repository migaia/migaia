import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { nativeSession } from './native-harness.mjs'
import { NativeReplayReceipt } from '../../dist/core/internal/native-replay.js'

/** Diagnostic-only mutant isolates the previously missing parent terminal observation. */
if (process.env.RPC_REPLAY_LOCAL_MUTANT === 'missing-terminal-checkpoint')
  NativeReplayReceipt.prototype.observeOwner = () => undefined

/** Both cases execute the same source owner; selector keeps each baseline assertion observable. */
const selected = process.argv[2]
const results = []
for (const mode of ['process', 'worker']) {
  const session = await nativeSession(mode, {
    capture: true,
    controlledClock: selected === 'hard-expiry',
    keepAlive: selected === 'local-close'
  })
  let pending
  /** Observe the existing error channel without adding a physical message reader. */
  let removeErrorObserver
  try {
    if (selected === 'terminal' || selected === 'local-close') {
      let terminalError
      removeErrorObserver = session.channel.transport.onTransportError((error) => {
        terminalError = error
      })
      /** A real unresolved call retains the original terminal error through receipt retirement. */
      pending = session.endpoint.send('peer', 'hold', null).catch((error) => error)
      assert.equal((await session.endpoint.send('peer', 'stats', null)).heldCalls, 1)
      let exit
      let exited = false
      void session.handle.exited.then(() => {
        exited = true
      })
      if (selected === 'local-close' && mode === 'worker') {
        assert.equal(
          await session.endpoint.send('peer', 'closeLocalPort', null),
          'closing-local-port'
        )
        let peerRetired
        for (let attempt = 0; attempt < 100; attempt++) {
          try {
            peerRetired = JSON.parse(await readFile(session.fixturePaths.retired, 'utf8'))
            break
          } catch (error) {
            if (error.code !== 'ENOENT') throw error
            await delay(5)
          }
        }
        assert.ok(peerRetired, '[A7] actual child parentPort close retires its local endpoint')
        assert.equal(peerRetired.active, false)
        assert.equal(peerRetired.qualified, false)
        assert.equal(peerRetired.heldCalls, 1)
        assert.equal(exited, false, '[A7] child VM remains alive after its real local port close')
        results.push({
          mode,
          selected,
          peerRetired,
          exited,
          limitation:
            'Worker parent has no remote port-close event before VM exit; no immediate parent retirement claim'
        })
        continue
      }
      if (selected === 'terminal') {
        assert.equal(await session.endpoint.send('peer', 'naturalExit', null), 'exiting')
        exit = await session.handle.exited
      } else {
        await session.handle.channel.close()
      }
      await delay(10)
      assert.equal(
        session.receipt.active,
        false,
        '[A7] actual physical terminal retires without another frame or disposal'
      )
      assert.equal(session.receipt.qualified, false)
      if (selected === 'local-close')
        assert.equal(
          exited,
          false,
          '[A7] local physical close retires while the peer VM remains alive'
        )
      const failure = await pending
      assert.equal(
        failure,
        terminalError,
        '[A11] pending work preserves the exact original physical terminal error'
      )
      assert.equal(failure.code, mode === 'process' ? 'PROCESS_CHANNEL_CLOSED' : 'TRANSPORT')
      assert.ok(failure.stack)
      results.push({ mode, selected, exit, parent: session.snapshot(), failures: session.failures })
    } else {
      pending = session.endpoint
        .send('peer', 'hold', null, { timeoutMs: 5000 })
        .catch((error) => error)
      assert.equal((await session.endpoint.send('peer', 'stats', null)).heldCalls, 1)
      const frame = session.captures.find((value) => {
        const decoded =
          value instanceof Uint8Array
            ? JSON.parse(new TextDecoder().decode(value.subarray(4)))
            : typeof value === 'string'
              ? JSON.parse(value)
              : value
        return decoded?.method === 'hold'
      })
      assert.ok(frame)
      await session.endpoint.send('peer', 'advanceBindingClock', null)
      await session.replay(frame)
      let retired
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          retired = JSON.parse(await readFile(session.fixturePaths.retired, 'utf8'))
          break
        } catch (error) {
          if (error.code !== 'ENOENT') throw error
          await delay(5)
        }
      }
      if (!retired)
        process.stderr.write(
          JSON.stringify({
            mode,
            baselineObservation: await session.endpoint.send('peer', 'stats', null)
          }) + '\n'
        )
      assert.ok(
        retired,
        '[A7/A21] native established hard expiry retires instead of signing a new logical token'
      )
      assert.equal(
        retired.heldCalls,
        1,
        '[A8] old in-flight business ID cannot execute through a fresh token'
      )
      assert.equal(retired.active, false)
      assert.equal(retired.qualified, false)
      results.push({ mode, selected, retired })
    }
  } finally {
    removeErrorObserver?.()
    await session.close()
    await pending
  }
}
process.stdout.write(JSON.stringify({ assertions: 'A7/A8/A21', results }) + '\n')
