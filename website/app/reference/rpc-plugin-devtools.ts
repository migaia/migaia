/**
 * Bilingual public reference for @migaia/rpc-plugin-devtools; native and call ownership follow the
 * actual package API.
 */
import type { ILibraryReference } from './contract.js'

/** Authored public modules, symbols, configuration and ownership contracts. */
export const rpcDevtoolsReference: ILibraryReference = {
  modules: {
    index: {
      summary: {
        en: 'Install the original bounded collector directly into real host observation. Same feature object may observe multiple hosts; closing one host withdraws only its observation and never closes the collector. Use devtoolsPlugin().collector for pause/resume, record, export/import and service.',
        zh: '将原有界采集器直接安装到真实宿主观察。同一功能对象可观察多个宿主，关闭一个宿主仅撤回其观察，不关闭采集器。暂停恢复、录制、导入导出和服务均通过同一个采集器使用。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
    },
    contract: {
      summary: {
        en: 'Portable service/event/record contracts and pure NDJSON encode/decode. The v1 header remains migaia-rpc-plugin-devtools/version 1; bytes and native error chains preserve the original grammar, without ingesting imported events into a live collector.',
        zh: '可移植服务、事件、记录契约及纯逐行编解码，首行版本格式保持原值，字节及原生错误链沿原语法保存，导入不会向活动采集器注入事件。'
      },
      example:
        "import { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 100 })\ntry {\n  const recording = tools.collector.record({ maxEvents: 200 })\n  tools.collector.clear()\n  const record = recording.stop()\n  const text = tools.collector.exportRecord(record)\n  const decoded = tools.collector.importRecord(text)\n  console.log(decoded.header.version)\n} finally {\n  tools.close()\n}"
    },
    hub: {
      summary: {
        en: 'Aggregate existing request/stream clients or offline records. Own watches, alignment timers and bounded indexes only; never create or close borrowed business connections or fabricate missing interaction sides.',
        zh: '聚合既有请求流客户端或离线记录，仅拥有观察、对齐定时器和有界索引，不创建或关闭借入业务连接，不补造缺失交互。'
      },
      example:
        "import { createRpcDevtoolsHub } from '@migaia/rpc-plugin-devtools/hub'\n\nexport async function inspectRecord(text: string) {\n  const hub = createRpcDevtoolsHub({ maxEvents: 5000 })\n  try {\n    hub.importRecord('offline', text)\n    return hub.timeline({ targets: ['offline'], limit: 100 })\n  } finally {\n    await hub.close()\n  }\n}"
    },
    log: {
      summary: {
        en: 'Create a structured message/peer log probe for an application logger; install it through defineFeaturePlugin. Buffering, file I/O, flush and shutdown remain logger-owned.',
        zh: '为应用日志器创建逻辑消息及对端日志观察，通过功能定义安装；缓冲、文件输入输出、刷新及关闭仍归日志器。'
      },
      example:
        "import { defineFeaturePlugin } from '@migaia/rpc-host/plugin'\nimport { createRpcLogProbe, type IRpcLogSink } from '@migaia/rpc-plugin-devtools/log'\n\nconst logger: IRpcLogSink = {\n  debug: (message, fields) => console.debug(message, fields),\n  info: (message, fields) => console.info(message, fields),\n  warn: (message, fields) => console.warn(message, fields),\n  error: (message, fields) => console.error(message, fields)\n}\nexport const logging = defineFeaturePlugin({\n  name: 'app-logging',\n  probe: createRpcLogProbe(logger, { slowMs: 100 })\n})"
    }
  },
  symbols: {
    encodeRpcDevtoolsRecord: {
      role: 'operation',
      purpose: {
        en: 'Encodes ordered record events as version-one NDJSON with a header line and trailing newline. Bytes use canonical padded Base64 tags; native errors delegate to the canonical Contract error graph and retain stacks.',
        zh: '把有序记录事件编码为带头行和结尾换行的第一版逐行 `JSON`，字节采用规范填充标签，原生错误复用契约包规范错误图并保留堆栈。'
      },
      params: {
        record: {
          en: 'IRpcDevtoolsRecord from a stopped recording or an application-built record using RpcDevtoolsRecordFormat.',
          zh: '来自已停止录制，或应用使用规范记录格式常量构造的离线记录。'
        }
      },
      returns: {
        en: 'Complete NDJSON string; unsupported header, event, bytes or error conversion throws RECORD_FORMAT_INVALID with original cause. Input errors and stacks are not mutated.',
        zh: '返回完整逐行文本，头、事件、字节或错误转换失败抛 `RECORD_FORMAT_INVALID` 并保留原始原因，不修改输入错误与堆栈。'
      },
      exampleIntro: {
        en: 'The offline inputs are complete application-authored records, not live probe views. header uses RpcDevtoolsRecordFormat: format is "migaia-rpc-devtools" and version is 1. Every event supplies finite seq and at, an endpointId string, a stage string, and inbound or outbound direction; optional kind, senderId, messageId, method and trace describe only identities explicitly present in the file. encodeRpcDevtoolsRecord converts the record to text without writing a file. This event stores a Uint8Array content and an Error with a TypeError cause. Object.defineProperties adds example diagnostic source/code fields without replacing either Error; new Error(message,{cause}) retains the original cause. The matching decoder returns newly reconstructed errors and byte arrays, so value and stack preservation do not imply original object identity.',
        zh: '离线输入是应用编写的完整记录，不是实时探针视图。`header` 使用 `RpcDevtoolsRecordFormat`，其中 `format` 为 `migaia-rpc-devtools`、`version` 为 `1`。每个事件提供有限数值 `seq`、`at`，字符串 `endpointId`、`stage` 及 `inbound` 或 `outbound` 方向；可选 `kind`、`senderId`、`messageId`、`method`、`trace` 只描述文件明确保存的身份。`encodeRpcDevtoolsRecord` 把记录转换为文本，不写文件。本例事件的 `content` 是 Uint8Array，`error` 是带 TypeError 原因的 Error。`Object.defineProperties` 为示例错误附加 `source`、`code`，不替换对象，`new Error(message, { cause })` 保留原原因。配套解码器重建错误与字节数组，值和堆栈相同不代表跨文本边界后仍是原对象。'
      },
      example: {
        en: "import * as format from '@migaia/rpc-plugin-devtools/contract'\n\nconst causeText = 'invalid field'\nconst failureText = 'request failed'\nconst cause = new TypeError(causeText)\nconst failure = new Error(failureText, { cause })\nObject.defineProperties(cause, { source: { value: 'example' }, code: { value: 'FIELD' } })\nObject.defineProperties(failure, { source: { value: 'example' }, code: { value: 'REQUEST' } })\nconst text = format.encodeRpcDevtoolsRecord({\n  header: format.RpcDevtoolsRecordFormat,\n  events: [\n    {\n      seq: 1,\n      at: 10,\n      endpointId: 'client',\n      stage: 'message',\n      direction: 'outbound',\n      content: new Uint8Array([1, 2, 3]),\n      error: failure\n    }\n  ]\n})\nconst restored = format.decodeRpcDevtoolsRecord(text)\nconst error = restored.events[0]?.error\nconsole.log(error instanceof Error, error instanceof Error && error.cause instanceof TypeError)\nconsole.log(error instanceof Error && error.stack === failure.stack)\nconsole.log([...(restored.events[0]?.content as Uint8Array)].join(','))",
        zh: "import * as format from '@migaia/rpc-plugin-devtools/contract'\n\nconst causeText = '字段无效'\nconst failureText = '请求失败'\nconst cause = new TypeError(causeText)\nconst failure = new Error(failureText, { cause })\nObject.defineProperties(cause, { source: { value: 'example' }, code: { value: 'FIELD' } })\nObject.defineProperties(failure, { source: { value: 'example' }, code: { value: 'REQUEST' } })\nconst text = format.encodeRpcDevtoolsRecord({\n  header: format.RpcDevtoolsRecordFormat,\n  events: [\n    {\n      seq: 1,\n      at: 10,\n      endpointId: 'client',\n      stage: 'message',\n      direction: 'outbound',\n      content: new Uint8Array([1, 2, 3]),\n      error: failure\n    }\n  ]\n})\nconst restored = format.decodeRpcDevtoolsRecord(text)\nconst error = restored.events[0]?.error\nconsole.log(error instanceof Error, error instanceof Error && error.cause instanceof TypeError)\nconsole.log(error instanceof Error && error.stack === failure.stack)\nconsole.log([...(restored.events[0]?.content as Uint8Array)].join(','))"
      },
      cases: [
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
            en: "import * as format from '@migaia/rpc-plugin-devtools/contract'\n\nconst causeText = 'invalid field'\nconst failureText = 'request failed'\nconst cause = new TypeError(causeText)\nconst failure = new Error(failureText, { cause })\nObject.defineProperties(cause, { source: { value: 'example' }, code: { value: 'FIELD' } })\nObject.defineProperties(failure, { source: { value: 'example' }, code: { value: 'REQUEST' } })\nconst text = format.encodeRpcDevtoolsRecord({\n  header: format.RpcDevtoolsRecordFormat,\n  events: [\n    {\n      seq: 1,\n      at: 10,\n      endpointId: 'client',\n      stage: 'message',\n      direction: 'outbound',\n      content: new Uint8Array([1, 2, 3]),\n      error: failure\n    }\n  ]\n})\nconst restored = format.decodeRpcDevtoolsRecord(text)\nconst error = restored.events[0]?.error\nconsole.log(error instanceof Error, error instanceof Error && error.cause instanceof TypeError)\nconsole.log(error instanceof Error && error.stack === failure.stack)\nconsole.log([...(restored.events[0]?.content as Uint8Array)].join(','))",
            zh: "import * as format from '@migaia/rpc-plugin-devtools/contract'\n\nconst causeText = '字段无效'\nconst failureText = '请求失败'\nconst cause = new TypeError(causeText)\nconst failure = new Error(failureText, { cause })\nObject.defineProperties(cause, { source: { value: 'example' }, code: { value: 'FIELD' } })\nObject.defineProperties(failure, { source: { value: 'example' }, code: { value: 'REQUEST' } })\nconst text = format.encodeRpcDevtoolsRecord({\n  header: format.RpcDevtoolsRecordFormat,\n  events: [\n    {\n      seq: 1,\n      at: 10,\n      endpointId: 'client',\n      stage: 'message',\n      direction: 'outbound',\n      content: new Uint8Array([1, 2, 3]),\n      error: failure\n    }\n  ]\n})\nconst restored = format.decodeRpcDevtoolsRecord(text)\nconst error = restored.events[0]?.error\nconsole.log(error instanceof Error, error instanceof Error && error.cause instanceof TypeError)\nconsole.log(error instanceof Error && error.stack === failure.stack)\nconsole.log([...(restored.events[0]?.content as Uint8Array)].join(','))"
          },
          result: {
            en: 'The output is true true, true, then 1,2,3: decoding restores the native Error and TypeError cause, keeps the recorded stack, and restores the byte values.\n\nThe codec transforms an offline representation and performs no file I/O. A sole $bytes object is reserved v1 syntax; arbitrary objects, prototypes, and functions do not have a general lossless round-trip guarantee.',
            zh: '输出 `true true`、`true`、`1,2,3`：解码还原 Error 及其 TypeError 原因，保留记录中的堆栈，并还原字节值。\n\n编解码器只转换离线表示，不执行文件读写；单键 `$bytes` 对象属于 v1 保留语法，不保证任意对象、原型和函数都能无损往返。'
          }
        }
      ]
    },
    decodeRpcDevtoolsRecord: {
      role: 'operation',
      purpose: {
        en: 'Parses the frozen version-one NDJSON grammar, validates header and required event fields, and revives native bytes and error graphs without regenerating stacks. Pair with encodeRpcDevtoolsRecord for a complete offline round trip.',
        zh: '解析固定第一版逐行 `JSON` 语法，校验头及必填事件字段，恢复原生字节与错误图且不重建堆栈，搭配 `encodeRpcDevtoolsRecord` 完成离线往返。'
      },
      params: {
        text: {
          en: 'Text produced by encodeRpcDevtoolsRecord or collector exportRecord; no connection or live collector is required.',
          zh: '记录编码函数或采集器导出函数产生的文本，不要求连接或存活采集器。'
        }
      },
      returns: {
        en: 'IRpcDevtoolsRecord with native errors and newly decoded byte arrays; malformed input throws TypeError with RECORD_FORMAT_INVALID and cause.',
        zh: '返回含原生错误及新解码字节数组的离线记录，输入损坏抛带 `RECORD_FORMAT_INVALID` 与原因的类型错误。'
      },
      example:
        "import { RpcDevtoolsRecordFormat, encodeRpcDevtoolsRecord, decodeRpcDevtoolsRecord } from '@migaia/rpc-plugin-devtools/contract'\n\nconst text = encodeRpcDevtoolsRecord({\n  header: RpcDevtoolsRecordFormat,\n  events: [{ seq: 1, at: 100, endpointId: 'worker', stage: 'message', direction: 'outbound', method: 'read', senderId: 'worker', messageId: 'm1', trace: 'T1', content: JSON.stringify({ $bytes: 'AQ==' }) }]\n})\nconsole.log(decodeRpcDevtoolsRecord(text).events[0])"
    },
    createRpcDevtoolsHub: {
      role: 'factory',
      purpose: {
        en: 'Creates a caller-owned multi-target observation hub. Live registration samples describe five times, chooses minimum round-trip alignment, starts the first read of one watch before querying retained pages, then consumes that bounded watch and deduplicates by sequence. Offline import uses no invented clock metadata; existing clients remain caller-owned.',
        zh: '创建调用者拥有的多目标观察聚合器，实时注册五次采样描述并选择最小往返对齐，先开始唯一观察流的首次读取，再查询保留页，随后消费有界观察并按序号去重，离线导入不编造时钟元数据，已有客户端仍归调用者。'
      },
      options: 'IRpcDevtoolsHubOptions',
      params: {
        options: {
          en: 'Optional per-target retention, realignment period and error observer. Omitted settings retain fifty thousand events per target without periodic realignment.',
          zh: '可选每目标保留、重对齐周期及错误观察回调，省略时每目标保留五万事件且不周期重对齐。'
        }
      },
      returns: {
        en: 'IRpcDevtoolsHub; close returns the same promise on repeated calls. Invalid options throw INVALID_OPTION; target and lifecycle errors use the package error table.',
        zh: '返回聚合器，重复关闭复用同一个 Promise；非法选项抛 `INVALID_OPTION`，目标及生命周期失败使用包错误表。'
      },
      exampleIntro: {
        en: 'The offline inputs are complete application-authored records, not live probe views. header uses RpcDevtoolsRecordFormat: format is "migaia-rpc-devtools" and version is 1. Every event supplies finite seq and at, an endpointId string, a stage string, and inbound or outbound direction; optional kind, senderId, messageId, method and trace describe only identities explicitly present in the file. encodeRpcDevtoolsRecord converts the record to text without writing a file. createRpcDevtoolsHub(options?) defaults maxEvents to 50000 per target, realignMs to undefined and onError to console.error. importRecord(name,text) requires a unique nonempty name. timeline({targets:["saved"],limit:2}) selects that target and the earliest two retained events; omitted filters match all and omitted limit is unbounded within retained data. interactions(trace?) defaults to all interactions, status(name?) to all statuses, and stats(name?) to live-target aggregation. removeTarget(name) releases only that target; close() takes no arguments.',
        zh: '离线输入是应用编写的完整记录，不是实时探针视图。`header` 使用 `RpcDevtoolsRecordFormat`，其中 `format` 为 `migaia-rpc-devtools`、`version` 为 `1`。每个事件提供有限数值 `seq`、`at`，字符串 `endpointId`、`stage` 及 `inbound` 或 `outbound` 方向；可选 `kind`、`senderId`、`messageId`、`method`、`trace` 只描述文件明确保存的身份。`encodeRpcDevtoolsRecord` 把记录转换为文本，不写文件。`createRpcDevtoolsHub(options?)` 的 `maxEvents` 默认每目标 `50000`，`realignMs` 默认 `undefined`，`onError` 默认 `console.error`。`importRecord(name, text)` 的名称须非空且唯一。`timeline({ targets: ["saved"], limit: 2 })` 选择该目标最早的两个保留事件；省略筛选时全选，省略上限时不额外限制保留数据。`interactions(trace?)` 默认全部交互，`status(name?)` 默认全部状态，`stats(name?)` 默认聚合实时目标。`removeTarget(name)` 只释放指定目标，`close()` 无参数。'
      },
      example: {
        en: "import { createRpcDevtoolsHub } from '@migaia/rpc-plugin-devtools/hub'\nimport * as format from '@migaia/rpc-plugin-devtools/contract'\n\nconst text = format.encodeRpcDevtoolsRecord({\n  header: format.RpcDevtoolsRecordFormat,\n  events: [50, 10, 30].map((at, index) => ({\n    seq: index + 1,\n    at,\n    endpointId: 'client',\n    stage: 'message',\n    direction: 'outbound'\n  }))\n})\nconst hub = createRpcDevtoolsHub()\ntry {\n  hub.importRecord('saved', text)\n  console.log(hub.status('saved'))\n  const events = hub.timeline({ targets: ['saved'], limit: 2 })\n  console.log(events.map((event) => event.alignedAt).join(','))\n  console.log(events.every((event) => event.uncertaintyMs === undefined))\n  console.log((await hub.stats('saved')).methods.length)\n} finally {\n  await hub.close()\n}",
        zh: "import { createRpcDevtoolsHub } from '@migaia/rpc-plugin-devtools/hub'\nimport * as format from '@migaia/rpc-plugin-devtools/contract'\n\nconst text = format.encodeRpcDevtoolsRecord({\n  header: format.RpcDevtoolsRecordFormat,\n  events: [50, 10, 30].map((at, index) => ({\n    seq: index + 1,\n    at,\n    endpointId: 'client',\n    stage: 'message',\n    direction: 'outbound'\n  }))\n})\nconst hub = createRpcDevtoolsHub()\ntry {\n  hub.importRecord('saved', text)\n  console.log(hub.status('saved'))\n  const events = hub.timeline({ targets: ['saved'], limit: 2 })\n  console.log(events.map((event) => event.alignedAt).join(','))\n  console.log(events.every((event) => event.uncertaintyMs === undefined))\n  console.log((await hub.stats('saved')).methods.length)\n} finally {\n  await hub.close()\n}"
      },
      cases: [
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
            en: "import { createRpcDevtoolsHub } from '@migaia/rpc-plugin-devtools/hub'\nimport * as format from '@migaia/rpc-plugin-devtools/contract'\n\nconst text = format.encodeRpcDevtoolsRecord({\n  header: format.RpcDevtoolsRecordFormat,\n  events: [50, 10, 30].map((at, index) => ({\n    seq: index + 1,\n    at,\n    endpointId: 'client',\n    stage: 'message',\n    direction: 'outbound'\n  }))\n})\nconst hub = createRpcDevtoolsHub()\ntry {\n  hub.importRecord('saved', text)\n  console.log(hub.status('saved'))\n  const events = hub.timeline({ targets: ['saved'], limit: 2 })\n  console.log(events.map((event) => event.alignedAt).join(','))\n  console.log(events.every((event) => event.uncertaintyMs === undefined))\n  console.log((await hub.stats('saved')).methods.length)\n} finally {\n  await hub.close()\n}",
            zh: "import { createRpcDevtoolsHub } from '@migaia/rpc-plugin-devtools/hub'\nimport * as format from '@migaia/rpc-plugin-devtools/contract'\n\nconst text = format.encodeRpcDevtoolsRecord({\n  header: format.RpcDevtoolsRecordFormat,\n  events: [50, 10, 30].map((at, index) => ({\n    seq: index + 1,\n    at,\n    endpointId: 'client',\n    stage: 'message',\n    direction: 'outbound'\n  }))\n})\nconst hub = createRpcDevtoolsHub()\ntry {\n  hub.importRecord('saved', text)\n  console.log(hub.status('saved'))\n  const events = hub.timeline({ targets: ['saved'], limit: 2 })\n  console.log(events.map((event) => event.alignedAt).join(','))\n  console.log(events.every((event) => event.uncertaintyMs === undefined))\n  console.log((await hub.stats('saved')).methods.length)\n} finally {\n  await hub.close()\n}"
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
            en: "import { createRpcDevtoolsHub } from '@migaia/rpc-plugin-devtools/hub'\nimport * as format from '@migaia/rpc-plugin-devtools/contract'\n\nconst outbound = {\n  seq: 1,\n  at: 10,\n  endpointId: 'client',\n  stage: 'message',\n  direction: 'outbound',\n  kind: 'request',\n  senderId: 'client',\n  messageId: 'call-1',\n  method: 'load',\n  trace: 'trace-1'\n}\nconst inbound = { ...outbound, at: 11, endpointId: 'server', direction: 'inbound' }\nconst encode = (event: typeof outbound) =>\n  format.encodeRpcDevtoolsRecord({ header: format.RpcDevtoolsRecordFormat, events: [event] })\nconst hub = createRpcDevtoolsHub()\ntry {\n  hub.importRecord('caller', encode(outbound))\n  console.log(hub.interactions('trace-1')[0]?.oneSided)\n  hub.importRecord('provider', encode(inbound))\n  const interaction = hub.interactions('trace-1')[0]\n  console.log(interaction?.oneSided, interaction?.targets.join(','))\n  await hub.removeTarget('provider')\n  await hub.removeTarget('provider')\n  console.log(hub.status('provider'), hub.interactions('trace-1')[0]?.oneSided)\n} finally {\n  await hub.close()\n}",
            zh: "import { createRpcDevtoolsHub } from '@migaia/rpc-plugin-devtools/hub'\nimport * as format from '@migaia/rpc-plugin-devtools/contract'\n\nconst outbound = {\n  seq: 1,\n  at: 10,\n  endpointId: 'client',\n  stage: 'message',\n  direction: 'outbound',\n  kind: 'request',\n  senderId: 'client',\n  messageId: 'call-1',\n  method: 'load',\n  trace: 'trace-1'\n}\nconst inbound = { ...outbound, at: 11, endpointId: 'server', direction: 'inbound' }\nconst encode = (event: typeof outbound) =>\n  format.encodeRpcDevtoolsRecord({ header: format.RpcDevtoolsRecordFormat, events: [event] })\nconst hub = createRpcDevtoolsHub()\ntry {\n  hub.importRecord('caller', encode(outbound))\n  console.log(hub.interactions('trace-1')[0]?.oneSided)\n  hub.importRecord('provider', encode(inbound))\n  const interaction = hub.interactions('trace-1')[0]\n  console.log(interaction?.oneSided, interaction?.targets.join(','))\n  await hub.removeTarget('provider')\n  await hub.removeTarget('provider')\n  console.log(hub.status('provider'), hub.interactions('trace-1')[0]?.oneSided)\n} finally {\n  await hub.close()\n}"
          },
          result: {
            en: 'The output is true, false caller,provider, then removed true: one file is one-sided, the matching second file completes the observed pair, and removing it makes the interaction one-sided again.\n\nOnly retained request/response roles establish observed sides. The hub propagates no trace and starts no business request; a successfully removed target can be removed again without recreating it.',
            zh: '输出 `true`、`false caller,provider`、`removed true`：单个文件只有一侧，匹配的第二个文件补全已观察到的两侧，移除后又恢复单侧标记。\n\n只有保留的请求与响应角色能证明观察侧；Hub 不自动传播 trace，也不发起业务请求，成功移除的目标可以再次移除，不会重新创建。'
          }
        }
      ]
    },
    createRpcLogProbe: {
      role: 'enhancer',
      purpose: {
        en: 'Creates a standalone Core probe that logs qualifying failed, rejected, slow or peer-lifecycle events. Install it through probePlugin. Each qualifying event makes one synchronous logger call; sink promise rejection is observed without awaiting or changing business RPC.',
        zh: '创建记录失败、拒绝、慢调用或连接生命周期的独立核心探针，通过探针插件安装；每个合格事件同步调用一次日志方法，观察其 Promise 拒绝但不等待，不改变业务调用。'
      },
      params: {
        logger: {
          en: 'Caller-owned IRpcLogSink with debug, info, warn and error methods, for example a compatible logger instance; it owns buffering and output.',
          zh: '调用者拥有、含四个日志级别方法的结构化接收端，可使用兼容日志实例，自行拥有缓冲及输出。'
        },
        options: {
          en: 'Optional logging policy; default stages are message and peer, content capture and slow-call qualification are disabled.',
          zh: '可选日志策略，默认消息与连接阶段，不捕获内容且不开启慢调用条件。'
        }
      },
      options: 'IRpcLogProbeOptions',
      returns: {
        en: 'IRpcProbe from @migaia/rpc-host/probe; its protocol surface remains owned there. Invalid sink or options throw TypeError with INVALID_OPTION, while observer failures use onError.',
        zh: '返回 `@migaia/rpc-host/probe` 的探针，协议表面归核心包拥有，接收端或选项非法抛带 `INVALID_OPTION` 的类型错误，观察失败经错误回调处理。'
      },
      exampleIntro: {
        en: 'Install this package and its @migaia/rpc-host and @migaia/rpc-contract peers directly. In Node 24, createMemoryTransportPair() returns two borrowed sides with default native-microtask delivery. Each createRpcHost receives its local id and transport; connect() supplies normal message delivery and probePlugin installs the returned probe on the client only. The provider receives context.data and returns context.success(value). send(targetId, method, data) waits for the remote result; both endpoints are disposed before the caller closes the pair. The complete logger implements debug/info/warn/error(message,fields); warn stores only the extracted field object and deliberately throws an existing Error. stages:["message"] and capture:["message"] select logical content; redact(stage,content) returns the masked object by reference. slowMs:0 includes every measured settled call instead of its default undefined. onError(error) records sink failures and returns nothing; without it, the host reporter owns failures. Other category levels retain their documented defaults.',
        zh: '直接安装本包及 `@migaia/rpc-host`、`@migaia/rpc-contract` 两个 peer。Node 24 中，`createMemoryTransportPair()` 默认按原生微任务交付，返回两个借用端。每个 `createRpcHost` 传入本端 `id` 与 `transport`；`connect()` 负责正常消息交付，`probePlugin` 只把探针安装在客户端。提供方从 `context.data` 取输入，以 `context.success(value)` 返回；`send(targetId, method, data)` 等待远端结果。最终先释放两个端点，再由调用方关闭传输对。完整日志对象实现 `debug/info/warn/error(message, fields)`；`warn` 只保存提取后的字段对象，并故意抛出已有 Error。`stages: ["message"]` 与 `capture: ["message"]` 选择逻辑内容，`redact(stage, content)` 以引用返回脱敏对象。`slowMs: 0` 取代默认 `undefined`，纳入所有有耗时的成功事件。`onError(error)` 保存接收端失败且不返回值；未提供时由宿主报告通道处理。其他分类保留下面列出的默认级别。'
      },
      example: {
        en: "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}",
        zh: "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
      },
      cases: [
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
            en: "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}",
            zh: "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
          },
          result: {
            en: 'The output is 42, true true, true, true true: the request succeeds, qualified logs contain the redacted object, each field object is separate, and every sink failure is reported by original identity.\n\nslowMs defaults to undefined, so normal settled calls are omitted; this example uses 0 to include them. Capture is off by default, redaction replaces content by reference, and buffering or external I/O belongs to the sink.',
            zh: '输出 `42`、`true true`、`true`、`true true`：请求成功，合格日志使用脱敏对象，每份字段对象独立，所有接收端失败都以原身份报告。\n\n`slowMs` 默认 `undefined`，不记录普通成功调用；本例设为 `0` 以纳入它们。内容捕获默认关闭，脱敏以引用替换内容，缓冲与外部 I/O 由日志接收端负责。'
          }
        }
      ]
    },
    RPC_DEVTOOLS_SOURCE: {
      role: 'error',
      purpose: {
        en: 'Identifies failures created by RPC Devtools. When handling a caught error, compare its source with RPC_DEVTOOLS_SOURCE, then compare code with RpcDevtoolsErrorCode to select a response. Configuration failures remain TypeError instances; failures involving a diagnostic session use Error. You do not need to parse the message to classify them.',
        zh: '标识 RPC 调试工具创建的失败。处理捕获的错误时，先检查 source 是否等于 RPC_DEVTOOLS_SOURCE，再用 RpcDevtoolsErrorCode 比较 code，选择处理方式。配置失败仍然是 TypeError，诊断会话失败使用 Error；分类时无需解析消息文本。'
      },
      example:
        "import { RPC_DEVTOOLS_SOURCE, RpcDevtoolsErrorCode } from '@migaia/rpc-plugin-devtools/contract'\nconsole.log(RPC_DEVTOOLS_SOURCE, RpcDevtoolsErrorCode.closed)"
    },
    RpcDevtoolsErrorCode: {
      role: 'error',
      purpose: {
        en: 'Stable semantic error vocabulary for options, collector lifecycle, recording, portable service conversion and hub target ownership. Original causes remain reachable through native error chains.',
        zh: '提供选项、采集生命周期、录制、可移植服务转换及聚合目标所有权的稳定语义错误词汇，原始原因通过原生错误链保持可达。'
      },
      example:
        "import { RpcDevtoolsErrorCode } from '@migaia/rpc-plugin-devtools/contract'\nconsole.log(RpcDevtoolsErrorCode.recordActive)"
    },
    RpcDevtoolsRecordFormat: {
      role: 'constant',
      purpose: {
        en: 'Frozen version-one record header identity containing format migaia-rpc-devtools and version one. Use the same object when constructing records for the codec; it carries no clock or descriptor metadata.',
        zh: '冻结第一版记录头身份，包含格式标识及版本一，构造编码记录时使用相同常量，不携带时钟或端点描述元数据。'
      },
      example:
        "import { RpcDevtoolsRecordFormat, encodeRpcDevtoolsRecord, decodeRpcDevtoolsRecord } from '@migaia/rpc-plugin-devtools/contract'\n\nconst text = encodeRpcDevtoolsRecord({\n  header: RpcDevtoolsRecordFormat,\n  events: [{ seq: 1, at: 100, endpointId: 'worker', stage: 'message', direction: 'outbound', method: 'read', senderId: 'worker', messageId: 'm1', trace: 'T1', content: JSON.stringify({ $bytes: 'AQ==' }) }]\n})\nconsole.log(decodeRpcDevtoolsRecord(text).events[0])"
    },
    RpcDevtoolsTargetStatus: {
      role: 'constant',
      purpose: {
        en: 'Target lifecycle values emitted by hub status observations and returned by status queries. These values describe connectivity or offline ownership and are never thrown error codes.',
        zh: '聚合状态观察回调及查询使用的目标生命周期值，描述连接状态或离线所有权，不作为抛出错误码。'
      },
      example:
        "import { createRpcDevtoolsHub } from '@migaia/rpc-plugin-devtools/hub'\nimport { RpcDevtoolsRecordFormat, encodeRpcDevtoolsRecord } from '@migaia/rpc-plugin-devtools/contract'\n\nconst text = encodeRpcDevtoolsRecord({ header: RpcDevtoolsRecordFormat, events: [\n  { seq: 1, at: 100, endpointId: 'worker', stage: 'message', direction: 'outbound', kind: 'request', senderId: 'worker', messageId: 'm1', trace: 'T1', method: 'read' }\n] })\nconst hub = createRpcDevtoolsHub()\nconst off = hub.on('status', (name, status) => console.log(name, status))\nhub.importRecord('recording', text)\nconsole.log(hub.status('recording'), hub.timeline({ trace: 'T1' }), hub.interactions('T1'))\nconsole.log(await hub.stats('recording'))\noff()\nawait hub.removeTarget('recording')\nawait hub.close()"
    },
    devtoolsPlugin: {
      role: 'enhancer',
      purpose: {
        en: 'Install the original bounded collector directly into real host observation. Same feature object may observe multiple hosts; closing one host withdraws only its observation and never closes the collector.',
        zh: '将原有界采集器直接安装到真实宿主观察。同一功能对象可观察多个宿主，关闭一个宿主仅撤回其观察，不关闭采集器。'
      },
      options: 'IRpcDevtoolsOptions',
      returns: {
        en: 'IDevtoolsPlugin with one collector plus direct query/watch/stats/describe/close projections; retain the exact installed object.',
        zh: '返回含唯一采集器及五个直接查询观察控制投影的功能对象，须保留精确安装对象。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
    }
  },
  types: {
    IRpcDevtools: {
      summary: {
        en: 'Collector returned by createRpcHost, composed with external IRpcProbe. The Core owns stage masks and setStages; this collector owns retention, queries, recording, service projection and explicit close.',
        zh: '采集器工厂返回、组合外包探针的采集器，核心包拥有阶段掩码及订阅修改，当前包拥有保留、查询、录制、服务投影与显式关闭。'
      },
      scenarios: [
        {
          en: 'Observe endpoint traffic locally and serve a separate diagnostics connection without owning business transports.',
          zh: '本地观察端点流量并经独立诊断连接提供服务，不拥有业务传输。'
        }
      ],
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}",
      members: {
        emit: {
          summary: {
            en: 'Consumes a Core-owned reusable IRpcProbeEventView synchronously into retained columns; never keeps the view itself. Installed emitters normally call it through probePlugin.',
            zh: '同步消费核心包拥有的复用事件视图并写入保留列，不保存视图本身；安装后的发射器通常经探针插件调用它。'
          },
          params: {
            view: {
              en: 'IRpcProbeEventView issued by an installed Core emitter, valid only during its synchronous emit call; external type semantics remain in @migaia/rpc-host/probe.',
              zh: '已安装核心发射器签发的 `IRpcProbeEventView`，仅同步发射调用期间有效，外包类型语义由 `@migaia/rpc-host/probe` 拥有。'
            }
          },
          returns: {
            en: 'Metadata is retained or accounted as filtered, paused, closed or reentrant loss. Observation failures are reported instead of reaching the business caller.',
            zh: '元数据已被保留，或被记为筛选、暂停、关闭及重入丢失，观察失败通过报告通道处理，不传给业务调用者。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
        },
        query: {
          summary: {
            en: 'Synchronously scans retained events with compiled filters. This is a snapshot rather than a subscription; limits are one through one thousand.',
            zh: '用已编译筛选条件同步扫描保留事件，返回快照而非订阅，数量上限为一至一千。'
          },
          params: {
            input: {
              en: 'Optional IRpcDevtoolsQuery; default cursor zero, limit one thousand and no field filters. Take subsequent afterSeq from the prior page nextSeq.',
              zh: '可选查询，默认游标零、上限一千且无字段筛选，后续游标取自上一页的 `nextSeq`。'
            }
          },
          returns: {
            en: 'IRpcDevtoolsPage with events, nextSeq and loss counters. Invalid inputs use INVALID_OPTION and closed collectors use CLOSED.',
            zh: '返回含事件、下页游标及丢失计数的查询页，非法输入使用 `INVALID_OPTION`，关闭的采集器使用 `CLOSED`。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
        },
        watch: {
          summary: {
            en: 'Subscribes from first generator advancement to future filtered events. Batches contain at most 256 events and each watcher retains at most 64 queued batches; overflow is counted rather than blocking RPC.',
            zh: '从首次推进生成器开始订阅未来筛选事件，每批至多二百五十六条，每个观察者至多排队六十四批，溢出计数而不阻塞远程调用。'
          },
          params: {
            input: {
              en: 'Optional query filters excluding afterSeq and limit; defaults to no filters. Use query separately for retained history.',
              zh: '可选查询筛选，排除历史游标及上限字段，默认不筛选，历史数据另用查询接口读取。'
            }
          },
          returns: {
            en: 'AsyncGenerator<IRpcDevtoolsWatchBatch>; return wakes a pending local next and releases the watcher without needing Collector.close. Collector close instead wakes pending reads with CLOSED; remote stream cancellation ends its service watcher normally.',
            zh: '返回观察批次异步生成器，结束迭代会唤醒本地待定读取并释放观察者，无需关闭采集器；关闭采集器则使等待读取以 `CLOSED` 失败，远端流取消则正常结束其服务观察者。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
        },
        stats: {
          summary: {
            en: 'Snapshots endpoint/method settlement aggregates independently from query-ring eviction; clear resets them.',
            zh: '取得不受查询环淘汰影响的端点与方法结算聚合快照，清空操作会重置统计。'
          },
          returns: {
            en: 'IRpcDevtoolsStats with cumulative counts and histogram-derived quantiles; a closed collector throws CLOSED.',
            zh: '返回含累计计数及直方图分位数的统计，已关闭采集器抛 `CLOSED`。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
        },
        describe: {
          summary: {
            en: 'Reports the current monotonic clock sample, pause state, known endpoint descriptors, limits and loss counters.',
            zh: '报告当前单调时钟采样、暂停状态、已知端点描述、容量限制及丢失计数。'
          },
          returns: {
            en: 'IRpcDevtoolsDescribe snapshot; descriptors preserve their element references. Closed collectors throw CLOSED.',
            zh: '返回描述快照，端点描述元素保留原引用，已关闭采集器抛 `CLOSED`。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
        },
        record: {
          summary: {
            en: 'Starts one independent bounded recording ring. Pair its handle stop() with exportRecord to obtain an offline record; only one recording may be active.',
            zh: '启动独立有界录制环，取得句柄后调用停止方法，再搭配 `exportRecord` 输出离线记录，同一时刻仅允许一个录制。'
          },
          params: {
            options: {
              en: 'Optional maxEvents positive safe integer capacity, defaulting to the collector maxEvents. This bound is separate from main query retention.',
              zh: '可选正安全整数容量 `maxEvents`，默认采集器事件容量，此限制独立于主查询环保留。'
            }
          },
          returns: {
            en: 'A handle with stop(): IRpcDevtoolsRecord, taking no arguments and stopping only its own active ring. Duplicate start throws RECORD_ACTIVE; a stale or repeated stop throws RECORD_NOT_ACTIVE; closure throws CLOSED.',
            zh: '返回含无参数停止方法的句柄，停止仅限其拥有的活动录制并返回离线记录，重复启动抛 `RECORD_ACTIVE`，失效或重复停止抛 `RECORD_NOT_ACTIVE`，关闭后抛 `CLOSED`。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
        },
        exportRecord: {
          summary: {
            en: 'Encodes a stopped record through the standalone canonical record codec; this method does not change retained collector state.',
            zh: '通过规范独立记录编解码器输出已停止记录，不改变采集器保留状态。'
          },
          params: {
            record: {
              en: 'IRpcDevtoolsRecord returned by a recording handle stop or record decoder.',
              zh: '录制句柄停止操作或记录解码器返回的离线记录。'
            }
          },
          returns: {
            en: 'Version-one NDJSON string; unsupported record input throws RECORD_FORMAT_INVALID with cause.',
            zh: '返回第一版逐行 `JSON` 文本，不支持的记录输入抛 `RECORD_FORMAT_INVALID` 并保留原因。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
        },
        importRecord: {
          summary: {
            en: 'Decodes offline text into an independent record; it does not append events to this collector or change its ring.',
            zh: '将离线文本解码为独立记录，不向当前采集器追加事件或修改保留环。'
          },
          params: {
            text: {
              en: 'Version-one text returned by exportRecord or encodeRpcDevtoolsRecord.',
              zh: '记录导出方法或独立编码函数返回的第一版文本。'
            }
          },
          returns: {
            en: 'IRpcDevtoolsRecord with revived native errors and bytes, or RECORD_FORMAT_INVALID with cause.',
            zh: '返回恢复原生错误和字节的离线记录，失败抛 `RECORD_FORMAT_INVALID` 并保留原因。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
        },
        pause: {
          summary: {
            en: 'Snapshots current effective stage subscriptions and replaces them with an empty selection. Repeated pause is harmless; retained data remains queryable.',
            zh: '保存当前生效的阶段订阅并替换为空选择，重复暂停无额外影响，已保留数据仍可查询。'
          },
          returns: {
            en: 'Collection is paused without pausing business RPC; closed collectors throw CLOSED.',
            zh: '采集已暂停但业务远程调用继续，已关闭采集器抛 `CLOSED`。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
        },
        resume: {
          summary: {
            en: 'Restores the effective stage selection saved by the first pause. It does not revive a closed collector.',
            zh: '恢复首次暂停时保存的生效阶段选择，不会复活已关闭的采集器。'
          },
          returns: {
            en: 'Collection resumes with prior subscriptions; repeated resume is harmless and closed collectors throw CLOSED.',
            zh: '按原订阅恢复采集，重复恢复无额外影响，已关闭采集器抛 `CLOSED`。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
        },
        clear: {
          summary: {
            en: 'Clears main query retention, aggregate statistics and loss counters. Independent recording and watch windows keep their ownership.',
            zh: '清空主查询保留、聚合统计及丢失计数，独立录制和观察窗口保留其所属关系。'
          },
          returns: {
            en: 'Main retention and statistics are empty; the collector stays open. Closed collectors throw CLOSED.',
            zh: '主保留与统计已清空，采集器仍可接收事件，已关闭采集器抛 `CLOSED`。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
        },
        close: {
          summary: {
            en: 'Idempotently removes subscriptions, releases retained storage and wakes pending watchers. It owns no serving Peer and does not close application endpoints.',
            zh: '幂等移除订阅、释放保留存储并唤醒等待观察者，不拥有服务端连接，也不会关闭应用端点。'
          },
          returns: {
            en: 'Collector storage and subscriptions are released synchronously; later operational calls reject with CLOSED.',
            zh: '同步释放采集器存储及订阅，后续操作调用以 `CLOSED` 拒绝。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
        },
        service: {
          summary: {
            en: 'IRuntimePeerProvide object installed by the caller on a separate serving Peer, commonly under a devtools namespace. Service endpoints are excluded using actual localEndpointId; the caller owns transport and Peer lifetime.',
            zh: '由调用者安装到独立服务连接、通常置于诊断命名空间下的 `IRuntimePeerProvide` 对象，按实际本地端点标识排除服务端点，传输与连接生命周期归调用者。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
        }
      }
    },
    IRpcDevtoolsOptions: {
      optionCases: [
        {
          title: {
            en: 'Keep recent invoice calls in a support view',
            zh: '在支持面板保留近期发票调用'
          },
          problem: {
            en: 'An invoice preview sometimes stalls while other worker methods run normally. Recording everything makes the support view noisy. Filter for the preview method, retain every eligible call, and bound the event and name tables so the view remains small during a long investigation.',
            zh: '发票预览偶尔卡住，工作线程的其他方法却正常。记录全部调用会让支持面板充满无关事件。只筛选预览方法、保留每个符合条件的调用，再限制事件与名称表容量，长时间排查时视图仍保持较小。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}",
          result: {
            en: 'The invoice preview renders normally, while the support timeline keeps the newest selected events without unbounded history growth.',
            zh: '发票预览正常显示，支持时间线保留最新的所选事件，历史不会无限增长。'
          },
          covers: ['methods', 'sample', 'maxEvents', 'maxInterned']
        },
        {
          title: {
            en: 'Expose only projected captured content',
            zh: '只公开经过处理的捕获内容'
          },
          problem: {
            en: 'Support needs a captured invoice envelope to investigate a malformed request, but customer details must stay out of the panel. Capture envelopes explicitly and project them before storage. Enable service exposure separately so an authorized support client can read the projected content.',
            zh: '支持人员需要捕获发票封装来排查请求格式问题，但客户详情不能进入面板。显式捕获封装，并在保存前去掉敏感内容；另行开启服务公开，获准的支持客户端才可读取处理后的内容。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}",
          result: {
            en: 'The preview keeps its original invoice data. Local and service queries expose only the projected content, within the configured content budget.',
            zh: '预览使用原始发票数据，本地和服务查询只公开处理后的内容，并受内容预算限制。'
          },
          covers: ['capture', 'maxContentBytes', 'exposeContent']
        },
        {
          title: {
            en: 'Report redactor failures without failing the call',
            zh: '脱敏失败时报告错误，不让调用失败'
          },
          problem: {
            en: 'Payment redaction is part of a support tool and can fail independently of invoice generation. Route that failure to monitoring so support can repair the projection. The failed content is dropped and the invoice remains usable instead of failing with its diagnostic tool.',
            zh: '支付信息脱敏属于支持工具，可能在发票生成成功时独立失败。把该失败交给监控，支持人员才能修复处理逻辑；失败内容被丢弃，发票仍可使用，不会跟着诊断工具一起失败。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}",
          result: {
            en: 'The invoice preview remains visible. If payment redaction fails, monitoring receives the failure and the captured content is omitted.',
            zh: '发票预览继续显示；支付信息脱敏失败时，监控收到错误，捕获内容被丢弃。'
          },
          covers: ['onError']
        }
      ],
      summary: {
        en: 'Construction policies for a bounded collector; capacities are captured once, while effective subscriptions can later change through the Core probe setStages API.',
        zh: '有界采集器构造策略，容量一次捕获，生效订阅随后可经核心探针订阅接口修改。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}",
      members: {
        methods: {
          summary: {
            en: 'Exact method path filter supplied by the application; methodless control events remain observable.',
            zh: '应用提供的精确方法路径筛选列表，不含方法名的控制事件仍可观察。'
          },
          default: {
            en: 'No method filter; all method-bearing events are eligible.',
            zh: '默认不筛选方法，所有带方法名事件均可进入后续选择。'
          }
        },
        sample: {
          summary: {
            en: 'Deterministic sampling fraction in the interval greater than zero through one, using sender/message identity rather than random per-stage decisions.',
            zh: '大于零且小于或等于一的确定性采样比例，按发送者与消息身份采样，而非逐阶段随机决定。'
          },
          default: {
            en: '`1`, retaining all eligible identities before retention limits.',
            zh: '默认 `1`，在保留上限生效前接纳所有符合条件的身份。'
          }
        },
        capture: {
          summary: {
            en: 'Explicit stages whose content may be read. Select names from RpcProbeStageName in @migaia/rpc-host/probe and keep capture within initially subscribed stages.',
            zh: '显式允许读取内容的阶段，名称来自 `@migaia/rpc-host/probe` 的阶段名表，必须为初始订阅阶段的子集。'
          },
          default: {
            en: 'No content capture; observation remains metadata-only.',
            zh: '默认不捕获内容，仅观察元数据。'
          }
        },
        redact: {
          whenToUse: {
            en: 'Set it when explicitly captured content contains data that should not be retained or logged. Return a replacement, or `undefined` to discard content. Omitting it retains the captured reference unchanged; a thrown error is reported and that content is dropped.',
            zh: '显式捕获的内容包含不应保存或记录的数据时，设置此回调。返回替换值，或返回 `undefined` 丢弃内容。省略时原样保留捕获引用；抛错会被报告，并丢弃本次内容。'
          },
          summary: {
            en: 'Synchronous callback receiving numeric RpcProbeStage and captured content. Return the retained replacement; never retain the reusable event view. Collector executes it during ingestion, log executes it at the canonical emitter.',
            zh: '接收数字阶段与已捕获内容的同步回调，返回需要保留的替代值；不可保留复用事件视图，采集器在摄取时执行，日志探针在规范发射器执行。'
          },
          params: {
            stage: {
              en: 'Numeric stage from RpcProbeStage supplied by the observing emitter.',
              zh: '由观察发射器提供、取自阶段常量表的数字阶段。'
            },
            content: {
              en: 'Captured caller-owned content reference from an explicitly enabled stage.',
              zh: '来自显式启用阶段的调用者内容引用。'
            }
          },
          returns: {
            en: 'Replacement content, including undefined to discard it. Synchronous throws discard content and are reported; asynchronous redaction is not awaited.',
            zh: '返回替代内容，可返回未定义丢弃；同步抛错丢弃内容并报告，不等待异步脱敏。'
          },
          default: {
            en: 'No redactor; explicitly captured content retains its original reference.',
            zh: '默认无脱敏回调，显式捕获内容保留其原始引用。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
        },
        onError: {
          whenToUse: {
            en: 'Set this callback when a diagnostic failure should reach the application monitor. It receives collector, formatter, logger or hub observer failures without replacing a business result. Omission keeps the documented host reporter for the owning component.',
            zh: '诊断失败需要进入应用监控时，设置这个回调。它接收采集器、格式化器、日志或聚合器观察回调的失败，不替换业务结果。省略时使用所属组件文档中说明的宿主报告函数。'
          },
          summary: {
            en: 'Synchronous observer receiving an original diagnostic error. Return nothing; observer failures are reported through the host failure channel without changing the RPC operation.',
            zh: '接收原始诊断错误的同步观察回调，无需返回值；观察回调失败经宿主失败通道报告，不改变远程调用操作结果。'
          },
          params: {
            error: {
              en: 'Original collector, logger, formatter or observation failure supplied by the owning component.',
              zh: '由所属组件提供的采集器、日志、格式化或观察原始失败。'
            }
          },
          returns: {
            en: 'No result is used and no asynchronous work is awaited by this callback boundary.',
            zh: '不使用返回值，此回调边界不等待异步工作。'
          },
          default: {
            en: 'Uses the Core hostRethrowReporter failure channel; hub reporting instead defaults to console.error.',
            zh: '默认使用核心包的宿主重新抛出报告通道，聚合器报告则默认使用宿主错误控制台。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
        },
        stages: {
          whenToUse: {
            en: 'Use `message` for logical calls and `peer` for connection lifecycle. Add `envelope`, `encoded`, `frame`, `protected` or `carrier` to inspect those physical processing steps. Omission selects message and peer; choosing a stage never enables content capture by itself.',
            zh: '用 `message` 观察逻辑调用，用 `peer` 观察连接生命周期。需要检查封装、编码、分帧、保护后内容或物理载体时，分别增加 `envelope`、`encoded`、`frame`、`protected` 或 `carrier`。省略时选择消息与连接阶段；选中阶段本身不会开启内容捕获。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}",
          summary: {
            en: 'Initial stage names from Core RpcProbeStageName; physical stages require explicit selection and selection alone never enables capture.',
            zh: '核心规范阶段名中的初始订阅，物理阶段需显式选择，选择本身不会开启内容捕获。'
          },
          default: {
            en: '`["message", "peer"]`; physical stages are not subscribed.',
            zh: '默认 `["message", "peer"]`，不订阅物理阶段。'
          },
          values: {
            message: {
              en: 'Logical request, response and control observations.',
              zh: '逻辑请求、响应与控制观察。'
            },
            peer: {
              en: 'Connection lifecycle observations.',
              zh: '连接生命周期观察。'
            },
            envelope: {
              en: 'Envelope observations; explicit opt-in.',
              zh: '封装观察，需要显式选择。'
            },
            encoded: {
              en: 'Encoded content observations; explicit opt-in.',
              zh: '编码内容观察，需要显式选择。'
            },
            frame: {
              en: 'Frame observations; explicit opt-in.',
              zh: '分帧观察，需要显式选择。'
            },
            protected: {
              en: 'Protected content observations; explicit opt-in.',
              zh: '保护后内容观察，需要显式选择。'
            },
            carrier: {
              en: 'Physical carrier observations; explicit opt-in.',
              zh: '物理载体观察，需要显式选择。'
            }
          }
        },
        maxEvents: {
          summary: {
            en: 'Main-ring positive safe integer capacity, at most the JavaScript array length limit; newest events evict oldest events.',
            zh: '主环正安全整数容量，不超过语言数组长度上限，新事件淘汰最旧事件。'
          },
          default: {
            en: '10000 retained events in the main ring.',
            zh: '默认主环保留 `10000` 个事件。'
          }
        },
        maxContentBytes: {
          summary: {
            en: 'Nonnegative safe integer budget for content retained by the main query ring; independent recording/watch references and opaque-object sizing are outside this byte total. It is not a process-wide memory ceiling; excess content drops while metadata stays.',
            zh: '主查询环保留内容的非负安全整数预算；独立录制、观察引用及不透明对象计量不属于同一字节总量，不是进程总内存上限；超额丢弃内容但保留元数据。'
          },
          default: {
            en: '8388608 bytes, or eight mebibytes.',
            zh: '默认 `8388608` 字节，即八兆二进制字节。'
          }
        },
        maxInterned: {
          summary: {
            en: 'Positive safe integer reader name-table bound, at most floor(sqrt(MAX_SAFE_INTEGER)) minus one; overflow uses an explicit marker.',
            zh: '读取时名称表的正安全整数上限，不超过最大安全整数平方根向下取整再减一，溢出使用显式标记。'
          },
          default: {
            en: '65536 names; ingestion itself retains raw string references.',
            zh: '默认 `65536` 个名称，摄取本身保留原始字符串引用。'
          }
        },
        exposeContent: {
          summary: {
            en: 'Allows captured content across the portable service boundary; local query and stopped recordings already use their retained captured content.',
            zh: '允许已捕获内容通过可移植服务边界，本地查询与停止录制已可使用保留的捕获内容。'
          },
          default: {
            en: 'false; service responses omit captured content.',
            zh: '默认 `false`，服务响应省略捕获内容。'
          }
        }
      }
    },
    IRpcDevtoolsQuery: {
      summary: {
        en: 'Snapshot filter over one collector sequence domain; stages and outcomes use canonical Core names, while method and endpoint lists use exact membership.',
        zh: '单个采集器序号域内的快照筛选，阶段及结果使用核心规范名称，方法及端点列表精确匹配。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}",
      members: {
        afterSeq: {
          summary: {
            en: 'Exclusive lower cursor from a prior page nextSeq, or zero for the retained beginning.',
            zh: '取自上一页下页游标的排他下界，首次读取可用零。'
          },
          default: {
            en: 'Zero, scanning from the first retained sequence.',
            zh: '默认零，从首个保留序号开始扫描。'
          }
        },
        limit: {
          summary: {
            en: 'Positive safe integer page size between one and one thousand.',
            zh: '一至一千之间的正安全整数页大小。'
          },
          default: {
            en: '1000 events per query snapshot.',
            zh: '默认每次查询至多一千事件。'
          }
        },
        stages: {
          summary: {
            en: 'Exact canonical stage names from the Core probe stage table; an empty array matches no events.',
            zh: '核心探针阶段表中的精确名称，空数组不匹配任何事件。'
          },
          default: {
            en: 'All stages present in retained data.',
            zh: '默认匹配保留数据中的所有阶段。'
          }
        },
        outcomes: {
          summary: {
            en: 'Canonical outcome names from Core RpcProbeOutcomeName; an empty array matches no events.',
            zh: '核心规范结果名表中的名称，空数组不匹配任何事件。'
          },
          default: {
            en: 'All outcomes present in retained data.',
            zh: '默认匹配保留数据中的所有结果。'
          }
        },
        methods: {
          summary: {
            en: 'Exact method paths read from observed events or supplied by the application method catalog.',
            zh: '取自观察事件或应用方法目录的精确方法路径。'
          },
          default: {
            en: 'No method filter is applied.',
            zh: '默认不施加方法筛选。'
          }
        },
        trace: {
          summary: {
            en: 'Explicit trace copied from an observed event or application propagation context.',
            zh: '从观察事件或应用传播上下文复制的显式追踪标识。'
          },
          default: {
            en: 'No trace filter is applied.',
            zh: '默认不施加追踪标识筛选。'
          }
        },
        endpointIds: {
          summary: {
            en: 'Endpoint identifiers issued by Core endpoint creation and available in descriptors or wire events.',
            zh: '核心端点创建签发、可从端点描述或线事件取得的标识。'
          },
          default: {
            en: 'No endpoint filter is applied.',
            zh: '默认不施加端点筛选。'
          }
        }
      }
    },
    IRpcDevtoolsCounters: {
      summary: {
        en: 'Loss and lifecycle decision counters observed with snapshots; these distinguish retention loss from sampling or disabled ingestion.',
        zh: '随快照观察的丢失及生命周期决策计数，用于区分保留丢失、采样和禁用摄取。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}",
      members: {
        evicted: {
          summary: {
            en: 'Number of oldest main-ring events overwritten by bounded retention.',
            zh: '因有界保留而覆盖的最旧主环事件数量。'
          }
        },
        contentDropped: {
          summary: {
            en: 'Number of captures discarded because the retained content byte budget would be exceeded.',
            zh: '因保留内容超出字节预算而丢弃的捕获内容数量。'
          }
        },
        droppedReentrant: {
          summary: {
            en: 'Events rejected because synchronous ingestion was reentered before the previous event completed.',
            zh: '前一事件尚未完成时同步重入摄取而被拒绝的事件数量。'
          }
        },
        sampledOut: {
          summary: {
            en: 'Events discarded by deterministic sender/message sampling at collector ingestion.',
            zh: '在采集器摄取时被确定性发送者与消息采样丢弃的事件数量。'
          }
        },
        ignoredWhilePaused: {
          summary: {
            en: 'Direct emit attempts ignored after pause; unsubscribed emitters normally do not call the collector.',
            zh: '暂停后被忽略的直接发射尝试数量，取消订阅的发射器通常不会调用采集器。'
          }
        },
        ignoredAfterClose: {
          summary: {
            en: 'Direct emit attempts ignored after terminal collector closure.',
            zh: '采集器终态关闭后被忽略的直接发射尝试数量。'
          }
        },
        internOverflow: {
          summary: {
            en: 'Reader-side names exceeding the bounded intern table and mapped to its explicit overflow marker.',
            zh: '读取侧名称超出有界驻留表并映射到显式溢出标记的数量。'
          }
        }
      }
    },
    IRpcDevtoolsPage: {
      summary: {
        en: 'Query snapshot with ordered retained events, the last scanned sequence cursor and loss counters captured at that read.',
        zh: '查询快照，包含有序保留事件、最后扫描序号游标及该次读取捕获的丢失计数。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}",
      members: {
        events: {
          summary: {
            en: 'Matching IRpcDevtoolsWireEvent rows in collector sequence order; elements may retain cached boundary references.',
            zh: '按采集器序号排序的匹配线事件行，元素可保留缓存边界引用。'
          }
        },
        nextSeq: {
          summary: {
            en: 'Collector-issued cursor for the next query afterSeq; scanning excluded rows can advance it even when events is empty.',
            zh: '供下次查询下界使用的采集器游标，即使匹配事件为空，扫描被排除行仍可推进它。'
          }
        },
        counters: {
          summary: {
            en: 'IRpcDevtoolsCounters snapshot explaining observed retention and ingestion loss.',
            zh: '说明当前保留及摄取丢失的计数快照。'
          }
        }
      }
    },
    IRpcDevtoolsWatchBatch: {
      summary: {
        en: 'One future-event watch delivery, with filtered event rows and loss since the previous delivered batch.',
        zh: '一次未来事件观察交付，包含筛选事件行及前一交付批次之后的丢失。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}",
      members: {
        events: {
          summary: {
            en: 'At most 256 matching future wire events retained by this watcher.',
            zh: '当前观察者保留、至多二百五十六个匹配未来线事件。'
          }
        },
        dropped: {
          summary: {
            en: 'Events lost to watcher queues plus raw shared-window overwrite before filtering; raw losses cannot be reconstructed as filtered matches.',
            zh: '观察队列丢失与筛选前共享原始窗口覆盖数量之和，原始丢失无法还原为筛选后命中数量。'
          }
        }
      }
    },
    IRpcDevtoolsStats: {
      summary: {
        en: 'Cumulative endpoint/method settlement aggregates independent of query-ring eviction. Twenty-four exponential histogram boundaries start at 0.0625 milliseconds; quantiles interpolate and clamp to observed maximum.',
        zh: '不受查询环淘汰影响的端点与方法累计结算聚合，二十四个指数直方图边界始于 `0.0625` 毫秒，分位数插值并钳制在已观察最大值内。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}",
      members: {
        since: {
          summary: {
            en: 'Statistics window start timestamp, reset when the collector statistics are cleared.',
            zh: '统计窗口起始时间戳，清空采集统计时重置。'
          }
        },
        methods: {
          summary: {
            en: 'Per endpointId/method rows: calls counts qualified settlements; failed/rejected/timedOut/aborted classify outcomes. latencyBucketsMs are boundaries, latencyCounts are counts; optional latencyOverflowFromMs starts the open final bucket and latencyMaxMs bounds interpolation. p50Ms/p95Ms/p99Ms are percentile milliseconds. Endpoint IDs and methods originate from observed Core events.',
            zh: '按观察核心事件的端点标识及方法分组；调用计数记录合格结算，失败、拒绝、超时及取消分别分类；延迟边界数组与计数数组记录直方图，可选溢出下界标识末尾开放桶，可选最大值限制插值，三个分位数字段分别为五十、九十五及九十九百分位毫秒数。'
          }
        }
      }
    },
    IRpcDevtoolsDescribe: {
      summary: {
        en: 'Collector description snapshot used locally or by live hub clock sampling; includes no transport ownership.',
        zh: '本地或实时聚合时钟采样使用的采集器描述快照，不包含传输所有权。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}",
      members: {
        version: {
          summary: {
            en: 'Current service observation contract version string, currently one.',
            zh: '当前服务观察契约版本字符串，目前为版本一。'
          }
        },
        now: {
          summary: {
            en: 'Fresh systemScheduler monotonic millisecond sample, in the same domain as default Core event at. Custom-clock clients must supply a matching sample; stats.since remains wall-clock time.',
            zh: '描述调用读取的系统调度器单调毫秒采样，与默认核心事件时间同域；自定义时钟客户端须提供同域采样，统计起点仍为墙上时钟。'
          }
        },
        paused: {
          summary: {
            en: 'Whether collector subscriptions are currently paused.',
            zh: '当前采集器订阅是否处于暂停状态。'
          }
        },
        descriptors: {
          summary: {
            en: 'Known IRpcProbeDescriptor references supplied by installed Core emitters; Core owns their stage and capability semantics.',
            zh: '已安装核心发射器提供的已知描述引用，阶段与能力语义归核心包拥有。'
          }
        },
        limits: {
          summary: {
            en: 'Captured maxEvents main-ring capacity and maxContentBytes content budget from collector construction.',
            zh: '采集器构造时捕获的主环事件容量与内容字节预算。'
          }
        },
        counters: {
          summary: {
            en: 'Current IRpcDevtoolsCounters snapshot explaining data loss and lifecycle decisions.',
            zh: '说明数据丢失及生命周期决策的当前计数快照。'
          }
        }
      }
    },
    IRpcDevtoolsWireEvent: {
      summary: {
        en: 'Reader/service event representation; top-level metadata is copied from synchronous reusable views, while detail, error and captured content may retain their nested references.',
        zh: '读取及服务事件表示，顶层元数据从同步复用视图复制，细节、错误及捕获内容可保留其嵌套引用。'
      },
      example:
        "import { RpcDevtoolsRecordFormat, encodeRpcDevtoolsRecord, decodeRpcDevtoolsRecord } from '@migaia/rpc-plugin-devtools/contract'\n\nconst text = encodeRpcDevtoolsRecord({\n  header: RpcDevtoolsRecordFormat,\n  events: [{ seq: 1, at: 100, endpointId: 'worker', stage: 'message', direction: 'outbound', method: 'read', senderId: 'worker', messageId: 'm1', trace: 'T1', content: JSON.stringify({ $bytes: 'AQ==' }) }]\n})\nconsole.log(decodeRpcDevtoolsRecord(text).events[0])",
      members: {
        target: {
          summary: {
            en: 'Optional hub-supplied target name from addTarget or importRecord, separate from Core endpoint identity.',
            zh: '可选聚合目标名，来自添加目标或导入记录时的调用者命名，与核心端点身份分开。'
          },
          default: {
            en: 'Absent in ordinary collector events without a hub target projection.',
            zh: '普通采集器事件没有聚合目标投影时省略。'
          }
        },
        seq: {
          summary: {
            en: 'Collector-domain sequence issued during ingestion; use query nextSeq for pagination rather than physical ring offsets.',
            zh: '摄取时签发的采集器序号，分页使用查询下页游标，而非物理环下标。'
          }
        },
        carrierSeq: {
          summary: {
            en: 'Collector-domain sequence pointing to an observed inbound carrier origin in this target; absence means no retained resolved link.',
            zh: '指向当前目标已观察入站载体来源的采集器序号，省略代表没有保留且已解析的链接。'
          },
          default: {
            en: 'Absent when no originating carrier link can be resolved.',
            zh: '无法解析来源载体链接时省略。'
          }
        },
        at: {
          summary: {
            en: 'Timestamp supplied by the observing Core emitter; hub alignment wraps it without modifying this original number.',
            zh: '观察核心发射器提供的时间戳，聚合对齐使用包装字段，不修改原始数值。'
          }
        },
        endpointId: {
          summary: {
            en: 'Endpoint identifier issued by the Core endpoint constructor and captured by its emitter.',
            zh: '由核心端点构造函数签发并被所属发射器捕获的端点标识。'
          }
        },
        stage: {
          summary: {
            en: 'Canonical stage name from RpcProbeStageName in the Core probe contract.',
            zh: '来自核心探针契约阶段名表的规范阶段名称。'
          }
        },
        direction: {
          summary: {
            en: 'Canonical inbound or outbound direction name from the Core probe contract.',
            zh: '来自核心探针契约的规范入站或出站方向名称。'
          }
        },
        kind: {
          summary: {
            en: 'Optional logical message kind name from the Core probe taxonomy; physical-only observations may omit it.',
            zh: '核心探针分类中的可选逻辑消息种类，纯物理观察可省略。'
          },
          default: {
            en: 'Absent when the observing layer cannot identify a logical message kind.',
            zh: '观察层无法识别逻辑消息种类时省略。'
          }
        },
        outcome: {
          summary: {
            en: 'Optional canonical event outcome name used by queries and settlement statistics.',
            zh: '供查询及结算统计使用的可选规范事件结果名称。'
          },
          default: {
            en: 'Absent when the observation has no outcome classification.',
            zh: '观察不具备结果分类时省略。'
          }
        },
        messageId: {
          summary: {
            en: 'Message identifier issued by the originating RPC sender; combine with senderId for interaction correlation.',
            zh: '来源远程调用发送者签发的消息标识，与发送者标识一起用于交互关联。'
          },
          default: {
            en: 'Absent when no logical message identity is observable.',
            zh: '无法观察逻辑消息身份时省略。'
          }
        },
        method: {
          summary: {
            en: 'Method path observed on the logical message; names originate from the caller method route.',
            zh: '逻辑消息上观察到的方法路径，名称取自调用者使用的方法路由。'
          },
          default: {
            en: 'Absent on observations without a logical method route.',
            zh: '观察不含逻辑方法路由时省略。'
          }
        },
        variation: {
          summary: {
            en: 'Original variation route observed on message or envelope stages, preserving the Core route vocabulary.',
            zh: '消息或封装阶段观察到的原始变体路由，保留核心路由词汇。'
          },
          default: {
            en: 'Absent on stages where no variation route is observed.',
            zh: '没有观察到变体路由的阶段省略。'
          }
        },
        senderId: {
          summary: {
            en: 'Originating sender identity supplied by the observed RPC message.',
            zh: '被观察远程调用消息提供的来源发送者身份。'
          },
          default: {
            en: 'Absent when the observed layer has no sender identity.',
            zh: '观察层没有发送者身份时省略。'
          }
        },
        targetId: {
          summary: {
            en: 'Destination identity supplied by the observed RPC routing envelope.',
            zh: '被观察远程调用路由封装提供的目的身份。'
          },
          default: {
            en: 'Absent when no destination identity is available.',
            zh: '目的身份不可用时省略。'
          }
        },
        receiverId: {
          summary: {
            en: 'Actual receiver identity supplied by the observed receive path, which may differ from a routing target.',
            zh: '被观察接收路径提供的实际接收者身份，可能与路由目标不同。'
          },
          default: {
            en: 'Absent when the receive layer cannot expose a receiver.',
            zh: '接收层无法提供接收者时省略。'
          }
        },
        peerId: {
          summary: {
            en: 'Peer identity issued by the observed Core peer lifecycle path.',
            zh: '被观察核心连接生命周期路径签发的连接身份。'
          },
          default: {
            en: 'Absent when the event is unrelated to an identified peer.',
            zh: '事件不关联已识别连接时省略。'
          }
        },
        trace: {
          summary: {
            en: 'Explicit application-provided trace carried by the observed message; native Peer calls do not automatically invent it.',
            zh: '被观察消息携带的显式应用追踪标识，原生连接调用不会自动生成它。'
          },
          default: {
            en: 'Absent unless the application propagates a trace.',
            zh: '应用未传播追踪标识时省略。'
          }
        },
        sizeBytes: {
          summary: {
            en: 'Observed byte count when the layer knows it; missing sizes are not substituted with zero.',
            zh: '观察层已知时记录的字节数，不把缺失大小替换为零。'
          },
          default: {
            en: 'Absent when the source reports its unknown-size sentinel.',
            zh: '来源报告未知大小哨兵时省略。'
          }
        },
        chunk: {
          summary: {
            en: 'Observed chunk position: index is the source chunk index and count is its source chunk count; values come from the Core event.',
            zh: '观察到的分块位置，索引与数量均取自核心来源事件。'
          },
          default: {
            en: 'Absent when the event is not an observed chunk.',
            zh: '事件不是已观察分块时省略。'
          }
        },
        members: {
          summary: {
            en: 'Observed batch member count supplied by the source event.',
            zh: '来源事件提供的已观察批次成员数量。'
          },
          default: {
            en: 'Absent when the event has no batch member count.',
            zh: '事件没有批次成员数量时省略。'
          }
        },
        durationMs: {
          summary: {
            en: 'Observed settlement duration in milliseconds; aggregates accept nonnegative durations on message settlement outcomes.',
            zh: '观察到的毫秒结算耗时，聚合统计接纳消息结算结果的非负耗时。'
          },
          default: {
            en: 'Absent when the source event does not describe settlement.',
            zh: '来源事件不描述结算时省略。'
          }
        },
        rejection: {
          summary: {
            en: 'Package-local rejection reason from the observed provider boundary, distinguishing causes that share an error code.',
            zh: '来自被观察提供者边界的包级拒绝原因，用于区分共享错误码的不同失败原因。'
          },
          default: {
            en: 'Absent when no rejection reason is observed.',
            zh: '没有观察到拒绝原因时省略。'
          }
        },
        lifecycle: {
          summary: {
            en: 'Observed Core lifecycle event name, retaining the emitting owner vocabulary.',
            zh: '观察到的核心生命周期事件名，保留发射方拥有的词汇。'
          },
          default: {
            en: 'Absent outside lifecycle observations.',
            zh: '非生命周期观察时省略。'
          }
        },
        error: {
          summary: {
            en: 'Canonical serialized error graph owned by @migaia/rpc-contract/errors, retaining source, code, stack and causes.',
            zh: '由 `@migaia/rpc-contract/errors` 拥有的规范序列化错误图，保留来源、码、堆栈及原因。'
          },
          default: {
            en: 'Absent when no error is attached to the observation.',
            zh: '观察未附错误时省略。'
          }
        },
        carrier: {
          summary: {
            en: 'Observed physical carrier name supplied by the adapter or Core descriptor.',
            zh: '适配器或核心描述提供的已观察物理载体名称。'
          },
          default: {
            en: 'Absent when the source cannot identify a physical carrier.',
            zh: '来源无法识别物理载体时省略。'
          }
        },
        detail: {
          summary: {
            en: 'Adapter-owned scalar detail record; keys describe the observed carrier, and retained values are not deeply copied.',
            zh: '适配器拥有的标量细节记录，键描述观察到的载体，保留值不执行深复制。'
          },
          default: {
            en: 'Absent when the observing carrier exposes no detail record.',
            zh: '观察载体未暴露细节记录时省略。'
          }
        },
        content: {
          summary: {
            en: 'Opted-in captured reference after redaction; mutating or transferring its backing may affect later reads. Service exposure separately requires exposeContent. The record codec reserves any nested single-key {$bytes: base64} object for byte revival; use JSON text for a same-shaped business object.',
            zh: '显式捕获并经脱敏后的引用，修改或转移底层存储可能影响后续读取，服务暴露另需显式开启；记录编解码把任意嵌套单键字节标签对象作为字节保留语法，同形业务对象须自行存为对象文本。'
          },
          default: {
            en: 'Absent in metadata-only mode or after redaction/budget removal.',
            zh: '仅元数据模式、脱敏丢弃或预算移除后省略。'
          }
        }
      }
    },
    IRpcWireError: {
      summary: {
        en: 'The error data stored in a Devtools event when an error must cross a connection. It is another name for [IRpcSerializedError](/en/docs/rpc-contract/api/errors/IRpcSerializedError), defined by RPC Contract. That format carries source and code for classification, stack for the original call trace, and references to causes or grouped errors. Devtools uses this shared format so error details can be read without inventing a second representation.',
        zh: '错误需要通过连接传递时，调试事件用这个类型保存错误数据。它是 RPC Contract 定义的 [IRpcSerializedError](/zh/docs/rpc-contract/api/errors/IRpcSerializedError) 的另一个名称。其中 source 和 code 用于区分错误来源及类别，stack 保存原始调用堆栈，其他引用记录原因或一组相关错误。调试工具直接使用这份共同格式，读取事件时无需再转换成另一套错误表示。'
      },
      example:
        "import { RpcDevtoolsRecordFormat, encodeRpcDevtoolsRecord, decodeRpcDevtoolsRecord } from '@migaia/rpc-plugin-devtools/contract'\n\nconst text = encodeRpcDevtoolsRecord({\n  header: RpcDevtoolsRecordFormat,\n  events: [{ seq: 1, at: 100, endpointId: 'worker', stage: 'message', direction: 'outbound', method: 'read', senderId: 'worker', messageId: 'm1', trace: 'T1', content: JSON.stringify({ $bytes: 'AQ==' }) }]\n})\nconsole.log(decodeRpcDevtoolsRecord(text).events[0])",
      members: {}
    },
    IRpcDevtoolsRecord: {
      summary: {
        en: 'Offline ordered recording with a frozen format header and event array. Native errors and bytes are restored around the record codec. At any event depth, a single-key {$bytes: base64} object is reserved v1 byte syntax and decodes as Uint8Array. Unknown content is not lossless for arbitrary objects; store same-shaped business data as JSON text, with no automatic escaping.',
        zh: '离线有序录制，包含固定格式头及事件数组，编解码恢复原生错误和字节；事件任意深度的单键字节标签对象是第一版保留语法，解码为字节数组；未知内容不保证任意对象无损，同形业务对象应自行存为对象文本，不自动转义。'
      },
      scenarios: [
        {
          en: 'Save a stopped observation window and import it into an offline hub without live connections.',
          zh: '保存已停止观察窗口，并在无实时连接时导入离线聚合器。'
        }
      ],
      example:
        "import { RpcDevtoolsRecordFormat, encodeRpcDevtoolsRecord, decodeRpcDevtoolsRecord } from '@migaia/rpc-plugin-devtools/contract'\n\nconst text = encodeRpcDevtoolsRecord({\n  header: RpcDevtoolsRecordFormat,\n  events: [{ seq: 1, at: 100, endpointId: 'worker', stage: 'message', direction: 'outbound', method: 'read', senderId: 'worker', messageId: 'm1', trace: 'T1', content: JSON.stringify({ $bytes: 'AQ==' }) }]\n})\nconsole.log(decodeRpcDevtoolsRecord(text).events[0])",
      members: {
        header: {
          summary: {
            en: 'IRpcDevtoolsRecordHeader with exact RpcDevtoolsRecordFormat format and version identity.',
            zh: '包含规范记录格式及版本精确身份的记录头。'
          }
        },
        events: {
          summary: {
            en: 'IRpcDevtoolsRecordEvent array preserving recorded order, with native or canonical wire errors accepted at input.',
            zh: '保留录制顺序的记录事件数组，输入接受原生或规范线错误。'
          }
        }
      }
    },
    IRpcDevtoolsRecordHeader: {
      summary: {
        en: 'Readonly exact header shape of RpcDevtoolsRecordFormat: format is migaia-rpc-devtools and numeric version is one; no clock or descriptor data is implied.',
        zh: '规范记录格式常量的精确只读头形状，格式标识固定且数字版本为一，不暗含时钟或端点描述数据。'
      },
      example:
        "import { RpcDevtoolsRecordFormat, encodeRpcDevtoolsRecord, decodeRpcDevtoolsRecord } from '@migaia/rpc-plugin-devtools/contract'\n\nconst text = encodeRpcDevtoolsRecord({\n  header: RpcDevtoolsRecordFormat,\n  events: [{ seq: 1, at: 100, endpointId: 'worker', stage: 'message', direction: 'outbound', method: 'read', senderId: 'worker', messageId: 'm1', trace: 'T1', content: JSON.stringify({ $bytes: 'AQ==' }) }]\n})\nconsole.log(decodeRpcDevtoolsRecord(text).events[0])",
      members: {
        format: {
          summary: {
            en: 'Exact format marker migaia-rpc-devtools, selecting this NDJSON grammar.',
            zh: '精确格式标记 `migaia-rpc-devtools`，用于选择当前逐行语法。'
          }
        },
        version: {
          summary: {
            en: 'Exact numeric version one; other versions are rejected instead of silently migrated.',
            zh: '精确数字版本一，其他版本会被拒绝而非静默迁移。'
          }
        }
      }
    },
    IRpcDevtoolsRecordEvent: {
      summary: {
        en: 'Wire event fields with an error override accepting a native Error or the external canonical wire error graph. Decoding restores native errors without rebuilding their stacks.',
        zh: '线事件字段附带错误表示覆盖，接受原生错误或外包规范线错误图，解码恢复原生错误且不重建堆栈。'
      },
      example:
        "import { RpcDevtoolsRecordFormat, encodeRpcDevtoolsRecord, decodeRpcDevtoolsRecord } from '@migaia/rpc-plugin-devtools/contract'\n\nconst text = encodeRpcDevtoolsRecord({\n  header: RpcDevtoolsRecordFormat,\n  events: [{ seq: 1, at: 100, endpointId: 'worker', stage: 'message', direction: 'outbound', method: 'read', senderId: 'worker', messageId: 'm1', trace: 'T1', content: JSON.stringify({ $bytes: 'AQ==' }) }]\n})\nconsole.log(decodeRpcDevtoolsRecord(text).events[0])",
      members: {
        target: {
          summary: {
            en: 'Optional hub-supplied target name from addTarget or importRecord, separate from Core endpoint identity.',
            zh: '可选聚合目标名，来自添加目标或导入记录时的调用者命名，与核心端点身份分开。'
          },
          default: {
            en: 'Absent in ordinary collector events without a hub target projection.',
            zh: '普通采集器事件没有聚合目标投影时省略。'
          }
        },
        seq: {
          summary: {
            en: 'Collector-domain sequence issued during ingestion; use query nextSeq for pagination rather than physical ring offsets.',
            zh: '摄取时签发的采集器序号，分页使用查询下页游标，而非物理环下标。'
          }
        },
        carrierSeq: {
          summary: {
            en: 'Collector-domain sequence pointing to an observed inbound carrier origin in this target; absence means no retained resolved link.',
            zh: '指向当前目标已观察入站载体来源的采集器序号，省略代表没有保留且已解析的链接。'
          },
          default: {
            en: 'Absent when no originating carrier link can be resolved.',
            zh: '无法解析来源载体链接时省略。'
          }
        },
        at: {
          summary: {
            en: 'Timestamp supplied by the observing Core emitter; hub alignment wraps it without modifying this original number.',
            zh: '观察核心发射器提供的时间戳，聚合对齐使用包装字段，不修改原始数值。'
          }
        },
        endpointId: {
          summary: {
            en: 'Endpoint identifier issued by the Core endpoint constructor and captured by its emitter.',
            zh: '由核心端点构造函数签发并被所属发射器捕获的端点标识。'
          }
        },
        stage: {
          summary: {
            en: 'Canonical stage name from RpcProbeStageName in the Core probe contract.',
            zh: '来自核心探针契约阶段名表的规范阶段名称。'
          }
        },
        direction: {
          summary: {
            en: 'Canonical inbound or outbound direction name from the Core probe contract.',
            zh: '来自核心探针契约的规范入站或出站方向名称。'
          }
        },
        kind: {
          summary: {
            en: 'Optional logical message kind name from the Core probe taxonomy; physical-only observations may omit it.',
            zh: '核心探针分类中的可选逻辑消息种类，纯物理观察可省略。'
          },
          default: {
            en: 'Absent when the observing layer cannot identify a logical message kind.',
            zh: '观察层无法识别逻辑消息种类时省略。'
          }
        },
        outcome: {
          summary: {
            en: 'Optional canonical event outcome name used by queries and settlement statistics.',
            zh: '供查询及结算统计使用的可选规范事件结果名称。'
          },
          default: {
            en: 'Absent when the observation has no outcome classification.',
            zh: '观察不具备结果分类时省略。'
          }
        },
        messageId: {
          summary: {
            en: 'Message identifier issued by the originating RPC sender; combine with senderId for interaction correlation.',
            zh: '来源远程调用发送者签发的消息标识，与发送者标识一起用于交互关联。'
          },
          default: {
            en: 'Absent when no logical message identity is observable.',
            zh: '无法观察逻辑消息身份时省略。'
          }
        },
        method: {
          summary: {
            en: 'Method path observed on the logical message; names originate from the caller method route.',
            zh: '逻辑消息上观察到的方法路径，名称取自调用者使用的方法路由。'
          },
          default: {
            en: 'Absent on observations without a logical method route.',
            zh: '观察不含逻辑方法路由时省略。'
          }
        },
        variation: {
          summary: {
            en: 'Original variation route observed on message or envelope stages, preserving the Core route vocabulary.',
            zh: '消息或封装阶段观察到的原始变体路由，保留核心路由词汇。'
          },
          default: {
            en: 'Absent on stages where no variation route is observed.',
            zh: '没有观察到变体路由的阶段省略。'
          }
        },
        senderId: {
          summary: {
            en: 'Originating sender identity supplied by the observed RPC message.',
            zh: '被观察远程调用消息提供的来源发送者身份。'
          },
          default: {
            en: 'Absent when the observed layer has no sender identity.',
            zh: '观察层没有发送者身份时省略。'
          }
        },
        targetId: {
          summary: {
            en: 'Destination identity supplied by the observed RPC routing envelope.',
            zh: '被观察远程调用路由封装提供的目的身份。'
          },
          default: {
            en: 'Absent when no destination identity is available.',
            zh: '目的身份不可用时省略。'
          }
        },
        receiverId: {
          summary: {
            en: 'Actual receiver identity supplied by the observed receive path, which may differ from a routing target.',
            zh: '被观察接收路径提供的实际接收者身份，可能与路由目标不同。'
          },
          default: {
            en: 'Absent when the receive layer cannot expose a receiver.',
            zh: '接收层无法提供接收者时省略。'
          }
        },
        peerId: {
          summary: {
            en: 'Peer identity issued by the observed Core peer lifecycle path.',
            zh: '被观察核心连接生命周期路径签发的连接身份。'
          },
          default: {
            en: 'Absent when the event is unrelated to an identified peer.',
            zh: '事件不关联已识别连接时省略。'
          }
        },
        trace: {
          summary: {
            en: 'Explicit application-provided trace carried by the observed message; native Peer calls do not automatically invent it.',
            zh: '被观察消息携带的显式应用追踪标识，原生连接调用不会自动生成它。'
          },
          default: {
            en: 'Absent unless the application propagates a trace.',
            zh: '应用未传播追踪标识时省略。'
          }
        },
        sizeBytes: {
          summary: {
            en: 'Observed byte count when the layer knows it; missing sizes are not substituted with zero.',
            zh: '观察层已知时记录的字节数，不把缺失大小替换为零。'
          },
          default: {
            en: 'Absent when the source reports its unknown-size sentinel.',
            zh: '来源报告未知大小哨兵时省略。'
          }
        },
        chunk: {
          summary: {
            en: 'Observed chunk position: index is the source chunk index and count is its source chunk count; values come from the Core event.',
            zh: '观察到的分块位置，索引与数量均取自核心来源事件。'
          },
          default: {
            en: 'Absent when the event is not an observed chunk.',
            zh: '事件不是已观察分块时省略。'
          }
        },
        members: {
          summary: {
            en: 'Observed batch member count supplied by the source event.',
            zh: '来源事件提供的已观察批次成员数量。'
          },
          default: {
            en: 'Absent when the event has no batch member count.',
            zh: '事件没有批次成员数量时省略。'
          }
        },
        durationMs: {
          summary: {
            en: 'Observed settlement duration in milliseconds; aggregates accept nonnegative durations on message settlement outcomes.',
            zh: '观察到的毫秒结算耗时，聚合统计接纳消息结算结果的非负耗时。'
          },
          default: {
            en: 'Absent when the source event does not describe settlement.',
            zh: '来源事件不描述结算时省略。'
          }
        },
        rejection: {
          summary: {
            en: 'Package-local rejection reason from the observed provider boundary, distinguishing causes that share an error code.',
            zh: '来自被观察提供者边界的包级拒绝原因，用于区分共享错误码的不同失败原因。'
          },
          default: {
            en: 'Absent when no rejection reason is observed.',
            zh: '没有观察到拒绝原因时省略。'
          }
        },
        lifecycle: {
          summary: {
            en: 'Observed Core lifecycle event name, retaining the emitting owner vocabulary.',
            zh: '观察到的核心生命周期事件名，保留发射方拥有的词汇。'
          },
          default: {
            en: 'Absent outside lifecycle observations.',
            zh: '非生命周期观察时省略。'
          }
        },
        error: {
          summary: {
            en: 'Optional native Error or IRpcWireError supplied by a stopped recording or application; codec preserves the canonical cause graph and stacks.',
            zh: '已停止录制或应用提供的可选原生错误或规范线错误，编解码器保留规范原因图及堆栈。'
          },
          default: {
            en: 'Absent when no error belongs to the event.',
            zh: '事件没有所属错误时省略。'
          }
        },
        carrier: {
          summary: {
            en: 'Observed physical carrier name supplied by the adapter or Core descriptor.',
            zh: '适配器或核心描述提供的已观察物理载体名称。'
          },
          default: {
            en: 'Absent when the source cannot identify a physical carrier.',
            zh: '来源无法识别物理载体时省略。'
          }
        },
        detail: {
          summary: {
            en: 'Adapter-owned scalar detail record; keys describe the observed carrier, and retained values are not deeply copied.',
            zh: '适配器拥有的标量细节记录，键描述观察到的载体，保留值不执行深复制。'
          },
          default: {
            en: 'Absent when the observing carrier exposes no detail record.',
            zh: '观察载体未暴露细节记录时省略。'
          }
        },
        content: {
          summary: {
            en: 'Opted-in captured reference after redaction; mutating or transferring its backing may affect later reads. Service exposure separately requires exposeContent. The record codec reserves any nested single-key {$bytes: base64} object for byte revival; use JSON text for a same-shaped business object.',
            zh: '显式捕获并经脱敏后的引用，修改或转移底层存储可能影响后续读取，服务暴露另需显式开启；记录编解码把任意嵌套单键字节标签对象作为字节保留语法，同形业务对象须自行存为对象文本。'
          },
          default: {
            en: 'Absent in metadata-only mode or after redaction/budget removal.',
            zh: '仅元数据模式、脱敏丢弃或预算移除后省略。'
          }
        }
      }
    },
    IRpcDevtoolsServiceApi: {
      summary: {
        en: 'Remote-facing nested service contract installed from collector.service on a caller-owned separate Peer. Results cross a portable conversion boundary; by default content is omitted and actual serving endpoints are excluded.',
        zh: '由采集器服务对象安装到调用者独立连接的远端嵌套服务契约，结果经过可移植转换边界，默认省略内容并排除实际服务端点。'
      },
      scenarios: [
        {
          en: 'Expose diagnostics over an existing dedicated Runtime Peer using its provide option and namespace-aware client adapter.',
          zh: '经已有专用运行时连接的提供选项及命名空间客户端适配暴露诊断。'
        }
      ],
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}",
      members: {
        describe: {
          summary: {
            en: 'Reports the current monotonic clock sample, pause state, known endpoint descriptors, limits and loss counters.',
            zh: '报告当前单调时钟采样、暂停状态、已知端点描述、容量限制及丢失计数。'
          },
          returns: {
            en: 'IRpcDevtoolsDescribe snapshot; descriptors preserve their element references. Closed collectors throw CLOSED.',
            zh: '返回描述快照，端点描述元素保留原引用，已关闭采集器抛 `CLOSED`。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
        },
        query: {
          summary: {
            en: 'Synchronously scans retained events with compiled filters. This is a snapshot rather than a subscription; limits are one through one thousand.',
            zh: '用已编译筛选条件同步扫描保留事件，返回快照而非订阅，数量上限为一至一千。'
          },
          params: {
            input: {
              en: 'Optional IRpcDevtoolsQuery; default cursor zero, limit one thousand and no field filters. Take subsequent afterSeq from the prior page nextSeq.',
              zh: '可选查询，默认游标零、上限一千且无字段筛选，后续游标取自上一页的 `nextSeq`。'
            }
          },
          returns: {
            en: 'IRpcDevtoolsPage with events, nextSeq and loss counters. Invalid inputs use INVALID_OPTION and closed collectors use CLOSED.',
            zh: '返回含事件、下页游标及丢失计数的查询页，非法输入使用 `INVALID_OPTION`，关闭的采集器使用 `CLOSED`。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
        },
        watch: {
          summary: {
            en: 'Subscribes from first generator advancement to future filtered events. Batches contain at most 256 events and each watcher retains at most 64 queued batches; overflow is counted rather than blocking RPC.',
            zh: '从首次推进生成器开始订阅未来筛选事件，每批至多二百五十六条，每个观察者至多排队六十四批，溢出计数而不阻塞远程调用。'
          },
          params: {
            input: {
              en: 'Optional query filters excluding afterSeq and limit; defaults to no filters. Use query separately for retained history.',
              zh: '可选查询筛选，排除历史游标及上限字段，默认不筛选，历史数据另用查询接口读取。'
            }
          },
          returns: {
            en: 'AsyncGenerator<IRpcDevtoolsWatchBatch>; return wakes a pending local next and releases the watcher without needing Collector.close. Collector close instead wakes pending reads with CLOSED; remote stream cancellation ends its service watcher normally.',
            zh: '返回观察批次异步生成器，结束迭代会唤醒本地待定读取并释放观察者，无需关闭采集器；关闭采集器则使等待读取以 `CLOSED` 失败，远端流取消则正常结束其服务观察者。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
        },
        stats: {
          summary: {
            en: 'Snapshots endpoint/method settlement aggregates independently from query-ring eviction; clear resets them.',
            zh: '取得不受查询环淘汰影响的端点与方法结算聚合快照，清空操作会重置统计。'
          },
          returns: {
            en: 'IRpcDevtoolsStats with cumulative counts and histogram-derived quantiles; a closed collector throws CLOSED.',
            zh: '返回含累计计数及直方图分位数的统计，已关闭采集器抛 `CLOSED`。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
        },
        clear: {
          summary: {
            en: 'Clears main query retention, aggregate statistics and loss counters. Independent recording and watch windows keep their ownership.',
            zh: '清空主查询保留、聚合统计及丢失计数，独立录制和观察窗口保留其所属关系。'
          },
          returns: {
            en: 'Main retention and statistics are empty; the collector stays open. Closed collectors throw CLOSED.',
            zh: '主保留与统计已清空，采集器仍可接收事件，已关闭采集器抛 `CLOSED`。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
        },
        pause: {
          summary: {
            en: 'Snapshots current effective stage subscriptions and replaces them with an empty selection. Repeated pause is harmless; retained data remains queryable.',
            zh: '保存当前生效的阶段订阅并替换为空选择，重复暂停无额外影响，已保留数据仍可查询。'
          },
          returns: {
            en: 'Collection is paused without pausing business RPC; closed collectors throw CLOSED.',
            zh: '采集已暂停但业务远程调用继续，已关闭采集器抛 `CLOSED`。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
        },
        resume: {
          summary: {
            en: 'Restores the effective stage selection saved by the first pause. It does not revive a closed collector.',
            zh: '恢复首次暂停时保存的生效阶段选择，不会复活已关闭的采集器。'
          },
          returns: {
            en: 'Collection resumes with prior subscriptions; repeated resume is harmless and closed collectors throw CLOSED.',
            zh: '按原订阅恢复采集，重复恢复无额外影响，已关闭采集器抛 `CLOSED`。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
        },
        record: {
          summary: {
            en: 'Nested recording API: start(input?) takes optional positive maxEvents defaulting to collector capacity and returns nothing; stop() takes no arguments and returns encoded NDJSON. Pair start with stop; duplicate start uses RECORD_ACTIVE and absent recording uses RECORD_NOT_ACTIVE.',
            zh: '嵌套录制接口：`record.start(input?)` 接收可选正容量，默认采集器容量且无返回值，`record.stop()` 无参数并返回编码文本；重复启动使用活动录制错误，缺少录制使用未活动错误。'
          }
        },
        'record.start': {
          summary: {
            en: 'Starts the collector independent recording through the service boundary.',
            zh: '经服务边界启动采集器独立录制。'
          },
          params: {
            input: {
              en: 'Optional maxEvents capacity; defaults to the collector capacity.',
              zh: '可选事件容量，默认采集器容量。'
            }
          },
          returns: {
            en: 'No result; RECORD_ACTIVE if another recording owns the collector.',
            zh: '无返回值，已有录制拥有采集器时抛活动录制错误。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
        },
        'record.stop': {
          summary: {
            en: 'Stops the current recording and returns the encoded text through the service.',
            zh: '停止当前录制并经服务返回编码文本。'
          },
          returns: {
            en: 'NDJSON string, or RECORD_NOT_ACTIVE when no recording remains active.',
            zh: '返回逐行文本，没有活动录制时抛未活动录制错误。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
        }
      }
    },
    IRpcDevtoolsHub: {
      summary: {
        en: 'Caller-owned hub returned by createRpcDevtoolsHub, retaining per-target references and one live watch per client. It owns watch release and alignment timers, but never owns client connections.',
        zh: '聚合器工厂返回的调用者实例，保留每目标引用且每个实时客户端拥有一个观察流，负责流释放及对齐计时器，不拥有客户端连接。'
      },
      scenarios: [
        {
          en: 'Combine worker, browser and process observation clients or compare offline recordings without fabricating missing call sides.',
          zh: '合并工作线程、浏览器及进程观察客户端，或比较离线录制，不编造缺失调用侧。'
        }
      ],
      example:
        "import { createRpcDevtoolsHub } from '@migaia/rpc-plugin-devtools/hub'\nimport { RpcDevtoolsRecordFormat, encodeRpcDevtoolsRecord } from '@migaia/rpc-plugin-devtools/contract'\n\nconst text = encodeRpcDevtoolsRecord({ header: RpcDevtoolsRecordFormat, events: [\n  { seq: 1, at: 100, endpointId: 'worker', stage: 'message', direction: 'outbound', kind: 'request', senderId: 'worker', messageId: 'm1', trace: 'T1', method: 'read' }\n] })\nconst hub = createRpcDevtoolsHub()\nconst off = hub.on('status', (name, status) => console.log(name, status))\nhub.importRecord('recording', text)\nconsole.log(hub.status('recording'), hub.timeline({ trace: 'T1' }), hub.interactions('T1'))\nconsole.log(await hub.stats('recording'))\noff()\nawait hub.removeTarget('recording')\nawait hub.close()",
      members: {
        addTarget: {
          summary: {
            en: 'Registers a unique live target, aligns its clock, starts its one watch read before querying history, then consumes the buffered watch with sequence deduplication. The client must expose bare describe/query/watch/stats method names.',
            zh: '注册唯一实时目标，对齐时钟后先启动唯一观察流读取再查询历史，之后消费缓冲观察并按序号去重，客户端需暴露不含命名空间前缀的描述、查询、观察及统计方法。'
          },
          params: {
            name: {
              en: 'Nonempty application-chosen name, unique among current live and offline target registrations.',
              zh: '应用指定的非空名称，在当前实时及离线目标注册中唯一。'
            },
            client: {
              en: 'Already connected IRpcDevtoolsTargetClient supplied by the caller. Adapt a namespaced remote Peer so bare service names reach collector.service.',
              zh: '调用者提供的已连接目标客户端，需将带命名空间远端连接适配为裸服务名可到达采集器服务。'
            }
          },
          returns: {
            en: 'Promise<void> after setup, retaining the caller client connection. Duplicate names use TARGET_DUPLICATE; invalid input uses INVALID_OPTION; setup failure marks disconnected and rejects with the original error after acquired watch rollback; independent cleanup failure is reported separately without replacing the primary.',
            zh: '设置后兑现空承诺，保留调用者客户端连接，重名使用 `TARGET_DUPLICATE`，非法输入使用 `INVALID_OPTION`，设置失败标记断开，回滚已取得观察后以原错误拒绝，独立清理失败另行报告，不替换主错。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
        },
        removeTarget: {
          summary: {
            en: 'Detaches target events and correlation synchronously, then awaits its original iterator return; repeated removal of the same known name is harmless.',
            zh: '同步分离目标事件及关联，再等待其原始迭代器结束，重复移除同一已知名称无额外影响。'
          },
          params: {
            name: {
              en: 'Name chosen by the application in addTarget(name, client) or importRecord(name, text).',
              zh: '由应用在添加目标或导入记录时指定的名称，后续操作沿用该注册名称。'
            }
          },
          returns: {
            en: 'Promise<void> after watch release; original return failures are reported and reject. Never-registered names use TARGET_UNKNOWN.',
            zh: '观察流释放后兑现空承诺，原始结束失败会报告并拒绝，未注册名称使用 `TARGET_UNKNOWN`。'
          },
          example:
            "import { createRpcDevtoolsHub } from '@migaia/rpc-plugin-devtools/hub'\nimport { RpcDevtoolsRecordFormat, encodeRpcDevtoolsRecord } from '@migaia/rpc-plugin-devtools/contract'\n\nconst text = encodeRpcDevtoolsRecord({ header: RpcDevtoolsRecordFormat, events: [\n  { seq: 1, at: 100, endpointId: 'worker', stage: 'message', direction: 'outbound', kind: 'request', senderId: 'worker', messageId: 'm1', trace: 'T1', method: 'read' }\n] })\nconst hub = createRpcDevtoolsHub()\nconst off = hub.on('status', (name, status) => console.log(name, status))\nhub.importRecord('recording', text)\nconsole.log(hub.status('recording'), hub.timeline({ trace: 'T1' }), hub.interactions('T1'))\nconsole.log(await hub.stats('recording'))\noff()\nawait hub.removeTarget('recording')\nawait hub.close()"
        },
        importRecord: {
          summary: {
            en: 'Decodes and validates a complete record before publishing a read-only offline target; uses zero offset and no clock uncertainty sample.',
            zh: '发布只读离线目标前解码并校验完整记录，使用零偏移且不提供时钟不确定性采样。'
          },
          params: {
            name: {
              en: 'Nonempty unique name selected by the importing application for this offline target.',
              zh: '导入应用为当前离线目标选择的非空唯一名称。'
            },
            text: {
              en: 'Version-one NDJSON from encodeRpcDevtoolsRecord or collector exportRecord.',
              zh: '来自记录编码函数或采集器导出函数的第一版逐行文本。'
            }
          },
          returns: {
            en: 'No result; the offline target is registered. Invalid text uses RECORD_FORMAT_INVALID and duplicate names use TARGET_DUPLICATE.',
            zh: '无返回值，离线目标已注册，非法文本使用 `RECORD_FORMAT_INVALID`，重名使用 `TARGET_DUPLICATE`。'
          },
          example:
            "import { createRpcDevtoolsHub } from '@migaia/rpc-plugin-devtools/hub'\nimport { RpcDevtoolsRecordFormat, encodeRpcDevtoolsRecord } from '@migaia/rpc-plugin-devtools/contract'\n\nconst text = encodeRpcDevtoolsRecord({ header: RpcDevtoolsRecordFormat, events: [\n  { seq: 1, at: 100, endpointId: 'worker', stage: 'message', direction: 'outbound', kind: 'request', senderId: 'worker', messageId: 'm1', trace: 'T1', method: 'read' }\n] })\nconst hub = createRpcDevtoolsHub()\nconst off = hub.on('status', (name, status) => console.log(name, status))\nhub.importRecord('recording', text)\nconsole.log(hub.status('recording'), hub.timeline({ trace: 'T1' }), hub.interactions('T1'))\nconsole.log(await hub.stats('recording'))\noff()\nawait hub.removeTarget('recording')\nawait hub.close()"
        },
        status: {
          summary: {
            en: 'Reads one target status or snapshots all target statuses, including names remembered as removed.',
            zh: '读取单个目标状态或取得所有目标状态快照，包含记为已移除的名称。'
          },
          params: {
            name: {
              en: 'Optional name from addTarget or importRecord; omitted by default to request a readonly map of all names.',
              zh: '可选已添加或已导入名称，默认省略并请求所有名称的只读映射。'
            }
          },
          returns: {
            en: 'RpcDevtoolsTargetStatus or a new ReadonlyMap. Unknown individual names throw TARGET_UNKNOWN; closed hub throws CLOSED.',
            zh: '返回目标状态或新只读映射，未知单名抛 `TARGET_UNKNOWN`，关闭聚合器抛 `CLOSED`。'
          },
          example:
            "import { createRpcDevtoolsHub } from '@migaia/rpc-plugin-devtools/hub'\nimport { RpcDevtoolsRecordFormat, encodeRpcDevtoolsRecord } from '@migaia/rpc-plugin-devtools/contract'\n\nconst text = encodeRpcDevtoolsRecord({ header: RpcDevtoolsRecordFormat, events: [\n  { seq: 1, at: 100, endpointId: 'worker', stage: 'message', direction: 'outbound', kind: 'request', senderId: 'worker', messageId: 'm1', trace: 'T1', method: 'read' }\n] })\nconst hub = createRpcDevtoolsHub()\nconst off = hub.on('status', (name, status) => console.log(name, status))\nhub.importRecord('recording', text)\nconsole.log(hub.status('recording'), hub.timeline({ trace: 'T1' }), hub.interactions('T1'))\nconsole.log(await hub.stats('recording'))\noff()\nawait hub.removeTarget('recording')\nawait hub.close()"
        },
        timeline: {
          summary: {
            en: 'Sorts retained events globally by aligned timestamp, then target name and sequence. Ordered targets use a checked merge; legal nonmonotonic records use full sorting before limit. Returned elements are stored references and may be realigned later.',
            zh: '按对齐时间、目标名及序号全局排序；有序目标先检查后合并，合法非单调记录完整排序后再应用上限，返回元素为已存引用，随后重对齐可能修改包装值。'
          },
          params: {
            query: {
              en: 'Optional IRpcDevtoolsTimelineQuery; omitted means all retained targets and times without a result limit.',
              zh: '可选时间线筛选，默认全部保留目标及时间且不限制结果数量。'
            }
          },
          returns: {
            en: 'Readonly array of IRpcDevtoolsTimelineEvent. Zero limit returns empty; invalid limit uses INVALID_OPTION and closed hub uses CLOSED.',
            zh: '返回只读时间线事件数组，零上限返回空，非法上限使用 `INVALID_OPTION`，关闭使用 `CLOSED`。'
          },
          example:
            "import { createRpcDevtoolsHub } from '@migaia/rpc-plugin-devtools/hub'\nimport { RpcDevtoolsRecordFormat, encodeRpcDevtoolsRecord } from '@migaia/rpc-plugin-devtools/contract'\n\nconst text = encodeRpcDevtoolsRecord({ header: RpcDevtoolsRecordFormat, events: [\n  { seq: 1, at: 100, endpointId: 'worker', stage: 'message', direction: 'outbound', kind: 'request', senderId: 'worker', messageId: 'm1', trace: 'T1', method: 'read' }\n] })\nconst hub = createRpcDevtoolsHub()\nconst off = hub.on('status', (name, status) => console.log(name, status))\nhub.importRecord('recording', text)\nconsole.log(hub.status('recording'), hub.timeline({ trace: 'T1' }), hub.interactions('T1'))\nconsole.log(await hub.stats('recording'))\noff()\nawait hub.removeTarget('recording')\nawait hub.close()"
        },
        interactions: {
          summary: {
            en: 'Queries incrementally maintained interaction membership using observed sender/message identity and explicit traces. It does not infer missing caller or provider events.',
            zh: '按已观察发送者与消息身份及显式追踪查询增量交互成员，不推断缺失调用者或提供者事件。'
          },
          params: {
            trace: {
              en: 'Optional explicit trace read from events or application propagation; omitted by default to return all retained interactions.',
              zh: '可选来自事件或应用传播的显式追踪标识，默认省略并返回所有保留交互。'
            }
          },
          returns: {
            en: 'Readonly array of retained IRpcDevtoolsInteraction references; oneSided remains true until both logical sides are actually observed.',
            zh: '返回保留交互引用的只读数组，只有实际观察到两侧后才取消单侧标记。'
          },
          example:
            "import { createRpcDevtoolsHub } from '@migaia/rpc-plugin-devtools/hub'\nimport { RpcDevtoolsRecordFormat, encodeRpcDevtoolsRecord } from '@migaia/rpc-plugin-devtools/contract'\n\nconst text = encodeRpcDevtoolsRecord({ header: RpcDevtoolsRecordFormat, events: [\n  { seq: 1, at: 100, endpointId: 'worker', stage: 'message', direction: 'outbound', kind: 'request', senderId: 'worker', messageId: 'm1', trace: 'T1', method: 'read' }\n] })\nconst hub = createRpcDevtoolsHub()\nconst off = hub.on('status', (name, status) => console.log(name, status))\nhub.importRecord('recording', text)\nconsole.log(hub.status('recording'), hub.timeline({ trace: 'T1' }), hub.interactions('T1'))\nconsole.log(await hub.stats('recording'))\noff()\nawait hub.removeTarget('recording')\nawait hub.close()"
        },
        stats: {
          summary: {
            en: 'Forwards one live target statistics result or aggregates histogram buckets across live targets. Offline version-one records carry no statistics payload.',
            zh: '转发单个实时目标统计或跨实时目标聚合直方图桶，第一版离线记录不携带统计载荷。'
          },
          params: {
            name: {
              en: 'Optional registered target name; omission aggregates live target results, while a named offline target returns empty statistics.',
              zh: '可选已注册目标名，省略则聚合实时目标结果，指定离线目标返回空统计。'
            }
          },
          returns: {
            en: 'Promise<IRpcDevtoolsStats>; request failures are reported and reject without inventing counts.',
            zh: '返回统计承诺，请求失败会报告并拒绝，不编造计数。'
          },
          example:
            "import { createRpcDevtoolsHub } from '@migaia/rpc-plugin-devtools/hub'\nimport { RpcDevtoolsRecordFormat, encodeRpcDevtoolsRecord } from '@migaia/rpc-plugin-devtools/contract'\n\nconst text = encodeRpcDevtoolsRecord({ header: RpcDevtoolsRecordFormat, events: [\n  { seq: 1, at: 100, endpointId: 'worker', stage: 'message', direction: 'outbound', kind: 'request', senderId: 'worker', messageId: 'm1', trace: 'T1', method: 'read' }\n] })\nconst hub = createRpcDevtoolsHub()\nconst off = hub.on('status', (name, status) => console.log(name, status))\nhub.importRecord('recording', text)\nconsole.log(hub.status('recording'), hub.timeline({ trace: 'T1' }), hub.interactions('T1'))\nconsole.log(await hub.stats('recording'))\noff()\nawait hub.removeTarget('recording')\nawait hub.close()"
        },
        on: {
          summary: {
            en: 'Adds a synchronous status or event observer. Status callbacks receive registered name and status; event callbacks receive the retained timeline wrapper. Listener throws are reported while other listeners continue.',
            zh: '添加同步状态或事件观察者，状态回调接收注册名与状态，事件回调接收保留时间线包装，回调抛错被报告且继续其他观察者。'
          },
          params: {
            event: {
              en: 'Choose status for target lifecycle changes or event for accepted timeline items.',
              zh: '选择状态事件观察目标生命周期变化，或事件项观察已接纳时间线条目。'
            },
            listener: {
              en: 'Synchronous callback: (name, status) for status or (event) for event. Values come from hub registration and ingestion; no return is used, async callbacks are not awaited.',
              zh: '同步回调，状态形态接收名称与状态，事件形态接收时间线条目，值来自聚合注册及摄取，不使用返回值且不等待异步回调。'
            }
          },
          returns: {
            en: 'Idempotent unsubscribe function taking no arguments; close also releases all listener slots.',
            zh: '返回无参数幂等取消订阅函数，关闭也会释放全部观察者槽。'
          },
          values: {
            status: {
              en: 'Observe every target lifecycle transition, including connection, disconnection, offline import and removal.',
              zh: '观察每次目标生命周期变化，包含连接、断开、离线导入与移除。'
            },
            event: {
              en: 'Observe each accepted retained timeline wrapper, without a replay of historical events.',
              zh: '观察每个已接纳保留时间线包装，不重放历史事件。'
            }
          },
          example:
            "import { createRpcDevtoolsHub } from '@migaia/rpc-plugin-devtools/hub'\nimport { RpcDevtoolsRecordFormat, encodeRpcDevtoolsRecord } from '@migaia/rpc-plugin-devtools/contract'\n\nconst text = encodeRpcDevtoolsRecord({ header: RpcDevtoolsRecordFormat, events: [\n  { seq: 1, at: 100, endpointId: 'worker', stage: 'message', direction: 'outbound', kind: 'request', senderId: 'worker', messageId: 'm1', trace: 'T1', method: 'read' }\n] })\nconst hub = createRpcDevtoolsHub()\nconst off = hub.on('status', (name, status) => console.log(name, status))\nhub.importRecord('recording', text)\nconsole.log(hub.status('recording'), hub.timeline({ trace: 'T1' }), hub.interactions('T1'))\nconsole.log(await hub.stats('recording'))\noff()\nawait hub.removeTarget('recording')\nawait hub.close()"
        },
        close: {
          summary: {
            en: 'Synchronously rejects new operations and detaches target state, then releases all watches concurrently. Each target release failure is reported in registration order as a native AggregateError with TARGET_RELEASE_FAILED, first cause and all original errors. Application client failures otherwise retain their original identity.',
            zh: '同步拒绝新操作并分离目标状态，然后并发释放全部观察流，目标释放失败按注册顺序以原生汇总错误及 `TARGET_RELEASE_FAILED` 报告，原因保留首错、错误列表保留全错；应用客户端失败仍保持原身份。'
          },
          returns: {
            en: 'Same Promise<void> on repeated calls, resolved after releases and listener cleanup. Release errors are reported instead of rejecting this close promise; client connections stay caller-owned.',
            zh: '重复调用返回同一空承诺，流释放及观察者清理后兑现，释放错误通过报告处理而不拒绝关闭承诺，客户端连接仍归调用者。'
          },
          example:
            "import { createRpcDevtoolsHub } from '@migaia/rpc-plugin-devtools/hub'\nimport { RpcDevtoolsRecordFormat, encodeRpcDevtoolsRecord } from '@migaia/rpc-plugin-devtools/contract'\n\nconst text = encodeRpcDevtoolsRecord({ header: RpcDevtoolsRecordFormat, events: [\n  { seq: 1, at: 100, endpointId: 'worker', stage: 'message', direction: 'outbound', kind: 'request', senderId: 'worker', messageId: 'm1', trace: 'T1', method: 'read' }\n] })\nconst hub = createRpcDevtoolsHub()\nconst off = hub.on('status', (name, status) => console.log(name, status))\nhub.importRecord('recording', text)\nconsole.log(hub.status('recording'), hub.timeline({ trace: 'T1' }), hub.interactions('T1'))\nconsole.log(await hub.stats('recording'))\noff()\nawait hub.removeTarget('recording')\nawait hub.close()"
        }
      }
    },
    IRpcDevtoolsHubOptions: {
      optionCases: [
        {
          title: {
            en: 'Bound each imported recording',
            zh: '为每个导入录制设置保留上限'
          },
          problem: {
            en: 'A support agent opens a long invoice-worker recording in a compact panel. Keeping the default 50000 rows per target is unnecessary for this view. Lower the retention capacity before importing so the panel focuses on recent activity.',
            zh: '支持人员在小面板打开很长的发票工作线程录制。这个视图不需要默认的每目标 50000 行；导入前降低保留容量，面板便聚焦近期活动。'
          },
          example:
            "import { createRpcDevtoolsHub } from '@migaia/rpc-plugin-devtools/hub'\n\nconst hub = createRpcDevtoolsHub({ maxEvents: 200 })\nhub.importRecord('invoice-worker', await readRecording(file))\nrenderTimeline(hub.timeline())\nonPanelClosed(() => hub.close())",
          result: {
            en: 'The timeline shows at most the newest 200 events from the uploaded recording, keeping the support view manageable.',
            zh: '时间线最多显示上传录制中的最新 200 条事件，支持面板保持易于查看。'
          },
          covers: ['maxEvents']
        },
        {
          title: {
            en: 'Realign a live target and report panel failures',
            zh: '重新对齐实时目标，并报告面板失败'
          },
          problem: {
            en: 'An invoice support panel stays open while staff compare activity from several workers. Clock estimates can become stale during that investigation. Refresh alignment periodically and send panel callback failures to monitoring so a broken status widget does not stop target setup.',
            zh: '支持人员常把发票诊断面板开着，对照多个工作线程的活动。排查期间，最初的时钟估计可能过时。定期重新对齐，并把面板回调失败送入监控，单个状态控件损坏便不会阻止目标准备完成。'
          },
          example:
            "import { createRpcDevtoolsHub } from '@migaia/rpc-plugin-devtools/hub'\n\nconst hub = createRpcDevtoolsHub({\n  realignMs: 10_000,\n  onError: (error) => reportToMonitoring(error)\n})\nhub.on('status', (name, status) => updateTargetStatus(name, status))\nawait hub.addTarget('invoice-worker', diagnosticPeer)\nrenderTimeline(hub.timeline())\nonPanelClosed(() => hub.close())",
          result: {
            en: 'The live target appears in the panel and its clock estimate refreshes every 10 seconds. Diagnostic failures reach monitoring without replacing invoice results.',
            zh: '实时目标出现在面板中，时钟估计每 10 秒更新；诊断失败进入监控，不会替换发票结果。'
          },
          covers: ['realignMs', 'onError']
        }
      ],
      summary: {
        en: 'Construction-time per-target capacity, optional periodic clock realignment and failure reporting; no transport or client is created from these settings.',
        zh: '构造期每目标容量、可选周期时钟重对齐及失败报告设置，不据此创建传输或客户端。'
      },
      example:
        "import { createRpcDevtoolsHub } from '@migaia/rpc-plugin-devtools/hub'\nimport { RpcDevtoolsRecordFormat, encodeRpcDevtoolsRecord } from '@migaia/rpc-plugin-devtools/contract'\n\nconst text = encodeRpcDevtoolsRecord({ header: RpcDevtoolsRecordFormat, events: [\n  { seq: 1, at: 100, endpointId: 'worker', stage: 'message', direction: 'outbound', kind: 'request', senderId: 'worker', messageId: 'm1', trace: 'T1', method: 'read' }\n] })\nconst hub = createRpcDevtoolsHub()\nconst off = hub.on('status', (name, status) => console.log(name, status))\nhub.importRecord('recording', text)\nconsole.log(hub.status('recording'), hub.timeline({ trace: 'T1' }), hub.interactions('T1'))\nconsole.log(await hub.stats('recording'))\noff()\nawait hub.removeTarget('recording')\nawait hub.close()",
      members: {
        maxEvents: {
          summary: {
            en: 'Positive safe per-target retention capacity, at most 4294967295 events.',
            zh: '每目标保留容量的正安全整数，最多 `4294967295` 个事件。'
          },
          default: {
            en: '50000 events independently for each target.',
            zh: '默认每个目标独立保留 `50000` 个事件。'
          }
        },
        realignMs: {
          summary: {
            en: 'Finite positive period in milliseconds for five-sample live target realignment; at most one realignment runs per target.',
            zh: '实时目标五次采样重对齐的有限正毫秒周期，每目标至多运行一个重对齐任务。'
          },
          default: {
            en: '`undefined`; only initial live registration performs alignment.',
            zh: '默认 `undefined`，仅实时目标初始注册时执行对齐。'
          }
        },
        onError: {
          whenToUse: {
            en: 'Set this callback when a diagnostic failure should reach the application monitor. It receives collector, formatter, logger or hub observer failures without replacing a business result. Omission keeps the documented host reporter for the owning component.',
            zh: '诊断失败需要进入应用监控时，设置这个回调。它接收采集器、格式化器、日志或聚合器观察回调的失败，不替换业务结果。省略时使用所属组件文档中说明的宿主报告函数。'
          },
          summary: {
            en: 'Synchronous observer receiving an original diagnostic error. Return nothing; observer failures are reported through the host failure channel without changing the RPC operation.',
            zh: '接收原始诊断错误的同步观察回调，无需返回值；观察回调失败经宿主失败通道报告，不改变远程调用操作结果。'
          },
          params: {
            error: {
              en: 'Original collector, logger, formatter or observation failure supplied by the owning component.',
              zh: '由所属组件提供的采集器、日志、格式化或观察原始失败。'
            }
          },
          returns: {
            en: 'No result is used and no asynchronous work is awaited by this callback boundary.',
            zh: '不使用返回值，此回调边界不等待异步工作。'
          },
          default: {
            en: 'Reports failures with host console.error; a supplied callback that throws is reported with the original error in an aggregate.',
            zh: '默认由宿主错误控制台报告，提供的回调抛错时与原始错误一起聚合报告。'
          },
          example:
            "import { createRpcDevtoolsHub } from '@migaia/rpc-plugin-devtools/hub'\n\nconst hub = createRpcDevtoolsHub({\n  realignMs: 10_000,\n  onError: (error) => reportToMonitoring(error)\n})\nhub.on('status', (name, status) => updateTargetStatus(name, status))\nawait hub.addTarget('invoice-worker', diagnosticPeer)\nrenderTimeline(hub.timeline())\nonPanelClosed(() => hub.close())"
        }
      }
    },
    IRpcDevtoolsTargetClient: {
      summary: {
        en: 'Caller-owned already connected service client adapter. Bare method names match IRpcDevtoolsServiceApi; adapt a namespaced Runtime Peer without moving connection ownership into the hub.',
        zh: '调用者拥有的已连接服务客户端适配器，裸方法名匹配诊断服务契约，适配带命名空间运行时连接时不把连接所有权转交聚合器。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}",
      members: {
        request: {
          summary: {
            en: 'Callback invoked by the hub for describe, query and stats service methods; forwarding rejects propagate to the corresponding hub operation.',
            zh: '聚合器为描述、查询及统计服务调用的方法，转发拒绝传播给对应聚合操作。'
          },
          params: {
            method: {
              en: 'Bare service method name supplied by the hub, such as describe, query or stats.',
              zh: '由聚合器提供的裸服务方法名，例如描述、查询或统计。'
            },
            payload: {
              en: 'Optional service input supplied by hub catch-up, including afterSeq and limit for queries; default is absent.',
              zh: '聚合历史追赶提供的可选服务输入，查询含游标及上限，默认省略。'
            }
          },
          returns: {
            en: 'Promise of the remote service result; the client owns timeout and transport behavior.',
            zh: '返回远端服务结果的承诺，超时及传输行为归客户端拥有。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
        },
        stream: {
          summary: {
            en: 'Callback invoked by the hub to acquire the watch service stream; the hub owns only its returned iterator lifetime.',
            zh: '聚合器用来取得观察服务流的方法，聚合器仅拥有返回迭代器的生命周期。'
          },
          params: {
            method: {
              en: 'Bare watch method name supplied by hub live registration.',
              zh: '由聚合实时注册提供的裸观察服务方法名。'
            },
            payload: {
              en: 'Optional watch filter from the hub; current live registration omits it by default.',
              zh: '聚合器提供的可选观察筛选，当前实时注册默认省略。'
            }
          },
          returns: {
            en: 'AsyncIterable of remote watch batches; iterator failure is reported and marks the target disconnected.',
            zh: '返回远端观察批次异步迭代源，迭代失败会报告并标记目标断开。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
        }
      }
    },
    IRpcDevtoolsTimelineQuery: {
      summary: {
        en: 'Filters retained aligned events; time bounds are inclusive and absent limits permit the entire retained result.',
        zh: '筛选保留对齐事件，时间上下界均包含边界，省略上限时允许全部保留结果。'
      },
      example:
        "import { createRpcDevtoolsHub } from '@migaia/rpc-plugin-devtools/hub'\nimport { RpcDevtoolsRecordFormat, encodeRpcDevtoolsRecord } from '@migaia/rpc-plugin-devtools/contract'\n\nconst text = encodeRpcDevtoolsRecord({ header: RpcDevtoolsRecordFormat, events: [\n  { seq: 1, at: 100, endpointId: 'worker', stage: 'message', direction: 'outbound', kind: 'request', senderId: 'worker', messageId: 'm1', trace: 'T1', method: 'read' }\n] })\nconst hub = createRpcDevtoolsHub()\nconst off = hub.on('status', (name, status) => console.log(name, status))\nhub.importRecord('recording', text)\nconsole.log(hub.status('recording'), hub.timeline({ trace: 'T1' }), hub.interactions('T1'))\nconsole.log(await hub.stats('recording'))\noff()\nawait hub.removeTarget('recording')\nawait hub.close()",
      members: {
        targets: {
          summary: {
            en: 'Registered names chosen by addTarget or importRecord.',
            zh: '添加目标或导入记录时选择的注册名称。'
          },
          default: {
            en: 'All current targets are eligible.',
            zh: '默认可选择所有当前目标。'
          }
        },
        stages: {
          summary: {
            en: 'Canonical Core stage names copied from observed wire events.',
            zh: '从观察线事件复制的核心规范阶段名称。'
          },
          default: {
            en: 'All retained stages are eligible.',
            zh: '默认可选择全部保留阶段。'
          }
        },
        trace: {
          summary: {
            en: 'Explicit trace from application propagation or an observed event.',
            zh: '来自应用传播或观察事件的显式追踪标识。'
          },
          default: {
            en: 'No trace filter is applied.',
            zh: '默认不施加追踪筛选。'
          }
        },
        method: {
          summary: {
            en: 'Exact method path from observed events or the application method catalog.',
            zh: '观察事件或应用方法目录中的精确方法路径。'
          },
          default: {
            en: 'No method filter is applied.',
            zh: '默认不施加方法筛选。'
          }
        },
        from: {
          summary: {
            en: 'Inclusive lower aligned timestamp read from timeline event alignedAt.',
            zh: '从时间线对齐时间字段取得的包含式下界。'
          },
          default: {
            en: 'No lower time bound is imposed.',
            zh: '默认不施加时间下界。'
          }
        },
        to: {
          summary: {
            en: 'Inclusive upper aligned timestamp in the same clock domain as alignedAt.',
            zh: '与对齐时间处于相同时钟域的包含式上界。'
          },
          default: {
            en: 'No upper time bound is imposed.',
            zh: '默认不施加时间上界。'
          }
        },
        limit: {
          summary: {
            en: 'Nonnegative safe integer result limit; zero intentionally returns no events.',
            zh: '非负安全整数结果上限，零明确返回空事件。'
          },
          default: {
            en: 'Unlimited within retained target data.',
            zh: '默认在目标保留数据内不限制结果数量。'
          }
        }
      }
    },
    IRpcDevtoolsTimelineEvent: {
      summary: {
        en: 'Hub-owned wrapper around an unchanged wire event; live realignment can mutate the wrapper alignedAt and uncertainty while preserving original event identity.',
        zh: '聚合器拥有、包裹不变线事件的包装，实时重对齐可修改对齐时间及不确定性，同时保留原始事件身份。'
      },
      example:
        "import { createRpcDevtoolsHub } from '@migaia/rpc-plugin-devtools/hub'\nimport { RpcDevtoolsRecordFormat, encodeRpcDevtoolsRecord } from '@migaia/rpc-plugin-devtools/contract'\n\nconst text = encodeRpcDevtoolsRecord({ header: RpcDevtoolsRecordFormat, events: [\n  { seq: 1, at: 100, endpointId: 'worker', stage: 'message', direction: 'outbound', kind: 'request', senderId: 'worker', messageId: 'm1', trace: 'T1', method: 'read' }\n] })\nconst hub = createRpcDevtoolsHub()\nconst off = hub.on('status', (name, status) => console.log(name, status))\nhub.importRecord('recording', text)\nconsole.log(hub.status('recording'), hub.timeline({ trace: 'T1' }), hub.interactions('T1'))\nconsole.log(await hub.stats('recording'))\noff()\nawait hub.removeTarget('recording')\nawait hub.close()",
      members: {
        target: {
          summary: {
            en: 'Application name registered through addTarget or importRecord.',
            zh: '应用经添加目标或导入记录注册的名称。'
          }
        },
        alignedAt: {
          summary: {
            en: 'Original event timestamp minus target offset; offline records use offset zero.',
            zh: '原事件时间戳减目标偏移，离线记录使用零偏移。'
          }
        },
        uncertaintyMs: {
          summary: {
            en: 'Half the minimum round-trip duration among five alignment samples; undefined for offline records without clock metadata.',
            zh: '五次对齐采样最小往返时长的一半，不含时钟元数据的离线记录使用未定义。'
          }
        },
        interaction: {
          summary: {
            en: 'Hub-issued correlation key derived from observed sender/message identity or a resolved carrier link.',
            zh: '聚合器依据已观察发送者与消息身份或已解析载体链接签发的关联键。'
          },
          default: {
            en: 'Absent when no explicit logical identity can be associated.',
            zh: '无法关联显式逻辑身份时省略。'
          }
        },
        trace: {
          summary: {
            en: 'Explicit trace copied from the original event or its observed logical correlation.',
            zh: '从原始事件或已观察逻辑关联复制的显式追踪标识。'
          },
          default: {
            en: 'Absent when the observation carries no trace.',
            zh: '观察未携带追踪标识时省略。'
          }
        },
        event: {
          summary: {
            en: 'Original IRpcDevtoolsWireEvent reference retained without changing its source timestamp.',
            zh: '保留且不修改来源时间戳的原始线事件引用。'
          }
        }
      }
    },
    IRpcDevtoolsInteraction: {
      summary: {
        en: 'Retained observed logical hop with explicit identity and actual side witnesses; no missing sender, receiver or event is synthesized.',
        zh: '具有显式身份及实际侧别证据的保留逻辑交互，不合成缺失发送者、接收者或事件。'
      },
      example:
        "import { createRpcDevtoolsHub } from '@migaia/rpc-plugin-devtools/hub'\nimport { RpcDevtoolsRecordFormat, encodeRpcDevtoolsRecord } from '@migaia/rpc-plugin-devtools/contract'\n\nconst text = encodeRpcDevtoolsRecord({ header: RpcDevtoolsRecordFormat, events: [\n  { seq: 1, at: 100, endpointId: 'worker', stage: 'message', direction: 'outbound', kind: 'request', senderId: 'worker', messageId: 'm1', trace: 'T1', method: 'read' }\n] })\nconst hub = createRpcDevtoolsHub()\nconst off = hub.on('status', (name, status) => console.log(name, status))\nhub.importRecord('recording', text)\nconsole.log(hub.status('recording'), hub.timeline({ trace: 'T1' }), hub.interactions('T1'))\nconsole.log(await hub.stats('recording'))\noff()\nawait hub.removeTarget('recording')\nawait hub.close()",
      members: {
        key: {
          summary: {
            en: 'Stable hub-issued interaction key derived from explicit source sender/message identity.',
            zh: '聚合器从显式来源发送者及消息身份生成的稳定交互键。'
          }
        },
        trace: {
          summary: {
            en: 'Observed explicit trace associated with this interaction, not an invented end-to-end identity.',
            zh: '当前交互关联的已观察显式追踪标识，不是编造的端到端身份。'
          },
          default: {
            en: 'Absent when no retained member carries a trace.',
            zh: '保留成员均未携带追踪标识时省略。'
          }
        },
        method: {
          summary: {
            en: 'Observed method path from an interaction member.',
            zh: '取自当前交互某个成员的已观察方法路径。'
          },
          default: {
            en: 'Absent when no member exposes a method.',
            zh: '没有成员暴露方法时省略。'
          }
        },
        oneSided: {
          summary: {
            en: 'True until retained request/reply kind and direction evidence shows both caller and provider sides.',
            zh: '在保留的请求回复种类与方向证据证明调用者及提供者两侧之前为真。'
          }
        },
        targets: {
          summary: {
            en: 'Registered application target names with retained membership in this interaction.',
            zh: '在当前交互中仍有保留成员的应用注册目标名称。'
          }
        },
        events: {
          summary: {
            en: 'Retained IRpcDevtoolsTimelineEvent references; eviction and target removal update membership.',
            zh: '保留的时间线事件引用，淘汰与目标移除会更新成员。'
          }
        }
      }
    },
    IRpcLogProbeOptions: {
      optionCases: [
        {
          title: {
            en: 'Log slow invoice previews with an application label',
            zh: '用应用名称记录缓慢的发票预览'
          },
          problem: {
            en: 'Operations staff need readable entries for invoice previews taking at least 250 ms. Default logging does not include successful slow calls. Set the threshold and route that category to info, while filtering out unrelated methods and connection lifecycle noise.',
            zh: '运维人员需要查看耗时至少 250 毫秒的发票预览日志。默认日志不包含成功的慢调用；设置阈值并将该分类交给 info，同时筛掉无关方法和连接生命周期噪声。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}",
          result: {
            en: 'The preview renders normally. Successful previews crossing the threshold produce an info entry labeled Invoice RPC: invoice.preview.',
            zh: '预览正常显示；超过阈值的成功预览产生 info 日志，文本为 Invoice RPC: invoice.preview。'
          },
          covers: ['slowMs', 'methods', 'sample']
        },
        {
          title: {
            en: 'Attach a safe capture marker to logs',
            zh: '为日志附加安全的捕获标记'
          },
          problem: {
            en: 'A shared log destination needs to group slow invoice previews by application area. Logical message events contain no business payload. Capture only that stage and replace its content with a safe area marker, so log consumers can group entries without collecting invoice data.',
            zh: '共享日志接收端需要按应用区域归类缓慢的发票预览。逻辑消息事件不含业务载荷；只捕获该阶段并将内容替换为安全的区域标记，日志使用方即可归类条目，无需收集发票数据。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}",
          result: {
            en: 'Slow preview entries carry the invoice-preview area marker, while the page receives its original invoice result.',
            zh: '慢预览日志带有 invoice-preview 区域标记，页面仍收到原始发票结果。'
          },
          covers: ['content', 'capture']
        },
        {
          title: {
            en: 'Report a failed log destination',
            zh: '报告日志接收端失败'
          },
          problem: {
            en: 'The application logger forwards invoice diagnostics to an external destination that can be unavailable. Route delivery failures to monitoring so operations can repair that destination while users continue viewing their invoices. Without this callback, the failure uses the host reporting channel.',
            zh: '应用日志器把发票诊断交给可能不可用的外部接收端。将发送失败交给监控，运维便能修复接收端，用户仍可查看发票；省略回调时，失败进入宿主报告通道。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}",
          result: {
            en: 'The invoice preview still appears if the log destination fails; monitoring receives the original diagnostic failure.',
            zh: '日志接收端失败时，发票预览仍正常显示，监控收到原始诊断失败。'
          },
          covers: ['onError']
        }
      ],
      summary: {
        en: 'Construction-time qualification, capture and logger dispatch policy; only message and peer stages are supported by this first-party log probe.',
        zh: '构造期条件选择、捕获及日志分派策略，此内置日志探针仅支持消息与连接阶段。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}",
      members: {
        methods: {
          summary: {
            en: 'Exact method path filter supplied by the application; methodless control events remain observable.',
            zh: '应用提供的精确方法路径筛选列表，不含方法名的控制事件仍可观察。'
          },
          default: {
            en: 'No method filter; all method-bearing events are eligible.',
            zh: '默认不筛选方法，所有带方法名事件均可进入后续选择。'
          }
        },
        sample: {
          summary: {
            en: 'Deterministic sampling fraction in the interval greater than zero through one, using sender/message identity rather than random per-stage decisions.',
            zh: '大于零且小于或等于一的确定性采样比例，按发送者与消息身份采样，而非逐阶段随机决定。'
          },
          default: {
            en: '`1`, retaining all eligible identities before retention limits.',
            zh: '默认 `1`，在保留上限生效前接纳所有符合条件的身份。'
          }
        },
        capture: {
          summary: {
            en: 'Explicit stages whose content may be read. Select names from RpcProbeStageName in @migaia/rpc-host/probe and keep capture within initially subscribed stages.',
            zh: '显式允许读取内容的阶段，名称来自 `@migaia/rpc-host/probe` 的阶段名表，必须为初始订阅阶段的子集。'
          },
          default: {
            en: 'No content capture; observation remains metadata-only.',
            zh: '默认不捕获内容，仅观察元数据。'
          }
        },
        redact: {
          whenToUse: {
            en: 'Set it when explicitly captured content contains data that should not be retained or logged. Return a replacement, or `undefined` to discard content. Omitting it retains the captured reference unchanged; a thrown error is reported and that content is dropped.',
            zh: '显式捕获的内容包含不应保存或记录的数据时，设置此回调。返回替换值，或返回 `undefined` 丢弃内容。省略时原样保留捕获引用；抛错会被报告，并丢弃本次内容。'
          },
          summary: {
            en: 'Synchronous callback receiving numeric RpcProbeStage and captured content. Return the retained replacement; never retain the reusable event view. Collector executes it during ingestion, log executes it at the canonical emitter.',
            zh: '接收数字阶段与已捕获内容的同步回调，返回需要保留的替代值；不可保留复用事件视图，采集器在摄取时执行，日志探针在规范发射器执行。'
          },
          params: {
            stage: {
              en: 'Numeric stage from RpcProbeStage supplied by the observing emitter.',
              zh: '由观察发射器提供、取自阶段常量表的数字阶段。'
            },
            content: {
              en: 'Captured caller-owned content reference from an explicitly enabled stage.',
              zh: '来自显式启用阶段的调用者内容引用。'
            }
          },
          returns: {
            en: 'Replacement content, including undefined to discard it. Synchronous throws discard content and are reported; asynchronous redaction is not awaited.',
            zh: '返回替代内容，可返回未定义丢弃；同步抛错丢弃内容并报告，不等待异步脱敏。'
          },
          default: {
            en: 'No redactor; explicitly captured content retains its original reference.',
            zh: '默认无脱敏回调，显式捕获内容保留其原始引用。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
        },
        onError: {
          whenToUse: {
            en: 'Set this callback when a diagnostic failure should reach the application monitor. It receives collector, formatter, logger or hub observer failures without replacing a business result. Omission keeps the documented host reporter for the owning component.',
            zh: '诊断失败需要进入应用监控时，设置这个回调。它接收采集器、格式化器、日志或聚合器观察回调的失败，不替换业务结果。省略时使用所属组件文档中说明的宿主报告函数。'
          },
          summary: {
            en: 'Synchronous observer receiving an original diagnostic error. Return nothing; observer failures are reported through the host failure channel without changing the RPC operation.',
            zh: '接收原始诊断错误的同步观察回调，无需返回值；观察回调失败经宿主失败通道报告，不改变远程调用操作结果。'
          },
          params: {
            error: {
              en: 'Original collector, logger, formatter or observation failure supplied by the owning component.',
              zh: '由所属组件提供的采集器、日志、格式化或观察原始失败。'
            }
          },
          returns: {
            en: 'No result is used and no asynchronous work is awaited by this callback boundary.',
            zh: '不使用返回值，此回调边界不等待异步工作。'
          },
          default: {
            en: 'Uses the Core hostRethrowReporter failure channel; hub reporting instead defaults to console.error.',
            zh: '默认使用核心包的宿主重新抛出报告通道，聚合器报告则默认使用宿主错误控制台。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
        },
        slowMs: {
          summary: {
            en: 'Finite nonnegative settlement duration threshold for successful slow-call logging.',
            zh: '为成功慢调用记录日志的有限非负毫秒结算阈值。'
          },
          default: {
            en: '`undefined`; successful calls do not qualify as slow.',
            zh: '默认 `undefined`，成功调用不会按慢调用条件进入日志。'
          }
        },
        stages: {
          whenToUse: {
            en: 'Select `message` for failed, rejected or slow calls, and `peer` for connection lifecycle. Omission selects both. This log helper accepts no physical stages; selecting stages alone does not enable content capture.',
            zh: '用 `message` 记录失败、拒绝或慢调用，用 `peer` 记录连接生命周期。省略时选择两者。此日志辅助函数不接收物理阶段；选中阶段本身不会开启内容捕获。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}",
          summary: {
            en: 'Subscribed log stages; only message settlements and peer lifecycle belong to this helper.',
            zh: '订阅日志阶段，此辅助函数仅处理消息结算及连接生命周期。'
          },
          default: {
            en: 'message and peer stages.',
            zh: '默认消息与连接阶段。'
          },
          values: {
            message: {
              en: 'Observe message settlement failures, rejections and configured slow calls.',
              zh: '观察消息结算失败、拒绝及已配置的慢调用。'
            },
            peer: {
              en: 'Observe peer lifecycle events using the lifecycle log category.',
              zh: '使用生命周期日志分类观察连接生命周期事件。'
            }
          }
        },
        content: {
          summary: {
            en: 'Enables capture for subscribed stages when capture is omitted; explicit capture also permits captured fields to reach the logger.',
            zh: '未指定捕获列表时为订阅阶段开启捕获，显式捕获列表同样允许捕获字段进入日志。'
          },
          default: {
            en: 'false, with capture disabled unless explicitly requested.',
            zh: '默认 `false`，除非显式要求，否则不捕获内容。'
          }
        },
        levels: {
          whenToUse: {
            en: 'Override individual categories when their default severity does not fit the application. `debug`, `info`, `warn` and `error` choose the corresponding logger method; `off` skips that category. Omitted categories retain their documented defaults.',
            zh: '默认严重程度不适合应用时，逐分类覆盖。`debug`、`info`、`warn` 与 `error` 分别选择对应日志方法，`off` 跳过该分类。省略的分类保留文档列出的默认级别。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}",
          summary: {
            en: 'Category overrides: failed, rejected, timeout, aborted, slow and lifecycle map to a named sink level or off.',
            zh: '分类覆盖：失败、拒绝、超时、取消、慢调用及生命周期各自映射到命名接收级别或关闭。'
          },
          default: {
            en: 'failed uses error, lifecycle uses info, and rejected/timeout/aborted/slow use warn.',
            zh: '默认失败用错误级，生命周期用信息级，拒绝、超时、取消及慢调用用警告级。'
          },
          values: {
            debug: {
              en: 'Invoke logger.debug once for a qualifying event of the selected category.',
              zh: '为所选分类的合格事件调用一次调试日志方法。'
            },
            info: {
              en: 'Invoke logger.info once; default for peer lifecycle observations.',
              zh: '调用一次信息日志方法，连接生命周期默认使用此级别。'
            },
            warn: {
              en: 'Invoke logger.warn once; default for rejection, timeout, abort and slow events.',
              zh: '调用一次警告日志方法，拒绝、超时、取消及慢调用默认使用此级别。'
            },
            error: {
              en: 'Invoke logger.error once; default for ordinary call failures.',
              zh: '调用一次错误日志方法，普通调用失败默认使用此级别。'
            },
            off: {
              en: 'Skip message construction and logger invocation for this category.',
              zh: '跳过当前分类的消息构造及日志接收端调用。'
            }
          }
        },
        message: {
          whenToUse: {
            en: 'Set a formatter when the logger needs application-specific text. Return a string synchronously and read the view only during the callback. Omitting it uses the built-in category message; a thrown error is reported through `onError`.',
            zh: '日志需要应用专用文本时，设置格式化函数。同步返回字符串，仅在回调期间读取事件视图。省略时使用内置分类消息，抛错通过 `onError` 报告。'
          },
          summary: {
            en: 'Synchronous formatter called only for qualifying enabled events. Receives a reusable Core event view valid during the callback; return a string and never retain the view. Throws are reported through onError.',
            zh: '仅对合格且启用的事件执行同步格式化，接收仅回调期间有效的复用核心事件视图，返回字符串且不可保存视图，抛错经错误观察回调报告。'
          },
          params: {
            view: {
              en: 'Emitter-owned IRpcProbeEventView supplied for one synchronous formatting call.',
              zh: '发射器拥有、供单次同步格式化调用使用的复用视图。'
            }
          },
          returns: {
            en: 'String passed as logger message; async formatters are unsupported.',
            zh: '作为日志消息传给接收端的字符串，不支持异步格式化。'
          },
          default: {
            en: 'Stable built-in message for the classified failure, rejection, timeout, abort, slow or lifecycle category.',
            zh: '默认使用失败、拒绝、超时、取消、慢调用或生命周期分类的稳定内置消息。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
        }
      }
    },
    IRpcLogSink: {
      summary: {
        en: "The application logger supplied to the log probe, with required debug, info, warn and error methods. The probe forwards matching RPC events to these methods. Each method runs with the original logger as its receiver, so it can use that logger's instance state. Each method should accept or queue its record promptly; the logger owns buffering and writing to its destination. The probe does not wait for a returned Promise to finish, but observes its rejection. A thrown error or rejection is passed to onError.",
        zh: '应用提供给日志探针的日志对象，必须包含 debug、info、warn 和 error 四个方法。探针把符合条件的 RPC 事件转交这些方法。调用时仍以原日志对象作为方法的接收者，因此方法可以使用该日志对象的实例状态。方法应尽快接收记录或将其入队，缓冲和实际写入由日志对象负责。探针不会等待返回的 Promise 完成，但会接收它的失败；同步抛错或 Promise 失败均交给 onError。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}",
      members: {
        debug: {
          summary: {
            en: 'Receives an RPC event that passes the log filter and is assigned to the debug level.',
            zh: '接收通过日志筛选、被分配到 `debug` 级别的 RPC 事件。'
          },
          params: {
            message: {
              en: 'String from the built-in category text or synchronous message formatter.',
              zh: '来自内置分类文本或同步格式化回调的字符串。'
            },
            fields: {
              en: 'Probe-created fields containing method/message/sender/target/trace, duration, outcome, kind, rejection, lifecycle, peer and original error; optional captured content retains its reference.',
              zh: '探针创建的字段，包含方法、消息、发送者、目标、追踪、耗时、结果、种类、拒绝、生命周期、连接及原始错误，可选捕获内容保留引用。'
            }
          },
          returns: {
            en: 'Any caller result; thenable rejections are observed, other values are ignored and no sink is awaited.',
            zh: '可返回任意值，承诺拒绝会被观察，其他值忽略，不等待接收端。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
        },
        info: {
          summary: {
            en: 'Receives an RPC event that passes the log filter and is assigned to the info level.',
            zh: '接收通过日志筛选、被分配到 `info` 级别的 RPC 事件。'
          },
          params: {
            message: {
              en: 'String from the built-in category text or synchronous message formatter.',
              zh: '来自内置分类文本或同步格式化回调的字符串。'
            },
            fields: {
              en: 'Probe-created fields containing method/message/sender/target/trace, duration, outcome, kind, rejection, lifecycle, peer and original error; optional captured content retains its reference.',
              zh: '探针创建的字段，包含方法、消息、发送者、目标、追踪、耗时、结果、种类、拒绝、生命周期、连接及原始错误，可选捕获内容保留引用。'
            }
          },
          returns: {
            en: 'Any caller result; thenable rejections are observed, other values are ignored and no sink is awaited.',
            zh: '可返回任意值，承诺拒绝会被观察，其他值忽略，不等待接收端。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
        },
        warn: {
          summary: {
            en: 'Receives an RPC event that passes the log filter and is assigned to the warn level.',
            zh: '接收通过日志筛选、被分配到 `warn` 级别的 RPC 事件。'
          },
          params: {
            message: {
              en: 'String from the built-in category text or synchronous message formatter.',
              zh: '来自内置分类文本或同步格式化回调的字符串。'
            },
            fields: {
              en: 'Probe-created fields containing method/message/sender/target/trace, duration, outcome, kind, rejection, lifecycle, peer and original error; optional captured content retains its reference.',
              zh: '探针创建的字段，包含方法、消息、发送者、目标、追踪、耗时、结果、种类、拒绝、生命周期、连接及原始错误，可选捕获内容保留引用。'
            }
          },
          returns: {
            en: 'Any caller result; thenable rejections are observed, other values are ignored and no sink is awaited.',
            zh: '可返回任意值，承诺拒绝会被观察，其他值忽略，不等待接收端。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
        },
        error: {
          summary: {
            en: 'Receives an RPC event that passes the log filter and is assigned to the error level.',
            zh: '接收通过日志筛选、被分配到 `error` 级别的 RPC 事件。'
          },
          params: {
            message: {
              en: 'String from the built-in category text or synchronous message formatter.',
              zh: '来自内置分类文本或同步格式化回调的字符串。'
            },
            fields: {
              en: 'Probe-created fields containing method/message/sender/target/trace, duration, outcome, kind, rejection, lifecycle, peer and original error; optional captured content retains its reference.',
              zh: '探针创建的字段，包含方法、消息、发送者、目标、追踪、耗时、结果、种类、拒绝、生命周期、连接及原始错误，可选捕获内容保留引用。'
            }
          },
          returns: {
            en: 'Any caller result; thenable rejections are observed, other values are ignored and no sink is awaited.',
            zh: '可返回任意值，承诺拒绝会被观察，其他值忽略，不等待接收端。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
        }
      }
    },
    IRpcDevtoolsErrorCode: {
      summary: {
        en: 'Value union of the devtools semantic code table; classify with RPC_DEVTOOLS_SOURCE and preserve original cause chains.',
        zh: '诊断语义错误表的值联合，与规范错误来源一起分类并保留原始原因链。'
      },
      example:
        "import { RpcDevtoolsRecordFormat, encodeRpcDevtoolsRecord, decodeRpcDevtoolsRecord } from '@migaia/rpc-plugin-devtools/contract'\n\nconst text = encodeRpcDevtoolsRecord({\n  header: RpcDevtoolsRecordFormat,\n  events: [{ seq: 1, at: 100, endpointId: 'worker', stage: 'message', direction: 'outbound', method: 'read', senderId: 'worker', messageId: 'm1', trace: 'T1', content: JSON.stringify({ $bytes: 'AQ==' }) }]\n})\nconsole.log(decodeRpcDevtoolsRecord(text).events[0])",
      members: {}
    },
    IDevtoolsPlugin: {
      summary: {
        en: 'Registered feature surface forwarding to one exact collector; pause/resume and service remain on collector.',
        zh: '转交到唯一精确采集器的登记功能接口，暂停恢复及服务仍位于采集器。'
      },
      scenarios: [
        {
          en: 'Share a collector across two actual hosts while preserving separate host cleanup.',
          zh: '跨两个实际宿主共享采集器并保留独立宿主清理。'
        }
      ],
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}",
      members: {
        collector: {
          summary: {
            en: 'Exact original collector; the application owns its final close.',
            zh: '精确原采集器，应用拥有最终关闭。'
          }
        },
        query: {
          summary: {
            en: 'Synchronously scans retained events with compiled filters. This is a snapshot rather than a subscription; limits are one through one thousand.',
            zh: '用已编译筛选条件同步扫描保留事件，返回快照而非订阅，数量上限为一至一千。'
          },
          params: {
            input: {
              en: 'Optional IRpcDevtoolsQuery; default cursor zero, limit one thousand and no field filters. Take subsequent afterSeq from the prior page nextSeq.',
              zh: '可选查询，默认游标零、上限一千且无字段筛选，后续游标取自上一页的 `nextSeq`。'
            }
          },
          returns: {
            en: 'IRpcDevtoolsPage with events, nextSeq and loss counters. Invalid inputs use INVALID_OPTION and closed collectors use CLOSED.',
            zh: '返回含事件、下页游标及丢失计数的查询页，非法输入使用 `INVALID_OPTION`，关闭的采集器使用 `CLOSED`。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
        },
        watch: {
          summary: {
            en: 'Subscribes from first generator advancement to future filtered events. Batches contain at most 256 events and each watcher retains at most 64 queued batches; overflow is counted rather than blocking RPC.',
            zh: '从首次推进生成器开始订阅未来筛选事件，每批至多二百五十六条，每个观察者至多排队六十四批，溢出计数而不阻塞远程调用。'
          },
          params: {
            input: {
              en: 'Optional query filters excluding afterSeq and limit; defaults to no filters. Use query separately for retained history.',
              zh: '可选查询筛选，排除历史游标及上限字段，默认不筛选，历史数据另用查询接口读取。'
            }
          },
          returns: {
            en: 'AsyncGenerator<IRpcDevtoolsWatchBatch>; return wakes a pending local next and releases the watcher without needing Collector.close. Collector close instead wakes pending reads with CLOSED; remote stream cancellation ends its service watcher normally.',
            zh: '返回观察批次异步生成器，结束迭代会唤醒本地待定读取并释放观察者，无需关闭采集器；关闭采集器则使等待读取以 `CLOSED` 失败，远端流取消则正常结束其服务观察者。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
        },
        stats: {
          summary: {
            en: 'Snapshots endpoint/method settlement aggregates independently from query-ring eviction; clear resets them.',
            zh: '取得不受查询环淘汰影响的端点与方法结算聚合快照，清空操作会重置统计。'
          },
          returns: {
            en: 'IRpcDevtoolsStats with cumulative counts and histogram-derived quantiles; a closed collector throws CLOSED.',
            zh: '返回含累计计数及直方图分位数的统计，已关闭采集器抛 `CLOSED`。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
        },
        describe: {
          summary: {
            en: 'Reports the current monotonic clock sample, pause state, known endpoint descriptors, limits and loss counters.',
            zh: '报告当前单调时钟采样、暂停状态、已知端点描述、容量限制及丢失计数。'
          },
          returns: {
            en: 'IRpcDevtoolsDescribe snapshot; descriptors preserve their element references. Closed collectors throw CLOSED.',
            zh: '返回描述快照，端点描述元素保留原引用，已关闭采集器抛 `CLOSED`。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
        },
        close: {
          summary: {
            en: 'Idempotently removes subscriptions, releases retained storage and wakes pending watchers. It owns no serving Peer and does not close application endpoints.',
            zh: '幂等移除订阅、释放保留存储并唤醒等待观察者，不拥有服务端连接，也不会关闭应用端点。'
          },
          returns: {
            en: 'Collector storage and subscriptions are released synchronously; later operational calls reject with CLOSED.',
            zh: '同步释放采集器存储及订阅，后续操作调用以 `CLOSED` 拒绝。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
        }
      }
    }
  },
  enums: {
    RpcDevtoolsErrorCode: {
      summary: {
        en: 'Stable devtools package error categories, covering local collectors, records, logging and hub ownership.',
        zh: '覆盖本地采集器、记录、日志及聚合所有权的稳定诊断包错误分类。'
      },
      values: {
        targetReleaseFailed: {
          en: 'TARGET_RELEASE_FAILED: the hub failed to release a target watch. A native AggregateError retains the first original on cause/errors[0] and all failures on errors; close continues after reporting.',
          zh: '目标释放失败：聚合器释放目标观察失败；原生汇总错误在原因及首错误中保留首项原错，错误列表保留全部失败，报告后关闭继续完成。'
        },
        serviceResultInvalid: {
          en: 'Service result cannot become portable wire data; inspect the original conversion cause.',
          zh: '服务结果无法转换为可移植线数据，需要检查原始转换原因。'
        },
        invalidOption: {
          en: 'Collector, hub or log options violate a supported domain; correct the supplied option.',
          zh: '采集器、聚合器或日志选项违反支持的值域，需要修正选项。'
        },
        closed: {
          en: 'An operation uses a closed collector or hub; create a live instance rather than reviving it.',
          zh: '操作使用已关闭采集器或聚合器，需要创建存活实例而非复活旧实例。'
        },
        recordActive: {
          en: 'A recording is already active on the collector; stop it before starting another.',
          zh: '采集器已有活动录制，必须先停止再开始另一个录制。'
        },
        recordNotActive: {
          en: 'Stop has no matching active recording, including repeated stop or a stale handle.',
          zh: '停止时没有匹配活动录制，包括重复停止或使用失效句柄。'
        },
        recordFormatInvalid: {
          en: 'Record header, event, bytes or error graph fails the frozen version-one format boundary.',
          zh: '记录头、事件、字节或错误图不符合固定第一版格式边界。'
        },
        redactFailed: {
          en: 'Collector redaction throws; content is discarded and the original cause is reported.',
          zh: '采集器脱敏回调抛错，内容被丢弃并报告原始原因。'
        },
        targetDuplicate: {
          en: 'A hub target name is already registered; remove the old target before replacement.',
          zh: '聚合目标名已注册，替换前需要先移除旧目标。'
        },
        targetUnknown: {
          en: 'A requested hub target has never been registered or is unavailable for that operation.',
          zh: '所请求聚合目标未曾注册，或当前操作无法使用该目标。'
        }
      }
    },
    RpcDevtoolsRecordFormat: {
      summary: {
        en: 'Exact record header identity; both values are required by the version-one NDJSON codec.',
        zh: '精确记录头身份，第一版逐行编解码器要求同时提供两个值。'
      },
      values: {
        format: {
          en: 'migaia-rpc-devtools selects this package offline record grammar.',
          zh: '固定格式标识选择当前包的离线记录语法。'
        },
        version: {
          en: 'One selects the frozen first record grammar; unsupported versions reject.',
          zh: '版本一选择固定首版记录语法，不支持的版本会被拒绝。'
        }
      }
    },
    RpcDevtoolsTargetStatus: {
      summary: {
        en: 'Observed hub target states used by status queries and status callbacks.',
        zh: '状态查询及状态观察回调使用的聚合目标观察状态。'
      },
      values: {
        connecting: {
          en: 'A live target is registered and clock alignment or catch-up is still in progress.',
          zh: '实时目标已注册，正在进行时钟对齐或历史数据追赶。'
        },
        connected: {
          en: 'Alignment and catch-up completed and its live watch was acquired.',
          zh: '时钟对齐与历史追赶已完成，并已取得实时观察流。'
        },
        disconnected: {
          en: 'Live setup or watch ended or failed; retained observations remain available until removal.',
          zh: '实时设置或观察结束或失败，保留观察仍可使用直到移除目标。'
        },
        offline: {
          en: 'A decoded record was imported without a live client or clock sampling.',
          zh: '导入了已解码记录，没有实时客户端或时钟采样。'
        },
        removed: {
          en: 'The name was removed; retained events are detached and its watch is released.',
          zh: '目标名已移除，保留事件被分离，其观察流被释放。'
        }
      }
    }
  },
  enhancers: {
    createRpcLogProbe: {
      kind: 'plugin',
      target: 'IRpcEndpoint',
      summary: {
        en: 'Install the returned IRpcProbe through Core probePlugin. Existing endpoint observation gains qualified logger dispatch; no request methods or transport ownership are added.',
        zh: '将返回探针经核心探针插件安装，使已有端点观察获得条件化日志分派，不新增请求方法或传输所有权。'
      },
      install:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}",
      grants: [],
      behaviors: [
        {
          en: 'Failures and qualifying slow or lifecycle observations dispatch one configured sink call; logger or formatter failure never changes business RPC results.',
          zh: '失败及合格慢调用或生命周期观察分派一次配置接收调用，日志或格式化失败不改变业务调用结果。'
        }
      ],
      scenarios: [
        {
          en: 'Use an existing logger to observe operational failures without retaining a collector event ring.',
          zh: '使用已有日志接收端观察运行失败，无需保留采集事件环。'
        }
      ],
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
    },
    devtoolsPlugin: {
      kind: 'feature',
      target: 'IRpcHost',
      summary: {
        en: 'Install the original bounded collector directly into real host observation. Same feature object may observe multiple hosts; closing one host withdraws only its observation and never closes the collector.',
        zh: '将原有界采集器直接安装到真实宿主观察。同一功能对象可观察多个宿主，关闭一个宿主仅撤回其观察，不关闭采集器。'
      },
      install:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}",
      grants: [
        {
          signature: 'tools.collector',
          summary: {
            en: 'The same original application-owned IRpcDevtools, with no copied probe emitter or second collector state.',
            zh: '同一原应用拥有采集器，不复制观察发射器或第二份采集状态。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
        }
      ],
      behaviors: [
        {
          en: 'Subscriptions use actual endpoint/carrier probes. Collector close does not close business hosts, and host close does not close the collector.',
          zh: '订阅使用实际端点及载体观察，采集器关闭不关闭业务宿主，宿主关闭也不关闭采集器。'
        }
      ],
      scenarios: [
        {
          en: 'Inspect calls, loss and cumulative statistics without modifying providers.',
          zh: '不修改提供方即可查看调用、丢失及累计统计。'
        }
      ],
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect }), tools],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    tools\n  ]\n})\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.request('double', 21))\n  const batch = await next\n  console.log(batch.value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
    }
  }
}
