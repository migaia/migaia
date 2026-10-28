/** Bilingual public reference for the current thread transport and feature ownership. */
import type { ILibraryReference } from './contract.js'

/** Concrete public package example with actual namespace and resource ownership. */
const example1 =
  "import { createRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'\n\ntype IWorkerApi = { double(value: number): number }\n\nif (await isThreadChild()) {\n  await createRpcHost({\n    plugins: [threadPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const plugins = [threadPlugin({ spawn: true })] as const\n  const host = await createRpcHost<IWorkerApi, typeof plugins>({ plugins })\n  try {\n    console.log(await host.thread.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"

/** Concrete public package example with actual namespace and resource ownership. */
const example2 =
  "import { createRpcHost, type IRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin } from '@migaia/rpc-plugin-thread'\nimport { timeoutFeature, retryFeature } from '@migaia/rpc-host/features'\n\ntype IWorkerApi = {\n  values(end: number): AsyncIterable<number>\n  wait(value: number): number\n  bytes(value: Uint8Array<ArrayBuffer>): number\n}\n\nconst plugins = [\n  threadPlugin({\n    name: 'worker',\n    spawn: new URL('./worker.js', import.meta.url),\n    features: [timeoutFeature({ ms: 1500 }), retryFeature({ attempts: 2 })]\n  })\n] as const\n\ntype IThreadHost = IRpcHost<IWorkerApi, typeof plugins>\n\nexport function open() {\n  return createRpcHost<IWorkerApi, typeof plugins>({ plugins })\n}\n\nexport async function firstValue(host: IThreadHost) {\n  const stream = host.thread.peers.worker.values(3)\n  try {\n    return await stream.next()\n  } finally {\n    await stream.return?.()\n  }\n}\n\nexport function work(host: IThreadHost, signal: AbortSignal) {\n  return host.thread.send('worker', 'wait', 21, {\n    signal,\n    timeout: timeoutFeature({ ms: 500 }),\n    retry: false\n  })\n}\n\nexport function sendBytes(host: IThreadHost, bytes: Uint8Array<ArrayBuffer>) {\n  return host.thread.send('worker', 'bytes', bytes, { transfer: [bytes.buffer] })\n}\n\nexport async function inspectAndRestart(host: IThreadHost) {\n  const before = await host.thread.members.get('worker')\n  await host.thread.members.restart('worker')\n  return before\n}"

/** Public configuration example for this native capability. */
const workerScopeExample =
  "import { threadPlugin } from '@migaia/rpc-plugin-thread'\n\nexport function renderer(entry: URL) {\n  return threadPlugin({ spawn: entry, namespace: 'jobs', name: 'renderer' })\n}"

/** Public configuration example for this native capability. */
const workerExposureExample =
  "import { threadPlugin } from '@migaia/rpc-plugin-thread'\n\nexport function exposeMath(entry: URL) {\n  return threadPlugin({ spawn: entry, expose: ['math.double'] })\n}"

/** Public configuration example for this native capability. */
const workerReportExample =
  "import { threadPlugin } from '@migaia/rpc-plugin-thread'\n\nexport function monitoredWorker(entry: URL) {\n  return threadPlugin({\n    spawn: entry,\n    report(error) {\n      console.error('Worker background failure', error)\n    }\n  })\n}"

/** Current public modules, configuration and installed capabilities. */
export const rpcThreadsReference: ILibraryReference = {
  modules: {
    index: {
      summary: {
        en: 'Contract owns pure protocol, interfaces and errors. Host owns Sessions, calls and providers; this package owns native Node/Bun/Deno Worker sources. Flow plugins use fixed hooks, and complete features own optional policy. Call through the transport namespace. Separate Hosts are usual; deliberate multi-transport installation uses distinct namespaces.',
        zh: '契约包拥有纯协议、接口及错误；宿主拥有会话、调用及提供方，本包拥有Node、Bun、Deno 原生工作线程来源。流程插件使用固定钩子，完整功能拥有可选策略。通过传输命名空间调用；通常使用独立宿主，也可用不同命名空间明确隔离多传输安装。'
      },
      example: example1
    }
  },
  symbols: {
    isThreadChild: {
      role: 'operation',
      purpose: {
        en: 'Tells whether the current module runs inside a Worker started by this library, so one file can branch between parent and Worker for `spawn: true`.',
        zh: '判断当前模块是否运行在由本库启动的 Worker 中，使同一个文件可以在 `spawn: true` 时区分父线程与 Worker 两个分支。'
      },
      returns: {
        en: 'Resolves `true` in a library-launched Worker; it does not authorise foreign Workers.',
        zh: '在由本库启动的 Worker 中 resolve 为 `true`；它不会为外部 Worker 授权。'
      },
      example: example1,
      avoid: [
        {
          en: 'Self spawn is unsupported in browsers, Electron, REPL/eval sessions, bundled executables and entries controlled by a test runner; use an explicit built Worker URL.',
          zh: '浏览器、Electron、交互或求值入口、打包二进制及由测试运行器持有的入口不支持同文件自启动；应使用明确的已构建工作线程 URL。'
        }
      ]
    },
    RPC_THREAD_ERROR_SOURCE: {
      role: 'constant',
      purpose: {
        en: 'Stable rpc.transport.thread source declared by @migaia/rpc-contract/error-code and re-exported here. Other RPC/native families retain their own source and code.',
        zh: '由契约包错误码入口声明并在此重导出的稳定来源 rpc.transport.thread；其他远程调用及原生家族保留自身来源与错误码。'
      },
      example: {
        en: example1,
        zh: example1
      }
    },
    RpcThreadErrorCode: {
      role: 'constant',
      purpose: {
        en: 'Error codes owned by this package; currently only `THREAD_USAGE_SAMPLE_FAILED`.',
        zh: '本包自有的错误码对照表；目前只有资源采样失败 `THREAD_USAGE_SAMPLE_FAILED` 一项。'
      },
      example: {
        en: example1,
        zh: example1
      }
    },
    threadPlugin: {
      role: 'enhancer',
      purpose: {
        en: 'One cold native transport using original bootstrap, supervision, drain and native exit owners. Both sides provide methods over the same actual host endpoint.',
        zh: '一个使用原启动、监督、排空和原生退出所有者的冷传输，双方在同一实际宿主端点提供方法。'
      },
      options: 'IThreadPluginOptions',
      returns: {
        en: 'Cold SDK transport definition. Installation publishes host.thread calls and actual native extensions; construction alone acquires no resource.',
        zh: '返回冷 SDK 传输定义；安装后发布对应命名空间调用及实际原生扩展，仅构造定义不会获取资源。'
      },
      example: example1
    }
  },
  types: {
    IRpcThreadErrorCode: {
      summary: {
        en: 'Union of `RpcThreadErrorCode` values.',
        zh: '`RpcThreadErrorCode` 全部取值组成的联合类型。'
      },
      members: {}
    },
    IThreadCommonOptions: {
      summary: {
        en: 'Cold native registration and scope; Host owns identity, providers and protocol execution.',
        zh: '冷原生登记及作用域；身份、提供方及协议执行归宿主。'
      },
      members: {
        name: {
          summary: {
            en: 'Local native registration name, separate from accepted remote identity.',
            zh: '本地原生登记名称，与已接纳的远端身份分开。'
          },
          default: {
            en: 'Omitted: the native registration default.',
            zh: '省略时使用原生登记默认名称。'
          },
          example: workerScopeExample
        },
        namespace: {
          summary: {
            en: 'Unique Host property exposing this transport calls and extensions.',
            zh: '宿主发布此传输调用及扩展的唯一属性名。'
          },
          default: {
            en: 'Omitted: the factory namespace.',
            zh: '省略时使用工厂默认命名空间。'
          },
          example: workerScopeExample
        },
        expose: {
          summary: {
            en: 'Feature output paths selected on an ordinary PluginHost; createRpcHost uses its own provide catalog.',
            zh: '普通插件宿主选取的功能输出路径；远程调用宿主使用自身提供方目录。'
          },
          default: {
            en: 'Omitted: no ordinary Feature output selected.',
            zh: '省略时不选取普通功能输出。'
          },
          example: workerExposureExample
        },
        report: {
          summary: {
            en: 'Receives native background and cleanup failures; operation rejections retain original causes.',
            zh: '接收原生后台及清理失败；操作拒绝保留原始原因。'
          },
          default: {
            en: 'Omitted: configured Host reporter, then effective default.',
            zh: '省略时使用宿主显式报告器，再使用有效默认报告器。'
          },
          params: {
            error: {
              en: 'Original background or cleanup failure supplied by the native owner; preserve the error and its cause when sending it to monitoring.',
              zh: '原生所有者提供的原始后台或清理失败；交给监控时应保留错误对象及其原因链。'
            }
          },
          returns: {
            en: 'No return value is required. The callback reports the failure; it does not settle an application request or own native cleanup.',
            zh: '无需返回值；回调负责报告失败，不结算应用请求，也不取得原生清理所有权。'
          },
          whenToUse: {
            en: 'Set an application monitoring sink when Worker background and cleanup failures must join your existing incident reports. Omit it to inherit the configured Host reporter.',
            zh: '需要将原生后台及清理失败汇入应用现有告警时配置；省略则继承宿主显式报告器。'
          },
          example: workerReportExample
        },
        features: {
          summary: {
            en: 'Complete call and supported native feature definitions scoped to this transport. Per-call timeout and retry take instances or false.',
            zh: '此传输作用域的完整调用及受支持原生功能定义；逐次调用的超时和重试使用完整实例或关闭值。'
          },
          default: {
            en: 'Omitted: no optional policy installed by this field.',
            zh: '省略时不通过此字段安装可选策略。'
          },
          example: example2
        }
      },
      example: example1
    },
    IThreadPluginOptions: {
      summary: {
        en: 'Exactly one source plus shared options; invalid or conflicting sources reject before native acquisition.',
        zh: '一个来源加上共用选项，非法或冲突来源在获取原生资源前拒绝。'
      },
      example: example1,
      members: {
        name: {
          summary: {
            en: 'Local native registration name, separate from accepted remote identity.',
            zh: '本地原生登记名称，与已接纳的远端身份分开。'
          },
          default: {
            en: 'Omitted: the native registration default.',
            zh: '省略时使用原生登记默认名称。'
          },
          example: workerScopeExample
        },
        namespace: {
          summary: {
            en: 'Unique Host property exposing this transport calls and extensions.',
            zh: '宿主发布此传输调用及扩展的唯一属性名。'
          },
          default: {
            en: 'Omitted: the factory namespace.',
            zh: '省略时使用工厂默认命名空间。'
          },
          example: workerScopeExample
        },
        expose: {
          summary: {
            en: 'Feature output paths selected on an ordinary PluginHost; createRpcHost uses its own provide catalog.',
            zh: '普通插件宿主选取的功能输出路径；远程调用宿主使用自身提供方目录。'
          },
          default: {
            en: 'Omitted: no ordinary Feature output selected.',
            zh: '省略时不选取普通功能输出。'
          },
          example: workerExposureExample
        },
        report: {
          summary: {
            en: 'Receives native background and cleanup failures; operation rejections retain original causes.',
            zh: '接收原生后台及清理失败；操作拒绝保留原始原因。'
          },
          default: {
            en: 'Omitted: configured Host reporter, then effective default.',
            zh: '省略时使用宿主显式报告器，再使用有效默认报告器。'
          },
          params: {
            error: {
              en: 'Original background or cleanup failure supplied by the native owner; preserve the error and its cause when sending it to monitoring.',
              zh: '原生所有者提供的原始后台或清理失败；交给监控时应保留错误对象及其原因链。'
            }
          },
          returns: {
            en: 'No return value is required. The callback reports the failure; it does not settle an application request or own native cleanup.',
            zh: '无需返回值；回调负责报告失败，不结算应用请求，也不取得原生清理所有权。'
          },
          whenToUse: {
            en: 'Set an application monitoring sink when Worker background and cleanup failures must join your existing incident reports. Omit it to inherit the configured Host reporter.',
            zh: '需要将原生后台及清理失败汇入应用现有告警时配置；省略则继承宿主显式报告器。'
          },
          example: workerReportExample
        },
        features: {
          summary: {
            en: 'Complete call and supported native feature definitions scoped to this transport. Per-call timeout and retry take instances or false.',
            zh: '此传输作用域的完整调用及受支持原生功能定义；逐次调用的超时和重试使用完整实例或关闭值。'
          },
          default: {
            en: 'Omitted: no optional policy installed by this field.',
            zh: '省略时不通过此字段安装可选策略。'
          },
          example: example2
        },
        spawn: {
          summary: {
            en: 'Current entry, explicit entry, short options, or original full native source. No complete callable object is a raw source.',
            zh: '当前入口、显式入口、简写选项或原完整原生来源，完整调用对象不能充当原始来源。'
          },
          default: {
            en: 'Absent in parent/connect/listen modes.',
            zh: '子端、连接或监听模式不提供。'
          },
          example: example1
        },
        connectToParent: {
          summary: {
            en: 'true only in the genuine native child, using actual first-frame authority.',
            zh: '仅在真实原生子端取真值，使用实际首帧权限。'
          },
          default: {
            en: 'Absent outside parent connection mode.',
            zh: '非连接父端模式不提供。'
          },
          example: example1,
          values: {
            true: {
              en: 'Adopt the actual parent bootstrap source.',
              zh: '采用实际父端启动来源。'
            }
          },
          whenToUse: {
            en: 'Choose this only inside the genuine Worker launched by threadPlugin; the native bootstrap supplies the parent identity and channel. Use spawn in the parent.',
            zh: '仅在由 `threadPlugin` 启动的真实工作线程中选择，原生启动信息提供父端身份及通道；父端使用 `spawn`。'
          }
        }
      }
    },
    IThreadSpawnSource: {
      summary: {
        en: 'Actual explicit plugin source union; short forms normalize through the original native owner.',
        zh: '插件的实际显式来源联合，简写通过原原生所有者归一化。'
      },
      example: example1,
      members: {
        report: {
          summary: {
            en: 'Report original native background and cleanup failures through the application diagnostic sink.',
            zh: '通过应用诊断接收器报告原生后台及清理失败，不改变原错误身份。'
          },
          params: {
            error: {
              en: 'Original background or cleanup failure supplied by the native owner; preserve the error and its cause when sending it to monitoring.',
              zh: '原生所有者提供的原始后台或清理失败；交给监控时应保留错误对象及其原因链。'
            }
          },
          returns: {
            en: 'No return value is required. The callback reports the failure; it does not settle an application request or own native cleanup.',
            zh: '无需返回值；回调负责报告失败，不结算应用请求，也不取得原生清理所有权。'
          },
          whenToUse: {
            en: 'Set an application monitoring sink when Worker background and cleanup failures must join your existing incident reports. Omit it to inherit the configured Host reporter.',
            zh: '需要将原生后台及清理失败汇入应用现有告警时配置；省略则继承宿主显式报告器。'
          },
          example: workerReportExample
        }
      }
    },
    IThreadNamespaceExtensions: {
      summary: {
        en: 'Native controls contributed by this actual source installation.',
        zh: '此实际来源安装提供的原生控制。'
      },
      members: {
        members: {
          summary: {
            en: 'SDK member controls borrow the original source supervisor and generation.',
            zh: 'SDK 成员控制借用原来源监督器及代次。'
          }
        }
      },
      example: example1
    },
    IThreadSpawn: {
      summary: {
        en: 'Full native source recipe; original launcher, budget, scheduler and carrier factory remain the owners.',
        zh: '完整原生来源配方；原启动器、预算、调度器及载体工厂保持所有权。'
      },
      members: {
        spec: {
          summary: {
            en: 'Native thread name, portable data and resource limits passed to supervision.',
            zh: '转交监督器的原生线程名称、可移植数据及资源限制。'
          }
        },
        launcher: {
          summary: {
            en: 'Actual supervision launcher preserving its original launch context and native exit receipt.',
            zh: '实际监督启动器，保留原启动上下文及原生退出凭据。'
          }
        },
        budget: {
          summary: {
            en: 'Original supervision budget for native acquisition and retained execution.',
            zh: '原生获取及持有执行使用的原监督预算。'
          }
        },
        scheduler: {
          summary: {
            en: 'Scheduler borrowed by the selected native supervision profile.',
            zh: '所选原生监督策略借用的调度器。'
          }
        },
        channelFactory: {
          summary: {
            en: 'Open a real carrier from the native handle and signal; Host alone creates Sessions.',
            zh: '从原生句柄及信号打开真实载体；仅宿主创建会话。'
          }
        },
        report: {
          summary: {
            en: 'Receives native background and cleanup failures; operation rejections retain original causes.',
            zh: '接收原生后台及清理失败；操作拒绝保留原始原因。'
          },
          default: {
            en: 'Omitted: configured Host reporter, then effective default.',
            zh: '省略时使用宿主显式报告器，再使用有效默认报告器。'
          },
          params: {
            error: {
              en: 'Original background or cleanup failure supplied by the native owner; preserve the error and its cause when sending it to monitoring.',
              zh: '原生所有者提供的原始后台或清理失败；交给监控时应保留错误对象及其原因链。'
            }
          },
          returns: {
            en: 'No return value is required. The callback reports the failure; it does not settle an application request or own native cleanup.',
            zh: '无需返回值；回调负责报告失败，不结算应用请求，也不取得原生清理所有权。'
          },
          whenToUse: {
            en: 'Set an application monitoring sink when Worker background and cleanup failures must join your existing incident reports. Omit it to inherit the configured Host reporter.',
            zh: '需要将原生后台及清理失败汇入应用现有告警时配置；省略则继承宿主显式报告器。'
          },
          example: workerReportExample
        },
        health: {
          summary: {
            en: 'Optional native supervision health policy using the accepted Session ping.',
            zh: '使用已接纳会话探活的可选原生监督健康策略。'
          }
        },
        supervisor: {
          summary: {
            en: 'Original id, readiness, startup, restart, terminal, stop and isolation overrides.',
            zh: '原监督标识、就绪、启动、重启、终态、停止及隔离策略覆盖。'
          }
        }
      },
      example: example1
    },
    IThreadShortSpawn: {
      summary: {
        en: 'Entry shorthand supplies only missing native source fields and preserves explicitly supplied policy objects.',
        zh: '入口简写仅补齐缺失的原生来源字段，并保留显式提供的策略对象。'
      },
      members: {
        launcher: {
          summary: {
            en: 'Actual supervision launcher preserving its original launch context and native exit receipt.',
            zh: '实际监督启动器，保留原启动上下文及原生退出凭据。'
          }
        },
        budget: {
          summary: {
            en: 'Original supervision budget for native acquisition and retained execution.',
            zh: '原生获取及持有执行使用的原监督预算。'
          }
        },
        scheduler: {
          summary: {
            en: 'Scheduler borrowed by the selected native supervision profile.',
            zh: '所选原生监督策略借用的调度器。'
          }
        },
        channelFactory: {
          summary: {
            en: 'Open a real carrier from the native handle and signal; Host alone creates Sessions.',
            zh: '从原生句柄及信号打开真实载体；仅宿主创建会话。'
          }
        },
        report: {
          summary: {
            en: 'Receives native background and cleanup failures; operation rejections retain original causes.',
            zh: '接收原生后台及清理失败；操作拒绝保留原始原因。'
          },
          default: {
            en: 'Omitted: configured Host reporter, then effective default.',
            zh: '省略时使用宿主显式报告器，再使用有效默认报告器。'
          },
          params: {
            error: {
              en: 'Original background or cleanup failure supplied by the native owner; preserve the error and its cause when sending it to monitoring.',
              zh: '原生所有者提供的原始后台或清理失败；交给监控时应保留错误对象及其原因链。'
            }
          },
          returns: {
            en: 'No return value is required. The callback reports the failure; it does not settle an application request or own native cleanup.',
            zh: '无需返回值；回调负责报告失败，不结算应用请求，也不取得原生清理所有权。'
          },
          whenToUse: {
            en: 'Set an application monitoring sink when Worker background and cleanup failures must join your existing incident reports. Omit it to inherit the configured Host reporter.',
            zh: '需要将原生后台及清理失败汇入应用现有告警时配置；省略则继承宿主显式报告器。'
          },
          example: workerReportExample
        },
        health: {
          summary: {
            en: 'Optional native supervision health policy using the accepted Session ping.',
            zh: '使用已接纳会话探活的可选原生监督健康策略。'
          }
        },
        supervisor: {
          summary: {
            en: 'Original id, readiness, startup, restart, terminal, stop and isolation overrides.',
            zh: '原监督标识、就绪、启动、重启、终态、停止及隔离策略覆盖。'
          }
        },
        entry: {
          summary: {
            en: 'Actual Worker entry URL/path or true for a supported main module.',
            zh: '实际工作线程入口地址、路径或受支持主模块选择值。'
          }
        },
        base: {
          summary: {
            en: 'Base for resolving a relative entry.',
            zh: '解析相对入口时使用的基准地址。'
          }
        },
        name: {
          summary: {
            en: 'Native specification name, distinct from the top-level registration name.',
            zh: '原生规范名称，与顶层登记名称分开。'
          }
        },
        data: {
          summary: {
            en: 'Portable application input captured before native acquisition.',
            zh: '原生获取前捕获的可移植应用输入。'
          }
        },
        limits: {
          summary: {
            en: 'Native supervision limits for this execution unit.',
            zh: '此执行单元使用的原生监督限制。'
          }
        }
      },
      example: example1
    }
  },
  enums: {
    RpcThreadErrorCode: {
      summary: {
        en: 'Error codes owned by `@migaia/rpc-plugin-thread`.',
        zh: '`@migaia/rpc-plugin-thread` 自有的错误码及其含义。'
      },
      values: {
        usageSampleFailed: {
          en: '`THREAD_USAGE_SAMPLE_FAILED`: sampling Worker CPU or memory failed; show the value as unavailable, the Worker keeps running.',
          zh: '`THREAD_USAGE_SAMPLE_FAILED`：采样 Worker 的 CPU 或内存失败；把该值显示为不可用即可，Worker 继续运行。'
        }
      }
    }
  },
  enhancers: {
    threadPlugin: {
      kind: 'transport',
      target: 'IRpcHost / PluginHost',
      summary: {
        en: 'One cold native transport using original bootstrap, supervision, drain and native exit owners. Both sides provide methods over the same actual host endpoint.',
        zh: '一个使用原启动、监督、排空和原生退出所有者的冷传输，双方在同一实际宿主端点提供方法。'
      },
      install: example1,
      grants: [
        {
          signature: 'host.thread.members',
          summary: {
            en: 'Borrow the actual native source member controls from this namespace.',
            zh: '从此命名空间借用实际原生来源的成员控制。'
          },
          params: {},
          returns: {
            en: 'SDK native controls for real stop, restart, replacement, events and resource queries.',
            zh: '返回用于真实停止、重启、替换、事件及资源查询的 SDK 原生控制。'
          },
          example: example2
        }
      ],
      behaviors: [
        {
          en: 'Original source ownership retains native control, generation, replacement and cleanup.',
          zh: '原来源所有权保留原生控制、代次、替换和清理。'
        }
      ],
      scenarios: [
        {
          en: 'Use the actual native runtime selected by the application.',
          zh: '使用应用选定的实际原生运行时。'
        }
      ],
      example: example1
    }
  }
}
