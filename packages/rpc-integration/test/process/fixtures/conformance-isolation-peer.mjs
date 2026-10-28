import { readFileSync } from 'node:fs'
import { inspect } from 'node:util'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { serializeRpcError, isRpcTimeoutError } from '@migaia/rpc-contract/errors'
import { PluginHost, definePlugin, defineFeature } from '@migaia/plugin-host'
import { createRpcHost } from '@migaia/rpc-host'
import { authFeature } from '@migaia/rpc-host/plugins/auth'
import { idempotencyFeature } from '@migaia/rpc-host/plugins/idempotency'
import { limitsFeature } from '@migaia/rpc-host/plugins/limits'
import { defineFlowFeature, RpcFlowPoint, RpcFlowLayer, RpcEventByteIO } from '@migaia/rpc-host/sdk'
import { processPlugin } from '@migaia/rpc-plugin-process'
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
  frames: [],
  reports: []
}
/** Socket secrets arrive only through the original private read-only descriptor. */
const credentials = mode === 'stderr' ? {} : JSON.parse(readFileSync(3, 'utf8'))
/** These fixture-native cleanup errors carry no production error identity or protocol meaning. */
const fixtureCleanupText = 'isolation fixture cleanup failed'
/** Only Node socket acquisition uses this local terminal value; Session errors remain original. */
const fixtureSocketClosed = 'isolation accepted socket closed'
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
  /**
   * This actual application target instance is distinct from native Session and principal
   * identities.
   */
  #instanceId = randomUUID()
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
    /** Stats identify the real target whose native PluginHost installed these original providers. */
    const targetInstance = this.#instanceId
    return definePlugin({
      name: 'p',
      install: () => ({}),
      features: {
        f: defineFeature(() => {
          const output = {
            async request(input, context) {
              if (input === 'stats') return { ...state, pid: process.pid, targetInstance }
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
const sharedTarget = mode === 'per-connection' ? undefined : new IsolationTarget()
await sharedTarget?.start()
/** Native lifecycle borrows actual Host and application target owners, with one close Promise. */
class IsolationService {
  /** This service owns its actual application target, whether shared or one accepted connection. */
  #target
  /** Public Host creation is the only handshake/session/provider owner in this fixture. */
  #opening
  /** Every SIGTERM/EOF joins the same cleanup transaction. */
  #closing
  /** Public providers pass the genuine IRpcContext unchanged; no session/principal DTO is minted. */
  constructor(target = sharedTarget, ingress) {
    this.#target = target
    const feature = target.output
    this.#opening = createRpcHost({
      ...(mode === 'stderr' ? {} : { self: { name: 'ts-peer', instanceId: 'ts-peer' } }),
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
        authFeature({
          ...(mode === 'stderr'
            ? {
                /**
                 * The production parent bootstrap lends its real private token through this public
                 * resolver.
                 */
                credentials(context) {
                  credentials.alice = context.credentials
                  return context.credentials
                }
              }
            : {}),
          verifyCredentials: authenticateCredentials,
          /** This completed-frame replay case explicitly selects the documented retained-ID mode. */
          retain: mode === 'replay' ? 310_000 : false
        }),
        idempotencyFeature(),
        limitsFeature({ maxConsecutiveTimeouts: 3 }),
        defineFlowFeature({ name: 'isolation-envelope-observer', setup: observeFrames }),
        processPlugin({
          name: 'p',
          report,
          ...(mode === 'stderr'
            ? { connectToParent: true }
            : { listen: ingress ?? address, token: credentials.alice, verify: verifyCredentials })
        })
      ],
      report
    })
  }
  /** Publish the original readiness marker only after genuine native installation finishes. */
  async ready(publish = true) {
    await this.#opening
    if (publish) process.stderr.write(`ISOLATION_READY:${process.pid}\n`)
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
      await this.#target.host.dispose()
    } catch (error) {
      errors.push(error)
    }
    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) throw new AggregateError(errors, fixtureCleanupText)
  }
}

/**
 * Real Node accepts select one independent public Host; production still owns every handshake and
 * Session.
 */
class PerConnectionIsolationService {
  /** This fixture alone owns accepting and final shutdown of the external listening socket. */
  #server = createServer({ pauseOnConnect: true }, (socket) => this.#connection(socket))
  /** Installed application Hosts own only their original accepted physical connection. */
  #services = new Set()
  /** Preparations are retained until their actual public Host construction settles. */
  #accepting = new Set()
  /** Repeated SIGTERM joins one native server/Host cleanup transaction. */
  #closing

  /** Publish readiness only after the actual native listener has bound its owned address. */
  async ready() {
    this.#server.listen(address)
    await once(this.#server, 'listening')
    process.stderr.write(`ISOLATION_READY:${process.pid}\n`)
  }

  /** Observe both outcomes without leaving an unhandled preparation rejection. */
  #connection(socket) {
    const opening = this.#accept(socket)
    this.#accepting.add(opening)
    void opening.then(
      () => this.#accepting.delete(opening),
      (error) => {
        this.#accepting.delete(opening)
        report(error)
      }
    )
  }

  /**
   * Deliver one real pending socket through the public full-listen recipe, without decoding any
   * bytes.
   */
  async #accept(socket) {
    const raw = new RpcEventByteIO(socket, socket, () => socket.destroy(), {
      closedError: () => new Error(fixtureSocketClosed),
      report
    }).value
    const target = new IsolationTarget()
    let service
    try {
      await target.start()
      if (this.#closing) {
        await raw.close()
        await target.host.dispose()
        return
      }
      const connectionId = randomUUID()
      const pending = { accept: (adopt) => adopt(raw), close: () => raw.close() }
      service = new IsolationService(target, {
        kind: 'listener',
        address,
        verify: verifyCredentials,
        async listen(options) {
          /** Acquisition resolves before the single native candidate enters production admission. */
          setImmediate(() => {
            void Promise.resolve(options.onConnection(pending)).catch(report)
          })
          /** The outer listener stays fixture-owned; the adopted raw belongs to the real Session. */
          return { address, close: async () => undefined }
        },
        createConnectionContext: () => ({
          peerId: connectionId,
          ipc: { connectionId, sessionId: connectionId, log() {} }
        })
      })
      this.#services.add(service)
      raw.onClose(() => {
        void service.close().then(() => this.#services.delete(service), report)
      })
      await service.ready(false)
    } catch (error) {
      await raw.close()
      if (service) await service.close()
      else await target.host.dispose()
      throw error
    }
  }

  /** Stop accepting first, then join original Hosts and physical native release. */
  close = () => (this.#closing ??= Promise.resolve().then(() => this.#release()))

  /** Accepted Sessions close through their original public Hosts, never by killing the provider PID. */
  async #release() {
    const stopped = new Promise((resolve, reject) => {
      this.#server.close((error) => (error ? reject(error) : resolve()))
    })
    await Promise.all([...this.#services].map((service) => service.close()))
    await Promise.allSettled(this.#accepting)
    await stopped
  }
}
/** One native fixture lifetime joins both explicit termination and physical stdio loss. */
const service =
  mode === 'per-connection' ? new PerConnectionIsolationService() : new IsolationService()
await service.ready()
process.on('SIGTERM', () => {
  void service.close().then(
    () => process.exit(0),
    (error) => {
      report(error)
      process.exit(1)
    }
  )
})
