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
    }
  },
  symbols: {
    RPC_DEVTOOLS_SOURCE: {
      role: 'error',
      purpose: {
        en: 'Identifies failures created by RPC Devtools. When handling a caught error, compare its source with RPC_DEVTOOLS_SOURCE, then compare code with RpcDevtoolsErrorCode to select a response. Configuration failures remain TypeError instances; failures involving a diagnostic session use Error. You do not need to parse the message to classify them.',
        zh: '标识 RPC 调试工具创建的失败。处理捕获的错误时，先检查 source 是否等于 RPC_DEVTOOLS_SOURCE，再用 RpcDevtoolsErrorCode 比较 code，选择处理方式。配置失败仍然是 TypeError，诊断会话失败使用 Error；分类时无需解析消息文本。'
      },
      example:
        "import { RPC_DEVTOOLS_SOURCE, RpcDevtoolsErrorCode } from '@migaia/rpc-plugin-devtools'\nconsole.log(RPC_DEVTOOLS_SOURCE, RpcDevtoolsErrorCode.closed)"
    },
    RpcDevtoolsErrorCode: {
      role: 'error',
      purpose: {
        en: 'Stable semantic error vocabulary for options, collector lifecycle, recording and portable service conversion. Original causes remain reachable through native error chains.',
        zh: '提供选项、采集生命周期、录制及可移植服务转换的稳定语义错误词汇，原始原因通过原生错误链保持可达。'
      },
      example:
        "import { RpcDevtoolsErrorCode } from '@migaia/rpc-plugin-devtools'\nconsole.log(RpcDevtoolsErrorCode.recordActive)"
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
        en: 'Collector exposed by devtoolsPlugin().collector, composed with external IRpcProbe. The Core owns stage masks and setStages; this collector owns retention, queries, recording, service projection and explicit close.',
        zh: '由 devtoolsPlugin().collector 公开、组合外包探针的采集器，核心包拥有阶段掩码及订阅修改，当前包拥有保留、查询、录制、服务投影与显式关闭。'
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
            en: 'Consumes a Core-owned reusable IRpcProbeEventView synchronously into retained columns; never keeps the view itself. Installed emitters call it through the Host probe option or the devtools plugin.',
            zh: '同步消费核心包拥有的复用事件视图并写入保留列，不保存视图本身；安装后的发射器经 Host 的 probe 选项或 devtools 插件调用它。'
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
              en: 'Optional query options; default cursor zero, limit one thousand and no field filters. Take subsequent afterSeq from the prior page nextSeq.',
              zh: '可选查询，默认游标零、上限一千且无字段筛选，后续游标取自上一页的 `nextSeq`。'
            }
          },
          returns: {
            en: 'A page with events, nextSeq and loss counters. Invalid inputs use INVALID_OPTION and closed collectors use CLOSED.',
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
            en: 'An async generator of event batches; return wakes a pending local next and releases the watcher without needing Collector.close. Collector close instead wakes pending reads with CLOSED; remote stream cancellation ends its service watcher normally.',
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
            en: 'A statistics snapshot with cumulative counts and histogram-derived quantiles; a closed collector throws CLOSED.',
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
            en: 'A collector description snapshot; descriptors preserve their element references. Closed collectors throw CLOSED.',
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
            en: 'A handle with stop() returning its captured record, taking no arguments and stopping only its own active ring. Duplicate start throws RECORD_ACTIVE; a stale or repeated stop throws RECORD_NOT_ACTIVE; closure throws CLOSED.',
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
              en: 'A captured record returned by a recording handle stop or importRecord.',
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
              en: 'Version-one text returned by exportRecord.',
              zh: '记录导出方法返回的第一版文本。'
            }
          },
          returns: {
            en: 'A record with revived native errors and bytes, or RECORD_FORMAT_INVALID with cause.',
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

    IRpcDevtoolsErrorCode: {
      summary: {
        en: 'Value union of the devtools semantic code table; classify with RPC_DEVTOOLS_SOURCE and preserve original cause chains.',
        zh: '诊断语义错误表的值联合，与规范错误来源一起分类并保留原始原因链。'
      },
      example:
        "import { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nconst tools = devtoolsPlugin({ maxEvents: 100 })\ntry {\n  const empty = tools.collector.record().stop()\n  const text = tools.collector.exportRecord({\n    ...empty,\n    events: [{ seq: 1, at: 100, endpointId: 'worker', stage: 'message', direction: 'outbound', method: 'read', senderId: 'worker', messageId: 'm1', trace: 'T1', content: JSON.stringify({ $bytes: 'AQ==' }) }]\n  })\n  console.log(tools.collector.importRecord(text).events[0])\n} finally {\n  tools.close()\n}",
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
              en: 'Optional query options; default cursor zero, limit one thousand and no field filters. Take subsequent afterSeq from the prior page nextSeq.',
              zh: '可选查询，默认游标零、上限一千且无字段筛选，后续游标取自上一页的 `nextSeq`。'
            }
          },
          returns: {
            en: 'A page with events, nextSeq and loss counters. Invalid inputs use INVALID_OPTION and closed collectors use CLOSED.',
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
            en: 'An async generator of event batches; return wakes a pending local next and releases the watcher without needing Collector.close. Collector close instead wakes pending reads with CLOSED; remote stream cancellation ends its service watcher normally.',
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
            en: 'A statistics snapshot with cumulative counts and histogram-derived quantiles; a closed collector throws CLOSED.',
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
            en: 'A collector description snapshot; descriptors preserve their element references. Closed collectors throw CLOSED.',
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
