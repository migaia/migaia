/** Bilingual public reference for the current pool transport and feature ownership. */
import type { ILibraryReference } from './contract.js'

/** Concrete public package example with actual namespace and resource ownership. */
const example1 =
  "import { createRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'\nimport { pool } from '@migaia/rpc-plugin-pool'\n\ntype IWorkerApi = { double(value: number): number }\n\nif (await isThreadChild()) {\n  await createRpcHost({\n    plugins: [threadPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const plugins = [\n    threadPlugin({ spawn: true, features: [pool({ size: 3, maxQueue: 32 })] })\n  ] as const\n  const host = await createRpcHost<IWorkerApi, typeof plugins>({ plugins })\n  try {\n    console.log(await host.thread.send('pool', 'double', 21))\n    await host.thread.pool.resize(2)\n    console.log(host.thread.pool.stats().targetSize)\n  } finally {\n    await host.close()\n  }\n}"

/** Concrete public package example with actual namespace and resource ownership. */
const example2 =
  "import { RPC_POOL_ERROR_SOURCE, RpcPoolErrorCode } from '@migaia/rpc-plugin-pool'\nconsole.log(RPC_POOL_ERROR_SOURCE, RpcPoolErrorCode.queueFull)"

/** Concrete public package example with actual namespace and resource ownership. */
const example3 =
  "import { RpcPoolErrorCode } from '@migaia/rpc-plugin-pool'\nconsole.log(RpcPoolErrorCode.callAborted)"

/** Concrete public package example with actual namespace and resource ownership. */
const example4 =
  "import type { IRpcPoolControls } from '@migaia/rpc-plugin-pool'\n\nexport async function shrink(controls: IRpcPoolControls) {\n  await controls.resize(1)\n  const snapshot = controls.stats()\n  return { target: snapshot.targetSize, busy: snapshot.inFlight, waiting: snapshot.queued }\n}"

/** Concrete public package example with actual namespace and resource ownership. */
const example5 =
  "import { RpcPoolErrorCode } from '@migaia/rpc-plugin-pool'\nconsole.log(RpcPoolErrorCode.closeFailed)"

/** Public configuration example for this native capability. */
const idlePoolExample =
  "import { pool } from '@migaia/rpc-plugin-pool'\nimport { systemScheduler } from '@migaia/utils/scheduler'\n\nexport const backgroundWorkers = pool({\n  size: 2,\n  idleTimeoutMs: 30000,\n  scheduler: systemScheduler\n})"

/** Current public modules, configuration and installed capabilities. */
export const rpcPoolReference: ILibraryReference = {
  modules: {
    index: {
      summary: {
        en: 'Contract owns pure protocol, interfaces and errors. Host owns Sessions, calls and providers; this package owns one logical target backed by privately acquired native members. Flow plugins use fixed hooks, and complete features own optional policy. Call through the transport namespace. Separate Hosts are usual; deliberate multi-transport installation uses distinct namespaces.',
        zh: '契约包拥有纯协议、接口及错误；宿主拥有会话、调用及提供方，本包拥有以私有原生成员支撑的单个逻辑目标。流程插件使用固定钩子，完整功能拥有可选策略。通过传输命名空间调用；通常使用独立宿主，也可用不同命名空间明确隔离多传输安装。'
      },
      example: example1
    }
  },
  symbols: {
    RPC_POOL_ERROR_SOURCE: {
      role: 'error',
      purpose: {
        en: 'Stable rpc.pool source declared by @migaia/rpc-contract/error-code and re-exported here. Other RPC/native families retain their own source and code.',
        zh: '由契约包错误码入口声明并在此重导出的稳定来源 rpc.pool；其他远程调用及原生家族保留自身来源与错误码。'
      },
      example: example2
    },
    RpcPoolErrorCode: {
      role: 'error',
      purpose: {
        en: 'Stable pool-owned semantic codes for invalid configuration, closed admission, queue overflow, queued abort and aggregated member cleanup. Native error classes and original causes remain intact.',
        zh: '提供非法配置、关闭接纳、队列溢出、排队取消及聚合成员清理的稳定池语义码，保留原生错误类型与原始原因。'
      },
      example: example3
    },
    RpcPoolState: {
      role: 'constant',
      purpose: {
        en: 'Client scheduling lifecycle reported by stats(): open accepts work, closing drains accepted operations, closed records completed member cleanup attempts. It does not describe individual native supervisor generations.',
        zh: '统计报告的客户端调度生命周期，打开接收工作、关闭中排空已接纳操作、关闭记录成员清理尝试已完成，不描述单独原生监督代次。'
      },
      example: example1
    },
    RPC_POOL_PEER_ID: {
      role: 'constant',
      purpose: {
        en: 'Exact logical target pool for direct send/dispatch. Hidden member IDs never enter the host direct target set.',
        zh: '定向调用使用的精确逻辑目标池，隐藏成员标识不进入宿主直连集合。'
      },
      example: example1
    },
    pool: {
      role: 'enhancer',
      purpose: {
        en: 'Create a complete native pool feature for a repeatable Thread, Process or Coroutine source. Install it in that transport features array; one logical pool is public.',
        zh: '为可重复打开的线程、进程或协程来源创建完整原生池功能。安装到该传输功能数组，对外仅发布一个逻辑池。'
      },
      options: 'IPoolPluginOptions',
      returns: {
        en: 'Cold native feature; the installed transport namespace receives pool and native member controls.',
        zh: '返回冷原生功能；安装后的传输命名空间获得池及原生成员控制。'
      },
      example: example1
    }
  },
  types: {
    IRpcPoolControls: {
      summary: {
        en: 'Per-installation original pool controls. close drains accepted work and joins one original Promise; no second shutdown owner.',
        zh: '逐安装原池控制，关闭排空已接纳工作并共用原承诺，不添加第二个关闭所有者。'
      },
      scenarios: [
        {
          en: 'Resize, inspect or explicitly close the pool through its installed transport namespace.',
          zh: '通过已安装传输命名空间调整、检查或显式关闭池。'
        }
      ],
      example: example1,
      members: {
        stats: {
          summary: {
            en: 'Read a new frozen client-slot and queue snapshot, not remote provider/CPU concurrency.',
            zh: '读取新的冻结客户端槽及队列快照，不代表远端提供方或处理器并发。'
          },
          params: {},
          returns: {
            en: 'IRpcPoolStats with current target/member/inFlight/queued/state.',
            zh: '返回当前目标、成员、占槽、排队和状态统计。'
          },
          example: example4
        },
        resize: {
          summary: {
            en: 'Serialize target changes, retiring idle members first and waiting for busy retirees without interrupting work. Expansion opens only missing members.',
            zh: '串行调整目标，先退休空闲成员，再等待忙成员而不中断业务，扩容仅打开缺少成员。'
          },
          params: {
            size: {
              en: 'Application-selected positive integer target.',
              zh: '应用选择的正整数目标。'
            }
          },
          returns: {
            en: 'Promise after adjustment; failed expansion restores the old open target and preserves primary/cleanup errors.',
            zh: '调整后结算的承诺，扩容失败恢复原开放目标并保留主错误及清理错误。'
          },
          example: example4
        },
        close: {
          summary: {
            en: 'Stop new admission, drain accepted operations and acquisitions, then attempt all member closes. Active streams must finish or return.',
            zh: '停止新准入，排空已接纳操作及获取，再尝试关闭全部成员，活动流须完成或返回。'
          },
          params: {},
          returns: {
            en: 'Same Promise on repeated calls; CLOSE_FAILED retains original errors/cause and the pool stays terminal.',
            zh: '重复调用共用同一承诺，关闭失败保留原错误及原因，池保持终态。'
          },
          example: example1
        }
      }
    },
    IRpcPoolStats: {
      summary: {
        en: 'Frozen pool scheduling snapshot, independent of provider concurrency and per-Peer native readiness or restart states. Available even after pool closure.',
        zh: '冻结池调度快照，独立于提供者并发及各连接原生就绪或重启状态，池关闭后仍可读取。'
      },
      example: example1,
      members: {
        targetSize: {
          summary: {
            en: 'Configured member target from construction or the latest admitted resize; idle retirement does not lower it.',
            zh: '构造或最新接纳调整指定的成员目标，空闲退役不会降低此目标。'
          }
        },
        memberCount: {
          summary: {
            en: 'Currently held hidden member count, including retirement/cleanup still settling. Idle retirement can leave it temporarily below targetSize.',
            zh: '当前持有的隐藏成员数量，包含尚未结算的退休及清理；空闲退休可能使其暂时低于目标容量。'
          }
        },
        inFlight: {
          summary: {
            en: 'Member slots with an actual acquired Peer assigned to an accepted operation; acquiring slots are excluded until ready.',
            zh: '已有实际连接且被分配给已接纳操作的成员槽，仍在接纳中的槽在就绪前不计入。'
          }
        },
        queued: {
          summary: {
            en: 'Accepted FIFO waiters without a member assignment; excludes occupied slots and cold acquisition reservations.',
            zh: '尚未分配成员的已接纳先进先出等待者，不含占用槽及冷接纳预留。'
          }
        },
        state: {
          summary: {
            en: 'Pool-owned admission and drain lifecycle, separate from member native restart state.',
            zh: '池拥有的接纳及排空生命周期，与成员原生重启状态分开。'
          },
          values: {
            enum: 'RpcPoolState'
          }
        }
      }
    },
    IRpcPoolErrorCode: {
      summary: {
        en: 'Value union of RpcPoolErrorCode; only failures owned by pool scheduling use this union, while original Peer errors retain external contracts.',
        zh: '池语义错误码的值联合，仅池调度拥有的失败使用此联合，原底层连接错误保留外包契约。'
      },
      example: example5,
      members: {}
    },
    IPoolPluginOptions: {
      summary: {
        en: 'Original scheduling limits, admitted before any native acquisition.',
        zh: '原调度限制，在原生获取前准入。'
      },
      example: example1,
      members: {
        size: {
          summary: {
            en: 'Required positive integer target; installation waits for that many independent members.',
            zh: '必填正整数目标，安装等待相应数量独立成员。'
          },
          example: example1
        },
        maxQueue: {
          summary: {
            en: 'Bounded waiting FIFO length; zero rejects when no slot is free.',
            zh: '有界等待队列长度，零表示无空闲槽时拒绝。'
          },
          default: {
            en: 'Omitted: 256 waiting entries.',
            zh: '省略时允许二百五十六个等待项。'
          },
          example: example1
        },
        idleTimeoutMs: {
          summary: {
            en: 'Finite positive milliseconds at most 2147483647; retirement keeps targetSize for later refill.',
            zh: '不超过限定整数上界的有限正毫秒，空闲退休保留目标容量供后续补齐。'
          },
          default: {
            en: 'Omitted: disable idle retirement.',
            zh: '省略时不进行空闲退休。'
          },
          example: idlePoolExample
        },
        scheduler: {
          summary: {
            en: 'Borrowed original idle scheduler only, not native restart or call deadlines.',
            zh: '仅借用原空闲调度器，不接管原生重启或调用期限。'
          },
          default: {
            en: 'Omitted: systemScheduler.',
            zh: '省略时使用系统调度器。'
          },
          example: idlePoolExample
        }
      }
    },
    IPoolExtensions: {
      summary: {
        en: 'Extensions returned through the actual transport namespace.',
        zh: '通过实际传输命名空间返回的扩展。'
      },
      members: {
        pool: {
          summary: {
            en: 'Original bounded scheduling controls for this installation.',
            zh: '此次安装的原有界调度控制。'
          }
        },
        members: {
          summary: {
            en: 'SDK controls borrow these exact native resources and supervisors.',
            zh: 'SDK 控制借用这些精确原生资源及监督器。'
          }
        }
      },
      example: example1
    }
  },
  enums: {
    RpcPoolErrorCode: {
      summary: {
        en: 'Pool-owned error categories, classified with RPC_POOL_ERROR_SOURCE rather than replacing underlying Peer identity.',
        zh: '池拥有的错误分类，与规范池来源一起识别，不替换底层连接身份。'
      },
      values: {
        invalidOptions: {
          en: 'Construction or resize input is invalid; fix the option before native member acquisition.',
          zh: '构造或调整大小输入非法，需要在原生成员接纳前修正选项。'
        },
        poolClosed: {
          en: 'A closing or closed pool rejects a new operation or resize; create a new pool for new work.',
          zh: '关闭中或已关闭的池拒绝新操作或调整大小，新工作需要新建池。'
        },
        queueFull: {
          en: 'All client slots are busy and the bounded FIFO is full; no member receives the rejected operation.',
          zh: '全部客户端槽忙且有界先进先出队列已满，被拒操作不会发送给成员。'
        },
        callAborted: {
          en: 'An operation was cancelled while waiting in the FIFO; native AbortError cause retains the exact signal reason.',
          zh: '操作在先进先出队列中等待时取消，原生取消错误原因保留精确信号理由。'
        },
        closeFailed: {
          en: 'Every member close was attempted and one or more failed; AggregateError retains errors and the first original cause.',
          zh: '已尝试全部成员关闭且至少一个失败，聚合错误保留错误列表及首个原始原因。'
        },
        transportUnsupported: {
          en: 'POOL_TRANSPORT_UNSUPPORTED rejects listen/connect-to-parent before opening a member.',
          zh: '不支持传输时，在打开成员前拒绝监听或连接父端来源。'
        }
      }
    },
    RpcPoolState: {
      summary: {
        en: 'Pool client admission states reported in IRpcPoolStats; these are lifecycle values rather than thrown codes.',
        zh: '池统计报告的客户端接纳状态，属于生命周期值而非抛出错误码。'
      },
      values: {
        open: {
          en: 'Accepts new operations, dispatches free slots and queues accepted overflow within maxQueue.',
          zh: '接收新操作，派发空闲槽，并在等待容量内排队接纳的溢出操作。'
        },
        closing: {
          en: 'Rejects new operations while draining accepted work and closing all owned members.',
          zh: '拒绝新操作，同时排空已接纳工作并关闭全部所属成员。'
        },
        closed: {
          en: 'All member closes have been attempted; stats remains readable but no new calls are admitted.',
          zh: '已尝试全部成员关闭，统计仍可读取但不再接纳新调用。'
        }
      }
    }
  },
  enhancers: {
    pool: {
      kind: 'feature',
      target: 'transport.features',
      summary: {
        en: 'Create a complete native pool feature for a repeatable Thread, Process or Coroutine source. Install it in that transport features array; one logical pool is public.',
        zh: '为可重复打开的线程、进程或协程来源创建完整原生池功能。安装到该传输功能数组，对外仅发布一个逻辑池。'
      },
      install: example1,
      grants: [
        {
          signature: 'host.thread.pool',
          summary: {
            en: 'Controls belong to the transport namespace selected by the application.',
            zh: '控制属于应用选择的传输命名空间。'
          },
          params: {},
          returns: {
            en: 'IRpcPoolControls for this installation only.',
            zh: '仅属于此次安装的池控制。'
          },
          example: example1
        },
        {
          signature: 'host.thread.members',
          summary: {
            en: 'Actual native members retained by this pool installation.',
            zh: '此池安装持有的实际原生成员。'
          },
          params: {},
          returns: {
            en: 'SDK native member controls; private member Sessions are not direct peers.',
            zh: '返回 SDK 原生成员控制，私有成员会话不是直连对端。'
          },
          example: example1
        }
      ],
      behaviors: [
        {
          en: 'Each operation selects one real member; a stream retains it until actual completion or return.',
          zh: '每次操作选择一个真实成员；流持有它直到实际完成或返回。'
        },
        {
          en: 'Explicit pool.close stops admission, drains accepted work and attempts every owned member close without a new deadline.',
          zh: '显式池关闭停止接纳，排空已接纳工作并尝试关闭全部所属成员，不添加期限。'
        }
      ],
      scenarios: [
        {
          en: 'Bound native process, thread or cooperative work through original FIFO and leases.',
          zh: '通过原先进先出与租约限制进程、线程或协作工作。'
        }
      ],
      example: example1
    }
  }
}
