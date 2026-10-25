/** Bilingual public reference for the current coroutines transport and feature ownership. */
import type { ILibraryReference } from './contract.js'

/** Concrete public package example with actual namespace and resource ownership. */
const example1 =
  "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'\n\nasync function untilStopped(signal: AbortSignal): Promise<void> {\n  let complete!: () => void\n  const stopped = new Promise<void>((resolve) => {\n    complete = resolve\n  })\n  signal.addEventListener('abort', complete, { once: true })\n  if (signal.aborted) complete()\n  try {\n    await stopped\n  } finally {\n    signal.removeEventListener('abort', complete)\n  }\n}\n\nconst task: ICoroutineUserTask = async ({ connect, signal, heartbeat }) => {\n  const child = await createRpcHost({\n    plugins: [coroutinePlugin({ connectToParent: connect })],\n    provide: { double: (value: number) => value * 2 }\n  })\n  heartbeat()\n  try {\n    await untilStopped(signal)\n  } finally {\n    await child.close()\n  }\n}\n\ntype IWorkerApi = { double(value: number): number }\nconst plugins = [coroutinePlugin({ spawn: task })] as const\nconst parent = await createRpcHost<IWorkerApi, typeof plugins>({ plugins })\ntry {\n  console.log(await parent.coroutine.request('double', 21))\n} finally {\n  await parent.close()\n}"

/** Public configuration example for this native capability. */
const taskScopeExample =
  "import { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'\n\nexport function renderer(task: ICoroutineUserTask) {\n  return coroutinePlugin({ spawn: task, namespace: 'jobs', name: 'renderer' })\n}"

/** Public configuration example for this native capability. */
const taskExposureExample =
  "import { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'\n\nexport function exposeMath(task: ICoroutineUserTask) {\n  return coroutinePlugin({ spawn: task, expose: ['math.double'] })\n}"

/** Public configuration example for this native capability. */
const taskReportExample =
  "import { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'\n\nexport function monitoredTask(task: ICoroutineUserTask) {\n  return coroutinePlugin({\n    spawn: task,\n    report(error) {\n      console.error('Cooperative task failure', error)\n    }\n  })\n}"

/** Current public modules, configuration and installed capabilities. */
export const rpcCoroutinesReference: ILibraryReference = {
  modules: {
    index: {
      summary: {
        en: 'Contract owns pure protocol, interfaces and errors. Host owns Sessions, calls and providers; this package owns cooperative tasks using real MessageChannels. Flow plugins use fixed hooks, and complete features own optional policy. Call through the transport namespace. Separate Hosts are usual; deliberate multi-transport installation uses distinct namespaces.',
        zh: '契约包拥有纯协议、接口及错误；宿主拥有会话、调用及提供方，本包拥有使用真实消息通道的协作任务。流程插件使用固定钩子，完整功能拥有可选策略。通过传输命名空间调用；通常使用独立宿主，也可用不同命名空间明确隔离多传输安装。'
      },
      example: example1
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
        en: 'Cold SDK transport definition. Installation publishes host.coroutine calls and actual native extensions; construction alone acquires no resource.',
        zh: '返回冷 SDK 传输定义；安装后发布对应命名空间调用及实际原生扩展，仅构造定义不会获取资源。'
      },
      example: example1
    },
    RPC_COROUTINE_ERROR_SOURCE: {
      role: 'error',
      purpose: {
        en: 'Stable rpc.transport.coroutine source declared by @migaia/rpc-contract/error-code and re-exported here. Other RPC/native families retain their own source and code.',
        zh: '由契约包错误码入口声明并在此重导出的稳定来源 rpc.transport.coroutine；其他远程调用及原生家族保留自身来源与错误码。'
      },
      example: example1
    },
    RpcCoroutineErrorCode: {
      role: 'error',
      purpose: {
        en: 'Registered source admission failure attached to native TypeError without replacing the original instance.',
        zh: '附加到原生类型错误的来源准入失败，不替换原实例。'
      },
      example: example1
    }
  },
  types: {
    ICoroutinePluginOptions: {
      summary: {
        en: 'Exactly one task spawn or genuine parent handle plus cold installation configuration.',
        zh: '一个任务启动或真实父端句柄，加上冷安装配置。'
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
          example: taskScopeExample
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
          example: taskScopeExample
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
          example: taskExposureExample
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
            en: 'Set an application monitoring sink when cooperative task background and cleanup failures must join your existing incident reports. Omit it to inherit the configured Host reporter.',
            zh: '需要将原生后台及清理失败汇入应用现有告警时配置；省略则继承宿主显式报告器。'
          },
          example: taskReportExample
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
          example: example1
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
          example: example1
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
          example: example1
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
          example: example1
        }
      }
    },
    ICoroutineConnect: {
      summary: {
        en: 'Generation-local opaque authority issued only by the original task registry. Physical ports and reporter ownership remain hidden.',
        zh: '仅由原任务登记签发的代内不透明权限，物理端口和报告器归属保持隐藏。'
      },
      example: example1,
      members: {}
    },
    ICoroutineUserTask: {
      summary: {
        en: 'Function receiving ICoroutineTaskContext and returning void or a thenable. Keep it alive until work or stop completes; use finally for child cleanup.',
        zh: '接收任务上下文并返回空值或可等待对象的函数，保持运行直到业务或停止完成，并在最终清理中关闭子端。'
      },
      example: example1,
      members: {}
    },
    ICoroutineTaskContext: {
      summary: {
        en: 'Original per-task lifetime, liveness and source authority.',
        zh: '原逐任务寿命、活性及来源权限。'
      },
      example: example1,
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
          example: example1
        }
      }
    },
    ICoroutineReplaceSpec: {
      summary: {
        en: 'Replacement input for the original native outlet transaction.',
        zh: '原原生出口事务使用的替换输入。'
      },
      example: example1,
      members: {
        task: {
          summary: {
            en: 'Next actual task function, wrapped through the same token/reporter registry.',
            zh: '下一实际任务函数，经同一令牌及报告器登记包装。'
          },
          example: example1
        }
      }
    },
    ICoroutineSupervisorPolicy: {
      summary: {
        en: 'Partial original supervision configuration; no separate task scheduler or retry state.',
        zh: '原监督配置的部分选择，不另建任务调度或重试状态。'
      },
      example: example1,
      members: {
        restart: {
          summary: {
            en: 'Original supervisor restart policy for actual task exits; it never replays an application method by itself.',
            zh: '实际任务退出时使用的原监督器重启策略，自身不会重放应用方法调用。'
          },
          default: {
            en: 'Omitted: original supervisor default.',
            zh: '省略时使用原监督默认。'
          },
          example: example1
        },
        terminalPolicy: {
          summary: {
            en: 'Original supervisor terminal policy after exhausted native recovery; distinct from the result of one RPC invocation.',
            zh: '原生恢复耗尽后的原监督器终态策略，与单次远程调用的结果分开。'
          },
          default: {
            en: 'Omitted: original supervisor default.',
            zh: '省略时使用原监督默认。'
          },
          example: example1
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
          example: example1
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
          example: example1
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
          example: example1
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
          example: example1
        }
      }
    },
    IRpcCoroutineErrorCode: {
      summary: {
        en: 'Registered coroutine source error-code value union.',
        zh: '登记的协程来源错误码值联合。'
      },
      example: example1,
      members: {}
    },
    ICoroutineCommonOptions: {
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
          example: taskScopeExample
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
          example: taskScopeExample
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
          example: taskExposureExample
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
            en: 'Set an application monitoring sink when cooperative task background and cleanup failures must join your existing incident reports. Omit it to inherit the configured Host reporter.',
            zh: '需要将原生后台及清理失败汇入应用现有告警时配置；省略则继承宿主显式报告器。'
          },
          example: taskReportExample
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
          example: example1
        }
      },
      example: example1
    },
    ICoroutineNamespaceExtensions: {
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
      install: example1,
      grants: [
        {
          signature: 'host.coroutine.members',
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
      example: example1
    }
  }
}
