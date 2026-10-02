import { Session } from 'node:inspector'
import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createFullEndpoint, createFullOneWayEndpoint } from '../../../dist/core/full.js'
import { createMemoryTransportPair } from '../../../dist/core/adapters/memory.js'
import { codec } from '../../../dist/core/middleware/codec.js'
import { framer } from '../../../dist/core/middleware/framer.js'
import { connect } from '../../../dist/core/middleware/connect.js'
import { createStringFramer } from '../../../dist/contract/framing/index.js'
import { defineJsonCodec } from '@migaia/serialize/codecs/json'
import { RpcOutboundAttachment } from '../../../dist/core/internal/outbound-attachment.js'
import { RpcProviderAttachment } from '../../../dist/core/internal/provider-attachment.js'
import { RpcCoreErrorText } from '../../../dist/core/error-text.js'
import { createProcessTransport } from '../../../dist/process/handshake.js'
import { createNativeProcessOffer } from '../../../dist/process/offer.js'
import {
  createNodeProcessLauncher,
  openProcessStdioChannel
} from '../../../dist/process/adapters/node-child-process.js'

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
  /** Sorting a copy leaves the caller's streaming accumulation unchanged. */
  const sorted = [...values].sort((left, right) => left - right)
  return {
    count: sorted.length,
    p50Ms: sorted[Math.ceil(sorted.length * 0.5) - 1] ?? null,
    p99Ms: sorted[Math.ceil(sorted.length * 0.99) - 1] ?? null,
    maxMs: sorted.at(-1) ?? null
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
 * @returns {Promise<object>} Production full endpoint.
 */
async function endpointFor(id, transport, pipeline, providerCapacity, features = []) {
  /** Public one-way preset is used only for the explicitly labelled release discriminator. */
  const create = oneWay ? createFullOneWayEndpoint : createFullEndpoint
  return create({
    id,
    transport,
    features,
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
  mkdirSync(directory, { recursive: true })
  /** Each cell owns fresh endpoints and fresh default replay windows. */
  const basename = `${mode}-${rate}-${providerCapacity ?? 'default'}`
  /** Streaming receipts survive interruption and contain only counters, codes and fixture text. */
  const rawPath = `${directory}/${basename}.jsonl`
  /** Parent counters identify local outbound refusal separately from remote rejection. */
  const counters = {
    attempted: 0,
    succeeded: 0,
    remoteRejected: 0,
    localRejected: 0,
    otherRejected: 0
  }
  /** Every observed semantic error code receives its own count. */
  const codes = {}
  /** Delay distribution stores one small scalar per settled fixture request. */
  const latencies = []
  /** Separate five-second success/refusal tails reveal latency changes before capacity refusal. */
  const windowLatencies = {
    succeeded: [],
    remoteRejected: [],
    localRejected: [],
    otherRejected: []
  }
  /** Exact first occurrences locate each independently bounded namespace's exhaustion. */
  const first = {}
  /** Pending requests detect silent blocking instead of treating it as success. */
  const pending = new Set()
  /** Raw production provider snapshots arrive on a separate stderr channel. */
  let childSample = null
  /** Readiness and observer diagnostics are parsed independently of production frames. */
  let stderr = ''
  /** A real child only needs endpoint readiness before its first attempt. */
  let readyResolve
  /** Child readiness has an explicit preparation deadline, outside the measured duration. */
  const ready = new Promise((resolve) => {
    readyResolve = resolve
  })
  /** Canonical transports and endpoint disposal are owned by this cell. */
  const cleanup = []
  /** Client endpoint is always production createFullEndpoint, never a mock. */
  let client
  /** Observer is disconnected even when preparation or measurement fails. */
  let observer
  try {
    if (mode === 'memory') {
      /** Asynchronous production memory pair is independent from native child framing. */
      const pair = createMemoryTransportPair()
      /** Provider uses unmodified production per-peer/global/TTL defaults. */
      const provider = await endpointFor('peer', pair[1], undefined, providerCapacity)
      client = await endpointFor('parent', pair[0])
      cleanup.push(
        () => provider.dispose(),
        () => client.dispose()
      )
    } else {
      /** Real owned child runs this fixture's provider branch with production dist modules. */
      const handle = await createNodeProcessLauncher().launch(
        {
          command: process.execPath,
          args: [
            entry,
            '--child',
            String(providerCapacity ?? ''),
            ...(oneWay ? ['--one-way'] : [])
          ],
          env: { inherit: ['PATH'], set: {} },
          stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' }
        },
        {
          signal: new AbortController().signal,
          output: (_stream, bytes) => {
            stderr += Buffer.from(bytes).toString()
            /** Only complete fixture diagnostic lines can update passive provider counts. */
            let end
            while ((end = stderr.indexOf('\n')) >= 0) {
              /** Child business frames never enter stderr. */
              const line = stderr.slice(0, end)
              stderr = stderr.slice(end + 1)
              if (!line.startsWith(marker)) {
                appendFileSync(rawPath, `${JSON.stringify({ stderr: line })}\n`)
                continue
              }
              /** Fixture-owned diagnostic objects cannot contain request payloads. */
              const record = JSON.parse(line.slice(marker.length))
              if (record.ready) readyResolve()
              if (record.child) childSample = record.child
              else appendFileSync(rawPath, `${JSON.stringify(record)}\n`)
            }
          }
        }
      )
      cleanup.push(async () => {
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
          appendFileSync(rawPath, `${JSON.stringify({ report: String(error) })}\n`),
        ipc: { connectionId: 'replay', sessionId: 'replay', log: () => undefined }
      })
      cleanup.push(() => channel.close())
      client = await endpointFor(
        'parent',
        channel.transport,
        channel.pipeline,
        undefined,
        channel.features
      )
      cleanup.push(() => client.dispose())
      await Promise.race([
        ready,
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
    /** Cached inspector IDs are discovered before the measured wall-clock window. */
    observer = await createObserver()
    /** Complete control-plane identity, executable and load evidence for reproducibility. */
    const preparation = {
      mode,
      oneWay,
      rate,
      durationMs,
      providerCapacity: providerCapacity ?? 1024,
      outboundCapacity: 4096,
      ttlMs: 310000,
      pid: process.pid,
      node: process.version,
      uptime: execFileSync('uptime', { encoding: 'utf8' }).trim(),
      date: new Date().toISOString(),
      initial: await observer.sample()
    }
    appendFileSync(rawPath, `${JSON.stringify({ preparation })}\n`)
    /** Real monotonic elapsed time defines attempts, TTL observations and the duration stop. */
    const started = performance.now()
    /**
     * Immediately sample the first settled request to distinguish active release from capacity
     * release.
     */
    let firstSettlement = null
    /** Catch handlers preserve every refusal and never create an unhandled rejection. */
    function attempt() {
      /** Attempt sequence is unique fixture data and never part of identity instrumentation. */
      const value = counters.attempted++
      /** Latency starts before the production outbound capacity check. */
      const sentAt = performance.now()
      /** Production Promise is tracked unchanged until settlement. */
      const request = oneWay
        ? client.sendOneWay('peer', 'echo', value)
        : client.send('peer', 'echo', value, { timeoutMs: 10_000 })
      pending.add(request)
      request
        .then(
          async (result) => {
            if (!oneWay) assert.equal(result, value, 'fixture echo mismatch')
            counters.succeeded++
            windowLatencies.succeeded.push(performance.now() - sentAt)
            if (firstSettlement === null) {
              firstSettlement = { pending: true }
              firstSettlement = {
                elapsedMs: performance.now() - started,
                counters: { ...counters },
                snapshot: await observer.sample()
              }
              appendFileSync(rawPath, `${JSON.stringify({ firstSettlement })}\n`)
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
            counters[kind]++
            windowLatencies[kind].push(performance.now() - sentAt)
            codes[`${kind}:${error.source ?? ''}:${error.code ?? ''}:${error.message}`] =
              (codes[`${kind}:${error.source ?? ''}:${error.code ?? ''}:${error.message}`] ?? 0) + 1
            first[kind] ??= {
              elapsedMs: performance.now() - started,
              attempted: counters.attempted,
              code: error.code,
              source: error.source,
              message: error.message
            }
          }
        )
        .then(
          () => {
            pending.delete(request)
            latencies.push(performance.now() - sentAt)
          },
          (error) => {
            pending.delete(request)
            appendFileSync(rawPath, `${JSON.stringify({ fixtureFailure: String(error) })}\n`)
          }
        )
    }
    /** Interval only schedules real attempts; catch-up never changes the logical clock. */
    const sender = setInterval(
      () => {
        /** Catch up scheduled attempts while retaining their actual timestamps and latency. */
        const due = Math.floor((Math.min(durationMs, performance.now() - started) * rate) / 1000)
        while (counters.attempted < due) attempt()
      },
      Math.min(10, 1000 / rate)
    )
    /** Sampling and request scheduling never share mutable production state. */
    let sampling = false
    /** Five-second raw series crosses the real 310-second retention boundary. */
    const sampler = setInterval(async () => {
      if (sampling) return
      sampling = true
      try {
        /** Keep each five-second distribution separate, then start the next actual-time window. */
        const delays = Object.fromEntries(
          Object.entries(windowLatencies).map(([kind, values]) => {
            /** Transfer only fixture-owned samples; no production collections are changed. */
            const result = delaySummary(values)
            values.length = 0
            return [kind, result]
          })
        )
        appendFileSync(
          rawPath,
          `${JSON.stringify({ elapsedMs: performance.now() - started, counters: { ...counters }, pending: pending.size, delays, parent: await observer.sample(), child: childSample })}\n`
        )
      } catch (error) {
        appendFileSync(rawPath, `${JSON.stringify({ observerError: String(error) })}\n`)
      } finally {
        sampling = false
      }
    }, 5_000)
    await new Promise((resolve) => setTimeout(resolve, durationMs))
    clearInterval(sender)
    clearInterval(sampler)
    /** Last scheduled requests settle under the unchanged production request deadline. */
    await Promise.allSettled(pending)
    /** Final passive snapshot occurs before owner disposal clears all state. */
    const final = await observer.sample()
    /** Tail quantiles include refusals, with success/refusal counts kept separate. */
    const sorted = [...latencies].sort((left, right) => left - right)
    /** Immutable terminal receipt links all sampled states to the real measurement window. */
    const summary = {
      ...preparation,
      elapsedMs: performance.now() - started,
      counters,
      codes,
      first,
      firstSettlement,
      final,
      child: childSample,
      pending: pending.size,
      p50Ms: sorted[Math.ceil(sorted.length * 0.5) - 1],
      p99Ms: sorted[Math.ceil(sorted.length * 0.99) - 1],
      maxMs: sorted.at(-1),
      endUptime: execFileSync('uptime', { encoding: 'utf8' }).trim()
    }
    writeFileSync(`${directory}/${basename}.json`, `${JSON.stringify(summary, null, 2)}\n`)
    process.stdout.write(`${JSON.stringify(summary)}\n`)
  } finally {
    observer?.close()
    /** Preserve cleanup failures as diagnostics while always releasing the real child. */
    const cleanupFailures = []
    for (const close of cleanup.reverse()) {
      try {
        await close()
      } catch (error) {
        cleanupFailures.push(String(error))
      }
    }
    if (cleanupFailures.length) process.stderr.write(`${JSON.stringify({ cleanupFailures })}\n`)
  }
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
