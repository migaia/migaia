import { appendFileSync, writeFileSync } from 'node:fs'
import { resourceLimits, threadId } from 'node:worker_threads'
import { defineFeature, definePlugin } from '@migaia/plugin-host'
import { defineTrayHost, defineRoutingPolicy } from '@migaia/tray'
import { defineProbe } from '@migaia/rpc-host/probe'
import { FixtureText, fixtureError } from './fixture-text.mjs'

/** Pick counts stay realm-local; native child never invokes its declared callback. */
let routingPicks = 0
/** Shared declaration is automatically registered by its host DSL. */
export const toB = defineRoutingPolicy('toB', () => {
  routingPicks += 1
  return 'b'
})

/**
 * Reads this realm's actual picker invocations without introducing a production diagnostic.
 *
 * @returns {number} Picks executed by this realm's shared fixture policy.
 */
export function routingPickCount() {
  return routingPicks
}

/** Every runtime exposes the same Feature; the hidden Feature proves dispatch admission. */
export const fixtureExposes = Object.freeze(['node.svc'])

/** Child diagnostics acquire their file destination only when init supplies validated config. */
let reportMarker
/** Child message events have a destination separate from the parent's counting probe. */
let probeMarker

/**
 * Records the child runtime's original report channel, including one-way business errors.
 *
 * @param {unknown} error Original child diagnostic.
 * @returns {void} Appends classification if init supplied a marker, otherwise records stderr.
 */
export function fixtureReport(error) {
  if (reportMarker) appendFileSync(reportMarker, `${JSON.stringify(classification(error))}\n`)
  else console.error(JSON.stringify(classification(error)))
}

/** Probe attaches to serveTrayHost before init; only post-init messages reach the supplied marker. */
export const childProbe = defineProbe({
  stages: ['message'],
  emit: (event) => {
    if (probeMarker) appendFileSync(probeMarker, `${event.stage}\n`)
  }
})

/**
 * Captures a full, bounded diagnostic without leaking arbitrary input values.
 *
 * @param {unknown} value Original reported failure.
 * @param {number} [depth=0] Bounded diagnostic traversal depth. Default is `0`
 * @returns {object} Redacted classification, cause and ordered AggregateError children.
 */
export function classification(value, depth = 0) {
  /** Diagnostics are bounded and use only fixture-owned messages. */
  const error = /** @type {any} */ (value)
  return {
    name: error?.name ?? typeof value,
    source: error?.source ?? null,
    code: error?.code ?? null,
    reason: error?.reason ?? null,
    message: String(error?.message ?? value).slice(0, 200),
    ...(depth >= 10 || error?.cause === undefined
      ? {}
      : { cause: classification(error.cause, depth + 1) }),
    ...(depth >= 10 || !Array.isArray(error?.errors)
      ? {}
      : { errors: error.errors.map((item) => classification(item, depth + 1)) })
  }
}

/**
 * Creates one business plugin per init, with state owned by that exact generation.
 *
 * @param {any} info Validated instance information delivered by Tray.
 * @param {any} trayPlugin This init's genuine Tray Feature provider.
 * @returns {readonly any[]} Business plugins with their genuine Feature dependency.
 * @throws {Error} Fixture init failure, including a secondary cleanup failure when requested.
 */
export function nodePlugins(info, trayPlugin) {
  reportMarker = info.config?.reportMarker
  probeMarker = info.config?.probeMarker
  if (info.config?.failInit || (info.config?.failAfterFirst && info.generation > 1)) {
    throw fixtureError(FixtureText.initCode, FixtureText.initMessage)
  }
  /** Cancellation counts belong to the target generation, not the caller. */
  let aborted = 0
  /** Notify delivery remains observable without response semantics. */
  let noted = 0
  /** A saved child remote must retain its original parent-issued admission receipt. */
  let captured
  /** Feature creation proves init executes once for each generation. */
  let initCount = 0
  /** Business topic observations belong to this native generation's real child hub. */
  const topicMessages = []
  /** Each fixture subscription retains its actual asynchronous off receipt. */
  const topicOffs = new Map()
  /** Init cannot finish until its configured business subscription is accepted by the parent. */
  let topicInit
  /** First plugin registers cleanup before a requested second admission fails. */
  const plugin = definePlugin({
    name: 'node',
    features: {
      svc: defineFeature(
        (_core, deps) => {
          initCount += 1
          /**
           * Registers a real Tray listener and stores the parent's authenticated metadata.
           *
           * @param {any} input Topic, receipt key and optional user failure mode.
           * @returns {Promise<void>} Resolves after relay membership admission.
           */
          const subscribeTopic = async (input) => {
            /** The key identifies this local listener, never the remote generation membership. */
            const key = input.key ?? input.topic
            /** User callback failures pass through the same Tray wrapper as application listeners. */
            const off = await deps.tray.subscribe(input.topic, (payload, meta) => {
              topicMessages.push({ payload, meta, frozen: Object.isFrozen(meta) })
              if (input.throwSync)
                throw fixtureError(FixtureText.businessCode, FixtureText.businessMessage)
              if (input.rejectAsync)
                return Promise.reject(fixtureError(FixtureText.causeCode, FixtureText.causeMessage))
            })
            topicOffs.set(key, off)
          }
          if (info.config?.topic) topicInit = subscribeTopic({ topic: info.config.topic })
          return {
            /**
             * @param {any} input Business topic and portable payload. @returns {Promise<void>}
             *   Parent publish result.
             */
            topicPublish: (input) => deps.tray.publish(input.topic, input.payload),
            /**
             * @param {any} input Topic and local receipt identity. @returns {Promise<void>}
             *   Subscription result.
             */
            topicSubscribe: subscribeTopic,
            /**
             * @param {string} key Local receipt identity. @returns {Promise<void>} Idempotent local
             *   off result.
             */
            topicOff: async (key) => {
              await topicOffs.get(key)?.()
              topicOffs.delete(key)
            },
            /** @returns {readonly object[]} Current generation's genuine business deliveries. */
            topicMessages: () => [...topicMessages],
            /** @returns {object} Current generation, validated config and real native identity. */
            hello: () => ({
              ...info,
              initCount,
              pid: process.pid,
              threadId,
              resourceLimits,
              env: process.env.TRAY_SANDBOX ?? null,
              hasEmit: 'emit' in deps.tray
            }),
            /**
             * @param {unknown} value Query payload. @returns {unknown} Unchanged query paired with
             *   target identity.
             */
            search: (value) => ({ id: info.id, value }),
            /** @param {unknown} value Portable input. @returns {unknown} Unchanged input. */
            echo: (value) => value,
            /**
             * @param {string} [value] Optional payload. @returns {string|null} Exact payload or
             *   null.
             */
            optional: (value) => value ?? null,
            /**
             * @param {number} total Number of items. @returns {AsyncGenerator<number>} Ordered
             *   items.
             */
            count: async function* (total) {
              for (let index = 1; index <= total; index += 1) yield index
            },
            /**
             * @param {number} milliseconds Hold time. @param {any} context Canonical RPC
             *   cancellation context. @returns {Promise<object>} Generation that owns the receipt.
             */
            sleep: (milliseconds, context) =>
              new Promise((resolve) => {
                /** Timer belongs to this request and is released on cancellation. */
                const timer = setTimeout(() => {
                  context?.signal?.removeEventListener('abort', cancel)
                  resolve({ generation: info.generation })
                }, milliseconds)
                /** Cooperative target cancellation records receipt propagation. */
                const cancel = () => {
                  clearTimeout(timer)
                  aborted += 1
                  resolve({ generation: info.generation, aborted: true })
                }
                if (context?.signal?.aborted) cancel()
                else context?.signal?.addEventListener('abort', cancel, { once: true })
              }),
            /**
             * @param {number} milliseconds Delay between items. @returns {AsyncGenerator<object>}
             *   Generation-bound stream.
             */
            held: async function* (milliseconds) {
              yield { generation: info.generation, item: 1 }
              await new Promise((resolve) => setTimeout(resolve, milliseconds))
              yield { generation: info.generation, item: 2 }
            },
            /** @returns {number} Target-side cancellation count. */
            aborted: () => aborted,
            /** @returns {number} Successful one-way deliveries. */
            notedCount: () => noted,
            /** @returns {void} Records one-way delivery. */
            noted: () => {
              noted += 1
            },
            /** @returns {never} Throws a business error with a distinct original cause. */
            fail: () => {
              throw fixtureError(
                FixtureText.businessCode,
                FixtureText.businessMessage,
                fixtureError(FixtureText.causeCode, FixtureText.causeMessage)
              )
            },
            /** @returns {never} One-way failure must reach the target report channel. */
            notifyFail: () => {
              throw fixtureError(FixtureText.businessCode, FixtureText.businessMessage)
            },
            /**
             * @param {any} input Host name, id and query. @returns {Promise<unknown>} Target result
             *   through parent relay.
             */
            ask: async (input) =>
              (await deps.tray.to(hostByName(input.host), input.id)).request(
                'node.svc.search',
                input.value
              ),
            /**
             * @param {any} input Host name, id and item count. @returns {Promise<number[]>} Ordered
             *   relay stream.
             */
            collect: async (input) => {
              /** Items come from the remote stream, never a local fixture loop. */
              const values = []
              for await (const item of (
                await deps.tray.to(hostByName(input.host), input.id)
              ).stream('node.svc.count', input.total))
                values.push(item)
              return values
            },
            /**
             * @param {any} input Target host/id and hold duration. @param {any} context Parent
             *   request cancellation. @returns {Promise<unknown>} Relayed cancellable target
             *   request.
             */
            wait: async (input, context) =>
              (await deps.tray.to(hostByName(input.host), input.id)).request(
                'node.svc.sleep',
                input.milliseconds,
                { signal: context?.signal, timeoutMs: context?.timeoutMs }
              ),
            /**
             * @param {any} input Target host/id. @returns {Promise<never>} Target error passed
             *   through relay.
             */
            relayFail: async (input) =>
              (await deps.tray.to(hostByName(input.host), input.id)).request('node.svc.fail'),
            /**
             * @param {any} input Target host/id. @returns {Promise<void>} Real one-way relay
             *   delivery.
             */
            relayNotify: async (input) =>
              (await deps.tray.to(hostByName(input.host), input.id)).notify(
                input.fail ? 'node.svc.notifyFail' : 'node.svc.noted'
              ),
            /**
             * @param {any} input Target host/id. @returns {Promise<boolean>} Stores a parent-issued
             *   remote receipt.
             */
            capture: async (input) => {
              captured = await deps.tray.to(hostByName(input.host), input.id)
              return true
            },
            /** @returns {Promise<unknown>} Calls the original captured receipt without rebinding. */
            captured: () => captured.request('node.svc.hello'),
            /** @returns {object} Child namespace shape and local pick count. */
            routingInfo: () => ({
              picks: routingPicks,
              balanced: 'balanced' in deps.tray,
              names: Object.keys(deps.tray.routing)
            }),
            /**
             * @param {any} input Portable route. @param {any} context Provider deadline. @returns
             *   {Promise<unknown>} Routed target response.
             */
            route: (input, context) => {
              const remote = input.member
                ? deps.tray.routing[input.policy](hostByName(input.host))
                : deps.tray.routing(input.policy, hostByName(input.host))
              return remote.request(input.path ?? 'node.svc.hello', input.payload, {
                signal: context.signal,
                timeoutMs: context.timeoutMs
              })
            },
            /** @param {any} input Portable route. @returns {Promise<void>} One-way target send. */
            routeNotify: (input) =>
              deps.tray.routing(input.policy, hostByName(input.host)).notify('node.svc.noted'),
            /**
             * @param {any} input Portable route. @param {any} context Provider deadline. @returns
             *   {AsyncIterableIterator<number>} Routed target stream.
             */
            routeStream: (input, context) =>
              deps.tray.routing(input.policy, hostByName(input.host)).stream('node.svc.count', 3, {
                signal: context.signal,
                timeoutMs: context.timeoutMs
              }),
            /** @returns {void} Ends this generation as a crash using Tray's public child Feature. */
            exitCrash: () => {
              deps.tray.exit(fixtureError(FixtureText.crashCode, FixtureText.crashMessage))
              deps.tray.exit()
            },
            /** @returns {void} First clean exit wins over the immediately following crash request. */
            exitClean: () => {
              deps.tray.exit()
              deps.tray.exit(fixtureError(FixtureText.crashCode, FixtureText.crashMessage))
            },
            /**
             * @param {string} path Writable probe path. @returns {string} Native filesystem
             *   outcome.
             */
            tryWrite: (path) => {
              try {
                writeFileSync(path, 'fixture')
                return 'written'
              } catch (error) {
                return /** @type {any} */ (error).code
              }
            }
          }
        },
        { tray: trayPlugin.getFeature('tray') }
      ),
      hidden: defineFeature(() => ({ secret: () => 'hidden' }))
    },
    /**
     * @param {any} core Owning PluginHost lifecycle. @returns {Promise<object>} Waits only when
     *   init delay is configured.
     */
    install: async (core) => {
      await topicInit
      core.onDispose(() => {
        if (info.config?.cleanupMarker)
          appendFileSync(info.config.cleanupMarker, `cleanup:${info.id}:${info.generation}\n`)
        if (info.config?.cleanupFail)
          throw fixtureError(FixtureText.cleanupCode, FixtureText.cleanupMessage)
        if (info.config?.cleanupHang) return new Promise(() => {})
      })
      if (info.config?.initMarker)
        appendFileSync(
          info.config.initMarker,
          `init:${info.id}:${info.generation}:${info.config.label ?? ''}\n`
        )
      if (info.config?.launchFailureMarker)
        writeFileSync(info.config.launchFailureMarker, 'fail-next-launch')
      if (info.config?.initDelayMs)
        await new Promise((resolve) => setTimeout(resolve, info.config.initDelayMs))
      return {}
    }
  })
  if (!info.config?.rollbackFail) return [plugin]
  return [
    plugin,
    definePlugin({
      name: 'broken',
      features: {
        guard: defineFeature(() => ({}), { svc: plugin.getFeature('svc') })
      },
      install: () => {
        throw fixtureError(FixtureText.initCode, FixtureText.initMessage)
      }
    })
  ]
}

/**
 * Validates a fixture config and exposes the validator's distinct output to init assertions.
 *
 * @param {unknown} input Untrusted parent config.
 * @returns {object} Portable config with a validation marker.
 */
export function validateConfig(input) {
  return { .../** @type {object} */ (input), validated: true }
}

/** Shared business declaration keeps identical call behavior in all three native runtimes. */
const base = { plugins: nodePlugins, exposes: fixtureExposes, config: validateConfig }
/** Default runtime must be a real managed coroutine unit. */
export const nodeCo = defineTrayHost({ ...base, name: 'node-co' })
/** Genuine Node Worker loads only the child serve entry. */
export const nodeTh = defineTrayHost({
  ...base,
  routing: [toB],
  name: 'node-th',
  runtime: 'thread',
  entry: new URL('./thread-entry.mjs', import.meta.url)
})
/** Genuine Node child process loads only the child serve entry. */
export const nodePr = defineTrayHost({
  ...base,
  name: 'node-pr',
  runtime: 'process',
  entry: new URL('./process-entry.mjs', import.meta.url)
})
/** All pairwise relay cases address one of these authenticated host definitions. */
export const hosts = Object.freeze([nodeCo, nodeTh, nodePr])
/** Root integration's two agents share one omitted-runtime DSL declaration. */
export const agent = defineTrayHost({ ...base, name: 'agent' })
/** Root integration's Worker has its own named child declaration. */
export const worker = defineTrayHost({
  ...base,
  name: 'worker',
  runtime: 'thread',
  entry: new URL('./worker-entry.mjs', import.meta.url)
})
/** Root integration's process has its own named child declaration. */
export const wiki = defineTrayHost({
  ...base,
  name: 'wiki',
  runtime: 'process',
  entry: new URL('./wiki-entry.mjs', import.meta.url)
})
/** Init failure is produced inside the genuine child dispatcher. */
export const faulty = defineTrayHost({
  name: 'faulty',
  runtime: 'process',
  entry: new URL('./faulty-entry.mjs', import.meta.url),
  plugins: () => {
    throw fixtureError(FixtureText.initCode, FixtureText.initMessage)
  },
  exposes: []
})

/**
 * Resolves only fixture-owned branded host definitions for a relayed child call.
 *
 * @param {string} name Shared declaration name.
 * @returns {any} Branded host declaration.
 */
function hostByName(name) {
  return [...hosts, agent, worker, wiki].find((host) => host.name === name)
}
