/** Bilingual public reference for the current process transport and feature ownership. */
import type { ILibraryReference } from './contract.js'

/** Concrete public package example with actual namespace and resource ownership. */
const example1 =
  "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.process.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"

/** Concrete public package example with actual namespace and resource ownership. */
const example2 =
  "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\nimport { flowControl, sendQueue, ipcLog } from '@migaia/rpc-plugin-process/features'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function openWorker(entry: URL) {\n  const flow = flowControl({ maxPendingData: 32, maxPendingControl: 8 })\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.error(view.lifecycle)\n    }\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      processPlugin({\n        spawn: entry,\n        features: [\n          flow,\n          sendQueue({ flow }),\n          ipcLog({\n            report(record) {\n              console.error(record)\n            }\n          }),\n          timeout({ ms: 1500 })\n        ]\n      })\n    ]\n  })\n}"

/** Concrete public package example with actual namespace and resource ownership. */
const example3 =
  "import { IpcSendClass } from '@migaia/rpc-plugin-process/features/flow-control'\nconsole.log(IpcSendClass)"

/** Concrete public package example with actual namespace and resource ownership. */
const example4 =
  "import { IpcLogEventName } from '@migaia/rpc-plugin-process/features/flow-control'\nconsole.log(IpcLogEventName)"

/** Concrete public package example with actual namespace and resource ownership. */
const example5 =
  "import { IpcFlowControl } from '@migaia/rpc-plugin-process/features/flow-control'\nimport { flowControl, type IProcessFeatureContext } from '@migaia/rpc-plugin-process/features'\n\nexport function nativeAdmission(context: IProcessFeatureContext) {\n  return new IpcFlowControl({ maxPendingData: 32 }, context)\n}"

/** Concrete public package example with actual namespace and resource ownership. */
const example6 =
  "import { IpcSendQueue } from '@migaia/rpc-plugin-process/features/send-queue'\nimport { flowControl, type IProcessFeatureContext } from '@migaia/rpc-plugin-process/features'\n\nexport function nativeAdmission(context: IProcessFeatureContext) {\n  return new IpcSendQueue(flowControl({ maxPendingData: 32 }), context)\n}"

/** Concrete public package example with actual namespace and resource ownership. */
const example7 =
  "import { randomUUID } from 'node:crypto'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\n\nconst address = 'service-' + randomUUID()\nconst server = await createRpcHost({\n  plugins: [processPlugin({ listen: address })],\n  provide: { double: (value: number) => value * 2 }\n})\ntry {\n  const client = await createRpcHost({\n    self: { name: 'client-a', instanceId: randomUUID() },\n    plugins: [processPlugin({ connect: { target: address, timeoutMs: 1500 } })],\n    provide: { clientValue: (value: string) => 'client:' + value }\n  })\n  try {\n    console.log(await client.process.request('double', 21))\n    console.log(await server.process.send('client-a', 'clientValue', 'ready'))\n  } finally {\n    await client.close()\n  }\n} finally {\n  await server.close()\n}"

/** Public configuration example for this native capability. */
const processScopeExample =
  "import { processPlugin } from '@migaia/rpc-plugin-process'\n\nexport function renderer(entry: URL) {\n  return processPlugin({ spawn: entry, namespace: 'jobs', name: 'renderer' })\n}"

/** Public configuration example for this native capability. */
const processExposureExample =
  "import { processPlugin } from '@migaia/rpc-plugin-process'\n\nexport function exposeMath(entry: URL) {\n  return processPlugin({ spawn: entry, expose: ['math.double'] })\n}"

/** Public configuration example for this native capability. */
const processReportExample =
  "import { processPlugin } from '@migaia/rpc-plugin-process'\n\nexport function monitoredProcess(entry: URL) {\n  return processPlugin({\n    spawn: entry,\n    report(error) {\n      console.error('Process background failure', error)\n    }\n  })\n}"

/** Public configuration example for this native capability. */
const launchPathsExample =
  "import { processPlugin } from '@migaia/rpc-plugin-process'\n\nexport const invoiceWorker = processPlugin({\n  spawn: './invoice-worker.mjs',\n  base: import.meta.url,\n  args: ['--tenant', 'demo'],\n  cwd: '/srv/invoices',\n  env: { inherit: ['PATH'], set: { LANG: 'C.UTF-8' } }\n})"

/** Public configuration example for this native capability. */
const launchCommandExample =
  "import { processPlugin } from '@migaia/rpc-plugin-process'\n\nexport const pythonWorker = processPlugin({\n  spawn: true,\n  command: 'python3',\n  args: ['-u', '/srv/invoices/peer.py']\n})"

/** Public configuration example for this native capability. */
const launchResourcesExample =
  "import { processPlugin } from '@migaia/rpc-plugin-process'\n\nexport const denoWorker = processPlugin({\n  spawn: new URL('./invoice-worker.ts', import.meta.url),\n  stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },\n  limits: { memoryBytes: 268435456 },\n  permissions: ['--allow-read=/srv/invoices'],\n  supervision: { restart: { mode: 'never' } }\n})"

/** Public configuration example for this native capability. */
const launchWrapExample =
  "import { processPlugin } from '@migaia/rpc-plugin-process'\n\nexport function sandboxedWorker(entry: URL, policy: string) {\n  return processPlugin({\n    spawn: entry,\n    wrap(command) {\n      return {\n        ...command,\n        command: 'sandbox-exec',\n        args: ['-f', policy, command.command, ...command.args]\n      }\n    }\n  })\n}"

/** Public configuration example for this native capability. */
const launchNoticeExample =
  "import { processPlugin } from '@migaia/rpc-plugin-process'\n\nexport function workerWithNotices(entry: URL) {\n  return processPlugin({\n    spawn: entry,\n    onNotice(notice) {\n      console.warn('Native launcher capability notice', notice)\n    }\n  })\n}"

/** Public configuration example for this native capability. */
const parentLossExample =
  "import { processPlugin } from '@migaia/rpc-plugin-process'\n\nexport const childTransport = processPlugin({\n  connectToParent: true,\n  parentLoss: {\n    graceMs: 500,\n    exit(code) {\n      process.exit(code)\n    },\n    probe(onLost) {\n      process.once('disconnect', onLost)\n      return () => process.off('disconnect', onLost)\n    }\n  }\n})"

/** Current public modules, configuration and installed capabilities. */
export const rpcProcessReference: ILibraryReference = {
  modules: {
    index: {
      summary: {
        en: 'Contract owns pure protocol, interfaces and errors. Host owns Sessions, calls and providers; this package owns native child processes and local sockets. Flow plugins use fixed hooks, and complete features own optional policy. Call through the transport namespace. Separate Hosts are usual; deliberate multi-transport installation uses distinct namespaces.',
        zh: '契约包拥有纯协议、接口及错误；宿主拥有会话、调用及提供方，本包拥有原生子进程及本地套接字。流程插件使用固定钩子，完整功能拥有可选策略。通过传输命名空间调用；通常使用独立宿主，也可用不同命名空间明确隔离多传输安装。'
      },
      example: example1
    },
    features: {
      summary: {
        en: 'Configure original per-connection queue/log owners with exact installed feature objects.',
        zh: '以精确安装功能对象配置原逐连接队列和日志所有者。'
      },
      example: example2
    },
    'features/send-queue': {
      summary: {
        en: 'Set independent data/control capacities without adding a second gate.',
        zh: '设置独立数据和控制容量，不添加第二个准入控制。'
      },
      example: example2
    },
    'features/log': {
      summary: {
        en: 'Supply the original IPC log owner with an application diagnostic sink.',
        zh: '向原进程通信日志所有者提供应用诊断接收器。'
      },
      example: example2
    },
    'features/flow-control': {
      summary: {
        en: 'Original lane/event constants and types only, with no extra flow-control plugin factory.',
        zh: '仅含原队列类别、事件常量和类型，没有额外流控插件工厂。'
      },
      example: example2
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
      example: example1
    },
    RPC_PROCESS_ERROR_SOURCE: {
      role: 'constant',
      purpose: {
        en: 'Stable rpc.transport.process source declared by @migaia/rpc-contract/error-code and re-exported here. Other RPC/native families retain their own source and code.',
        zh: '由契约包错误码入口声明并在此重导出的稳定来源 rpc.transport.process；其他远程调用及原生家族保留自身来源与错误码。'
      },
      example: {
        en: example1,
        zh: example1
      }
    },
    RpcProcessErrorCode: {
      role: 'constant',
      purpose: {
        en: 'Table of the stable error codes of this package; values are the strings on `error.code`.',
        zh: '本包稳定错误码的对照表；值就是错误对象 `error.code` 上的字符串。'
      },
      example: {
        en: example1,
        zh: example1
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
        en: 'Cold SDK transport definition. Installation publishes host.process calls and actual native extensions; construction alone acquires no resource.',
        zh: '返回冷 SDK 传输定义；安装后发布对应命名空间调用及实际原生扩展，仅构造定义不会获取资源。'
      },
      example: example1
    },
    IpcSendClass: {
      example: {
        en: example3,
        zh: example3
      },
      role: 'constant',
      purpose: {
        en: 'Separate whole-envelope admission lanes retain control capacity when application data is saturated. Lane choice belongs to the existing connection sender. Import from `@migaia/rpc-plugin-process/features/flow-control`.',
        zh: '完整消息的独立准入队列在业务数据饱和时保留控制容量，队列选择归既有连接发送器。从 `@migaia/rpc-plugin-process/features/flow-control` 导入。'
      }
    },
    IpcLogEventName: {
      example: {
        en: example4,
        zh: example4
      },
      role: 'constant',
      purpose: {
        en: 'Local connection gate/log diagnostic names, not RPC wire messages or remote execution acknowledgements. The original owner issues these records. Import from `@migaia/rpc-plugin-process/features/flow-control`.',
        zh: '本地连接准入及日志诊断名称，不是协议消息或远端执行确认，记录由原所有者签发。从 `@migaia/rpc-plugin-process/features/flow-control` 导入。'
      }
    },
    sendQueue: {
      role: 'enhancer',
      purpose: {
        en: 'Create a complete connection-local FIFO feature. The queue waits for each original native write Promise and borrows one flow capacity owner.',
        zh: '创建连接本地的完整先进先出功能，等待每个原生写入承诺并借用唯一流控容量所有者。'
      },
      options: 'ISendQueueOptions',
      returns: {
        en: 'Cold complete feature with install(context); Process supplies the actual owner and native connection facts.',
        zh: '返回带安装入口的冷完整功能；进程提供实际所有者及原生连接事实。'
      },
      example: example2
    },
    ipcLog: {
      role: 'enhancer',
      purpose: {
        en: 'Create a complete local log feature for actual backlog, send failures and captured stderr. Logging alone does not install flow control.',
        zh: '为实际积压、发送失败及捕获的标准错误创建完整本地日志功能；单独日志不会启用流控。'
      },
      options: 'IIpcLogOptions',
      returns: {
        en: 'Cold complete feature with install(context); Process supplies the actual owner and native connection facts.',
        zh: '返回带安装入口的冷完整功能；进程提供实际所有者及原生连接事实。'
      },
      example: example2
    },
    flowControl: {
      role: 'enhancer',
      purpose: {
        en: 'Create one complete two-lane native-write admission feature. A sendQueue may share this exact definition.',
        zh: '创建完整的双通道原生写入接纳功能，发送队列可共享此精确定义。'
      },
      options: 'IIpcFlowControlOptions',
      returns: {
        en: 'Cold complete feature with install(context); Process supplies the actual owner and native connection facts.',
        zh: '返回带安装入口的冷完整功能；进程提供实际所有者及原生连接事实。'
      },
      example: example2
    },
    IpcFlowControl: {
      role: 'factory',
      purpose: {
        en: 'Lower-level native installation value. Applications normally install the complete feature factory; a custom native owner supplies its real feature context.',
        zh: '底层原生安装值。应用通常安装完整功能工厂；自定义原生所有者提供真实功能上下文。'
      },
      params: {
        context: {
          en: 'Actual SDK installation owner, lifecycle and native connection facts.',
          zh: '实际 SDK 安装所有者、寿命及原生连接事实。'
        },
        options: {
          en: 'Two-lane capacity options.',
          zh: '双通道容量选项。'
        }
      },
      returns: {
        en: 'One connection-local admission owner; close and whenIdle preserve physical write lifetime.',
        zh: '返回一个连接本地接纳所有者；关闭及等待空闲保留物理写入寿命。'
      },
      example: example5,
      options: 'IIpcFlowControlOptions'
    },
    IpcSendQueue: {
      role: 'factory',
      purpose: {
        en: 'Lower-level native installation value. Applications normally install the complete feature factory; a custom native owner supplies its real feature context.',
        zh: '底层原生安装值。应用通常安装完整功能工厂；自定义原生所有者提供真实功能上下文。'
      },
      params: {
        context: {
          en: 'Actual SDK installation owner, lifecycle and native connection facts.',
          zh: '实际 SDK 安装所有者、寿命及原生连接事实。'
        },
        feature: {
          en: 'Complete flowControl definition.',
          zh: '完整流控定义。'
        }
      },
      returns: {
        en: 'One connection-local admission owner; close and whenIdle preserve physical write lifetime.',
        zh: '返回一个连接本地接纳所有者；关闭及等待空闲保留物理写入寿命。'
      },
      example: example6
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
        en: example1,
        zh: example1
      },
      members: {
        entry: {
          summary: {
            en: 'Module to run with the current runtime (URL or path).',
            zh: '用当前运行时执行的模块（URL 或路径）。'
          }
        },
        base: {
          summary: {
            en: 'Module URL used to resolve a relative `entry`.',
            zh: '解析相对 `entry` 时使用的模块 URL。'
          },
          default: {
            en: 'Omitted: resolve from the genuine main-entry URL when relative paths require a base.',
            zh: '省略时以真实主入口网址为相对路径解析基准。'
          }
        },
        command: {
          summary: {
            en: 'Executable to run instead of `entry`, e.g. `python3`.',
            zh: '代替 `entry` 运行的可执行程序，例如 `python3`。'
          },
          default: {
            en: 'Omitted: use the selected runtime executable and resolve the module entry.',
            zh: '省略时使用所选运行时的可执行文件并解析模块入口。'
          }
        },
        args: {
          summary: {
            en: 'Arguments of `command`, or extra arguments.',
            zh: '`command` 的参数，或额外的命令行参数。'
          },
          default: {
            en: 'Explicit entry or command: empty arguments. Self-spawn without args: retain parent script arguments.',
            zh: '显式入口或命令默认无附加参数；同文件自启动且未设置时保留父端脚本参数。'
          }
        },
        cwd: {
          summary: {
            en: 'Working-directory path passed to the native child launcher; controls child-process relative paths without changing the local module-resolution base.',
            zh: '传给原生启动器的子进程工作目录路径，影响子进程的相对路径解析，不改变本端模块的解析基准。'
          },
          default: {
            en: 'Omitted: retain the native launcher working-directory default.',
            zh: '省略时保留原生启动器的默认工作目录。'
          }
        },
        env: {
          summary: {
            en: '`{ inherit, set }`: variable names to inherit and values to set.',
            zh: '`{ inherit, set }`：要继承的变量名与要设置的值。'
          },
          default: {
            en: 'Omitted: inherit PATH only and set no additional variables.',
            zh: '省略时仅继承 `PATH`，不增加其他环境变量。'
          }
        },
        wrap: {
          summary: {
            en: 'Rewrites the computed launch command (e.g. to run inside `sandbox-exec` or `bwrap`) on every launch, restart and replace. Must keep stdin/stdout and environment, and forward the exit code.',
            zh: '在每次启动、重启与替换时改写计算出的启动命令（例如放进 `sandbox-exec` 或 `bwrap`）。必须保留 stdin/stdout 与环境变量，并转发退出码。'
          },
          default: {
            en: 'Omitted: launch the originally computed command without rewriting it.',
            zh: '省略时直接启动原计算命令，不进行命令改写。'
          }
        },
        stdio: {
          summary: {
            en: 'stdio routing; default `{ stdin: "channel", stdout: "channel", stderr: "drain" }`.',
            zh: '子进程标准输入输出的走向；默认 `{ stdin: "channel", stdout: "channel", stderr: "drain" }`。'
          },
          default: {
            en: 'Omitted: stdin and stdout use channel; stderr is drained.',
            zh: '省略时标准输入输出用于通道，标准错误持续排空。'
          }
        },
        limits: {
          summary: {
            en: 'Limits such as `callWallTimeMs` per call.',
            zh: '资源限制，例如单次调用的 `callWallTimeMs`。'
          },
          default: {
            en: 'Omitted: request no explicit native resource limits through this field.',
            zh: '省略时不通过此字段请求显式原生资源上限。'
          }
        },
        permissions: {
          summary: {
            en: 'Runtime permissions (Deno).',
            zh: '子进程的运行时权限设置（用于 Deno）。'
          },
          default: {
            en: 'Omitted: supply no explicit permission arguments to the selected runtime.',
            zh: '省略时不向所选运行时提供显式权限参数。'
          }
        },
        token: {
          summary: {
            en: 'Session secret; shorthand generates it once when the source is normalized and reuses it across supervised generations. A restart does not rotate it.',
            zh: '会话密钥；简写来源规范化时随机生成一次，由监督代次复用，重启不会轮换。'
          }
        },
        supervision: {
          summary: {
            en: 'Overrides the original supervisor restart, startup, stop and other policies; retains the same execution-unit owner without installing another supervisor.',
            zh: '覆盖原监督器的重启、启动与停止预算等策略，继续使用同一执行单元所有者，不额外创建监督器。'
          },
          default: {
            en: 'Omitted: the original one-unit best-effort process supervisor defaults.',
            zh: '省略时使用原单执行单元及尽力终止的进程监督器默认策略。'
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
          },
          default: {
            en: 'Omitted: expected launcher notices use the configured or default reporter.',
            zh: '省略时预期启动器提示使用显式配置或默认报告器。'
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
      example: example1,
      members: {
        base: {
          summary: {
            en: 'Module URL used to resolve a relative `entry`.',
            zh: '解析相对 `entry` 时使用的模块 URL。'
          },
          default: {
            en: 'Omitted: resolve from the genuine main-entry URL when relative paths require a base.',
            zh: '省略时以真实主入口网址为相对路径解析基准。'
          },
          example: launchPathsExample
        },
        command: {
          summary: {
            en: 'Executable to run instead of `entry`, e.g. `python3`.',
            zh: '代替 `entry` 运行的可执行程序，例如 `python3`。'
          },
          default: {
            en: 'Omitted: use the selected runtime executable and resolve the module entry.',
            zh: '省略时使用所选运行时的可执行文件并解析模块入口。'
          },
          example: launchCommandExample
        },
        args: {
          summary: {
            en: 'Arguments of `command`, or extra arguments.',
            zh: '`command` 的参数，或额外的命令行参数。'
          },
          default: {
            en: 'Explicit entry or command: empty arguments. Self-spawn without args: retain parent script arguments.',
            zh: '显式入口或命令默认无附加参数；同文件自启动且未设置时保留父端脚本参数。'
          },
          example: launchPathsExample
        },
        cwd: {
          summary: {
            en: 'Working-directory path passed to the native child launcher; controls child-process relative paths without changing the local module-resolution base.',
            zh: '传给原生启动器的子进程工作目录路径，影响子进程的相对路径解析，不改变本端模块的解析基准。'
          },
          default: {
            en: 'Omitted: retain the native launcher working-directory default.',
            zh: '省略时保留原生启动器的默认工作目录。'
          },
          example: launchPathsExample
        },
        env: {
          summary: {
            en: '`{ inherit, set }`: variable names to inherit and values to set.',
            zh: '`{ inherit, set }`：要继承的变量名与要设置的值。'
          },
          default: {
            en: 'Omitted: inherit PATH only and set no additional variables.',
            zh: '省略时仅继承 `PATH`，不增加其他环境变量。'
          },
          example: launchPathsExample
        },
        wrap: {
          summary: {
            en: 'Rewrites the computed launch command (e.g. to run inside `sandbox-exec` or `bwrap`) on every launch, restart and replace. Must keep stdin/stdout and environment, and forward the exit code.',
            zh: '在每次启动、重启与替换时改写计算出的启动命令（例如放进 `sandbox-exec` 或 `bwrap`）。必须保留 stdin/stdout 与环境变量，并转发退出码。'
          },
          default: {
            en: 'Omitted: launch the originally computed command without rewriting it.',
            zh: '省略时直接启动原计算命令，不进行命令改写。'
          },
          example: launchWrapExample,
          whenToUse: {
            en: 'Use a native sandbox or wrapper executable while preserving the original arguments, environment, stdio channel and exit status. The wrapper runs on each native launch.',
            zh: '需要原生沙箱或包装可执行文件时使用，须保留原参数、环境、标准通道及退出状态；每次原生启动都会执行。'
          }
        },
        stdio: {
          summary: {
            en: 'stdio routing; default `{ stdin: "channel", stdout: "channel", stderr: "drain" }`.',
            zh: '子进程标准输入输出的走向；默认 `{ stdin: "channel", stdout: "channel", stderr: "drain" }`。'
          },
          default: {
            en: 'Omitted: stdin and stdout use channel; stderr is drained.',
            zh: '省略时标准输入输出用于通道，标准错误持续排空。'
          },
          example: launchResourcesExample
        },
        limits: {
          summary: {
            en: 'Limits such as `callWallTimeMs` per call.',
            zh: '资源限制，例如单次调用的 `callWallTimeMs`。'
          },
          default: {
            en: 'Omitted: request no explicit native resource limits through this field.',
            zh: '省略时不通过此字段请求显式原生资源上限。'
          },
          example: launchResourcesExample
        },
        permissions: {
          summary: {
            en: 'Runtime permissions (Deno).',
            zh: '子进程的运行时权限设置（用于 Deno）。'
          },
          default: {
            en: 'Omitted: supply no explicit permission arguments to the selected runtime.',
            zh: '省略时不向所选运行时提供显式权限参数。'
          },
          example: launchResourcesExample
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
          example: example1,
          whenToUse: {
            en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
            zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
          }
        },
        supervision: {
          summary: {
            en: 'Overrides the original supervisor restart, startup, stop and other policies; retains the same execution-unit owner without installing another supervisor.',
            zh: '覆盖原监督器的重启、启动与停止预算等策略，继续使用同一执行单元所有者，不额外创建监督器。'
          },
          default: {
            en: 'Omitted: the original one-unit best-effort process supervisor defaults.',
            zh: '省略时使用原单执行单元及尽力终止的进程监督器默认策略。'
          },
          example: launchResourcesExample
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
          },
          default: {
            en: 'Omitted: expected launcher notices use the configured or default reporter.',
            zh: '省略时预期启动器提示使用显式配置或默认报告器。'
          },
          example: launchNoticeExample,
          whenToUse: {
            en: 'Separate expected native capability notices from failures in application monitoring, for example when best-effort termination cannot enforce isolation.',
            zh: '应用监控需要将预期原生能力提示与失败分开时使用，例如尽力终止无法强制隔离的情况。'
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
            en: 'Set an application monitoring sink when process background and cleanup failures must join your existing incident reports. Omit it to inherit the configured Host reporter.',
            zh: '需要将原生后台及清理失败汇入应用现有告警时配置；省略则继承宿主显式报告器。'
          },
          example: processReportExample
        },
        verify: {
          whenToUse: {
            en: 'Require an application principal for a listener rather than relying only on same-user socket permissions.',
            zh: '监听端需要应用主体身份，而不能仅依赖同用户套接字权限时设置。'
          },
          example: example1,
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
          example: example7
        },
        name: {
          summary: {
            en: 'Local native registration name, separate from accepted remote identity.',
            zh: '本地原生登记名称，与已接纳的远端身份分开。'
          },
          default: {
            en: 'Omitted: the native registration default.',
            zh: '省略时使用原生登记默认名称。'
          },
          example: processScopeExample
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
          example: processExposureExample
        },
        connect: {
          summary: {
            en: 'connect.target selects a native source. connect.timeoutMs without target only decorates the selected source handshake.',
            zh: '连接目标选择原生来源；不含目标的握手超时选项仅修饰已选来源的握手。'
          },
          default: {
            en: 'Omitted: original handshake policy.',
            zh: '省略时使用原握手策略。'
          },
          example: example1
        },
        'connect.timeoutMs': {
          summary: {
            en: 'One finite nonnegative millisecond budget shared by identity and capability preparation; phases do not reset it, and it does not set business-call or task-stop deadlines.',
            zh: '身份与能力准备共用的一次有限非负毫秒预算，各阶段不重置期限，也不作为业务调用或任务停止期限。'
          },
          default: {
            en: 'Omitted: original source defaults.',
            zh: '省略时使用原来源默认。'
          },
          example: example1
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
            en: 'Choose true in a child launched by this package so its original bootstrap and stdio owners are reused. Parent code chooses spawn instead.',
            zh: '在本包启动的子进程中选择真值，复用其原启动信息及标准输入输出所有者；父端改用 `spawn`。'
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
          example: example7
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
          example: example7
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
          example: processScopeExample
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
        parentLoss: {
          summary: {
            en: 'Actual child parent-loss exit, optional grace and native liveness probe.',
            zh: '实际子端父进程丢失时的退出、可选宽限及原生活性探测。'
          },
          default: {
            en: 'Omitted: the automatic child source supplies its native policy.',
            zh: '省略时由自动子端来源提供原生策略。'
          },
          example: parentLossExample
        },
        'parentLoss.exit': {
          summary: {
            en: 'The actual child exit callback receives the parent-loss guard outcome after its original grace cleanup. It must terminate the native child.',
            zh: '实际子端退出回调接收父端丢失保护器在原宽限清理后的结果，负责终止原生子进程。'
          },
          params: {
            code: {
              en: 'Guard-issued 0 after graceful completion or 1 when forced termination is required.',
              zh: '保护器签发的退出状态：宽限完成取零，需要强制终止取一。'
            }
          },
          returns: {
            en: 'No return value; the original native child exits with the supplied status.',
            zh: '无返回值，原生子进程以提供的状态退出。'
          },
          example: parentLossExample,
          whenToUse: {
            en: 'Provide this when overriding native child parent-loss policy; retain the actual runtime exit operation rather than reporting only.',
            zh: '覆盖原生子端的父进程丢失策略时提供，必须保留实际运行时退出操作，而非仅报告日志。'
          }
        },
        'parentLoss.graceMs': {
          summary: {
            en: 'Finite nonnegative child cleanup grace in milliseconds after actual parent loss; it does not extend a business-call timeout.',
            zh: '实际父端丢失后的有限非负子端清理宽限，单位为毫秒，不延长业务调用超时。'
          },
          default: {
            en: 'Omitted: use the parent-loss guard default 5000ms.',
            zh: '省略时使用父端丢失保护器默认的五千毫秒。'
          },
          example: parentLossExample
        },
        'parentLoss.probe': {
          summary: {
            en: 'Subscribe the original native parent-liveness signal and notify the guard on actual loss; return the exact listener remover.',
            zh: '订阅原生父端活性信号，在实际丢失时通知保护器，并返回精确监听移除器。'
          },
          params: {
            onLost: {
              en: 'Guard callback supplied by installation; call it with the actual parent-loss reason when available.',
              zh: '安装时提供的保护器回调，能够取得实际父端丢失原因时一并传入。'
            }
          },
          returns: {
            en: 'Original unsubscription function; disposal releases this exact native observation.',
            zh: '返回原取消订阅函数，销毁时释放此精确原生观察。'
          },
          default: {
            en: 'Omitted: no additional custom liveness probe.',
            zh: '省略时不添加自定义父端活性探测。'
          },
          example: parentLossExample,
          whenToUse: {
            en: 'Use a real native parent-liveness source in addition to transport EOF; never infer parent authority from business messages.',
            zh: '需要在传输结束之外借用真实原生父端活性来源时使用，不能从业务消息推断父端权限。'
          }
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
      example: example1,
      members: {
        base: {
          summary: {
            en: 'Module URL used to resolve a relative `entry`.',
            zh: '解析相对 `entry` 时使用的模块 URL。'
          },
          default: {
            en: 'Omitted: resolve from the genuine main-entry URL when relative paths require a base.',
            zh: '省略时以真实主入口网址为相对路径解析基准。'
          },
          example: launchPathsExample
        },
        command: {
          summary: {
            en: 'Executable to run instead of `entry`, e.g. `python3`.',
            zh: '代替 `entry` 运行的可执行程序，例如 `python3`。'
          },
          default: {
            en: 'Omitted: use the selected runtime executable and resolve the module entry.',
            zh: '省略时使用所选运行时的可执行文件并解析模块入口。'
          },
          example: launchCommandExample
        },
        args: {
          summary: {
            en: 'Arguments of `command`, or extra arguments.',
            zh: '`command` 的参数，或额外的命令行参数。'
          },
          default: {
            en: 'Explicit entry or command: empty arguments. Self-spawn without args: retain parent script arguments.',
            zh: '显式入口或命令默认无附加参数；同文件自启动且未设置时保留父端脚本参数。'
          },
          example: launchPathsExample
        },
        cwd: {
          summary: {
            en: 'Working-directory path passed to the native child launcher; controls child-process relative paths without changing the local module-resolution base.',
            zh: '传给原生启动器的子进程工作目录路径，影响子进程的相对路径解析，不改变本端模块的解析基准。'
          },
          default: {
            en: 'Omitted: retain the native launcher working-directory default.',
            zh: '省略时保留原生启动器的默认工作目录。'
          },
          example: launchPathsExample
        },
        env: {
          summary: {
            en: '`{ inherit, set }`: variable names to inherit and values to set.',
            zh: '`{ inherit, set }`：要继承的变量名与要设置的值。'
          },
          default: {
            en: 'Omitted: inherit PATH only and set no additional variables.',
            zh: '省略时仅继承 `PATH`，不增加其他环境变量。'
          },
          example: launchPathsExample
        },
        wrap: {
          summary: {
            en: 'Rewrites the computed launch command (e.g. to run inside `sandbox-exec` or `bwrap`) on every launch, restart and replace. Must keep stdin/stdout and environment, and forward the exit code.',
            zh: '在每次启动、重启与替换时改写计算出的启动命令（例如放进 `sandbox-exec` 或 `bwrap`）。必须保留 stdin/stdout 与环境变量，并转发退出码。'
          },
          default: {
            en: 'Omitted: launch the originally computed command without rewriting it.',
            zh: '省略时直接启动原计算命令，不进行命令改写。'
          },
          example: launchWrapExample,
          whenToUse: {
            en: 'Use a native sandbox or wrapper executable while preserving the original arguments, environment, stdio channel and exit status. The wrapper runs on each native launch.',
            zh: '需要原生沙箱或包装可执行文件时使用，须保留原参数、环境、标准通道及退出状态；每次原生启动都会执行。'
          }
        },
        stdio: {
          summary: {
            en: 'stdio routing; default `{ stdin: "channel", stdout: "channel", stderr: "drain" }`.',
            zh: '子进程标准输入输出的走向；默认 `{ stdin: "channel", stdout: "channel", stderr: "drain" }`。'
          },
          default: {
            en: 'Omitted: stdin and stdout use channel; stderr is drained.',
            zh: '省略时标准输入输出用于通道，标准错误持续排空。'
          },
          example: launchResourcesExample
        },
        limits: {
          summary: {
            en: 'Limits such as `callWallTimeMs` per call.',
            zh: '资源限制，例如单次调用的 `callWallTimeMs`。'
          },
          default: {
            en: 'Omitted: request no explicit native resource limits through this field.',
            zh: '省略时不通过此字段请求显式原生资源上限。'
          },
          example: launchResourcesExample
        },
        permissions: {
          summary: {
            en: 'Runtime permissions (Deno).',
            zh: '子进程的运行时权限设置（用于 Deno）。'
          },
          default: {
            en: 'Omitted: supply no explicit permission arguments to the selected runtime.',
            zh: '省略时不向所选运行时提供显式权限参数。'
          },
          example: launchResourcesExample
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
          example: example1,
          whenToUse: {
            en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
            zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
          }
        },
        supervision: {
          summary: {
            en: 'Overrides the original supervisor restart, startup, stop and other policies; retains the same execution-unit owner without installing another supervisor.',
            zh: '覆盖原监督器的重启、启动与停止预算等策略，继续使用同一执行单元所有者，不额外创建监督器。'
          },
          default: {
            en: 'Omitted: the original one-unit best-effort process supervisor defaults.',
            zh: '省略时使用原单执行单元及尽力终止的进程监督器默认策略。'
          },
          example: launchResourcesExample
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
          },
          default: {
            en: 'Omitted: expected launcher notices use the configured or default reporter.',
            zh: '省略时预期启动器提示使用显式配置或默认报告器。'
          },
          example: launchNoticeExample,
          whenToUse: {
            en: 'Separate expected native capability notices from failures in application monitoring, for example when best-effort termination cannot enforce isolation.',
            zh: '应用监控需要将预期原生能力提示与失败分开时使用，例如尽力终止无法强制隔离的情况。'
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
            en: 'Set an application monitoring sink when process background and cleanup failures must join your existing incident reports. Omit it to inherit the configured Host reporter.',
            zh: '需要将原生后台及清理失败汇入应用现有告警时配置；省略则继承宿主显式报告器。'
          },
          example: processReportExample
        },
        verify: {
          whenToUse: {
            en: 'Require an application principal for a listener rather than relying only on same-user socket permissions.',
            zh: '监听端需要应用主体身份，而不能仅依赖同用户套接字权限时设置。'
          },
          example: example1,
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
          example: example7
        },
        name: {
          summary: {
            en: 'Local native registration name, separate from accepted remote identity.',
            zh: '本地原生登记名称，与已接纳的远端身份分开。'
          },
          default: {
            en: 'Omitted: the native registration default.',
            zh: '省略时使用原生登记默认名称。'
          },
          example: processScopeExample
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
          example: processExposureExample
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
          example: processScopeExample
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
        parentLoss: {
          summary: {
            en: 'Actual child parent-loss exit, optional grace and native liveness probe.',
            zh: '实际子端父进程丢失时的退出、可选宽限及原生活性探测。'
          },
          default: {
            en: 'Omitted: the automatic child source supplies its native policy.',
            zh: '省略时由自动子端来源提供原生策略。'
          },
          example: parentLossExample
        },
        'parentLoss.exit': {
          summary: {
            en: 'The actual child exit callback receives the parent-loss guard outcome after its original grace cleanup. It must terminate the native child.',
            zh: '实际子端退出回调接收父端丢失保护器在原宽限清理后的结果，负责终止原生子进程。'
          },
          params: {
            code: {
              en: 'Guard-issued 0 after graceful completion or 1 when forced termination is required.',
              zh: '保护器签发的退出状态：宽限完成取零，需要强制终止取一。'
            }
          },
          returns: {
            en: 'No return value; the original native child exits with the supplied status.',
            zh: '无返回值，原生子进程以提供的状态退出。'
          },
          example: parentLossExample,
          whenToUse: {
            en: 'Provide this when overriding native child parent-loss policy; retain the actual runtime exit operation rather than reporting only.',
            zh: '覆盖原生子端的父进程丢失策略时提供，必须保留实际运行时退出操作，而非仅报告日志。'
          }
        },
        'parentLoss.graceMs': {
          summary: {
            en: 'Finite nonnegative child cleanup grace in milliseconds after actual parent loss; it does not extend a business-call timeout.',
            zh: '实际父端丢失后的有限非负子端清理宽限，单位为毫秒，不延长业务调用超时。'
          },
          default: {
            en: 'Omitted: use the parent-loss guard default 5000ms.',
            zh: '省略时使用父端丢失保护器默认的五千毫秒。'
          },
          example: parentLossExample
        },
        'parentLoss.probe': {
          summary: {
            en: 'Subscribe the original native parent-liveness signal and notify the guard on actual loss; return the exact listener remover.',
            zh: '订阅原生父端活性信号，在实际丢失时通知保护器，并返回精确监听移除器。'
          },
          params: {
            onLost: {
              en: 'Guard callback supplied by installation; call it with the actual parent-loss reason when available.',
              zh: '安装时提供的保护器回调，能够取得实际父端丢失原因时一并传入。'
            }
          },
          returns: {
            en: 'Original unsubscription function; disposal releases this exact native observation.',
            zh: '返回原取消订阅函数，销毁时释放此精确原生观察。'
          },
          default: {
            en: 'Omitted: no additional custom liveness probe.',
            zh: '省略时不添加自定义父端活性探测。'
          },
          example: parentLossExample,
          whenToUse: {
            en: 'Use a real native parent-liveness source in addition to transport EOF; never infer parent authority from business messages.',
            zh: '需要在传输结束之外借用真实原生父端活性来源时使用，不能从业务消息推断父端权限。'
          }
        }
      }
    },
    IProcessSpawnSource: {
      summary: {
        en: 'Actual explicit plugin source union; short forms normalize through the original native owner.',
        zh: '插件的实际显式来源联合，简写通过原原生所有者归一化。'
      },
      example: example1,
      members: {}
    },
    IProcessConnectSource: {
      summary: {
        en: 'Actual explicit plugin source union; short forms normalize through the original native owner.',
        zh: '插件的实际显式来源联合，简写通过原原生所有者归一化。'
      },
      example: example1,
      members: {}
    },
    IProcessListenSource: {
      summary: {
        en: 'Actual explicit plugin source union; short forms normalize through the original native owner.',
        zh: '插件的实际显式来源联合，简写通过原原生所有者归一化。'
      },
      example: example1,
      members: {}
    },
    IIpcLogRecord: {
      summary: {
        en: 'Local backlog/failure observations or explicit process stderr records issued by the actual connection owner. They are diagnostic data, never RPC wire messages. Import from `@migaia/rpc-plugin-process/features/flow-control`.',
        zh: '实际连接所有者签发的本地积压失败观察或显式标准错误记录，是诊断数据，不是调用协议消息。从 `@migaia/rpc-plugin-process/features/flow-control` 导入。'
      },
      members: {
        name: {
          summary: {
            en: 'Original backlog event name, or ipc.stderr for a native stderr presentation record.',
            zh: '原积压事件名，或表示原生标准错误展示记录的 `ipc.stderr`。'
          }
        },
        connectionId: {
          summary: {
            en: 'Connection label supplied by the concrete process installation for this actual physical channel.',
            zh: '具体进程安装为此实际物理通道提供的连接标签。'
          }
        },
        sessionId: {
          summary: {
            en: 'Optional session label supplied by the same installation after native source acquisition.',
            zh: '同一安装在原生来源获取后提供的可选会话标签。'
          }
        },
        pendingData: {
          summary: {
            en: 'Current accepted data-lane writes including the active native write.',
            zh: '当前已接纳的数据通道写入数，包含活动原生写入。'
          }
        },
        pendingControl: {
          summary: {
            en: 'Current accepted control-lane writes including the active native write.',
            zh: '当前已接纳的控制通道写入数，包含活动原生写入。'
          }
        },
        active: {
          summary: {
            en: 'Lane of the active native write, or null when neither lane owns an active write.',
            zh: '活动原生写入所属通道，没有通道拥有活动写入时为空值。'
          }
        },
        trace: {
          summary: {
            en: 'Original optional call trace lent to this local diagnostic event.',
            zh: '借给此本地诊断事件的原可选调用追踪值。'
          }
        },
        error: {
          summary: {
            en: 'Original native write or admission failure; the diagnostic retains its identity and cause.',
            zh: '原生写入或准入失败，诊断保留其身份及原因。'
          }
        },
        processId: {
          summary: {
            en: 'Optional process label supplied by the actual stderr capture owner; never a remote authority.',
            zh: '实际标准错误捕获所有者提供的可选进程标签，不是远端权限。'
          }
        },
        text: {
          summary: {
            en: 'Decoded original stderr text presented by the native capture owner, not an RPC response.',
            zh: '原生捕获所有者提供的原标准错误解码文本，不是远程调用响应。'
          }
        },
        droppedChunks: {
          summary: {
            en: 'Optional native stderr chunk loss count supplied by its bounded capture owner.',
            zh: '有界原生标准错误捕获所有者提供的可选丢失块计数。'
          }
        }
      }
    },
    ISendQueueOptions: {
      summary: {
        en: 'Only capacities are configurable; native labels remain source-owned.',
        zh: '仅可配置容量，原生标签仍归来源所有者。'
      },
      example: example2,
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
          example: example2
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
          example: example2
        },
        flow: {
          summary: {
            en: 'Exact complete flowControl definition shared with this queue, avoiding a second capacity owner.',
            zh: '与此队列共享的精确完整流控定义，避免另一容量所有者。'
          },
          default: {
            en: 'Omitted: the queue creates and owns its flow.',
            zh: '省略时队列创建并拥有流控。'
          },
          example: example2
        }
      }
    },
    IIpcLogOptions: {
      summary: {
        en: 'One application sink borrowed by the original IPC logger.',
        zh: '原进程通信日志借用的一个应用接收器。'
      },
      example: example2,
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
          example: example2,
          whenToUse: {
            en: 'Send native queue and stderr records to the existing application log sink without changing physical send ownership or adding a second queue.',
            zh: '需要将原生队列及标准错误记录送往现有应用日志时使用，不改变物理发送归属，也不增加第二个队列。'
          }
        }
      }
    },
    IIpcFlowControlOptions: {
      summary: {
        en: 'Separate data and control capacities count queued and active native writes.',
        zh: '独立的数据及控制容量计算已排队和活动原生写入。'
      },
      example: example2,
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
          example: example2
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
          example: example2
        }
      }
    },
    IProcessFeature: {
      summary: {
        en: 'Complete call features, native pool, sendQueue, flowControl and ipcLog definitions accepted by Process.',
        zh: '进程接受的完整调用功能、原生池、发送队列、流控及日志定义。'
      },
      members: {},
      example: example2
    },
    IProcessNamespaceExtensions: {
      summary: {
        en: 'Native controls contributed through the process namespace.',
        zh: '通过进程命名空间提供的原生控制。'
      },
      members: {
        members: {
          summary: {
            en: 'SDK process member controls reuse actual supervision, generations and resources.',
            zh: 'SDK 进程成员控制复用实际监督、代次及资源。'
          }
        }
      },
      example: example1
    },
    ISpawnProcessPluginDeployment: {
      summary: {
        en: 'Owned native process launch and exact raw IO acquisition.',
        zh: '所属原生进程启动及精确原始接口获取。'
      },
      members: {
        kind: {
          summary: {
            en: 'Fixed spawn discriminant selecting this original native recipe, not a wire profile.',
            zh: '固定的原生配方判别值，用于选择此来源，不选择协议版本。'
          }
        },
        supervision: {
          summary: {
            en: 'Actual supervisor specification, launcher, budget and lifetime policy.',
            zh: '实际监督规范、启动器、预算及寿命策略。'
          }
        },
        rawChannel: {
          summary: {
            en: 'Receive the real launched handle and signal; return native byte or message IO.',
            zh: '接收真实已启动句柄及信号，返回原生字节或消息接口。'
          },
          params: {
            handle: {
              en: 'Actual IProcessHandle returned by the configured native supervisor launch.',
              zh: '所配置原生监督器启动后返回的真实 `IProcessHandle`。'
            },
            signal: {
              en: 'Preparation signal supplied by the owning registration; abort must stop this acquisition.',
              zh: '所属登记提供的准备信号，取消时必须停止此次获取。'
            }
          },
          returns: {
            en: 'Promise of the actual byte or message channel owned by this native execution; rejection preserves the original cause.',
            zh: '返回此原生执行拥有的实际字节或消息通道承诺，拒绝保留原始原因。'
          }
        },
        channelKind: {
          summary: {
            en: 'Select byte or message physical IO, never a protocol profile.',
            zh: '选择字节或消息物理接口，不选择协议配置。'
          },
          values: {
            byte: {
              en: 'Read and write actual byte chunks through the canonical length-framed carrier.',
              zh: '通过规范长度分帧载体读写实际字节块。'
            },
            message: {
              en: 'Read and write native whole messages through the canonical message carrier.',
              zh: '通过规范消息载体读写原生完整消息。'
            }
          }
        },
        token: {
          summary: {
            en: 'Original private launch credential, never public source identity.',
            zh: '原私有启动凭据，不是公开来源身份。'
          }
        }
      },
      example: example1
    },
    IConnectProcessPluginDeployment: {
      summary: {
        en: 'Supervised local connection to a borrowed external process.',
        zh: '连接借用外部进程的受监督本地连接。'
      },
      members: {
        kind: {
          summary: {
            en: 'Fixed connect discriminant selecting this original native recipe, not a wire profile.',
            zh: '固定的原生配方判别值，用于选择此来源，不选择协议版本。'
          }
        },
        address: {
          summary: {
            en: 'Actual endpoint address selected by the application.',
            zh: '应用选择的实际端点地址。'
          }
        },
        token: {
          summary: {
            en: 'Credential supplied for this native connection.',
            zh: '为此原生连接提供的凭据。'
          }
        },
        dial: {
          summary: {
            en: 'Open the native address with the supplied cancellation signal.',
            zh: '使用提供的取消信号打开原生地址。'
          },
          params: {
            address: {
              en: 'Configured address from this deployment; the listener or rendezvous publishes it.',
              zh: '此配方配置的地址，由监听器或命名会合点发布。'
            },
            signal: {
              en: 'Owning registration preparation signal; release the original pending socket on abort.',
              zh: '所属登记的准备信号，取消时释放原待定套接字。'
            }
          },
          returns: {
            en: 'Promise of one actual native byte channel; the remote external process remains borrowed.',
            zh: '返回一个实际原生字节通道的承诺，远端外部进程仍为借用。'
          }
        },
        supervision: {
          summary: {
            en: 'Original local socket lifecycle settings, not ownership of the remote process.',
            zh: '原本地套接字寿命设置，不代表拥有远端进程。'
          }
        }
      },
      example: example1
    },
    IProcessServeChildIngress: {
      summary: {
        en: 'Native child ingress preserving startup and parent-loss resource ownership.',
        zh: '保留启动及父进程丢失资源所有权的原生子端入口。'
      },
      members: {
        kind: {
          summary: {
            en: 'Fixed child discriminant selecting this original native recipe, not a wire profile.',
            zh: '固定的原生配方判别值，用于选择此来源，不选择协议版本。'
          }
        },
        channelKind: {
          summary: {
            en: 'Actual byte or message acquisition mode.',
            zh: '实际字节或消息获取方式。'
          },
          values: {
            byte: {
              en: 'Read and write actual byte chunks through the canonical length-framed carrier.',
              zh: '通过规范长度分帧载体读写实际字节块。'
            },
            message: {
              en: 'Read and write native whole messages through the canonical message carrier.',
              zh: '通过规范消息载体读写原生完整消息。'
            }
          }
        },
        openRaw: {
          summary: {
            en: 'Acquire actual native IO and, for bytes, original bootstrap bytes.',
            zh: '获取实际原生接口；字节来源还提供原始启动字节。'
          },
          params: {
            signal: {
              en: 'Child ingress preparation signal supplied by its actual installation.',
              zh: '真实安装提供的子端入口准备信号。'
            }
          },
          returns: {
            en: 'Native message channel, or byte channel plus the original bootstrap bytes; ownership transfers to the child serve operation.',
            zh: '返回原生消息通道，或字节通道及原启动字节；所有权交给子端服务操作。'
          }
        },
        parentLoss: {
          summary: {
            en: 'Actual native exit callback, grace and optional parent liveness probe.',
            zh: '实际原生退出回调、宽限及可选父端活性探测。'
          }
        }
      },
      example: example1
    },
    IProcessServeListenerIngress: {
      summary: {
        en: 'Native bind, pending socket custody and one-time accept transfer.',
        zh: '原生绑定、待接纳套接字保管及一次性接纳转交。'
      },
      members: {
        kind: {
          summary: {
            en: 'Fixed listener discriminant selecting this original native recipe, not a wire profile.',
            zh: '固定的原生配方判别值，用于选择此来源，不选择协议版本。'
          }
        },
        listen: {
          summary: {
            en: 'Bind native IO and transfer each actual pending socket once.',
            zh: '绑定原生接口，并转交每个实际待接纳套接字一次。'
          }
        },
        address: {
          summary: {
            en: 'Actual native address held by this listener.',
            zh: '此监听器持有的实际原生地址。'
          }
        },
        verify: {
          summary: {
            en: 'Configured verifier accepts auth data and admitted peer facts; authentication flow remains its separate owner.',
            zh: '配置的校验回调接收认证数据及已接纳对端事实；认证流程保持独立所有权。'
          },
          params: {
            auth: {
              en: 'Portable credential supplied by the incoming handshake; undefined means no credential was sent.',
              zh: '传入握手提供的可移植凭据，空值表示未发送凭据。'
            },
            peer: {
              en: 'Peer metadata from that same candidate handshake, not a separately trusted principal.',
              zh: '同一候选握手提供的对端元数据，不是另行授信的主体。'
            }
          },
          returns: {
            en: 'Verified principal string or its Promise; throw or rejection refuses this candidate.',
            zh: '返回验证后的主体字符串或其承诺，抛错或拒绝会拒绝该候选。'
          }
        },
        scheduler: {
          summary: {
            en: 'Native listener and grace scheduler.',
            zh: '原生监听及宽限调度器。'
          }
        },
        createConnectionContext: {
          summary: {
            en: 'Build local labels and stderr logging facts from the real pending connection.',
            zh: '从真实待接纳连接建立本地标签及标准错误日志事实。'
          },
          params: {
            pending: {
              en: 'Actual pending native socket supplied by listen before its one-time accept transfer.',
              zh: '监听器在一次性接纳转交前提供的真实待接纳原生套接字。'
            }
          },
          returns: {
            en: 'Local peer label and original IPC logging/stderr facts for this connection; it grants no provider authority.',
            zh: '返回此连接的本地对端标签及原日志、标准错误事实，不授予提供方权限。'
          }
        }
      },
      example: example1
    },
    IpcFlowControl: {
      summary: {
        en: 'Lower-level native installation value. Applications normally install the complete feature factory; a custom native owner supplies its real feature context.',
        zh: '底层原生安装值。应用通常安装完整功能工厂；自定义原生所有者提供真实功能上下文。'
      },
      members: {
        run: {
          summary: {
            en: 'Admit native send-class facts and execute the original physical write, retaining its failure identity.',
            zh: '接纳原生发送类别事实并执行原物理写入，保留其失败身份。'
          },
          params: {
            facts: {
              en: 'Admitted semantic data/control class and optional trace.',
              zh: '已接纳语义的数据或控制类别及可选追踪值。'
            },
            write: {
              en: 'Actual native write operation and optional batch guard.',
              zh: '实际原生写入操作及可选批次保护。'
            },
            admission: {
              en: 'Original signal and pre-send validity facts.',
              zh: '原信号及发送前有效性事实。'
            },
            schedule: {
              en: 'Optional original FIFO scheduling operation.',
              zh: '可选的原先进先出调度操作。'
            }
          },
          returns: {
            en: 'Promise settled by actual write completion or the original admission failure.',
            zh: '由实际写入完成或原接纳失败结算的承诺。'
          },
          example: example5
        },
        onEvent: {
          summary: {
            en: 'Subscribe to the existing shared flow event source; duplicate callbacks retain independent removers.',
            zh: '订阅既有共享流控事件源；重复回调保留独立移除函数。'
          },
          params: {
            listener: {
              en: 'Receives local immutable backlog/failure facts.',
              zh: '接收本地不可变积压或失败事实。'
            }
          },
          returns: {
            en: 'Idempotent remover for this subscription only.',
            zh: '仅移除此订阅的幂等移除函数。'
          },
          example: example5
        },
        close: {
          summary: {
            en: 'Close new admission synchronously; active native writes retain their original settlement.',
            zh: '同步关闭新接纳；活动原生写入保留原结算。'
          },
          params: {
            reason: {
              en: 'Original local close reason.',
              zh: '原本地关闭原因。'
            }
          },
          returns: {
            en: 'Void; queued cancellation and owned flow cleanup begin at this owner.',
            zh: '返回空值；此所有者开始排队取消及所属流控清理。'
          },
          example: example5
        },
        whenIdle: {
          summary: {
            en: 'Join accepted native work after close without a remote acknowledgement.',
            zh: '关闭后等待已接纳原生工作，不依赖远端确认。'
          },
          params: {},
          returns: {
            en: 'The existing pending drain Promise.',
            zh: '既有待完成排空承诺。'
          },
          example: example5
        },
        reportFailure: {
          summary: {
            en: 'Publish an original native limiter failure through this flow event source.',
            zh: '通过此流控事件源发布原生限流失败。'
          },
          params: {
            error: {
              en: 'Original failure object retained by the native owner.',
              zh: '原生所有者保留的原失败对象。'
            }
          },
          returns: {
            en: 'Void; no second event source is created.',
            zh: '返回空值，不创建第二事件源。'
          },
          example: example5
        }
      },
      example: example5,
      scenarios: [
        {
          en: 'Custom native SDK installation already owns actual context and physical IO.',
          zh: '自定义原生 SDK 安装已拥有实际上下文及物理接口。'
        }
      ]
    },
    IpcSendQueue: {
      summary: {
        en: 'Lower-level native installation value. Applications normally install the complete feature factory; a custom native owner supplies its real feature context.',
        zh: '底层原生安装值。应用通常安装完整功能工厂；自定义原生所有者提供真实功能上下文。'
      },
      members: {
        run: {
          summary: {
            en: 'Admit native send-class facts and execute the original physical write, retaining its failure identity.',
            zh: '接纳原生发送类别事实并执行原物理写入，保留其失败身份。'
          },
          params: {
            facts: {
              en: 'Admitted semantic data/control class and optional trace.',
              zh: '已接纳语义的数据或控制类别及可选追踪值。'
            },
            write: {
              en: 'Actual native write operation and optional batch guard.',
              zh: '实际原生写入操作及可选批次保护。'
            },
            admission: {
              en: 'Original signal and pre-send validity facts.',
              zh: '原信号及发送前有效性事实。'
            }
          },
          returns: {
            en: 'Promise settled by actual write completion or the original admission failure.',
            zh: '由实际写入完成或原接纳失败结算的承诺。'
          },
          example: example6
        },
        onEvent: {
          summary: {
            en: 'Subscribe to the existing shared flow event source; duplicate callbacks retain independent removers.',
            zh: '订阅既有共享流控事件源；重复回调保留独立移除函数。'
          },
          params: {
            listener: {
              en: 'Receives local immutable backlog/failure facts.',
              zh: '接收本地不可变积压或失败事实。'
            }
          },
          returns: {
            en: 'Idempotent remover for this subscription only.',
            zh: '仅移除此订阅的幂等移除函数。'
          },
          example: example6
        },
        close: {
          summary: {
            en: 'Close new admission synchronously; active native writes retain their original settlement.',
            zh: '同步关闭新接纳；活动原生写入保留原结算。'
          },
          params: {
            reason: {
              en: 'Original local close reason.',
              zh: '原本地关闭原因。'
            }
          },
          returns: {
            en: 'Void; queued cancellation and owned flow cleanup begin at this owner.',
            zh: '返回空值；此所有者开始排队取消及所属流控清理。'
          },
          example: example6
        },
        whenIdle: {
          summary: {
            en: 'Join accepted native work after close without a remote acknowledgement.',
            zh: '关闭后等待已接纳原生工作，不依赖远端确认。'
          },
          params: {},
          returns: {
            en: 'The existing pending drain Promise.',
            zh: '既有待完成排空承诺。'
          },
          example: example6
        },
        flow: {
          summary: {
            en: 'The exact flow capacity owner shared by queue and observers.',
            zh: '队列及观察者共享的精确流控容量所有者。'
          }
        }
      },
      example: example6,
      scenarios: [
        {
          en: 'Custom native SDK installation already owns actual context and physical IO.',
          zh: '自定义原生 SDK 安装已拥有实际上下文及物理接口。'
        }
      ]
    },
    IProcessFeatureContext: {
      summary: {
        en: 'Actual installation and native connection facts supplied by the transport.',
        zh: '传输提供的实际安装及原生连接事实。'
      },
      members: {
        owner: {
          summary: {
            en: 'Actual PluginHost core owner.',
            zh: '实际插件宿主核心所有者。'
          }
        },
        namespace: {
          summary: {
            en: 'Installed transport namespace.',
            zh: '已安装传输命名空间。'
          }
        },
        signal: {
          summary: {
            en: 'Original installation lifetime signal.',
            zh: '原安装寿命信号。'
          }
        },
        report: {
          summary: {
            en: 'Original native failure reporter.',
            zh: '原原生失败报告器。'
          }
        },
        connectionId: {
          summary: {
            en: 'Identity issued by this native connection owner.',
            zh: '此原生连接所有者签发的标识。'
          }
        },
        sessionId: {
          summary: {
            en: 'Accepted Session identifier when available.',
            zh: '可用时的已接纳会话标识。'
          }
        },
        flow: {
          summary: {
            en: 'Exact shared complete feature and installed value receipt.',
            zh: '精确共享的完整功能及安装值凭据。'
          }
        }
      },
      example: example2
    },
    IIpcSendFacts: {
      summary: {
        en: 'Semantic write facts supplied before physical encoding.',
        zh: '物理编码前提供的语义写入事实。'
      },
      members: {
        sendClass: {
          summary: {
            en: 'Actual data/control classification, not opaque payload inspection.',
            zh: '实际数据或控制分类，不检查不透明载荷。'
          },
          values: {
            data: {
              en: 'An admitted business-data write uses the data capacity lane.',
              zh: '已接纳的业务数据写入使用数据容量通道。'
            },
            control: {
              en: 'An admitted lifecycle/control write uses the separate control capacity lane.',
              zh: '已接纳的生命周期或控制写入使用独立控制容量通道。'
            }
          }
        },
        trace: {
          summary: {
            en: 'Original optional call trace supplied before encoding; diagnostic correlation does not alter the payload.',
            zh: '编码前提供的原可选调用追踪值，仅用于诊断关联，不改变载荷。'
          }
        }
      },
      example: example2
    },
    IIpcSendAdmission: {
      summary: {
        en: 'Original caller cancellation and physical admission checks.',
        zh: '原调用方取消及物理接纳检查。'
      },
      members: {
        signal: {
          summary: {
            en: 'Original caller signal until native handoff.',
            zh: '原生交接前的原调用方信号。'
          }
        },
        assertCanSend: {
          summary: {
            en: 'Run the original synchronous open/cancellation check immediately before native handoff.',
            zh: '原生交接前立即运行原同步开放状态及取消检查。'
          },
          params: {},
          returns: {
            en: 'No value when admission is valid; throwing the original error rejects the write before native handoff.',
            zh: '准入有效时无需返回值；抛出原错误会在原生交接前拒绝写入。'
          }
        },
        coalesced: {
          summary: {
            en: 'True for actual logical batching participation.',
            zh: '实际参与逻辑合批时为真。'
          }
        }
      },
      example: example2
    },
    IIpcLogContext: {
      summary: {
        en: 'Actual log installation context with optional existing flow observation.',
        zh: '带可选既有流控观察的实际日志安装上下文。'
      },
      members: {
        gate: {
          summary: {
            en: 'Existing flow event source; omission adds no new capacity policy.',
            zh: '既有流控事件源；省略不会添加容量策略。'
          }
        },
        onReportError: {
          summary: {
            en: 'Receives sink failures with the original record.',
            zh: '接收日志接收器失败及原记录。'
          },
          params: {
            error: {
              en: 'Original thrown or rejected failure from the application log sink.',
              zh: '应用日志接收器抛出或拒绝的原始失败。'
            },
            record: {
              en: 'The exact IIpcLogRecord passed to that failing sink; supplied by the native connection owner.',
              zh: '传给失败接收器的精确 `IIpcLogRecord`，由原生连接所有者提供。'
            }
          },
          returns: {
            en: 'Void or Promise after reporting the sink failure; this callback does not retry the physical write.',
            zh: '报告接收器失败后返回空值或承诺，不重试物理写入。'
          }
        },
        connectionId: {
          summary: {
            en: 'Connection label supplied by the concrete process installation for this actual physical channel.',
            zh: '具体进程安装为此实际物理通道提供的连接标签。'
          }
        },
        sessionId: {
          summary: {
            en: 'Optional session label supplied by the same installation after native source acquisition.',
            zh: '同一安装在原生来源获取后提供的可选会话标签。'
          }
        },
        flow: {
          summary: {
            en: 'Borrow the exact installed flow definition and value; logging must not create another capacity owner.',
            zh: '借用精确已安装流控定义及其实值，日志不得另建容量所有者。'
          }
        }
      },
      example: example2
    },
    IIpcWrite: {
      summary: {
        en: 'Native whole logical write callback with optional queued batch withdrawal guard.',
        zh: '带可选排队批次撤销保护的原生完整逻辑写入回调。'
      },
      members: {},
      example: example2
    },
    IIpcBatchGuard: {
      summary: {
        en: 'Registers only this queued batch member cancellation and returns its exact remover.',
        zh: '仅登记此排队批次成员的取消，并返回其精确移除函数。'
      },
      members: {},
      example: example2
    },
    IIpcSchedule: {
      summary: {
        en: 'Original FIFO scheduling callback receiving one native write operation.',
        zh: '接收一个原生写入操作的原先进先出调度回调。'
      },
      members: {},
      example: example2
    },
    IRpcFlowControlFeature: {
      summary: {
        en: 'Complete definition returned by flowControl, shared by exact object identity.',
        zh: '流控工厂返回的完整定义，通过精确对象身份共享。'
      },
      members: {},
      example: example2
    },
    IIpcBacklogEvent: {
      summary: {
        en: 'Immutable local flow snapshot issued on capacity transitions or send failure; it contains no business envelope.',
        zh: '容量转换或发送失败时签发的不可变本地流控快照，不包含业务封装。'
      },
      members: {
        name: {
          summary: {
            en: 'Original local backlog or send-failure event name issued by the flow owner.',
            zh: '流控所有者签发的原本地积压或发送失败事件名称。'
          }
        },
        connectionId: {
          summary: {
            en: 'Connection label supplied by the concrete process installation for this actual physical channel.',
            zh: '具体进程安装为此实际物理通道提供的连接标签。'
          }
        },
        sessionId: {
          summary: {
            en: 'Optional session label supplied by the same installation after native source acquisition.',
            zh: '同一安装在原生来源获取后提供的可选会话标签。'
          }
        },
        pendingData: {
          summary: {
            en: 'Current accepted data-lane writes including the active native write.',
            zh: '当前已接纳的数据通道写入数，包含活动原生写入。'
          }
        },
        pendingControl: {
          summary: {
            en: 'Current accepted control-lane writes including the active native write.',
            zh: '当前已接纳的控制通道写入数，包含活动原生写入。'
          }
        },
        active: {
          summary: {
            en: 'Lane of the active native write, or null when neither lane owns an active write.',
            zh: '活动原生写入所属通道，没有通道拥有活动写入时为空值。'
          }
        },
        trace: {
          summary: {
            en: 'Original optional call trace lent to this local diagnostic event.',
            zh: '借给此本地诊断事件的原可选调用追踪值。'
          }
        },
        error: {
          summary: {
            en: 'Original native write or admission failure; the diagnostic retains its identity and cause.',
            zh: '原生写入或准入失败，诊断保留其身份及原因。'
          }
        }
      }
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
          zh: '原生写入失败后发出的本地发送诊断记录。'
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
      install: example1,
      grants: [
        {
          signature: 'host.process.members',
          summary: {
            en: 'Borrow the actual native source member controls from this namespace.',
            zh: '从此命名空间借用实际原生来源的成员控制。'
          },
          params: {},
          returns: {
            en: 'SDK native controls for real stop, restart, replacement, events and resource queries.',
            zh: '返回用于真实停止、重启、替换、事件及资源查询的 SDK 原生控制。'
          },
          example: example1
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
    },
    sendQueue: {
      kind: 'feature',
      target: 'processPlugin.features',
      summary: {
        en: 'Create a complete connection-local FIFO feature. The queue waits for each original native write Promise and borrows one flow capacity owner.',
        zh: '创建连接本地的完整先进先出功能，等待每个原生写入承诺并借用唯一流控容量所有者。'
      },
      install: example2,
      grants: [],
      behaviors: [
        {
          en: 'The actual carrier installs it once per native connection and releases that installation on close.',
          zh: '实际载体逐原生连接安装一次，并在关闭时释放此次安装。'
        }
      ],
      scenarios: [
        {
          en: 'Bound or observe native backlog independently from remote provider concurrency.',
          zh: '独立于远端提供方并发限制或观察原生积压。'
        }
      ],
      example: example2
    },
    ipcLog: {
      kind: 'feature',
      target: 'processPlugin.features',
      summary: {
        en: 'Create a complete local log feature for actual backlog, send failures and captured stderr. Logging alone does not install flow control.',
        zh: '为实际积压、发送失败及捕获的标准错误创建完整本地日志功能；单独日志不会启用流控。'
      },
      install: example2,
      grants: [],
      behaviors: [
        {
          en: 'The actual carrier installs it once per native connection and releases that installation on close.',
          zh: '实际载体逐原生连接安装一次，并在关闭时释放此次安装。'
        }
      ],
      scenarios: [
        {
          en: 'Bound or observe native backlog independently from remote provider concurrency.',
          zh: '独立于远端提供方并发限制或观察原生积压。'
        }
      ],
      example: example2
    },
    flowControl: {
      kind: 'feature',
      target: 'processPlugin.features',
      summary: {
        en: 'Create one complete two-lane native-write admission feature. A sendQueue may share this exact definition.',
        zh: '创建完整的双通道原生写入接纳功能，发送队列可共享此精确定义。'
      },
      install: example2,
      grants: [],
      behaviors: [
        {
          en: 'The actual carrier installs it once per native connection and releases that installation on close.',
          zh: '实际载体逐原生连接安装一次，并在关闭时释放此次安装。'
        }
      ],
      scenarios: [
        {
          en: 'Bound or observe native backlog independently from remote provider concurrency.',
          zh: '独立于远端提供方并发限制或观察原生积压。'
        }
      ],
      example: example2
    }
  }
}
