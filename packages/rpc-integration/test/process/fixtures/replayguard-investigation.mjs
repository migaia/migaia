import { Session } from 'node:inspector'
import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { orderStatistic } from '../../../bench/cross-runtime/statistics.mjs'
import { createComposedEndpoint } from '../../../../rpc-host/dist/core/composed.js'
import { createCanonicalChunkFeature } from '../../../../rpc-host/dist/core/stream/index.js'
import { createOutboundFeature } from '../../../../rpc-host/dist/core/features/outbound.js'
import { createProviderFeature } from '../../../../rpc-host/dist/core/internal/provider-feature.js'
import { createDiscoveryFeature } from '../../../../rpc-host/dist/core/features/discovery.js'
import { createControlFeature } from '../../../../rpc-host/dist/core/features/control.js'
import { createOneWayFeature } from '../../../../rpc-host/dist/core/features/one-way.js'
import { createMemoryTransportPair } from '../../../../rpc-host/test/fixtures/memory-transport.ts'
import { codec } from '../../../../rpc-host/dist/core/middleware/codec.js'
import { framer } from '../../../../rpc-host/dist/core/middleware/framer.js'
import { connect } from '../../../../rpc-host/dist/core/middleware/connect.js'
import { createStringFramer } from '@migaia/rpc-contract/framing'
import { defineJsonCodec } from '@migaia/serialize/codecs/json'
import { RpcOutboundAttachment } from '../../../../rpc-host/dist/core/internal/outbound-attachment.js'
import { RpcProviderAttachment } from '../../../../rpc-host/dist/core/internal/provider-attachment.js'
import { RpcCoreErrorText } from '../../../../rpc-host/dist/core/error-text.js'
import { createProcessTransport } from '../../../../rpc-plugin-process/dist/process/handshake.js'
import { createNativeProcessOffer } from '../../../../rpc-plugin-process/dist/process/offer.js'
import {
  createNodeProcessLauncher,
  openProcessStdioChannel
} from '../../../../rpc-plugin-process/dist/process/adapters/node-child-process.js'

/** Inspector roots belong only to this fixture; production objects are never changed. */
globalThis.replayInvestigationPrototypes = [
  RpcOutboundAttachment.prototype,
  RpcProviderAttachment.prototype
]
/** This file supplies both real Node endpoints with identical canonical setup. */
const entry = fileURLToPath(import.meta.url)
/** Fixture-only status marker separates diagnostics from production stdio frames. */
const marker = 'REPLAY_OBSERVATION '
/** Optional one-way discriminator is separate from the ten ordinary-request rate cells. */
const oneWay = process.argv.includes('--one-way')

/**
 * Summarize real settlement delays without mixing successful requests and refusals.
 *
 * @param {number[]} values Observed delays in milliseconds.
 * @returns {object} Count and nearest-rank tail metrics.
 */
function delaySummary(values) {
  /** Exact ranks preserve every observation, equal-value order and the original empty sentinel. */
  return {
    count: values.length,
    p50Ms: orderStatistic(values, Math.ceil(values.length * 0.5) - 1) ?? null,
    p99Ms: orderStatistic(values, Math.ceil(values.length * 0.99) - 1) ?? null,
    maxMs: orderStatistic(values, values.length - 1) ?? null
  }
}

/**
 * Read actual ECMAScript private collection sizes through the local inspector.
 *
 * @returns {Promise<{ sample: () => Promise<object[]>; close: () => void }>} Passive observer.
 */
async function createObserver() {
  /** Session holds inspected objects only until this process's fixture terminates. */
  const session = new Session()
  session.connect()
  /**
   * Promise bridge preserves inspector errors without swallowing them.
   *
   * @param {string} method Inspector command.
   * @param {object} params Command parameters.
   * @returns {Promise<any>} Inspector reply.
   */
  const post = (method, params) =>
    new Promise((resolve, reject) =>
      session.post(method, params, (error, reply) => (error ? reject(error) : resolve(reply)))
    )
  /** Object IDs and private collection IDs are discovered once, not on each sample. */
  const collections = []
  for (let index = 0; index < 2; index++) {
    /** Fixture-owned prototype identifies the unchanged production class. */
    const prototype = await post('Runtime.evaluate', {
      expression: `globalThis.replayInvestigationPrototypes[${index}]`
    })
    /** Heap query finds production instances without replacing any method. */
    const queried = await post('Runtime.queryObjects', {
      prototypeObjectId: prototype.result.objectId
    })
    /** Numeric own array properties contain inspected class instances. */
    const objects = await post('Runtime.getProperties', {
      objectId: queried.objects.objectId,
      ownProperties: true
    })
    for (const instance of objects.result.filter((property) => /^\d+$/u.test(property.name))) {
      /** Inspector explicitly exposes private properties without evaluating production logic. */
      const properties = await post('Runtime.getProperties', {
        objectId: instance.value.objectId,
        ownProperties: true
      })
      /** Attachment identity labels caller/provider without exposing request or peer payloads. */
      const identity =
        index === 0
          ? properties.result.find((property) => property.name === 'id')
          : properties.privateProperties?.find((property) => property.name === '#id')
      /** The canonical attachment owns exactly one unchanged replay ledger. */
      const replay = properties.privateProperties?.find((property) => property.name === '#replay')
      assert.ok(replay?.value.objectId, 'fixture cannot observe canonical replay owner')
      /** Read the owned ledger fields without touching attachment callbacks. */
      const ledgerProperties = await post('Runtime.getProperties', {
        objectId: replay.value.objectId,
        ownProperties: true
      })
      /** Keep only actual bounded ledgers, never their request keys or payloads. */
      const fields = (ledgerProperties.privateProperties ?? []).filter((property) =>
        ['#activeIds', '#releasedIds', '#completed', '#rejected'].includes(property.name)
      )
      collections.push({
        owner: index === 0 ? 'outbound' : 'inbound',
        endpoint: identity?.value.value,
        fields: fields.map((field) => ({ name: field.name, objectId: field.value.objectId }))
      })
    }
  }
  return {
    /** Sample only native Set/Map size accessors; never mutate their entries. */
    async sample() {
      /** Serial inspector reads preserve each sample's own collection labels. */
      const result = []
      for (const collection of collections) {
        /** Counts carry no IDs, peer identities, or business data. */
        const counts = { owner: collection.owner, endpoint: collection.endpoint }
        for (const field of collection.fields) {
          /** Native size getter is the sole inspected object operation. */
          const read = await post('Runtime.callFunctionOn', {
            objectId: field.objectId,
            functionDeclaration: 'function () { return this.size }',
            returnByValue: true
          })
          counts[field.name] = read.result.value
        }
        result.push(counts)
      }
      return result
    },
    close: () => session.disconnect()
  }
}

/**
 * Assemble an unchanged public endpoint and canonical JSON/framing middleware.
 *
 * @param {string} id Endpoint identity.
 * @param {object} transport Production transport.
 * @param {object | undefined} pipeline Negotiated pipeline or memory default.
 * @param {number | undefined} providerCapacity Optional public isolation configuration.
 * @param {object[]} features Authenticated channel's canonical IPC features.
 * @returns {Promise<object>} Canonical composed endpoint with the original raw v1 ledger profile.
 */
async function endpointFor(id, transport, pipeline, providerCapacity, features = []) {
  /** This raw v1 ledger oracle selects only the original provider/discovery/control facilities. */
  const chunk = createCanonicalChunkFeature()
  /** All original request/refusal namespaces share this same actual outbound ledger. */
  const outbound = createOutboundFeature(chunk)
  /** The original provider owns admission/replay counters inspected by this fixture. */
  const provider = createProviderFeature(outbound)
  /** Discovery and control remain canonical owners over this exact outbound instance. */
  const discovery = createDiscoveryFeature(outbound)
  const control = createControlFeature(outbound, discovery)
  return createComposedEndpoint({
    id,
    transport,
    features: [
      chunk,
      outbound,
      provider,
      discovery,
      control,
      ...(oneWay ? [createOneWayFeature(outbound)] : []),
      ...features
    ],
    ...(providerCapacity === undefined
      ? {}
      : { providerLimits: { maxReplayEntriesPerPeer: providerCapacity } }),
    middlewares: [
      codec(pipeline?.codec ?? defineJsonCodec({ version: 1 })),
      framer(pipeline?.framer ?? createStringFramer()),
      connect({ transport })
    ],
    ...(id === 'peer' ? { provider: { echo: (context) => context.success(context.data) } } : {})
  })
}

/**
 * Serve the real child through authenticated production native byte framing.
 *
 * @param {number | undefined} providerCapacity Optional isolation override.
 * @returns {Promise<void>} Remains live until parent closes the channel.
 */
async function serveChild(providerCapacity) {
  /** Native channel obtains no test payload through its authentication bootstrap. */
  const opened = await openProcessStdioChannel({ bootstrap: 'none' })
  /** Constant fixture auth is non-secret and never a measured request payload. */
  const channel = await createProcessTransport(opened.channel, {
    role: 'responder',
    peerId: 'parent',
    offer: createNativeProcessOffer({ peer: { id: 'peer', runtime: 'node' } }),
    auth: { mode: 'required', verify: (value) => value === 'replay-fixture' },
    report: (error) =>
      process.stderr.write(`${marker}${JSON.stringify({ report: String(error) })}\n`),
    ipc: { connectionId: 'replay', sessionId: 'replay', log: () => undefined }
  })
  /** Provider uses production defaults unless explicitly isolating outbound capacity. */
  const endpoint = await endpointFor(
    'peer',
    channel.transport,
    channel.pipeline,
    providerCapacity,
    channel.features
  )
  /** Sampling starts after real provider construction and is independent of business traffic. */
  const observer = await createObserver()
  /** At most one passive sample can run concurrently. */
  let sampling = false
  /** Five-second cadence records actual inbound counts without per-request observer overhead. */
  const timer = setInterval(async () => {
    if (sampling) return
    sampling = true
    try {
      process.stderr.write(`${marker}${JSON.stringify({ child: await observer.sample() })}\n`)
    } catch (error) {
      process.stderr.write(`${marker}${JSON.stringify({ observerError: String(error) })}\n`)
    } finally {
      sampling = false
    }
  }, 5_000)
  channel.transport.onTransportError?.(() => {
    clearInterval(timer)
    observer.close()
    void endpoint.dispose().then(
      () => process.exit(0),
      (error) => {
        process.stderr.write(`${marker}${JSON.stringify({ disposalError: String(error) })}\n`)
        process.exit(1)
      }
    )
  })
  process.stderr.write(`${marker}${JSON.stringify({ ready: true })}\n`)
}

/**
 * Own one measurement cell's observations; production endpoints retain all protocol/lifecycle
 * state.
 */
class ReplayguardMeasurement {
  /** Existing native/memory profile for this one original measurement cell. */
  #mode
  /** Original requested attempts per second. */
  #rate
  /** Original real elapsed measurement duration. */
  #durationMs
  /** Original receipt directory owned by this cell. */
  #directory
  /** Optional original provider capacity override. */
  #providerCapacity
  /** Stable original output basename is computed once before acquisition. */
  #basename
  /** Original streaming receipt remains durable across interrupted measurement. */
  #rawPath
  /** Actual settled counters remain separate from pending requests. */
  #counters = { attempted: 0, succeeded: 0, remoteRejected: 0, localRejected: 0, otherRejected: 0 }
  /** Original complete code/text counters are preserved by this structural repair. */
  #codes = {}
  /** Offline quantile samples retain their original settlement order. */
  #latencies = []
  /** Each original five-second interval owns independent latency samples. */
  #windowLatencies = { succeeded: [], remoteRejected: [], localRejected: [], otherRejected: [] }
  /** First original rejection in each namespace retains its exact elapsed observation. */
  #first = {}
  /** Original production request Promises remain tracked through settlement. */
  #pending = new Set()
  /** Passive child snapshots remain separate from protocol frames. */
  #childSample = null
  /** Incomplete native diagnostic lines carry only until their next complete delimiter. */
  #stderr = ''
  /** The native child supplies the same one-time readiness receipt. */
  #readyResolve
  /** This original barrier completes outside the timed measurement interval. */
  #ready = new Promise((resolve) => {
    this.#readyResolve = resolve
  })
  /** Original cleanup callbacks retain reverse acquisition order. */
  #cleanup = []
  /** The original production endpoint performs every attempted operation. */
  #client
  /** Inspector remains a passive observer of actual production owners. */
  #observer
  /** Original real monotonic start timestamp defines rate catch-up and elapsed evidence. */
  #started
  /** Exactly the first settled request triggers the original first-settlement snapshot. */
  #firstSettlement = null
  /** Only one original inspector sample may be active at a time. */
  #sampling = false
  /** Original preparation evidence is retained for the immutable terminal receipt. */
  #preparation

  /** Capture original cell inputs before acquiring endpoints or native resources. */
  constructor(mode, rate, durationMs, directory, providerCapacity) {
    this.#mode = mode
    this.#rate = rate
    this.#durationMs = durationMs
    this.#directory = directory
    this.#providerCapacity = providerCapacity
    this.#basename = `${mode}-${rate}-${providerCapacity ?? 'default'}`
    this.#rawPath = `${directory}/${this.#basename}.jsonl`
  }
  /** Acquire the same native/memory resources before entering the original timed interval. */
  async #prepare() {
    if (this.#mode === 'memory') {
      /** Asynchronous production memory pair is independent from native child framing. */
      const pair = createMemoryTransportPair()
      /** Provider uses unmodified production per-peer/global/TTL defaults. */
      const provider = await endpointFor('peer', pair[1], undefined, this.#providerCapacity)
      this.#client = await endpointFor('parent', pair[0])
      this.#cleanup.push(
        () => provider.dispose(),
        () => this.#client.dispose()
      )
    } else {
      /** Real owned child runs this fixture's provider branch with production dist modules. */
      const handle = await createNodeProcessLauncher().launch(
        {
          command: process.execPath,
          args: [
            entry,
            '--child',
            String(this.#providerCapacity ?? ''),
            ...(oneWay ? ['--one-way'] : [])
          ],
          env: { inherit: ['PATH'], set: {} },
          stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' }
        },
        {
          signal: new AbortController().signal,
          output: (_stream, bytes) => {
            this.#stderr += Buffer.from(bytes).toString()
            /** Only complete fixture diagnostic lines can update passive provider counts. */
            let end
            while ((end = this.#stderr.indexOf('\n')) >= 0) {
              /** Child business frames never enter stderr. */
              const line = this.#stderr.slice(0, end)
              this.#stderr = this.#stderr.slice(end + 1)
              if (!line.startsWith(marker)) {
                appendFileSync(this.#rawPath, `${JSON.stringify({ stderr: line })}\n`)
                continue
              }
              /** Fixture-owned diagnostic objects cannot contain request payloads. */
              const record = JSON.parse(line.slice(marker.length))
              if (record.ready) this.#readyResolve()
              if (record.child) this.#childSample = record.child
              else appendFileSync(this.#rawPath, `${JSON.stringify(record)}\n`)
            }
          }
        }
      )
      this.#cleanup.push(async () => {
        await handle.terminate('force')
        await handle.exited
      })
      /** Native initiator authenticates exactly the fixture responder. */
      const channel = await createProcessTransport(handle.channel, {
        role: 'initiator',
        peerId: 'peer',
        offer: {
          ...createNativeProcessOffer({ peer: { id: 'parent', runtime: 'node' } }),
          auth: 'replay-fixture'
        },
        report: (error) =>
          appendFileSync(this.#rawPath, `${JSON.stringify({ report: String(error) })}\n`),
        ipc: { connectionId: 'replay', sessionId: 'replay', log: () => undefined }
      })
      this.#cleanup.push(() => channel.close())
      this.#client = await endpointFor(
        'parent',
        channel.transport,
        channel.pipeline,
        undefined,
        channel.features
      )
      this.#cleanup.push(() => this.#client.dispose())
      await Promise.race([
        this.#ready,
        new Promise((_resolve, reject) =>
          setTimeout(() => {
            try {
              assert.fail('fixture child readiness timeout')
            } catch (error) {
              reject(error)
            }
          }, 30_000).unref()
        )
      ])
    }
  }
  /** Preserve each original production request Promise, settlement and refusal classification. */
  /** Catch handlers preserve every refusal and never create an unhandled rejection. */
  #attempt() {
    /** Attempt sequence is unique fixture data and never part of identity instrumentation. */
    const value = this.#counters.attempted++
    /** Latency starts before the production outbound capacity check. */
    const sentAt = performance.now()
    /** Production Promise is tracked unchanged until settlement. */
    const request = oneWay
      ? this.#client.sendOneWay('peer', 'echo', value)
      : this.#client.send('peer', 'echo', value, { timeoutMs: 10_000 })
    this.#pending.add(request)
    request
      .then(
        async (result) => {
          if (!oneWay) assert.equal(result, value, 'fixture echo mismatch')
          this.#counters.succeeded++
          this.#windowLatencies.succeeded.push(performance.now() - sentAt)
          if (this.#firstSettlement === null) {
            this.#firstSettlement = { pending: true }
            this.#firstSettlement = {
              elapsedMs: performance.now() - this.#started,
              counters: { ...this.#counters },
              snapshot: await this.#observer.sample()
            }
            appendFileSync(
              this.#rawPath,
              `${JSON.stringify({ firstSettlement: this.#firstSettlement })}\n`
            )
          }
        },
        (error) => {
          /** Canonical text identifies provenance even when both endpoints use OVERLOADED. */
          const kind =
            error.message === RpcCoreErrorText.outboundReplayFull
              ? 'localRejected'
              : error.code === 'OVERLOADED'
                ? 'remoteRejected'
                : 'otherRejected'
          this.#counters[kind]++
          this.#windowLatencies[kind].push(performance.now() - sentAt)
          this.#codes[`${kind}:${error.source ?? ''}:${error.code ?? ''}:${error.message}`] =
            (this.#codes[`${kind}:${error.source ?? ''}:${error.code ?? ''}:${error.message}`] ??
              0) + 1
          this.#first[kind] ??= {
            elapsedMs: performance.now() - this.#started,
            attempted: this.#counters.attempted,
            code: error.code,
            source: error.source,
            message: error.message
          }
        }
      )
      .then(
        () => {
          this.#pending.delete(request)
          this.#latencies.push(performance.now() - sentAt)
        },
        (error) => {
          this.#pending.delete(request)
          appendFileSync(this.#rawPath, `${JSON.stringify({ fixtureFailure: String(error) })}\n`)
        }
      )
  }

  /** Read original five-second distributions without changing production collections. */
  async #sample() {
    if (this.#sampling) return
    this.#sampling = true
    try {
      /** Keep each five-second distribution separate, then start the next actual-time window. */
      const delays = Object.fromEntries(
        Object.entries(this.#windowLatencies).map(([kind, values]) => {
          /** Transfer only fixture-owned samples; no production collections are changed. */
          const result = delaySummary(values)
          values.length = 0
          return [kind, result]
        })
      )
      appendFileSync(
        this.#rawPath,
        `${JSON.stringify({ elapsedMs: performance.now() - this.#started, counters: { ...this.#counters }, pending: this.#pending.size, delays, parent: await this.#observer.sample(), child: this.#childSample })}\n`
      )
    } catch (error) {
      appendFileSync(this.#rawPath, `${JSON.stringify({ observerError: String(error) })}\n`)
    } finally {
      this.#sampling = false
    }
  }
  /** Drive the original real-time sender and sampler, then drain their existing requests. */
  async #window() {
    /** Cached inspector IDs are discovered before the measured wall-clock window. */
    this.#observer = await createObserver()
    /** Complete control-plane identity, executable and load evidence for reproducibility. */
    this.#preparation = {
      mode: this.#mode,
      oneWay,
      rate: this.#rate,
      durationMs: this.#durationMs,
      providerCapacity: this.#providerCapacity ?? 1024,
      outboundCapacity: 4096,
      ttlMs: 310000,
      pid: process.pid,
      node: process.version,
      uptime: execFileSync('uptime', { encoding: 'utf8' }).trim(),
      date: new Date().toISOString(),
      initial: await this.#observer.sample()
    }
    appendFileSync(this.#rawPath, `${JSON.stringify({ preparation: this.#preparation })}\n`)
    /** Real monotonic elapsed time defines attempts, TTL observations and the duration stop. */
    this.#started = performance.now()
    /**
     * Immediately sample the first settled request to distinguish active release from capacity
     * release.
     */
    this.#firstSettlement = null

    /** Interval only schedules real attempts; catch-up never changes the logical clock. */
    const sender = setInterval(
      () => {
        /** Catch up scheduled attempts while retaining their actual timestamps and latency. */
        const due = Math.floor(
          (Math.min(this.#durationMs, performance.now() - this.#started) * this.#rate) / 1000
        )
        while (this.#counters.attempted < due) this.#attempt()
      },
      Math.min(10, 1000 / this.#rate)
    )

    const sampler = setInterval(() => this.#sample(), 5_000)
    await new Promise((resolve) => setTimeout(resolve, this.#durationMs))
    clearInterval(sender)
    clearInterval(sampler)
    /** Last scheduled requests settle under the unchanged production request deadline. */
    await Promise.allSettled(this.#pending)

    await this.#summarize()
  }
  /** Summarize all original observations with a fixed number of exact linear rank selections. */
  async #summarize() {
    /** Final passive snapshot occurs before owner disposal clears all state. */
    const final = await this.#observer.sample()
    /** Tail selections include refusals, with success/refusal counts kept separate. */
    /** Immutable terminal receipt links all sampled states to the real measurement window. */
    const summary = {
      ...this.#preparation,
      elapsedMs: performance.now() - this.#started,
      counters: this.#counters,
      codes: this.#codes,
      first: this.#first,
      firstSettlement: this.#firstSettlement,
      final,
      child: this.#childSample,
      pending: this.#pending.size,
      p50Ms: orderStatistic(this.#latencies, Math.ceil(this.#latencies.length * 0.5) - 1),
      p99Ms: orderStatistic(this.#latencies, Math.ceil(this.#latencies.length * 0.99) - 1),
      maxMs: orderStatistic(this.#latencies, this.#latencies.length - 1),
      endUptime: execFileSync('uptime', { encoding: 'utf8' }).trim()
    }
    writeFileSync(
      `${this.#directory}/${this.#basename}.json`,
      `${JSON.stringify(summary, null, 2)}\n`
    )
    process.stdout.write(`${JSON.stringify(summary)}\n`)
  }
  /** Disconnect passive inspection and preserve every original reverse-order cleanup diagnostic. */
  async #close() {
    this.#observer?.close()
    /** Preserve cleanup failures as diagnostics while always releasing the real child. */
    const cleanupFailures = []
    for (const close of this.#cleanup.reverse()) {
      try {
        await close()
      } catch (error) {
        cleanupFailures.push(String(error))
      }
    }
    if (cleanupFailures.length) process.stderr.write(`${JSON.stringify({ cleanupFailures })}\n`)
  }
  /** Execute the same bounded cell while always releasing its original acquisitions. */
  async run() {
    mkdirSync(this.#directory, { recursive: true })
    try {
      await this.#prepare()
      await this.#window()
    } finally {
      await this.#close()
    }
  }
}

/**
 * Measure one rate for real elapsed time, without changing clocks or capacity defaults.
 *
 * @param {string} mode Memory or Node child.
 * @param {number} rate Requested attempts per second.
 * @param {number} durationMs Real measurement duration.
 * @param {string} directory Receipt directory.
 * @param {number | undefined} providerCapacity Optional outbound isolation override.
 * @returns {Promise<void>} Full immutable raw and summary receipts written.
 */
async function measure(mode, rate, durationMs, directory, providerCapacity) {
  await new ReplayguardMeasurement(mode, rate, durationMs, directory, providerCapacity).run()
}

if (process.argv[2] === '--child') await serveChild(Number(process.argv[3]) || undefined)
else
  await measure(
    process.argv[2],
    Number(process.argv[3]),
    Number(process.argv[4]),
    process.argv[5],
    Number(process.argv[6]) || undefined
  )
