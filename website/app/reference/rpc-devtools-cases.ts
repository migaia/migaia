import type { ICaseDoc } from './contract.js'

/** Public endpoint traffic and explicit offline records prove separate diagnostic boundaries. */
export const rpcDevtoolsCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
  createRpcDevtools: [
    {
      title: {
        en: 'Keep recent RPC events without losing cumulative call counts',
        zh: '保留最近调用事件并维持累计调用计数'
      },
      problem: {
        en: 'Long-running diagnostics need recent events, but the total call count must not disappear when older events leave the screen.\n\nUsing one bounded event list as the source of every statistic makes cumulative counts shrink whenever old entries are evicted.\n\nAttach the collector through probePlugin to a real Endpoint; maxEvents bounds query retention while stats keeps completed method counts separately.',
        zh: '长期诊断需要保留最近事件，但旧事件离开列表时，累计调用数不能跟着减少。\n\n如果所有统计都从同一个有界事件列表重新计算，列表一淘汰旧记录，累计值也就变小了。\n\n通过 `probePlugin` 把 collector 接到真实 Endpoint；`maxEvents` 限制查询保留量，`stats` 独立累计已经结束的方法调用。'
      },
      example: {
        en: "import { createEndpoint, connect } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\nimport { probePlugin } from '@migaia/rpc-core/probe'\nimport { createRpcDevtools } from '@migaia/rpc-devtools'\n\nconst devtools = createRpcDevtools({ stages: ['message'], maxEvents: 2 })\nconst [left, right] = createMemoryTransportPair()\nconst server = await createEndpoint({\n  id: 'server',\n  transport: right,\n  middlewares: [connect()],\n  provider: { double: (context) => context.success((context.data as number) * 2) }\n})\nconst client = await createEndpoint({\n  id: 'client',\n  transport: left,\n  middlewares: [connect(), probePlugin(devtools)]\n})\ntry {\n  for (const value of [1, 2, 3]) await client.send('server', 'double', value)\n  const page = devtools.query({ methods: ['double'], limit: 2 })\n  console.log(page.events.length)\n  console.log(devtools.stats().methods.find((row) => row.method === 'double')?.calls)\n  console.log(page.counters.evicted > 0)\n} finally {\n  await Promise.all([client.dispose(), server.dispose()])\n  devtools.close()\n  left.close()\n}",
        zh: "import { createEndpoint, connect } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\nimport { probePlugin } from '@migaia/rpc-core/probe'\nimport { createRpcDevtools } from '@migaia/rpc-devtools'\n\nconst devtools = createRpcDevtools({ stages: ['message'], maxEvents: 2 })\nconst [left, right] = createMemoryTransportPair()\nconst server = await createEndpoint({\n  id: 'server',\n  transport: right,\n  middlewares: [connect()],\n  provider: { double: (context) => context.success((context.data as number) * 2) }\n})\nconst client = await createEndpoint({\n  id: 'client',\n  transport: left,\n  middlewares: [connect(), probePlugin(devtools)]\n})\ntry {\n  for (const value of [1, 2, 3]) await client.send('server', 'double', value)\n  const page = devtools.query({ methods: ['double'], limit: 2 })\n  console.log(page.events.length)\n  console.log(devtools.stats().methods.find((row) => row.method === 'double')?.calls)\n  console.log(page.counters.evicted > 0)\n} finally {\n  await Promise.all([client.dispose(), server.dispose()])\n  devtools.close()\n  left.close()\n}"
      },
      result: {
        en: 'The output is 2, 3, true: two recent events remain, all three completed calls are counted, and older entries have been evicted.\n\nThe example overrides the default 10000-event ring with capacity 2 and selects message events only. Aggregates survive eviction until clear; this is a retention guarantee, not a total process-memory bound.',
        zh: '输出 `2`、`3`、`true`：只保留两个最近事件，累计值仍记录三次已完成调用，并且确实淘汰过旧事件。\n\n本例把默认 `10000` 事件容量改为 `2`，只选 `message` 阶段。累计统计保留到 `clear` 才清空；这是保留语义，不是整个进程的内存上限。'
      }
    },
    {
      title: {
        en: 'Clear the live view without ending an active recording',
        zh: '清空实时视图而不中断已有录制'
      },
      problem: {
        en: 'An operator clears a noisy live view while a recording window must keep the evidence collected before that reset.\n\nSharing the same storage for display and recording lets a harmless UI reset erase the investigation data.\n\nStart record with its own capacity, observe a real request, and clear the main collector before stopping and exporting that recording.',
        zh: '操作员要清掉嘈杂的实时视图，但已经开始的录制仍需保留清空之前的调查证据。\n\n显示和录制若共用一份存储，一个看似无害的界面重置就会擦掉录制数据。\n\n给 `record` 单独设置容量，采集真实请求后先清主环，再停止并导出已有录制。'
      },
      example: {
        en: "import { createEndpoint, connect } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\nimport { probePlugin } from '@migaia/rpc-core/probe'\nimport { createRpcDevtools } from '@migaia/rpc-devtools'\n\nconst devtools = createRpcDevtools({ stages: ['message'], maxEvents: 2 })\nconst [left, right] = createMemoryTransportPair()\nconst server = await createEndpoint({\n  id: 'server',\n  transport: right,\n  middlewares: [connect()],\n  provider: { echo: (context) => context.success(context.data) }\n})\nconst client = await createEndpoint({\n  id: 'client',\n  transport: left,\n  middlewares: [connect(), probePlugin(devtools)]\n})\ntry {\n  const recording = devtools.record({ maxEvents: 64 })\n  await client.send('server', 'echo', 42)\n  devtools.clear()\n  console.log(devtools.query().events.length, devtools.stats().methods.length)\n  const record = recording.stop()\n  const restored = devtools.importRecord(devtools.exportRecord(record))\n  console.log(record.events.length > 0)\n  console.log(restored.events.length === record.events.length)\n} finally {\n  await Promise.all([client.dispose(), server.dispose()])\n  devtools.close()\n  left.close()\n}",
        zh: "import { createEndpoint, connect } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\nimport { probePlugin } from '@migaia/rpc-core/probe'\nimport { createRpcDevtools } from '@migaia/rpc-devtools'\n\nconst devtools = createRpcDevtools({ stages: ['message'], maxEvents: 2 })\nconst [left, right] = createMemoryTransportPair()\nconst server = await createEndpoint({\n  id: 'server',\n  transport: right,\n  middlewares: [connect()],\n  provider: { echo: (context) => context.success(context.data) }\n})\nconst client = await createEndpoint({\n  id: 'client',\n  transport: left,\n  middlewares: [connect(), probePlugin(devtools)]\n})\ntry {\n  const recording = devtools.record({ maxEvents: 64 })\n  await client.send('server', 'echo', 42)\n  devtools.clear()\n  console.log(devtools.query().events.length, devtools.stats().methods.length)\n  const record = recording.stop()\n  const restored = devtools.importRecord(devtools.exportRecord(record))\n  console.log(record.events.length > 0)\n  console.log(restored.events.length === record.events.length)\n} finally {\n  await Promise.all([client.dispose(), server.dispose()])\n  devtools.close()\n  left.close()\n}"
      },
      result: {
        en: "The output is 0 0, true, true: the main ring and statistics are empty, the independent record still contains events, and its exported text imports with the same event count.\n\nrecord capacity defaults to the collector's maxEvents; this example sets it to 64. clear does not end recording or reset sequence numbers; stop is single-use and close discards an active recording.",
        zh: '输出 `0 0`、`true`、`true`：主环与统计已清空，独立录制仍保留事件，导出文本再导入后事件数一致。\n\n录制容量默认继承 collector 的 `maxEvents`，本例改为 `64`；`clear` 不结束录制，也不重置序号，`stop` 只能成功执行一次，`close` 会丢弃尚未停止的录制。'
      }
    }
  ],
  encodeRpcDevtoolsRecord: [
    {
      title: {
        en: 'Round-trip captured bytes and a native error chain',
        zh: '往返保存捕获字节与原生错误链'
      },
      problem: {
        en: 'An offline diagnostic file must retain byte payloads and the cause behind a failed operation.\n\nOrdinary JSON turns typed bytes into object fields and loses non-enumerable Error properties, leaving the imported incident incomplete.\n\nEncode the full v1 record with encodeRpcDevtoolsRecord and decode it through the matching codec, which handles reserved byte tags and the native error graph.',
        zh: '离线诊断文件既要保存字节载荷，也要保留失败操作背后的原始原因。\n\n直接使用普通 JSON 会把类型化字节变成对象字段，并丢掉 Error 的不可枚举属性，导入后的事故信息因此不完整。\n\n把完整 v1 记录交给 `encodeRpcDevtoolsRecord`，再用配套解码器读取，编解码器负责保留字节标签与原生错误图。'
      },
      example: {
        en: "import * as format from '@migaia/rpc-devtools/contract'\n\nconst causeText = 'invalid field'\nconst failureText = 'request failed'\nconst cause = new TypeError(causeText)\nconst failure = new Error(failureText, { cause })\nObject.defineProperties(cause, { source: { value: 'example' }, code: { value: 'FIELD' } })\nObject.defineProperties(failure, { source: { value: 'example' }, code: { value: 'REQUEST' } })\nconst text = format.encodeRpcDevtoolsRecord({\n  header: format.RpcDevtoolsRecordFormat,\n  events: [\n    {\n      seq: 1,\n      at: 10,\n      endpointId: 'client',\n      stage: 'message',\n      direction: 'outbound',\n      content: new Uint8Array([1, 2, 3]),\n      error: failure\n    }\n  ]\n})\nconst restored = format.decodeRpcDevtoolsRecord(text)\nconst error = restored.events[0]?.error\nconsole.log(error instanceof Error, error instanceof Error && error.cause instanceof TypeError)\nconsole.log(error instanceof Error && error.stack === failure.stack)\nconsole.log([...(restored.events[0]?.content as Uint8Array)].join(','))",
        zh: "import * as format from '@migaia/rpc-devtools/contract'\n\nconst causeText = '字段无效'\nconst failureText = '请求失败'\nconst cause = new TypeError(causeText)\nconst failure = new Error(failureText, { cause })\nObject.defineProperties(cause, { source: { value: 'example' }, code: { value: 'FIELD' } })\nObject.defineProperties(failure, { source: { value: 'example' }, code: { value: 'REQUEST' } })\nconst text = format.encodeRpcDevtoolsRecord({\n  header: format.RpcDevtoolsRecordFormat,\n  events: [\n    {\n      seq: 1,\n      at: 10,\n      endpointId: 'client',\n      stage: 'message',\n      direction: 'outbound',\n      content: new Uint8Array([1, 2, 3]),\n      error: failure\n    }\n  ]\n})\nconst restored = format.decodeRpcDevtoolsRecord(text)\nconst error = restored.events[0]?.error\nconsole.log(error instanceof Error, error instanceof Error && error.cause instanceof TypeError)\nconsole.log(error instanceof Error && error.stack === failure.stack)\nconsole.log([...(restored.events[0]?.content as Uint8Array)].join(','))"
      },
      result: {
        en: 'The output is true true, true, then 1,2,3: decoding restores the native Error and TypeError cause, keeps the recorded stack, and restores the byte values.\n\nThe codec transforms an offline representation and performs no file I/O. A sole $bytes object is reserved v1 syntax; arbitrary objects, prototypes, and functions do not have a general lossless round-trip guarantee.',
        zh: '输出 `true true`、`true`、`1,2,3`：解码还原 Error 及其 TypeError 原因，保留记录中的堆栈，并还原字节值。\n\n编解码器只转换离线表示，不执行文件读写；单键 `$bytes` 对象属于 v1 保留语法，不保证任意对象、原型和函数都能无损往返。'
      }
    }
  ],
  createRpcDevtoolsHub: [
    {
      title: {
        en: 'Sort a nonmonotonic recording before limiting the timeline',
        zh: '先排序非单调录制再限制时间线结果'
      },
      problem: {
        en: 'An imported recording has timestamps out of sequence, but the operator asks for the earliest two events.\n\nTaking two rows before sorting can return a later event while silently excluding an earlier retained one.\n\nImport the valid recording as an offline target; timeline sorts all retained candidates before applying its result limit.',
        zh: '导入录制的时间戳并不按事件序号递增，操作员却要查看时间最早的两个事件。\n\n如果先截取两行再排序，就可能显示较晚的事件，把仍在录制中的更早事件漏掉。\n\n把合法录制导入为离线目标，`timeline` 会先排列保留的候选事件，再应用结果数量限制。'
      },
      example: {
        en: "import { createRpcDevtoolsHub } from '@migaia/rpc-devtools/hub'\nimport * as format from '@migaia/rpc-devtools/contract'\n\nconst text = format.encodeRpcDevtoolsRecord({\n  header: format.RpcDevtoolsRecordFormat,\n  events: [50, 10, 30].map((at, index) => ({\n    seq: index + 1,\n    at,\n    endpointId: 'client',\n    stage: 'message',\n    direction: 'outbound'\n  }))\n})\nconst hub = createRpcDevtoolsHub()\ntry {\n  hub.importRecord('saved', text)\n  console.log(hub.status('saved'))\n  const events = hub.timeline({ targets: ['saved'], limit: 2 })\n  console.log(events.map((event) => event.alignedAt).join(','))\n  console.log(events.every((event) => event.uncertaintyMs === undefined))\n  console.log((await hub.stats('saved')).methods.length)\n} finally {\n  await hub.close()\n}",
        zh: "import { createRpcDevtoolsHub } from '@migaia/rpc-devtools/hub'\nimport * as format from '@migaia/rpc-devtools/contract'\n\nconst text = format.encodeRpcDevtoolsRecord({\n  header: format.RpcDevtoolsRecordFormat,\n  events: [50, 10, 30].map((at, index) => ({\n    seq: index + 1,\n    at,\n    endpointId: 'client',\n    stage: 'message',\n    direction: 'outbound'\n  }))\n})\nconst hub = createRpcDevtoolsHub()\ntry {\n  hub.importRecord('saved', text)\n  console.log(hub.status('saved'))\n  const events = hub.timeline({ targets: ['saved'], limit: 2 })\n  console.log(events.map((event) => event.alignedAt).join(','))\n  console.log(events.every((event) => event.uncertaintyMs === undefined))\n  console.log((await hub.stats('saved')).methods.length)\n} finally {\n  await hub.close()\n}"
      },
      result: {
        en: 'The output is offline, 10,30, true, 0: the earliest two timestamps are selected, clock uncertainty is unavailable, and offline data does not invent aggregate statistics.\n\nOffline alignedAt equals the recorded at value. maxEvents defaults to 50000 per target; no remote connection, clock alignment, or periodic realignment is started by importRecord.',
        zh: '输出 `offline`、`10,30`、`true`、`0`：取到最早的两个时间，未虚构时钟不确定度，也未替离线事件编造累计统计。\n\n离线 `alignedAt` 就是记录中的 `at`；`maxEvents` 默认每个目标 `50000`，`importRecord` 不创建远程连接，也不启动时钟对齐或周期校时。'
      }
    },
    {
      title: {
        en: 'Mark missing interaction sides instead of inventing them',
        zh: '标出交互缺失侧而不补造事件'
      },
      problem: {
        en: 'Two diagnostic files may contain opposite sides of one call, while a missing file leaves only one side visible.\n\nJoining solely by method name can combine unrelated calls, and filling the missing side creates evidence that was never observed.\n\nThe hub correlates explicit senderId and messageId with trace filtering; removing a target updates that same retained interaction index.',
        zh: '两个诊断文件可能分别记录同一次调用的两侧，缺少其中一个文件时就只能看见单侧。\n\n只按方法名拼接会混合无关调用，自动补齐另一侧又会创造从未观察过的证据。\n\nHub 按显式 `senderId` 与 `messageId` 关联，并支持 trace 筛选；移除目标会同步更新保留事件的交互索引。'
      },
      example: {
        en: "import { createRpcDevtoolsHub } from '@migaia/rpc-devtools/hub'\nimport * as format from '@migaia/rpc-devtools/contract'\n\nconst outbound = {\n  seq: 1,\n  at: 10,\n  endpointId: 'client',\n  stage: 'message',\n  direction: 'outbound',\n  kind: 'request',\n  senderId: 'client',\n  messageId: 'call-1',\n  method: 'load',\n  trace: 'trace-1'\n}\nconst inbound = { ...outbound, at: 11, endpointId: 'server', direction: 'inbound' }\nconst encode = (event: typeof outbound) =>\n  format.encodeRpcDevtoolsRecord({ header: format.RpcDevtoolsRecordFormat, events: [event] })\nconst hub = createRpcDevtoolsHub()\ntry {\n  hub.importRecord('caller', encode(outbound))\n  console.log(hub.interactions('trace-1')[0]?.oneSided)\n  hub.importRecord('provider', encode(inbound))\n  const interaction = hub.interactions('trace-1')[0]\n  console.log(interaction?.oneSided, interaction?.targets.join(','))\n  await hub.removeTarget('provider')\n  await hub.removeTarget('provider')\n  console.log(hub.status('provider'), hub.interactions('trace-1')[0]?.oneSided)\n} finally {\n  await hub.close()\n}",
        zh: "import { createRpcDevtoolsHub } from '@migaia/rpc-devtools/hub'\nimport * as format from '@migaia/rpc-devtools/contract'\n\nconst outbound = {\n  seq: 1,\n  at: 10,\n  endpointId: 'client',\n  stage: 'message',\n  direction: 'outbound',\n  kind: 'request',\n  senderId: 'client',\n  messageId: 'call-1',\n  method: 'load',\n  trace: 'trace-1'\n}\nconst inbound = { ...outbound, at: 11, endpointId: 'server', direction: 'inbound' }\nconst encode = (event: typeof outbound) =>\n  format.encodeRpcDevtoolsRecord({ header: format.RpcDevtoolsRecordFormat, events: [event] })\nconst hub = createRpcDevtoolsHub()\ntry {\n  hub.importRecord('caller', encode(outbound))\n  console.log(hub.interactions('trace-1')[0]?.oneSided)\n  hub.importRecord('provider', encode(inbound))\n  const interaction = hub.interactions('trace-1')[0]\n  console.log(interaction?.oneSided, interaction?.targets.join(','))\n  await hub.removeTarget('provider')\n  await hub.removeTarget('provider')\n  console.log(hub.status('provider'), hub.interactions('trace-1')[0]?.oneSided)\n} finally {\n  await hub.close()\n}"
      },
      result: {
        en: 'The output is true, false caller,provider, then removed true: one file is one-sided, the matching second file completes the observed pair, and removing it makes the interaction one-sided again.\n\nOnly retained request/response roles establish observed sides. The hub propagates no trace and starts no business request; a successfully removed target can be removed again without recreating it.',
        zh: '输出 `true`、`false caller,provider`、`removed true`：单个文件只有一侧，匹配的第二个文件补全已观察到的两侧，移除后又恢复单侧标记。\n\n只有保留的请求与响应角色能证明观察侧；Hub 不自动传播 trace，也不发起业务请求，成功移除的目标可以再次移除，不会重新创建。'
      }
    }
  ],
  createRpcLogProbe: [
    {
      title: {
        en: 'Redact real RPC log fields while isolating a failing sink',
        zh: '脱敏真实调用日志并隔离日志接收端失败'
      },
      problem: {
        en: 'Diagnostics need selected RPC content, but logging must not expose the original data or change a successful business result.\n\nKeeping a reusable probe view lets later events overwrite queued fields, while an uncaught logger error can disrupt the caller.\n\nInstall createRpcLogProbe through the real Core emitter with capture, redact and onError; it extracts fields synchronously and reports sink failures separately.',
        zh: '诊断需要选定的 RPC 内容，但日志不能泄露原数据，也不能改变本来成功的业务结果。\n\n直接保存可复用的探针视图，会让后续事件覆盖排队中的字段；未处理的日志异常还可能打断调用方。\n\n通过真实 Core 观察路径安装 `createRpcLogProbe`，显式设置 `capture`、`redact`、`onError`，同步提取字段，并单独报告接收端失败。'
      },
      example: {
        en: "import { createEndpoint, connect } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\nimport { probePlugin } from '@migaia/rpc-core/probe'\nimport { createRpcLogProbe } from '@migaia/rpc-devtools/log'\n\nconst failureText = 'log sink failed'\nconst failure = new Error(failureText)\nconst masked = { hidden: true }\nconst fieldsSeen: object[] = []\nconst reports: unknown[] = []\nconst logger = {\n  debug() {},\n  info() {},\n  error() {},\n  warn(_message: string, fields: object) {\n    fieldsSeen.push(fields)\n    throw failure\n  }\n}\nconst probe = createRpcLogProbe(logger, {\n  stages: ['message'],\n  capture: ['message'],\n  slowMs: 0,\n  redact: () => masked,\n  onError: (error) => {\n    reports.push(error)\n  }\n})\nconst [left, right] = createMemoryTransportPair()\nconst server = await createEndpoint({\n  id: 'server',\n  transport: right,\n  middlewares: [connect()],\n  provider: { echo: (context) => context.success(context.data) }\n})\nconst client = await createEndpoint({\n  id: 'client',\n  transport: left,\n  middlewares: [connect(), probePlugin(probe)]\n})\ntry {\n  console.log(await client.send('server', 'echo', 42))\n  console.log(\n    fieldsSeen.length > 0,\n    fieldsSeen.every((fields) => Reflect.get(fields, 'content') === masked)\n  )\n  console.log(new Set(fieldsSeen).size === fieldsSeen.length)\n  console.log(\n    reports.length === fieldsSeen.length,\n    reports.every((error) => error === failure)\n  )\n} finally {\n  await Promise.all([client.dispose(), server.dispose()])\n  left.close()\n}",
        zh: "import { createEndpoint, connect } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\nimport { probePlugin } from '@migaia/rpc-core/probe'\nimport { createRpcLogProbe } from '@migaia/rpc-devtools/log'\n\nconst failureText = '日志接收端失败'\nconst failure = new Error(failureText)\nconst masked = { hidden: true }\nconst fieldsSeen: object[] = []\nconst reports: unknown[] = []\nconst logger = {\n  debug() {},\n  info() {},\n  error() {},\n  warn(_message: string, fields: object) {\n    fieldsSeen.push(fields)\n    throw failure\n  }\n}\nconst probe = createRpcLogProbe(logger, {\n  stages: ['message'],\n  capture: ['message'],\n  slowMs: 0,\n  redact: () => masked,\n  onError: (error) => {\n    reports.push(error)\n  }\n})\nconst [left, right] = createMemoryTransportPair()\nconst server = await createEndpoint({\n  id: 'server',\n  transport: right,\n  middlewares: [connect()],\n  provider: { echo: (context) => context.success(context.data) }\n})\nconst client = await createEndpoint({\n  id: 'client',\n  transport: left,\n  middlewares: [connect(), probePlugin(probe)]\n})\ntry {\n  console.log(await client.send('server', 'echo', 42))\n  console.log(\n    fieldsSeen.length > 0,\n    fieldsSeen.every((fields) => Reflect.get(fields, 'content') === masked)\n  )\n  console.log(new Set(fieldsSeen).size === fieldsSeen.length)\n  console.log(\n    reports.length === fieldsSeen.length,\n    reports.every((error) => error === failure)\n  )\n} finally {\n  await Promise.all([client.dispose(), server.dispose()])\n  left.close()\n}"
      },
      result: {
        en: 'The output is 42, true true, true, true true: the request succeeds, qualified logs contain the redacted object, each field object is separate, and every sink failure is reported by original identity.\n\nslowMs defaults to undefined, so normal settled calls are omitted; this example uses 0 to include them. Capture is off by default, redaction replaces content by reference, and buffering or external I/O belongs to the sink.',
        zh: '输出 `42`、`true true`、`true`、`true true`：请求成功，合格日志使用脱敏对象，每份字段对象独立，所有接收端失败都以原身份报告。\n\n`slowMs` 默认 `undefined`，不记录普通成功调用；本例设为 `0` 以纳入它们。内容捕获默认关闭，脱敏以引用替换内容，缓冲与外部 I/O 由日志接收端负责。'
      }
    }
  ]
}
