import { appendFileSync, writeFileSync } from 'node:fs'
import { resourceLimits, threadId } from 'node:worker_threads'
import { defineFeature, definePlugin } from '@migaia/plugin-host'
import { defineTrayHost, defineRoutingPolicy } from '@migaia/tray'
import { defineProbe } from '@migaia/rpc-host/plugins/probe'
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
  return new NodePluginFixture(info, trayPlugin).plugins
}
/** Owns one generation's business fixture state, using the genuine per-init Tray dependency. */
class NodePluginFixture {
  /** Accepted immutable instance metadata distinguishes this native generation. */
  #info
  /** Feature reference keeps the genuine per-init client plugin dependency. */
  #trayPlugin
  /** Resolved Tray Feature is retained only after canonical dependency derivation. */
  #tray
  /** Actual target cancellation receipts are counted independently of caller completion. */
  #aborted = 0
  /** Successful one-way dispatch increments only this generation's receipt count. */
  #noted = 0
  /** Held remote retains its original parent-issued admission receipt. */
  #captured
  /** Actual Feature creation count proves one init per native generation. */
  #initCount = 0
  /** Authenticated topic observations remain local to the genuine child hub. */
  #topicMessages = []
  /** Actual off receipts are indexed by local listener identity. */
  #topicOffs = new Map()
  /** Installation waits for the configured original topic registration. */
  #topicInit
  /** Genuine business definition is retained for rollback dependency and lifecycle assertions. */
  #plugin
  /** Existing definition list remains the public fixture return value. */
  plugins
  /**
   * @param {any} info Accepted instance metadata. @param {any} trayPlugin Genuine per-init Tray
   *   Feature plugin.
   */
  constructor(info, trayPlugin) {
    this.#info = info
    this.#trayPlugin = trayPlugin
    reportMarker = this.#info.config?.reportMarker
    probeMarker = this.#info.config?.probeMarker
    if (
      this.#info.config?.failInit ||
      (this.#info.config?.failAfterFirst && this.#info.generation > 1)
    ) {
      throw fixtureError(FixtureText.initCode, FixtureText.initMessage)
    }
    this.#plugin = definePlugin({
      name: 'node',
      features: {
        svc: defineFeature((_core, deps) => this.#service(deps), {
          tray: this.#trayPlugin.getFeature('tray')
        }),
        hidden: defineFeature(() => ({ secret: () => 'hidden' }))
      },
      /**
       * @param {any} core Owning PluginHost lifecycle. @returns {Promise<object>} Waits only when
       *   init delay is configured.
       */
      install: async (core) => {
        await this.#topicInit
        core.onDispose(() => {
          if (this.#info.config?.cleanupMarker)
            appendFileSync(
              this.#info.config.cleanupMarker,
              `cleanup:${this.#info.id}:${this.#info.generation}\n`
            )
          if (this.#info.config?.cleanupFail)
            throw fixtureError(FixtureText.cleanupCode, FixtureText.cleanupMessage)
          if (this.#info.config?.cleanupHang) return new Promise(() => {})
        })
        if (this.#info.config?.initMarker)
          appendFileSync(
            this.#info.config.initMarker,
            `init:${this.#info.id}:${this.#info.generation}:${this.#info.config.label ?? ''}\n`
          )
        if (this.#info.config?.launchFailureMarker)
          writeFileSync(this.#info.config.launchFailureMarker, 'fail-next-launch')
        if (this.#info.config?.initDelayMs)
          await new Promise((resolve) => setTimeout(resolve, this.#info.config.initDelayMs))
        return {}
      }
    })
    if (!this.#info.config?.rollbackFail) {
      this.plugins = [this.#plugin]
      return
    }
    this.plugins = [
      this.#plugin,
      definePlugin({
        name: 'broken',
        features: {
          guard: defineFeature(() => ({}), { svc: this.#plugin.getFeature('svc') })
        },
        install: () => {
          throw fixtureError(FixtureText.initCode, FixtureText.initMessage)
        }
      })
    ]
  }
  /**
   * @param {any} deps Actual Feature dependency resolution. @returns {object} Original business
   *   method table.
   */
  #service(deps) {
    this.#initCount += 1
    this.#tray = deps.tray
    if (this.#info.config?.topic)
      this.#topicInit = this.#subscribeTopic({ topic: this.#info.config.topic })
    return {
      topicPublish: this.#topicPublishAction,
      topicSubscribe: this.#subscribeTopic,
      topicOff: this.#topicOffAction,
      topicMessages: this.#topicMessagesAction,
      hello: this.#helloAction,
      search: this.#searchAction,
      echo: this.#echoAction,
      optional: this.#optionalAction,

      /** @param {number} total Number of items. @returns {AsyncGenerator<number>} Ordered items. */
      count: async function* (total) {
        for (let index = 1; index <= total; index += 1) yield index
      },
      sleep: this.#sleepAction,
      held: (milliseconds) => this.#heldAction(milliseconds),
      aborted: this.#abortedAction,
      notedCount: this.#notedCountAction,
      noted: this.#notedAction,
      fail: this.#failAction,
      notifyFail: this.#notifyFailAction,
      ask: this.#askAction,
      collect: this.#collectAction,
      wait: this.#waitAction,
      relayFail: this.#relayFailAction,
      relayNotify: this.#relayNotifyAction,
      capture: this.#captureAction,
      captured: this.#capturedAction,
      routingInfo: this.#routingInfoAction,
      route: this.#routeAction,
      routeNotify: this.#routeNotifyAction,
      routeStream: this.#routeStreamAction,
      exitCrash: this.#exitCrashAction,
      exitClean: this.#exitCleanAction,
      tryWrite: this.#tryWriteAction
    }
  }
  /**
   * @param {any} input Topic and local receipt identity. @returns {Promise<void>} Original parent
   *   membership completion.
   */
  #subscribeTopic = async (input) => {
    /** The key identifies this local listener, never the remote generation membership. */
    const key = input.key ?? input.topic
    /** User callback failures pass through the same Tray wrapper as application listeners. */
    const off = await this.#tray.subscribe(input.topic, (payload, meta) => {
      this.#topicMessages.push({ payload, meta, frozen: Object.isFrozen(meta) })
      if (input.throwSync) throw fixtureError(FixtureText.businessCode, FixtureText.businessMessage)
      if (input.rejectAsync)
        return Promise.reject(fixtureError(FixtureText.causeCode, FixtureText.causeMessage))
    })
    this.#topicOffs.set(key, off)
  }

  /**
   * @param {any} input Business topic and portable payload. @returns {Promise<void>} Parent publish
   *   result.
   */
  #topicPublishAction = (input) => this.#tray.publish(input.topic, input.payload)

  /**
   * @param {string} key Local receipt identity. @returns {Promise<void>} Idempotent local off
   *   result.
   */
  #topicOffAction = async (key) => {
    await this.#topicOffs.get(key)?.()
    this.#topicOffs.delete(key)
  }

  /** @returns {readonly object[]} Current generation's genuine business deliveries. */
  #topicMessagesAction = () => [...this.#topicMessages]

  /** @returns {object} Current generation, validated config and real native identity. */
  #helloAction = () => ({
    ...this.#info,
    initCount: this.#initCount,
    pid: process.pid,
    threadId,
    resourceLimits,
    env: process.env.TRAY_SANDBOX ?? null,
    hasEmit: 'emit' in this.#tray
  })

  /**
   * @param {unknown} value Query payload. @returns {unknown} Unchanged query paired with target
   *   identity.
   */
  #searchAction = (value) => ({ id: this.#info.id, value })

  /** @param {unknown} value Portable input. @returns {unknown} Unchanged input. */
  #echoAction = (value) => value

  /** @param {string} [value] Optional payload. @returns {string|null} Exact payload or null. */
  #optionalAction = (value) => value ?? null

  /**
   * @param {number} milliseconds Hold time. @param {any} context Canonical RPC cancellation
   *   context. @returns {Promise<object>} Generation that owns the receipt.
   */
  #sleepAction = (milliseconds, context) =>
    new Promise((resolve) => {
      /** Timer belongs to this request and is released on cancellation. */
      const timer = setTimeout(() => {
        context?.signal?.removeEventListener('abort', cancel)
        resolve({ generation: this.#info.generation })
      }, milliseconds)
      /** Cooperative target cancellation records receipt propagation. */
      const cancel = () => {
        clearTimeout(timer)
        this.#aborted += 1
        resolve({ generation: this.#info.generation, aborted: true })
      }
      if (context?.signal?.aborted) cancel()
      else context?.signal?.addEventListener('abort', cancel, { once: true })
    })

  /**
   * @param {number} milliseconds Delay between items. @returns {AsyncGenerator<object>}
   *   Generation-bound stream.
   */
  async *#heldAction(milliseconds) {
    yield { generation: this.#info.generation, item: 1 }
    await new Promise((resolve) => setTimeout(resolve, milliseconds))
    yield { generation: this.#info.generation, item: 2 }
  }

  /** @returns {number} Target-side cancellation count. */
  #abortedAction = () => this.#aborted

  /** @returns {number} Successful one-way deliveries. */
  #notedCountAction = () => this.#noted

  /** @returns {void} Records one-way delivery. */
  #notedAction = () => {
    this.#noted += 1
  }

  /** @returns {never} Throws a business error with a distinct original cause. */
  #failAction = () => {
    throw fixtureError(
      FixtureText.businessCode,
      FixtureText.businessMessage,
      fixtureError(FixtureText.causeCode, FixtureText.causeMessage)
    )
  }

  /** @returns {never} One-way failure must reach the target report channel. */
  #notifyFailAction = () => {
    throw fixtureError(FixtureText.businessCode, FixtureText.businessMessage)
  }

  /**
   * @param {any} input Host name, id and query. @returns {Promise<unknown>} Target result through
   *   parent relay.
   */
  #askAction = async (input) =>
    (await this.#tray.to(hostByName(input.host), input.id)).request('node.svc.search', input.value)

  /**
   * @param {any} input Host name, id and item count. @returns {Promise<number[]>} Ordered relay
   *   stream.
   */
  #collectAction = async (input) => {
    /** Items come from the remote stream, never a local fixture loop. */
    const values = []
    for await (const item of (await this.#tray.to(hostByName(input.host), input.id)).stream(
      'node.svc.count',
      input.total
    ))
      values.push(item)
    return values
  }

  /**
   * @param {any} input Target host/id and hold duration. @param {any} context Parent request
   *   cancellation. @returns {Promise<unknown>} Relayed cancellable target request.
   */
  #waitAction = async (input, context) =>
    (await this.#tray.to(hostByName(input.host), input.id)).request(
      'node.svc.sleep',
      input.milliseconds,
      { signal: context?.signal, timeoutMs: context?.timeoutMs }
    )

  /** @param {any} input Target host/id. @returns {Promise<never>} Target error passed through relay. */
  #relayFailAction = async (input) =>
    (await this.#tray.to(hostByName(input.host), input.id)).request('node.svc.fail')

  /** @param {any} input Target host/id. @returns {Promise<void>} Real one-way relay delivery. */
  #relayNotifyAction = async (input) =>
    (await this.#tray.to(hostByName(input.host), input.id)).notify(
      input.fail ? 'node.svc.notifyFail' : 'node.svc.noted'
    )

  /**
   * @param {any} input Target host/id. @returns {Promise<boolean>} Stores a parent-issued remote
   *   receipt.
   */
  #captureAction = async (input) => {
    this.#captured = await this.#tray.to(hostByName(input.host), input.id)
    return true
  }

  /** @returns {Promise<unknown>} Calls the original captured receipt without rebinding. */
  #capturedAction = () => this.#captured.request('node.svc.hello')

  /** @returns {object} Child namespace shape and local pick count. */
  #routingInfoAction = () => ({
    picks: routingPicks,
    balanced: 'balanced' in this.#tray,
    names: Object.keys(this.#tray.routing)
  })

  /**
   * @param {any} input Portable route. @param {any} context Provider deadline. @returns
   *   {Promise<unknown>} Routed target response.
   */
  #routeAction = (input, context) => {
    const remote = input.member
      ? this.#tray.routing[input.policy](hostByName(input.host))
      : this.#tray.routing(input.policy, hostByName(input.host))
    return remote.request(input.path ?? 'node.svc.hello', input.payload, {
      signal: context.signal,
      timeoutMs: context.timeoutMs
    })
  }

  /** @param {any} input Portable route. @returns {Promise<void>} One-way target send. */
  #routeNotifyAction = (input) =>
    this.#tray.routing(input.policy, hostByName(input.host)).notify('node.svc.noted')

  /**
   * @param {any} input Portable route. @param {any} context Provider deadline. @returns
   *   {AsyncIterableIterator<number>} Routed target stream.
   */
  #routeStreamAction = (input, context) =>
    this.#tray.routing(input.policy, hostByName(input.host)).stream('node.svc.count', 3, {
      signal: context.signal,
      timeoutMs: context.timeoutMs
    })

  /** @returns {void} Ends this generation as a crash using Tray's public child Feature. */
  #exitCrashAction = () => {
    this.#tray.exit(fixtureError(FixtureText.crashCode, FixtureText.crashMessage))
    this.#tray.exit()
  }

  /** @returns {void} First clean exit wins over the immediately following crash request. */
  #exitCleanAction = () => {
    this.#tray.exit()
    this.#tray.exit(fixtureError(FixtureText.crashCode, FixtureText.crashMessage))
  }

  /** @param {string} path Writable probe path. @returns {string} Native filesystem outcome. */
  #tryWriteAction = (path) => {
    try {
      writeFileSync(path, 'fixture')
      return 'written'
    } catch (error) {
      return /** @type {any} */ (error).code
    }
  }
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
