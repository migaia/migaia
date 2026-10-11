import { build } from 'vite'
import { chromium } from '@playwright/test'
import { createServer } from 'node:http'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMacPidObserver } from './bare-node.mjs'
import { nearestRank } from './ipc.mjs'
import { BrowserBenchText as text } from '../test/core/fixtures/da1-browser/text.mjs'

/**
 * Measure one real Chromium page/Worker pair, excluding the Node driver and trace from timing.
 *
 * @param {object} unit Frozen 64B or 1KiB static Worker cell.
 * @param {'bare' | 'rpc'} side Same business echo, independently launched browser.
 * @param {{ check?: boolean; samples?: number }} options Preparation or formal sampling.
 * @returns {Promise<object>} Raw page latencies, actual PID resources, scripts and both heaps.
 * @throws {Error} Missing target mapping, actual adapter failure or observer failure.
 */
export async function runBrowserSide(unit, side, options) {
  /** All temporary artifacts remain attached to this raw side and are retained after failure. */
  const stem = process.env.IPC_BENCH_STEM
  /** Generated bundles are retained beside this side receipt. */
  const outDir = stem + '.bundles'
  await mkdir(outDir, { recursive: true })
  /** Separate entry graphs ensure bare artifacts contain no RPC dependency. */
  const entries = Object.fromEntries(
    ['page', 'worker'].map((role) => [
      role + '-' + side,
      fileURLToPath(
        new URL('../test/core/fixtures/da1-browser/' + role + '-' + side + '.mjs', import.meta.url)
      )
    ])
  )
  await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      outDir,
      emptyOutDir: false,
      minify: false,
      target: 'esnext',
      rollupOptions: {
        input: entries,
        output: { entryFileNames: '[name].js', chunkFileNames: '[name]-[hash].js' }
      }
    }
  })
  /** HTTP carries only generated fixture scripts; isolation enables a precise page clock. */
  const server = createServer(async (request, response) => {
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
    response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
    try {
      if (request.url === '/') {
        response.setHeader('Content-Type', 'text/html')
        response.end('<script type="module" src="/page-' + side + '.js"></script>')
      } else {
        response.setHeader('Content-Type', 'text/javascript')
        response.end(await readFile(join(outDir, basename(request.url))))
      }
    } catch {
      response.statusCode = 404
      response.end()
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  /** Cleanup joins actual Chromium and the prestarted native PID observer. */
  let browser, observer
  try {
    browser = await chromium.launch({ headless: true })
    /** This isolated page owns the renderer endpoint. */
    const page = await browser.newPage()
    /** Browser exceptions are retained separately from performance ratios. */
    const errors = []
    page.on('pageerror', (error) => errors.push({ name: error.name, message: error.message }))
    /** Browser CDP identifies real process and target ownership. */
    const root = await browser.newBrowserCDPSession()
    /** Page CDP reads loaded sources and heap outside timing. */
    const pageCDP = await page.context().newCDPSession(page)
    /** Parsed script IDs are observations of actual loaded bytes, independent of build inputs. */
    const scripts = []
    pageCDP.on('Debugger.scriptParsed', (event) => scripts.push({ ...event, isolate: 'page' }))
    await pageCDP.send('Debugger.enable')
    /** Only this loopback fixture origin is served. */
    const origin = 'http://127.0.0.1:' + server.address().port
    await page.goto(origin)
    await page.waitForFunction(() => typeof globalThis.benchPrepare === 'function')
    await page.evaluate((bytes) => globalThis.benchPrepare(bytes), unit.payloadBytes)
    /** A nonflattened CDP session observes the actual Worker isolate without instrumenting RPC. */
    const targets = await root.send('Target.getTargets')
    /** The Worker target must match this side bundle exactly. */
    const target = targets.targetInfos.find(
      (item) => item.type === 'worker' && item.url === origin + '/worker-' + side + '.js'
    )
    if (!target) throw new Error(text.missing)
    const { sessionId } = await root.send('Target.attachToTarget', {
      targetId: target.targetId,
      flatten: false
    })
    /** Ordered CDP replies retain the Worker session command identity. */
    const pending = new Map()
    /** CDP IDs stay unique across this one session. */
    let sequence = 0
    root.on('Target.receivedMessageFromTarget', (event) => {
      if (event.sessionId !== sessionId) return
      /** The Worker CDP response is decoded outside formal timing. */
      const message = JSON.parse(event.message)
      if (message.method === 'Debugger.scriptParsed')
        scripts.push({ ...message.params, isolate: 'worker' })
      if (message.id) {
        /** Only the matching command can consume a reply. */
        const waiter = pending.get(message.id)
        pending.delete(message.id)
        if (message.error) waiter?.reject(new Error(JSON.stringify(message.error)))
        else waiter?.resolve(message.result)
      }
    })
    /** Every CDP operation finishes outside the formal page echo window. */
    const workerSend = (method, params = {}) =>
      new Promise((resolve, reject) => {
        /** Each control request gets a distinct CDP command ID. */
        const id = ++sequence
        pending.set(id, { resolve, reject })
        root
          .send('Target.sendMessageToTarget', {
            sessionId,
            message: JSON.stringify({ id, method, params })
          })
          .catch(reject)
      })
    await workerSend('Debugger.enable')
    /** A separate pre-window trace binds user marks to real renderer/Worker PID and thread IDs. */
    const traceDone = new Promise((resolve) => root.once('Tracing.tracingComplete', resolve))
    await root.send('Tracing.start', {
      categories: 'blink.user_timing,__metadata',
      transferMode: 'ReturnAsStream'
    })
    await page.evaluate(() => globalThis.benchMark())
    await root.send('Tracing.end')
    const { stream } = await traceDone
    /** The entire PID trace is saved before any formal exchange. */
    let traceBytes = ''
    for (;;) {
      const part = await root.send('IO.read', { handle: stream })
      traceBytes += part.base64Encoded ? Buffer.from(part.data, 'base64').toString() : part.data
      if (part.eof) break
    }
    await root.send('IO.close', { handle: stream })
    await writeFile(stem + '.pid-trace.json', traceBytes)
    /** Original diagnostic events bind both isolate marks to host PIDs. */
    const events = JSON.parse(traceBytes).traceEvents
    /** The fixture mark selects its actual PID and thread without guessing. */
    const mark = (name) => events.find((event) => event.name === name)
    /** Page and Worker marks may share one renderer PID. */
    const parent = mark('da1-page-target'),
      peer = mark('da1-worker-target')
    if (!parent?.pid || !peer?.pid) throw new Error(text.missing)
    /** All Chromium process counters remain explicit, including auxiliary processes. */
    const processInfoBefore = await root.send('SystemInfo.getProcessInfo')
    /** The browser host process is included and the Node driver is excluded. */
    const browserPid = processInfoBefore.processInfo.find((entry) => entry.type === 'browser')?.id
    if (!browserPid) throw new Error(text.missing)
    /** A shared renderer and Worker process is observed only once. */
    const pids = [...new Set([parent.pid, peer.pid, browserPid])]
    observer = await createMacPidObserver(pids)
    /** Actual executed bundle sources are fetched byte-for-byte from each isolate. */
    const loaded = []
    for (const script of scripts.filter((item) => item.url.startsWith(origin))) {
      /** The debugger supplies the actual executed script bytes. */
      const actual = await (script.isolate === 'page'
        ? pageCDP.send('Debugger.getScriptSource', { scriptId: script.scriptId })
        : workerSend('Debugger.getScriptSource', { scriptId: script.scriptId }))
      /** Built bundle bytes independently verify the loaded script digest. */
      const disk = await readFile(join(outDir, basename(new URL(script.url).pathname)))
      loaded.push({
        isolate: script.isolate,
        url: script.url,
        scriptId: script.scriptId,
        loadedSHA256: createHash('sha256').update(actual.scriptSource).digest('hex'),
        diskSHA256: createHash('sha256').update(disk).digest('hex'),
        loadedBytes: Buffer.byteLength(actual.scriptSource)
      })
    }
    if (
      !loaded.some((row) => row.isolate === 'worker') ||
      loaded.some((row) => row.loadedSHA256 !== row.diskSHA256)
    )
      throw new Error(text.missing)
    /** Source inspection ends before warmup; formal execution has no debugger/profile enabled. */
    await pageCDP.send('Debugger.disable')
    await workerSend('Debugger.disable')
    if (!options.check) await page.evaluate(() => globalThis.benchWarmup())
    /** Both isolate heaps are captured after warmup and before timing. */
    const heapBefore = {
      page: await pageCDP.send('Runtime.getHeapUsage'),
      worker: await workerSend('Runtime.getHeapUsage')
    }
    /** Native PID CPU counters start only after setup and warmup. */
    const before = await observer.read()
    /** Absolute window RSS includes every independently charged PID. */
    const peaks = new Map(before.map((row) => [row.pid, row.rssBytes]))
    /** Formal echo failure stays explicit while the observer joins. */
    let sampleError
    /** Stopping the sampler joins outstanding native reads. */
    const stop = observer.start((rows) => {
      for (const row of rows) peaks.set(row.pid, Math.max(peaks.get(row.pid), row.rssBytes))
    })
    /** One page call returns the complete internally timed echo loop. */
    let measured
    try {
      measured = await page.evaluate(
        (samples) => globalThis.benchRun(samples),
        options.check ? 3 : (options.samples ?? 1000)
      )
    } catch (error) {
      sampleError = error
    }
    /** Final CPU counters include the page evaluation boundary, not driver CPU. */
    const after = await observer.read()
    await stop()
    if (sampleError) throw sampleError
    await writeFile(stem + '.measured.json', JSON.stringify(measured))
    for (const row of after) peaks.set(row.pid, Math.max(peaks.get(row.pid), row.rssBytes))
    /** Each PID retains its own CPU delta without aggregation hiding an endpoint. */
    const cpuByPid = after.map((row) => ({
      pid: row.pid,
      cpuNs: row.cpuNs - before.find((item) => item.pid === row.pid).cpuNs
    }))
    if (cpuByPid.some((row) => row.cpuNs < 0)) throw new Error(text.cpu)
    /** Both isolate heaps are captured after the last settled echo. */
    const heapAfter = {
      page: await pageCDP.send('Runtime.getHeapUsage'),
      worker: await workerSend('Runtime.getHeapUsage')
    }
    /** Endpoint PIDs must remain present for the complete measured window. */
    const processInfoAfter = await root.send('SystemInfo.getProcessInfo')
    if (pids.some((pid) => !processInfoAfter.processInfo.some((entry) => entry.id === pid)))
      throw new Error(text.missing)
    /** Existing Worker rejection reasons are read after formal timing. */
    const peerClassification = await workerSend('Runtime.evaluate', {
      expression: 'globalThis.__IPC_BROWSER_CLASSIFICATION ?? null',
      returnByValue: true
    })
    /** Every settled raw latency is retained without replacing slow samples. */
    const samples = measured.latenciesNs.length
    /** Preparation checks real factory provenance after ordinary echoes; formal timing omits it. */
    const facadeProof = options.check
      ? await page.evaluate(() => globalThis.benchRuntimeProof?.() ?? null)
      : undefined
    return {
      type: options.check ? 'ipc-preparation' : 'ipc-side',
      ...measured,
      unit,
      side,
      samples,
      echoes: options.check ? 3 : undefined,
      ...(options.check ? { facadeProof } : {}),
      warmup: options.check ? 0 : 100,
      encodedBytes: Buffer.byteLength(JSON.stringify('x'.repeat(unit.payloadBytes))),
      concurrency: 1,
      runtime: await browser.version(),
      parentPid: parent.pid,
      peerPid: peer.pid,
      browserPid,
      pidMapping: { page: parent, worker: peer, target, processInfoBefore, processInfoAfter },
      cpuScope:
        'browser and each distinct renderer/Worker PID; driver and native observer excluded; GPU/utility counters retained separately in processInfo',
      threadCPU: { page: 'UNAVAILABLE_HOST_THREAD_API', worker: 'UNAVAILABLE_HOST_THREAD_API' },
      loaded,
      heapBefore,
      heapAfter,
      gcStatus: 'NOT_COLLECTED_FORMAL; PID trace is a separate pre-window diagnostic',
      peerClassification: peerClassification.result.value,
      errors,
      samplingMaxReplayEntriesPerPeer: 1200,
      p50Ns: nearestRank(measured.latenciesNs, 0.5, { allowClockResolutionZero: true }),
      p95Ns: nearestRank(measured.latenciesNs, 0.95, { allowClockResolutionZero: true }),
      p99Ns: nearestRank(measured.latenciesNs, 0.99, { allowClockResolutionZero: true }),
      throughputPerSecond: (samples * 1e9) / measured.elapsedNs,
      cpuByPid,
      cpuNsPerRequest: cpuByPid.reduce((sum, row) => sum + row.cpuNs, 0) / samples,
      rssPeaksByPid: [...peaks].map(([pid, rssBytes]) => ({ pid, rssBytes })),
      rssAbsolutePeakSumBytes: [...peaks.values()].reduce((sum, value) => sum + value, 0),
      observer: { method: observer.method, intervalMs: observer.intervalMs, pids }
    }
  } finally {
    if (observer) await observer.close()
    if (browser) await browser.close()
    await new Promise((resolve) => server.close(resolve))
  }
}
