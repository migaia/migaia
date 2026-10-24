/** Shared canonical connection-detail prose consumed by Tray without legacy factory examples. */
import type { IMemberDoc, ITypeDoc } from './contract.js'

/** Transport option prose is shared only where the native plugin contracts are identical. */
export const rpcPluginOptionDocs = {
  name: {
    summary: {
      en: 'Application-selected local registration name in an ordinary PluginHost; it distinguishes installed entries and is independent of remote self.name or authentication identity.',
      zh: '应用选择的普通插件宿主本地登记名，用于区分安装项，与远端 self.name 及对端认证身份无关。'
    }
  },
  expose: {
    summary: {
      en: 'Explicit method exposure list for an ordinary PluginHost installation; selects which existing methods that entry publishes without creating a local business implementation.',
      zh: '普通插件宿主的显式方法公开列表，仅选取该安装项需要向对端暴露的方法，不新增本地业务实现。'
    }
  },
  connect: {
    summary: {
      en: 'Preparation policy for the original identity and capability handshake, executed by the current source; this record does not supply a second physical connection source.',
      zh: '仅配置原身份及能力握手的准备策略，由当前来源执行；它本身不提供第二个物理连接来源。'
    }
  },
  'connect.timeoutMs': {
    summary: {
      en: 'One finite nonnegative millisecond budget shared by identity and capability preparation; phases do not reset it, and it does not set business-call or task-stop deadlines.',
      zh: '身份与能力准备共用的一次有限非负毫秒预算，各阶段不重置期限，也不作为业务调用或任务停止期限。'
    }
  }
} satisfies Readonly<Record<string, IMemberDoc>>

/** Connection facts remain owned by the original accepted session and native sampler. */
export const runtimeSharedTypes: Readonly<Record<string, ITypeDoc>> = {
  IRuntimeConnectionDetail: {
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
          en: 'Call counters: `inFlight` (calls not yet finished) is measured; `sent`, `received`, `errors`, `lastActiveAt` are reported unavailable; or `{ status: "unavailable", reason }` when the owner cannot observe it.',
          zh: '调用计数：`inFlight`（尚未结束的调用数）会被测量；`sent`、`received`、`errors`、`lastActiveAt` 报告为不可用；无法观察时为 `{ status: "unavailable", reason }`。'
        }
      },
      recent: {
        summary: {
          en: 'Recent lifecycle records (`IRuntimeRecent`), newest last.',
          zh: '最近的生命周期记录（`IRuntimeRecent`），最新的在最后。'
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
          enum: 'RuntimeSourceKind'
        }
      },
      direction: {
        summary: {
          en: 'Who started it: `spawned`, `spawned-by` (this side is the child), `connect` or `listen`.',
          zh: '由哪一方发起：`spawned`、`spawned-by`（本端是子端）、`connect` 或 `listen`。'
        },
        values: {
          enum: 'RuntimeConnectionDirection'
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
          en: 'Health check metric `{ state, failures }`, or `{ status: "unavailable", reason }` when the owner cannot observe it.',
          zh: '健康检查指标 `{ state, failures }`；无法观察时为 `{ status: "unavailable", reason }`。'
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
