import { readFileSync } from 'node:fs'
import { inspect } from 'node:util'
import { serializeRpcError, isRpcTimeoutError } from '@migaia/rpc-contract/errors'
import { PluginHost, definePlugin, defineFeature } from '@migaia/plugin-host'
import { createRpcHost } from '@migaia/rpc-host'
import { auth } from '@migaia/rpc-host/plugins/auth'
import { idempotency } from '@migaia/rpc-host/plugins/idempotency'
import { limits } from '@migaia/rpc-host/plugins/limits'
import { defineFlowFeature, RpcFlowPoint, RpcFlowLayer } from '@migaia/rpc-host/sdk'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { openProcessStdioChannel } from '../../../../rpc-plugin-process/dist/process/adapters/node-child-process.js'
import { decodeProcessRuntimeBootstrap } from '../../../../rpc-plugin-process/dist/process/runtime-bootstrap.js'
import { createProcessCleanupError } from '../../../../rpc-plugin-process/dist/process/error.js'
/** The published vector owns every original business method and mode. */
const contract = JSON.parse(
  readFileSync(new URL('../../../schema/vectors/remote-contract.json', import.meta.url), 'utf8')
).contracts[0].value
/** CLI selects native acquisition and original scenarios, never secret material. */
const [mode, address] = process.argv.slice(2)
/** Original provider receipts remain in the actual child PID. Missing authority facts stay absent. */
const state = {
  executions: 0,
  contexts: [],
  aborts: [],
  replacements: 0,
  revision: 0,
  frames: [],
  reports: []
}
/** No new fixture fallback is substituted for the unavailable native health receiver. */
const control = { health: undefined }
/** Stdio bootstrap remains native launch custody, independent from semantic grammar. */
const opened = mode === 'stderr' ? await openProcessStdioChannel({ bootstrap: 'stdin' }) : undefined
/** Structured bootstrap supplies the original physical identity and mandatory token. */
const bootstrap =
  opened && opened.bootstrap[0] === 123
    ? decodeProcessRuntimeBootstrap(opened.bootstrap)
    : undefined
/** Socket secrets arrive only through the original private read-only descriptor. */
const credentials = opened
  ? { alice: bootstrap?.token ?? new TextDecoder().decode(opened.bootstrap) }
  : JSON.parse(readFileSync(3, 'utf8'))
/** Keep complete original native failure evidence; fixture never redacts a faulty owner for it. */
function report(error) {
  state.reports.push({
    inspected: inspect(error, { depth: null, showHidden: true }),
    wire: serializeRpcError(error, { report: () => undefined })
  })
  process.stderr.write(`ISOLATION_REPORT:${String(error?.code ?? 'UNKNOWN')}\n`)
}
/** The original verifier remains strict; only successful authentication yields its stable principal. */
function verifyCredentials(value) {
  if (value === credentials.alice) return 'alice'
  if (value === credentials.bob && credentials.bob !== undefined) return 'bob'
  throw new Error(String(value))
}
/** Only the actual successful verifier lends the public authentication principal to this Session. */
function authenticateCredentials(value) {
  return { principalId: verifyCredentials(value) }
}

/** Application receipts project the current public context fields without minting session facts. */
function sessionContext(context) {
  return {
    connectionId: context.connectionId,
    sessionId: context.sessionId,
    principalId: context.principalId
  }
}
/** Observe only admitted canonical envelope facts, without inventing a session identity. */
function observeFrames() {
  return {
    stages: {
      [RpcFlowPoint.envelopeInbound]: {
        layer: RpcFlowLayer.wire,
        stage(payload, next) {
          state.frames.push({
            sessionId:
              payload.context.session?.authentication?.sessionId ?? payload.context.carrierId,
            kind: payload.prepared.message.kind,
            id: payload.prepared.message.id ?? null
          })
          return next(payload)
        }
      }
    }
  }
}

/** One real PluginHost owns each target instance; providers borrow only its installed outputs. */
class IsolationTarget {
  /** Actual native replacement/disposal stays with this original PluginHost. */
  host = new PluginHost({ execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } })
  /** Output is captured only when the real Feature install occurs, never from a candidate DTO. */
  #output
  /** Return the currently installed business object after native Feature construction. */
  get output() {
    return this.#output
  }
  /** Build one actual target definition with the revision captured for that generation. */
  definition() {
    const revision = state.revision
    return definePlugin({
      name: 'p',
      install: () => ({}),
      features: {
        f: defineFeature(() => {
          const output = {
            async request(input, context) {
              if (input === 'stats') return { ...state, pid: process.pid }
              if (input?.[0] === 'health') {
                queueMicrotask(() =>
                  control.health?.({
                    targetName: 'p',
                    connectionId: input[1],
                    reason: new Error('explicit fixture health event')
                  })
                )
                return true
              }
              if (input === 'stderr') {
                /** Separate writes deliberately split every potential six-character token window. */
                for (const part of credentials.alice.match(/.{1,3}/g)) {
                  process.stderr.write(part)
                  await new Promise((resolve) => setTimeout(resolve, 5))
                }
                return true
              }
              state.executions += 1
              state.contexts.push({ method: 'request', ...sessionContext(context) })
              if (input?.[0] === 'wait') {
                await new Promise((resolve) =>
                  context.signal.addEventListener(
                    'abort',
                    () => {
                      state.aborts.push({
                        label: input[1],
                        ...sessionContext(context),
                        code: context.signal.reason?.code ?? null,
                        message: context.signal.reason?.message ?? null,
                        localTimeout: isRpcTimeoutError(context.signal.reason)
                      })
                      resolve()
                    },
                    { once: true }
                  )
                )
              }
              return {
                input,
                execution: state.executions,
                revision,
                session: sessionContext(context)
              }
            },
            oneWay(input, context) {
              state.contexts.push({ method: 'oneWay', input, ...sessionContext(context) })
            },
            *generator(input, context) {
              state.contexts.push({ method: 'generator', ...sessionContext(context) })
              yield { input, session: sessionContext(context) }
            },
            async *asyncGenerator(input, context) {
              state.contexts.push({ method: 'asyncGenerator', ...sessionContext(context) })
              yield { input, session: sessionContext(context) }
            }
          }
          this.#output = output
          return output
        })
      }
    })
  }
  /** Install the original target before any session can register business methods. */
  async start() {
    await this.host.use(this.definition())
  }
}

/** One original application target still constructs its actual Feature outputs. */
const sharedTarget = new IsolationTarget()
await sharedTarget.start()
/** Native lifecycle borrows actual Host and application target owners, with one close Promise. */
class IsolationService {
  /** Public Host creation is the only handshake/session/provider owner in this fixture. */
  #opening
  /** Every SIGTERM/EOF joins the same cleanup transaction. */
  #closing
  /** Public providers pass the genuine IRpcContext unchanged; no session/principal DTO is minted. */
  constructor() {
    const feature = sharedTarget.output
    this.#opening = createRpcHost({
      self: bootstrap?.self ?? { name: 'ts-peer', instanceId: 'ts-peer' },
      contract,
      provide: {
        p: {
          f: {
            request: (params, context) => feature.request(params[0], context),
            oneWay: (params, context) => feature.oneWay(params[0], context),
            generator: (params, context) => feature.generator(params[0], context),
            asyncGenerator: (params, context) => feature.asyncGenerator(params[0], context)
          }
        }
      },
      plugins: [
        auth({ verifyCredentials: authenticateCredentials }),
        idempotency(),
        limits({ maxConsecutiveTimeouts: 3 }),
        defineFlowFeature({ name: 'isolation-envelope-observer', setup: observeFrames }),
        processPlugin({
          name: 'p',
          report,
          ...(opened
            ? {
                connect: {
                  target: {
                    kind: 'connect',
                    address: 'native-isolation-stdio',
                    token: credentials.alice,
                    dial: async () => opened.channel
                  }
                }
              }
            : { listen: address, token: credentials.alice, verify: verifyCredentials })
        })
      ],
      report
    })
  }
  /** Publish the original readiness marker only after genuine native installation finishes. */
  async ready() {
    await this.#opening
    process.stderr.write(`ISOLATION_READY:${process.pid}\n`)
  }
  /** Close actual RPC work before releasing the original application Host. */
  close = () => {
    this.#closing ??= this.#release()
    return this.#closing
  }
  /** Retain primary cleanup order and original Process aggregate error semantics. */
  async #release() {
    const errors = []
    try {
      await (await this.#opening).close()
    } catch (error) {
      errors.push(error)
    }
    try {
      await sharedTarget.host.dispose()
    } catch (error) {
      errors.push(error)
    }
    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) throw createProcessCleanupError(errors)
  }
}
/** One native fixture lifetime joins both explicit termination and physical stdio loss. */
const service = new IsolationService()
await service.ready()
if (opened)
  opened.channel.onClose(() => {
    void service.close().then(
      () => process.exit(0),
      (error) => {
        report(error)
        process.exit(1)
      }
    )
  })
process.on('SIGTERM', () => {
  void service.close().then(
    () => process.exit(0),
    (error) => {
      report(error)
      process.exit(1)
    }
  )
})
