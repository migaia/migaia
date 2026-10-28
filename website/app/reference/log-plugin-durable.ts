import type { ILibraryReference } from './contract.js'

/** Current public log-plugin-durable behavior, examples and ownership contracts. */
export const logDurableReference: ILibraryReference = {
  modules: {
    index: {
      summary: {
        en: 'Own binlog, WAL, undo and portable log stores independently of storage backends.',
        zh: '独立提供变更日志、预写日志、撤销与可移植日志存储，不接管存储后端。'
      },
      example:
        "import { createLogHost } from '@migaia/log-host'\nimport { binlogPlugin, memoryLogStore } from '@migaia/log-plugin-durable'\n\nconst store = memoryLogStore()\nconst log = createLogHost({ plugins: [binlogPlugin({ store })] })\nawait log.binlog.append('order.created', { id: 'o1' })\nconsole.log(await log.binlog.read(1))\nawait log.shutdown('manual')"
    },
    file: {
      summary: {
        en: 'Open the runtime-native SQLite log store; browser entry rejects unsupported opening.',
        zh: '打开宿主原生 SQLite 日志存储；浏览器入口明确拒绝不支持的打开操作。'
      },
      example:
        "import { fileLogStore } from '@migaia/log-plugin-durable/file'\n\nconst store = await fileLogStore('audit.sqlite')\ntry {\n  await store.append([{ kind: 'saved', payload: { id: 'o1' } }])\n} finally {\n  await store.dispose()\n}"
    }
  },
  symbols: {
    LogRecordState: {
      role: 'constant',
      purpose: {
        en: 'Stable intent states: pending may remain pending or advance once to done or aborted; terminal records cannot reopen.',
        zh: '稳定的意图状态：pending 可保持原状或一次推进为 done、aborted；终态记录不能重新打开。'
      },
      example:
        "import { memoryLogStore, LogRecordState } from '@migaia/log-plugin-durable'\n\nawait using store = memoryLogStore()\nconst off = store.onAppend(notice => console.log(notice.lastSeq, notice.count))\nconst sequences = await store.append([{ kind: 'order.created', payload: { id: 'o1' } }])\nconst seq = sequences[0]!\nconsole.log((await store.read(seq, 10))[0]?.kind)\nawait store.setState(seq, LogRecordState.done)\nconsole.log(await store.states(LogRecordState.pending))\nawait store.truncate(seq + 1)\nconsole.log(await store.lastSeq())\noff()"
    },
    LogStage: {
      role: 'constant',
      purpose: {
        en: 'Stable metadata-only lifecycle and operation observation names shared by the original durable resources and installed plugins.',
        zh: '原持久资源与已安装插件共用的稳定生命周期及操作观察名称，只传递元数据，不介入提交。'
      },
      example:
        "import { memoryLogStore } from '@migaia/log-plugin-durable'\nawait using store = memoryLogStore({ observe: event => console.log(event.stage) })\nawait store.append([{ kind: 'audit', payload: null }])"
    },
    assertLogInteger: {
      role: 'operation',
      purpose: {
        en: 'Assert the original safe-integer domain and preserve numeric error semantics.',
        zh: '校验原安全整数范围并保留原生数字错误语义，非法参数与序号耗尽分别带码拒绝。'
      },
      params: {
        value: {
          en: 'Unknown value to narrow to a safe integer.',
          zh: '要收窄为安全整数的未知输入值。'
        },
        minimum: {
          en: 'Inclusive minimum, default one; pass zero for a high watermark.',
          zh: '包含边界的最小值，缺省为一；高水位允许显式传零。'
        }
      },
      returns: {
        en: 'Narrows unknown to number; the default minimum is one.',
        zh: '将 unknown 收窄为 number；缺省最小值为一。'
      },
      example:
        "import { assertLogInteger } from '@migaia/log-plugin-durable'\n\nconst input: unknown = 0\nassertLogInteger(input, 0)\nconsole.log(input)",
      cases: [
        {
          title: {
            en: 'Reuse log integer admission',
            zh: '复用日志整数准入'
          },
          problem: {
            en: 'Preserve numeric errors in native log adapters.',
            zh: '原生日志适配器保留数字错误语义。'
          },
          example: {
            en: "import { assertLogInteger } from '@migaia/log-plugin-durable'\n\nconst input: unknown = 0\nassertLogInteger(input, 0)\nconsole.log(input)",
            zh: "import { assertLogInteger } from '@migaia/log-plugin-durable'\n\nconst input: unknown = 0\nassertLogInteger(input, 0)\nconsole.log(input)"
          },
          result: {
            en: 'Prints 0; fractional values reject with the original coded RangeError.',
            zh: '输出 0；小数仍按原带码 RangeError 拒绝。'
          }
        }
      ]
    },
    snapshotLogRecords: {
      role: 'factory',
      purpose: {
        en: 'Capture portable JSON before asynchronous admission without assigning sequence/time.',
        zh: '在异步准入之前捕获独立的可移植 JSON 记录，不分配序号和时间，也不执行持久化。'
      },
      params: {
        records: {
          en: 'Ordered kind/payload inputs captured before any asynchronous admission.',
          zh: '任何异步准入之前捕获的有序种类与载荷输入。'
        }
      },
      returns: {
        en: 'Detached admitted inputs without assigned sequences, time or native I/O.',
        zh: '返回独立已准入输入，不分配序号、时间，也不执行原生访问。'
      },
      example: {
        en: "import {\n  snapshotLogRecords, prepareLogAppend, snapshotLogStoreState, createLogStoreIndex\n} from '@migaia/log-plugin-durable'\n\nconst state = snapshotLogStoreState({ lastSeq: 0, time: 0, floor: 1 }, [])\nconst index = createLogStoreIndex(state)\nconst batch = prepareLogAppend(\n  snapshotLogRecords([{ kind: 'order.created', payload: { id: 'o1' } }]),\n  index\n)\nconsole.log(index.lastSeq, batch[0]?.seq) // Preparation is not a commit.",
        zh: "import {\n  snapshotLogRecords, prepareLogAppend, snapshotLogStoreState, createLogStoreIndex\n} from '@migaia/log-plugin-durable'\n\nconst state = snapshotLogStoreState({ lastSeq: 0, time: 0, floor: 1 }, [])\nconst index = createLogStoreIndex(state)\nconst batch = prepareLogAppend(\n  snapshotLogRecords([{ kind: 'order.created', payload: { id: 'o1' } }]),\n  index\n)\nconsole.log(index.lastSeq, batch[0]?.seq) // 准备批次不等于提交。"
      },
      cases: [
        {
          title: {
            en: 'Prepare a native append before commit',
            zh: '原生提交前准备追加批次'
          },
          problem: {
            en: 'Keep asynchronous persistence in its native transaction while reusing the original committed index.',
            zh: '异步持久化仍由原生事务拥有，同时复用原已提交索引。'
          },
          example: {
            en: "import {\n  snapshotLogRecords, prepareLogAppend, snapshotLogStoreState, createLogStoreIndex\n} from '@migaia/log-plugin-durable'\n\nconst state = snapshotLogStoreState({ lastSeq: 0, time: 0, floor: 1 }, [])\nconst index = createLogStoreIndex(state)\nconst batch = prepareLogAppend(\n  snapshotLogRecords([{ kind: 'order.created', payload: { id: 'o1' } }]),\n  index\n)\nconsole.log(index.lastSeq, batch[0]?.seq) // Preparation is not a commit.",
            zh: "import {\n  snapshotLogRecords, prepareLogAppend, snapshotLogStoreState, createLogStoreIndex\n} from '@migaia/log-plugin-durable'\n\nconst state = snapshotLogStoreState({ lastSeq: 0, time: 0, floor: 1 }, [])\nconst index = createLogStoreIndex(state)\nconst batch = prepareLogAppend(\n  snapshotLogRecords([{ kind: 'order.created', payload: { id: 'o1' } }]),\n  index\n)\nconsole.log(index.lastSeq, batch[0]?.seq) // 准备批次不等于提交。"
          },
          result: {
            en: 'Prints 0 1. Preparation leaves the index unchanged; apply the exact batch only after commit, and leave rollback unapplied.',
            zh: '输出 0 1。准备不修改索引；仅真实 commit 后应用原批次，rollback 不应用。'
          }
        }
      ]
    },
    prepareLogAppend: {
      role: 'factory',
      purpose: {
        en: 'Prepare sequence/time from a committed head without changing the index or performing I/O.',
        zh: '依据已提交头部准备新的序号与单调时间，不修改索引，不发布通知，也不执行原生访问。'
      },
      params: {
        records: {
          en: 'Already captured record snapshots in append order.',
          zh: '按追加顺序排列的已捕获记录快照。'
        },
        head: {
          en: 'Current committed lastSeq/time read under the original native transaction.',
          zh: '在原生事务内读取的当前已提交 lastSeq 与 time。'
        },
        now: {
          en: 'Optional nonnegative finite timestamp; omitted uses Date.now after admission.',
          zh: '可选非负有限时间戳；省略时在准入后读取 Date.now。'
        }
      },
      returns: {
        en: 'A prepared batch with provisional sequence/time facts; apply it only after native commit.',
        zh: '返回带暂定序号与时间事实的准备批次；只在原生提交之后应用。'
      },
      example: {
        en: "import {\n  snapshotLogRecords, prepareLogAppend, snapshotLogStoreState, createLogStoreIndex\n} from '@migaia/log-plugin-durable'\n\nconst state = snapshotLogStoreState({ lastSeq: 0, time: 0, floor: 1 }, [])\nconst index = createLogStoreIndex(state)\nconst batch = prepareLogAppend(\n  snapshotLogRecords([{ kind: 'order.created', payload: { id: 'o1' } }]),\n  index\n)\nconsole.log(index.lastSeq, batch[0]?.seq) // Preparation is not a commit.",
        zh: "import {\n  snapshotLogRecords, prepareLogAppend, snapshotLogStoreState, createLogStoreIndex\n} from '@migaia/log-plugin-durable'\n\nconst state = snapshotLogStoreState({ lastSeq: 0, time: 0, floor: 1 }, [])\nconst index = createLogStoreIndex(state)\nconst batch = prepareLogAppend(\n  snapshotLogRecords([{ kind: 'order.created', payload: { id: 'o1' } }]),\n  index\n)\nconsole.log(index.lastSeq, batch[0]?.seq) // 准备批次不等于提交。"
      },
      cases: [
        {
          title: {
            en: 'Prepare a native append before commit',
            zh: '原生提交前准备追加批次'
          },
          problem: {
            en: 'Keep asynchronous persistence in its native transaction while reusing the original committed index.',
            zh: '异步持久化仍由原生事务拥有，同时复用原已提交索引。'
          },
          example: {
            en: "import {\n  snapshotLogRecords, prepareLogAppend, snapshotLogStoreState, createLogStoreIndex\n} from '@migaia/log-plugin-durable'\n\nconst state = snapshotLogStoreState({ lastSeq: 0, time: 0, floor: 1 }, [])\nconst index = createLogStoreIndex(state)\nconst batch = prepareLogAppend(\n  snapshotLogRecords([{ kind: 'order.created', payload: { id: 'o1' } }]),\n  index\n)\nconsole.log(index.lastSeq, batch[0]?.seq) // Preparation is not a commit.",
            zh: "import {\n  snapshotLogRecords, prepareLogAppend, snapshotLogStoreState, createLogStoreIndex\n} from '@migaia/log-plugin-durable'\n\nconst state = snapshotLogStoreState({ lastSeq: 0, time: 0, floor: 1 }, [])\nconst index = createLogStoreIndex(state)\nconst batch = prepareLogAppend(\n  snapshotLogRecords([{ kind: 'order.created', payload: { id: 'o1' } }]),\n  index\n)\nconsole.log(index.lastSeq, batch[0]?.seq) // 准备批次不等于提交。"
          },
          result: {
            en: 'Prints 0 1. Preparation leaves the index unchanged; apply the exact batch only after commit, and leave rollback unapplied.',
            zh: '输出 0 1。准备不修改索引；仅真实 commit 后应用原批次，rollback 不应用。'
          }
        }
      ]
    },
    snapshotLogStoreState: {
      role: 'factory',
      purpose: {
        en: 'Validate and detach native recovery rows with the original file-store corruption rules.',
        zh: '用文件资源原有损坏规则校验并分离原生恢复行。'
      },
      params: {
        head: {
          en: 'Permanent native lastSeq/time/floor watermarks.',
          zh: '原生永久保存的序号、时间与保留下界水位。'
        },
        rows: {
          en: 'Contiguous retained rows in sequence order.',
          zh: '按序号顺序排列且连续保留的原生行。'
        },
        decodePayload: {
          en: 'Optional synchronous decoder; omitted uses the payload unchanged before JSON validation.',
          zh: '可选同步解码器；省略时先保留原载荷，再校验 JSON。'
        }
      },
      returns: {
        en: 'An admitted detached recovery snapshot; malformed owned rows reject LOG_STORE_CORRUPT.',
        zh: '返回独立且已准入的恢复快照；所属行损坏时报 LOG_STORE_CORRUPT。'
      },
      example: {
        en: "import {\n  snapshotLogRecords, prepareLogAppend, snapshotLogStoreState, createLogStoreIndex\n} from '@migaia/log-plugin-durable'\n\nconst state = snapshotLogStoreState({ lastSeq: 0, time: 0, floor: 1 }, [])\nconst index = createLogStoreIndex(state)\nconst batch = prepareLogAppend(\n  snapshotLogRecords([{ kind: 'order.created', payload: { id: 'o1' } }]),\n  index\n)\nconsole.log(index.lastSeq, batch[0]?.seq) // Preparation is not a commit.",
        zh: "import {\n  snapshotLogRecords, prepareLogAppend, snapshotLogStoreState, createLogStoreIndex\n} from '@migaia/log-plugin-durable'\n\nconst state = snapshotLogStoreState({ lastSeq: 0, time: 0, floor: 1 }, [])\nconst index = createLogStoreIndex(state)\nconst batch = prepareLogAppend(\n  snapshotLogRecords([{ kind: 'order.created', payload: { id: 'o1' } }]),\n  index\n)\nconsole.log(index.lastSeq, batch[0]?.seq) // 准备批次不等于提交。"
      },
      cases: [
        {
          title: {
            en: 'Prepare a native append before commit',
            zh: '原生提交前准备追加批次'
          },
          problem: {
            en: 'Keep asynchronous persistence in its native transaction while reusing the original committed index.',
            zh: '异步持久化仍由原生事务拥有，同时复用原已提交索引。'
          },
          example: {
            en: "import {\n  snapshotLogRecords, prepareLogAppend, snapshotLogStoreState, createLogStoreIndex\n} from '@migaia/log-plugin-durable'\n\nconst state = snapshotLogStoreState({ lastSeq: 0, time: 0, floor: 1 }, [])\nconst index = createLogStoreIndex(state)\nconst batch = prepareLogAppend(\n  snapshotLogRecords([{ kind: 'order.created', payload: { id: 'o1' } }]),\n  index\n)\nconsole.log(index.lastSeq, batch[0]?.seq) // Preparation is not a commit.",
            zh: "import {\n  snapshotLogRecords, prepareLogAppend, snapshotLogStoreState, createLogStoreIndex\n} from '@migaia/log-plugin-durable'\n\nconst state = snapshotLogStoreState({ lastSeq: 0, time: 0, floor: 1 }, [])\nconst index = createLogStoreIndex(state)\nconst batch = prepareLogAppend(\n  snapshotLogRecords([{ kind: 'order.created', payload: { id: 'o1' } }]),\n  index\n)\nconsole.log(index.lastSeq, batch[0]?.seq) // 准备批次不等于提交。"
          },
          result: {
            en: 'Prints 0 1. Preparation leaves the index unchanged; apply the exact batch only after commit, and leave rollback unapplied.',
            zh: '输出 0 1。准备不修改索引；仅真实 commit 后应用原批次，rollback 不应用。'
          }
        }
      ]
    },
    createLogStoreIndex: {
      role: 'factory',
      purpose: {
        en: 'Create the original committed map and pending list without another resource, queue or close authority.',
        zh: '创建原已提交 Map 与 pending 链表，不引入资源、队列或关闭权。'
      },
      params: {
        snapshot: {
          en: 'Optional admitted recovery snapshot; omitted constructs an empty index.',
          zh: '可选的已准入恢复快照；省略时构造空索引。'
        }
      },
      returns: {
        en: 'The original data-only committed index, without native resources, queue or close authority.',
        zh: '返回原数据索引，不创建原生资源、队列或关闭权限。'
      },
      example: {
        en: "import {\n  snapshotLogRecords, prepareLogAppend, snapshotLogStoreState, createLogStoreIndex\n} from '@migaia/log-plugin-durable'\n\nconst state = snapshotLogStoreState({ lastSeq: 0, time: 0, floor: 1 }, [])\nconst index = createLogStoreIndex(state)\nconst batch = prepareLogAppend(\n  snapshotLogRecords([{ kind: 'order.created', payload: { id: 'o1' } }]),\n  index\n)\nconsole.log(index.lastSeq, batch[0]?.seq) // Preparation is not a commit.",
        zh: "import {\n  snapshotLogRecords, prepareLogAppend, snapshotLogStoreState, createLogStoreIndex\n} from '@migaia/log-plugin-durable'\n\nconst state = snapshotLogStoreState({ lastSeq: 0, time: 0, floor: 1 }, [])\nconst index = createLogStoreIndex(state)\nconst batch = prepareLogAppend(\n  snapshotLogRecords([{ kind: 'order.created', payload: { id: 'o1' } }]),\n  index\n)\nconsole.log(index.lastSeq, batch[0]?.seq) // 准备批次不等于提交。"
      },
      cases: [
        {
          title: {
            en: 'Prepare a native append before commit',
            zh: '原生提交前准备追加批次'
          },
          problem: {
            en: 'Keep asynchronous persistence in its native transaction while reusing the original committed index.',
            zh: '异步持久化仍由原生事务拥有，同时复用原已提交索引。'
          },
          example: {
            en: "import {\n  snapshotLogRecords, prepareLogAppend, snapshotLogStoreState, createLogStoreIndex\n} from '@migaia/log-plugin-durable'\n\nconst state = snapshotLogStoreState({ lastSeq: 0, time: 0, floor: 1 }, [])\nconst index = createLogStoreIndex(state)\nconst batch = prepareLogAppend(\n  snapshotLogRecords([{ kind: 'order.created', payload: { id: 'o1' } }]),\n  index\n)\nconsole.log(index.lastSeq, batch[0]?.seq) // Preparation is not a commit.",
            zh: "import {\n  snapshotLogRecords, prepareLogAppend, snapshotLogStoreState, createLogStoreIndex\n} from '@migaia/log-plugin-durable'\n\nconst state = snapshotLogStoreState({ lastSeq: 0, time: 0, floor: 1 }, [])\nconst index = createLogStoreIndex(state)\nconst batch = prepareLogAppend(\n  snapshotLogRecords([{ kind: 'order.created', payload: { id: 'o1' } }]),\n  index\n)\nconsole.log(index.lastSeq, batch[0]?.seq) // 准备批次不等于提交。"
          },
          result: {
            en: 'Prints 0 1. Preparation leaves the index unchanged; apply the exact batch only after commit, and leave rollback unapplied.',
            zh: '输出 0 1。准备不修改索引；仅真实 commit 后应用原批次，rollback 不应用。'
          }
        }
      ]
    },
    memoryLogStore: {
      role: 'factory',
      purpose: {
        en: 'Create a process-local atomic log; the creator owns disposal.',
        zh: '创建进程内原子日志资源，创建者负责最终释放；持久插件只借用，不接管资源关闭。'
      },
      params: {
        options: {
          en: 'Optional metadata observer and standalone reporter.',
          zh: '可选的元数据观察者与独立资源报告器。'
        }
      },
      options: 'ILogStoreOptions',
      returns: {
        en: 'A synchronous caller-owned ILogStore; it has no plugin ready method.',
        zh: '同步返回调用方拥有的 ILogStore，不具有插件的 ready 方法。'
      },
      example:
        "import { memoryLogStore } from '@migaia/log-plugin-durable'\nimport type { ILogStore } from '@migaia/log-plugin-durable'\n\nconst delegate = memoryLogStore()\nconst custom: ILogStore = {\n  append: records => delegate.append(records),\n  read: (fromSeq, limit) => delegate.read(fromSeq, limit),\n  lastSeq: () => delegate.lastSeq(),\n  onAppend: listener => delegate.onAppend(listener),\n  truncate: beforeSeq => delegate.truncate(beforeSeq),\n  setState: (seq, state) => delegate.setState(seq, state),\n  states: filter => delegate.states(filter),\n  dispose: () => delegate.dispose(),\n  [Symbol.asyncDispose]: () => delegate[Symbol.asyncDispose]()\n}\nawait custom.append([{ kind: 'custom', payload: null }])\nawait custom.dispose()",
      cases: [
        {
          title: {
            en: 'Keep ordered records and explicit resource ownership',
            zh: '保留有序记录与明确资源归属'
          },
          problem: {
            en: 'Use durable log resources without changing ordinary output sinks. Each installed plugin borrows a distinct store; the creator closes it after accepted work ends.',
            zh: '使用持久日志资源而不改变普通输出端。每个插件借用独立 store；已接纳工作结束后由创建者关闭。'
          },
          example: {
            en: "import { memoryLogStore } from '@migaia/log-plugin-durable'\nimport type { ILogStore } from '@migaia/log-plugin-durable'\n\nconst delegate = memoryLogStore()\nconst custom: ILogStore = {\n  append: records => delegate.append(records),\n  read: (fromSeq, limit) => delegate.read(fromSeq, limit),\n  lastSeq: () => delegate.lastSeq(),\n  onAppend: listener => delegate.onAppend(listener),\n  truncate: beforeSeq => delegate.truncate(beforeSeq),\n  setState: (seq, state) => delegate.setState(seq, state),\n  states: filter => delegate.states(filter),\n  dispose: () => delegate.dispose(),\n  [Symbol.asyncDispose]: () => delegate[Symbol.asyncDispose]()\n}\nawait custom.append([{ kind: 'custom', payload: null }])\nawait custom.dispose()",
            zh: "import { memoryLogStore } from '@migaia/log-plugin-durable'\nimport type { ILogStore } from '@migaia/log-plugin-durable'\n\nconst delegate = memoryLogStore()\nconst custom: ILogStore = {\n  append: records => delegate.append(records),\n  read: (fromSeq, limit) => delegate.read(fromSeq, limit),\n  lastSeq: () => delegate.lastSeq(),\n  onAppend: listener => delegate.onAppend(listener),\n  truncate: beforeSeq => delegate.truncate(beforeSeq),\n  setState: (seq, state) => delegate.setState(seq, state),\n  states: filter => delegate.states(filter),\n  dispose: () => delegate.dispose(),\n  [Symbol.asyncDispose]: () => delegate[Symbol.asyncDispose]()\n}\nawait custom.append([{ kind: 'custom', payload: null }])\nawait custom.dispose()"
          },
          result: {
            en: 'Records retain their JSON values. Initialization and whenIdle are explicit; shutdown completion alone does not prove all I/O ended. File stores use actual builtin SQLite, and external native transaction atomicity belongs to its original owner.',
            zh: '记录保留 JSON 原值。初始化与 whenIdle 明确等待；仅 shutdown 返回不能证明全部 I/O 结束。文件资源使用实际内置 SQLite，外部原生事务原子性属于原拥有者。'
          }
        }
      ]
    },
    fileLogStore: {
      role: 'factory',
      purpose: {
        en: 'Open builtin SQLite with a retained exclusive lock and native durable commits.',
        zh: '打开调用方指定的内置 SQLite 日志库，使用原资源排他锁和原生事务持久提交。'
      },
      params: {
        path: {
          en: 'Caller-selected SQLite filename; original resource locking rejects a competing live owner.',
          zh: '调用方选择的 SQLite 文件名；原资源锁拒绝竞争中的活跃拥有者。'
        },
        options: {
          en: 'Optional metadata observer and standalone reporter.',
          zh: '可选的元数据观察者与独立资源报告器。'
        }
      },
      options: 'ILogStoreOptions',
      returns: {
        en: 'Resolves to a caller-owned SQLite ILogStore after opening and recovery; open failure keeps its cause.',
        zh: '打开与恢复后兑现调用方拥有的 SQLite ILogStore；打开失败保留 cause。'
      },
      example:
        "import { fileLogStore } from '@migaia/log-plugin-durable/file'\n\nawait using store = await fileLogStore('./orders.sqlite')\nawait store.append([{ kind: 'order.created', payload: { id: 'o1' } }])\nconsole.log(await store.lastSeq())",
      cases: [
        {
          title: {
            en: 'Keep ordered records and explicit resource ownership',
            zh: '保留有序记录与明确资源归属'
          },
          problem: {
            en: 'Use durable log resources without changing ordinary output sinks. Each installed plugin borrows a distinct store; the creator closes it after accepted work ends.',
            zh: '使用持久日志资源而不改变普通输出端。每个插件借用独立 store；已接纳工作结束后由创建者关闭。'
          },
          example: {
            en: "import { fileLogStore } from '@migaia/log-plugin-durable/file'\n\nawait using store = await fileLogStore('./orders.sqlite')\nawait store.append([{ kind: 'order.created', payload: { id: 'o1' } }])\nconsole.log(await store.lastSeq())",
            zh: "import { fileLogStore } from '@migaia/log-plugin-durable/file'\n\nawait using store = await fileLogStore('./orders.sqlite')\nawait store.append([{ kind: 'order.created', payload: { id: 'o1' } }])\nconsole.log(await store.lastSeq())"
          },
          result: {
            en: 'Records retain their JSON values. Initialization and whenIdle are explicit; shutdown completion alone does not prove all I/O ended. File stores use actual builtin SQLite, and external native transaction atomicity belongs to its original owner.',
            zh: '记录保留 JSON 原值。初始化与 whenIdle 明确等待；仅 shutdown 返回不能证明全部 I/O 结束。文件资源使用实际内置 SQLite，外部原生事务原子性属于原拥有者。'
          }
        }
      ]
    },
    binlogPlugin: {
      role: 'enhancer',
      purpose: {
        en: 'Install the borrowed binlog capability and retain original append/commit/read failures. Durable operations reject independently of nonthrowing log dispatch.',
        zh: '安装借用的 binlog 能力并保留原追加、提交和读取失败；持久操作仍可拒绝，不受日志调用非抛出保证覆盖。'
      },
      params: {
        options: {
          en: 'Optional capabilities and policy supplied by the caller; omit only fields with documented defaults.',
          zh: '由调用方提供的能力与策略；仅有缺省值的字段可以省略。'
        }
      },
      returns: {
        en: 'Use the returned value with the documented host or resource owner; original runtime failures remain observable.',
        zh: '将返回值交给文档所述宿主或资源所有者使用；原始运行错误保持可观察。'
      },
      example:
        "import { createLogHost } from '@migaia/log-host'\nimport { binlogPlugin, memoryLogStore } from '@migaia/log-plugin-durable'\n\nconst store = memoryLogStore()\nconst log = createLogHost({ plugins: [binlogPlugin({ store })] })\nawait log.binlog.append('order.created', { id: 'o1' })\nconsole.log(await log.binlog.read(1))\nawait log.shutdown('manual')",
      optionDocs: {}
    },
    walPlugin: {
      role: 'enhancer',
      purpose: {
        en: 'Install the borrowed wal capability and retain original append/commit/read failures. Durable operations reject independently of nonthrowing log dispatch.',
        zh: '安装借用的 wal 能力并保留原追加、提交和读取失败；持久操作仍可拒绝，不受日志调用非抛出保证覆盖。'
      },
      params: {
        options: {
          en: 'Optional capabilities and policy supplied by the caller; omit only fields with documented defaults.',
          zh: '由调用方提供的能力与策略；仅有缺省值的字段可以省略。'
        }
      },
      returns: {
        en: 'Use the returned value with the documented host or resource owner; original runtime failures remain observable.',
        zh: '将返回值交给文档所述宿主或资源所有者使用；原始运行错误保持可观察。'
      },
      example:
        "import { createLogHost } from '@migaia/log-host'\nimport { binlogPlugin, memoryLogStore } from '@migaia/log-plugin-durable'\n\nconst store = memoryLogStore()\nconst log = createLogHost({ plugins: [binlogPlugin({ store })] })\nawait log.binlog.append('order.created', { id: 'o1' })\nconsole.log(await log.binlog.read(1))\nawait log.shutdown('manual')",
      optionDocs: {}
    },
    undoLogPlugin: {
      role: 'enhancer',
      purpose: {
        en: 'Install the borrowed undo capability and retain original append/commit/read failures. Durable operations reject independently of nonthrowing log dispatch.',
        zh: '安装借用的 undo 能力并保留原追加、提交和读取失败；持久操作仍可拒绝，不受日志调用非抛出保证覆盖。'
      },
      params: {
        options: {
          en: 'Optional capabilities and policy supplied by the caller; omit only fields with documented defaults.',
          zh: '由调用方提供的能力与策略；仅有缺省值的字段可以省略。'
        }
      },
      returns: {
        en: 'Use the returned value with the documented host or resource owner; original runtime failures remain observable.',
        zh: '将返回值交给文档所述宿主或资源所有者使用；原始运行错误保持可观察。'
      },
      example:
        "import { createLogHost } from '@migaia/log-host'\nimport { binlogPlugin, memoryLogStore } from '@migaia/log-plugin-durable'\n\nconst store = memoryLogStore()\nconst log = createLogHost({ plugins: [binlogPlugin({ store })] })\nawait log.binlog.append('order.created', { id: 'o1' })\nconsole.log(await log.binlog.read(1))\nawait log.shutdown('manual')",
      optionDocs: {}
    },
    LogDurableErrorCode: {
      role: 'error',
      purpose: {
        en: 'Semantic codes owned by this package. Read together with source logging.durable.',
        zh: '本包拥有的语义错误码，与来源 `logging.durable` 一起解释。'
      }
    },
    LOG_DURABLE_ERROR_SOURCE: {
      role: 'error',
      purpose: {
        en: 'The stable logging.durable domain identifies errors constructed by this package.',
        zh: '稳定的 `logging.durable` 来源用于识别由本包创建的错误。'
      }
    }
  },
  types: {
    ILogPayload: {
      summary: {
        en: 'Plain JSON output data with independent snapshots.',
        zh: '独立快照的普通 JSON 输出数据。'
      },
      members: {}
    },
    ILogPayloadInput: {
      summary: {
        en: 'Structural input admission retaining named shapes and readonly tuples.',
        zh: '保留命名对象和 readonly 元组的结构输入准入。'
      },
      members: {}
    },
    ILogRecordInput: {
      summary: {
        en: 'Caller input before sequence/time assignment; append captures and validates portable JSON before writing.',
        zh: '序号与时间分配前的调用方输入；追加在写入前捕获并校验可移植 JSON。'
      },
      members: {
        kind: {
          summary: {
            en: 'Caller-defined nonempty record discriminator, such as order.created; it is not a logger level.',
            zh: '调用方定义的非空记录种类，例如 `order.created`，不等同于日志输出级别。'
          }
        },
        payload: {
          summary: {
            en: 'Payload captured as detached portable JSON before persistence; finite numbers and null are admitted.',
            zh: '持久化前捕获为独立可移植 JSON 的载荷；允许有限数字与空值，不支持的数据在写入前拒绝。'
          }
        }
      }
    },
    ILogBatchInput: {
      summary: {
        en: 'Per-record static JSON admission without losing tuple positions.',
        zh: '逐条静态 JSON 准入，不丢失元组位置。'
      },
      members: {}
    },
    ILogRecord: {
      summary: {
        en: 'Detached committed identity, monotonic time and portable JSON payload, without mutable store state.',
        zh: '独立的已提交身份、单调时间与可移植 JSON 载荷，不包含可变存储状态。'
      },
      members: {
        kind: {
          summary: {
            en: 'Caller-defined nonempty record discriminator, such as order.created; it is not a logger level.',
            zh: '调用方定义的非空记录种类，例如 `order.created`，不等同于日志输出级别。'
          }
        },
        payload: {
          summary: {
            en: 'Payload captured as detached portable JSON before persistence; finite numbers and null are admitted.',
            zh: '持久化前捕获为独立可移植 JSON 的载荷；允许有限数字与空值，不支持的数据在写入前拒绝。'
          }
        },
        seq: {
          summary: {
            en: 'Positive safe sequence assigned at commit; the resource never reuses a committed sequence.',
            zh: '提交时分配的正安全整数序号；资源不会复用已经提交的序号。'
          }
        },
        time: {
          summary: {
            en: 'Nonnegative millisecond timestamp, never decreasing within this resource, including reopened files.',
            zh: '非负毫秒时间戳，在同一资源中不递减，文件重开后也保留该水位。'
          }
        }
      },
      example:
        "import { memoryLogStore, LogRecordState } from '@migaia/log-plugin-durable'\n\nawait using store = memoryLogStore()\nconst off = store.onAppend(notice => console.log(notice.lastSeq, notice.count))\nconst sequences = await store.append([{ kind: 'order.created', payload: { id: 'o1' } }])\nconst seq = sequences[0]!\nconsole.log((await store.read(seq, 10))[0]?.kind)\nawait store.setState(seq, LogRecordState.done)\nconsole.log(await store.states(LogRecordState.pending))\nawait store.truncate(seq + 1)\nconsole.log(await store.lastSeq())\noff()",
      scenarios: [
        {
          en: 'Inspect a committed audit record without retaining or mutating its original storage.',
          zh: '检查已提交审计记录，无需持有或修改其原存储。'
        }
      ]
    },
    ILogObservation: {
      summary: {
        en: 'Fixed metadata-only operation observations; they never decide a commit or expose business payloads.',
        zh: '仅包含固定元数据的操作观察，不决定是否提交，也不暴露业务载荷。'
      },
      members: {
        stage: {
          summary: {
            en: 'Original LogStage name for open, operation, close, append or pending observation.',
            zh: '原 LogStage 名称，区分打开、操作、关闭、追加及待处理观察。'
          },
          values: {
            enum: 'LogStage'
          }
        },
        owner: {
          summary: {
            en: 'Resource or installed plugin identity: store, binlog, wal or undo.',
            zh: '资源或已安装插件的身份：store、binlog、wal 或 undo。'
          },
          values: {
            store: {
              en: 'Standalone native resource operation.',
              zh: '独立原生资源执行的操作。'
            },
            binlog: {
              en: 'Installed ordered history plugin operation.',
              zh: '已安装有序历史日志插件的操作。'
            },
            wal: {
              en: 'Installed write-ahead intent plugin operation.',
              zh: '已安装预写意图插件执行的操作。'
            },
            undo: {
              en: 'Installed business image plugin operation.',
              zh: '已安装业务镜像日志插件的操作。'
            }
          }
        },
        operation: {
          summary: {
            en: 'Original operation name within that owner, without a caller payload or native handle.',
            zh: '该拥有者内的原操作名称，不包含调用方载荷或原生句柄。'
          }
        },
        seq: {
          summary: {
            en: 'Optional sequence associated with this actual operation.',
            zh: '与本次真实操作关联的可选日志序号。'
          }
        },
        count: {
          summary: {
            en: 'Optional actual record or result count for this operation.',
            zh: '本次操作实际记录条数或结果条数，可省略。'
          }
        },
        durationMs: {
          summary: {
            en: 'Optional elapsed operation time measured in milliseconds.',
            zh: '可选的真实操作耗时，单位为毫秒。'
          }
        }
      }
    },
    ILogObserver: {
      summary: {
        en: 'Synchronous observation; asynchronous rejection is only reported.',
        zh: '同步观察；异步拒绝只报告而不等待。'
      },
      members: {}
    },
    ILogAppendNotice: {
      summary: {
        en: 'One frozen nonempty append commit notice, without records or business payloads.',
        zh: '一次非空追加提交的冻结通知，不包含记录或业务载荷。'
      },
      members: {
        lastSeq: {
          summary: {
            en: 'Highest sequence committed in this append.',
            zh: '本次追加提交的最大日志序号。'
          }
        },
        count: {
          summary: {
            en: 'Number of records committed in this nonempty batch.',
            zh: '本次非空批次实际提交的记录条数。'
          }
        }
      }
    },
    IUndoImage: {
      summary: {
        en: 'Portable business target and before/after images; logger stores them but owns no business conflict check or replay.',
        zh: '可移植业务目标与前后镜像；日志存储保存它们，但不拥有业务冲突检查或重放。'
      },
      members: {
        target: {
          summary: {
            en: 'Portable JSON target interpreted only by the business consumer.',
            zh: '仅由业务消费方解释的可移植 JSON 目标。'
          }
        },
        before: {
          summary: {
            en: 'Original business image; null remains a legitimate JSON value.',
            zh: '原业务镜像；null 仍然是合法 JSON 值。'
          }
        },
        after: {
          summary: {
            en: 'Resulting business image; it is not a business replay instruction.',
            zh: '结果业务镜像；不是由日志存储执行的业务重放指令。'
          }
        }
      }
    },
    ILogRecordSnapshot: {
      summary: {
        en: 'Captured portable JSON input before sequence/time assignment, without native ownership.',
        zh: '序号与时间分配前已捕获的可移植 JSON 输入，不持有原生资源。'
      },
      members: {
        kind: {
          summary: {
            en: 'Caller-defined nonempty record discriminator, such as order.created; it is not a logger level.',
            zh: '调用方定义的非空记录种类，例如 `order.created`，不等同于日志输出级别。'
          }
        },
        payload: {
          summary: {
            en: 'Payload captured as detached portable JSON before persistence; finite numbers and null are admitted.',
            zh: '持久化前捕获为独立可移植 JSON 的载荷；允许有限数字与空值，不支持的数据在写入前拒绝。'
          }
        }
      }
    },
    ILogStoreSnapshot: {
      summary: {
        en: 'Detached retained rows and permanent sequence/time/floor watermarks used for native recovery.',
        zh: '原生恢复使用的独立保留行与永久序号、时间、保留下界水位。'
      },
      members: {
        lastSeq: {
          summary: {
            en: 'Permanent committed high watermark, zero for a new store.',
            zh: '永久已提交高水位，新存储的值为零。'
          }
        },
        time: {
          summary: {
            en: 'Nonnegative millisecond timestamp, never decreasing within this resource, including reopened files.',
            zh: '非负毫秒时间戳，在同一资源中不递减，文件重开后也保留该水位。'
          }
        },
        floor: {
          summary: {
            en: 'First retained sequence; survives empty storage and can equal lastSeq + 1 after full truncation.',
            zh: '首个仍保留的序号；全部截断后可等于 `lastSeq + 1`，空存储也保留此下界。'
          }
        },
        records: {
          summary: {
            en: 'Contiguous retained committed rows with their original state.',
            zh: '连续保留的已提交记录，包含各自原状态。'
          }
        }
      },
      example: {
        en: "import {\n  snapshotLogRecords, prepareLogAppend, snapshotLogStoreState, createLogStoreIndex\n} from '@migaia/log-plugin-durable'\n\nconst state = snapshotLogStoreState({ lastSeq: 0, time: 0, floor: 1 }, [])\nconst index = createLogStoreIndex(state)\nconst batch = prepareLogAppend(\n  snapshotLogRecords([{ kind: 'order.created', payload: { id: 'o1' } }]),\n  index\n)\nconsole.log(index.lastSeq, batch[0]?.seq) // Preparation is not a commit.",
        zh: "import {\n  snapshotLogRecords, prepareLogAppend, snapshotLogStoreState, createLogStoreIndex\n} from '@migaia/log-plugin-durable'\n\nconst state = snapshotLogStoreState({ lastSeq: 0, time: 0, floor: 1 }, [])\nconst index = createLogStoreIndex(state)\nconst batch = prepareLogAppend(\n  snapshotLogRecords([{ kind: 'order.created', payload: { id: 'o1' } }]),\n  index\n)\nconsole.log(index.lastSeq, batch[0]?.seq) // 准备批次不等于提交。"
      },
      scenarios: [
        {
          en: 'Recover a native snapshot before exposing committed data or constructing a cached exclusive index.',
          zh: '公开已提交数据或构造独占缓存索引前，先恢复原生快照。'
        }
      ]
    },
    ILogStoreRecoveryRow: {
      summary: {
        en: 'Native row fields with undecoded payload; original recovery validates identity/state before payload decoding.',
        zh: '携带未解码载荷的原生行；原恢复在解码载荷前校验身份与状态。'
      },
      members: {
        kind: {
          summary: {
            en: 'Caller-defined nonempty record discriminator, such as order.created; it is not a logger level.',
            zh: '调用方定义的非空记录种类，例如 `order.created`，不等同于日志输出级别。'
          }
        },
        payload: {
          summary: {
            en: 'Native encoded payload passed to the caller decoder after row bounds validate.',
            zh: '行边界校验通过后，交给调用方解码器的原生编码载荷。'
          }
        },
        seq: {
          summary: {
            en: 'Positive safe sequence assigned at commit; the resource never reuses a committed sequence.',
            zh: '提交时分配的正安全整数序号；资源不会复用已经提交的序号。'
          }
        },
        time: {
          summary: {
            en: 'Nonnegative millisecond timestamp, never decreasing within this resource, including reopened files.',
            zh: '非负毫秒时间戳，在同一资源中不递减，文件重开后也保留该水位。'
          }
        },
        state: {
          summary: {
            en: 'Original pending, done or aborted state retained by native persistence.',
            zh: '原生持久层保留的 pending、done 或 aborted 状态。'
          },
          values: {
            enum: 'LogRecordState'
          }
        }
      }
    },
    ILogStoreIndex: {
      summary: {
        en: 'Original committed-data map and pending list; native serialization, persistence, commit and publication remain with the caller.',
        zh: '原已提交数据表与待处理链表；原生串行化、持久化、提交和发布仍归调用方。'
      },
      members: {
        lastSeq: {
          summary: {
            en: 'Permanent committed high watermark, zero for a new index.',
            zh: '永久已提交高水位，新索引的值为零。'
          }
        },
        time: {
          summary: {
            en: 'Nonnegative millisecond timestamp, never decreasing within this resource, including reopened files.',
            zh: '非负毫秒时间戳，在同一资源中不递减，文件重开后也保留该水位。'
          }
        },
        floor: {
          summary: {
            en: 'First retained sequence; survives empty storage and can equal lastSeq + 1 after full truncation.',
            zh: '首个仍保留的序号；全部截断后可等于 `lastSeq + 1`，空存储也保留此下界。'
          }
        },
        read: {
          summary: {
            en: 'Read ascending retained snapshots without changing record state or consuming them.',
            zh: '升序读取保留记录的独立快照，不改变记录状态，也不消费记录。'
          },
          params: {
            fromSeq: {
              en: 'Inclusive positive safe sequence, normally returned by append; a truncated prefix starts at the retained floor.',
              zh: '包含边界的正安全整数，通常取自 `append`；截断前缀自动从仍保留的下界开始。'
            },
            limit: {
              en: 'Maximum returned records, a nonnegative safe integer; zero returns an empty array.',
              zh: '本次最多返回的条数，必须为非负安全整数；零表示空数组。'
            }
          },
          returns: {
            en: 'Detached retained snapshots synchronously, without native I/O.',
            zh: '同步返回保留记录的独立快照，不执行原生输入输出。'
          },
          example:
            "import {\n  memoryLogStore, createLogStoreIndex, snapshotLogRecords, LogRecordState\n} from '@migaia/log-plugin-durable'\n\nawait using store = memoryLogStore()\nconst index = createLogStoreIndex()\nawait store.append(snapshotLogRecords([{ kind: 'order.created', payload: { id: 'o1' } }]))\nconst committed = await store.read(1, 10)\nindex.applyAppend(committed)\nconsole.log(index.read(1, 10)[0]?.kind, index.pending())\nconsole.log(index.lastSeq, index.time >= 0, index.floor)\nif (index.checkState(1, LogRecordState.done)) {\n  await store.setState(1, LogRecordState.done)\n  index.applyState(1, LogRecordState.done)\n}\nif (index.checkTruncate(2)) {\n  await store.truncate(2)\n  index.applyTruncate(2)\n}\nconsole.log(index.read(1, 10), index.pending(), index.lastSeq, index.floor)"
        },
        pending: {
          summary: {
            en: 'Visit only active pending entries in sequence order.',
            zh: '只遍历仍待处理的条目，并按原序号顺序输出。'
          },
          returns: {
            en: 'A fresh array of pending sequences.',
            zh: '返回待处理序号的新数组，不包含终态记录。'
          },
          example:
            "import {\n  memoryLogStore, createLogStoreIndex, snapshotLogRecords, LogRecordState\n} from '@migaia/log-plugin-durable'\n\nawait using store = memoryLogStore()\nconst index = createLogStoreIndex()\nawait store.append(snapshotLogRecords([{ kind: 'order.created', payload: { id: 'o1' } }]))\nconst committed = await store.read(1, 10)\nindex.applyAppend(committed)\nconsole.log(index.read(1, 10)[0]?.kind, index.pending())\nconsole.log(index.lastSeq, index.time >= 0, index.floor)\nif (index.checkState(1, LogRecordState.done)) {\n  await store.setState(1, LogRecordState.done)\n  index.applyState(1, LogRecordState.done)\n}\nif (index.checkTruncate(2)) {\n  await store.truncate(2)\n  index.applyTruncate(2)\n}\nconsole.log(index.read(1, 10), index.pending(), index.lastSeq, index.floor)"
        },
        checkTruncate: {
          summary: {
            en: 'Check a proposed floor before native persistence without changing the index.',
            zh: '原生持久化前检查拟推进的下界，不改变索引数据。'
          },
          params: {
            beforeSeq: {
              en: 'Exclusive retained boundary, a positive safe integer at most lastSeq + 1; earlier floors are harmless no-ops.',
              zh: '不删除的首个序号，须为不超过 `lastSeq + 1` 的正安全整数；不推进现有下界时不写入。'
            }
          },
          returns: {
            en: 'True if the floor advances, false for a no-op; an excessive boundary rejects INVALID_OPTION.',
            zh: '推进下界时返回真，无变化时返回假；超出已提交尾部的边界拒绝 `INVALID_OPTION`。'
          },
          example:
            "import {\n  memoryLogStore, createLogStoreIndex, snapshotLogRecords, LogRecordState\n} from '@migaia/log-plugin-durable'\n\nawait using store = memoryLogStore()\nconst index = createLogStoreIndex()\nawait store.append(snapshotLogRecords([{ kind: 'order.created', payload: { id: 'o1' } }]))\nconst committed = await store.read(1, 10)\nindex.applyAppend(committed)\nconsole.log(index.read(1, 10)[0]?.kind, index.pending())\nconsole.log(index.lastSeq, index.time >= 0, index.floor)\nif (index.checkState(1, LogRecordState.done)) {\n  await store.setState(1, LogRecordState.done)\n  index.applyState(1, LogRecordState.done)\n}\nif (index.checkTruncate(2)) {\n  await store.truncate(2)\n  index.applyTruncate(2)\n}\nconsole.log(index.read(1, 10), index.pending(), index.lastSeq, index.floor)"
        },
        applyTruncate: {
          summary: {
            en: 'Apply an admitted floor only after the caller has committed native deletion.',
            zh: '仅在调用方完成原生删除提交后，应用已经检查过的新下界。'
          },
          params: {
            beforeSeq: {
              en: 'Exclusive retained boundary, a positive safe integer at most lastSeq + 1; earlier floors are harmless no-ops.',
              zh: '不删除的首个序号，须为不超过 `lastSeq + 1` 的正安全整数；不推进现有下界时不写入。'
            }
          },
          returns: {
            en: 'Removes the committed prefix and its pending links locally; performs no native I/O.',
            zh: '移除本地已提交前缀及待处理链接，不执行原生输入输出。'
          },
          example:
            "import {\n  memoryLogStore, createLogStoreIndex, snapshotLogRecords, LogRecordState\n} from '@migaia/log-plugin-durable'\n\nawait using store = memoryLogStore()\nconst index = createLogStoreIndex()\nawait store.append(snapshotLogRecords([{ kind: 'order.created', payload: { id: 'o1' } }]))\nconst committed = await store.read(1, 10)\nindex.applyAppend(committed)\nconsole.log(index.read(1, 10)[0]?.kind, index.pending())\nconsole.log(index.lastSeq, index.time >= 0, index.floor)\nif (index.checkState(1, LogRecordState.done)) {\n  await store.setState(1, LogRecordState.done)\n  index.applyState(1, LogRecordState.done)\n}\nif (index.checkTruncate(2)) {\n  await store.truncate(2)\n  index.applyTruncate(2)\n}\nconsole.log(index.read(1, 10), index.pending(), index.lastSeq, index.floor)"
        },
        checkState: {
          summary: {
            en: 'Check one original pending transition without applying it or writing native data.',
            zh: '检查原待处理记录的状态迁移，不应用变更，也不写入原生数据。'
          },
          params: {
            seq: {
              en: 'Sequence issued by append for an existing pending record in this resource.',
              zh: '本资源 `append` 分配给现有待处理记录的序号。'
            },
            state: {
              en: 'LogRecordState.done or aborted ends the intent; pending leaves a still-pending row unchanged.',
              zh: '`LogRecordState.done` 或 `aborted` 结束意图；`pending` 仅对仍待处理的记录保持原样。'
            }
          },
          returns: {
            en: 'True for a terminal transition, false for pending; missing or terminal rows reject WAL_RECORD_INVALID.',
            zh: '推进终态时返回真，保持待处理时返回假；记录缺失或已终结时拒绝 `WAL_RECORD_INVALID`。'
          },
          example:
            "import {\n  memoryLogStore, createLogStoreIndex, snapshotLogRecords, LogRecordState\n} from '@migaia/log-plugin-durable'\n\nawait using store = memoryLogStore()\nconst index = createLogStoreIndex()\nawait store.append(snapshotLogRecords([{ kind: 'order.created', payload: { id: 'o1' } }]))\nconst committed = await store.read(1, 10)\nindex.applyAppend(committed)\nconsole.log(index.read(1, 10)[0]?.kind, index.pending())\nconsole.log(index.lastSeq, index.time >= 0, index.floor)\nif (index.checkState(1, LogRecordState.done)) {\n  await store.setState(1, LogRecordState.done)\n  index.applyState(1, LogRecordState.done)\n}\nif (index.checkTruncate(2)) {\n  await store.truncate(2)\n  index.applyTruncate(2)\n}\nconsole.log(index.read(1, 10), index.pending(), index.lastSeq, index.floor)"
        },
        applyState: {
          summary: {
            en: 'Apply the admitted terminal state after the original native transaction commits.',
            zh: '原生事务提交后，应用已经通过检查的终态变更。'
          },
          params: {
            seq: {
              en: 'Sequence issued by append for an existing pending record in this resource.',
              zh: '本资源 `append` 分配给现有待处理记录的序号。'
            },
            state: {
              en: 'LogRecordState.done or aborted ends the intent; pending leaves a still-pending row unchanged.',
              zh: '`LogRecordState.done` 或 `aborted` 结束意图；`pending` 仅对仍待处理的记录保持原样。'
            }
          },
          returns: {
            en: 'Updates local state and removes the active pending link; it publishes no notice.',
            zh: '更新本地状态并移除活跃链接，不发布追加通知。'
          },
          example:
            "import {\n  memoryLogStore, createLogStoreIndex, snapshotLogRecords, LogRecordState\n} from '@migaia/log-plugin-durable'\n\nawait using store = memoryLogStore()\nconst index = createLogStoreIndex()\nawait store.append(snapshotLogRecords([{ kind: 'order.created', payload: { id: 'o1' } }]))\nconst committed = await store.read(1, 10)\nindex.applyAppend(committed)\nconsole.log(index.read(1, 10)[0]?.kind, index.pending())\nconsole.log(index.lastSeq, index.time >= 0, index.floor)\nif (index.checkState(1, LogRecordState.done)) {\n  await store.setState(1, LogRecordState.done)\n  index.applyState(1, LogRecordState.done)\n}\nif (index.checkTruncate(2)) {\n  await store.truncate(2)\n  index.applyTruncate(2)\n}\nconsole.log(index.read(1, 10), index.pending(), index.lastSeq, index.floor)"
        },
        applyAppend: {
          summary: {
            en: 'Apply the exact prepared batch after native commit; rollback must leave the index unchanged.',
            zh: '原生提交后应用原准备批次；回滚时必须保持索引不变。'
          },
          params: {
            records: {
              en: 'The original prepared records whose native persistence has succeeded, in sequence order.',
              zh: '原生持久化已经成功的原准备记录，按序号顺序排列。'
            }
          },
          returns: {
            en: 'Advances local head/time and registers pending records without native I/O or publication.',
            zh: '推进本地序号与时间并登记待处理记录，不执行原生写入或发布通知。'
          },
          example:
            "import {\n  memoryLogStore, createLogStoreIndex, snapshotLogRecords, LogRecordState\n} from '@migaia/log-plugin-durable'\n\nawait using store = memoryLogStore()\nconst index = createLogStoreIndex()\nawait store.append(snapshotLogRecords([{ kind: 'order.created', payload: { id: 'o1' } }]))\nconst committed = await store.read(1, 10)\nindex.applyAppend(committed)\nconsole.log(index.read(1, 10)[0]?.kind, index.pending())\nconsole.log(index.lastSeq, index.time >= 0, index.floor)\nif (index.checkState(1, LogRecordState.done)) {\n  await store.setState(1, LogRecordState.done)\n  index.applyState(1, LogRecordState.done)\n}\nif (index.checkTruncate(2)) {\n  await store.truncate(2)\n  index.applyTruncate(2)\n}\nconsole.log(index.read(1, 10), index.pending(), index.lastSeq, index.floor)"
        }
      },
      example:
        "import {\n  memoryLogStore, createLogStoreIndex, snapshotLogRecords, LogRecordState\n} from '@migaia/log-plugin-durable'\n\nawait using store = memoryLogStore()\nconst index = createLogStoreIndex()\nawait store.append(snapshotLogRecords([{ kind: 'order.created', payload: { id: 'o1' } }]))\nconst committed = await store.read(1, 10)\nindex.applyAppend(committed)\nconsole.log(index.read(1, 10)[0]?.kind, index.pending())\nconsole.log(index.lastSeq, index.time >= 0, index.floor)\nif (index.checkState(1, LogRecordState.done)) {\n  await store.setState(1, LogRecordState.done)\n  index.applyState(1, LogRecordState.done)\n}\nif (index.checkTruncate(2)) {\n  await store.truncate(2)\n  index.applyTruncate(2)\n}\nconsole.log(index.read(1, 10), index.pending(), index.lastSeq, index.floor)",
      scenarios: [
        {
          en: 'Prepare a native append from its current head and apply exactly that batch only after actual commit.',
          zh: '按原生当前头部准备追加，仅在真正提交之后应用同一批次。'
        }
      ]
    },
    ILogStore: {
      summary: {
        en: 'Durable logger contract with explicit ownership and initialization.',
        zh: '具有明确资源归属与准备顺序的持久日志契约。'
      },
      scenarios: [
        {
          en: 'Own a standalone atomic log while installed plugins only borrow it.',
          zh: '拥有独立原子日志资源，安装后的插件只借用它。'
        }
      ],
      example:
        "import { memoryLogStore, LogRecordState } from '@migaia/log-plugin-durable'\n\nawait using store = memoryLogStore()\nconst off = store.onAppend(notice => console.log(notice.lastSeq, notice.count))\nconst sequences = await store.append([{ kind: 'order.created', payload: { id: 'o1' } }])\nconst seq = sequences[0]!\nconsole.log((await store.read(seq, 10))[0]?.kind)\nawait store.setState(seq, LogRecordState.done)\nconsole.log(await store.states(LogRecordState.pending))\nawait store.truncate(seq + 1)\nconsole.log(await store.lastSeq())\noff()",
      members: {
        append: {
          summary: {
            en: 'Capture portable JSON immediately, then atomically commit the entire batch as pending records. Empty batches allocate no sequences.',
            zh: '立即捕获可移植 JSON，然后将整批原子提交为待处理记录；空批不分配序号。'
          },
          params: {
            records: {
              en: 'Ordered kind/payload inputs. Kinds are nonempty strings; payloads must be finite portable JSON without accessors, cycles or unsupported values.',
              zh: '按追加顺序排列的种类与载荷；种类必须是非空字符串，载荷须为有限、无访问器、无循环的可移植 JSON。'
            }
          },
          returns: {
            en: 'Committed sequence numbers in input order; no partial batch becomes visible.',
            zh: '按输入顺序返回已提交序号，不会暴露部分成功的批次。'
          },
          example:
            "import { memoryLogStore, LogRecordState } from '@migaia/log-plugin-durable'\n\nawait using store = memoryLogStore()\nconst off = store.onAppend(notice => console.log(notice.lastSeq, notice.count))\nconst sequences = await store.append([{ kind: 'order.created', payload: { id: 'o1' } }])\nconst seq = sequences[0]!\nconsole.log((await store.read(seq, 10))[0]?.kind)\nawait store.setState(seq, LogRecordState.done)\nconsole.log(await store.states(LogRecordState.pending))\nawait store.truncate(seq + 1)\nconsole.log(await store.lastSeq())\noff()"
        },
        read: {
          summary: {
            en: 'Read ascending retained snapshots without changing record state or consuming them.',
            zh: '升序读取保留记录的独立快照，不改变记录状态，也不消费记录。'
          },
          params: {
            fromSeq: {
              en: 'Inclusive positive safe sequence, normally returned by append; a truncated prefix starts at the retained floor.',
              zh: '包含边界的正安全整数，通常取自 `append`；截断前缀自动从仍保留的下界开始。'
            },
            limit: {
              en: 'Maximum returned records, a nonnegative safe integer; zero returns an empty array.',
              zh: '本次最多返回的条数，必须为非负安全整数；零表示空数组。'
            }
          },
          returns: {
            en: 'Detached record and JSON payload snapshots in ascending sequence order.',
            zh: '按序号升序返回记录及其 JSON 载荷的独立快照。'
          },
          example:
            "import { memoryLogStore, LogRecordState } from '@migaia/log-plugin-durable'\n\nawait using store = memoryLogStore()\nconst off = store.onAppend(notice => console.log(notice.lastSeq, notice.count))\nconst sequences = await store.append([{ kind: 'order.created', payload: { id: 'o1' } }])\nconst seq = sequences[0]!\nconsole.log((await store.read(seq, 10))[0]?.kind)\nawait store.setState(seq, LogRecordState.done)\nconsole.log(await store.states(LogRecordState.pending))\nawait store.truncate(seq + 1)\nconsole.log(await store.lastSeq())\noff()"
        },
        lastSeq: {
          summary: {
            en: 'Read the permanent committed high watermark, preserved after complete prefix truncation.',
            zh: '读取永久保留的已提交高水位，即使全部前缀记录被截断也不回退。'
          },
          returns: {
            en: 'Zero for a new resource, otherwise the highest committed sequence; it is never reused.',
            zh: '新资源返回零，否则返回已提交的最大序号；已使用序号不会复用。'
          },
          example:
            "import { memoryLogStore, LogRecordState } from '@migaia/log-plugin-durable'\n\nawait using store = memoryLogStore()\nconst off = store.onAppend(notice => console.log(notice.lastSeq, notice.count))\nconst sequences = await store.append([{ kind: 'order.created', payload: { id: 'o1' } }])\nconst seq = sequences[0]!\nconsole.log((await store.read(seq, 10))[0]?.kind)\nawait store.setState(seq, LogRecordState.done)\nconsole.log(await store.states(LogRecordState.pending))\nawait store.truncate(seq + 1)\nconsole.log(await store.lastSeq())\noff()"
        },
        onAppend: {
          summary: {
            en: 'Observe one frozen notice after each nonempty real commit; listener failures only report.',
            zh: '每次非空真实提交后观察一个冻结通知；监听器失败只报告，不改变提交结果。'
          },
          params: {
            listener: {
              en: 'Receives frozen lastSeq/count metadata and returns void. It runs only after commit; thrown or asynchronous failures are reported.',
              zh: '接收冻结的末尾序号与提交条数，返回空值；只在提交后调用，抛错或异步拒绝均只报告。'
            }
          },
          returns: {
            en: 'An idempotent cancellation function that removes this listener only.',
            zh: '幂等取消函数，只移除本次登记的监听器。'
          },
          example:
            "import { memoryLogStore, LogRecordState } from '@migaia/log-plugin-durable'\n\nawait using store = memoryLogStore()\nconst off = store.onAppend(notice => console.log(notice.lastSeq, notice.count))\nconst sequences = await store.append([{ kind: 'order.created', payload: { id: 'o1' } }])\nconst seq = sequences[0]!\nconsole.log((await store.read(seq, 10))[0]?.kind)\nawait store.setState(seq, LogRecordState.done)\nconsole.log(await store.states(LogRecordState.pending))\nawait store.truncate(seq + 1)\nconsole.log(await store.lastSeq())\noff()"
        },
        truncate: {
          summary: {
            en: 'Delete only the prefix below the requested sequence while keeping sequence/time watermarks.',
            zh: '只删除指定序号之前的前缀，保留序号和时间高水位。'
          },
          params: {
            beforeSeq: {
              en: 'Exclusive retained boundary, a positive safe integer at most lastSeq + 1; earlier floors are harmless no-ops.',
              zh: '不删除的首个序号，须为不超过 `lastSeq + 1` 的正安全整数；不推进现有下界时不写入。'
            }
          },
          returns: {
            en: 'Resolves after truncation commits; future appends keep increasing the original sequence.',
            zh: '截断提交后完成，后续追加继续递增原序号。'
          },
          example:
            "import { memoryLogStore, LogRecordState } from '@migaia/log-plugin-durable'\n\nawait using store = memoryLogStore()\nconst off = store.onAppend(notice => console.log(notice.lastSeq, notice.count))\nconst sequences = await store.append([{ kind: 'order.created', payload: { id: 'o1' } }])\nconst seq = sequences[0]!\nconsole.log((await store.read(seq, 10))[0]?.kind)\nawait store.setState(seq, LogRecordState.done)\nconsole.log(await store.states(LogRecordState.pending))\nawait store.truncate(seq + 1)\nconsole.log(await store.lastSeq())\noff()"
        },
        setState: {
          summary: {
            en: 'Advance an existing pending record to a terminal state; missing or terminal rows reject WAL_RECORD_INVALID.',
            zh: '将现有待处理记录推进至终态；不存在或已经结束的记录拒绝 `WAL_RECORD_INVALID`。'
          },
          params: {
            seq: {
              en: 'Sequence issued by append for an existing pending record in this resource.',
              zh: '本资源 `append` 分配给现有待处理记录的序号。'
            },
            state: {
              en: 'LogRecordState.done or aborted ends the intent; pending leaves a still-pending row unchanged.',
              zh: '`LogRecordState.done` 或 `aborted` 结束意图；`pending` 仅对仍待处理的记录保持原样。'
            }
          },
          returns: {
            en: 'Resolves after the state change commits; terminal records cannot reopen.',
            zh: '状态变更提交后完成，终态记录不能重新打开。'
          },
          example:
            "import { memoryLogStore, LogRecordState } from '@migaia/log-plugin-durable'\n\nawait using store = memoryLogStore()\nconst off = store.onAppend(notice => console.log(notice.lastSeq, notice.count))\nconst sequences = await store.append([{ kind: 'order.created', payload: { id: 'o1' } }])\nconst seq = sequences[0]!\nconsole.log((await store.read(seq, 10))[0]?.kind)\nawait store.setState(seq, LogRecordState.done)\nconsole.log(await store.states(LogRecordState.pending))\nawait store.truncate(seq + 1)\nconsole.log(await store.lastSeq())\noff()"
        },
        states: {
          summary: {
            en: 'Return only active pending sequence numbers in creation order, excluding terminal history.',
            zh: '只按创建顺序返回仍待处理的序号，不返回已完成或中止的历史。'
          },
          params: {
            filter: {
              en: 'Only LogRecordState.pending is supported; any other filter rejects INVALID_OPTION.',
              zh: '只接受 `LogRecordState.pending`，其他筛选值拒绝 `INVALID_OPTION`。'
            }
          },
          returns: {
            en: 'An ascending snapshot of the active pending sequences.',
            zh: '待处理序号的升序快照，后续状态变化不会修改此数组。'
          },
          example:
            "import { memoryLogStore, LogRecordState } from '@migaia/log-plugin-durable'\n\nawait using store = memoryLogStore()\nconst off = store.onAppend(notice => console.log(notice.lastSeq, notice.count))\nconst sequences = await store.append([{ kind: 'order.created', payload: { id: 'o1' } }])\nconst seq = sequences[0]!\nconsole.log((await store.read(seq, 10))[0]?.kind)\nawait store.setState(seq, LogRecordState.done)\nconsole.log(await store.states(LogRecordState.pending))\nawait store.truncate(seq + 1)\nconsole.log(await store.lastSeq())\noff()"
        },
        dispose: {
          summary: {
            en: 'Close admission immediately and drain accepted work before releasing the resource.',
            zh: '立即停止接纳新工作，在释放资源前排空已经接纳的操作。'
          },
          returns: {
            en: 'One cached explicit cleanup Promise; cleanup failure rejects and remains observable.',
            zh: '返回缓存的显式清理 Promise；清理失败时拒绝，调用方可观察原错误。'
          },
          example:
            "import { memoryLogStore } from '@migaia/log-plugin-durable'\nconst store = memoryLogStore()\nawait store.dispose()"
        },
        '[Symbol.asyncDispose]': {
          summary: {
            en: 'Share the same cleanup through a separate cached symbolic completion Promise.',
            zh: '通过另一个缓存的符号完成 Promise 共享同一次资源清理。'
          },
          returns: {
            en: 'Resolves after cleanup, reporting cleanup failure rather than rejecting this symbolic Promise.',
            zh: '清理后完成；失败交给报告器，符号 Promise 本身仍成功。'
          },
          example:
            "import { memoryLogStore, LogRecordState } from '@migaia/log-plugin-durable'\n\nawait using store = memoryLogStore()\nconst off = store.onAppend(notice => console.log(notice.lastSeq, notice.count))\nconst sequences = await store.append([{ kind: 'order.created', payload: { id: 'o1' } }])\nconst seq = sequences[0]!\nconsole.log((await store.read(seq, 10))[0]?.kind)\nawait store.setState(seq, LogRecordState.done)\nconsole.log(await store.states(LogRecordState.pending))\nawait store.truncate(seq + 1)\nconsole.log(await store.lastSeq())\noff()"
        }
      }
    },
    IBinlogExt: {
      summary: {
        en: 'Durable logger contract with explicit ownership and initialization.',
        zh: '具有明确资源归属与准备顺序的持久日志契约。'
      },
      members: {
        binlog: {
          summary: {
            en: 'Installed ordered log API; unavailable without the binlog plugin.',
            zh: '安装后的有序日志 API；未安装 binlog 时不存在。'
          }
        }
      }
    },
    IWalExt: {
      summary: {
        en: 'Durable logger contract with explicit ownership and initialization.',
        zh: '具有明确资源归属与准备顺序的持久日志契约。'
      },
      members: {
        wal: {
          summary: {
            en: 'Installed persistent intent API with pending, complete and abort operations.',
            zh: '安装后的持久意图 API，提供待处理读取与完成、中止操作。'
          }
        }
      }
    },
    IUndoLogExt: {
      summary: {
        en: 'Durable logger contract with explicit ownership and initialization.',
        zh: '具有明确资源归属与准备顺序的持久日志契约。'
      },
      members: {
        undo: {
          summary: {
            en: 'Installed active image API; no business rollback authority.',
            zh: '安装后的活跃镜像 API；不拥有业务回滚权。'
          }
        }
      }
    },
    IDurablePluginOptions: {
      summary: {
        en: 'Durable logger contract with explicit ownership and initialization.',
        zh: '具有明确资源归属与准备顺序的持久日志契约。'
      },
      members: {
        store: {
          summary: {
            en: 'Original caller-owned ILogStore, reserved for one installed durable plugin; plugin removal never closes it.',
            zh: '调用方拥有的原日志资源，只供一个已安装持久插件使用；移除插件不会关闭它。'
          },
          example:
            "import { createLogHost } from '@migaia/log-host'\nimport { binlogPlugin, memoryLogStore } from '@migaia/log-plugin-durable'\nawait using store = memoryLogStore()\nconst log = createLogHost({\n  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },\n  plugins: [binlogPlugin({ store })]\n})\ntry { await log.binlog.ready() }\nfinally { await log.shutdown('manual'); await log.binlog.whenIdle() }"
        },
        observe: {
          summary: {
            en: 'Receives metadata-only stage observations; throws, then-getter errors and late rejection only report.',
            zh: '接收只含元数据的阶段观察；抛错、读取 then 失败与迟到拒绝均只报告。'
          },
          default: {
            en: 'Omitted: no stage observer is called.',
            zh: '省略时不调用阶段观察者。'
          },
          whenToUse: {
            en: 'Trace lifecycle and operation timing without receiving business payloads or intervening in commits.',
            zh: '观察生命周期及操作耗时，不读取业务载荷，也不介入提交。'
          },
          example:
            "import { memoryLogStore } from '@migaia/log-plugin-durable'\nawait using store = memoryLogStore({ observe: event => console.log(event.stage) })\nawait store.append([{ kind: 'audit', payload: null }])"
        }
      }
    },
    IBinlogOptions: {
      summary: {
        en: 'Durable logger contract with explicit ownership and initialization.',
        zh: '具有明确资源归属与准备顺序的持久日志契约。'
      },
      members: {
        store: {
          summary: {
            en: 'Original caller-owned ILogStore, reserved for one installed durable plugin; plugin removal never closes it.',
            zh: '调用方拥有的原日志资源，只供一个已安装持久插件使用；移除插件不会关闭它。'
          },
          example:
            "import { createLogHost } from '@migaia/log-host'\nimport { binlogPlugin, memoryLogStore } from '@migaia/log-plugin-durable'\nawait using store = memoryLogStore()\nconst log = createLogHost({\n  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },\n  plugins: [binlogPlugin({ store })]\n})\ntry { await log.binlog.ready() }\nfinally { await log.shutdown('manual'); await log.binlog.whenIdle() }"
        },
        observe: {
          summary: {
            en: 'Receives metadata-only stage observations; throws, then-getter errors and late rejection only report.',
            zh: '接收只含元数据的阶段观察；抛错、读取 then 失败与迟到拒绝均只报告。'
          },
          default: {
            en: 'Omitted: no stage observer is called.',
            zh: '省略时不调用阶段观察者。'
          },
          whenToUse: {
            en: 'Trace lifecycle and operation timing without receiving business payloads or intervening in commits.',
            zh: '观察生命周期及操作耗时，不读取业务载荷，也不介入提交。'
          },
          example:
            "import { memoryLogStore } from '@migaia/log-plugin-durable'\nawait using store = memoryLogStore({ observe: event => console.log(event.stage) })\nawait store.append([{ kind: 'audit', payload: null }])"
        },
        echo: {
          summary: {
            en: 'Emit kind and sequence/time metadata through ordinary logging, never business payloads.',
            zh: '通过普通日志输出种类与序号、时间元数据，不输出业务载荷。'
          },
          default: {
            en: 'false: no ordinary echo.',
            zh: '缺省关闭普通输出回声。'
          },
          example:
            "import { createLogHost } from '@migaia/log-host'\nimport { binlogPlugin, memoryLogStore } from '@migaia/log-plugin-durable'\nawait using store = memoryLogStore()\nconst log = createLogHost({\n  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },\n  plugins: [binlogPlugin({ store, echo: true })]\n})\ntry {\n  await log.binlog.ready()\n  await log.binlog.append('audit', { count: 1 })\n  console.log(await log.binlog.lastSeq())\n} finally {\n  await log.shutdown('manual')\n  await log.binlog.whenIdle()\n}"
        }
      }
    },
    ILogStoreOptions: {
      summary: {
        en: 'Durable logger contract with explicit ownership and initialization.',
        zh: '具有明确资源归属与准备顺序的持久日志契约。'
      },
      members: {
        observe: {
          summary: {
            en: 'Receives metadata-only stage observations; throws, then-getter errors and late rejection only report.',
            zh: '接收只含元数据的阶段观察；抛错、读取 then 失败与迟到拒绝均只报告。'
          },
          default: {
            en: 'Omitted: no stage observer is called.',
            zh: '省略时不调用阶段观察者。'
          },
          whenToUse: {
            en: 'Trace lifecycle and operation timing without receiving business payloads or intervening in commits.',
            zh: '观察生命周期及操作耗时，不读取业务载荷，也不介入提交。'
          },
          example:
            "import { memoryLogStore } from '@migaia/log-plugin-durable'\nawait using store = memoryLogStore({ observe: event => console.log(event.stage) })\nawait store.append([{ kind: 'audit', payload: null }])"
        },
        report: {
          summary: {
            en: 'Standalone failure reporter; a failing reporter uses the existing terminal diagnostics channel.',
            zh: '独立资源的失败报告器；报告器本身失败时走既有终端诊断通道。'
          },
          default: {
            en: 'The original logger terminal reporting channel.',
            zh: '使用宿主终端报告通道。'
          },
          whenToUse: {
            en: 'Route resource cleanup and observation failures into application diagnostics.',
            zh: '需要将资源清理与观察失败转交应用诊断时使用。'
          },
          example:
            "import { memoryLogStore } from '@migaia/log-plugin-durable'\nawait using store = memoryLogStore({ report: error => console.error(error) })\nconsole.log(await store.lastSeq())"
        }
      }
    },
    ILogAppendOptions: {
      summary: {
        en: 'Durable logger contract with explicit ownership and initialization.',
        zh: '具有明确资源归属与准备顺序的持久日志契约。'
      },
      members: {
        transaction: {
          summary: {
            en: 'Existing owner-created append port; prepare logger plugins before opening its native transaction.',
            zh: '由原拥有者创建的追加端口；先准备 logger 插件再打开原生事务。'
          }
        }
      }
    },
    ILogAppendPort: {
      summary: {
        en: 'Durable logger contract with explicit ownership and initialization.',
        zh: '具有明确资源归属与准备顺序的持久日志契约。'
      },
      members: {
        store: {
          summary: {
            en: 'Exact resource identity bound by the original owner, not write authority itself.',
            zh: '原拥有者绑定的精确资源身份；此字段本身不授予写权限。'
          }
        },
        append: {
          summary: {
            en: 'Immediately append within the current native transaction; return provisional sequences.',
            zh: '立即在当前原生事务追加，返回暂定序号。'
          },
          params: {
            records: {
              en: 'Captured portable kind/payload records for this native transaction.',
              zh: '当前原生事务使用的已捕获可移植种类与载荷记录。'
            }
          },
          returns: {
            en: 'Provisional sequence numbers; they become committed only at the original native commit.',
            zh: '暂定序号；只有原生提交成功后才成为已提交序号。'
          }
        },
        onCommit: {
          summary: {
            en: 'Register one actual commit effect and return its cancellation function.',
            zh: '登记真实提交观察并返回取消函数。'
          },
          params: {
            effect: {
              en: 'Synchronous effect invoked only after a known native commit.',
              zh: '仅在原生提交结果已确认后调用的同步作用。'
            }
          },
          returns: {
            en: 'Cancellation function for this original terminal registration.',
            zh: '返回本次原终点登记的取消函数。'
          }
        },
        onRollback: {
          summary: {
            en: 'Register one actual rollback effect and return its cancellation function.',
            zh: '登记真实回滚观察并返回取消函数。'
          },
          params: {
            effect: {
              en: 'Synchronous effect invoked only after a known native rollback.',
              zh: '仅在原生回滚结果已确认后调用的同步作用。'
            }
          },
          returns: {
            en: 'Cancellation function for this original terminal registration.',
            zh: '返回本次原终点登记的取消函数。'
          }
        }
      }
    }
  },
  enums: {
    LogRecordState: {
      summary: {
        en: 'A committed pending intent may advance once to done or aborted; terminal rows never reopen.',
        zh: '已提交待处理意图只能一次推进为完成或中止，终态记录不能重新打开。'
      },
      values: {
        pending: {
          en: 'Committed intent remains active and may still complete or abort.',
          zh: '已提交意图仍待处理，可以继续完成或中止。'
        },
        done: {
          en: 'Intent completed successfully; its terminal state cannot reopen.',
          zh: '意图已经成功完成，进入终态后不能重新打开。'
        },
        aborted: {
          en: 'Intent was explicitly aborted; its terminal state cannot reopen.',
          zh: '意图已经显式中止，进入终态后不能重新打开。'
        }
      }
    },
    LogStage: {
      summary: {
        en: 'Fixed metadata-only durable lifecycle and operation stages; observations never intervene.',
        zh: '固定的持久生命周期与操作阶段，只观察元数据，不介入原工作。'
      },
      values: {
        beforeLogOpen: {
          en: 'Before the original durable resource opens; observers cannot change admission.',
          zh: '原持久资源打开之前的观察，不能改变准入决定。'
        },
        afterLogOpen: {
          en: 'After the original durable resource opens and recovers successfully.',
          zh: '原持久资源成功打开并完成恢复之后的观察。'
        },
        onLogOpenError: {
          en: 'Original open or recovery failed; an observer failure only reports separately.',
          zh: '原打开或恢复失败时的观察；观察者失败另外报告。'
        },
        beforeLogOperation: {
          en: 'Before one admitted original log operation, without its business payload.',
          zh: '原日志操作准入之后、执行之前的观察，不携带业务载荷。'
        },
        afterLogOperation: {
          en: 'After the original log operation succeeds, with its actual result metadata.',
          zh: '原日志操作成功完成之后的观察，携带实际结果元数据。'
        },
        onLogOperationError: {
          en: 'The original log operation failed; observation cannot replace the original failure.',
          zh: '原日志操作失败时的观察，不替换原操作错误。'
        },
        beforeLogClose: {
          en: 'Before draining and releasing the original durable resource.',
          zh: '排空并释放原持久资源之前的生命周期观察。'
        },
        afterLogClose: {
          en: 'After the original durable resource has finished its successful cleanup.',
          zh: '原持久资源已经成功完成清理之后的观察。'
        },
        onLogCloseError: {
          en: 'Original resource cleanup failed; symbolic disposal reports without rejecting.',
          zh: '原资源清理失败时的观察，符号释放只报告而不拒绝。'
        },
        onAppend: {
          en: 'One original nonempty commit publishes append metadata after persistence.',
          zh: '一次原非空提交持久化完成后发布追加元数据。'
        },
        onWalPending: {
          en: 'The original WAL pending read reports its actual active intent count.',
          zh: '原 WAL 待处理读取报告真实活跃意图条数。'
        }
      }
    }
  },
  enhancers: {
    binlogPlugin: {
      kind: 'plugin',
      target: 'ILogHost',
      summary: {
        en: 'Install the borrowed binlog capability and retain original append/commit/read failures. Durable operations reject independently of nonthrowing log dispatch.',
        zh: '安装借用的 binlog 能力并保留原追加、提交和读取失败；持久操作仍可拒绝，不受日志调用非抛出保证覆盖。'
      },
      install:
        "import { createLogHost } from '@migaia/log-host'\nimport { binlogPlugin, memoryLogStore } from '@migaia/log-plugin-durable'\n\nconst store = memoryLogStore()\nconst log = createLogHost({ plugins: [binlogPlugin({ store })] })\nawait log.binlog.append('order.created', { id: 'o1' })\nconsole.log(await log.binlog.read(1))\nawait log.shutdown('manual')",
      grants: [],
      scenarios: [
        {
          en: 'Install the borrowed binlog capability and retain original append/commit/read failures. Durable operations reject independently of nonthrowing log dispatch.',
          zh: '安装借用的 binlog 能力并保留原追加、提交和读取失败；持久操作仍可拒绝，不受日志调用非抛出保证覆盖。'
        }
      ],
      example:
        "import { createLogHost } from '@migaia/log-host'\nimport { binlogPlugin, memoryLogStore } from '@migaia/log-plugin-durable'\n\nconst store = memoryLogStore()\nconst log = createLogHost({ plugins: [binlogPlugin({ store })] })\nawait log.binlog.append('order.created', { id: 'o1' })\nconsole.log(await log.binlog.read(1))\nawait log.shutdown('manual')"
    },
    walPlugin: {
      kind: 'plugin',
      target: 'ILogHost',
      summary: {
        en: 'Install the borrowed wal capability and retain original append/commit/read failures. Durable operations reject independently of nonthrowing log dispatch.',
        zh: '安装借用的 wal 能力并保留原追加、提交和读取失败；持久操作仍可拒绝，不受日志调用非抛出保证覆盖。'
      },
      install:
        "import { createLogHost } from '@migaia/log-host'\nimport { binlogPlugin, memoryLogStore } from '@migaia/log-plugin-durable'\n\nconst store = memoryLogStore()\nconst log = createLogHost({ plugins: [binlogPlugin({ store })] })\nawait log.binlog.append('order.created', { id: 'o1' })\nconsole.log(await log.binlog.read(1))\nawait log.shutdown('manual')",
      grants: [],
      scenarios: [
        {
          en: 'Install the borrowed wal capability and retain original append/commit/read failures. Durable operations reject independently of nonthrowing log dispatch.',
          zh: '安装借用的 wal 能力并保留原追加、提交和读取失败；持久操作仍可拒绝，不受日志调用非抛出保证覆盖。'
        }
      ],
      example:
        "import { createLogHost } from '@migaia/log-host'\nimport { binlogPlugin, memoryLogStore } from '@migaia/log-plugin-durable'\n\nconst store = memoryLogStore()\nconst log = createLogHost({ plugins: [binlogPlugin({ store })] })\nawait log.binlog.append('order.created', { id: 'o1' })\nconsole.log(await log.binlog.read(1))\nawait log.shutdown('manual')"
    },
    undoLogPlugin: {
      kind: 'plugin',
      target: 'ILogHost',
      summary: {
        en: 'Install the borrowed undo capability and retain original append/commit/read failures. Durable operations reject independently of nonthrowing log dispatch.',
        zh: '安装借用的 undo 能力并保留原追加、提交和读取失败；持久操作仍可拒绝，不受日志调用非抛出保证覆盖。'
      },
      install:
        "import { createLogHost } from '@migaia/log-host'\nimport { binlogPlugin, memoryLogStore } from '@migaia/log-plugin-durable'\n\nconst store = memoryLogStore()\nconst log = createLogHost({ plugins: [binlogPlugin({ store })] })\nawait log.binlog.append('order.created', { id: 'o1' })\nconsole.log(await log.binlog.read(1))\nawait log.shutdown('manual')",
      grants: [],
      scenarios: [
        {
          en: 'Install the borrowed undo capability and retain original append/commit/read failures. Durable operations reject independently of nonthrowing log dispatch.',
          zh: '安装借用的 undo 能力并保留原追加、提交和读取失败；持久操作仍可拒绝，不受日志调用非抛出保证覆盖。'
        }
      ],
      example:
        "import { createLogHost } from '@migaia/log-host'\nimport { binlogPlugin, memoryLogStore } from '@migaia/log-plugin-durable'\n\nconst store = memoryLogStore()\nconst log = createLogHost({ plugins: [binlogPlugin({ store })] })\nawait log.binlog.append('order.created', { id: 'o1' })\nconsole.log(await log.binlog.read(1))\nawait log.shutdown('manual')"
    }
  }
}
