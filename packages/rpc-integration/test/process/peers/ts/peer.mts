import { rpcFeaturesPlugin } from '@migaia/rpc-host/sdk'
import { createRpcHost, type IRpcContext, type IRpcProvide } from '@migaia/rpc-host'
import { authFeature } from '@migaia/rpc-host/plugins/auth'

import { processPlugin } from '@migaia/rpc-plugin-process'
import { defineFlowFeature, RpcFlowPoint } from '@migaia/rpc-host/sdk'
import {
  RpcCoreErrorCode,
  RPC_ENDPOINT_ERROR_SOURCE,
  type IRpcCoreErrorCode
} from '@migaia/rpc-contract/error-code'
import { serializeRpcError } from '@migaia/rpc-contract/errors'
import type { IRpcProviderDeclaration } from '@migaia/rpc-contract/protocol'
import { attachErrorIdentity } from '@migaia/utils/error'
import { deferred } from '@migaia/utils/promise'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { openProcessStdioChannel } from '../../../../../rpc-plugin-process/dist/process/adapters/node-child-process.js'
import { dialProcessByteChannel } from '../../../../../rpc-plugin-process/dist/process/adapters/node-socket.js'
import { decodeProcessRuntimeBootstrap } from '../../../../../rpc-plugin-process/dist/process/runtime-bootstrap.js'
import type { IProcessByteChannel } from '../../../../../rpc-plugin-process/dist/process/types.js'
import { PeerMethod, PeerText } from './text.js'

/** Preserve the fixture's original native diagnostic family and exact cause objects. */
function peerDiagnosticError(code: IRpcCoreErrorCode, message: string, cause?: unknown): Error {
  const error = new Error(message, cause === undefined ? undefined : { cause })
  error.name = PeerText.rpcDiagnosticFamily
  return attachErrorIdentity(error, { source: RPC_ENDPOINT_ERROR_SOURCE, code })
}
/** Native CLI options select only real IO, bootstrap and the original fixture business declaration. */
const { values } = parseArgs({
  options: {
    stdio: { type: 'boolean' },
    descendant: { type: 'boolean' },
    'peer-id': { type: 'string', default: 'caller' },
    role: { type: 'string', default: 'responder' },
    'listen-unix': { type: 'string' },
    'connect-unix': { type: 'string' },
    host: { type: 'boolean' },
    contract: { type: 'string' },
    'non-idempotent-request': { type: 'boolean' },
    bootstrap: { type: 'string', default: 'none' },
    'auth-fd': { type: 'string' },
    wire: { type: 'string', default: 'native' }
  }
})
/** Report only stable codes; secret-bearing input and exception messages never enter stderr. */
const report = (error: unknown): void => {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : 'UNKNOWN'
  process.stderr.write(`${PeerText.failurePrefix}${String(code)}\n`)
}
/** Original vector remains the application-level declaration, independent from the wire grammar. */
const declaredContract = JSON.parse(
  readFileSync(
    values.contract ??
      (process.env.RPC_PEERS_VECTOR_ROOT
        ? join(process.env.RPC_PEERS_VECTOR_ROOT, 'remote-contract.json')
        : new URL('../../../../schema/vectors/remote-contract.json', import.meta.url)),
    'utf8'
  )
).contracts[0].value as IRpcProviderDeclaration
/** Only the requested test declaration changes replay authorization; execution remains the same. */
const contract: IRpcProviderDeclaration = values['non-idempotent-request']
  ? {
      ...declaredContract,
      features: {
        f: {
          methods: {
            ...declaredContract.features.f!.methods,
            request: { mode: 'request', idempotent: false }
          }
        }
      }
    }
  : declaredContract

/** Original executable business state is shared across actual accepted sockets. */
class PeerBusinessState {
  /** Provider-observed notifications remain independent from physical notify completion. */
  readonly received: unknown[] = []
  /** Original provider cancellation reasons are queried by later real requests. */
  readonly aborts: unknown[] = []
  /** Cleanup receipts describe actual Host.close calls and settlements after physical EOF. */
  readonly cleanups: Array<{ calls: number; settled: number; providerAborts: number }> = []
  /** Pending native fault belongs to the next real response write, not to a simulated protocol ACK. */
  #fault: string | undefined

  /** The same declared application methods execute through production ProviderDispatcher. */
  readonly provide: IRpcProvide = {
    p: {
      f: {
        request: (payload: unknown) => (payload as unknown[])[0],
        oneWay: (payload: unknown) => {
          this.received.push((payload as unknown[])[0])
        },
        generator: (payload: unknown) => this.#generator(payload),
        asyncGenerator: (payload: unknown) => this.#asyncGenerator(payload)
      }
    },
    echo: (payload: unknown) => payload,
    peer: {
      received: () => ({ count: this.received.length, values: this.received }),
      aborts: () => this.aborts,
      trace: (_payload: unknown, context: IRpcContext) => context.trace ?? null,
      error: () => {
        throw peerDiagnosticError(
          RpcCoreErrorCode.internal,
          PeerText.error,
          peerDiagnosticError(RpcCoreErrorCode.internal, PeerText.cause)
        )
      },
      wait: (_payload: unknown, context: IRpcContext) => this.#wait(context),
      busy: () => this.#scheduleFault(PeerMethod.busy),
      pause: () => this.#scheduleFault(PeerMethod.pause),
      crash: () => this.#scheduleFault(PeerMethod.crash)
    }
  };
  /** Stream order/cardinality remain the original independent business oracle. */
  *#generator(payload: unknown): Generator<unknown> {
    const input = (payload as unknown[])[0]
    yield* Array.isArray(input) ? input : [input, input, input]
  }
  /** Async generators retain their original separate execution mode. */
  async *#asyncGenerator(payload: unknown): AsyncGenerator<unknown> {
    const input = (payload as unknown[])[0]
    for (const value of Array.isArray(input) ? input : [input, input, input]) yield value
  }
  /** Observe the actual provider signal once; EOF and wire cancellation use the same native reason. */
  #wait(context: IRpcContext): Promise<unknown> {
    return new Promise((resolve) => {
      const finish = () => {
        const wire = serializeRpcError(context.signal.reason, {
          report: ({ error }) => report(error)
        })
        this.aborts.push(wire)
        resolve(context.signal.reason)
      }
      if (context.signal.aborted) finish()
      else context.signal.addEventListener('abort', finish, { once: true })
    })
  }
  /** The fixture response value is original business data; native action waits for physical write. */
  #scheduleFault(method: string): string {
    this.#fault = method
    return PeerText.ack
  }
  /** Run only after the same original native write has completed. */
  afterWrite(): void {
    const fault = this.#fault
    this.#fault = undefined
    if (!fault) return
    if (fault === PeerMethod.crash) process.exit(17)
    if (fault === PeerMethod.pause) process.kill(process.pid, 'SIGSTOP')
    else
      for (;;) {
        /* Native CPU fault lasts until this fixture's owner terminates the process. */
      }
  }
}
/** One executable retains its original shared business state across connections. */
const business = new PeerBusinessState()

/** Return original authentication roots so each real Host assembles one native feature carrier. */
function peerAuthenticationFeatures(
  token: string | undefined
): Readonly<Record<string, ReturnType<typeof authFeature>>> {
  return token === undefined
    ? {}
    : {
        authentication: authFeature({
          credentials: token,
          verifyCredentials(received) {
            if (received !== token)
              throw peerDiagnosticError(
                RpcCoreErrorCode.authenticationFailed,
                PeerText.authRejected
              )
          }
        })
      }
}

/** The canonical listener owns physical IO; its real frame completion retains delayed native faults. */
const listenerFaults = defineFlowFeature({
  phase: 1000,
  name: 'ts-peer-after-write',
  setup: () => ({
    stages: {
      [RpcFlowPoint.frameOutbound]: async (payload, next) => {
        await next(payload)
        business.afterWrite()
      }
    }
  })
})

/** One actual native channel owns one production Host and its original EOF cleanup receipt. */
class ForeignPeerSession {
  /** This is the genuine createRpcHost opening operation, never an endpoint projection. */
  readonly opening: ReturnType<typeof createRpcHost>
  /** EOF receipt is published before close so tests can join exact native cleanup. */
  readonly ended = deferred<void>()
  /** Exactly one cleanup operation serves explicit and physical EOF shutdown. */
  #closed: Promise<void> | undefined
  /** An admitted service is counted only after its actual public constructor succeeds. */
  #cleanup: { calls: number; settled: number; providerAborts: number } | undefined

  /** Authenticate inherited credentials explicitly; the native Process recipe still owns IO. */
  constructor(
    raw: IProcessByteChannel,
    token: string | undefined,
    self: Readonly<{ name?: string; instanceId: string }> = {
      name: 'ts-peer',
      instanceId: 'ts-peer'
    }
  ) {
    const write = raw.write
    const channel = {
      ...raw,
      write: async (chunk: Uint8Array, options: Parameters<typeof write>[1]) => {
        await write(chunk, options)
        business.afterWrite()
      }
    }
    raw.onClose(() => {
      this.ended.resolve()
      void this.close().catch(report)
    })
    this.opening = createRpcHost({
      self: { ...self, name: self.name ?? 'ts-peer' },
      provide: { p: business.provide.p! },
      contract,
      plugins: [
        ...(token === undefined
          ? []
          : [rpcFeaturesPlugin({ features: peerAuthenticationFeatures(token) })]),
        processPlugin({
          name: 'foreign-native-peer',
          connect: {
            target: {
              kind: 'connect',
              address: 'native-foreign-peer',
              token: token ?? 'native-interop-local-recipe',
              dial: async () => channel
            }
          }
        })
      ],
      report
    })
  }
  /** Count only successfully admitted public services. */
  async ready(): Promise<void> {
    const host = await this.opening
    /** Independent peer methods are published outside the p-only contract whitelist. */
    host.provide({ echo: business.provide.echo!, peer: business.provide.peer! })
    this.#cleanup = { calls: 0, settled: 0, providerAborts: 0 }
    business.cleanups.push(this.#cleanup)
  }
  /** Original public service release precedes native channel cleanup and keeps one Promise. */
  close = (): Promise<void> => {
    return (this.#closed ??= this.#release())
  }
  /** Provider abort observations are sampled only after the actual Host has settled close. */
  async #release(): Promise<void> {
    const host = await this.opening
    if (this.#cleanup) this.#cleanup.calls += 1
    await host.close()
    if (this.#cleanup) {
      this.#cleanup.settled += 1
      this.#cleanup.providerAborts = business.aborts.length
    }
  }
}

/** Original native bootstrap is distinct from the removed semantic v1 profile. */
function bootstrapIdentity(bytes: Uint8Array | undefined) {
  if (!bytes) return { token: undefined, self: { name: 'ts-peer', instanceId: 'ts-peer' } }
  /** Structured launch metadata uses its one production native parser and exact self facts. */
  if (bytes[0] === 123) return decodeProcessRuntimeBootstrap(bytes)
  return {
    token: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    self: { name: 'ts-peer', instanceId: 'ts-peer' }
  }
}

/** Native stdio/socket acquisition remains package-owned; the public Host owns the sole protocol. */
async function main(): Promise<void> {
  if (values.wire !== 'native') {
    process.stderr.write(PeerText.bridgeUnsupported)
    process.exitCode = 2
    return
  }
  if (values['listen-unix']) {
    const token = values['auth-fd'] ? readFileSync(Number(values['auth-fd']), 'utf8') : undefined
    if (token === undefined) {
      process.stderr.write(PeerText.listenerUnsupported)
      process.exitCode = 2
      return
    }
    /** Listener admission must accept the client's native proof, rather than initiate another proof. */
    const host = await createRpcHost({
      self: { name: 'ts-peer', instanceId: 'ts-peer' },
      provide: { p: business.provide.p! },
      contract,
      plugins: [
        rpcFeaturesPlugin({ features: { listenerFaults, ...peerAuthenticationFeatures(token) } }),
        processPlugin({ name: 'foreign-native-peer', listen: values['listen-unix'], token })
      ],
      report
    })
    /** Independent methods retain the same explicit public registration after p is installed. */
    host.provide({ echo: business.provide.echo!, peer: business.provide.peer! })
    process.stderr.write(`${PeerText.ready}${process.pid}\n`)
    return
  }
  const opened = values['connect-unix']
    ? { channel: await dialProcessByteChannel({ address: values['connect-unix'] }) }
    : await openProcessStdioChannel({ bootstrap: values.bootstrap === 'stdin' ? 'stdin' : 'none' })
  const identity = bootstrapIdentity('bootstrap' in opened ? opened.bootstrap : undefined)
  const session = new ForeignPeerSession(opened.channel, identity.token, identity.self)
  process.stderr.write(`${PeerText.ready}${process.pid}\n`)
  await session.ready()
  if (values.role === 'initiator') {
    const host = await session.opening
    const payload = { echo: 'typescript', number: 1 }
    try {
      const answer = await host.process.request(PeerMethod.echo, payload, {
        timeout: { ms: 3000 }
      })
      if (JSON.stringify(answer) !== JSON.stringify(payload))
        throw peerDiagnosticError(RpcCoreErrorCode.internal, PeerText.mismatch)
      process.stderr.write(PeerText.result)
    } finally {
      await session.close()
    }
  } else {
    const child = values.descendant ? spawn('/bin/sleep', ['600'], { stdio: 'ignore' }) : undefined
    const exited = child ? once(child, 'exit') : undefined
    try {
      await session.ended.promise
      await session.close()
    } finally {
      child?.kill()
      await exited
    }
  }
  process.stderr.write(PeerText.cleanupPrefix + JSON.stringify(business.cleanups) + '\n')
}
main().catch((error: unknown) => {
  report(error)
  process.exitCode = 1
})
