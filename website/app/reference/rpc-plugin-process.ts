/** Bilingual public boundary and original ownership contracts. */
import { rpcApiGuides } from '../rpc-api-guides.js'
import { rpcPluginOptionDocs } from './rpc-runtime-shared.js'
import type { ILibraryReference, IMemberDoc } from './contract.js'

/** Launch defaults share the same authored fields across shorthand and plugin option surfaces. */
const processSpawnOptionDocs: Readonly<Record<string, IMemberDoc>> = {
  base: {
    summary: {
      en: 'Module URL used to resolve a relative `entry`.',
      zh: '解析相对 `entry` 时使用的模块 URL。'
    }
  },
  command: {
    summary: {
      en: 'Executable to run instead of `entry`, e.g. `python3`.',
      zh: '代替 `entry` 运行的可执行程序，例如 `python3`。'
    }
  },
  args: {
    summary: {
      en: 'Arguments of `command`, or extra arguments.',
      zh: '`command` 的参数，或额外的命令行参数。'
    }
  },
  cwd: {
    summary: {
      en: 'Working-directory path passed to the native child launcher; controls child-process relative paths without changing the local module-resolution base.',
      zh: '传给原生启动器的子进程工作目录路径，影响子进程的相对路径解析，不改变本端模块的解析基准。'
    }
  },
  env: {
    summary: {
      en: '`{ inherit, set }`: variable names to inherit and values to set.',
      zh: '`{ inherit, set }`：要继承的变量名与要设置的值。'
    }
  },
  wrap: {
    summary: {
      en: 'Rewrites the computed launch command (e.g. to run inside `sandbox-exec` or `bwrap`) on every launch, restart and replace. Must keep stdin/stdout and environment, and forward the exit code.',
      zh: '在每次启动、重启与替换时改写计算出的启动命令（例如放进 `sandbox-exec` 或 `bwrap`）。必须保留 stdin/stdout 与环境变量，并转发退出码。'
    }
  },
  stdio: {
    summary: {
      en: 'stdio routing; default `{ stdin: "channel", stdout: "channel", stderr: "drain" }`.',
      zh: '子进程标准输入输出的走向；默认 `{ stdin: "channel", stdout: "channel", stderr: "drain" }`。'
    }
  },
  limits: {
    summary: {
      en: 'Limits such as `callWallTimeMs` per call.',
      zh: '资源限制，例如单次调用的 `callWallTimeMs`。'
    }
  },
  permissions: {
    summary: {
      en: 'Runtime permissions (Deno).',
      zh: '子进程的运行时权限设置（用于 Deno）。'
    }
  },
  wire: {
    summary: {
      en: '`native` (default) or `jsonrpc` for other languages.',
      zh: '`native`（默认）或用于其它语言的 `jsonrpc`。'
    },
    values: {
      enum: 'ProcessPluginWire'
    }
  },
  contract: {
    summary: {
      en: 'Local declaration of the remote methods (required for `jsonrpc`).',
      zh: '对端方法的本地声明（`jsonrpc` 时必填）。'
    }
  },
  token: {
    summary: {
      en: 'Session secret; shorthand generates it once when the source is normalized and reuses it across supervised generations. A restart does not rotate it.',
      zh: '会话密钥；简写来源规范化时随机生成一次，由监督代次复用，重启不会轮换。'
    }
  },
  offer: {
    summary: {
      en: 'Optional local native handshake proposal for protocol versions, codecs and capabilities; only the actual two-sided exchange establishes the accepted agreement.',
      zh: '可选的本地原生握手提议，声明希望协商的协议、编解码器及能力，实际接纳结果由双方交换确定。'
    }
  },
  establish: {
    summary: {
      en: 'Optional asynchronous handshake step receiving the raw byte or message channel and generation preparation options; authenticates and returns one ready remote channel.',
      zh: '可选的异步握手步骤，接收原始字节或消息通道及当代准备选项，完成认证后返回就绪远端通道。'
    }
  },
  supervision: {
    summary: {
      en: 'Overrides the original supervisor restart, startup, stop and other policies; retains the same execution-unit owner without installing another supervisor.',
      zh: '覆盖原监督器的重启、启动与停止预算等策略，继续使用同一执行单元所有者，不额外创建监督器。'
    }
  },
  onNotice: {
    summary: {
      en: 'Receives expected launcher notices, such as the best-effort termination warning, instead of `report`.',
      zh: '代替 `report` 接收预期的 launcher 提示，例如尽力终止的警告。'
    },
    params: {
      notice: {
        en: 'The notice, usually `CAPABILITY_UNSUPPORTED` for `termination`.',
        zh: '提示内容，通常是关于 `termination` 的 `CAPABILITY_UNSUPPORTED`。'
      }
    },
    returns: {
      en: 'Nothing; the notice is handled.',
      zh: '无返回值；提示已处理。'
    }
  },

  'stdio.stdin': {
    summary: {
      en: 'Route child input through the RPC channel or ignore it. Native stdio and bootstrap ownership remain with the process launcher.',
      zh: '将子进程输入接入 RPC 通道或忽略，由进程启动器保留标准输入及启动帧归属。'
    },
    default: {
      en: '`channel`: retain the channel input.',
      zh: '`channel`：保留通道输入。'
    },
    values: {
      channel: {
        en: 'Use child stdin for the channel and bootstrap.',
        zh: '将子进程标准输入用于通道及启动帧。'
      },
      ignore: {
        en: 'Ignore child stdin; do not select it for a stdin-based channel.',
        zh: '忽略子进程标准输入，不可再将其选为标准输入通道。'
      }
    }
  },
  'stdio.stdout': {
    summary: {
      en: 'Select channel output, continuously drained output, or ignored output without changing the launcher owner.',
      zh: '选择通道输出、持续排空输出或忽略输出，不改变启动器归属。'
    },
    default: {
      en: '`channel`: expose stdout as the RPC byte channel.',
      zh: '`channel`：将标准输出作为 RPC 字节通道。'
    },
    values: {
      channel: {
        en: 'Reserve stdout for the byte channel.',
        zh: '将标准输出留给字节通道。'
      },
      drain: {
        en: 'Continuously consume stdout through the launcher output sink.',
        zh: '由启动器输出接收器持续消费标准输出。'
      },
      ignore: {
        en: 'Discard stdout instead of exposing a channel.',
        zh: '丢弃标准输出，不向外提供通道。'
      }
    }
  },
  'stdio.stderr': {
    summary: {
      en: 'Choose whether the native launcher drains or ignores child stderr; stderr is never the RPC response channel.',
      zh: '选择由原生启动器排空或忽略子进程标准错误，标准错误不会作为 RPC 响应通道。'
    },
    default: {
      en: '`drain`: consume stderr from process startup.',
      zh: '`drain`：从进程启动起持续消费标准错误。'
    },
    values: {
      drain: {
        en: 'Drain stderr through the existing output sink.',
        zh: '经既有输出接收器排空标准错误。'
      },
      ignore: {
        en: 'Discard stderr without adding a reader.',
        zh: '丢弃标准错误，不增加读取器。'
      }
    }
  },
  'limits.memoryBytes': {
    summary: {
      en: 'Requested process memory limit in bytes, forwarded to the original supervisor and native launcher; unsupported enforcement follows the isolation policy.',
      zh: '请求的进程内存上限，单位为字节，转交原监督器及原生启动器；不支持的强制限制沿用隔离策略。'
    },
    default: {
      en: 'Omitted: no explicit memory limit is requested.',
      zh: '省略时不请求显式内存上限。'
    }
  },
  'limits.cpuTimeMs': {
    summary: {
      en: 'Requested process CPU time limit in milliseconds; native enforcement depends on the chosen launcher capability and isolation policy.',
      zh: '请求的进程 CPU 时间上限，单位为毫秒，能否原生强制执行取决于所选启动器能力及隔离策略。'
    },
    default: {
      en: 'Omitted: no explicit CPU time limit is requested.',
      zh: '省略时不请求显式 CPU 时间上限。'
    }
  },
  'limits.callWallTimeMs': {
    summary: {
      en: 'Wall-clock cap for a call, consumed by the existing RPC caller rather than enforced as an operating-system process limit.',
      zh: '单次调用的墙钟时间上限，由既有 RPC 调用方消费，不作为操作系统进程限制强制执行。'
    },
    default: {
      en: 'Omitted: no additional call wall-time cap is requested.',
      zh: '省略时不增加调用墙钟时间上限。'
    }
  }
}

/** Authored public reference; author primitives retain their actual parameter and resource owners. */
export const rpcProcessReference: ILibraryReference = {
  modules: {
    index: {
      summary: {
        en: 'One cold native transport using original bootstrap, supervision, drain and native exit owners. Both sides provide methods over the same actual host endpoint. Child self/generation comes from genuine stdin bootstrap; native dial and handshake budgets remain separate.',
        zh: '一个使用原启动、监督、排空和原生退出所有者的冷传输，双方在同一实际宿主端点提供方法。子端身份及代次来自真实标准输入启动帧，原生拨号和握手预算分开。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
    },

    features: {
      summary: {
        en: 'Configure original per-connection queue/log owners with exact installed feature objects.',
        zh: '以精确安装功能对象配置原逐连接队列和日志所有者。'
      },
      example:
        "import { sendQueueFeature, ipcLogFeature } from '@migaia/rpc-plugin-process/features'\nimport timeoutFeature from '@migaia/rpc-host/features/timeout'\n\nexport const features = [\n  sendQueueFeature({ maxPendingData: 32, maxPendingControl: 8 }),\n  ipcLogFeature({\n    report: (record) => {\n      console.log(record)\n    }\n  }),\n  timeoutFeature({ ms: 1500 })\n]"
    },
    'features/send-queue': {
      summary: {
        en: 'Set independent data/control capacities without adding a second gate.',
        zh: '设置独立数据和控制容量，不添加第二个准入控制。'
      },
      example:
        "import { sendQueueFeature, ipcLogFeature } from '@migaia/rpc-plugin-process/features'\nimport timeoutFeature from '@migaia/rpc-host/features/timeout'\n\nexport const features = [\n  sendQueueFeature({ maxPendingData: 32, maxPendingControl: 8 }),\n  ipcLogFeature({\n    report: (record) => {\n      console.log(record)\n    }\n  }),\n  timeoutFeature({ ms: 1500 })\n]"
    },
    'features/log': {
      summary: {
        en: 'Supply the original IPC log owner with an application diagnostic sink.',
        zh: '向原进程通信日志所有者提供应用诊断接收器。'
      },
      example:
        "import { sendQueueFeature, ipcLogFeature } from '@migaia/rpc-plugin-process/features'\nimport timeoutFeature from '@migaia/rpc-host/features/timeout'\n\nexport const features = [\n  sendQueueFeature({ maxPendingData: 32, maxPendingControl: 8 }),\n  ipcLogFeature({\n    report: (record) => {\n      console.log(record)\n    }\n  }),\n  timeoutFeature({ ms: 1500 })\n]"
    },
    'features/flow-control': {
      summary: {
        en: 'Original lane/event constants and types only, with no extra flow-control plugin factory.',
        zh: '仅含原队列类别、事件常量和类型，没有额外流控插件工厂。'
      },
      example:
        "import { sendQueueFeature, ipcLogFeature } from '@migaia/rpc-plugin-process/features'\nimport timeoutFeature from '@migaia/rpc-host/features/timeout'\n\nexport const features = [\n  sendQueueFeature({ maxPendingData: 32, maxPendingControl: 8 }),\n  ipcLogFeature({\n    report: (record) => {\n      console.log(record)\n    }\n  }),\n  timeoutFeature({ ms: 1500 })\n]"
    }
  },
  symbols: {
    isProcessChild: {
      role: 'operation',
      purpose: {
        en: 'Tells whether this entry was started by a library launcher, so one file can branch for `spawn: true`. It grants no trust; authentication still happens in the handshake.',
        zh: '判断当前入口是否由本库 launcher 启动，使同一个文件可以在 `spawn: true` 时分支。它不授予信任，认证仍在握手中完成。'
      },
      returns: {
        en: '`true` in a library-launched child.',
        zh: '在由本库启动的子进程中返回 `true`。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
    },
    RPC_PROCESS_ERROR_SOURCE: {
      role: 'constant',
      purpose: {
        en: 'The `source` value (`@migaia/rpc/process`) of errors owned by this package; call errors come from `@migaia/rpc/core`.',
        zh: '本包自有错误的 `source` 值（`@migaia/rpc/process`）；超时、取消等调用层错误来自 `@migaia/rpc/core`。'
      },
      example: {
        en: "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}",
        zh: "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
      }
    },
    RpcProcessErrorCode: {
      role: 'constant',
      purpose: {
        en: 'Table of the stable error codes of this package; values are the strings on `error.code`.',
        zh: '本包稳定错误码的对照表；值就是错误对象 `error.code` 上的字符串。'
      },
      example: {
        en: "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}",
        zh: "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
      }
    },

    processPlugin: {
      role: 'enhancer',
      purpose: {
        en: 'One cold native transport using original bootstrap, supervision, drain and native exit owners. Both sides provide methods over the same actual host endpoint.',
        zh: '一个使用原启动、监督、排空和原生退出所有者的冷传输，双方在同一实际宿主端点提供方法。'
      },
      options: 'IProcessPluginOptions',
      returns: {
        en: 'Exact registered transport definition for createRpcHost.plugins or ordinary PluginHost.use; acquisition begins only on installation.',
        zh: '返回供统一宿主或普通插件宿主安装的精确登记传输定义，仅安装时开始获取资源。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
    },
    sendQueueFeature: {
      role: 'enhancer',
      purpose: {
        en: "Set the existing process IPC sender's data and control capacities; each omitted capacity retains its transport configuration.",
        zh: '配置既有进程 IPC 发送器的数据与控制队列容量，仅覆盖显式给出的容量，并保留省略字段的传输配置。'
      },
      options: 'ISendQueueFeatureOptions',
      returns: {
        en: 'Actual feature consumed by process preparation through exact registered identity.',
        zh: '返回由进程准备经精确登记身份消费的真实功能。'
      },
      example:
        "import { sendQueueFeature, ipcLogFeature } from '@migaia/rpc-plugin-process/features'\nimport timeoutFeature from '@migaia/rpc-host/features/timeout'\n\nexport const features = [\n  sendQueueFeature({ maxPendingData: 32, maxPendingControl: 8 }),\n  ipcLogFeature({\n    report: (record) => {\n      console.log(record)\n    }\n  }),\n  timeoutFeature({ ms: 1500 })\n]"
    },
    ipcLogFeature: {
      role: 'enhancer',
      purpose: {
        en: 'Send existing IPC connection records to the supplied report callback while leaving native I/O and subscription ownership with the connection.',
        zh: '将既有 IPC 连接日志交给指定报告回调，连接仍统一持有原生输入输出与订阅，不额外建立日志监听。'
      },
      options: 'IIpcLogFeatureOptions',
      returns: {
        en: 'Actual feature consumed by process preparation through exact registered identity.',
        zh: '返回由进程准备经精确登记身份消费的真实功能。'
      },
      example:
        "import { sendQueueFeature, ipcLogFeature } from '@migaia/rpc-plugin-process/features'\nimport timeoutFeature from '@migaia/rpc-host/features/timeout'\n\nexport const features = [\n  sendQueueFeature({ maxPendingData: 32, maxPendingControl: 8 }),\n  ipcLogFeature({\n    report: (record) => {\n      console.log(record)\n    }\n  }),\n  timeoutFeature({ ms: 1500 })\n]"
    },
    IpcSendClass: {
      example: {
        en: rpcApiGuides['rpc-plugin-process:features-flow-control:IpcSendClass'].en.quickStart!,
        zh: rpcApiGuides['rpc-plugin-process:features-flow-control:IpcSendClass'].zh.quickStart!
      },
      role: 'constant',
      purpose: {
        en: 'Separate whole-envelope admission lanes retain control capacity when application data is saturated. Lane choice belongs to the existing connection sender. Import from `@migaia/rpc-plugin-process/features/flow-control`.',
        zh: '完整消息的独立准入队列在业务数据饱和时保留控制容量，队列选择归既有连接发送器。从 `@migaia/rpc-plugin-process/features/flow-control` 导入。'
      }
    },
    IpcLogEventName: {
      example: {
        en: rpcApiGuides['rpc-plugin-process:features-flow-control:IpcLogEventName'].en.quickStart!,
        zh: rpcApiGuides['rpc-plugin-process:features-flow-control:IpcLogEventName'].zh.quickStart!
      },
      role: 'constant',
      purpose: {
        en: 'Local connection gate/log diagnostic names, not RPC wire messages or remote execution acknowledgements. The original owner issues these records. Import from `@migaia/rpc-plugin-process/features/flow-control`.',
        zh: '本地连接准入及日志诊断名称，不是协议消息或远端执行确认，记录由原所有者签发。从 `@migaia/rpc-plugin-process/features/flow-control` 导入。'
      }
    }
  },
  types: {
    IProcessShortSourceOptions: {
      summary: {
        en: 'Short-source credentials shared by peer and plugin options.',
        zh: 'Peer 与插件选项共用的简写来源凭据。'
      },
      members: {
        token: {
          summary: {
            en: 'Shared secret for the handshake.',
            zh: '握手时使用的共享密钥。'
          }
        },
        verify: {
          summary: {
            en: 'Listener credential check returning a principal id.',
            zh: '监听端校验凭据并返回主体 id 的函数。'
          }
        },
        connectTimeoutMs: {
          summary: {
            en: 'Wait for a named listener; default 5000.',
            zh: '等待命名监听方出现的时间，默认 5000 毫秒。'
          }
        }
      }
    },
    IProcessShortSpawn: {
      summary: {
        en: 'Short `spawn` object expanded into a full source with defaults.',
        zh: '会用默认值展开为完整来源的简写 `spawn` 对象。'
      },
      example: {
        en: "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}",
        zh: "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
      },
      members: {
        entry: {
          summary: {
            en: 'Module to run with the current runtime (URL or path).',
            zh: '用当前运行时执行的模块（URL 或路径）。'
          }
        },
        ...processSpawnOptionDocs
      }
    },
    IProcessLaunchCommand: {
      summary: {
        en: 'Launch command passed to and returned by `wrap`.',
        zh: '传给 `wrap` 并由其返回的启动命令。'
      },
      members: {
        command: {
          summary: {
            en: 'Executable path or name.',
            zh: '可执行程序的路径或名称。'
          }
        },
        args: {
          summary: {
            en: 'Command-line arguments in order.',
            zh: '按顺序排列的命令行参数。'
          }
        },
        cwd: {
          summary: {
            en: 'Working directory, when set.',
            zh: '工作目录（设置了时才有）。'
          }
        },
        env: {
          summary: {
            en: '`{ inherit, set }` environment.',
            zh: '环境变量设置 `{ inherit, set }`：继承与新设的变量。'
          }
        }
      }
    },
    IProcessPluginOptions: {
      summary: {
        en: 'Exactly one source plus shared options; invalid or conflicting sources reject before native acquisition.',
        zh: '一个来源加上共用选项，非法或冲突来源在获取原生资源前拒绝。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}",
      members: {
        ...processSpawnOptionDocs,
        ipc: {
          summary: {
            en: 'Configure the original per-connection pending-data/control limits and log sink. Explicit process features override only their matching IPC fields.',
            zh: '配置原逐连接数据、控制等待上限和日志接收器；显式进程功能仅覆盖对应的 IPC 字段。'
          },
          default: {
            en: 'Omitted: keep the native IPC defaults unless an installed feature supplies that field.',
            zh: '省略时保留原生 IPC 默认值，除非已安装功能提供对应字段。'
          }
        },

        self: {
          summary: {
            en: 'Application-supplied safe identity with nonempty name and instanceId; neither credentials nor arbitrary properties are published.',
            zh: '应用提供的安全身份，含非空名称与实例标识，不会发布凭据或任意额外属性。'
          },
          default: {
            en: 'Omitted: the core uses RUNTIME_PEER_DEFAULT_NAME and a generated defaultRpcId; trusted platform bootstrap may supply its own identity.',
            zh: '省略时核心使用默认连接名称常量与自动生成的实例标识，可信平台启动数据也可提供自身身份。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}",
          whenToUse: {
            en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
            zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
          }
        },
        provide: {
          summary: {
            en: 'Application-provided local methods, descriptors or allowed runtime forwarding entries compiled into the accepted directory; methods receive the remote payload and preserve synchronous or async failures.',
            zh: '应用提供的本端方法、描述符或获准运行时转发条目，会编译为已接受目录；方法接收远端载荷，同步或异步失败均保留。'
          },
          default: {
            en: 'Omitted: this side publishes no application methods.',
            zh: '省略时本端不发布任何应用方法。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}",
          whenToUse: {
            en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
            zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
          }
        },
        providerLimits: {
          summary: {
            en: 'Provider admission policy forwarded to the canonical endpoint; it does not alter transport framing or acquire another provider registry.',
            zh: '转交规范端点的提供方接纳策略，不改变传输分帧，也不另建提供方登记表。'
          },
          default: {
            en: 'Omitted: the original endpoint or listener admission owner supplies its standard provider limits.',
            zh: '省略时由原端点或监听接纳拥有者提供标准提供方限制。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}",
          whenToUse: {
            en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
            zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
          }
        },
        authentication: {
          summary: {
            en: 'Original signing, verification and optional encryption configuration installed into canonical endpoint assembly; invalid credentials reject construction before publication.',
            zh: '安装到规范端点组装的原始签名、校验与可选加密配置，非法凭据会在发布前拒绝构造。'
          },
          default: {
            en: 'Omitted: no authentication middleware is added by these options.',
            zh: '省略时不通过本选项增加认证中间件。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}",
          whenToUse: {
            en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
            zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
          }
        },
        probe: {
          summary: {
            en: 'One IRpcProbe or an array of probes from the application, installed as endpoint-local synchronous observers without selecting a different pipeline.',
            zh: '应用提供的一个或多个 `IRpcProbe`，安装为端点本地同步观察者，不会据此选择另一套管线。'
          },
          default: {
            en: 'Omitted: no observer is added by this field.',
            zh: '省略时不通过此字段增加观察者。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}",
          whenToUse: {
            en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
            zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
          }
        },
        defaultTimeoutMs: {
          summary: {
            en: 'Finite positive millisecond default for request and stream calls, validated before acquiring source resources; it does not extend the notify or group timeout scope.',
            zh: '请求与流调用使用的有限正毫秒默认值，在取得来源资源前校验，不扩展通知或分组操作的超时作用域。'
          },
          default: {
            en: '30000 ms for request and stream in the original timeout scope.',
            zh: '默认三万毫秒，仅用于原有请求与流超时作用域。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}",
          whenToUse: {
            en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
            zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
          }
        },
        contract: {
          summary: {
            en: 'Optional IRemoteContract with explicit method schemas, supported modes and idempotency declarations, compiled by the original remote contract owner.',
            zh: '可选的 `IRemoteContract`，提供显式方法模式、支持的调用方式与幂等声明，由原远端契约拥有者编译。'
          },
          default: {
            en: 'Omitted: provided method definitions supply the normal inferred runtime directory.',
            zh: '省略时根据已提供的方法定义推导通常的运行时目录。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}",
          whenToUse: {
            en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
            zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
          }
        },
        report: {
          whenToUse: {
            en: 'Route native process and background diagnostics to the application sink without printing credentials.',
            zh: '需要把原生进程与后台诊断交给应用接收端时设置，避免输出凭据。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}",
          summary: {
            en: 'Receives background errors that no call can reject with.',
            zh: '接收无法通过调用 reject 的后台错误。'
          },
          params: {
            error: {
              en: 'Original background failure value; preserve its source and code when present.',
              zh: '原始后台失败值；存在来源与错误码时保留它们。'
            }
          },
          returns: {
            en: 'Nothing; the error is reported.',
            zh: '无返回值；错误已交给上报函数。'
          },
          default: {
            en: '`defaultRpcReporter`, which reports through the default console path.',
            zh: '`defaultRpcReporter`，使用默认控制台报告路径。'
          }
        },
        keyFactory: {
          summary: {
            en: 'Application key generator for automatically keyed idempotent requests on managed spawn/connect bindings. Function sources use direct Core Peer assembly and do not consume this proxy field.',
            zh: '受管理启动或连接绑定为幂等请求自动分配键时使用的应用工厂。函数来源走直接核心连接组装，不消费此代理字段。'
          },
          default: {
            en: 'Omitted: proxy paths use defaultRpcId when generating keys; direct peer call keys retain their own call-option semantics.',
            zh: '省略时代理生成键使用默认标识工厂，直接连接调用仍按自身调用选项处理幂等键。'
          },
          whenToUse: {
            en: 'Managed process spawn/connect consumes this policy for declared idempotent requests. A function source uses direct Core assembly and does not consume this proxy policy.',
            zh: '托管进程 spawn/connect 为声明为幂等的请求使用此策略；函数来源使用直接 Core 组装，不使用这项代理策略。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
        },
        retryPort: {
          summary: {
            en: 'Whole-invocation dispatch port for managed spawn/connect bindings. Function sources use direct Core Peer assembly and do not consume this field.',
            zh: '受管理启动或连接绑定的整次调用派发端口。函数来源走直接核心连接组装，不消费此字段。'
          },
          default: {
            en: 'Omitted: the remote proxy keeps its original retry dispatch owner; no second retry policy is installed by a direct peer.',
            zh: '省略时远程代理保留原重试派发拥有者，直接连接不会额外安装另一套重试策略。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}",
          whenToUse: {
            en: 'Managed process spawn/connect consumes this policy for declared idempotent requests. A function source uses direct Core assembly and does not consume this proxy policy.',
            zh: '托管进程 spawn/connect 为声明为幂等的请求使用此策略；函数来源使用直接 Core 组装，不使用这项代理策略。'
          }
        },
        token: {
          summary: {
            en: 'Shared secret checked in the handshake; required for TCP, explicit socket paths and Windows pipes. Generate it per deployment and never log it.',
            zh: '握手中校验的共享密钥；TCP、显式 socket 路径与 Windows 命名管道必须设置。每次部署生成，切勿写入日志。'
          },
          default: {
            en: 'Not set: named endpoints rely on OS user permissions.',
            zh: '不设置：命名端点依赖操作系统的用户权限。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}",
          whenToUse: {
            en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
            zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
          }
        },
        verify: {
          whenToUse: {
            en: 'Require an application principal for a listener rather than relying only on same-user socket permissions.',
            zh: '监听端需要应用主体身份，而不能仅依赖同用户套接字权限时设置。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}",
          summary: {
            en: 'Listener side: `(auth, peer) => principalId` validating the client credential; throw to reject.',
            zh: '监听端：校验客户端凭据的 `(auth, peer) => principalId`；抛错表示拒绝。'
          },
          params: {
            auth: {
              en: 'Portable credential from the incoming handshake, possibly undefined.',
              zh: '传入握手提供的可移植凭据，可能为空值。'
            },
            peer: {
              en: 'Handshake peer metadata supplied by the accepted transport.',
              zh: '已接受传输提供的握手对端元数据。'
            }
          },
          returns: {
            en: 'Verified principal string or its Promise; throw or rejection refuses the candidate.',
            zh: '返回已验证主体字符串或其 Promise；抛错或拒绝会拒绝候选。'
          },
          default: {
            en: 'Not set: the `token` comparison is used.',
            zh: '不设置：使用 `token` 比较。'
          }
        },
        connectTimeoutMs: {
          summary: {
            en: 'Original dial/named-lookup wait budget, separate from connect.timeoutMs handshake.',
            zh: '原拨号或命名查找等待预算，与握手期限分开。'
          },
          default: {
            en: 'Omitted: original short-source default 5000 ms.',
            zh: '省略时使用原简写来源默认五千毫秒。'
          },
          example:
            "import { randomUUID } from 'node:crypto'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\n\nconst address = 'service-' + randomUUID()\nconst server = await createRpcHost<{ clientValue(value: string): string }>({\n  plugins: [processPlugin({ listen: address })],\n  provide: { double: (value: number) => value * 2 }\n})\ntry {\n  const client = await createRpcHost<{ double(value: number): number }>({\n    self: { name: 'client-a', instanceId: randomUUID() },\n    plugins: [processPlugin({ connect: { target: address, timeoutMs: 1500 } })],\n    provide: { clientValue: (value: string) => 'client:' + value }\n  })\n  try {\n    const values = await Promise.all([\n      client.request('double', 21),\n      server.send('client-a', 'clientValue', 'ready')\n    ])\n    console.log(values)\n  } finally {\n    await client.close()\n  }\n} finally {\n  await server.close()\n}"
        },
        name: {
          summary: {
            en: 'Application-selected local registration name, independent of remote self.name.',
            zh: '应用选择的本地登记名，与远端自身名称分开。'
          },
          default: {
            en: 'Omitted: original family registration name.',
            zh: '省略时使用原家族登记名。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
        },
        expose: {
          ...rpcPluginOptionDocs.expose,
          default: {
            en: 'Omitted: original exposure policy.',
            zh: '省略时保留原公开策略。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
        },
        connect: {
          summary: {
            en: 'SDK handshake preparation options, not a second physical source.',
            zh: '作者工具的握手准备选项，不是第二个物理来源。'
          },
          default: {
            en: 'Omitted: original handshake policy.',
            zh: '省略时使用原握手策略。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
        },
        'connect.timeoutMs': {
          ...rpcPluginOptionDocs['connect.timeoutMs'],
          default: {
            en: 'Omitted: original source defaults.',
            zh: '省略时使用原来源默认。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
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
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
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
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}",
          values: {
            true: {
              en: 'Adopt the actual parent bootstrap source.',
              zh: '采用实际父端启动来源。'
            }
          }
        },
        'connect.target': {
          summary: {
            en: 'Explicit named, socket or original native outbound source.',
            zh: '显式命名、套接字或原原生出站来源。'
          },
          default: {
            en: 'Required in outbound connect mode only.',
            zh: '仅出站连接模式必填。'
          },
          example:
            "import { randomUUID } from 'node:crypto'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\n\nconst address = 'service-' + randomUUID()\nconst server = await createRpcHost<{ clientValue(value: string): string }>({\n  plugins: [processPlugin({ listen: address })],\n  provide: { double: (value: number) => value * 2 }\n})\ntry {\n  const client = await createRpcHost<{ double(value: number): number }>({\n    self: { name: 'client-a', instanceId: randomUUID() },\n    plugins: [processPlugin({ connect: { target: address, timeoutMs: 1500 } })],\n    provide: { clientValue: (value: string) => 'client:' + value }\n  })\n  try {\n    const values = await Promise.all([\n      client.request('double', 21),\n      server.send('client-a', 'clientValue', 'ready')\n    ])\n    console.log(values)\n  } finally {\n    await client.close()\n  }\n} finally {\n  await server.close()\n}"
        },
        listen: {
          summary: {
            en: 'Original named/socket listener admitting independent bidirectional sessions.',
            zh: '接纳独立双向会话的原命名或套接字监听者。'
          },
          default: {
            en: 'Absent outside listen mode.',
            zh: '非监听模式不提供。'
          },
          example:
            "import { randomUUID } from 'node:crypto'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\n\nconst address = 'service-' + randomUUID()\nconst server = await createRpcHost<{ clientValue(value: string): string }>({\n  plugins: [processPlugin({ listen: address })],\n  provide: { double: (value: number) => value * 2 }\n})\ntry {\n  const client = await createRpcHost<{ double(value: number): number }>({\n    self: { name: 'client-a', instanceId: randomUUID() },\n    plugins: [processPlugin({ connect: { target: address, timeoutMs: 1500 } })],\n    provide: { clientValue: (value: string) => 'client:' + value }\n  })\n  try {\n    const values = await Promise.all([\n      client.request('double', 21),\n      server.send('client-a', 'clientValue', 'ready')\n    ])\n    console.log(values)\n  } finally {\n    await client.close()\n  }\n} finally {\n  await server.close()\n}"
        }
      }
    },

    IRpcProcessErrorCode: {
      summary: {
        en: 'Union of `RpcProcessErrorCode` values.',
        zh: '`RpcProcessErrorCode` 全部取值组成的联合类型。'
      },
      members: {}
    },
    IProcessPluginCommonOptions: {
      summary: {
        en: 'Cold native options borrowing original policy and reporter owners.',
        zh: '借用原策略与报告所有者的冷原生选项。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}",
      members: {
        ...processSpawnOptionDocs,
        ipc: {
          summary: {
            en: 'Configure the original per-connection pending-data/control limits and log sink. Explicit process features override only their matching IPC fields.',
            zh: '配置原逐连接数据、控制等待上限和日志接收器；显式进程功能仅覆盖对应的 IPC 字段。'
          },
          default: {
            en: 'Omitted: keep the native IPC defaults unless an installed feature supplies that field.',
            zh: '省略时保留原生 IPC 默认值，除非已安装功能提供对应字段。'
          }
        },

        self: {
          summary: {
            en: 'Application-supplied safe identity with nonempty name and instanceId; neither credentials nor arbitrary properties are published.',
            zh: '应用提供的安全身份，含非空名称与实例标识，不会发布凭据或任意额外属性。'
          },
          default: {
            en: 'Omitted: the core uses RUNTIME_PEER_DEFAULT_NAME and a generated defaultRpcId; trusted platform bootstrap may supply its own identity.',
            zh: '省略时核心使用默认连接名称常量与自动生成的实例标识，可信平台启动数据也可提供自身身份。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}",
          whenToUse: {
            en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
            zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
          }
        },
        provide: {
          summary: {
            en: 'Application-provided local methods, descriptors or allowed runtime forwarding entries compiled into the accepted directory; methods receive the remote payload and preserve synchronous or async failures.',
            zh: '应用提供的本端方法、描述符或获准运行时转发条目，会编译为已接受目录；方法接收远端载荷，同步或异步失败均保留。'
          },
          default: {
            en: 'Omitted: this side publishes no application methods.',
            zh: '省略时本端不发布任何应用方法。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}",
          whenToUse: {
            en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
            zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
          }
        },
        providerLimits: {
          summary: {
            en: 'Provider admission policy forwarded to the canonical endpoint; it does not alter transport framing or acquire another provider registry.',
            zh: '转交规范端点的提供方接纳策略，不改变传输分帧，也不另建提供方登记表。'
          },
          default: {
            en: 'Omitted: the original endpoint or listener admission owner supplies its standard provider limits.',
            zh: '省略时由原端点或监听接纳拥有者提供标准提供方限制。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}",
          whenToUse: {
            en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
            zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
          }
        },
        authentication: {
          summary: {
            en: 'Original signing, verification and optional encryption configuration installed into canonical endpoint assembly; invalid credentials reject construction before publication.',
            zh: '安装到规范端点组装的原始签名、校验与可选加密配置，非法凭据会在发布前拒绝构造。'
          },
          default: {
            en: 'Omitted: no authentication middleware is added by these options.',
            zh: '省略时不通过本选项增加认证中间件。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}",
          whenToUse: {
            en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
            zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
          }
        },
        probe: {
          summary: {
            en: 'One IRpcProbe or an array of probes from the application, installed as endpoint-local synchronous observers without selecting a different pipeline.',
            zh: '应用提供的一个或多个 `IRpcProbe`，安装为端点本地同步观察者，不会据此选择另一套管线。'
          },
          default: {
            en: 'Omitted: no observer is added by this field.',
            zh: '省略时不通过此字段增加观察者。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}",
          whenToUse: {
            en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
            zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
          }
        },
        defaultTimeoutMs: {
          summary: {
            en: 'Finite positive millisecond default for request and stream calls, validated before acquiring source resources; it does not extend the notify or group timeout scope.',
            zh: '请求与流调用使用的有限正毫秒默认值，在取得来源资源前校验，不扩展通知或分组操作的超时作用域。'
          },
          default: {
            en: '30000 ms for request and stream in the original timeout scope.',
            zh: '默认三万毫秒，仅用于原有请求与流超时作用域。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}",
          whenToUse: {
            en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
            zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
          }
        },
        contract: {
          summary: {
            en: 'Optional IRemoteContract with explicit method schemas, supported modes and idempotency declarations, compiled by the original remote contract owner.',
            zh: '可选的 `IRemoteContract`，提供显式方法模式、支持的调用方式与幂等声明，由原远端契约拥有者编译。'
          },
          default: {
            en: 'Omitted: provided method definitions supply the normal inferred runtime directory.',
            zh: '省略时根据已提供的方法定义推导通常的运行时目录。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}",
          whenToUse: {
            en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
            zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
          }
        },
        report: {
          whenToUse: {
            en: 'Route native process and background diagnostics to the application sink without printing credentials.',
            zh: '需要把原生进程与后台诊断交给应用接收端时设置，避免输出凭据。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}",
          summary: {
            en: 'Receives background errors that no call can reject with.',
            zh: '接收无法通过调用 reject 的后台错误。'
          },
          params: {
            error: {
              en: 'Original background failure value; preserve its source and code when present.',
              zh: '原始后台失败值；存在来源与错误码时保留它们。'
            }
          },
          returns: {
            en: 'Nothing; the error is reported.',
            zh: '无返回值；错误已交给上报函数。'
          },
          default: {
            en: '`defaultRpcReporter`, which reports through the default console path.',
            zh: '`defaultRpcReporter`，使用默认控制台报告路径。'
          }
        },
        keyFactory: {
          summary: {
            en: 'Application key generator for automatically keyed idempotent requests on managed spawn/connect bindings. Function sources use direct Core Peer assembly and do not consume this proxy field.',
            zh: '受管理启动或连接绑定为幂等请求自动分配键时使用的应用工厂。函数来源走直接核心连接组装，不消费此代理字段。'
          },
          default: {
            en: 'Omitted: proxy paths use defaultRpcId when generating keys; direct peer call keys retain their own call-option semantics.',
            zh: '省略时代理生成键使用默认标识工厂，直接连接调用仍按自身调用选项处理幂等键。'
          },
          whenToUse: {
            en: 'Managed process spawn/connect consumes this policy for declared idempotent requests. A function source uses direct Core assembly and does not consume this proxy policy.',
            zh: '托管进程 spawn/connect 为声明为幂等的请求使用此策略；函数来源使用直接 Core 组装，不使用这项代理策略。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
        },
        retryPort: {
          summary: {
            en: 'Whole-invocation dispatch port for managed spawn/connect bindings. Function sources use direct Core Peer assembly and do not consume this field.',
            zh: '受管理启动或连接绑定的整次调用派发端口。函数来源走直接核心连接组装，不消费此字段。'
          },
          default: {
            en: 'Omitted: the remote proxy keeps its original retry dispatch owner; no second retry policy is installed by a direct peer.',
            zh: '省略时远程代理保留原重试派发拥有者，直接连接不会额外安装另一套重试策略。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}",
          whenToUse: {
            en: 'Managed process spawn/connect consumes this policy for declared idempotent requests. A function source uses direct Core assembly and does not consume this proxy policy.',
            zh: '托管进程 spawn/connect 为声明为幂等的请求使用此策略；函数来源使用直接 Core 组装，不使用这项代理策略。'
          }
        },
        token: {
          summary: {
            en: 'Shared secret checked in the handshake; required for TCP, explicit socket paths and Windows pipes. Generate it per deployment and never log it.',
            zh: '握手中校验的共享密钥；TCP、显式 socket 路径与 Windows 命名管道必须设置。每次部署生成，切勿写入日志。'
          },
          default: {
            en: 'Not set: named endpoints rely on OS user permissions.',
            zh: '不设置：命名端点依赖操作系统的用户权限。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}",
          whenToUse: {
            en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
            zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
          }
        },
        verify: {
          whenToUse: {
            en: 'Require an application principal for a listener rather than relying only on same-user socket permissions.',
            zh: '监听端需要应用主体身份，而不能仅依赖同用户套接字权限时设置。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}",
          summary: {
            en: 'Listener side: `(auth, peer) => principalId` validating the client credential; throw to reject.',
            zh: '监听端：校验客户端凭据的 `(auth, peer) => principalId`；抛错表示拒绝。'
          },
          params: {
            auth: {
              en: 'Portable credential from the incoming handshake, possibly undefined.',
              zh: '传入握手提供的可移植凭据，可能为空值。'
            },
            peer: {
              en: 'Handshake peer metadata supplied by the accepted transport.',
              zh: '已接受传输提供的握手对端元数据。'
            }
          },
          returns: {
            en: 'Verified principal string or its Promise; throw or rejection refuses the candidate.',
            zh: '返回已验证主体字符串或其 Promise；抛错或拒绝会拒绝候选。'
          },
          default: {
            en: 'Not set: the `token` comparison is used.',
            zh: '不设置：使用 `token` 比较。'
          }
        },
        connectTimeoutMs: {
          summary: {
            en: 'Original dial/named-lookup wait budget, separate from connect.timeoutMs handshake.',
            zh: '原拨号或命名查找等待预算，与握手期限分开。'
          },
          default: {
            en: 'Omitted: original short-source default 5000 ms.',
            zh: '省略时使用原简写来源默认五千毫秒。'
          },
          example:
            "import { randomUUID } from 'node:crypto'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\n\nconst address = 'service-' + randomUUID()\nconst server = await createRpcHost<{ clientValue(value: string): string }>({\n  plugins: [processPlugin({ listen: address })],\n  provide: { double: (value: number) => value * 2 }\n})\ntry {\n  const client = await createRpcHost<{ double(value: number): number }>({\n    self: { name: 'client-a', instanceId: randomUUID() },\n    plugins: [processPlugin({ connect: { target: address, timeoutMs: 1500 } })],\n    provide: { clientValue: (value: string) => 'client:' + value }\n  })\n  try {\n    const values = await Promise.all([\n      client.request('double', 21),\n      server.send('client-a', 'clientValue', 'ready')\n    ])\n    console.log(values)\n  } finally {\n    await client.close()\n  }\n} finally {\n  await server.close()\n}"
        },
        name: {
          summary: {
            en: 'Application-selected local registration name, independent of remote self.name.',
            zh: '应用选择的本地登记名，与远端自身名称分开。'
          },
          default: {
            en: 'Omitted: original family registration name.',
            zh: '省略时使用原家族登记名。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
        },
        expose: {
          ...rpcPluginOptionDocs.expose,
          default: {
            en: 'Omitted: original exposure policy.',
            zh: '省略时保留原公开策略。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
        },
        connect: {
          summary: {
            en: 'SDK handshake preparation options, not a second physical source.',
            zh: '作者工具的握手准备选项，不是第二个物理来源。'
          },
          default: {
            en: 'Omitted: original handshake policy.',
            zh: '省略时使用原握手策略。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
        },
        'connect.timeoutMs': {
          ...rpcPluginOptionDocs['connect.timeoutMs'],
          default: {
            en: 'Omitted: original source defaults.',
            zh: '省略时使用原来源默认。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
        }
      }
    },
    IProcessSpawnSource: {
      summary: {
        en: 'Actual explicit plugin source union; short forms normalize through the original native owner.',
        zh: '插件的实际显式来源联合，简写通过原原生所有者归一化。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}",
      members: {}
    },
    IProcessConnectSource: {
      summary: {
        en: 'Actual explicit plugin source union; short forms normalize through the original native owner.',
        zh: '插件的实际显式来源联合，简写通过原原生所有者归一化。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}",
      members: {}
    },
    IProcessListenSource: {
      summary: {
        en: 'Actual explicit plugin source union; short forms normalize through the original native owner.',
        zh: '插件的实际显式来源联合，简写通过原原生所有者归一化。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}",
      members: {}
    },
    ISendQueueFeatureOptions: {
      summary: {
        en: 'Only capacities are configurable; native labels remain source-owned.',
        zh: '仅可配置容量，原生标签仍归来源所有者。'
      },
      example:
        "import { sendQueueFeature, ipcLogFeature } from '@migaia/rpc-plugin-process/features'\nimport timeoutFeature from '@migaia/rpc-host/features/timeout'\n\nexport const features = [\n  sendQueueFeature({ maxPendingData: 32, maxPendingControl: 8 }),\n  ipcLogFeature({\n    report: (record) => {\n      console.log(record)\n    }\n  }),\n  timeoutFeature({ ms: 1500 })\n]",
      members: {
        maxPendingData: {
          summary: {
            en: 'Maximum pending business-data frames in the original physical send queue; an explicit value overrides that lane, while omission retains the source data capacity.',
            zh: '原物理发送队列中等待业务数据帧的容量上限，显式值覆盖该通道，省略时保留来源原数据通道容量。'
          },
          default: {
            en: 'Omitted: retain the existing data lane capacity for pending business frames.',
            zh: '省略时保留原队列容量。'
          },
          example:
            "import { sendQueueFeature, ipcLogFeature } from '@migaia/rpc-plugin-process/features'\nimport timeoutFeature from '@migaia/rpc-host/features/timeout'\n\nexport const features = [\n  sendQueueFeature({ maxPendingData: 32, maxPendingControl: 8 }),\n  ipcLogFeature({\n    report: (record) => {\n      console.log(record)\n    }\n  }),\n  timeoutFeature({ ms: 1500 })\n]"
        },
        maxPendingControl: {
          summary: {
            en: 'Maximum pending protocol-control frames in the original physical send queue; this lane is configured independently, and omission retains the source control capacity.',
            zh: '原物理发送队列中等待协议控制帧的容量上限，显式值独立覆盖，省略时保留来源原控制通道容量。'
          },
          default: {
            en: 'Omitted: retain the existing control lane capacity for pending protocol frames.',
            zh: '省略时保留原队列容量。'
          },
          example:
            "import { sendQueueFeature, ipcLogFeature } from '@migaia/rpc-plugin-process/features'\nimport timeoutFeature from '@migaia/rpc-host/features/timeout'\n\nexport const features = [\n  sendQueueFeature({ maxPendingData: 32, maxPendingControl: 8 }),\n  ipcLogFeature({\n    report: (record) => {\n      console.log(record)\n    }\n  }),\n  timeoutFeature({ ms: 1500 })\n]"
        }
      }
    },
    IIpcLogFeatureOptions: {
      summary: {
        en: 'One application sink borrowed by the original IPC logger.',
        zh: '原进程通信日志借用的一个应用接收器。'
      },
      example:
        "import { sendQueueFeature, ipcLogFeature } from '@migaia/rpc-plugin-process/features'\nimport timeoutFeature from '@migaia/rpc-host/features/timeout'\n\nexport const features = [\n  sendQueueFeature({ maxPendingData: 32, maxPendingControl: 8 }),\n  ipcLogFeature({\n    report: (record) => {\n      console.log(record)\n    }\n  }),\n  timeoutFeature({ ms: 1500 })\n]",
      members: {
        report: {
          summary: {
            en: 'Receive original IPC records; thrown or rejected failures use the original reporting route.',
            zh: '接收原进程通信记录，抛错或拒绝走原报告路径。'
          },
          params: {
            record: {
              en: 'IIpcLogRecord issued by the original connection owner.',
              zh: '原连接所有者签发的日志记录。'
            }
          },
          returns: {
            en: 'Void or Promise; no buffering, flush or connection ownership is acquired.',
            zh: '返回空值或承诺，不获取缓冲、刷新或连接归属。'
          },
          example:
            "import { sendQueueFeature, ipcLogFeature } from '@migaia/rpc-plugin-process/features'\nimport timeoutFeature from '@migaia/rpc-host/features/timeout'\n\nexport const features = [\n  sendQueueFeature({ maxPendingData: 32, maxPendingControl: 8 }),\n  ipcLogFeature({\n    report: (record) => {\n      console.log(record)\n    }\n  }),\n  timeoutFeature({ ms: 1500 })\n]"
        }
      }
    },
    IIpcLogRecord: {
      summary: {
        en: 'Local backlog/failure observations or explicit process stderr records issued by the actual connection owner. They are diagnostic data, never RPC wire messages. Import from `@migaia/rpc-plugin-process/features/flow-control`.',
        zh: '实际连接所有者签发的本地积压失败观察或显式标准错误记录，是诊断数据，不是调用协议消息。从 `@migaia/rpc-plugin-process/features/flow-control` 导入。'
      },
      members: {}
    },
    IIpcSendGate: {
      summary: {
        en: 'Connection-owned whole-envelope admission with independent data/control lanes, original cancellation, event subscription and idle drain. Idle means local sends settled, not remote execution. Import from `@migaia/rpc-plugin-process/features/flow-control`.',
        zh: '连接拥有的整消息准入，含独立数据控制队列、原取消、事件订阅及空闲排空；空闲仅表示本地发送结算。从 `@migaia/rpc-plugin-process/features/flow-control` 导入。'
      },
      members: {}
    },
    IIpcSendQueueOptions: {
      summary: {
        en: 'Original gate labels and positive safe-integer total capacities including active sends. Data defaults to 256 and control to 8; native owners issue connection/session labels. Import from `@migaia/rpc-plugin-process/features/flow-control`.',
        zh: '原准入标签和包含活动发送的正安全整数总容量，数据默认二百五十六、控制默认八；连接会话标签由原生所有者签发。从 `@migaia/rpc-plugin-process/features/flow-control` 导入。'
      },
      members: {}
    }
  },
  enums: {
    RpcProcessErrorCode: {
      summary: {
        en: 'Stable error codes of `@migaia/rpc-plugin-process`.',
        zh: '`@migaia/rpc-plugin-process` 的稳定错误码及其处理方式。'
      },
      values: {
        usageSampleFailed: {
          en: '`PROCESS_USAGE_SAMPLE_FAILED`: CPU or memory sampling failed; show unavailable.',
          zh: '`PROCESS_USAGE_SAMPLE_FAILED`：CPU 或内存采样失败；显示为不可用即可。'
        },
        hostInvalidOption: {
          en: '`PROCESS_HOST_INVALID_OPTION`: a host option is invalid; fix the named field.',
          zh: '`PROCESS_HOST_INVALID_OPTION`：宿主相关选项不合法；修正对应字段。'
        },
        hostClosed: {
          en: '`PROCESS_HOST_CLOSED`: the outlet is releasing; use a new host or Peer.',
          zh: '`PROCESS_HOST_CLOSED`：出口正在释放；改用新的宿主或 Peer。'
        },
        handshakeTimeout: {
          en: '`PROCESS_HANDSHAKE_TIMEOUT`: the handshake did not finish in time; open a new channel.',
          zh: '`PROCESS_HANDSHAKE_TIMEOUT`：握手未按时完成；需要新建通道。'
        },
        authRejected: {
          en: '`PROCESS_CHANNEL_AUTH_REJECTED`: the credential was refused; do not retry with it.',
          zh: '`PROCESS_CHANNEL_AUTH_REJECTED`：凭据被拒绝；不要用同一凭据重试。'
        },
        channelClosed: {
          en: '`PROCESS_CHANNEL_CLOSED`: work on a closed channel; reconnect and reconcile.',
          zh: '`PROCESS_CHANNEL_CLOSED`：在已关闭的通道上继续工作；重新连接并对账。'
        },
        connectFailed: {
          en: '`PROCESS_CHANNEL_CONNECT_FAILED`: connecting to the other process, starting it, or setting up part of the channel failed. If the system call that starts the process or opens its streams throws, you get that same error object with its type, stack and fields intact. Its `source` becomes this package and its system `code` (such as `ENOENT`) becomes `PROCESS_CHANNEL_CONNECT_FAILED`, one stable value to check. An already wrapped failure keeps the original on `cause`.',
          zh: '`PROCESS_CHANNEL_CONNECT_FAILED`：连接另一个进程、启动进程，或建立通道的某一部分时失败。如果是启动进程或打开其数据流的系统调用直接抛错，你拿到的仍是那个错误对象，类型、堆栈和其他字段都不变；只是 `source` 被设为本包，系统错误码 `code`（例如 `ENOENT`）被换成 `PROCESS_CHANNEL_CONNECT_FAILED`，方便用一个固定的值判断。如果错误原本已经被包装过，最初的错误仍保留在 `cause` 上。'
        },
        listenFailed: {
          en: '`PROCESS_CHANNEL_LISTEN_FAILED`: preparing to listen, or binding the listening address, failed. You receive the same system error object, with its type, stack and other fields unchanged; it only gains this package as `source` and `PROCESS_CHANNEL_LISTEN_FAILED` as `code`. Both the reported error and the rejected promise keep the original `cause` chain.',
          zh: '`PROCESS_CHANNEL_LISTEN_FAILED`：准备监听或绑定监听地址时失败。你拿到的仍是原来的系统错误对象，类型、堆栈和其他字段都不变，只是多了 `source`（本包）和 `code`（`PROCESS_CHANNEL_LISTEN_FAILED`），可以据此判断错误来自哪里、属于哪一类。无论错误是被报告出去，还是作为 Promise 的拒绝原因返回，原来的 `cause` 链都保留。'
        },
        pluginInvalidOption: {
          en: '`PROCESS_PLUGIN_INVALID_OPTION`: a plugin or source option is invalid.',
          zh: '`PROCESS_PLUGIN_INVALID_OPTION`：插件或来源选项不合法。'
        },
        resilienceInvalidOption: {
          en: '`PROCESS_RESILIENCE_INVALID_OPTION`: a governance limit is invalid.',
          zh: '`PROCESS_RESILIENCE_INVALID_OPTION`：连接治理的限制配置不合法。'
        },
        connectionLimit: {
          en: '`PROCESS_CONNECTION_LIMIT`: connection, rate or payload limit; the call did not run.',
          zh: '`PROCESS_CONNECTION_LIMIT`：超出连接、速率或参数限制；调用没有执行。'
        },
        instanceUnhealthy: {
          en: '`PROCESS_INSTANCE_UNHEALTHY`: the target is suspended until a healthy replacement is ready.',
          zh: '`PROCESS_INSTANCE_UNHEALTHY`：目标已挂起，直到健康的替代就绪。'
        },
        healthPingFailed: {
          en: '`PROCESS_HEALTH_PING_FAILED`: a health ping failed; supervision restarts it.',
          zh: '`PROCESS_HEALTH_PING_FAILED`：健康 ping 失败；由监督策略重启。'
        },
        terminalCall: {
          en: '`PROCESS_TERMINAL_CALL`: the registration is terminal and refuses calls.',
          zh: '`PROCESS_TERMINAL_CALL`：登记已进入终态，拒绝新调用。'
        },
        liquidated: {
          en: '`PROCESS_LIQUIDATED`: the registration was liquidated; create a new one.',
          zh: '`PROCESS_LIQUIDATED`：登记已被清算；需要创建新的登记。'
        }
      }
    },
    IpcSendClass: {
      summary: {
        en: 'Separate whole-envelope admission lanes retain control capacity when application data is saturated. Lane choice belongs to the existing connection sender.',
        zh: '完整消息的独立准入队列在业务数据饱和时保留控制容量，队列选择归既有连接发送器。'
      },
      values: {
        data: {
          en: 'Application frames consume data-lane capacity.',
          zh: '应用帧使用数据队列容量。'
        },
        control: {
          en: 'Cancellation and liveness frames use reserved control capacity.',
          zh: '取消及活性帧使用预留控制容量。'
        }
      }
    },
    IpcLogEventName: {
      summary: {
        en: 'Local connection gate/log diagnostic names, not RPC wire messages or remote execution acknowledgements. The original owner issues these records.',
        zh: '本地连接准入及日志诊断名称，不是协议消息或远端执行确认，记录由原所有者签发。'
      },
      values: {
        'ipc.backlog.high': {
          en: 'Accepted backlog crosses its high watermark.',
          zh: '已接纳积压超过高水位。'
        },
        'ipc.backlog.low': {
          en: 'Backlog drains below its low watermark.',
          zh: '积压排空至低水位以下。'
        },
        'ipc.backlog.rejected': {
          en: 'The selected lane cannot accept another whole envelope.',
          zh: '选定队列不能再接纳完整消息。'
        },
        'ipc.send.failed': {
          en: 'An already admitted physical send fails.',
          zh: '已接纳物理发送失败。'
        },
        'ipc.stderr': {
          en: 'Process owner explicitly supplies standard-error text.',
          zh: '进程所有者显式提交标准错误文本。'
        }
      }
    }
  },
  enhancers: {
    processPlugin: {
      kind: 'transport',
      target: 'IRpcHost / PluginHost',
      summary: {
        en: 'One cold native transport using original bootstrap, supervision, drain and native exit owners. Both sides provide methods over the same actual host endpoint.',
        zh: '一个使用原启动、监督、排空和原生退出所有者的冷传输，双方在同一实际宿主端点提供方法。'
      },
      install:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}",
      grants: [],
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
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
    },
    sendQueueFeature: {
      kind: 'feature',
      target: 'IRpcHost / PluginHost',
      summary: {
        en: 'Configure the original physical send queue, preserving omitted source fields.',
        zh: '配置原物理发送队列，保留省略的来源字段。'
      },
      install:
        "import { sendQueueFeature, ipcLogFeature } from '@migaia/rpc-plugin-process/features'\nimport timeoutFeature from '@migaia/rpc-host/features/timeout'\n\nexport const features = [\n  sendQueueFeature({ maxPendingData: 32, maxPendingControl: 8 }),\n  ipcLogFeature({\n    report: (record) => {\n      console.log(record)\n    }\n  }),\n  timeoutFeature({ ms: 1500 })\n]",
      grants: [],
      behaviors: [],
      scenarios: [
        {
          en: 'Bound or inspect this native connection.',
          zh: '限制或查看此原生连接。'
        }
      ],
      example:
        "import { sendQueueFeature, ipcLogFeature } from '@migaia/rpc-plugin-process/features'\nimport timeoutFeature from '@migaia/rpc-host/features/timeout'\n\nexport const features = [\n  sendQueueFeature({ maxPendingData: 32, maxPendingControl: 8 }),\n  ipcLogFeature({\n    report: (record) => {\n      console.log(record)\n    }\n  }),\n  timeoutFeature({ ms: 1500 })\n]"
    },
    ipcLogFeature: {
      kind: 'feature',
      target: 'IRpcHost / PluginHost',
      summary: {
        en: 'Observe the original connection log without another subscription or I/O owner.',
        zh: '观察原连接日志，不添加另一订阅或输入输出所有者。'
      },
      install:
        "import { sendQueueFeature, ipcLogFeature } from '@migaia/rpc-plugin-process/features'\nimport timeoutFeature from '@migaia/rpc-host/features/timeout'\n\nexport const features = [\n  sendQueueFeature({ maxPendingData: 32, maxPendingControl: 8 }),\n  ipcLogFeature({\n    report: (record) => {\n      console.log(record)\n    }\n  }),\n  timeoutFeature({ ms: 1500 })\n]",
      grants: [],
      behaviors: [],
      scenarios: [
        {
          en: 'Bound or inspect this native connection.',
          zh: '限制或查看此原生连接。'
        }
      ],
      example:
        "import { sendQueueFeature, ipcLogFeature } from '@migaia/rpc-plugin-process/features'\nimport timeoutFeature from '@migaia/rpc-host/features/timeout'\n\nexport const features = [\n  sendQueueFeature({ maxPendingData: 32, maxPendingControl: 8 }),\n  ipcLogFeature({\n    report: (record) => {\n      console.log(record)\n    }\n  }),\n  timeoutFeature({ ms: 1500 })\n]"
    }
  }
}
