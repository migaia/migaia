import { rpcFeaturesPlugin } from '@migaia/rpc-host/sdk'
/** One existing file-backed completed result survives the fixture's deliberate native crash. */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRpcHost } from '@migaia/rpc-host'
import { authFeature } from '@migaia/rpc-host/plugins/auth'
import { idempotencyFeature, createRpcIdempotencyStore } from '@migaia/rpc-host/plugins/idempotency'
import { processPlugin } from '@migaia/rpc-plugin-process'
/** This caller-owned temporary directory stores only test counters and completed outcomes. */
const directory = process.argv[2]
/** The tracked vector supplies the same contract used by the public client fixture. */
const contract = JSON.parse(
  readFileSync(new URL('../../../schema/vectors/remote-contract.json', import.meta.url), 'utf8')
).contracts[0].value
/** Authentication admits exactly one fixture principal; its public label contains no token. */
const principal = 'hf-authenticated-principal'
/** The canonical ledger continues to own pending claims and settlement semantics. */
const canonical = createRpcIdempotencyStore()
/** Persistent completed outcomes keep the exact canonical scope and tuple key unchanged. */
const donePath = join(directory, 'done.json')
/** A separate counter is an independently observed business side effect. */
const countPath = join(directory, 'count.txt')
/** The fixture crashes only after the first completed outcome has been persisted. */
const crashPath = join(directory, 'crashed')
/** Completed-state backing implements the existing store boundary without another ledger. */
const store = {
  /**
   * @param {string} scope The authenticated public scope supplied by core.
   * @param {string} key The canonical method/key tuple supplied by core.
   * @param {number} now The canonical monotonic claim time.
   * @param {string | undefined} fingerprint The original admitted body fingerprint.
   * @returns {import('@migaia/rpc-host/plugins/idempotency').IRpcIdempotencyClaim} Existing done
   *   outcome or canonical claim.
   */
  claim(scope, key, now, fingerprint) {
    /** The fixture retains one completed benign outcome, not request parameters or credentials. */
    const done = existsSync(donePath) ? JSON.parse(readFileSync(donePath, 'utf8')) : undefined
    if (done?.scope === scope && done.key === key && done.fingerprint === fingerprint)
      return { status: 'done', outcome: done.outcome }
    /** Every new execution still claims through the package's canonical implementation. */
    const claim = canonical.claim(scope, key, now, fingerprint)
    if (claim.status !== 'claimed') return claim
    return {
      ...claim,
      /**
       * Persist the canonical completed outcome before a deliberate real crash.
       *
       * @param {import('@migaia/rpc-host/plugins/idempotency').IRpcIdempotencyOutcome} outcome
       *   Benign fixture result.
       * @param {number} settledAt Canonical settlement timestamp.
       * @returns {void}
       */
      settle(outcome, settledAt) {
        claim.settle(outcome, settledAt)
        writeFileSync(donePath, JSON.stringify({ scope, key, fingerprint, outcome }), {
          mode: 0o600
        })
        if (!existsSync(crashPath)) {
          writeFileSync(crashPath, '1', { mode: 0o600 })
          process.stderr.write('COMMITTED_BEFORE_CRASH\n')
          process.exit(17)
        }
      }
    }
  }
}
/** The fixed business object is compiled by the actual RuntimeHost provider owner. */
const provide = {
  p: {
    f: {
      /** Increment the independent side effect only when canonical provider execution occurs. */
      request() {
        const count = existsSync(countPath) ? Number(readFileSync(countPath, 'utf8')) : 0
        writeFileSync(countPath, String(count + 1), { mode: 0o600 })
        return 'committed'
      },
      oneWay() {},
      *generator() {
        yield 'fixture'
      },
      async *asyncGenerator() {
        yield 'fixture'
      }
    }
  }
}
/** Native reports remain separate from the business count and never print fixture credentials. */
function report(error) {
  process.stderr.write(`FIXTURE_ERROR ${String(error?.code ?? 'UNKNOWN')}\n`)
}

/** The original store is installed directly on the one real public native Host. */
await createRpcHost({
  self: { name: 'ts-peer', instanceId: 'persistent-provider' },
  provide,
  contract,
  plugins: [
    rpcFeaturesPlugin({
      features: {
        auth: authFeature({
          verifyCredentials(received) {
            /** The native parent handshake authenticates bootstrap before semantic admission. */
            assert.equal(typeof received, 'string')
            return { principalId: principal }
          }
        }),
        idempotency: idempotencyFeature({
          store,
          scope(identity) {
            assert.equal(identity.principalId, principal)
            return identity.principalId
          }
        })
      }
    }),
    processPlugin({
      name: 'persistent-native-peer',
      connectToParent: true
    })
  ],
  report
})
process.stderr.write('READY\n')
