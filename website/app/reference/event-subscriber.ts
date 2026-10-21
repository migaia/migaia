/**
 * Reference documentation of `@migaia/event-subscriber`. Rules: `app/reference/contract.ts`.
 * Verified against `packages/event-subscriber/src` (types.ts, channel.ts, hub.ts, async.ts,
 * style.ts, state-constants.ts, error-code.ts) on 2026-10-17. Delivery options reviewed against
 * types.ts and channel.ts on 2026-10-21.
 */
import type { ILibraryReference, IMemberDoc, IOptionCaseDoc, IText } from './contract.js'
import { eventSubscriberCases } from './event-subscriber-cases.js'

/** Builds one bilingual text. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** A startup task draws the dashboard once, selected independently of other listeners. */
const firstRenderExample = `import { createEventChannel, invokeTask } from '@migaia/event-subscriber'
import { subscribeOnce } from '@migaia/event-subscriber/subscriber'

const ready = createEventChannel<string>()
subscribeOnce(ready, ({ value }) => renderDashboard(value), {
  taskId: 'dashboard-first-paint'
})
await invokeTask(ready, 'dashboard-first-paint', initialDashboard)`
/** A named page refresh remains registered only for the page lifetime. */
const pageRefreshExample = `import { createEventChannel, invokeTask } from '@migaia/event-subscriber'
import { subscribeUntil } from '@migaia/event-subscriber/subscriber'

const updates = createEventChannel<string>()
subscribeUntil(updates, page.signal, ({ value }) => renderDashboard(value), {
  taskId: 'dashboard-refresh'
})
await invokeTask(updates, 'dashboard-refresh', latestDashboard)`
/** Subscription helpers forward the registration name to the channel. */
const subscriptionOptionDocs: Readonly<Record<string, IMemberDoc>> = {
  taskId: {
    summary: t(
      'Caller-assigned non-empty registration name, selected later by `filterTaskId()` or `invokeTask()`.',
      '调用方为本次订阅指定的非空登记名称，之后由 `filterTaskId()` 或 `invokeTask()` 选中。'
    ),
    default: t('Not set: the registration has no task name.', '不设置：这条登记没有任务名称。'),
    example: firstRenderExample
  }
}

/** Named registrations let startup and page refresh select their own work. */
const subscriptionOptionCases: readonly IOptionCaseDoc[] = [
  {
    title: t('Select the dashboard first paint', '选中看板的首次绘制'),
    problem: t(
      'Startup has several ready listeners, but this step should draw only the dashboard. Without `taskId`, the one-shot registration cannot be selected by name. `invokeTask` selects that registration, and the helper removes it before the dashboard renders.',
      '启动时有多个就绪监听者，这一步只应绘制看板。不设置 `taskId` 就无法按名称选中这条单次登记。`invokeTask` 选中该登记，辅助函数会在绘制看板前移除它。'
    ),
    example: firstRenderExample,
    result: t(
      'The initial dashboard is drawn once without invoking unrelated ready listeners.',
      '初始看板只绘制一次，不会调用其它就绪监听者。'
    ),
    covers: ['taskId']
  },
  {
    title: t('Refresh only the open dashboard page', '只刷新仍打开的看板页面'),
    problem: t(
      'A refresh command should reach this dashboard while its page is open. `taskId` makes that listener selectable. `subscribeUntil` removes it when the page signal aborts, so a later selection no longer targets the closed page.',
      '刷新命令应只送到仍打开的看板。`taskId` 让这个监听者可被选中。页面信号中止时，`subscribeUntil` 移除登记，之后按名称选择时不会再选中已关闭页面。'
    ),
    example: pageRefreshExample,
    result: t(
      'The open dashboard shows the latest data; its refresh listener is removed when the page closes.',
      '打开的看板显示最新数据，页面关闭时移除刷新监听者。'
    ),
    covers: ['taskId']
  }
]

/** Background draft failures reach telemetry, with an independent local fallback. */
const channelReportExample = `import { createEventChannel } from '@migaia/event-subscriber'

const drafts = createEventChannel<string>({
  report: ({ event, error }) => telemetry.capture(error, { draft: event.value }),
  terminalReport: (error) => writeDiagnosticLog(error)
})
drafts.subscribe(async ({ value }) => {
  await saveDraft(value)
})
drafts.publish(draftText)`
/** Hub diagnostics retain the event name when asynchronous draft saving fails. */
const hubReportExample = `import { createEventHub } from '@migaia/event-subscriber'

const events = createEventHub<{ save: string }>({
  report: ({ key, error }) => telemetry.capture(error, { event: key }),
  terminalReport: (error) => writeDiagnosticLog(error)
})
events.subscribe('save', async ({ value }) => {
  await saveDraft(value)
})
events.publish('save', draftText)`
/** Queue receipt notifications so every view sees the saved order before its receipt. */
const queuedCheckoutExample = `import { createEventChannel, EventDispatchPolicy } from '@migaia/event-subscriber'

const events = createEventChannel<'saved' | 'receipt-ready'>({
  dispatchPolicy: EventDispatchPolicy.queued,
  publishBudget: 100
})
events.subscribe(({ value }) => {
  if (value === 'saved') {
    prepareReceipt()
    events.publish('receipt-ready')
  }
})
events.subscribe(({ value }) => updateCheckoutStatus(value))
events.publish('saved')`
/** Removing a view listener releases registrations made by repeated integration setup. */
const removeViewExample = `import {
  createEventChannel, EventAdmissionPolicy, EventRemovalPolicy
} from '@migaia/event-subscriber'

const prices = createEventChannel<number>({
  admissionPolicy: EventAdmissionPolicy.multiple,
  removalPolicy: EventRemovalPolicy.listenerAll
})
const render = ({ value }: { value: number }) => updatePrice(value)
const stop = prices.subscribe(render)
prices.subscribe(render)
onPricePanelClosed(() => stop())`

/** Listener argument selection shared by channel, Hub, naming aliases, and subscription chains. */
const deliveryField: IMemberDoc = {
  summary: t(
    'Selects what the listener receives. Context delivery retains payload, controls and configured aliases; value delivery passes the original payload without copying or adding context members. Keep context delivery when the listener needs abort or task controls.',
    '选择监听者参数。context 保留 payload、控制方法与配置的别名；value 直接传入原始 payload，不复制，也不附加上下文成员。监听者需要取消或任务控制时保留 context。'
  ),
  default: t(
    '`EventDelivery.context` (`context`); omission and explicit context are equivalent.',
    '`EventDelivery.context`（`context`）；省略与显式 context 相同。'
  ),
  values: { enum: 'EventDelivery' },
  example: `import { createEventChannel, EventDelivery } from '@migaia/event-subscriber'

const updates = createEventChannel<{ id: number }>()
const stop = updates.subscribe((value) => console.log(value.id), { delivery: EventDelivery.value })
updates.publish({ id: 1 })
stop()`
}

/** `report` field shared by channel and hub options. */
const reportField = (hub: boolean): IMemberDoc => ({
  summary: t(
    `Receives listener failures that happen after \`publish()\` has already returned: a Promise or thenable returned by a listener that rejects later${hub ? ', together with the event `key`' : ''}, and value-path projection failures. Synchronous listener throws are not reported here; \`publish()\` throws them as \`PUBLISH_FAILED\`.`,
    `接收 \`publish()\` 已经返回之后才出现的 listener 失败：listener 返回的 Promise/thenable 稍后 reject${hub ? '（附带事件 `key`）' : ''}，以及 \`valueConfig\` 路径读取失败。同步抛出的错误不会进入这里，而是由 \`publish()\` 汇总为 \`PUBLISH_FAILED\` 抛出。`
  ),
  default: t(
    'Not set: late failures go to `terminalReport`, then to the host error reporter.',
    '不设置：迟到的失败交给 `terminalReport`，再交给宿主的错误上报（`reportError`）。'
  ),
  whenToUse: t(
    'Set a reporter when listeners return promises, such as saving a job. It receives late rejections and projection failures; synchronous throws still leave publish() as PUBLISH_FAILED. Without it, terminalReport handles these diagnostics.',
    '监听者返回 Promise 时设置，例如保存任务。它接收稍后的拒绝和值路径读取失败；同步抛错仍由 publish() 以 PUBLISH_FAILED 抛出。不设置时，这些诊断交给 terminalReport。'
  ),
  example: hub ? hubReportExample : channelReportExample
})

/** `terminalReport` field shared by channel and hub options. */
const terminalReportField = (hub: boolean): IMemberDoc => ({
  summary: t(
    'Last diagnostic exit: receives a late failure when `report` is missing, throws, or returns a rejected thenable. It never changes publish results.',
    '最后的诊断出口：当 `report` 未设置、自身抛错或返回被拒绝的 thenable 时，迟到的失败交给它。它不影响任何发布结果。'
  ),
  default: t(
    'Not set: the failure is passed to the host `reportError` with code `UNHANDLED_LISTENER_FAILURE`.',
    '不设置：失败以 `UNHANDLED_LISTENER_FAILURE` 码交给宿主的 `reportError`。'
  ),
  whenToUse: t(
    'Use a separate final sink when the main reporter can fail, for example when telemetry is offline. It receives failures missed by report; without it, the host diagnostic fallback receives them. It does not change publish() results.',
    '主要上报渠道可能失败时设置独立的最终出口，例如遥测服务离线。report 未能处理的失败会交给它；不设置时交给宿主诊断通道。它不改变 publish() 的结果。'
  ),
  example: hub ? hubReportExample : channelReportExample
})

/** `style` field shared by channel and hub options. */
const styleField: IMemberDoc = {
  summary: t(
    'Adds alias method names for subscribe, publish and unsubscribe at construction time. Accepts a preset name (`on-emit`, `on-trigger`, `listen-fire`) or a custom name map checked with `as const satisfies IEventApiStyleNames`. The original methods stay available, and aliases refer to the same function objects, forwarding subscription delivery options unchanged. Changing style does not change listener order, delivery timing, error handling or unsubscribe behavior. Older examples may call defineEventApiStyle; that helper has been removed. Write custom names directly as an object and use the type check above to validate its fields while keeping the exact alias names for checking later method calls.',
    '在构造时为订阅、发布、退订增加别名方法。可传预设名（`on-emit`、`on-trigger`、`listen-fire`），或用 `as const satisfies IEventApiStyleNames` 检查的自定义名称表。原有的 `subscribe`/`publish` 始终保留，别名也引用原来的函数，原样传递订阅的 delivery 选项。style 不改变顺序、调度、错误或生命周期语义：换个方法名不会改变监听器调用次序、执行时机、错误处理或退订方式。旧版的 defineEventApiStyle 已移除。自定义名称直接写成对象，并用上面的类型检查方式检查名称表；这样会保留 observe、dispatch 等具体方法名，供编辑器检查后续调用。'
  ),
  default: t('`subscribe-publish`: no aliases are added.', '`subscribe-publish`：不增加别名。'),
  values: {
    'subscribe-publish': t(
      'Default names only.',
      '只使用默认名称 `subscribe` / `publish` / `unsubscribe`。'
    ),
    'on-emit': t(
      'Adds `on`, `emit`, and `off` on handles.',
      '增加 `on`、`emit`，句柄上增加 `off`。'
    ),
    'on-trigger': t(
      'Adds `on`, `trigger`, and `off` on handles.',
      '增加 `on`、`trigger`，句柄上增加 `off`。'
    ),
    'listen-fire': t(
      'Adds `listen`, `fire`, and `unlisten` on handles.',
      '增加 `listen`、`fire`，句柄上增加 `unlisten`。'
    )
  },
  whenToUse: t(
    'Choose the names your integration already uses: on-emit adds on/emit/off, on-trigger adds on/trigger/off, and listen-fire adds listen/fire/unlisten. A custom map supplies your own names. Omit it or use subscribe-publish for canonical names only; every choice preserves delivery and cancellation behavior.',
    '接入已有代码时选择它熟悉的名称：on-emit 增加 on/emit/off，on-trigger 增加 on/trigger/off，listen-fire 增加 listen/fire/unlisten。自定义名称表使用你自己的名称。省略或传 subscribe-publish 时只提供标准名称；所有选择都保持交付和取消行为。'
  ),
  example: `import { createEventChannel } from '@migaia/event-subscriber'

const notifications = createEventChannel<string>({ style: 'on-emit' })
const stop = notifications.on(({ value }) => renderNotification(value))
notifications.emit('Order shipped')
onNotificationPanelClosed(() => stop.off())`
}

/** `valueConfig` field shared by channel and hub options. */
const valueConfigField: IMemberDoc = {
  summary: t(
    'Reads one fixed path of each published payload and attaches the result to context delivery under `alias`, so context listeners can read `event.<alias>` while `event.value` stays the original payload. Value delivery receives the original payload without adding an alias. The path is read once per publish. A missing, blocked or throwing path leaves the context alias `undefined` and reports `VALUE_PROJECTION_FAILED` through `report`; all listeners still run. An empty `readPath` disables it.',
    '从每次发布的 payload 中读取一个固定路径，并以 `alias` 为名挂到 context 模式的事件上下文上：上下文 listener 读 `event.<alias>`，`event.value` 仍是原始 payload。value 模式直接收到原始 payload，不附加别名。每次发布只读取一次路径。路径不存在、中途不是对象或 getter 抛错时，上下文别名为 `undefined`，通过 `report` 上报 `VALUE_PROJECTION_FAILED`；所有 listener 照常被调用。`readPath` 为空字符串时不启用。'
  ),
  default: t('Not set: the context has no alias.', '不设置：事件上下文上没有别名字段。'),
  example: `import { createEventChannel } from '@migaia/event-subscriber'

type IOrderChanged = { data: { id: string } }
const valueConfig = { readPath: 'data.id', alias: 'orderId' } as const
const orders = createEventChannel<IOrderChanged, void, undefined, typeof valueConfig>({
  valueConfig
})
orders.subscribe((event) => highlightOrder(event.orderId))
orders.publish({ data: { id: 'order-7' } })`
}

/** Docs of the canonical channel members, shared by every channel type. */
const channelMembers: Readonly<Record<string, IMemberDoc>> = {
  subscribe: {
    summary: t(
      'Registers `listener` and returns a subscription handle. Calling the handle (or `handle.unsubscribe()`) removes the registration; `handle.subscribe(...)` adds another registration to the same chain, and releasing the chain removes all of them in reverse order.',
      '登记 `listener`，返回订阅句柄。调用句柄本身（或 `handle.unsubscribe()`）即退订；`handle.subscribe(...)` 在同一条链上继续登记，释放整条链时按相反顺序全部移除。'
    ),
    params: {
      listener: t(
        'Function called with the event context by default (`event.value`, `event.abort()`, `event.taskId`), or the original payload when `delivery: EventDelivery.value` is explicit. Its return value is collected by the `invoke*` helpers in either mode.',
        '默认收到事件上下文（`event.value`、`event.abort()`、`event.taskId`）的函数；显式 `delivery: EventDelivery.value` 时直接收到原始 payload。两种模式的返回值都由 `invoke*` 系列函数收集。'
      ),
      options: t(
        '`taskId` optionally gives this registration a non-empty name for `filterTaskId()` and `invokeTask()`, including value delivery. `delivery` defaults to `EventDelivery.context`; explicit `EventDelivery.value` selects a payload listener. Options type: `IEventSubscribeOptions`.',
        '`taskId` 可为登记指定非空名称，`filterTaskId()` 和 `invokeTask()` 用它选中登记，value 模式也支持。`delivery` 默认 `EventDelivery.context`；显式 `EventDelivery.value` 选择 payload 监听者。选项类型为 `IEventSubscribeOptions`。'
      )
    },
    returns: t(
      'A callable, idempotent handle. Extending a handle after it was released throws `SUBSCRIPTION_CLOSED`.',
      '可直接调用、可重复调用的句柄；释放后再用它链式登记会抛 `SUBSCRIPTION_CLOSED`。'
    ),
    whenToUse: t(
      'Long-lived listeners. For one delivery use `subscribeOnce`; for a listener tied to an AbortSignal use `subscribeUntil`.',
      '长期监听时使用。只想收一次用 `subscribeOnce`；随 AbortSignal 自动退订用 `subscribeUntil`。'
    ),
    example: `const stop = channel
  .subscribe((event) => console.log('log', event.value))
  .subscribe((value) => audit(value), { taskId: 'audit', delivery: EventDelivery.value })
stop() // 两条登记一起移除`
  },
  publish: {
    summary: t(
      'Delivers `value` synchronously to the current listener snapshot in registration order, within `publishBudget`. Promises returned by listeners are not awaited; their later rejections go to `report`. A listener that publishes again is delivered recursively by default, or after the snapshot when `dispatchPolicy` is `queued`.',
      '用 `value` 按登记顺序同步交付当前监听者快照，调用总数受 `publishBudget` 限制。不等待监听者返回的 Promise，它们稍后的拒绝交给 `report`。监听者内部再次发布时，默认立即递归交付；`dispatchPolicy` 为 `queued` 时排到当前快照之后。'
    ),
    params: {
      value: t(
        'Payload delivered as `event.value` in context mode, or directly in value mode, with its original identity.',
        '本次的原始 payload；context 模式通过 `event.value` 读取，value 模式直接接收，保持原始身份。'
      )
    },
    returns: t(
      'Nothing. Ordinary synchronous listener failures are collected and thrown together as an `AggregateError` with code `PUBLISH_FAILED` after the snapshot completes. If `publishBudget` is exhausted, delivery stops early and throws `PUBLISH_FAILED`; some listeners may not have run.',
      '无返回值。普通的监听者同步错误会被收集，在快照完成后合并为带 `PUBLISH_FAILED` 码的 `AggregateError` 抛出。若 `publishBudget` 耗尽，则提前停止交付并抛出 `PUBLISH_FAILED`，部分监听者可能没有被调用。'
    ),
    whenToUse: t(
      'Notifications where the publisher does not need listener results. To wait for results use `invokeParallel`, `invokeSerial` or `invokeTask`.',
      '用于发布方不需要结果的通知。需要等待或收集结果时改用 `invokeParallel`、`invokeSerial` 或 `invokeTask`。'
    ),
    example: `channel.publish({ id: 'order-1' })`
  },
  filterTaskId: {
    summary: t(
      'Creates a read-only view that selects only registrations whose `taskId` equals `taskId`. The view cannot subscribe or publish; pass it to an `invoke*` helper.',
      '创建只读视图，只选中 `taskId` 等于参数值的登记。视图本身不能订阅或发布，用来交给 `invoke*` 系列函数。'
    ),
    params: {
      taskId: t(
        'The name given at subscription: `channel.subscribe(listener, { taskId })`.',
        '订阅时指定的名称，即 `channel.subscribe(listener, { taskId })` 中的 `taskId`。'
      )
    },
    returns: t(
      'An `IFilteredEventChannel` view. Selection happens when a helper runs, so later registrations with the same taskId are included.',
      '一个 `IFilteredEventChannel` 视图。选择发生在调用 `invoke*` 时，所以之后用同一 `taskId` 登记的 listener 也会被选中。'
    ),
    whenToUse: t(
      'Several registrations share one taskId and all of them must run. When exactly one must match, call `invokeTask`, which rejects zero or several matches.',
      '多个登记共用一个 `taskId` 且都要执行时使用；必须恰好命中一个时改用 `invokeTask`，它会拒绝 0 个或多个匹配。'
    ),
    example: `channel.subscribe(saveToDisk, { taskId: 'persist' })
channel.subscribe(saveToCloud, { taskId: 'persist' })
await invokeSerial(channel.filterTaskId('persist'), document)`
  },
  clear: {
    summary: t(
      'Removes every current registration without calling listeners. With the default `removalPolicy: "handle"`, old handles cannot remove later registrations. With `removalPolicy: "listener-all"` and multiple admission, an unused old handle can still remove current registrations of the same listener after clear; unique admission keeps handles bound to their original registration.',
      '一次移除当前全部登记，不调用监听者。默认 `removalPolicy: "handle"` 下，旧句柄不会移除后续新建的登记。选择 `removalPolicy: "listener-all"` 并允许重复登记时，尚未调用过的旧句柄仍会移除清空后同一监听函数的当前登记；唯一登记模式则把句柄绑定在原登记上。'
    ),
    returns: t('Nothing; after the call `size` is `0`.', '无返回值；调用后 `size` 为 `0`。'),
    whenToUse: t(
      'The owner of the channel shuts down. A single consumer should call its own handle instead.',
      'channel 的所有者关闭时使用；单个使用方应调用自己的句柄退订。'
    ),
    example: `channel.clear()
console.log(channel.size) // 0`
  },
  size: {
    summary: t(
      'Number of active registrations right now. Duplicate subscriptions of one listener count separately unless `admissionPolicy` is `unique`.',
      '当前有效的登记数量。同一个 listener 重复订阅会分别计数，除非 `admissionPolicy` 为 `unique`。'
    )
  }
}

/** Docs of the hub members, shared by every hub type. */
const hubMembers: Readonly<Record<string, IMemberDoc>> = {
  subscribe: {
    summary: t(
      'Registers `listener` for one event name. The channel of that name is created on first use. The returned handle can be called to unsubscribe, and `handle.subscribe(otherKey, listener)` adds another event to the same chain.',
      '为某个事件名登记 `listener`，该事件名的 channel 在第一次使用时才创建。返回的句柄调用即退订，`handle.subscribe(otherKey, listener)` 可在同一条链上登记另一个事件。'
    ),
    params: {
      key: t('Event name from the event map `C`.', '事件映射类型 `C` 中的事件名。'),
      listener: t(
        'Receives that key’s context by default, or its original payload when explicit value delivery is selected; Hub listeners return no result.',
        '默认收到该事件的上下文，显式 value 模式时收到该 key 的原始 payload；Hub listener 不返回结果。'
      ),
      options: t(
        'Optional third argument: only `delivery`, defaulting to `EventDelivery.context`; `EventDelivery.value` passes the payload directly. Hub subscriptions accept no `taskId`.',
        '可选第三参只接受 `delivery`，默认 `EventDelivery.context`；`EventDelivery.value` 直接传入 payload。Hub 订阅不接受 `taskId`。'
      )
    },
    returns: t(
      'A chainable `IEventHubSubscription`; releasing it removes every registration of the chain in reverse order.',
      '可链式调用的 `IEventHubSubscription`；释放时按相反顺序移除整条链上的登记。'
    ),
    example: `const stop = hub
  .subscribe('ready', (event) => console.log('ready at', event.value.at))
  .subscribe('warning', (event) => console.warn(event.value.message))
stop()`
  },
  publish: {
    summary: t(
      'Delivers `value` synchronously to the listeners of `key`. Publishing a key that nobody subscribed does nothing.',
      '把 `value` 同步交给 `key` 对应的 listener。没有人订阅过的事件名，发布时什么也不做。'
    ),
    params: {
      key: t('Event name.', '要发布的事件名。'),
      value: t('Payload whose type is fixed by `C[key]`.', 'payload，类型由 `C[key]` 决定。')
    },
    returns: t(
      'Nothing. Synchronous listener failures are thrown together as `PUBLISH_FAILED`, as with a channel.',
      '无返回值。与 channel 相同，同步失败合并为 `PUBLISH_FAILED` 抛出。'
    ),
    whenToUse: t(
      'Notifications. A hub does not collect listener results; create a dedicated `createEventChannel<T, R>()` when results matter.',
      '用于通知。hub 不收集 listener 结果，需要结果时单独创建 `createEventChannel<T, R>()`。'
    ),
    example: `hub.publish('warning', { message: 'cache is stale' })`
  },
  clear: {
    summary: t(
      'Removes the registrations of one event name and drops its channel, or of every event name when called without an argument.',
      '移除某个事件名的全部登记并回收它的 channel；不传参数时清空所有事件名。'
    ),
    params: {
      key: t('Event name to clear; omit to clear all.', '要清空的事件名；省略则清空全部。')
    },
    returns: t('Nothing.', '无返回值；被清空的事件之后发布不会调用任何 listener。'),
    example: `hub.clear('warning')
hub.clear()`
  },
  size: {
    summary: t(
      'Counts registrations of one event name, or of all names when called without an argument. The total is kept in O(1).',
      '统计某个事件名的登记数量；不传参数时返回所有事件名的总数（常数时间）。'
    ),
    params: {
      key: t('Event name to count; omit for the total.', '要统计的事件名；省略则返回总数。')
    },
    returns: t('The number of active registrations.', '当前有效登记的数量。'),
    example: `if (hub.size('warning') === 0) console.warn('没有人处理 warning')`
  }
}

/** Instance scenarios of a channel. */
const channelScenarios = [
  t(
    'A library exposes one lifecycle signal (`ready`, `closed`, `changed`) without string event names.',
    '库对外暴露一个生命周期信号（`ready`、`closed`、`changed`），不需要字符串事件名。'
  ),
  t(
    'A job dispatcher names each handler with `taskId` and awaits exactly one of them with `invokeTask`.',
    '任务分发器用 `taskId` 给每个处理器命名，再用 `invokeTask` 精确等待其中一个。'
  ),
  t(
    'Plugins register listeners and the host collects their async results in order with `invokeSerialSettled`.',
    '插件登记 listener，宿主用 `invokeSerialSettled` 按顺序收集各自的异步结果。'
  )
]

/** Instance example of a channel. */
const channelExample = {
  en: `import { createEventChannel, invokeParallelSettled } from '@migaia/event-subscriber'

type ISaved = { readonly id: string }
const saved = createEventChannel<ISaved, string>()

// Two registrations on one chain; one call releases both.
const stop = saved
  .subscribe((event) => \`audit:\${event.value.id}\`)
  .subscribe(async (event) => \`index:\${event.value.id}\`)

saved.publish({ id: 'doc-1' }) // notify, results ignored
const results = await invokeParallelSettled(saved, { id: 'doc-2' }) // collect results
console.log(saved.size, results)
stop()
console.log(saved.size) // 0`,
  zh: `import { createEventChannel, invokeParallelSettled } from '@migaia/event-subscriber'

type ISaved = { readonly id: string }
const saved = createEventChannel<ISaved, string>()

// 同一条链上的两条登记，一次调用全部释放
const stop = saved
  .subscribe((event) => \`audit:\${event.value.id}\`)
  .subscribe(async (event) => \`index:\${event.value.id}\`)

saved.publish({ id: 'doc-1' }) // 只通知，不关心结果
const results = await invokeParallelSettled(saved, { id: 'doc-2' }) // 收集结果
console.log(saved.size, results)
stop()
console.log(saved.size) // 0`
}

/** Hub scenarios and example. */
const hubScenarios = [
  t(
    'An application bus with a fixed set of named events typed by one map.',
    '应用内的事件总线：一组固定的具名事件，用一张类型映射约束 payload。'
  ),
  t(
    'A library exposes `on(name, listener)` style events with the `on-emit` preset.',
    '库用 `on-emit` 预设对外提供 `on(name, listener)` 形式的事件接口。'
  )
]
const hubExample = {
  en: `import { createEventHub } from '@migaia/event-subscriber'

type IEvents = { ready: { readonly at: number }; warning: { readonly message: string } }
const hub = createEventHub<IEvents>({ report: ({ key, error }) => console.error(key, error) })
const stop = hub
  .subscribe('ready', (event) => console.log('ready at', event.value.at))
  .subscribe('warning', (event) => console.warn(event.value.message))
hub.publish('ready', { at: Date.now() })
console.log(hub.size(), hub.size('warning')) // 2 1
stop()`,
  zh: `import { createEventHub } from '@migaia/event-subscriber'

type IEvents = { ready: { readonly at: number }; warning: { readonly message: string } }
const hub = createEventHub<IEvents>({ report: ({ key, error }) => console.error(key, error) })
const stop = hub
  .subscribe('ready', (event) => console.log('就绪时间', event.value.at))
  .subscribe('warning', (event) => console.warn(event.value.message))
hub.publish('ready', { at: Date.now() })
console.log(hub.size(), hub.size('warning')) // 2 1
stop()`
}

/** Shared parameter texts of the async helpers. */
const asyncChannelParam = t(
  'A channel created by `createEventChannel()`, or a `filterTaskId()` view of it. Other objects, or channels from another copy of the package, throw `INVALID_CHANNEL`.',
  '由 `createEventChannel()` 创建的 channel，或它的 `filterTaskId()` 视图。其它对象（包括另一份包副本创建的 channel）会抛 `INVALID_CHANNEL`。'
)
const asyncValueParam = t(
  'Payload passed to every selected listener as `event.value`.',
  '传给每个被选中 listener 的 payload，即 `event.value`。'
)

/** Reference of `@migaia/event-subscriber`. */
export const eventSubscriberReference: ILibraryReference = {
  modules: {
    index: {
      summary: t(
        'Main entry point. Start with `createEventChannel()` for one typed event stream or `createEventHub()` for several named events. The `invoke*` functions publish to a channel and wait for listener results. Constants (`EventDispatchPolicy`, `EventAdmissionPolicy`, `EventRemovalPolicy`) select channel options; `EventSubscriberErrorCode` lists the error codes.',
        '主入口。一条带类型的事件流用 `createEventChannel()`，多个具名事件用 `createEventHub()`。`invoke*` 系列函数向 channel 发布并等待 listener 的结果。常量 `EventDispatchPolicy`、`EventAdmissionPolicy`、`EventRemovalPolicy` 用于选择 channel 选项，`EventSubscriberErrorCode` 列出全部错误码。'
      ),
      example: `import { createEventChannel } from '@migaia/event-subscriber'

const ready = createEventChannel<{ at: number }>()
const stop = ready.subscribe(({ value }) => console.log(value.at))
ready.publish({ at: Date.now() })
stop()`
    },
    subscriber: {
      summary: t(
        'Use this entry when you already have an event source and need to limit how long a listener stays subscribed. Choose `@migaia/event-subscriber/subscriber` for subscription helpers rather than the root entry’s channel and hub creation APIs.\n\n`subscribeOnce()` listens for one delivery; `subscribeUntil()` keeps a listener until a cancellation signal aborts. The source only needs to implement `subscribe(listener, options)`, and the returned function lets you unsubscribe yourself; these helpers do not create an event source.',
        '已经有事件来源，需要限制监听持续时间时，使用此入口。从 `@migaia/event-subscriber/subscriber` 导入订阅辅助函数；需要创建事件通道或事件中心时才使用根入口。\n\n`subscribeOnce()` 只接收一次事件；`subscribeUntil()` 在取消信号中止时退订。来源只需实现 `subscribe(listener, options)`，返回的函数也允许你主动退订；这些辅助函数本身不创建事件来源。'
      ),
      example: `import { subscribeOnce } from '@migaia/event-subscriber/subscriber'

subscribeOnce(channel, (event) => console.log('只执行一次', event.value))`
    }
  },
  symbols: {
    createEventChannel: {
      role: 'factory',
      purpose: t(
        'Creates one in-process, synchronous event channel: an ordered list of listener registrations. `publish()` delivers a value to a snapshot of the current listeners; the `invoke*` functions use the same registrations when the publisher needs listener results. Options select how re-entrant publishes are ordered, whether duplicate listeners are merged, how much one publish may fan out, and optional method aliases.',
        '创建一个进程内、同步分发的事件 channel：一份有序的 listener 登记表。`publish()` 把值交给当前 listener 的快照；发布方需要 listener 结果时，`invoke*` 系列函数复用同一份登记表。选项决定：发布中再次发布的顺序、重复 listener 是否合并、一次发布最多调用多少 listener，以及可选的方法别名。'
      ),
      params: {
        options: t(
          'Channel options; every field is optional. See the options table.',
          'channel 选项，全部字段可选，见下方选项表。'
        )
      },
      returns: t(
        'The channel (`ICanonicalEventChannel`). With a `style` option it also has the alias methods of that style. Malformed options throw `INVALID_OPTIONS`; non-callable report/terminalReport uses `INVALID_REPORTER`, before construction.',
        '创建好的 channel（`ICanonicalEventChannel`）；设置了 `style` 时还带有对应的别名方法。选项形状不合法时在构造前抛 `INVALID_OPTIONS`；不可调用的上报器使用 `INVALID_REPORTER`。'
      ),
      options: 'IEventChannelOptions',
      exampleIntro: t(
        'A listener receives the payload as `event.value`. `dispatchPolicy` is `recursive` by default; choose `queued` to finish the current round before nested publishes. `clear()` removes the remaining registrations after the example.',
        '监听者通过 `event.value` 收到发布的数据。`dispatchPolicy` 默认是 `recursive`；选择 `queued` 时，当前这一轮结束后才交付嵌套事件。示例最后用 `clear()` 移除剩余登记。'
      ),
      cases: eventSubscriberCases.createEventChannel,
      example: eventSubscriberCases.createEventChannel[0].example,
      scenarios: channelScenarios,
      avoid: [
        t(
          'Several named events share one owner: use `createEventHub()`.',
          '同一个所有者有多个具名事件：改用 `createEventHub()`。'
        ),
        t(
          'Values must be transformed step by step: use `@migaia/middleware-pipeline`.',
          '需要逐步变换值（前一步的输出作为下一步的输入）：改用 `@migaia/middleware-pipeline`。'
        )
      ]
    },
    createEventHub: {
      role: 'factory',
      purpose: t(
        'Creates a hub that routes several named events, each with its own payload type from the event map `C`. Each event name gets its own channel on first use. Hub channels always use recursive dispatch, multiple admission, handle removal, a budget of 100000 listener calls and non-throwing aborted admission; use `createEventChannel()` when those must be chosen.',
        '创建 hub，按事件名路由多个事件，每个事件的 payload 类型由事件映射 `C` 决定。每个事件名在第一次使用时才创建自己的 channel。hub 内部的 channel 固定使用递归分发、允许重复登记、按句柄移除、单次发布最多调用 100000 个 listener、已取消信号不抛错；需要自己选择这些策略时用 `createEventChannel()`。'
      ),
      params: {
        options: t('Hub options; every field is optional.', 'hub 选项，全部字段可选。')
      },
      returns: t(
        'The hub (`IEventHub`, or `IStyledEventHub` with alias methods when `style` is set). Malformed options throw `INVALID_OPTIONS`; non-callable reporters use `INVALID_REPORTER`.',
        '创建好的 hub（`IEventHub`；设置 `style` 时为带别名方法的 `IStyledEventHub`）。选项形状不合法时抛 `INVALID_OPTIONS`；不可调用的上报器使用 `INVALID_REPORTER`。'
      ),
      options: 'IEventHubOptions',
      exampleIntro: t(
        'The type map assigns a payload to each event name. `subscribe(key, listener, options?)` receives the payload as `event.value` by default, or directly with `{ delivery: EventDelivery.value }`; chaining a different key joins the same cleanup handle. `size()` without a key counts all registrations.',
        '事件映射为每个事件名指定数据类型。`subscribe(key, listener, options?)` 默认通过 `event.value` 接收数据，设置 `{ delivery: EventDelivery.value }` 时直接接收 payload；链式订阅另一个事件名时，登记加入同一个清理句柄。不传事件名的 `size()` 统计全部登记。'
      ),
      cases: eventSubscriberCases.createEventHub,
      example: eventSubscriberCases.createEventHub[0].example,
      scenarios: hubScenarios,
      avoid: [
        t(
          'You need listener results: a hub does not collect them; use one `createEventChannel<T, R>()` per event.',
          '需要 listener 结果：hub 不收集结果，改为每个事件单独用 `createEventChannel<T, R>()`。'
        )
      ]
    },
    EVENT_SUBSCRIBER_SOURCE: {
      role: 'error',
      purpose: t(
        'The `source` value attached to every error this package throws (`@migaia/event-subscriber`). Compare `error.source` with it to know the error came from this package, then branch on `error.code`.',
        '本包抛出的每个错误都带有的 `source` 值（`@migaia/event-subscriber`）。比较 `error.source` 是否等于它，即可确认错误来自本包，再按 `error.code` 分支处理。'
      ),
      example: `try {
  channel.subscribe(undefined as never)
} catch (error) {
  if ((error as { source?: string }).source === EVENT_SUBSCRIBER_SOURCE) console.log((error as { code: string }).code)
}`
    },
    EventAdmissionPolicy: {
      role: 'constant',
      purpose: t(
        'Values for the `admissionPolicy` option of `createEventChannel()`: whether subscribing the same listener function twice creates two registrations or reuses one.',
        '`createEventChannel()` 的 `admissionPolicy` 选项取值：同一个 listener 函数订阅两次时，是建立两条登记，还是复用一条。'
      ),
      example: `createEventChannel<number>({ admissionPolicy: EventAdmissionPolicy.unique })`
    },
    EventApiStyle: {
      role: 'constant',
      purpose: t(
        'Preset names for the `style` option of channels and hubs. Each preset adds alias methods next to the default `subscribe` / `publish`.',
        'channel 与 hub 的 `style` 选项可用的预设名。每个预设在默认的 `subscribe` / `publish` 旁增加一组别名方法。'
      ),
      example: `createEventChannel<number>({ style: EventApiStyle.onEmit }).emit(1)`
    },
    EventDelivery: {
      role: 'constant',
      purpose: t(
        'Values for the `delivery` subscribe option: whether a listener receives the event context or only the original payload. Value delivery skips building a context for each listener call.',
        '订阅选项 `delivery` 的取值：listener 收到事件上下文，还是只收到原始 payload。value 模式在每次调用 listener 时都不再创建上下文对象。'
      ),
      example: `channel.subscribe((value) => render(value), { delivery: EventDelivery.value })`
    },
    EventDispatchPolicy: {
      role: 'constant',
      purpose: t(
        'Values for the `dispatchPolicy` option of `createEventChannel()`: how a `publish()` made by a listener during another publish is delivered.',
        '`createEventChannel()` 的 `dispatchPolicy` 选项取值：listener 在一次发布过程中又调用 `publish()` 时，新值如何交付。'
      ),
      example: queuedCheckoutExample
    },
    EventRemovalPolicy: {
      role: 'constant',
      purpose: t(
        'Values for the `removalPolicy` option of `createEventChannel()`: how many registrations a subscription handle removes when called.',
        '`createEventChannel()` 的 `removalPolicy` 选项取值：调用订阅句柄时，只移除这一条登记，还是移除同一函数的全部登记。'
      ),
      example: removeViewExample
    },
    EventSubscriberErrorCode: {
      role: 'error',
      purpose: t(
        'Every error code this package can throw or report. Errors keep their native type (`TypeError`, `AggregateError`) and carry `source` and `code`; branch on `code` instead of the message.',
        '本包可能抛出或上报的全部错误码。错误保留原生类型（`TypeError`、`AggregateError`），并带有 `source` 与 `code` 字段；请按 `code` 分支，不要依赖错误信息文本。'
      ),
      example: `try {
  await invokeTask(channel, 'email', job)
} catch (error) {
  if ((error as { code?: string }).code === EventSubscriberErrorCode.taskNotFound) console.warn('没有处理器')
}`
    },
    EventSubscriberState: {
      role: 'constant',
      purpose: t(
        'Protocol strings: `fulfilled` and `rejected` in `IListenerResult.status`, and `abort` as the signal event name. Registration `aborted` is a boolean. Compare against these constants instead of literal strings.',
        '协议字符串：`IListenerResult.status` 的 `fulfilled`、`rejected`，以及信号事件名 `abort`。登记的 `aborted` 是布尔值。比较时使用这些常量，不要手写字符串。'
      ),
      example: `const results = await invokeParallelSettled(channel, value)
const failed = results.filter((result) => result.status === EventSubscriberState.rejected)`
    },
    invokeEachLive: {
      role: 'operation',
      purpose: t(
        'Low-level synchronous traversal for framework integrations: hands admitted registrations to `visitor` as invocations, each at most once. Appended registrations may join while no registration has been removed or cleared during the traversal. After a removal or clear, later appends are no longer admitted, but already admitted pending entries are still visited. The visitor must finish synchronously. A visitor failure receives `VISITOR_FAILED`; native identity is retained where possible, otherwise the original, including undefined, remains on `cause`. Ordinary publishing should use the snapshot-based `invoke*` functions, whose target set cannot change while they run.',
        '供框架集成使用的底层同步遍历：把已接纳的登记作为调用对象交给 `visitor`，每条最多访问一次。遍历中尚未发生移除或清空时，可以接纳追加的登记；发生移除或清空后，不再接纳之后追加的登记，但已经接纳的待访问项仍会被访问。`visitor` 必须同步完成。访问失败附 `VISITOR_FAILED`；尽量保留原生身份，否则原值（含显式空缺值）保存在 `cause`。普通发布请使用基于快照的 `invoke*` 函数，它们的目标集合在执行期间不会变化。'
      ),
      params: {
        channel: asyncChannelParam,
        value: asyncValueParam,
        visitor: t(
          'Called once per registration with an invocation object; call `invocation.invoke()` to run that listener.',
          '每条登记调用一次，参数是调用对象；调用 `invocation.invoke()` 才会真正执行该 listener。'
        )
      },
      example: `invokeEachLive(channel, value, (invocation) => {
  if (invocation.taskId !== 'skip') invocation.invoke()
})`
    },
    invokeParallel: {
      role: 'operation',
      purpose: t(
        'Publishes `value` and waits for every listener: all listeners start immediately, and the Promise resolves with their results in registration order. If any listener fails it still waits for all of them, then rejects with an `AggregateError` (`PUBLISH_FAILED`).',
        '发布 `value` 并等待所有 listener：全部 listener 立即启动，Promise 按登记顺序给出它们的结果。只要有 listener 失败，仍会等全部结束，然后以 `AggregateError`（`PUBLISH_FAILED`）reject。'
      ),
      params: { channel: asyncChannelParam, value: asyncValueParam },
      returns: t(
        'Resolves with each listener result in registration order; rejects with `PUBLISH_FAILED` when any failed.',
        '按登记顺序 resolve 每个 listener 的结果；任一失败则以 `PUBLISH_FAILED` reject。'
      ),
      example: `const sizes = await invokeParallel(resizeImage, file) // 全部并行执行`
    },
    invokeParallelSettled: {
      role: 'operation',
      purpose: t(
        'Starts listeners in parallel and collects their successes and failures as `{ status, value }` or `{ status, reason }`, in registration order. Listener failures do not reject the returned Promise. Invalid channel admission still throws synchronously before a Promise is returned.',
        '并行启动监听者，按登记顺序收集每个成功值 `{ status, value }` 或失败原因 `{ status, reason }`。监听者失败不会让返回的 Promise 拒绝；非法通道仍在返回 Promise 前同步抛错。'
      ),
      params: { channel: asyncChannelParam, value: asyncValueParam },
      returns: t(
        'An array of `IListenerResult` in registration order, not completion order. Invalid channel input throws synchronously with `INVALID_CHANNEL`.',
        '`IListenerResult` 数组，按登记顺序排列，而不是完成顺序。非法通道输入同步抛出 `INVALID_CHANNEL`。'
      ),
      exampleIntro: t(
        '`createEventChannel<number, number>()` accepts numeric payloads and numeric listener results. Both handlers receive `3` as `event.value`. Inspect `status`: `fulfilled` carries `value`, and `rejected` carries the original `reason`; compare against `EventSubscriberState`.',
        '`createEventChannel<number, number>()` 的输入和监听者返回值都是数字。两个处理者都通过 `event.value` 收到 `3`。结果的 `status` 为 `fulfilled` 时读取 `value`，为 `rejected` 时读取原始 `reason`；用 `EventSubscriberState` 比较状态。'
      ),
      cases: eventSubscriberCases.invokeParallelSettled,
      example: eventSubscriberCases.invokeParallelSettled[0].example
    },
    invokeSerial: {
      role: 'operation',
      purpose: t(
        'Publishes `value` to one listener at a time: the next listener starts only after the previous one settled. Every listener receives the same `value` (results are not chained). Rejects with `PUBLISH_FAILED` after all listeners ran if any failed.',
        '逐个调用 listener：前一个结束后才启动下一个。每个 listener 收到的都是同一个 `value`（结果不会传给下一个）。全部执行完后若有失败，以 `PUBLISH_FAILED` reject。'
      ),
      params: { channel: asyncChannelParam, value: asyncValueParam },
      returns: t(
        'Resolves with the results in registration order; rejects with `PUBLISH_FAILED` when any failed.',
        '按登记顺序 resolve 结果；任一失败则以 `PUBLISH_FAILED` reject。'
      ),
      exampleIntro: t(
        'The channel accepts strings and string listener results. The example passes the same order ID to both handlers and awaits their result array. Returning a Promise delays the next handler until that Promise settles; results are not passed to the next handler.',
        '通道接收字符串，监听者也返回字符串。示例把同一个订单标识交给两个处理者，再等待结果数组。前一个返回 Promise 时，下一个等它结算后才开始；返回值不会传给下一个处理者。'
      ),
      cases: eventSubscriberCases.invokeSerial,
      example: eventSubscriberCases.invokeSerial[0].example
    },
    invokeSerialSettled: {
      role: 'operation',
      purpose: t(
        'Runs listeners serially and resolves with one success or failure entry for each. Listener failures are collected; invalid channel admission still throws synchronously before a Promise is returned.',
        '逐个执行监听者，返回每个监听者的成功值或失败原因。监听者失败会被收集；非法通道仍在返回 Promise 前同步抛错。'
      ),
      params: { channel: asyncChannelParam, value: asyncValueParam },
      returns: t(
        'An array of `IListenerResult` in registration order.',
        '按登记顺序排列的 `IListenerResult` 数组。'
      ),
      example: `const results = await invokeSerialSettled(hooks, context)`
    },
    invokeTask: {
      role: 'operation',
      purpose: t(
        'Calls exactly one registration selected by `taskId` and waits for its result. Selection happens before any listener runs: no match throws `TASK_NOT_FOUND`, several matches throw `TASK_NOT_UNIQUE` (with `taskId` and `matchCount` on the error). A failing listener rejects with `PUBLISH_FAILED`.',
        '按 `taskId` 精确选中一条登记并等待它的结果。选择发生在任何 listener 执行之前：没有匹配同步抛 `TASK_NOT_FOUND`，多个匹配同步抛 `TASK_NOT_UNIQUE`（错误上带 `taskId` 和 `matchCount`）。listener 失败则以 `PUBLISH_FAILED` reject。'
      ),
      params: {
        channel: t(
          'A channel created by `createEventChannel()`.',
          '由 `createEventChannel()` 创建的 channel。'
        ),
        taskId: t(
          'Name given at `subscribe(listener, { taskId })`.',
          '订阅时 `subscribe(listener, { taskId })` 给出的名称。'
        ),
        value: asyncValueParam
      },
      returns: t(
        'Resolves with the listener result; rejects with `PUBLISH_FAILED` when it fails.',
        'resolve 为该 listener 的结果；listener 失败则以 `PUBLISH_FAILED` reject。'
      ),
      exampleIntro: t(
        'The channel accepts numbers and numeric results. In `subscribe(listener, { taskId })`, `taskId` is an optional non-empty registration name and defaults to unset. `invokeTask(channel, taskId, value)` selects that name exactly; the default multiple admission mode lets the example register the same function twice.',
        '通道的输入和监听者结果都是数字。`subscribe(listener, { taskId })` 的 `taskId` 是可选的非空登记名称，默认不设置。`invokeTask(channel, taskId, value)` 精确选择这个名称；默认允许重复登记，所以示例可以两次登记同一个函数。'
      ),
      cases: eventSubscriberCases.invokeTask,
      example: eventSubscriberCases.invokeTask[0].example
    },
    invokeTaskSettled: {
      role: 'operation',
      purpose: t(
        'Like `invokeTask`, but a failing listener resolves as `{ status: "rejected", reason }` instead of rejecting. Selection errors still throw synchronously.',
        '与 `invokeTask` 相同，但 listener 失败时 resolve 为 `{ status: "rejected", reason }` 而不是 reject。选择错误仍会同步抛出。'
      ),
      params: {
        channel: t(
          'A channel created by `createEventChannel()`.',
          '由 `createEventChannel()` 创建的 channel。'
        ),
        taskId: t(
          'Name of the single registration to call, given at `subscribe(listener, { taskId })`.',
          '要调用的那一条登记的名称，即订阅时 `subscribe(listener, { taskId })` 指定的值。'
        ),
        value: asyncValueParam
      },
      returns: t('One `IListenerResult`.', '一个 `IListenerResult`，区分成功的值与失败的原因。'),
      example: `const result = await invokeTaskSettled(tasks, 'email', job)
if (result.status === 'fulfilled') console.log(result.value)`
    },
    withSnapshotEntries: {
      role: 'operation',
      purpose: t(
        'Advanced integration: takes one immutable snapshot of the selected registrations and passes them to `visitor` as invocation objects, so the caller decides when and in which order to run each. Each invocation runs at most once; when the visitor returns (or its Promise settles) all invocations close and calling them throws `INVOCATION_CLOSED`.',
        '高级集成接口：对选中的登记取一次不可变快照，以调用对象数组交给 `visitor`，由调用方决定何时、以什么顺序执行。每个调用对象最多执行一次；`visitor` 返回（或其 Promise 结束）后全部关闭，再调用抛 `INVOCATION_CLOSED`。'
      ),
      params: {
        channel: asyncChannelParam,
        value: asyncValueParam,
        visitor: t(
          'Receives the invocation array; may be async.',
          '收到调用对象数组的函数，可以是异步函数。'
        )
      },
      returns: t(
        'Whatever settles the visitor: `void`, or a Promise when the visitor is async. After invocations close, visitor throws and rejections receive `VISITOR_FAILED`: writable native errors keep type, identity and stack; conflicting, immutable or primitive failures remain on `cause`, including explicit undefined.',
        '随 `visitor` 结束：同步时无返回值，异步时返回 Promise。调用对象关闭后，访问回调的抛错与拒绝附 `VISITOR_FAILED`：可修改的原生错误保留类型、身份与堆栈；冲突、不可修改或原始值失败由 `cause` 保留，包含显式空缺值。'
      ),
      example: `await withSnapshotEntries(channel, value, async (entries) => {
  for (const entry of [...entries].reverse()) await entry.invoke() // 倒序执行
})`
    },
    subscribeOnce: {
      role: 'operation',
      optionDocs: subscriptionOptionDocs,
      optionCases: subscriptionOptionCases,
      purpose: t(
        'Subscribes a listener that runs at most once: the registration is removed before the listener is called, so a re-entrant publish, a throw or a rejection cannot call it a second time.',
        '订阅一个最多执行一次的 listener：在调用 listener 之前就先退订，所以重入发布、抛错或 reject 都不会让它第二次执行。'
      ),
      params: {
        channel: t(
          'Any object with `subscribe(listener, options)`.',
          '任何提供 `subscribe(listener, options)` 的对象。'
        ),
        listener: t(
          'The one-shot context listener; value delivery is not supported by this helper.',
          '只执行一次的上下文 listener；此 helper 不支持 value 模式。'
        ),
        options: t('`taskId` for the registration.', '这条登记的 `taskId`。')
      },
      returns: t(
        'An unsubscribe function; calling it before delivery cancels the listener.',
        '退订函数；在交付前调用即可取消。'
      ),
      example: `subscribeOnce(ready, () => console.log('首次就绪'))`
    },
    subscribeSubscriber: {
      role: 'operation',
      purpose: t(
        'Subscribes an object instead of a function: the channel calls `subscriber.handle(event)` with `this` bound to the object, so class instances can keep state. Which event it receives is decided by the channel, not by the object.',
        '用对象而不是函数订阅：channel 以对象自身为 `this` 调用 `subscriber.handle(event)`，因此类实例可以保存状态。接收哪个事件由传入的 channel 决定，与对象无关。'
      ),
      params: {
        channel: t(
          'Any object with `subscribe(listener, options)`.',
          '任何提供 `subscribe(listener, options)` 的对象。'
        ),
        subscriber: t(
          'Object with a callable `handle(event)`; otherwise `INVALID_SUBSCRIBER` is thrown.',
          '带可调用 `handle(event)` 的对象，否则抛 `INVALID_SUBSCRIBER`。'
        )
      },
      returns: t('An unsubscribe function.', '退订函数。'),
      example: `class Counter {
  total = 0
  handle(event: { readonly value: number }) {
    this.total += event.value
  }
}
const stop = subscribeSubscriber(numbers, new Counter())`
    },
    subscribeUntil: {
      role: 'operation',
      optionDocs: subscriptionOptionDocs,
      optionCases: subscriptionOptionCases,
      purpose: t(
        'Subscribes a listener that is removed automatically when `signal` aborts. Aborting only stops future deliveries; a listener that is already running is not interrupted. With an already-aborted signal no registration is made (or `ABORTED` is thrown when the channel has `throwOnAborted: true`).',
        '订阅一个随 `signal` 取消而自动退订的 listener。取消只阻止之后的交付，不会中断正在执行的 listener。传入已取消的信号时不会登记（若 channel 设置了 `throwOnAborted: true`，则抛 `ABORTED`）。'
      ),
      params: {
        channel: t(
          'Any object with `subscribe(listener, options)`.',
          '任何提供 `subscribe(listener, options)` 的对象。'
        ),
        signal: t(
          '`AbortSignal` (or a compatible object) whose abort removes the registration.',
          '`AbortSignal`（或结构兼容的对象），取消时移除这条登记。'
        ),
        listener: t(
          'The context listener; value delivery is not supported by this helper.',
          '要登记的上下文 listener；此 helper 不支持 value 模式。'
        ),
        options: t('`taskId` for the registration.', '这条登记的 `taskId`。')
      },
      returns: t(
        'An idempotent synchronous unsubscribe function. Pre-aborted defaults to a no-op with no registration or Promise; strict `throwOnAborted: true` synchronously throws TypeError/`ABORTED`. Projected aliases remain available alongside live abort controls.',
        '可重复调用的同步退订函数。信号已取消时默认返回空操作，不登记也不返回 Promise；严格设置 `throwOnAborted: true` 时同步抛出 `TypeError` 与 `ABORTED`。投影别名保留，取消控制保持实时。'
      ),
      exampleIntro: t(
        '`updates` is a string channel. `page.signal` comes from the page-owned `AbortController`; the listener reads `event.value`. Calling `page.abort()` removes the registration, and the returned `stop()` can also unsubscribe earlier. Optional `options.taskId` defaults to unset.',
        '`updates` 是传递字符串的通道。`page.signal` 来自页面持有的 `AbortController`，监听者读取 `event.value`。调用 `page.abort()` 会移除登记，也可以提前调用返回的 `stop()`。可选的 `options.taskId` 默认不设置。'
      ),
      cases: eventSubscriberCases.subscribeUntil,
      example: eventSubscriberCases.subscribeUntil[0].example
    }
  },
  types: {
    IEventChannel: {
      summary: t(
        'The methods of every channel: subscribe, publish, select by task, clear, and count registrations. `createEventChannel()` returns this surface (as `ICanonicalEventChannel`).',
        '每个 channel 都具备的方法：订阅、发布、按任务名筛选、清空、统计登记数。`createEventChannel()` 返回的就是这组能力（类型为 `ICanonicalEventChannel`）。'
      ),
      members: channelMembers
    },
    ICanonicalEventChannel: {
      summary: t(
        'A channel created by `createEventChannel()`. It has all `IEventChannel` methods plus a brand that the `invoke*` functions check, so only real channels (not look-alike objects) can be invoked.',
        '由 `createEventChannel()` 创建的 channel。它具备 `IEventChannel` 的全部方法，另带一个内部标记，`invoke*` 系列函数用它确认传入的是真正的 channel，而不是形状相似的对象。'
      ),
      scenarios: channelScenarios,
      example: channelExample,
      members: {}
    },
    IStyledEventChannel: {
      summary: t(
        'A channel created with the `style` option: `IEventChannel` plus alias methods named by the style (for example `on` and `emit`). Subscribe aliases retain the same context/value overloads and options.',
        '设置了 `style` 选项的 channel：在 `IEventChannel` 之外，还带有该风格命名的别名方法（例如 `on`、`emit`）。订阅别名保留相同的 context/value 重载与选项。'
      ),
      members: {}
    },
    IEventChannelSubscription: {
      summary: t(
        'The handle returned by `channel.subscribe()`. Call it to unsubscribe; `handle.unsubscribe` is the same function; `handle.subscribe(...)` adds another registration to the same chain, and one call releases the whole chain in reverse order.',
        '`channel.subscribe()` 返回的句柄。直接调用即退订；`handle.unsubscribe` 是同一个函数；`handle.subscribe(...)` 在同一条链上继续登记，一次调用按相反顺序释放整条链。'
      ),
      members: {
        unsubscribe: {
          summary: t(
            'The handle itself, exposed under a readable name, so `handle.unsubscribe()` and `handle()` do the same thing.',
            '句柄自身的另一个名字，`handle.unsubscribe()` 与 `handle()` 效果相同。'
          )
        },
        subscribe: {
          summary: t(
            'Adds another registration on the same channel to this chain and returns the extended handle; releasing the chain removes all of its registrations in reverse order. It accepts the same `taskId` and delivery options as `channel.subscribe`. After the chain was released it throws `SUBSCRIPTION_CLOSED`.',
            '在同一个 channel 上再登记一个 listener 并加入这条链，返回扩展后的句柄；释放整条链时按相反顺序移除其中全部登记。接受与 `channel.subscribe` 相同的 `taskId`、delivery 选项。链已释放后再调用会抛 `SUBSCRIPTION_CLOSED`。'
          )
        }
      }
    },
    IEventHub: {
      summary: t(
        'A router of named events created by `createEventHub()`. Each event name owns a channel created on first use; `publish` reaches only the listeners of that name.',
        '由 `createEventHub()` 创建的具名事件路由器。每个事件名拥有一个在第一次使用时才创建的 channel，`publish` 只到达该事件名的 listener。'
      ),
      members: hubMembers
    },
    IStyledEventHub: {
      summary: t(
        'The hub returned by `createEventHub()`: `IEventHub` plus the alias methods of its `style`, if any.',
        '`createEventHub()` 返回的 hub：`IEventHub` 的全部方法，设置了 `style` 时还带有对应的别名方法。'
      ),
      scenarios: hubScenarios,
      example: hubExample,
      members: hubMembers
    },
    IEventHubSubscription: {
      summary: t(
        'The handle returned by `hub.subscribe()`. Call it to unsubscribe, or call `handle.subscribe(key, listener)` to add another event to the same chain.',
        '`hub.subscribe()` 返回的句柄。调用即退订；`handle.subscribe(key, listener)` 可在同一条链上登记另一个事件。'
      ),
      scenarios: hubScenarios,
      example: hubExample,
      members: {
        unsubscribe: {
          summary: t(
            'The handle itself under a readable name; releases the whole chain.',
            '句柄自身的另一个名字，调用后释放整条链。'
          )
        },
        subscribe: {
          summary: t(
            'Adds a registration for another event name to the same chain; the optional third argument selects context or value delivery, as on `hub.subscribe`, without a task label. In a chain with a finite event map, the same name cannot be added twice (checked by the type system).',
            '在同一条链上为另一个事件名登记；可选第三参与 `hub.subscribe` 相同，选择 context 或 value 模式，不接受任务标签。事件映射为有限键时，同一个事件名不能在一条链上重复登记（由类型系统检查）。'
          ),
          params: {
            key: t(
              'Another event name from the event map; a finite map rejects names already in this chain.',
              '事件映射中的另一个事件名；有限键映射不接受这条链上已有的事件名。'
            ),
            listener: t(
              'Receives that event’s context by default, or its original payload with value delivery.',
              '默认收到该事件的上下文；选择 value 模式时收到原始 payload。'
            ),
            options: t(
              'Optional; only `delivery`, defaulting to `EventDelivery.context`.',
              '可选；只接受 `delivery`，默认 `EventDelivery.context`。'
            )
          },
          returns: t(
            'The extended handle; calling it releases every registration of the chain in reverse order.',
            '扩展后的句柄；调用它会按相反顺序释放链上全部登记。'
          ),
          example: `const stop = hub
  .subscribe('ready', (event) => console.log('ready at', event.value.at))
  .subscribe('warning', (warning) => console.warn(warning.message), { delivery: EventDelivery.value })
stop()`
        }
      }
    },
    IEventSubscribeOptions: {
      summary: t(
        'Per-registration channel options. Context delivery is the default; explicit value delivery changes only the listener argument. Hub subscribe options accept only delivery.',
        '通道每条登记的选项。默认使用 context；显式 value 只改变监听者参数。Hub 订阅选项只接受 delivery。'
      ),
      members: { ...subscriptionOptionDocs, delivery: deliveryField }
    },
    IEventChannelOptions: {
      optionCases: [
        {
          title: t(
            'Finish the current notification before its follow-up',
            '先处理完当前通知，再处理后续通知'
          ),
          problem: t(
            'A checkout listener prepares a receipt after an order is saved and publishes a follow-up notification. Recursive delivery can show the receipt before another view sees the saved order. `queued` finishes the saved notification first; `publishBudget` also bounds listener calls if integrations keep publishing follow-ups.',
            '结账监听者在订单保存后准备收据，再发布后续通知。递归交付可能让另一个视图先看到收据、后看到订单保存。`queued` 先交付完订单保存通知；`publishBudget` 还会在接入代码持续发布后续事件时限制监听调用总数。'
          ),
          example: queuedCheckoutExample,
          result: t(
            'The checkout status shows the saved order before showing that its receipt is ready.',
            '结账状态先显示订单已保存，再显示收据已准备好。'
          ),
          covers: ['dispatchPolicy', 'publishBudget']
        },
        {
          title: t('Release all copies of a view listener', '释放视图监听者的全部登记'),
          problem: t(
            'Two integrations have registered the same price-panel callback. With default handle removal, closing the panel through one handle leaves the other active. `multiple` keeps the registrations independent, while `listener-all` lets the panel release both through one handle.',
            '两个接入功能登记了同一个价格面板回调。默认按句柄移除时，用一个句柄关闭面板仍会留下另一个登记。`multiple` 保留独立登记，`listener-all` 让面板用一个句柄释放两条登记。'
          ),
          example: removeViewExample,
          result: t(
            'Closing the price panel removes both copies of its listener, so later price updates do not reach it.',
            '关闭价格面板后会移除该监听者的两条登记，后续价格更新不会再送到它。'
          ),
          covers: ['admissionPolicy', 'removalPolicy']
        }
      ],
      summary: t(
        'Options of `createEventChannel()`. All fields are optional and fixed at creation.',
        '`createEventChannel()` 的选项。全部字段可选，在创建时确定，之后不能修改。'
      ),
      members: {
        report: reportField(false),
        terminalReport: terminalReportField(false),
        dispatchPolicy: {
          summary: t(
            'Decides what happens when a listener calls `publish()` while a publish is still running.',
            '决定 listener 在一次发布尚未结束时又调用 `publish()`，新值如何交付。'
          ),
          default: t(
            '`EventDispatchPolicy.recursive`: the inner value is delivered immediately, before the outer publish continues.',
            '`EventDispatchPolicy.recursive`：立即交付内层的值，交付完再继续外层发布。'
          ),
          values: { enum: 'EventDispatchPolicy' },
          whenToUse: t(
            'Use queued when listeners publish follow-up events and every listener must finish the current value first. recursive delivers the nested value immediately. Omitting it selects recursive.',
            '监听者会发布后续事件，且所有监听者都应先处理完当前值时选 queued。recursive 会立即交付嵌套值；省略时使用 recursive。'
          ),
          example: queuedCheckoutExample
        },
        admissionPolicy: {
          summary: t(
            'Decides whether subscribing the same listener function more than once creates separate registrations or reuses one.',
            '决定同一个 listener 函数多次订阅时，是各自建立登记，还是复用同一条登记。'
          ),
          default: t(
            '`EventAdmissionPolicy.multiple`: every subscribe call creates its own registration.',
            '`EventAdmissionPolicy.multiple`：每次订阅都建立一条独立登记。'
          ),
          values: { enum: 'EventAdmissionPolicy' },
          whenToUse: t(
            'Use unique when repeated setup calls must reuse the same listener and task label. multiple gives each call an independent registration and is the default. Different task labels are not merged.',
            '重复初始化必须复用同一函数和任务名时选 unique。multiple 让每次调用各自登记，也是默认值。不同任务名不会被合并。'
          ),
          example: `import { createEventChannel, EventAdmissionPolicy } from '@migaia/event-subscriber'

const prices = createEventChannel<number>({ admissionPolicy: EventAdmissionPolicy.unique })
const render = ({ value }: { value: number }) => updatePrice(value)
prices.subscribe(render)
prices.subscribe(render)
prices.publish(latestPrice)`
        },
        removalPolicy: {
          summary: t(
            'Decides how many registrations a subscription handle removes when it is called.',
            '决定调用一个订阅句柄时，移除多少条登记。'
          ),
          default: t(
            '`handle`: the handle removes only the registration it created.',
            '`handle`：句柄只移除它自己建立的那一条登记。'
          ),
          values: { enum: 'EventRemovalPolicy' },
          whenToUse: t(
            'Use listener-all when releasing one handle must also remove other registrations of that function. handle removes only its own registration and is the default. This matters when admissionPolicy is multiple.',
            '释放一个句柄时也要移除同一函数的其它登记，选 listener-all。handle 只移除自己的登记，也是默认值。此区别适用于 admissionPolicy 为 multiple 的情况。'
          ),
          example: removeViewExample
        },
        publishBudget: {
          summary: t(
            'Maximum number of listener calls in one top-level synchronous publish, including calls caused by nested publishes. When the budget runs out the channel stops delivering and throws `PUBLISH_FAILED` when snapshot targets or nested values remain, with `processed` and `remaining` in `error.detail`, which stops runaway recursive publishing. Must be a positive safe integer.',
            '一次顶层同步发布中最多调用多少次 listener，嵌套发布引起的调用也计入。预算耗尽时停止继续交付，并抛出 `PUBLISH_FAILED`，若还有快照目标或嵌套值未交付，`error.detail` 记录 `processed` 与 `remaining`，用来阻止失控的递归发布。必须是正的安全整数。'
          ),
          default: t(
            '`100_000` listener calls per top-level publish.',
            '每次顶层发布最多 `100_000` 次 listener 调用。'
          ),
          example: queuedCheckoutExample
        },
        throwOnAborted: {
          summary: t(
            'Decides what `subscribeUntil(channel, signal, listener)` does when `signal` is already aborted: return a no-op unsubscribe without registering, or throw.',
            '决定 `subscribeUntil(channel, signal, listener)` 收到已经取消的信号时怎么做：不登记并返回空的退订函数，或者直接抛错。'
          ),
          default: t(
            '`false`: no registration is made and a function that does nothing is returned.',
            '`false`：不建立登记，返回一个什么也不做的退订函数。'
          ),
          values: {
            false: t('Silently skip the registration.', '静默跳过登记，调用方不会收到错误。'),
            true: t(
              'Throw a `TypeError` with code `ABORTED`; use it when subscribing with a cancelled signal is a caller bug.',
              '抛出带 `ABORTED` 码的 `TypeError`；适合把“用已取消的信号订阅”视为调用方错误的场景。'
            )
          },
          whenToUse: t(
            'Use true when subscribing after cancellation is a caller error: subscribeUntil throws ABORTED. false and omission return a no-op handle without registering. Neither choice interrupts an already-running listener.',
            '取消后仍然订阅属于调用错误时设为 true，subscribeUntil 会抛 ABORTED。false 或省略时不登记，返回空操作句柄。两者都不会中断已经运行的监听者。'
          ),
          example: `import { createEventChannel } from '@migaia/event-subscriber'
import { subscribeUntil } from '@migaia/event-subscriber/subscriber'

const notifications = createEventChannel<string>({ throwOnAborted: true })
subscribeUntil(notifications, page.signal, ({ value }) => renderNotification(value))`
        },
        style: styleField,
        valueConfig: valueConfigField
      }
    },
    IEventHubOptions: {
      optionCases: [
        {
          title: t(
            'Route typed notifications with familiar method names',
            '用熟悉的方法名分发带类型的通知'
          ),
          problem: t(
            'An order panel joins an existing on/emit integration and highlights the changed order. Without `style`, it has only canonical method names; without `valueConfig`, each listener must read data.id itself. The aliases fit the integration, while the projected orderId keeps highlight code focused on the order.',
            '订单面板接入已有的 on/emit 调用方式，并高亮变化的订单。不设 `style` 时只有标准方法名；不设 `valueConfig` 时，每个监听者都要自行读取 data.id。别名适配已有代码，提取出的 orderId 则让高亮逻辑只关注订单。'
          ),
          example: `import { createEventHub } from '@migaia/event-subscriber'

type IOrderEvents = { changed: { data: { id: string } } }
const valueConfig = { readPath: 'data.id', alias: 'orderId' } as const
const events = createEventHub<IOrderEvents, 'on-emit', typeof valueConfig>({
  style: 'on-emit',
  valueConfig
})
const stop = events.on('changed', (event) => highlightOrder(event.orderId))
events.emit('changed', { data: { id: 'order-7' } })
onOrderPanelClosed(() => stop.off())`,
          result: t(
            'The order panel highlights order-7 using the projected orderId while the original payload remains available.',
            '订单面板通过提取出的 orderId 高亮 order-7，同时仍可读取原始数据。'
          ),
          covers: ['style', 'valueConfig']
        },
        {
          title: t(
            'Keep a final sink for failed background work',
            '为失败的后台任务保留最终上报出口'
          ),
          problem: t(
            'The editor saves drafts in an asynchronous hub listener. A synchronous try/catch around publish() cannot catch a later save rejection. `report` sends the failure and event name to telemetry; `terminalReport` keeps a local diagnostic if telemetry also fails.',
            '编辑器用异步 hub 监听者保存草稿。包住 publish() 的同步 try/catch 接不到稍后的保存拒绝。`report` 把失败和事件名送到遥测；遥测也失败时，`terminalReport` 留下本地诊断。'
          ),
          example: hubReportExample,
          result: t(
            'A failed draft save reaches telemetry with its event name; if telemetry fails, the local diagnostic log receives the diagnostic.',
            '草稿保存失败时，遥测会收到失败和事件名；遥测也失败时，本地诊断日志收到该诊断。'
          ),
          covers: ['report', 'terminalReport']
        }
      ],
      summary: t(
        'Options of `createEventHub()`. Dispatch, admission, removal, budget and aborted-signal behaviour are fixed for hubs; only reporting, method aliases and the value alias can be set.',
        '`createEventHub()` 的选项。hub 的分发、登记、移除、预算和已取消信号的行为是固定的，只能设置失败上报、方法别名和值别名。'
      ),
      members: {
        report: reportField(true),
        terminalReport: terminalReportField(true),
        style: styleField,
        valueConfig: valueConfigField
      }
    },
    IEventApiStyleNames: {
      summary: t(
        'A custom alias name map for the `style` option, checked with `as const satisfies IEventApiStyleNames`.',
        '`style` 选项使用的自定义别名表，用 `as const satisfies IEventApiStyleNames` 检查。'
      ),
      example: `import { createEventChannel } from '@migaia/event-subscriber'
import type { IEventApiStyleNames } from '@migaia/event-subscriber'

const style = { subscribe: 'observe', publish: 'dispatch', unsubscribe: 'dispose' } as const satisfies IEventApiStyleNames
const channel = createEventChannel<number, void, typeof style>({ style })
const subscription = channel.observe(event => console.log(event.value))
channel.dispatch(1)
subscription.dispose()`,
      members: {
        subscribe: {
          summary: t(
            'Alias name added next to `subscribe`, for example `observe`.',
            '加在 `subscribe` 旁边的订阅方法别名，例如 `observe`。'
          )
        },
        publish: {
          summary: t(
            'Alias name added next to `publish`, for example `dispatch`.',
            '加在 `publish` 旁边的发布方法别名，例如 `dispatch`。'
          )
        },
        unsubscribe: {
          summary: t(
            'Alias name added on subscription handles; optional.',
            '加在订阅句柄上的退订别名，例如 `dispose`；可省略。'
          )
        }
      }
    },
    IEventApiStyle: {
      summary: t(
        'What the `style` option accepts: a preset name from `EventApiStyle` or a custom name map.',
        '`style` 选项接受的值：`EventApiStyle` 中的预设名，或自定义别名表。'
      ),
      members: {}
    },
    IEventAdmissionPolicy: {
      summary: t(
        'The union of `EventAdmissionPolicy` values.',
        '`EventAdmissionPolicy` 全部取值组成的联合类型。'
      ),
      members: {}
    },
    IEventDispatchPolicy: {
      summary: t(
        'The union of `EventDispatchPolicy` values.',
        '`EventDispatchPolicy` 全部取值组成的联合类型。'
      ),
      members: {}
    },
    IEventRemovalPolicy: {
      summary: t(
        'The union of `EventRemovalPolicy` values.',
        '`EventRemovalPolicy` 全部取值组成的联合类型。'
      ),
      members: {}
    },
    IEventSubscriberErrorCode: {
      summary: t(
        'The union of every `EventSubscriberErrorCode` value.',
        '`EventSubscriberErrorCode` 全部错误码组成的联合类型。'
      ),
      members: {}
    },
    IEventReport: {
      summary: t(
        'What `report` receives for one late listener failure of a channel.',
        'channel 的 `report` 收到的一次迟到失败的信息。'
      ),
      members: {
        event: {
          summary: t(
            'The event context of the delivery that failed, including `value` and `taskId`.',
            '失败那次交付的事件上下文，包含 `value`、`taskId` 等。'
          )
        },
        error: {
          summary: t(
            'The rejection reason or projection error.',
            '失败原因：被拒绝的值，或路径读取错误。'
          )
        }
      }
    },
    IEventHubReport: {
      summary: t(
        'What a hub `report` receives: like `IEventReport`, plus the event `key` that failed.',
        'hub 的 `report` 收到的信息：与 `IEventReport` 相同，另外带有失败的事件名 `key`。'
      ),
      members: {}
    },
    IEventInvocation: {
      summary: t(
        'One registration handed to a `withSnapshotEntries` or `invokeEachLive` visitor. It exposes the task name and a way to run the listener, but not the listener itself.',
        '交给 `withSnapshotEntries` 或 `invokeEachLive` 回调的一条登记。它提供任务名和执行方法，但不暴露 listener 本身。'
      ),
      members: {
        taskId: {
          summary: t(
            'Task name of the registration, or `undefined`.',
            '这条登记的任务名；未命名时为 `undefined`。'
          )
        },
        invoke: {
          summary: t(
            'Runs the listener once with the published value.',
            '用发布的值执行一次该 listener。'
          ),
          returns: t(
            'The listener result. A second call, or a call after the visitor finished, throws `INVOCATION_CLOSED`.',
            'listener 的返回值。第二次调用，或在回调结束后调用，会抛 `INVOCATION_CLOSED`。'
          )
        }
      }
    },
    IEventInvocationVisitor: {
      summary: t(
        'Callback of `withSnapshotEntries`: receives the invocation array and may return a Promise.',
        '`withSnapshotEntries` 的回调：收到调用对象数组，可以返回 Promise。'
      ),
      members: {}
    },
    IEventMap: {
      summary: t(
        'Event map type of a hub: an object type whose keys are event names and whose values are payload types.',
        'hub 的事件映射类型：对象类型，键是事件名，值是对应的 payload 类型。'
      ),
      members: {}
    },
    IEventValueConfig: {
      summary: t(
        'Shape of the `valueConfig` option: which payload path to read and under which name to attach it.',
        '`valueConfig` 选项的结构：读取 payload 的哪个路径，以什么名字挂到事件上下文上。'
      ),
      members: {
        readPath: {
          summary: t(
            'Dot path into the payload, such as `data.id`; an empty string disables reading.',
            '指向 payload 内部的点路径，例如 `data.id`；空字符串表示不启用。'
          )
        },
        alias: {
          summary: t(
            'Name of the context field that receives the value; must not clash with context members such as `value`.',
            '接收读取结果的上下文字段名，不能与 `value` 等上下文已有成员重名。'
          )
        }
      }
    },
    IFilteredEventChannel: {
      summary: t(
        'The read-only view returned by `filterTaskId()`. It has no methods; pass it to `invokeParallel`, `invokeSerial` and their settled variants.',
        '`filterTaskId()` 返回的只读视图。它没有方法，用来传给 `invokeParallel`、`invokeSerial` 及其 settled 版本。'
      ),
      members: {}
    },
    IListenerResult: {
      summary: t(
        'One listener outcome in settled results: `{ status: "fulfilled", value }` or `{ status: "rejected", reason }`.',
        'settled 系列函数返回的数组中，表示单个 listener 结局的对象：`{ status: "fulfilled", value }` 或 `{ status: "rejected", reason }`。'
      ),
      scenarios: [
        t(
          'Inspect each listener outcome without aborting the settled batch when one listener fails.',
          '逐个检查监听者结果，不会因单个监听者失败而中断全部结算。'
        )
      ],
      example: `const channel = createEventChannel<number, number>()
channel.subscribe((event) => event.value * 2)
for (const result of await invokeParallelSettled(channel, 3)) {
  if (result.status === 'fulfilled') console.log(result.value)
  else console.error(result.reason)
}`,
      members: {
        status: {
          summary: t(
            'Discriminant from `EventSubscriberState`: fulfilled carries a value, while rejected carries the original reason.',
            '来自 `EventSubscriberState` 的判别值；成功分支包含结果，拒绝分支包含原始原因。'
          ),
          values: {
            fulfilled: t(
              'The listener completed successfully; read its awaited value.',
              '监听者成功完成，可以读取等待后的返回值。'
            ),
            rejected: t(
              'The listener threw or rejected; inspect its original reason.',
              '监听者抛错或拒绝，可以检查原始失败原因。'
            )
          }
        },
        value: {
          summary: t(
            'Awaited listener return present only in the fulfilled branch; its position follows registration order.',
            '仅成功分支存在的监听者等待后返回值；所在位置保持登记顺序。'
          )
        },
        reason: {
          summary: t(
            'Exact thrown or rejected value present only in the rejected branch, without message-only replacement.',
            '仅拒绝分支存在的原始抛出或拒绝值，不会被只有消息的摘要替换。'
          )
        }
      }
    },
    IEventChannelLike: {
      summary: t(
        'Any object the subscription helpers accept: it only needs `subscribe(listener, options)` returning an unsubscribe function.',
        '订阅辅助函数接受的任何对象：只需提供返回退订函数的 `subscribe(listener, options)`。'
      ),
      members: {
        subscribe: {
          summary: t(
            'Registers a listener and returns an unsubscribe function.',
            '登记一个 listener 并返回退订函数。'
          ),
          params: {
            listener: t('The listener to register.', '要登记的 listener。'),
            options: t(
              '`taskId` and delivery for the registration; explicit `EventDelivery.value` selects the payload overload. Once/until helpers use only the context overload and taskId.',
              '登记的 `taskId` 与 delivery；显式 `EventDelivery.value` 选择 payload 重载。once/until helper 只使用上下文重载与 taskId。'
            )
          },
          returns: t('A function that removes the registration.', '移除这条登记的函数。')
        }
      }
    },
    IEventContext: {
      summary: t(
        'The object received by default or explicit context listeners. It carries the payload and lets the listener cancel its own registration or rename its task for later deliveries. Value listeners receive only the original payload.',
        '默认或显式 context listener 收到的对象。它携带 payload，并允许 listener 撤销自己的登记，或修改之后交付时使用的任务名。value listener 只收到原始 payload。'
      ),
      members: {
        value: {
          summary: t(
            'The payload passed to `publish()` for this delivery, unchanged.',
            '本次交付对应的 `publish()` 参数，原样传入、未经复制或转换。'
          )
        },
        aborted: {
          summary: t(
            'Live abort flag set by `abort()` or linked-signal cancellation; normal unsubscription removes the registration without setting it.',
            '实时取消标志；由 `abort()` 或关联信号取消设置。普通退订只移除登记，不会把它设为真。'
          )
        },
        abortReason: {
          summary: t(
            'The reason passed to `abort()`; `undefined` until then.',
            '调用 `abort()` 时传入的原因；尚未取消时为 `undefined`。'
          )
        },
        taskId: {
          summary: t(
            'Task label captured for this dispatch snapshot; `setTaskId()` changes only later deliveries.',
            '本次分发快照捕获的任务标签；`setTaskId()` 只影响之后的交付。'
          )
        },
        abort: {
          summary: t(
            'Removes this registration so later publishes no longer call the listener; the current call continues.',
            '移除这条登记，之后的发布不再调用该 listener；本次调用照常执行完。'
          ),
          params: {
            reason: t(
              'Optional reason stored in `abortReason`.',
              '可选原因，保存在 `abortReason` 中。'
            )
          },
          returns: t('Nothing; `aborted` becomes `true`.', '无返回值；之后 `aborted` 为 `true`。')
        },
        setTaskId: {
          summary: t(
            'Renames the registration for later snapshots; the snapshot being delivered is not affected.',
            '修改登记的任务名，只影响之后的快照，正在交付的这一轮不受影响。'
          ),
          params: {
            taskId: t(
              'New name chosen by the listener (it replaces the name set at `subscribe(listener, { taskId })`), or `undefined` to remove it.',
              '由 listener 自己指定的新任务名，替换订阅时 `subscribe(listener, { taskId })` 给出的名称；传 `undefined` 表示去掉名称。'
            )
          },
          returns: t('Nothing.', '无返回值；新名称从下一次发布开始生效。')
        }
      }
    },
    IEventListener: {
      summary: t(
        'A context listener function: receives the event context and may return a result or a Promise. Used when delivery is omitted or `EventDelivery.context`.',
        '上下文 listener 函数：接收事件上下文，可以返回结果或 Promise；省略 delivery 或指定 `EventDelivery.context` 时使用。'
      ),
      members: {}
    },
    IEventSubscriber: {
      summary: t(
        'Object form of a listener for `subscribeSubscriber`: `handle(event)` is called with `this` bound to the object.',
        '`subscribeSubscriber` 使用的对象形式 listener：以对象自身为 `this` 调用 `handle(event)`。'
      ),
      members: {
        handle: {
          summary: t(
            'Called once per delivery with `this` bound to the subscriber object.',
            '每次交付调用一次，`this` 指向订阅对象本身，可以读写实例状态。'
          ),
          params: { event: t('The event context of this delivery.', '本次交付的事件上下文。') },
          returns: t('The listener result, or a Promise of it.', 'listener 结果，或其 Promise。')
        }
      }
    },
    IUnsubscribe: {
      summary: t(
        'A function that removes a registration; calling it more than once is safe.',
        '移除登记的函数，可以安全地重复调用。'
      ),
      members: {}
    }
  },
  enums: {
    EventDelivery: {
      summary: t(
        'Listener argument selected per registration by the delivery option of channels, Hub subscriptions, chains and naming aliases.',
        '由通道、Hub 订阅、订阅链与命名别名的每条登记 delivery 选项选择的监听者参数。'
      ),
      values: {
        context: t(
          'Default (`context`). Receives the event context with the original payload, live abort controls, task label and configured alias.',
          '默认值（`context`）。接收事件上下文，保留原始 payload、实时取消控制、任务标签与配置的别名。'
        ),
        value: t(
          '`value`: receives the original payload directly, preserving identity without adding context members. Keep default context when controls are needed. Channel taskId filtering still applies to the registration.',
          '`value`：直接接收原始 payload，保持身份且不附加上下文成员。需要控制方法时保留默认 context。通道 taskId 过滤仍作用于该登记。'
        )
      }
    },
    EventAdmissionPolicy: {
      summary: t(
        'Used by the `admissionPolicy` option of `createEventChannel()`.',
        '用于 `createEventChannel()` 的 `admissionPolicy` 选项，决定重复订阅同一函数时是否合并登记。'
      ),
      values: {
        multiple: t(
          'Default. Every `subscribe()` creates its own registration, even for the same function; each handle removes only its own one.',
          '默认值。每次 `subscribe()` 都建立独立登记，同一个函数订阅两次会被调用两次；每个句柄只移除自己那一条。'
        ),
        unique: t(
          'One function keeps at most one registration per channel. Subscribing it again returns a handle bound to the existing registration; the `taskId` and delivery must then be the same, otherwise `INVALID_OPTIONS` is thrown. Omitted delivery equals explicit context. Only the first of several such handles removes it.',
          '同一个函数在一个 channel 中最多保留一条登记。再次订阅时返回绑定到已有登记的句柄，此时 `taskId` 与 delivery 必须相同，否则抛 `INVALID_OPTIONS`；省略 delivery 与显式 context 相同。多个这样的句柄中，只有第一次调用会真正移除。'
        )
      }
    },
    EventApiStyle: {
      summary: t(
        'Used by the `style` option of channels and hubs.',
        '用于通道与事件中心的 `style` 选项，决定公开方法的命名别名。'
      ),
      values: {
        subscribePublish: t(
          '`subscribe-publish`: default names, no aliases.',
          '`subscribe-publish`：保持默认订阅发布名称，不增加其他命名别名。'
        ),
        onEmit: t(
          '`on-emit`: adds `on` / `emit`, and `off` on handles.',
          '`on-emit`：增加订阅发布别名 `on` / `emit`，句柄增加取消别名 `off`。'
        ),
        onTrigger: t(
          '`on-trigger`: adds `on` / `trigger`, and `off` on handles.',
          '`on-trigger`：增加订阅发布别名 `on` / `trigger`，句柄增加取消别名 `off`。'
        ),
        listenFire: t(
          '`listen-fire`: adds `listen` / `fire`, and `unlisten` on handles.',
          '`listen-fire`：增加订阅发布别名 `listen` / `fire`，句柄增加取消别名 `unlisten`。'
        )
      }
    },
    EventDispatchPolicy: {
      summary: t(
        'Used by the `dispatchPolicy` option of `createEventChannel()`.',
        '用于 `createEventChannel()` 的 `dispatchPolicy` 选项，决定发布过程中再次发布的值何时交付。'
      ),
      values: {
        recursive: t(
          'Default. A `publish()` made inside a listener is delivered immediately (depth first), then the outer delivery continues.',
          '默认值。listener 内部的 `publish()` 立即交付（深度优先），完成后再继续外层的交付。'
        ),
        queued: t(
          'A `publish()` made inside a listener is queued and delivered after the current snapshot has finished, so every listener sees values in publish order.',
          'listener 内部的 `publish()` 先排队，等当前快照全部交付完再交付，因此每个 listener 都按发布顺序看到值。'
        )
      }
    },
    EventRemovalPolicy: {
      summary: t(
        'Used by the `removalPolicy` option of `createEventChannel()`.',
        '用于 `createEventChannel()` 的 `removalPolicy` 选项，决定调用一个句柄时移除多少条登记。'
      ),
      values: {
        handle: t(
          'Default (`handle`). Calling a handle removes only the registration that handle created.',
          '默认值（`handle`）。调用句柄只移除该句柄建立的那一条登记。'
        ),
        listenerAll: t(
          '`listener-all`: calling a handle removes every registration of the same listener function in the channel; use it only for callers that remove by function.',
          '`listener-all`：调用句柄会移除该 channel 中同一 listener 函数的所有登记；只在调用方按函数整体移除时使用。'
        )
      }
    },
    EventSubscriberErrorCode: {
      summary: t(
        'Codes on errors thrown or reported by this package (`error.code`).',
        '本包抛出或上报的错误上的 `error.code`。'
      ),
      values: {
        invalidListener: t(
          '`INVALID_LISTENER`: a listener is not a function. Reporter validation uses `INVALID_REPORTER`.',
          '`INVALID_LISTENER`：监听者不是函数。上报器校验使用 `INVALID_REPORTER`。'
        ),
        invalidReporter: t(
          '`INVALID_REPORTER`: `report` or `terminalReport` is not a function. Pass a function or omit it.',
          '`INVALID_REPORTER`：`report` 或 `terminalReport` 不是函数。请传入函数或省略。'
        ),
        invalidChannel: t(
          '`INVALID_CHANNEL`: an `invoke*` function received an object that is not a channel from `createEventChannel()` (or comes from another package copy).',
          '`INVALID_CHANNEL`：`invoke*` 收到的不是 `createEventChannel()` 创建的 channel（或来自另一份包副本）。'
        ),
        invalidSignal: t(
          '`INVALID_SIGNAL`: the value passed as signal is not a valid AbortSignal. Pass a real signal.',
          '`INVALID_SIGNAL`：作为信号传入的值不是有效的 AbortSignal。请传入真正的信号。'
        ),
        aborted: t(
          '`ABORTED`: `subscribeUntil` got an already-aborted signal on a channel with `throwOnAborted: true`.',
          '`ABORTED`：在设置了 `throwOnAborted: true` 的 channel 上，`subscribeUntil` 收到了已取消的信号。'
        ),
        invalidSubscriber: t(
          '`INVALID_SUBSCRIBER`: the object passed to `subscribeSubscriber` has no callable `handle`.',
          '`INVALID_SUBSCRIBER`：传给 `subscribeSubscriber` 的对象没有可调用的 `handle`。'
        ),
        invalidEventKey: t(
          '`INVALID_EVENT_KEY`: a hub event name is not a string, number or symbol.',
          '`INVALID_EVENT_KEY`：hub 的事件名不是字符串、数字或 symbol。'
        ),
        taskNotFound: t(
          '`TASK_NOT_FOUND`: `invokeTask` found no registration with that taskId. Check the name or the registration lifetime.',
          '`TASK_NOT_FOUND`：`invokeTask` 找不到该 `taskId` 的登记。请检查名称或登记是否已被移除。'
        ),
        taskNotUnique: t(
          '`TASK_NOT_UNIQUE`: `invokeTask` found several registrations with that taskId; the error has `taskId` and `matchCount`.',
          '`TASK_NOT_UNIQUE`：`invokeTask` 找到多条同名登记，错误上带 `taskId` 和 `matchCount`。请让任务名唯一。'
        ),
        invalidTaskId: t(
          '`INVALID_TASK_ID`: a taskId is empty or not a string.',
          '`INVALID_TASK_ID`：`taskId` 为空字符串或不是字符串。'
        ),
        invalidOptions: t(
          '`INVALID_OPTIONS`: an options object or one of its fields is malformed.',
          '`INVALID_OPTIONS`：选项对象或其中某个字段不合法，例如未知的策略值。'
        ),
        publishFailed: t(
          '`PUBLISH_FAILED`: listeners failed, or the publish budget left snapshot targets or queued values undelivered. Budget details carry processed calls and remaining call budget.',
          '`PUBLISH_FAILED`：监听者失败，或发布预算耗尽后仍有快照目标或排队值未交付。预算详情记录已处理调用数与剩余调用预算。'
        ),
        visitorFailed: t(
          '`VISITOR_FAILED`: a snapshot/live visitor threw or rejected. Native errors keep identity when annotatable; conflicting, immutable or primitive failures, including undefined, remain on cause after invocations close.',
          '`VISITOR_FAILED`：快照或实时访问回调抛错或拒绝。可附码原生错误保留身份；冲突、不可修改或原始值失败（含空缺值）在调用关闭后保留于原因。'
        ),
        valueProjectionFailed: t(
          '`VALUE_PROJECTION_FAILED`: the `valueConfig` path was missing, blocked or threw; reported, the listener still runs.',
          '`VALUE_PROJECTION_FAILED`：`valueConfig` 的路径不存在、中途不是对象或读取抛错；只上报，listener 照常执行。'
        ),
        unhandledListenerFailure: t(
          '`UNHANDLED_LISTENER_FAILURE`: a late listener failure reached terminal diagnostics because `report` was missing or failed.',
          '`UNHANDLED_LISTENER_FAILURE`：迟到的 listener 失败因 `report` 未设置或自身失败，进入了最终诊断。'
        ),
        subscriptionClosed: t(
          '`SUBSCRIPTION_CLOSED`: `handle.subscribe(...)` was called on a released handle.',
          '`SUBSCRIPTION_CLOSED`：在已释放的句柄上调用了 `handle.subscribe(...)`。'
        ),
        subscriptionHandleProjectionFailed: t(
          '`SUBSCRIPTION_HANDLE_PROJECTION_FAILED`: building the alias methods of a handle failed; the registration is rolled back.',
          '`SUBSCRIPTION_HANDLE_PROJECTION_FAILED`：为句柄生成别名方法失败；这次登记会被撤销，原错误作为主要原因保留。'
        ),
        invocationClosed: t(
          '`INVOCATION_CLOSED`: an invocation was called twice or after its visitor finished.',
          '`INVOCATION_CLOSED`：调用对象被调用了两次，或在回调结束后被调用。'
        ),
        subscriptionDisposeFailed: t(
          '`SUBSCRIPTION_DISPOSE_FAILED`: releasing a chain ran every disposer and more than one failed; the failures are in `errors` in run order.',
          '`SUBSCRIPTION_DISPOSE_FAILED`：释放一条链时执行了全部清理，其中多于一个失败；各失败按执行顺序保存在 `errors` 中。'
        )
      }
    },
    EventSubscriberState: {
      summary: t('Status strings of results.', '结果中使用的状态字符串。'),
      values: {
        abort: t(
          '`abort`: the event name used when subscribing to an abort signal; it is not a registration state.',
          '`abort`：订阅中止信号所用的事件名，不是登记状态。'
        ),
        fulfilled: t(
          '`fulfilled`: the listener succeeded; the result has `value`.',
          '`fulfilled`：listener 成功完成，结果对象带有 `value`。'
        ),
        rejected: t(
          '`rejected`: the listener failed; the result has `reason`.',
          '`rejected`：listener 抛错或返回的 Promise 被拒绝，结果对象带有 `reason`。'
        )
      }
    }
  },
  enhancers: {}
}
