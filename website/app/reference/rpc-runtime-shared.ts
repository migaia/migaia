/** Shared canonical connection-detail prose consumed by Tray without legacy factory examples. */
import type { ITypeDoc } from './contract.js'

/** Connection facts remain owned by the original accepted session and native sampler. */
export const rpcMemberSharedTypes: Readonly<Record<string, ITypeDoc>> = {
  IRpcMemberConnectionDetail: {
    summary: {
      en: 'Safe connection detail projected by the original runtime owner; native unavailable facts remain explicit. Shared only with Tray documentation.',
      zh: '由原运行时所有者投影的安全连接详情，缺失原生事实明确保留不可用，仅与托盘文档共用。'
    },
    members: {
      methods: {
        summary: {
          en: 'Method paths callable on the other side, from its accepted directory.',
          zh: '对端已接受目录中可调用的方法路径。'
        }
      },
      counters: {
        summary: {
          en: 'The current native-member projection reports `{ status: "unavailable", reason: "canonical-counter-not-available" }`; it has no canonical pending-call counter input. A declared metric shape does not make a measurement available.',
          zh: '当前原生成员投影返回 `{ status: "unavailable", reason: "canonical-counter-not-available" }`，尚未接入规范待决调用计数来源；声明了指标形状不代表已有实际测量值。'
        }
      },
      recent: {
        summary: {
          en: 'Recent lifecycle records (`IRpcMemberRecent`), newest last.',
          zh: '最近的生命周期记录（`IRpcMemberRecent`），最新的在最后。'
        }
      },
      identity: {
        summary: {
          en: 'Identity `{ name, instanceId }` the other side announced, or `{ status: "unavailable", reason }` when the owner cannot observe it.',
          zh: '对端声明的身份 `{ name, instanceId }`；无法观察时为 `{ status: "unavailable", reason }`。'
        }
      },
      generation: {
        summary: {
          en: 'Generation accepted from the other side (not the local restart count).',
          zh: '从对端接受的代次（不是本地重启次数）。'
        }
      },
      kind: {
        summary: {
          en: 'How the connection was configured: `spawn`, `connect` or `listen`.',
          zh: '该连接在本端的配置方式：`spawn`、`connect` 或 `listen`。'
        },
        values: {
          spawn: {
            en: 'The local source launched the remote native unit.',
            zh: '本地来源启动了远端原生单元。'
          },
          connect: {
            en: 'The local source initiated the connection.',
            zh: '本地来源主动建立连接。'
          },
          listen: { en: 'The local source accepted the connection.', zh: '本地来源接受了连接。' }
        }
      },
      direction: {
        summary: {
          en: 'Who started it: `spawned`, `spawned-by` (this side is the child), `connect` or `listen`.',
          zh: '由哪一方发起：`spawned`、`spawned-by`（本端是子端）、`connect` 或 `listen`。'
        },
        values: {
          spawned: { en: 'This owner launched the remote unit.', zh: '当前所有者启动了远端单元。' },
          'spawned-by': {
            en: 'This side is the child of its bootstrap parent.',
            zh: '本端是可信启动父端创建的子端。'
          },
          connect: { en: 'This side initiated the connection.', zh: '本端主动建立连接。' },
          listen: { en: 'This side accepted the connection.', zh: '本端接受了连接。' }
        }
      },
      carrier: {
        summary: {
          en: 'Name of the physical carrier, such as a MessagePort or stdio.',
          zh: '底层传输通道的名称，例如 MessagePort 或 stdio。'
        }
      },
      connection: {
        summary: {
          en: '`{ status }`: `ready`, `closed`, `departed`, or unavailable.',
          zh: '逻辑连接状态 `{ status }`：`ready`、`closed`、`departed` 或不可用。'
        }
      },
      unit: {
        summary: {
          en: 'Supervised unit `{ kind, state, generation, degraded }`, or `{ status: "unavailable", reason }` when the owner cannot observe it.',
          zh: '受监督的执行单元 `{ kind, state, generation, degraded }`；无法观察时为 `{ status: "unavailable", reason }`。'
        }
      },
      health: {
        summary: {
          en: 'Native health metric whose `value` is `{ state, failures }`, with explicit scope, unit and observation time; or `{ status: "unavailable", reason }` when the owner cannot observe it.',
          zh: '原生健康指标的 `value` 为 `{ state, failures }`，并携带明确的范围、单位和观察时间；无法观察时为 `{ status: "unavailable", reason }`。'
        }
      },
      restartCount: {
        summary: {
          en: 'Number of restarts as a metric, or `{ status: "unavailable", reason }` when the owner cannot observe it.',
          zh: '以指标形式给出的重启次数；无法观察时为 `{ status: "unavailable", reason }`。'
        }
      },
      resources: {
        summary: {
          en: 'Sampled resources (pid or threadId, memory, CPU time, event-loop utilisation), or `{ status: "unavailable", reason }` when the owner cannot observe it.',
          zh: '采样得到的资源（pid 或 threadId、内存、CPU 时间、事件循环利用率）；无法观察时为 `{ status: "unavailable", reason }`。'
        }
      },
      lastExit: {
        summary: {
          en: 'Last exit `{ generation, reason, code, signal, error? }`, or `{ status: "unavailable", reason }` when the owner cannot observe it.',
          zh: '最近一次退出 `{ generation, reason, code, signal, error? }`；无法观察时为 `{ status: "unavailable", reason }`。'
        }
      }
    }
  }
}
