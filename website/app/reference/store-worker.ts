/**
 * Current source, README and USEGUIDE reference (2026-10-18). Unlike the old zero-copy/performance
 * prose, the current worker-contract bridge recursively converts bytes to base64url portable values
 * before its single createRpcHost + dedicatedWorkerPlugin bridge. Worker calls copy inputs without
 * detaching their buffers; this is not a zero-copy guarantee. Handler timeoutMs is not a compute
 * execution deadline. Managed pendingCount counts message deliveries, not RPC computations.
 * Serializer encode streams frames instead of merging chunks locally.
 */
import type { ILibraryReference, IMemberDoc, IText } from './contract.js'
import { resourceReference } from './resource.js'
import {
  storeWorkerCases,
  storeWorkerOptionCases,
  storeWorkerOptionExamples
} from './store-worker-cases.js'

/** Localized source-backed behavior. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** Complete native Worker computation used by root and port reference pages. */
const computeExample = storeWorkerCases.WorkerAdapter![0]!.example
/** Actual Worker-side JSON parser paired with a main-side registry plugin. */
const codecExample = storeWorkerCases.workerPlugin![0]!.example
/** Client identity and deadline are external RPC inputs, not generated instance IDs. */
const clientOptions: Readonly<Record<string, IMemberDoc>> = {
  clientId: {
    summary: t(
      'String assigned by the caller for this RPC endpoint identity; the worker-side helper targets main, so the usual supported pair uses that default. Distinct topology requires a matching peer configuration.',
      '由调用者指定的本端请求拓扑身份，工作端辅助默认指向主端身份，因此常规配对使用默认值，其他拓扑需要匹配对端配置。'
    ),
    default: t(
      'main, a fixed identity rather than a generated unique ID.',
      '默认固定主端身份 `main`，不是自动生成的唯一标识符。'
    )
  },
  timeoutMs: {
    summary: t(
      'Optional per-request millisecond timeout forwarded to the canonical RPC send operation by WorkerAdapter; RPC owns validation, cancellation and timeout errors.',
      '可选的每请求毫秒超时，由适配器透传至标准请求发送操作，校验、取消与超时错误由请求包负责。'
    ),
    default: t(
      'undefined: no default request deadline is supplied.',
      '`undefined`：不提供请求默认截止期限。'
    )
  }
}
/** Application messages are delivered through the existing event-listener port protocol. */
const portMembers: Readonly<Record<string, IMemberDoc>> = {
  postMessage: {
    summary: t(
      'Synchronous host callback sending a raw RPC envelope; do not reinterpret it as an application payload. Transfer is the optional native list and return value is unused; host errors propagate into transport handling.',
      '宿主同步发送原始请求外层的回调，不应当作应用载荷重新解释，第二参数是可选原生转移列表，不使用返回值，宿主抛错进入传输错误处理。'
    ),
    params: {
      value: t(
        'Original frame value supplied by the canonical worker transport; forward it unchanged to native postMessage rather than wrapping it as another application request.',
        '标准工作线程传输提供的原始帧值，应原样交给原生 `postMessage`，不要再封装成另一层应用请求。'
      ),
      transfer: t(
        'Optional native transfer list received from send options; omit for ordinary cloning.',
        '来自发送选项的可选原生转移列表，默认 `undefined`，不提供转移列表时走普通复制。'
      )
    },
    returns: t(
      'Void after the host accepted the send; it does not mean peer computation completed.',
      '宿主接受发送后无返回值，不表示对端计算完成。'
    ),
    example: `const port = new Worker(new URL('./compute.worker.ts', import.meta.url), { type: 'module' })
const adapter = new WorkerAdapter(port)
await adapter.dispose()
port.terminate()`
  },
  start: {
    summary: t(
      'Optional synchronous native MessagePort start operation borrowed from the supplied port. The canonical worker transport invokes it before installing its message listener; Worker-like ports without this method need no substitute.',
      '从传入端口借用的可选同步原生 `MessagePort.start` 操作。标准工作线程传输在安装消息监听前调用它；没有该方法的线程类端口不需要补充替代实现。'
    ),
    default: t(
      'Omitted for ports that do not require explicit message delivery startup.',
      '无需显式启动消息投递的端口可省略此方法。'
    ),
    returns: t(
      'Void after native startup; this operation does not acquire ownership of the port or terminate it during cleanup.',
      '原生启动后无返回值；此操作不取得端口所有权，也不在清理时终止端口。'
    ),
    example: `const channel = new MessageChannel()
channel.port1.start()
channel.port1.close()
channel.port2.close()`
  },
  addEventListener: {
    summary: t(
      'Host installs a listener for message, error or messageerror; RPC owns subscriptions and dispatch. Do not steal a mutable onmessage slot for the main-side adapter.',
      '宿主安装消息、脚本错误或消息反序列化错误监听，订阅分发由请求层拥有，主端适配器不应抢占可变消息槽。'
    ),
    params: {
      type: t(
        'Event name supplied by the RPC adapter: message, error or messageerror.',
        '请求适配器提供的事件名：`message` 为消息，`error` 为脚本错误，`messageerror` 为反序列化错误。'
      ),
      listener: t(
        'Synchronous callback receiving an event-like object with data, origin, source and type as applicable; return void, and transport isolates listener failures.',
        '同步接收按事件提供数据、来源及类型的类事件对象，返回空值，传输层隔离监听失败。'
      )
    },
    returns: t('Void after listener registration.', '完成宿主监听注册后无返回值。'),
    example: computeExample
  },
  removeEventListener: {
    summary: t(
      'Host removes the exact type/listener pair installed by the transport during endpoint cleanup.',
      '端点清理时宿主移除传输层先前安装的精确事件名与监听函数对。'
    ),
    params: {
      type: t(
        'Previously registered event name from the transport.',
        '来自传输层先前注册的事件名。'
      ),
      listener: t(
        'Exact callback identity received during registration.',
        '注册时收到的精确回调身份。'
      )
    },
    returns: t(
      'Void after listener removal; native cleanup failures reject endpoint disposal.',
      '移除监听后无返回值，原生清理失败使端点销毁拒绝。'
    ),
    example: computeExample
  }
}
/** Resource options remain canonical, with Worker-specific ownership stated locally. */
const computedOptions: Readonly<Record<string, IMemberDoc>> = {
  ...resourceReference.types!.IResourceOptions.members!,
  retry: {
    summary: t(
      'Resource retry policy: a non-negative integer extra-attempt count, or synchronous (failureCount,error) => boolean. failureCount starts at one and error is the original fetch failure. Return true to retry; callback throws or non-boolean/thenable results become Resource failure, without awaiting a Promise.',
      '非负整数表示额外重试次数，也可提供同步回调 `retry(failureCount, error)`；失败次数从 `1` 开始，错误为原始取值失败。返回 `true` 才重试，抛错、非布尔值或类 Promise 对象会使资源失败，不等待异步结果。'
    ),
    default: t('Zero extra attempts; no automatic retry.', '默认零次额外尝试，不自动重试。')
  },
  retryDelay: {
    whenToUse: t(
      'Use a fixed millisecond delay for short failures, or a synchronous callback for increasing waits. failureCount starts at one. Omission retries immediately; retry must also allow another attempt.',
      '短暂故障可用固定毫秒数；逐次延长等待时用同步回调。failureCount 从一开始。省略时立即重试；retry 还必须允许下一次尝试。'
    ),
    example: storeWorkerOptionExamples.retry,
    summary: t(
      'Finite non-negative milliseconds, or synchronous (failureCount,error) => milliseconds for each accepted retry. Receives the one-based count and original failure; callback throws or invalid/non-number/thenable results become Resource failure. A delayed retry remains cancellable through Resource.',
      '每次获准重试前等待的有限非负毫秒数，也可用同步回调 `retryDelay(failureCount, error)` 返回毫秒数；次数从 `1` 开始，错误为原始失败。抛错、无效数字或类 Promise 对象会使资源失败，延迟期间仍可取消。'
    ),
    default: t(
      'Zero milliseconds; retries without a configured delay.',
      '默认零毫秒，不配置额外重试等待。'
    )
  },
  runtime: {
    summary: t(
      'IRuntime returned by reactive createRuntime; selectInput reads belong to this Resource Runtime. Other-Runtime reads are governed by reactive ownership checks.',
      '由响应包工厂返回的运行时，输入选择器读取属于此资源运行时，跨运行时读取遵循响应包归属检查。'
    ),
    default: t(
      'Reactive defaultRuntime; pass a request/instance Runtime for isolation.',
      '默认响应包共享运行时，隔离请求或实例应显式传入独立运行时。'
    )
  },
  scheduler: {
    summary: t(
      'IScheduler from @migaia/utils/scheduler controls Resource TTL and retry clocks; forwarded unchanged to Resource.',
      '工具包调度器控制资源存活及重试时钟，原样转交资源。'
    ),
    default: t(
      'systemScheduler from @migaia/utils/scheduler.',
      '默认工具包系统调度器提供时钟与计时器。'
    )
  }
}
/** Serializer options select format and physical Worker cleanup, while inputs always copy. */
const pluginOptions: Readonly<Record<string, IMemberDoc>> = {
  worker: {
    summary: t(
      'Required IWorkerLike, normally an application-created dedicated Worker with message/error/messageerror listener methods and optional terminate. It stays caller-owned unless termination is explicitly enabled.',
      '必需的工作线程协议对象，通常是应用创建的专用工作线程，提供消息及两类错误监听和可选终止方法，除显式启用终止外由调用者拥有。'
    )
  },
  type: {
    summary: t(
      'Caller-selected registry format label, which must match the worker parser semantics; used as parser.name and plugin.type, not format negotiation.',
      '调用者选择且须匹配工作端解析语义的注册表格式标签，用作解析器名称及插件格式，不进行格式协商。'
    ),
    default: t(
      'worker, the default diagnostic and registry format label.',
      '默认 `worker`，作为诊断及注册表格式标签。'
    )
  },
  terminateOnDispose: {
    summary: t(
      'Whether parser disposal calls worker.terminate after endpoint cleanup, even if that cleanup fails. The optional terminate callback is synchronous and takes no arguments.',
      '解析器销毁是否在端点清理后调用工作线程终止，即使端点清理失败也尝试，终止回调同步且无参数。'
    ),
    default: t('False: cleanup retires only the borrowed endpoint.', '默认假，清理仅结束借用端点。')
  },
  clientId: clientOptions.clientId
}
/** Both factories return the same callable management contract. */
const managedMembers: Readonly<Record<string, IMemberDoc>> = {
  pendingCount: {
    summary: t(
      'Count of managed message callback invocations awaiting endpoint readiness/delivery and one microtask; this is not provider computation concurrency or unfinished RPC requests.',
      '等待端点就绪、消息投递及一个微任务的受管回调调用数，不等于提供者计算并发或未完成请求数。'
    )
  },
  disposed: {
    summary: t(
      'True after close/dispose starts; later message invocations resolve without delivery.',
      '关闭或销毁启动后为真，此后消息调用直接兑现且不投递。'
    )
  },
  close: {
    summary: t(
      'Idempotently stops new managed message delivery synchronously; does not unregister host onmessage or release endpoint/resources.',
      '同步幂等停止新受管消息投递，不注销宿主消息槽，也不释放端点或资源。'
    ),
    returns: t(
      'Void once unavailable; endpoint cleanup still requires dispose.',
      '标记不可用后无返回值，端点清理仍须异步销毁。'
    ),
    example: `handler.close()
console.log(handler.disposed)
await handler.dispose()`
  },
  dispose: {
    summary: t(
      'Closes, awaits readiness, then unsubscribes provider routes and disposes the endpoint. Repeated/concurrent calls share one Promise. It does not terminate the Worker or dispose the supplied parser.',
      '先关闭并等待就绪，再注销服务路由并销毁端点；重复或并发调用复用同一 Promise，不终止工作线程，也不销毁外部解析器。'
    ),
    returns: t(
      'Stable Promise<void>; endpoint initialization and cleanup failures reject.',
      '返回同一个 `Promise<void>`，端点初始化或清理失败会拒绝。'
    ),
    example: `const done = handler.dispose()
console.log(done === handler.dispose())
await done`
  }
}
/** One-byte/native Error construction is separate from RPC error policy. */
const errorDoc = (aggregate = false) => ({
  role: 'error' as const,
  purpose: t(
    'Creates native ' +
      (aggregate ? 'AggregateError' : 'Error') +
      ' with source store.worker and selected code, preserving native type, stack and original failure reachability.',
    '创建原生错误并附加本包来源与所选稳定错误码，保留原生类型、堆栈及原始失败可达性。'
  ),
  params: {
    code: t(
      'Actual failure value from StoreWorkerErrorCode.',
      '运行时错误码表中对应实际失败的值。'
    ),
    ...(aggregate
      ? {
          errors: t(
            'Original failures retained in AggregateError.errors in caller order.',
            '按调用者顺序保留在聚合子项中的原始失败。'
          )
        }
      : {}),
    message: t('Caller-provided readable diagnostic message.', '调用者提供的可读诊断消息。')
  },
  ...(!aggregate
    ? {
        optionCases: [
          {
            title: t('Keep an earlier exception', '保留先前异常'),
            problem: t(
              'Preparing a cart calculation can fail before the worker is ready. The page needs a useful message, while monitoring still needs the original exception to locate the failed preparation step. Preserve it as the cause.',
              '工作线程就绪前，购物车计算的准备步骤可能失败。页面需要可读消息，监控也需要原始异常来定位出错步骤；把它保留为 cause。'
            ),
            example: `import { createStoreWorkerError, StoreWorkerErrorCode } from '@migaia/store-worker'

try {
  await prepareCartWorker()
} catch (cause) {
  showWorkerError(createStoreWorkerError(
    StoreWorkerErrorCode.invalidOption,
    'Unable to prepare cart calculation',
    { cause }
  ))
}`,
            result: t(
              'The cart shows a preparation failure while its original exception remains available through cause.',
              '购物车显示计算准备失败，仍可通过 cause 查看原始异常。'
            ),
            covers: ['cause']
          },
          {
            title: t('Keep structured input details', '保留结构化输入详情'),
            problem: t(
              'A cart validator returns the rejected field and value as a record. The error view needs that record to highlight the input. Keep it as the cause rather than converting it into a message.',
              '购物车校验器用记录返回被拒绝的字段与值。错误界面需要这份记录来标出输入框；把它保留为 cause，而不是压成消息。'
            ),
            example: `import { createStoreWorkerError, StoreWorkerErrorCode } from '@migaia/store-worker'

showWorkerError(createStoreWorkerError(
  StoreWorkerErrorCode.invalidOption,
  'Cart input is invalid',
  { cause: validationFailure }
))`,
            result: t(
              'The error view can identify the rejected cart field from the original validation details.',
              '错误界面可以从原始校验详情中识别被拒绝的购物车字段。'
            ),
            covers: ['cause']
          }
        ],
        optionDocs: {
          cause: {
            summary: t(
              'Non-undefined original failure attached unchanged as cause.',
              '非未定义原始失败原样附加为原因。'
            ),
            default: t('Omitted: no cause attached.', '默认省略，不附加原因字段。')
          }
        }
      }
    : {}),
  returns: t(
    'Tagged error object returned without throwing it; inspect source and code together.',
    '返回带身份错误对象，辅助函数自身不抛出该值，应联合来源与错误码检查。'
  ),
  example: `import { createStoreWorker${aggregate ? 'AggregateError' : 'Error'}, StoreWorkerErrorCode } from '@migaia/store-worker'
const error = createStoreWorker${aggregate ? 'AggregateError' : 'Error'}(StoreWorkerErrorCode.${aggregate ? 'cleanupFailed' : 'invalidOption'}, ${aggregate ? '[new Error("release failed")], ' : ''}'Worker operation failed')
console.log(error)`
})
/** Six public semantic errors; stream failures use the canonical RPC error chain. */
const errors = {
  invalidOption: t(
    'Malformed options, callbacks, worker shape or serializer phase; correct caller input.',
    '选项、回调、工作线程形状或序列化阶段无效，应修正调用者输入。'
  ),
  adapterDisposed: t(
    'WorkerAdapter request after close/dispose; create another adapter.',
    '工作适配器关闭或销毁后继续请求，应创建新适配器。'
  ),
  requestAborted: t(
    'Worker serialization was cancelled through its context signal or an explicit stream stop; copied input remains readable.',
    'Worker 序列化由上下文 signal 或显式流停止取消，调用方输入保持可读取。'
  ),
  invalidRequestChunk: t(
    'Worker handler received a malformed serialization chunk.',
    '工作端处理器收到形状不符合契约的序列化数据块。'
  ),
  invalidResponseChunk: t(
    'Main-side serializer received invalid response chunk or frame sequence.',
    '主端解析器收到无效响应块或不符合顺序的流帧。'
  ),
  cleanupFailed: t(
    'Both endpoint cleanup and requested Worker termination failed; ordered CLEANUP_FAILED AggregateError retains both. A single cleanup failure keeps its existing identity and does not receive this aggregate code.',
    '端点清理与请求终止工作线程同时失败，有序 `CLEANUP_FAILED` 聚合错误保留二者；单项清理失败保持原有身份，不附此聚合码。'
  )
}

export const storeWorkerReference: ILibraryReference = {
  modules: {
    index: {
      summary: t(
        'Worker-backed application computation and Resource integration. RPC owns transport/protocol lifecycle, Resource owns dependency/caching/retry, and the caller owns Worker termination. Serializer factories are available only from @migaia/store-worker/serialize/worker; root aliases and low-level helper paths are removed.',
        '工作线程应用计算与资源集成，请求包拥有传输协议生命周期，资源包拥有依赖缓存重试，线程终止归调用者；序列化工厂仅从具体序列化工作子路径导入，根别名及底层辅助路径已收回。'
      ),
      example: computeExample
    },
    'serialize/worker': {
      summary: t(
        'Move encoding and decoding into a worker so the caller can use a serializer without running its work locally. Import this subpath for serializer integration; the package root provides general worker computation APIs.\n\nStart with `workerPlugin()` to register the worker-backed parser in a serialization registry, and `createSerializeWorkerHandler()` to connect an ordinary parser on the worker side. Encoding streams chunks with a limit on unconsumed chunks, while decoding returns one result; all Worker calls copy inputs without detaching caller buffers.',
        '把编码和解码放到工作线程中执行，让调用方通过序列化接口使用它。此子路径负责序列化集成；根入口提供通用的工作线程计算接口。\n\n从 `workerPlugin()` 把工作线程解析器装入序列化注册表，再用 `createSerializeWorkerHandler()` 在工作线程端接入普通解析器。编码分块传回结果，并限制尚未消费的分块数量，解码返回一个结果；所有 Worker 调用复制参数，不 detach 输入。'
      ),
      example: codecExample
    }
  },
  symbols: {
    WorkerAdapter: {
      role: 'factory',
      purpose: t(
        'Creates a main-side client that asynchronously initializes a canonical worker endpoint; requests await readiness automatically. Pair it with createWorkerHandler on the worker. It borrows the supplied Worker and never terminates it.',
        '创建异步初始化标准工作端点的主端客户端，请求自动等待就绪，应与工作端 `createWorkerHandler` 搭配，借用外部线程且从不终止它。'
      ),
      params: {
        port: t(
          'IWorkerPort, normally a Worker created by the application; preserve its event-listener methods.',
          '工作端口协议对象，通常为应用创建的工作线程，应保留其事件监听方法。'
        )
      },
      optionDocs: clientOptions,
      optionCases: storeWorkerOptionCases.client,
      returns: t(
        'New WorkerAdapter with asynchronous endpoint initialization already started; request awaits it and dispose shares one cleanup Promise. Invalid option-object access throws INVALID_OPTION synchronously, while endpoint initialization failure is observed through request/dispose.',
        '返回已启动异步端点初始化的适配器，请求自动等待初始化，重复销毁复用清理 Promise；无效选项或读取失败同步抛 `INVALID_OPTION`，端点初始化失败经请求或销毁观察。'
      ),
      exampleIntro: {
        en: "Save the whole example as a .ts file and run it with Node 24. new Worker(new URL(import.meta.url), { workerData: port2, transferList: [port2] }) runs that file again in a native thread and transfers the actual MessagePort. isMainThread selects its role; workerData is the child input. Start port1 before using its EventTarget listeners, then close it and await worker.terminate after endpoint cleanup. This proves the Node path, not browser Worker behavior.\n\nThe Node Worker itself has on/off rather than Web addEventListener; its transferred MessagePort implements IWorkerPort directly. Constructor options default to {}, clientId to 'main' and timeoutMs to undefined, so this installed timeout middleware supplies no deadline. request options default to {}, with signal undefined. Inputs are copied without detaching caller buffers. Generics provide typing only. Use finite primitives, arrays and plain records; undefined, ArrayBuffer and Uint8Array have bridge representations, $worker is reserved, and all Worker calls copy inputs without detaching their buffers.",
        zh: "把完整示例保存为 `.ts` 文件并用 Node 24 运行；`new Worker(new URL(import.meta.url), { workerData: port2, transferList: [port2] })` 在原生线程重新执行该文件，并转交真实 `MessagePort`。`isMainThread` 区分分支，`workerData` 是子线程输入；使用事件监听前启动 `port1`，端点清理后关闭端口并等待终止 Worker。这里验证 Node 路径，不代替浏览器 Worker 验证。\n\nNode Worker 自身使用 `on/off`，转交的 `MessagePort` 直接满足 `IWorkerPort`。构造选项默认 `{}`，`clientId` 默认 `'main'`，`timeoutMs` 默认 `undefined`，已安装的超时中间件不设置默认期限；请求选项也默认 `{}`，`signal` 默认 `undefined`，输入按复制发送且不会 detach。泛型只提供类型标注；载荷使用有限原始值、数组和普通记录，`undefined`、`ArrayBuffer`、`Uint8Array` 有桥接表示，`$worker` 为保留键，所有 Worker 调用复制参数，不 detach 输入。"
      },
      cases: storeWorkerCases.WorkerAdapter,
      example: computeExample
    },
    createWorkerHandler: {
      role: 'factory',
      purpose: t(
        'Registers one worker-side computation with the canonical RPC provider. Pair it with WorkerAdapter; connect returned callback to host message delivery explicitly.',
        '向标准请求提供者注册工作端计算，应与 `WorkerAdapter` 搭配，须显式把返回回调接入宿主消息投递。'
      ),
      params: {
        compute: t(
          'Synchronous or async callback (payload: Input, {signal: INativeAbortSignal}) returning Output or Promise<Output>. Reads/throws/rejections follow RPC provider handling; check signal cooperatively for long work.',
          '接收输入与含原生中止信号的上下文，可同步返回结果或异步返回 Promise；抛错与拒绝由 RPC 服务端处理，长时间计算需主动检查信号。'
        ),
        postMessage: t(
          'Synchronous callback receiving raw reply/control envelopes, normally message => workerGlobal.postMessage(message); return void, host send errors follow transport failure handling.',
          '同步接收原始回复或控制外层，通常转交工作全局对象发送，返回空值，宿主发送抛错遵循传输错误处理。'
        )
      },
      optionDocs: {
        timeoutMs: {
          example: storeWorkerOptionExamples.handler,
          summary: t(
            'Forwarded endpoint option; this provider helper does not apply it as a compute execution deadline. Set request deadline on the main-side adapter.',
            '透传端点选项，此提供者辅助不把它应用为计算执行截止期限，请在主端适配器设置请求期限。'
          ),
          default: t(
            'undefined: no endpoint request deadline is supplied.',
            '`undefined`：不设置端点向外请求的默认期限。'
          )
        }
      },
      returns: t(
        'Callable IManagedRpcHandler: await handler(rawMessage) for delivery, then close/dispose for endpoint cleanup. Compute failures are replies, while initialization/delivery failures can reject the callback.',
        '返回可调用受管句柄，传入原始消息并等待投递，以关闭及异步销毁完成端点清理，计算失败转回复，初始化或投递失败可使回调拒绝。'
      ),
      exampleIntro: {
        en: "Save the whole example as a .ts file and run it with Node 24. new Worker(new URL(import.meta.url), { workerData: port2, transferList: [port2] }) runs that file again in a native thread and transfers the actual MessagePort. isMainThread selects its role; workerData is the child input. Start port1 before using its EventTarget listeners, then close it and await worker.terminate after endpoint cleanup. This proves the Node path, not browser Worker behavior.\n\ncompute receives the decoded payload and a native AbortSignal, and may return a result or Promise; cancellation is cooperative. The required postMessage callback forwards raw replies to the real port. The options object defaults to {}; timeoutMs defaults to undefined and only concerns outgoing endpoint requests, not a compute deadline. clientId is not part of this handler's public options. Computation errors return through RPC; attach and observe the managed message callback separately.",
        zh: '把完整示例保存为 `.ts` 文件并用 Node 24 运行；`new Worker(new URL(import.meta.url), { workerData: port2, transferList: [port2] })` 在原生线程重新执行该文件，并转交真实 `MessagePort`。`isMainThread` 区分分支，`workerData` 是子线程输入；使用事件监听前启动 `port1`，端点清理后关闭端口并等待终止 Worker。这里验证 Node 路径，不代替浏览器 Worker 验证。\n\n`compute` 接收解码后的载荷与原生 `AbortSignal`，可返回结果或 Promise，取消需要计算主动配合；必填的发送回调把原始回复转给真实端口。选项对象默认 `{}`，`timeoutMs` 默认 `undefined`，只涉及端点向外发出的请求，不是计算截止期限；此处理器的公开选项不含 `clientId`。计算失败经 RPC 返回，受管消息回调仍需单独接线并观察其失败。'
      },
      cases: storeWorkerCases.createWorkerHandler,
      example: storeWorkerCases.createWorkerHandler![0]!.example
    },
    workerComputed: {
      role: 'factory',
      purpose: t(
        'Constructs a standard Resource whose fetcher selects input synchronously and sends through the adapter. Input reads before returning establish reactive dependencies. It never disposes the adapter or Worker.',
        '构造标准资源，其取值器同步选择输入再经适配器发送，返回前输入读取建立响应依赖，不销毁适配器或工作线程。'
      ),
      params: {
        adapter: t(
          'WorkerAdapter instance returned by its constructor; the caller retains disposal ownership.',
          '构造函数返回的真实适配器实例，调用者保留销毁所有权。'
        ),
        selectInput: t(
          'Synchronous no-argument callback returning Input for each Resource fetch attempt; may run again on dependency change, refetch or retry. Throws become Resource failure; do not return a Promise.',
          '每次资源取值时无参数同步返回输入；依赖变化、刷新或重试都可再次执行，抛错会使资源失败，不应返回 Promise。'
        )
      },
      options: 'IWorkerComputedOptions',
      optionDocs: computedOptions,
      returns: t(
        'Resource<Output> from @migaia/resource, including state, refetch(), promise, cancel(), dehydrate/hydrate and dispose(). Canonical resource documentation defines generation cancellation and retry. Dispose it separately, then await adapter.dispose and terminate caller Worker.',
        '返回标准 `Resource`，提供状态、刷新、Promise、取消、缓存导出恢复及销毁；请求代次与重试遵循资源包契约。先释放资源，再等待适配器清理，最后终止调用方创建的线程。'
      ),
      exampleIntro: {
        en: 'Save the whole example as a .ts file and run it with Node 24. new Worker(new URL(import.meta.url), { workerData: port2, transferList: [port2] }) runs that file again in a native thread and transfers the actual MessagePort. isMainThread selects its role; workerData is the child input. Start port1 before using its EventTarget listeners, then close it and await worker.terminate after endpoint cleanup. This proves the Node path, not browser Worker behavior.\n\nDirectly install @migaia/reactive for createRuntime(); omitted Runtime options use the host adapter and microtask scheduler. runtime.signal uses the shown initial array and default Object.is equality. Pass that same Runtime to workerComputed; otherwise it defaults to defaultRuntime. This example changes autoStart from true to false, but the first state read still starts lazy work. ttl defaults to Infinity; explicit refetch forces a request and fresh passive promise reads reuse cache. Full Resource options below retain their own defaults. Resource disposal does not dispose the adapter.',
        zh: '把完整示例保存为 `.ts` 文件并用 Node 24 运行；`new Worker(new URL(import.meta.url), { workerData: port2, transferList: [port2] })` 在原生线程重新执行该文件，并转交真实 `MessagePort`。`isMainThread` 区分分支，`workerData` 是子线程输入；使用事件监听前启动 `port1`，端点清理后关闭端口并等待终止 Worker。这里验证 Node 路径，不代替浏览器 Worker 验证。\n\n直接安装 `@migaia/reactive` 来调用 `createRuntime()`，省略选项时使用宿主适配器及微任务调度；`runtime.signal` 接收本例初始数组，默认按 `Object.is` 判断相等。把同一运行时传给 `workerComputed`，否则使用 `defaultRuntime`；本例将 `autoStart` 从默认 `true` 改为 `false`，首次读取 `state` 仍会按需启动。`ttl` 默认 `Infinity`，显式 `refetch` 强制请求，新鲜缓存的被动 `promise` 读取则复用结果；下表完整列出资源选项。所有输入按复制发送；释放资源不释放适配器。'
      },
      cases: storeWorkerCases.workerComputed,
      example: storeWorkerCases.workerComputed![0]!.example
    },
    createSerializeWorkerHandler: {
      role: 'factory',
      purpose: t(
        'Installs a supplied parser on the worker and handles decode responses and bounded encode streams. Pair with workerPlugin or workerParser; attach returned handler to host messages. Parser lifetime remains caller-owned.',
        '在工作端安装外部解析器并处理解码响应及受限编码流，应搭配 `workerPlugin` 或 `workerParser`，返回处理器须接宿主消息，解析器生命周期仍归调用者。'
      ),
      params: {
        parser: t(
          'ISerializeParser from @migaia/serialize/plugins or a compatible implementation. encode(value,{signal,context}) may return chunk, iterable or async iterable; decode(chunk,context) returns a value or Promise. Worker sets context to serialize-worker; parser failures use only canonical RPC rejection, retaining name, message, stack, source, code, cause and aggregate errors. Already-delivered chunks remain available before the stream reports failure.',
          '真实序列化插件或兼容解析器：`encode(value, context)` 可返回单块或同步、异步块流，`decode(chunk, context)` 返回值或 Promise；工作端诊断标签固定为 `serialize-worker`。解析失败经 RPC 拒绝传递，保留原错误链；流失败前已投递的块仍可读取。'
        ),
        post: t(
          'Synchronous host callback receiving raw message and optional readonly transfer list; return void, normally forward to worker-global postMessage. Native send failures follow RPC transport policy.',
          '宿主同步回调接收原始消息及可选只读转移列表，返回空值，通常原样转给工作全局发送，原生发送失败遵循请求传输策略。'
        )
      },
      returns: t(
        'IManagedRpcHandler callable with raw host event.data, plus close/dispose/pendingCount/disposed. Invalid or inaccessible factory parser members are INVALID_OPTION: native failures retain identity/class/stack, complete foreign identities remain unchanged, and untaggable failures remain on cause. Encode uses two initial credits and acknowledgements. Stream failure is a canonical RPC rejection; an iterator.return failure is attached with the primary first in the reachable error chain. Handler disposal does not call parser.dispose.',
        '返回接收宿主原始消息的可调用句柄及关闭、销毁、待投递数量和状态；工厂解析成员无效或不可访问时使用 `INVALID_OPTION`，原生失败保留身份类型堆栈，完整外包身份不变，无法附码的失败保留在原因链。编码初始两份额度并等待确认；流失败经标准请求拒绝，迭代器归还失败附入可达错误链且主失败在首位，处理器销毁不调用解析器销毁。'
      ),
      example: codecExample
    },
    workerParser: {
      role: 'factory',
      purpose: t(
        'Creates a main-side ISerializeParser over a borrowed Worker endpoint. Inputs follow one copy path without detaching caller buffers. Pair with createSerializeWorkerHandler using a compatible worker parser; the name is a local label, not negotiation.',
        '在借用工作端点上创建主端解析器，输入统一复制且不 detach 调用方 buffer；须搭配使用兼容解析器的 `createSerializeWorkerHandler`，名称是本地标签而非协商。'
      ),
      options: 'IWorkerPluginOptions',
      returns: t(
        'ISerializeParser from serialize: name, encode(value,context) -> AsyncIterable chunks, async decode(chunk,context) -> result payload, and stable dispose(): Promise<void>. No parser timeoutMs option exists; use context.signal for cancellation. Context signal is forwarded to RPC; decode/pre-aborted encode wrap abort diagnostics with original reason cause, streaming errors may retain native RPC/AbortError shape. Dispose fails active queues, closes endpoint, then optionally terminates Worker even after endpoint failure; both failures aggregate CLEANUP_FAILED.',
        '返回序列化包解析协议，含名称、接值及上下文返回异步块流的编码、接块及上下文异步返回载荷的解码，以及稳定异步销毁；解析器没有超时选项，取消使用上下文信号；信号透传请求，解码及预先取消编码包装取消诊断并保留原始原因，流错误可能保留原生请求或中止形状。销毁失败活动队列、关闭端点，再按需终止线程，端点失败仍尝试终止，二者失败聚合。'
      ),
      exampleIntro: {
        en: "Save the whole example as a .ts file and run it with Node 24. new Worker(new URL(import.meta.url), { workerData: port2, transferList: [port2] }) runs that file again in a native thread and transfers the actual MessagePort. isMainThread selects its role; workerData is the child input. Start port1 before using its EventTarget listeners, then close it and await worker.terminate after endpoint cleanup. This proves the Node path, not browser Worker behavior.\n\nDirectly install @migaia/serialize for these examples. jsonParser(options = {}) is the real native JSON parser: replacer, reviver, space and decoder default to undefined; byte decoding then uses host TextDecoder. Text chunks are ['text', string], byte chunks ['bytes', Uint8Array], and value chunks ['value', unknown]. Main-side context requires a cancellation signal and a diagnostic context string; no parser timeoutMs option exists.\n\nThe worker option is required. Here type defaults to 'worker', terminateOnDispose to false, and clientId to 'main'. TextEncoder creates the eleven JSON bytes; TextDecoder verifies they remain readable. The pre-aborted decode uses a real AbortController and keeps its original reason on cause; it demonstrates cancellation before sending, not preemption. The borrowed MessagePort has no terminate method, so the caller explicitly closes it and terminates the separately owned Worker.",
        zh: "把完整示例保存为 `.ts` 文件并用 Node 24 运行；`new Worker(new URL(import.meta.url), { workerData: port2, transferList: [port2] })` 在原生线程重新执行该文件，并转交真实 `MessagePort`。`isMainThread` 区分分支，`workerData` 是子线程输入；使用事件监听前启动 `port1`，端点清理后关闭端口并等待终止 Worker。这里验证 Node 路径，不代替浏览器 Worker 验证。\n\n示例需直接安装 `@migaia/serialize`；`jsonParser(options = {})` 使用真实原生 JSON 编解码，`replacer`、`reviver`、`space`、`decoder` 均默认 `undefined`，字节解码未指定解码器时使用宿主 `TextDecoder`。文本块为 `['text', string]`，字节块为 `['bytes', Uint8Array]`，值块为 `['value', unknown]`；主端上下文必填取消信号与诊断标签，不提供解析器 `timeoutMs` 选项。\n\n`worker` 必填；本例 `type` 默认 `'worker'`，`terminateOnDispose` 默认 `false`，`clientId` 默认 `'main'`。`TextEncoder` 生成十一字节 JSON，`TextDecoder` 核对原输入仍可读取；真实 `AbortController` 在发送前取消解码，`cause` 保留其原始原因，不表示抢占计算。借用的消息端口没有终止方法，调用方显式关闭端口并终止单独持有的 Worker。"
      },
      cases: storeWorkerCases.workerParser,
      example: storeWorkerCases.workerParser![0]!.example
    },
    workerPlugin: {
      role: 'factory',
      purpose: t(
        'Wraps workerParser as {type: parser.name, parser} for createSerializeRegistry. Pair with createSerializeWorkerHandler on the worker; registry disposal owns parser cleanup.',
        '把工作解析器包装为注册表的格式与解析器对象，须搭配工作端 `createSerializeWorkerHandler`，注册表销毁负责解析器清理。'
      ),
      options: 'IWorkerPluginOptions',
      returns: t(
        'ISerializePlugin from serialize with local format label and parser; no extra format detection, negotiation or Worker ownership is added.',
        '返回序列化包插件协议，包含本地格式标签及解析器，不额外检测格式、协商或取得线程所有权。'
      ),
      exampleIntro: {
        en: "Save the whole example as a .ts file and run it with Node 24. new Worker(new URL(import.meta.url), { workerData: port2, transferList: [port2] }) runs that file again in a native thread and transfers the actual MessagePort. isMainThread selects its role; workerData is the child input. Start port1 before using its EventTarget listeners, then close it and await worker.terminate after endpoint cleanup. This proves the Node path, not browser Worker behavior.\n\nDirectly install @migaia/serialize for these examples. jsonParser(options = {}) is the real native JSON parser: replacer, reviver, space and decoder default to undefined; byte decoding then uses host TextDecoder. Text chunks are ['text', string], byte chunks ['bytes', Uint8Array], and value chunks ['value', unknown]. Main-side context requires a cancellation signal and a diagnostic context string; no parser timeoutMs option exists.\n\ncreateSerializeRegistry requires a non-empty plugin list; the first plugin type is the default for encoding and decoding, and options default to systemScheduler with host TextEncoder/TextDecoder. Per-call context defaults to 'anonymous' and signal to undefined. This example chooses type 'json', overriding workerPlugin's default 'worker'; terminateOnDispose false, and clientId 'main'. The encoded chunk does not embed the plugin type, so retain a type separately when storing multiple formats. Registry disposal awaits parser disposal, not native Worker termination.",
        zh: "把完整示例保存为 `.ts` 文件并用 Node 24 运行；`new Worker(new URL(import.meta.url), { workerData: port2, transferList: [port2] })` 在原生线程重新执行该文件，并转交真实 `MessagePort`。`isMainThread` 区分分支，`workerData` 是子线程输入；使用事件监听前启动 `port1`，端点清理后关闭端口并等待终止 Worker。这里验证 Node 路径，不代替浏览器 Worker 验证。\n\n示例需直接安装 `@migaia/serialize`；`jsonParser(options = {})` 使用真实原生 JSON 编解码，`replacer`、`reviver`、`space`、`decoder` 均默认 `undefined`，字节解码未指定解码器时使用宿主 `TextDecoder`。文本块为 `['text', string]`，字节块为 `['bytes', Uint8Array]`，值块为 `['value', unknown]`；主端上下文必填取消信号与诊断标签，不提供解析器 `timeoutMs` 选项。\n\n`createSerializeRegistry` 必填非空插件列表，首个格式作为编码与解码的默认格式；选项默认使用 `systemScheduler` 和宿主 `TextEncoder`、`TextDecoder`，每次调用的诊断标签默认 `'anonymous'`，信号默认 `undefined`。本例用 `'json'` 覆盖插件默认格式 `'worker'`，其余默认值为 `terminateOnDispose: false`、`clientId: 'main'`；输出块本身不包含格式标签，保存多种格式时需另外保留标签。注册表等待解析器释放，不终止原生 Worker。"
      },
      cases: storeWorkerCases.workerPlugin,
      example: storeWorkerCases.workerPlugin![0]!.example
    },
    createStoreWorkerError: errorDoc(),
    createStoreWorkerAggregateError: errorDoc(true),
    STORE_WORKER_SOURCE: {
      role: 'constant',
      purpose: t(
        'Exact store.worker source identity attached to package errors; inspect together with code.',
        '附加到本包错误的精确来源身份，应联合稳定错误码检查以定位实际失败分支。'
      ),
      example: `import { STORE_WORKER_SOURCE } from '@migaia/store-worker'
console.log(STORE_WORKER_SOURCE)`
    },
    StoreWorkerErrorCode: {
      role: 'constant',
      purpose: t(
        'Stable Worker bridge and serializer failure codes; canonical RPC/Resource failures may retain their own package identity.',
        '稳定工作桥接及序列化失败错误码，标准请求和资源失败仍可保留其所属包身份。'
      ),
      example: `import { StoreWorkerErrorCode } from '@migaia/store-worker'
console.log(StoreWorkerErrorCode.invalidResponseChunk)`
    },
    WorkerDiagnosticType: {
      role: 'constant',
      purpose: t(
        'Default worker parser name, registry format and codec diagnostic type when no explicit type is provided.',
        '未提供显式格式时的默认工作解析器名称、注册表格式及编解码诊断类型标签。'
      ),
      example: `import { WorkerDiagnosticType } from '@migaia/store-worker'
console.log(WorkerDiagnosticType.worker)`
    }
  },
  types: {
    WorkerAdapter: {
      summary: t(
        'Main-side client returned by the constructor; requests await asynchronous endpoint readiness.',
        '构造函数返回的主端客户端，请求自动等待异步端点就绪。'
      ),
      scenarios: [
        t(
          'Offload computation then connect its result to a Resource.',
          '卸载计算并将结果连接到标准资源。'
        )
      ],
      example: computeExample,
      members: {
        disposed: {
          summary: t(
            'True after close/dispose starts, before asynchronous endpoint cleanup completes.',
            '关闭或销毁启动即为真，早于异步端点清理完成。'
          )
        },
        request: {
          summary: t(
            'Waits readiness then sends one canonical call. Generics only type the result; no runtime schema check is added. Payload passes recursive portable conversion, with bytes encoded to base64url and class prototypes not preserved; use supported plain data.',
            '等待就绪后发送标准调用，泛型仅约束类型，不增加运行时结构校验，载荷递归可移植转换，字节编码为文本且不保留类原型，应使用支持的普通数据。'
          ),
          params: {
            payload: t(
              'Caller Input consumed by worker compute; avoid cycles and reserved $worker envelope keys.',
              '由工作端计算消费的调用者输入，应避免环及工作外层保留标记键。'
            ),
            options: t(
              'Options default to {}; signal defaults to undefined and controls cooperative request cancellation. Inputs are copied without detaching caller buffers.',
              '选项对象默认 {}，signal 默认 undefined，控制请求的协作式取消；输入按复制发送，不 detach 调用方 buffer。'
            )
          },
          returns: t(
            'Promise<Output>; closed adapter rejects ADAPTER_DISPOSED, endpoint/RPC/compute failures keep their canonical identity. Classify ordinary request cancellation with RPC_CORE_ERROR_SOURCE and RpcCoreErrorCode.cancelled, not the serializer REQUEST_ABORTED code. close alone does not cancel admitted requests.',
            '返回结果 Promise，已关闭适配器以 `ADAPTER_DISPOSED` 拒绝；端点、请求与计算失败保留所属错误身份。通用请求取消检查 `RPC_CORE_ERROR_SOURCE` 与 `RpcCoreErrorCode.cancelled`，不是序列化取消码；仅调用 `close` 不会取消已接纳请求。'
          ),
          example: computeExample
        },
        close: {
          summary: t(
            'Idempotently marks unavailable synchronously; does not release endpoint or terminate Worker.',
            '同步幂等标记不可用，不释放端点或终止线程。'
          ),
          returns: t(
            'Void; later request calls reject immediately.',
            '无返回值，后续请求立即拒绝。'
          ),
          example: `adapter.close()
await adapter.dispose()`
        },
        dispose: {
          summary: t(
            'Closes adapter, awaits readiness and closes endpoint; never terminates the borrowed Worker. Repeated calls return the same Promise.',
            '关闭适配器、等待就绪并关闭端点，不终止借用线程；重复调用返回同一 Promise。'
          ),
          returns: t(
            'Stable Promise<void>; initialization/cleanup failures reject.',
            '返回稳定无值承诺，初始化及清理失败拒绝。'
          ),
          example: `const done = adapter.dispose()
console.log(done === adapter.dispose())
await done
worker.terminate()`
        }
      }
    },
    IManagedRpcHandler: {
      summary: t(
        'Callable (message: unknown) => Promise<void> from either handler factory. Message is raw event.data; it awaits readiness and delivery, not compute completion. Terminal calls resolve without delivery; init/delivery failures reject. Attach host listener yourself and remove it yourself at teardown.',
        '两种处理器工厂返回的可调用函数，接收事件中的原始消息并返回 `Promise<void>`；它等待就绪与投递，不等待计算完成。关闭后调用直接完成，初始化或投递失败会拒绝，宿主监听需自行接入与移除。'
      ),
      scenarios: [
        t(
          'Bridge worker message events to a canonical compute/codec endpoint.',
          '把线程消息事件桥接到标准计算或格式端点。'
        )
      ],
      example: computeExample,
      members: managedMembers
    },
    IWorkerComputedOptions: {
      summary: t(
        'Resource IResourceOptions plus Runtime selection; known fields are read once before Resource ownership and auto-start.',
        '资源选项加运行时选择，在资源拥有对象及自动启动前一次读取已知字段。'
      ),
      example: computeExample,
      optionCases: storeWorkerOptionCases.computed,
      members: computedOptions
    },
    IWorkerPort: {
      summary: t(
        'Alias of the native port accepted by rpc-plugin-browser dedicatedWorkerPlugin options.worker, through IWorkerMessagePort. It borrows synchronous postMessage, listener registration and removal, and optional start; the application retains the physical Worker or MessagePort lifetime.',
        '经 `IWorkerMessagePort` 引用 `rpc-plugin-browser` 的 `dedicatedWorkerPlugin` 所接收的 `options.worker` 原生端口。借用同步消息发送、监听注册与移除及可选启动方法，实际线程或消息端口的生命周期仍由应用持有。'
      ),
      example: computeExample,
      members: portMembers
    },
    IWorkerLike: {
      summary: t(
        'The same borrowed native worker port accepted through IWorkerMessagePort, with an additional optional terminate callback. Parser disposal releases its endpoint but leaves the Worker alive by default; terminateOnDispose explicitly opts into native termination.',
        '通过 `IWorkerMessagePort` 接收的同一借用原生端口，额外提供可选 `terminate` 回调。解析器销毁默认只释放端点、保留线程存活，显式设置 `terminateOnDispose` 才连带执行原生终止。'
      ),
      example: codecExample,
      members: {
        ...portMembers,
        terminate: {
          summary: t(
            'Optional synchronous no-argument host cleanup callback; called after endpoint cleanup only when terminateOnDispose is true, even if endpoint cleanup failed.',
            '可选同步无参数宿主清理回调，仅开启连带终止时在端点清理后调用，端点失败仍尝试。'
          ),
          returns: t(
            'Void; a failure rejects disposal alone or joins CLEANUP_FAILED AggregateError.',
            '无返回值，失败单独拒绝销毁或加入清理失败聚合错误。'
          ),
          example: `worker.terminate()`
        }
      }
    },
    IWorkerPluginOptions: {
      summary: t(
        'Serializer worker endpoint, format label and explicit optional termination ownership.',
        '序列化工作端点、格式标签及显式可选终止所有权。'
      ),
      example: codecExample,
      optionCases: storeWorkerOptionCases.serializer,
      members: pluginOptions
    },
    IWorkerFailureEvent: {
      summary: t(
        'Union error or messageerror: script/runtime failure versus structured-clone/deserialization failure. Canonical web-worker transport subscribes to both and fails pending calls.',
        '脚本运行失败与消息复制或反序列化失败两个事件名联合，标准工作传输订阅二者并使待处理请求失败。'
      ),
      members: {},
      example: `import type { IWorkerFailureEvent } from '@migaia/store-worker/serialize/worker'
const event: IWorkerFailureEvent = 'messageerror'`
    },
    IWorkerDiagnosticType: {
      summary: t(
        'The single literal worker, used as default codec diagnostic and plugin format label.',
        '仅包含工作标签字面量，用作默认格式诊断及插件格式标记。'
      ),
      members: {},
      example: `import { WorkerDiagnosticType, type IWorkerDiagnosticType } from '@migaia/store-worker'
const type: IWorkerDiagnosticType = WorkerDiagnosticType.worker`
    },
    IStoreWorkerErrorCode: {
      summary: t(
        'Value union of StoreWorkerErrorCode; external RPC/Resource failures have their own code unions.',
        '本包错误码表的值联合，外部请求及资源失败有各自错误码联合。'
      ),
      members: {},
      example: `import { StoreWorkerErrorCode, type IStoreWorkerErrorCode } from '@migaia/store-worker'
const code: IStoreWorkerErrorCode = StoreWorkerErrorCode.adapterDisposed`
    }
  },
  enums: {
    StoreWorkerErrorCode: {
      summary: t(
        'Concrete failure branches paired with STORE_WORKER_SOURCE.',
        '与本包来源联合识别的具体失败分支。'
      ),
      values: errors
    },
    WorkerDiagnosticType: {
      summary: t(
        'Default name/type for worker codec diagnostics.',
        '工作线程编解码诊断的默认名称及类型。'
      ),
      values: {
        worker: t(
          'Used when options.type is omitted; not an automatic format detector.',
          '格式选项省略时使用，不是自动格式检测器。'
        )
      }
    }
  },
  enhancers: {}
}
