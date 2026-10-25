/** Bilingual public reference for the current devtools transport and feature ownership. */
import type { ILibraryReference } from './contract.js'

/** Concrete public package example with actual namespace and resource ownership. */

/** Concrete public package example with actual namespace and resource ownership. */
const example2 =
  "import { RPC_DEVTOOLS_SOURCE, RpcDevtoolsErrorCode } from '@migaia/rpc-plugin-devtools'\nconsole.log(RPC_DEVTOOLS_SOURCE, RpcDevtoolsErrorCode.closed)"

/** Concrete public package example with actual namespace and resource ownership. */
const example3 =
  "import { RpcDevtoolsErrorCode } from '@migaia/rpc-plugin-devtools'\nconsole.log(RpcDevtoolsErrorCode.recordActive)"

/** Concrete public package example with actual namespace and resource ownership. */
const example4 =
  "import { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 100 })\ntry {\n  const recording = tools.collector.record({ maxEvents: 200 })\n  tools.collector.clear()\n  const record = recording.stop()\n  const text = tools.collector.exportRecord(record)\n  console.log(tools.collector.importRecord(text).header.version)\n} finally {\n  tools.close()\n}"

/** Public configuration example for this native capability. */
const timelineExample =
  "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nasync function untilStopped(signal: AbortSignal): Promise<void> {\n  let complete!: () => void\n  const stopped = new Promise<void>((resolve) => {\n    complete = resolve\n  })\n  signal.addEventListener('abort', complete, { once: true })\n  if (signal.aborted) complete()\n  try {\n    await stopped\n  } finally {\n    signal.removeEventListener('abort', complete)\n  }\n}\n\nconst tools = devtoolsPlugin({\n  methods: ['double'],\n  sample: 1,\n  maxEvents: 1000,\n  maxInterned: 256\n})\nconst task: ICoroutineUserTask = async ({ connect, signal }) => {\n  const child = await createRpcHost({\n    plugins: [tools, coroutinePlugin({ connectToParent: connect })],\n    provide: { double: (value: number) => value * 2 }\n  })\n  try {\n    await untilStopped(signal)\n  } finally {\n    await child.close()\n  }\n}\n\ntype IWorkerApi = { double(value: number): number }\nconst plugins = [tools, coroutinePlugin({ spawn: task })] as const\nconst parent = await createRpcHost<IWorkerApi, typeof plugins>({ plugins })\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.coroutine.request('double', 21))\n  console.log((await next).value?.events)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"

/** Public configuration example for this native capability. */
const capturedTimelineExample =
  "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nasync function untilStopped(signal: AbortSignal): Promise<void> {\n  let complete!: () => void\n  const stopped = new Promise<void>((resolve) => {\n    complete = resolve\n  })\n  signal.addEventListener('abort', complete, { once: true })\n  if (signal.aborted) complete()\n  try {\n    await stopped\n  } finally {\n    signal.removeEventListener('abort', complete)\n  }\n}\n\nconst tools = devtoolsPlugin({\n  stages: ['message'],\n  capture: ['message'],\n  maxContentBytes: 65536,\n  exposeContent: true,\n  redact() {\n    return { redacted: true }\n  }\n})\nconst task: ICoroutineUserTask = async ({ connect, signal }) => {\n  const child = await createRpcHost({\n    plugins: [tools, coroutinePlugin({ connectToParent: connect })],\n    provide: { double: (value: number) => value * 2 }\n  })\n  try {\n    await untilStopped(signal)\n  } finally {\n    await child.close()\n  }\n}\n\ntype IWorkerApi = { double(value: number): number }\nconst plugins = [tools, coroutinePlugin({ spawn: task })] as const\nconst parent = await createRpcHost<IWorkerApi, typeof plugins>({ plugins })\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.coroutine.request('double', 21))\n  console.log((await next).value?.events)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"

/** Public configuration example for this native capability. */
const redactionFailureExample =
  "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nasync function untilStopped(signal: AbortSignal): Promise<void> {\n  let complete!: () => void\n  const stopped = new Promise<void>((resolve) => {\n    complete = resolve\n  })\n  signal.addEventListener('abort', complete, { once: true })\n  if (signal.aborted) complete()\n  try {\n    await stopped\n  } finally {\n    signal.removeEventListener('abort', complete)\n  }\n}\n\nconst tools = devtoolsPlugin({\n  stages: ['message'],\n  capture: ['message'],\n  redact() {\n    throw new Error('Support projection failed')\n  },\n  onError(error) {\n    console.error('Support diagnostics failure', error)\n  }\n})\nconst task: ICoroutineUserTask = async ({ connect, signal }) => {\n  const child = await createRpcHost({\n    plugins: [tools, coroutinePlugin({ connectToParent: connect })],\n    provide: { double: (value: number) => value * 2 }\n  })\n  try {\n    await untilStopped(signal)\n  } finally {\n    await child.close()\n  }\n}\n\ntype IWorkerApi = { double(value: number): number }\nconst plugins = [tools, coroutinePlugin({ spawn: task })] as const\nconst parent = await createRpcHost<IWorkerApi, typeof plugins>({ plugins })\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.coroutine.request('double', 21))\n  console.log((await next).value?.events)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"

/** Current public modules, configuration and installed capabilities. */
export const rpcDevtoolsReference: ILibraryReference = {
  modules: {
    index: {
      summary: {
        en: 'Contract owns pure protocol, interfaces and errors. Host owns Sessions, calls and providers; this package owns caller-owned observation, bounded collection and recording. Flow plugins use fixed hooks, and complete features own optional policy. Call through the transport namespace. Separate Hosts are usual; deliberate multi-transport installation uses distinct namespaces.',
        zh: '契约包拥有纯协议、接口及错误；宿主拥有会话、调用及提供方，本包拥有调用方拥有的观察、有界收集及记录。流程插件使用固定钩子，完整功能拥有可选策略。通过传输命名空间调用；通常使用独立宿主，也可用不同命名空间明确隔离多传输安装。'
      },
      example: timelineExample
    }
  },
  symbols: {
    RPC_DEVTOOLS_SOURCE: {
      role: 'error',
      purpose: {
        en: 'Stable rpc.devtools source declared by @migaia/rpc-contract/error-code and re-exported here. Other RPC/native families retain their own source and code.',
        zh: '由契约包错误码入口声明并在此重导出的稳定来源 rpc.devtools；其他远程调用及原生家族保留自身来源与错误码。'
      },
      example: example2
    },
    RpcDevtoolsErrorCode: {
      role: 'error',
      purpose: {
        en: 'Stable semantic error vocabulary for options, collector lifecycle, recording and portable service conversion. Original causes remain reachable through native error chains.',
        zh: '提供选项、采集生命周期、录制及可移植服务转换的稳定语义错误词汇，原始原因通过原生错误链保持可达。'
      },
      example: example3
    },
    devtoolsPlugin: {
      role: 'enhancer',
      purpose: {
        en: 'Install one genuine observe flow plugin backed by the caller-owned collector. Direct query/watch/stats/describe/close methods refer to that same collector.',
        zh: '安装由调用方拥有的收集器支撑的真实观察流程插件；直接查询、观察、统计、描述及关闭方法均属于同一收集器。'
      },
      options: 'IRpcDevtoolsOptions',
      returns: {
        en: 'IDevtoolsPlugin with one collector plus direct query/watch/stats/describe/close projections; retain the exact installed object.',
        zh: '返回含唯一采集器及五个直接查询观察控制投影的功能对象，须保留精确安装对象。'
      },
      example: timelineExample
    }
  },
  types: {
    IRpcDevtools: {
      summary: {
        en: 'Collector exposed by devtoolsPlugin().collector, composed with external IRpcProbe. The Core owns stage masks and setStages; this collector owns retention, queries, recording, service projection and explicit close.',
        zh: '由 devtoolsPlugin().collector 公开、组合外包探针的采集器，核心包拥有阶段掩码及订阅修改，当前包拥有保留、查询、录制、服务投影与显式关闭。'
      },
      scenarios: [
        {
          en: 'Observe endpoint traffic locally and serve a separate diagnostics connection without owning business transports.',
          zh: '本地观察端点流量并经独立诊断连接提供服务，不拥有业务传输。'
        }
      ],
      example: timelineExample,
      members: {
        emit: {
          summary: {
            en: 'Consumes a reusable IRpcProbeEventView synchronously into retained columns; never retains the view. The installed observe flow forwards actual Host observation here.',
            zh: '同步消费复用的探针事件视图并写入保留列，不保留视图；已安装观察流程将实际宿主观察送入此处。'
          },
          params: {
            view: {
              en: 'IRpcProbeEventView issued by an installed Core emitter, valid only during its synchronous emit call; external type semantics remain in @migaia/rpc-host/plugins/probe.',
              zh: '已安装核心发射器签发的 `IRpcProbeEventView`，仅同步发射调用期间有效，外包类型语义由 `@migaia/rpc-host/plugins/probe` 拥有。'
            }
          },
          returns: {
            en: 'Metadata is retained or accounted as filtered, paused, closed or reentrant loss. Observation failures are reported instead of reaching the business caller.',
            zh: '元数据已被保留，或被记为筛选、暂停、关闭及重入丢失，观察失败通过报告通道处理，不传给业务调用者。'
          },
          example: timelineExample
        },
        query: {
          summary: {
            en: 'Synchronously scans retained events with compiled filters. This is a snapshot rather than a subscription; limits are one through one thousand.',
            zh: '用已编译筛选条件同步扫描保留事件，返回快照而非订阅，数量上限为一至一千。'
          },
          params: {
            input: {
              en: 'Optional query options; default cursor zero, limit one thousand and no field filters. Take subsequent afterSeq from the prior page nextSeq.',
              zh: '可选查询，默认游标零、上限一千且无字段筛选，后续游标取自上一页的 `nextSeq`。'
            }
          },
          returns: {
            en: 'A page with events, nextSeq and loss counters. Invalid inputs use INVALID_OPTION and closed collectors use CLOSED.',
            zh: '返回含事件、下页游标及丢失计数的查询页，非法输入使用 `INVALID_OPTION`，关闭的采集器使用 `CLOSED`。'
          },
          example: timelineExample
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
            en: 'An async generator of event batches; return wakes a pending local next and releases the watcher without needing Collector.close. Collector close instead wakes pending reads with CLOSED; remote stream cancellation ends its service watcher normally.',
            zh: '返回观察批次异步生成器，结束迭代会唤醒本地待定读取并释放观察者，无需关闭采集器；关闭采集器则使等待读取以 `CLOSED` 失败，远端流取消则正常结束其服务观察者。'
          },
          example: timelineExample
        },
        stats: {
          summary: {
            en: 'Snapshots endpoint/method settlement aggregates independently from query-ring eviction; clear resets them.',
            zh: '取得不受查询环淘汰影响的端点与方法结算聚合快照，清空操作会重置统计。'
          },
          returns: {
            en: 'A statistics snapshot with cumulative counts and histogram-derived quantiles; a closed collector throws CLOSED.',
            zh: '返回含累计计数及直方图分位数的统计，已关闭采集器抛 `CLOSED`。'
          },
          example: timelineExample
        },
        describe: {
          summary: {
            en: 'Reports the current monotonic clock sample, pause state, known endpoint descriptors, limits and loss counters.',
            zh: '报告当前单调时钟采样、暂停状态、已知端点描述、容量限制及丢失计数。'
          },
          returns: {
            en: 'A collector description snapshot; descriptors preserve their element references. Closed collectors throw CLOSED.',
            zh: '返回描述快照，端点描述元素保留原引用，已关闭采集器抛 `CLOSED`。'
          },
          example: timelineExample
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
            en: 'A handle with stop() returning its captured record, taking no arguments and stopping only its own active ring. Duplicate start throws RECORD_ACTIVE; a stale or repeated stop throws RECORD_NOT_ACTIVE; closure throws CLOSED.',
            zh: '返回含无参数停止方法的句柄，停止仅限其拥有的活动录制并返回离线记录，重复启动抛 `RECORD_ACTIVE`，失效或重复停止抛 `RECORD_NOT_ACTIVE`，关闭后抛 `CLOSED`。'
          },
          example: example4
        },
        exportRecord: {
          summary: {
            en: 'Encodes a stopped record through the standalone canonical record codec; this method does not change retained collector state.',
            zh: '通过规范独立记录编解码器输出已停止记录，不改变采集器保留状态。'
          },
          params: {
            record: {
              en: 'A captured record returned by a recording handle stop or importRecord.',
              zh: '录制句柄停止操作或记录解码器返回的离线记录。'
            }
          },
          returns: {
            en: 'Version-one NDJSON string; unsupported record input throws RECORD_FORMAT_INVALID with cause.',
            zh: '返回第一版逐行 `JSON` 文本，不支持的记录输入抛 `RECORD_FORMAT_INVALID` 并保留原因。'
          },
          example: timelineExample
        },
        importRecord: {
          summary: {
            en: 'Decodes offline text into an independent record; it does not append events to this collector or change its ring.',
            zh: '将离线文本解码为独立记录，不向当前采集器追加事件或修改保留环。'
          },
          params: {
            text: {
              en: 'Version-one text returned by exportRecord.',
              zh: '记录导出方法返回的第一版文本。'
            }
          },
          returns: {
            en: 'A record with revived native errors and bytes, or RECORD_FORMAT_INVALID with cause.',
            zh: '返回恢复原生错误和字节的离线记录，失败抛 `RECORD_FORMAT_INVALID` 并保留原因。'
          },
          example: timelineExample
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
          example: timelineExample
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
          example: timelineExample
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
          example: timelineExample
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
          example: timelineExample
        },
        service: {
          summary: {
            en: 'Nested IRpcProvide object installed explicitly on a separate authorized Host; the application owns that serving connection and its cleanup.',
            zh: '显式安装在独立获授权宿主上的嵌套 `IRpcProvide` 对象，应用拥有服务连接及清理。'
          },
          example: timelineExample
        }
      }
    },
    IRpcDevtoolsOptions: {
      optionCases: [
        {
          title: {
            en: 'Keep a focused calculation timeline',
            zh: '保留有边界的计算调用时间线'
          },
          problem: {
            en: 'A calculation intermittently stalls while other worker methods succeed. Select double calls, retain every eligible identity and bound event and name storage so the support timeline stays usable.',
            zh: '计算偶尔卡住，但工作线程其他方法正常。筛选计算方法、保留符合条件的调用身份，再限制事件及名称存储，让支持时间线持续可用。'
          },
          example: timelineExample,
          result: {
            en: 'The application prints its calculation result and actual timeline event rows; retention limits keep old history bounded.',
            zh: '应用输出计算结果及实际时间线事件记录，保留上限使历史保持有界。'
          },
          covers: ['methods', 'sample', 'maxEvents', 'maxInterned']
        },
        {
          title: {
            en: 'Hide captured business values from support history',
            zh: '从支持历史隐藏捕获的业务数值'
          },
          problem: {
            en: 'A support client needs a timeline but must not receive raw calculation arguments. Explicitly capture logical messages, replace their content synchronously, and opt into exposing only that replacement through collector.service.',
            zh: '支持客户端需要时间线，但不能收到原计算参数。显式捕获逻辑消息、同步替换内容，再选择只经采集器服务公开替代内容。'
          },
          example: capturedTimelineExample,
          result: {
            en: 'The calculation still returns42. Retained events and permitted service reads contain the redacted replacement instead of the original captured business content.',
            zh: '计算仍返回四十二；保留事件及获准服务读取包含脱敏替代值，而非原捕获业务内容。'
          },
          covers: ['capture', 'maxContentBytes', 'exposeContent']
        },
        {
          title: {
            en: 'Report redactor failures without failing the call',
            zh: '脱敏失败时报告错误，不让调用失败'
          },
          problem: {
            en: 'A broken support projection must be visible to monitoring without breaking a successful calculation. The example deliberately throws from redact and routes that original diagnostic to the application sink.',
            zh: '支持投影损坏时需要让监控知道，但不能破坏成功的计算。示例故意让投影回调抛错，并将原诊断送到应用接收器。'
          },
          example: redactionFailureExample,
          result: {
            en: 'The calculation still returns42; monitoring receives the diagnostic and the failed captured content is dropped.',
            zh: '计算仍返回四十二，监控收到诊断，处理失败的捕获内容被丢弃。'
          },
          covers: ['onError']
        }
      ],
      summary: {
        en: 'Construction policies for a bounded collector; capacities are captured once, while effective subscriptions can later change through the Core probe setStages API.',
        zh: '有界采集器构造策略，容量一次捕获，生效订阅随后可经核心探针订阅接口修改。'
      },
      example: timelineExample,
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
            en: 'Explicit stages whose content may be read. Select names from RpcProbeStageName in @migaia/rpc-host/plugins/probe and keep capture within initially subscribed stages.',
            zh: '显式允许读取内容的阶段，名称来自 `@migaia/rpc-host/plugins/probe` 的阶段名表，必须为初始订阅阶段的子集。'
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
          example: capturedTimelineExample
        },
        onError: {
          whenToUse: {
            en: 'Set this callback when a diagnostic failure should reach the application monitor. It receives collector observation failures without replacing a business result. Omission keeps the documented host reporter for the owning component.',
            zh: '诊断失败需要进入应用监控时，设置这个回调。它接收采集器观察回调的失败，不替换业务结果。省略时使用所属组件文档中说明的宿主报告函数。'
          },
          summary: {
            en: 'Synchronous observer receiving an original diagnostic error. Return nothing; observer failures are reported through the host failure channel without changing the RPC operation.',
            zh: '接收原始诊断错误的同步观察回调，无需返回值；观察回调失败经宿主失败通道报告，不改变远程调用操作结果。'
          },
          params: {
            error: {
              en: 'Original collector observation failure supplied by its owning component.',
              zh: '由所属组件提供的采集器观察原始失败。'
            }
          },
          returns: {
            en: 'No result is used and no asynchronous work is awaited by this callback boundary.',
            zh: '不使用返回值，此回调边界不等待异步工作。'
          },
          default: {
            en: 'Uses the Core hostRethrowReporter failure channel.',
            zh: '默认使用核心包的宿主重新抛出报告通道。'
          },
          example: redactionFailureExample
        },
        stages: {
          whenToUse: {
            en: 'Use `message` for logical calls and `peer` for connection lifecycle. Add `envelope`, `encoded`, `frame`, `protected` or `carrier` to inspect those physical processing steps. Omission selects message and peer; choosing a stage never enables content capture by itself.',
            zh: '用 `message` 观察逻辑调用，用 `peer` 观察连接生命周期。需要检查封装、编码、分帧、保护后内容或物理载体时，分别增加 `envelope`、`encoded`、`frame`、`protected` 或 `carrier`。省略时选择消息与连接阶段；选中阶段本身不会开启内容捕获。'
          },
          example: capturedTimelineExample,
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
    IRpcDevtoolsErrorCode: {
      summary: {
        en: 'Value union of the devtools semantic code table; classify with RPC_DEVTOOLS_SOURCE and preserve original cause chains.',
        zh: '诊断语义错误表的值联合，与规范错误来源一起分类并保留原始原因链。'
      },
      example: example4,
      members: {}
    },
    IDevtoolsPlugin: {
      summary: {
        en: 'Complete flow plugin retaining its collector and the same query, watch, stats, describe and close methods. Collector close does not close observing Hosts.',
        zh: '保留收集器以及同一组查询、观察、统计、描述及关闭方法的完整流程插件。关闭收集器不会关闭观察它的宿主。'
      },
      scenarios: [
        {
          en: 'Share a collector across two actual hosts while preserving separate host cleanup.',
          zh: '跨两个实际宿主共享采集器并保留独立宿主清理。'
        }
      ],
      example: timelineExample,
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
              en: 'Optional query options; default cursor zero, limit one thousand and no field filters. Take subsequent afterSeq from the prior page nextSeq.',
              zh: '可选查询，默认游标零、上限一千且无字段筛选，后续游标取自上一页的 `nextSeq`。'
            }
          },
          returns: {
            en: 'A page with events, nextSeq and loss counters. Invalid inputs use INVALID_OPTION and closed collectors use CLOSED.',
            zh: '返回含事件、下页游标及丢失计数的查询页，非法输入使用 `INVALID_OPTION`，关闭的采集器使用 `CLOSED`。'
          },
          example: timelineExample
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
            en: 'An async generator of event batches; return wakes a pending local next and releases the watcher without needing Collector.close. Collector close instead wakes pending reads with CLOSED; remote stream cancellation ends its service watcher normally.',
            zh: '返回观察批次异步生成器，结束迭代会唤醒本地待定读取并释放观察者，无需关闭采集器；关闭采集器则使等待读取以 `CLOSED` 失败，远端流取消则正常结束其服务观察者。'
          },
          example: timelineExample
        },
        stats: {
          summary: {
            en: 'Snapshots endpoint/method settlement aggregates independently from query-ring eviction; clear resets them.',
            zh: '取得不受查询环淘汰影响的端点与方法结算聚合快照，清空操作会重置统计。'
          },
          returns: {
            en: 'A statistics snapshot with cumulative counts and histogram-derived quantiles; a closed collector throws CLOSED.',
            zh: '返回含累计计数及直方图分位数的统计，已关闭采集器抛 `CLOSED`。'
          },
          example: timelineExample
        },
        describe: {
          summary: {
            en: 'Reports the current monotonic clock sample, pause state, known endpoint descriptors, limits and loss counters.',
            zh: '报告当前单调时钟采样、暂停状态、已知端点描述、容量限制及丢失计数。'
          },
          returns: {
            en: 'A collector description snapshot; descriptors preserve their element references. Closed collectors throw CLOSED.',
            zh: '返回描述快照，端点描述元素保留原引用，已关闭采集器抛 `CLOSED`。'
          },
          example: timelineExample
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
          example: timelineExample
        }
      }
    }
  },
  enums: {
    RpcDevtoolsErrorCode: {
      summary: {
        en: 'Stable devtools package error categories for collector lifecycle, records and portable service conversion.',
        zh: '覆盖采集生命周期、记录和可移植服务转换的稳定诊断包错误分类。'
      },
      values: {
        serviceResultInvalid: {
          en: 'Service result cannot become portable wire data; inspect the original conversion cause.',
          zh: '服务结果无法转换为可移植线数据，需要检查原始转换原因。'
        },
        invalidOption: {
          en: 'Collector options violate a supported domain; correct the supplied option.',
          zh: '采集器选项违反支持的值域，需要修正选项。'
        },
        closed: {
          en: 'An operation uses a closed collector; create a live instance rather than reviving it.',
          zh: '操作使用已关闭采集器，需要创建存活实例而非复活旧实例。'
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
        }
      }
    }
  },
  enhancers: {
    devtoolsPlugin: {
      kind: 'plugin',
      target: 'createRpcHost.plugins',
      summary: {
        en: 'Install the original bounded collector directly into real host observation. Same feature object may observe multiple hosts; closing one host withdraws only its observation and never closes the collector.',
        zh: '将原有界采集器直接安装到真实宿主观察。同一功能对象可观察多个宿主，关闭一个宿主仅撤回其观察，不关闭采集器。'
      },
      install: timelineExample,
      grants: [
        {
          signature: 'tools.collector',
          summary: {
            en: 'The same original application-owned IRpcDevtools, with no copied probe emitter or second collector state.',
            zh: '同一原应用拥有采集器，不复制观察发射器或第二份采集状态。'
          },
          example: timelineExample
        }
      ],
      behaviors: [
        {
          en: 'The observe hook lends events to the caller-owned collector. Uninstall releases this Host observation; the caller closes its collector.',
          zh: '观察钩子把事件借给调用方拥有的收集器。卸载释放此宿主的观察；调用方负责关闭收集器。'
        }
      ],
      scenarios: [
        {
          en: 'Inspect calls, loss and cumulative statistics without modifying providers.',
          zh: '不修改提供方即可查看调用、丢失及累计统计。'
        }
      ],
      example: timelineExample
    }
  }
}
