/**
 * Bilingual public reference for @migaia/rpc-plugin-coroutines; native and call ownership follow
 * the actual package API.
 */
import { rpcPluginOptionDocs } from './rpc-runtime-shared.js'
import type { ILibraryReference } from './contract.js'

/** Authored public modules, symbols, configuration and ownership contracts. */
export const rpcCoroutinesReference: ILibraryReference = {
  modules: {
    index: {
      summary: {
        en: 'Run a cooperative task on real MessageChannel; original supervision owns generations, budget, stop and replacement. Same-loop tasks provide no process or Worker isolation and cannot preempt synchronous blocking. Parent uses spawn: task; child receives the exact opaque context.connect, never true.',
        zh: '经真实消息通道运行协作任务，原监督器拥有代次、预算、停止和替换。同事件循环任务不提供进程或线程隔离，不能抢占同步阻塞。父端提供任务函数，子端接收上下文的精确不透明连接句柄，不能使用真值。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      connect: { timeoutMs: 1500 },\n      spawn: async ({ connect, signal, heartbeat }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        heartbeat()\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    })\n  ]\n})\ntry {\n  console.log(await parent.request('double', 21))\n} finally {\n  await parent.close()\n}"
    }
  },
  symbols: {
    coroutinePlugin: {
      role: 'enhancer',
      purpose: {
        en: 'Run a cooperative task on real MessageChannel; original supervision owns generations, budget, stop and replacement. Same-loop tasks provide no process or Worker isolation and cannot preempt synchronous blocking.',
        zh: '经真实消息通道运行协作任务，原监督器拥有代次、预算、停止和替换。同事件循环任务不提供进程或线程隔离，不能抢占同步阻塞。'
      },
      options: 'ICoroutinePluginOptions',
      returns: {
        en: 'Registered cold transport definition for createRpcHost or ordinary PluginHost. Preserve exact object identity.',
        zh: '返回供统一宿主或普通插件宿主安装的冷传输定义，须保留精确对象身份。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      connect: { timeoutMs: 1500 },\n      spawn: async ({ connect, signal, heartbeat }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        heartbeat()\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    })\n  ]\n})\ntry {\n  console.log(await parent.request('double', 21))\n} finally {\n  await parent.close()\n}"
    },
    RPC_COROUTINE_ERROR_SOURCE: {
      role: 'error',
      purpose: {
        en: 'Stable rpc.transport.coroutine source admission domain; business and supervision errors keep their original owners.',
        zh: '稳定的协程传输来源准入领域，业务及监督错误保留原所有者。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      connect: { timeoutMs: 1500 },\n      spawn: async ({ connect, signal, heartbeat }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        heartbeat()\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    })\n  ]\n})\ntry {\n  console.log(await parent.request('double', 21))\n} finally {\n  await parent.close()\n}"
    },
    RpcCoroutineErrorCode: {
      role: 'error',
      purpose: {
        en: 'Registered source admission failure attached to native TypeError without replacing the original instance.',
        zh: '附加到原生类型错误的来源准入失败，不替换原实例。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      connect: { timeoutMs: 1500 },\n      spawn: async ({ connect, signal, heartbeat }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        heartbeat()\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    })\n  ]\n})\ntry {\n  console.log(await parent.request('double', 21))\n} finally {\n  await parent.close()\n}"
    }
  },
  types: {
    ICoroutinePluginOptions: {
      summary: {
        en: 'Exactly one task spawn or genuine parent handle plus cold installation configuration.',
        zh: '一个任务启动或真实父端句柄，加上冷安装配置。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      connect: { timeoutMs: 1500 },\n      spawn: async ({ connect, signal, heartbeat }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        heartbeat()\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    })\n  ]\n})\ntry {\n  console.log(await parent.request('double', 21))\n} finally {\n  await parent.close()\n}",
      members: {
        'connect.timeoutMs': {
          summary: {
            en: 'Finite positive identity/capability handshake budget shared by the original identity and ACK phases, independent of task and call deadlines.',
            zh: '有限正数的身份及能力握手预算，由原身份与确认阶段共用，与任务及调用期限分开。'
          },
          default: {
            en: 'Omitted: use the original source/default handshake budget.',
            zh: '省略时使用原来源或默认握手预算。'
          }
        },
        self: {
          summary: {
            en: 'Application-owned local name and instanceId for ordinary Host installation; publish only the safe identity fields. Explicit createRpcHost identity takes precedence.',
            zh: '应用为普通宿主安装提供的本端名称与实例标识，仅发布安全身份字段；显式 createRpcHost 身份优先。'
          },
          default: {
            en: 'Omitted: retain the canonical Host identity and generated instanceId.',
            zh: '省略时保留规范宿主身份及生成的实例标识。'
          }
        },
        provide: {
          summary: {
            en: 'Local methods, descriptors or permitted forwarding entries compiled by the existing provider owner. Explicit createRpcHost providers remain its input.',
            zh: '由既有提供方所有者编译的本端方法、描述符或获准转发条目；显式 createRpcHost 提供方仍作为宿主输入。'
          },
          default: {
            en: 'Omitted: add no application methods through this plugin option.',
            zh: '省略时不经此插件选项添加应用方法。'
          }
        },
        providerLimits: {
          summary: {
            en: 'Original provider admission limits for ordinary Host installation; they do not add another registry or transport queue.',
            zh: '普通宿主安装沿用的原提供方接纳限制，不增加另一登记表或传输队列。'
          },
          default: {
            en: 'Omitted: retain the existing provider owner defaults.',
            zh: '省略时保留既有提供方默认值。'
          }
        },
        authentication: {
          summary: {
            en: 'Original sign/verify/encrypt configuration used by ordinary Host installation. It protects the accepted connection without granting process or Worker isolation.',
            zh: '普通宿主安装使用的原签名、校验及加密配置，保护已接受连接，不授予进程或工作程序隔离。'
          },
          default: {
            en: 'Omitted: add no authentication configuration through this option.',
            zh: '省略时不经此选项添加认证配置。'
          }
        },
        probe: {
          summary: {
            en: 'One observer or an array of observers forwarded to the same canonical endpoint observation owner.',
            zh: '转交同一规范端点观察所有者的单个观察器或观察器数组。'
          },
          default: {
            en: 'Omitted: install no additional probe from this option.',
            zh: '省略时不经此选项安装额外观察器。'
          }
        },
        defaultTimeoutMs: {
          summary: {
            en: 'Default request and stream deadline for ordinary Host installation; it is independent of handshake and cooperative task stop budgets.',
            zh: '普通宿主安装的默认请求及流期限，与握手和协作任务停止预算分开。'
          },
          default: {
            en: 'Omitted: retain the original runtime call default.',
            zh: '省略时保留原运行时调用默认值。'
          }
        },
        contract: {
          summary: {
            en: 'Local remote-method declaration consumed by the existing method compiler, including schemas, call modes and idempotency.',
            zh: '交由既有方法编译器消费的对端方法本地声明，包含结构、调用模式及幂等性。'
          },
          default: {
            en: 'Omitted: retain the original declaration inference.',
            zh: '省略时保留原声明推导。'
          }
        },
        report: {
          summary: {
            en: 'Application error sink for background task, binding and installation failures; existing reporting keeps original error identity and cause chains.',
            zh: '接收后台任务、绑定及安装失败的应用错误接收器，既有报告保留原错误身份及原因链。'
          },
          default: {
            en: 'Omitted: borrow the Host effective reporter.',
            zh: '省略时借用宿主的有效报告器。'
          }
        },
        keyFactory: {
          summary: {
            en: 'Generate idempotency keys through the original managed task proxy. Parent-handle direct connections do not acquire a second retry owner.',
            zh: '经原托管任务代理生成幂等键；父端句柄直连不会获取第二个重试所有者。'
          },
          default: {
            en: 'Omitted: use the original managed proxy key factory.',
            zh: '省略时使用原托管代理的幂等键工厂。'
          }
        },
        retryPort: {
          summary: {
            en: 'Dispatch whole invocations through the original managed task proxy retry port, preserving its generation and cancellation ownership.',
            zh: '经原托管任务代理的重试端口分派完整调用，保留其代次及取消归属。'
          },
          default: {
            en: 'Omitted: use the existing managed retry port.',
            zh: '省略时使用既有托管重试端口。'
          }
        },

        spawn: {
          summary: {
            en: 'Actual task function. Returning settles its generation and closes native ports.',
            zh: '实际任务函数，返回会结束本代并关闭原生端口。'
          },
          default: {
            en: 'Absent in child mode.',
            zh: '子端模式不提供。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'\n\nexport const task: ICoroutineUserTask = async ({ connect, signal }) => {\n  const child = await createRpcHost({\n    plugins: [coroutinePlugin({ connectToParent: connect })],\n    provide: { echo: (value: string) => value }\n  })\n  try {\n    if (!signal.aborted)\n      await new Promise<void>((resolve) => {\n        signal.addEventListener('abort', () => resolve(), { once: true })\n      })\n  } finally {\n    await child.close()\n  }\n}"
        },
        connectToParent: {
          summary: {
            en: 'Exact opaque context.connect issued by this task invocation, not copied or reused.',
            zh: '本次任务调用签发的精确不透明句柄，不可复制或复用。'
          },
          default: {
            en: 'Absent in spawn mode.',
            zh: '启动模式不提供。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      connect: { timeoutMs: 1500 },\n      spawn: async ({ connect, signal, heartbeat }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        heartbeat()\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    })\n  ]\n})\ntry {\n  console.log(await parent.request('double', 21))\n} finally {\n  await parent.close()\n}"
        },
        supervisor: {
          summary: {
            en: 'Original restart, terminalPolicy, startupTimeoutMs, stop, budget and heartbeat policy.',
            zh: '原重启、终态、启动期限、停止、预算与心跳策略。'
          },
          default: {
            en: 'Omitted: original supervisor defaults.',
            zh: '省略时使用原监督默认。'
          },
          example:
            "import { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'\nimport { retryFeature, timeoutFeature } from '@migaia/rpc-host/features'\n\nexport function taskPlugins(task: ICoroutineUserTask) {\n  return [\n    coroutinePlugin({ spawn: task, supervisor: { startupTimeoutMs: 1500 } }),\n    retryFeature(),\n    timeoutFeature({ ms: 1000 })\n  ]\n}"
        },
        connect: {
          summary: {
            en: 'Original identity/capability handshake budget, separate from task stop and call timeouts.',
            zh: '原身份及能力握手预算，与任务停止及调用期限分开。'
          },
          default: {
            en: 'Omitted: original source/default budget.',
            zh: '省略时使用原来源或默认预算。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      connect: { timeoutMs: 1500 },\n      spawn: async ({ connect, signal, heartbeat }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        heartbeat()\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    })\n  ]\n})\ntry {\n  console.log(await parent.request('double', 21))\n} finally {\n  await parent.close()\n}"
        },
        name: {
          ...rpcPluginOptionDocs.name,
          default: {
            en: 'Omitted: coroutine registration name.',
            zh: '省略时使用协程登记名。'
          }
        },
        expose: {
          ...rpcPluginOptionDocs.expose,
          default: {
            en: 'Omitted: original exposure policy.',
            zh: '省略时使用原公开策略。'
          }
        }
      }
    },
    ICoroutineConnect: {
      summary: {
        en: 'Generation-local opaque authority issued only by the original task registry. Physical ports and reporter ownership remain hidden.',
        zh: '仅由原任务登记签发的代内不透明权限，物理端口和报告器归属保持隐藏。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      connect: { timeoutMs: 1500 },\n      spawn: async ({ connect, signal, heartbeat }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        heartbeat()\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    })\n  ]\n})\ntry {\n  console.log(await parent.request('double', 21))\n} finally {\n  await parent.close()\n}",
      members: {}
    },
    ICoroutineUserTask: {
      summary: {
        en: 'Function receiving ICoroutineTaskContext and returning void or a thenable. Keep it alive until work or stop completes; use finally for child cleanup.',
        zh: '接收任务上下文并返回空值或可等待对象的函数，保持运行直到业务或停止完成，并在最终清理中关闭子端。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'\n\nexport const task: ICoroutineUserTask = async ({ connect, signal }) => {\n  const child = await createRpcHost({\n    plugins: [coroutinePlugin({ connectToParent: connect })],\n    provide: { echo: (value: string) => value }\n  })\n  try {\n    if (!signal.aborted)\n      await new Promise<void>((resolve) => {\n        signal.addEventListener('abort', () => resolve(), { once: true })\n      })\n  } finally {\n    await child.close()\n  }\n}",
      members: {}
    },
    ICoroutineTaskContext: {
      summary: {
        en: 'Original per-task lifetime, liveness and source authority.',
        zh: '原逐任务寿命、活性及来源权限。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      connect: { timeoutMs: 1500 },\n      spawn: async ({ connect, signal, heartbeat }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        heartbeat()\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    })\n  ]\n})\ntry {\n  console.log(await parent.request('double', 21))\n} finally {\n  await parent.close()\n}",
      members: {
        signal: {
          summary: {
            en: 'Supervised task lifetime signal; cancellation is cooperative.',
            zh: '监督任务寿命信号，取消须协作执行。'
          }
        },
        connect: {
          summary: {
            en: 'Exact handle for this invocation only; never cross a generation.',
            zh: '仅供本次调用的精确句柄，不跨代使用。'
          }
        },
        heartbeat: {
          summary: {
            en: 'Report liveness to the original configured policy without completing business work.',
            zh: '向原配置策略报告活性，不代表业务完成。'
          },
          params: {},
          returns: {
            en: 'Void; all timing remains supervisor-owned.',
            zh: '返回空值，所有计时仍归监督器。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      connect: { timeoutMs: 1500 },\n      spawn: async ({ connect, signal, heartbeat }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        heartbeat()\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    })\n  ]\n})\ntry {\n  console.log(await parent.request('double', 21))\n} finally {\n  await parent.close()\n}"
        }
      }
    },
    ICoroutineReplaceSpec: {
      summary: {
        en: 'Replacement input for the original native outlet transaction.',
        zh: '原原生出口事务使用的替换输入。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'\n\nexport const task: ICoroutineUserTask = async ({ connect, signal }) => {\n  const child = await createRpcHost({\n    plugins: [coroutinePlugin({ connectToParent: connect })],\n    provide: { echo: (value: string) => value }\n  })\n  try {\n    if (!signal.aborted)\n      await new Promise<void>((resolve) => {\n        signal.addEventListener('abort', () => resolve(), { once: true })\n      })\n  } finally {\n    await child.close()\n  }\n}",
      members: {
        task: {
          summary: {
            en: 'Next actual task function, wrapped through the same token/reporter registry.',
            zh: '下一实际任务函数，经同一令牌及报告器登记包装。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'\n\nexport const task: ICoroutineUserTask = async ({ connect, signal }) => {\n  const child = await createRpcHost({\n    plugins: [coroutinePlugin({ connectToParent: connect })],\n    provide: { echo: (value: string) => value }\n  })\n  try {\n    if (!signal.aborted)\n      await new Promise<void>((resolve) => {\n        signal.addEventListener('abort', () => resolve(), { once: true })\n      })\n  } finally {\n    await child.close()\n  }\n}"
        }
      }
    },
    ICoroutineSupervisorPolicy: {
      summary: {
        en: 'Partial original supervision configuration; no separate task scheduler or retry state.',
        zh: '原监督配置的部分选择，不另建任务调度或重试状态。'
      },
      example:
        "import { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'\nimport { retryFeature, timeoutFeature } from '@migaia/rpc-host/features'\n\nexport function taskPlugins(task: ICoroutineUserTask) {\n  return [\n    coroutinePlugin({ spawn: task, supervisor: { startupTimeoutMs: 1500 } }),\n    retryFeature(),\n    timeoutFeature({ ms: 1000 })\n  ]\n}",
      members: {
        restart: {
          summary: {
            en: 'Original restart and replacement decision.',
            zh: '原重启及替换决策。'
          },
          default: {
            en: 'Omitted: original supervisor default.',
            zh: '省略时使用原监督默认。'
          },
          example:
            "import { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'\nimport { retryFeature, timeoutFeature } from '@migaia/rpc-host/features'\n\nexport function taskPlugins(task: ICoroutineUserTask) {\n  return [\n    coroutinePlugin({ spawn: task, supervisor: { startupTimeoutMs: 1500 } }),\n    retryFeature(),\n    timeoutFeature({ ms: 1000 })\n  ]\n}"
        },
        terminalPolicy: {
          summary: {
            en: 'Original terminal-failure disposition.',
            zh: '原终态失败处理。'
          },
          default: {
            en: 'Omitted: original supervisor default.',
            zh: '省略时使用原监督默认。'
          },
          example:
            "import { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'\nimport { retryFeature, timeoutFeature } from '@migaia/rpc-host/features'\n\nexport function taskPlugins(task: ICoroutineUserTask) {\n  return [\n    coroutinePlugin({ spawn: task, supervisor: { startupTimeoutMs: 1500 } }),\n    retryFeature(),\n    timeoutFeature({ ms: 1000 })\n  ]\n}"
        },
        startupTimeoutMs: {
          summary: {
            en: 'Task startup budget, distinct from call/handshake deadlines.',
            zh: '与调用及握手期限分开的任务启动预算。'
          },
          default: {
            en: 'Omitted: original supervisor default.',
            zh: '省略时使用原监督默认。'
          },
          example:
            "import { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'\nimport { retryFeature, timeoutFeature } from '@migaia/rpc-host/features'\n\nexport function taskPlugins(task: ICoroutineUserTask) {\n  return [\n    coroutinePlugin({ spawn: task, supervisor: { startupTimeoutMs: 1500 } }),\n    retryFeature(),\n    timeoutFeature({ ms: 1000 })\n  ]\n}"
        },
        stop: {
          summary: {
            en: 'Original cooperative stop and reap policy.',
            zh: '原协作停止及回收策略。'
          },
          default: {
            en: 'Omitted: original supervisor default.',
            zh: '省略时使用原监督默认。'
          },
          example:
            "import { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'\nimport { retryFeature, timeoutFeature } from '@migaia/rpc-host/features'\n\nexport function taskPlugins(task: ICoroutineUserTask) {\n  return [\n    coroutinePlugin({ spawn: task, supervisor: { startupTimeoutMs: 1500 } }),\n    retryFeature(),\n    timeoutFeature({ ms: 1000 })\n  ]\n}"
        },
        budget: {
          summary: {
            en: 'Original native unit/lease budget.',
            zh: '原原生单元及租约预算。'
          },
          default: {
            en: 'Omitted: original supervisor default.',
            zh: '省略时使用原监督默认。'
          },
          example:
            "import { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'\nimport { retryFeature, timeoutFeature } from '@migaia/rpc-host/features'\n\nexport function taskPlugins(task: ICoroutineUserTask) {\n  return [\n    coroutinePlugin({ spawn: task, supervisor: { startupTimeoutMs: 1500 } }),\n    retryFeature(),\n    timeoutFeature({ ms: 1000 })\n  ]\n}"
        },
        heartbeat: {
          summary: {
            en: 'Original liveness policy observes task heartbeat calls.',
            zh: '观察任务活性报告的原活性策略。'
          },
          default: {
            en: 'Omitted: original supervisor default.',
            zh: '省略时使用原监督默认。'
          },
          example:
            "import { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'\nimport { retryFeature, timeoutFeature } from '@migaia/rpc-host/features'\n\nexport function taskPlugins(task: ICoroutineUserTask) {\n  return [\n    coroutinePlugin({ spawn: task, supervisor: { startupTimeoutMs: 1500 } }),\n    retryFeature(),\n    timeoutFeature({ ms: 1000 })\n  ]\n}"
        }
      }
    },
    IRpcCoroutineErrorCode: {
      summary: {
        en: 'Registered coroutine source error-code value union.',
        zh: '登记的协程来源错误码值联合。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      connect: { timeoutMs: 1500 },\n      spawn: async ({ connect, signal, heartbeat }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        heartbeat()\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    })\n  ]\n})\ntry {\n  console.log(await parent.request('double', 21))\n} finally {\n  await parent.close()\n}",
      members: {}
    }
  },
  enums: {
    RpcCoroutineErrorCode: {
      summary: {
        en: 'Failures admitted before task acquisition.',
        zh: '任务获取前准入的失败。'
      },
      values: {
        sourceInvalid: {
          en: 'COROUTINE_SOURCE_INVALID: select exactly one callable task or genuine parent handle.',
          zh: '来源非法时选择一个可调用任务或真实父端句柄。'
        }
      }
    }
  },
  enhancers: {
    coroutinePlugin: {
      kind: 'transport',
      target: 'IRpcHost / PluginHost',
      summary: {
        en: 'Run a cooperative task on real MessageChannel; original supervision owns generations, budget, stop and replacement. Same-loop tasks provide no process or Worker isolation and cannot preempt synchronous blocking.',
        zh: '经真实消息通道运行协作任务，原监督器拥有代次、预算、停止和替换。同事件循环任务不提供进程或线程隔离，不能抢占同步阻塞。'
      },
      install:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      connect: { timeoutMs: 1500 },\n      spawn: async ({ connect, signal, heartbeat }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        heartbeat()\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    })\n  ]\n})\ntry {\n  console.log(await parent.request('double', 21))\n} finally {\n  await parent.close()\n}",
      grants: [],
      behaviors: [
        {
          en: 'The task owns its child host; close drains and signals the original supervised task.',
          zh: '任务拥有其子宿主，关闭会排空并通知原监督任务。'
        }
      ],
      scenarios: [
        {
          en: 'Use cooperative tasks when native isolation is unnecessary.',
          zh: '无需原生隔离时使用协作任务。'
        }
      ],
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst parent = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      connect: { timeoutMs: 1500 },\n      spawn: async ({ connect, signal, heartbeat }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        heartbeat()\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    })\n  ]\n})\ntry {\n  console.log(await parent.request('double', 21))\n} finally {\n  await parent.close()\n}"
    }
  }
}
