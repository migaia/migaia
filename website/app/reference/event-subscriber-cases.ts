import type { ICaseDoc, IText } from './contract.js'

/** Keeps each task, runnable fix, and observable result in both documentation languages. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** Examples use the package entry and keep notification delivery separate from awaited invocation. */
export const eventSubscriberCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
  createEventChannel: [
    {
      title: t(
        'Deliver nested notifications after the current round',
        '让嵌套通知等当前这一轮交付完成'
      ),
      problem: t(
        'An update listener publishes another update before the other listeners see the first, so a screen can display the newer event and then be overwritten by the older one.\n\nA handwritten dispatcher commonly calls listeners recursively as soon as a nested event arrives. The nested loop reaches later listeners before the outer loop resumes, interleaving the two rounds.\n\nCreate the channel with `dispatchPolicy: EventDispatchPolicy.queued`. It finishes the current registration snapshot before delivering the nested value; both rounds complete within the same synchronous `publish` call.',
        '处理更新的监听者又发布了一次更新，其余监听者还没有收到第一条，页面可能先显示新事件，又被旧事件覆盖。\n\n手写分发器通常在收到嵌套事件时立即递归调用监听者。内层循环先走到后面的接收者，外层循环随后才继续，两轮交付因此交错。\n\n创建通道时传入 `dispatchPolicy: EventDispatchPolicy.queued`，启用排队交付。它先完成当前登记快照，再交付嵌套值；两轮都在同一次同步 `publish` 调用内完成。'
      ),
      example: {
        en: "import { createEventChannel, EventDispatchPolicy } from '@migaia/event-subscriber'\n\nconst updates = createEventChannel<number>({ dispatchPolicy: EventDispatchPolicy.queued })\nupdates.subscribe(({ value }) => {\n  console.log('record:', value)\n  if (value === 1) updates.publish(2)\n})\nupdates.subscribe(({ value }) => { console.log('render:', value) })\nupdates.publish(1)\nupdates.clear()",
        zh: "import { createEventChannel, EventDispatchPolicy } from '@migaia/event-subscriber'\n\nconst updates = createEventChannel<number>({ dispatchPolicy: EventDispatchPolicy.queued })\nupdates.subscribe(({ value }) => {\n  console.log('记录:', value)\n  if (value === 1) updates.publish(2)\n})\nupdates.subscribe(({ value }) => { console.log('展示:', value) })\nupdates.publish(1)\nupdates.clear()"
      },
      result: t(
        'Prints `record: 1`, `render: 1`, `record: 2`, then `render: 2`.\n\nThe nested event does not interrupt the current round. The default policy is `recursive`; select `queued` explicitly when this ordering is required. Delivery still shares the configured `publishBudget`, so exhausting that budget can stop delivery before all queued work runs.',
        '依次输出 `记录: 1`、`展示: 1`、`记录: 2`、`展示: 2`。\n\n嵌套事件没有插入当前这一轮。默认策略是 `recursive`，需要这种顺序时应显式选择 `queued`。交付仍受配置的 `publishBudget` 约束，耗尽预算可能在全部排队工作执行前停止交付。'
      )
    },
    {
      title: t(
        'Change subscriptions without changing the current delivery',
        '修改订阅时不打乱当前交付'
      ),
      problem: t(
        'A listener removes another subscription and installs a new listener during event delivery, and recipients unexpectedly miss or gain the current event.\n\nWalking the mutable callback array directly makes delivery depend on array changes made by earlier callbacks. Removal can shift the next entry, while an appended callback can enter a round that began before it subscribed.\n\nUse the channel’s `publish()` method, which captures one registration snapshot before invoking listeners. Subscription changes affect later publishes; the current snapshot retains its registration order.',
        '交付事件时，一个监听者移除另一条订阅，又登记新的监听者，接收者却意外漏收或多收了当前事件。\n\n直接遍历可变回调数组，会让交付结果取决于前面回调对数组的修改。移除可能让下一项移位，追加又可能让新监听者进入它订阅前就开始的这一轮。\n\n使用通道的 `publish()`，它在调用监听者前捕获一份登记快照。订阅增删作用于后续发布，当前快照保持原有登记顺序。'
      ),
      example: {
        en: "import { createEventChannel } from '@migaia/event-subscriber'\n\nconst updates = createEventChannel<number>()\nconst calls: string[] = []\nlet stopSecond = () => {}\nupdates.subscribe(({ value }) => {\n  calls.push(`first ${value}`)\n  if (value === 1) {\n    stopSecond()\n    updates.subscribe(({ value }) => { calls.push(`added ${value}`) })\n  }\n})\nstopSecond = updates.subscribe(({ value }) => { calls.push(`second ${value}`) })\nupdates.publish(1)\nupdates.publish(2)\nconsole.log(calls.join(' | '))\nupdates.clear()",
        zh: "import { createEventChannel } from '@migaia/event-subscriber'\n\nconst updates = createEventChannel<number>()\nconst calls: string[] = []\nlet stopSecond = () => {}\nupdates.subscribe(({ value }) => {\n  calls.push(`首位 ${value}`)\n  if (value === 1) {\n    stopSecond()\n    updates.subscribe(({ value }) => { calls.push(`新增 ${value}`) })\n  }\n})\nstopSecond = updates.subscribe(({ value }) => { calls.push(`次位 ${value}`) })\nupdates.publish(1)\nupdates.publish(2)\nconsole.log(calls.join(' | '))\nupdates.clear()"
      },
      result: t(
        'Prints `first 1 | second 1 | first 2 | added 2`.\n\nRemoving the second registration does not remove it from the first snapshot; the new registration first runs on the second `publish`. Unsubscribing changes future recipient lists rather than cancelling a listener already captured for the current round.',
        '输出 `首位 1 | 次位 1 | 首位 2 | 新增 2`。\n\n退订没有让次位监听者漏掉第一轮，新登记从第二次发布才开始收到事件。退订修改的是后续接收名单，不会取消当前这一轮已经捕获的监听者。'
      )
    }
  ],
  createEventHub: [
    {
      title: t(
        'Release a page subscription across several event names',
        '离开页面时一起退订多个事件'
      ),
      problem: t(
        'A page listens for save and close events, but after navigation the old page still receives one of them.\n\nSeparate unsubscribe variables make cleanup depend on remembering every event name. A later registration can be omitted from the page’s cleanup even though the original registrations are released correctly.\n\nCreate a typed event hub and chain the page’s `subscribe()` calls. Each event retains its payload type, and the returned chain handle releases the registrations in that chain in reverse order.',
        '页面同时监听保存和关闭事件，离开后旧页面却仍然收到其中一种事件。\n\n分别保存退订函数，需要清理代码记住每一个事件名。之后新增的登记容易漏进清理列表，即使原有登记都已正确释放，仍会残留订阅。\n\n创建带事件映射类型的 hub，并把页面的 `subscribe()` 调用串在同一条链上。各事件保留自己的参数类型，返回的链句柄按相反顺序释放该链上的登记。'
      ),
      example: {
        en: "import { createEventHub } from '@migaia/event-subscriber'\n\ntype IAppEvents = { saved: { id: string }; closed: string }\nconst events = createEventHub<IAppEvents>()\nconst page = events\n  .subscribe('saved', ({ value }) => { console.log('saved:', value.id) })\n  .subscribe('closed', ({ value }) => { console.log('closed:', value) })\nevents.publish('saved', { id: 'order-1' })\nevents.publish('closed', 'details')\npage()\nevents.publish('saved', { id: 'order-2' })\nconsole.log('subscriptions left:', events.size())",
        zh: "import { createEventHub } from '@migaia/event-subscriber'\n\ntype IAppEvents = { saved: { id: string }; closed: string }\nconst events = createEventHub<IAppEvents>()\nconst page = events\n  .subscribe('saved', ({ value }) => { console.log('已保存:', value.id) })\n  .subscribe('closed', ({ value }) => { console.log('已关闭:', value) })\nevents.publish('saved', { id: 'order-1' })\nevents.publish('closed', '详情页')\npage()\nevents.publish('saved', { id: 'order-2' })\nconsole.log('剩余订阅:', events.size())"
      },
      result: t(
        'Prints `saved: order-1`, `closed: details`, then `subscriptions left: 0`; the publish after page cleanup prints nothing.\n\nOne handle removes both registrations in this chain. It releases those subscriptions rather than closing the hub, so a later page can create its own registrations.',
        '依次输出 `已保存: order-1`、`已关闭: 详情页`、`剩余订阅: 0`，页面清理后的发布没有输出。\n\n一个句柄移除了这条链上的两项登记。它释放这些订阅，不会关闭 hub，后续页面仍可建立自己的登记。'
      )
    }
  ],
  subscribeUntil: [
    {
      title: t('Stop page updates with its cancellation signal', '页面取消后不再接收更新'),
      problem: t(
        'A component cancels the operations under its `AbortController` when navigating away, but its event subscription keeps updating the departed page.\n\nHandwritten abort wiring has two cleanup paths: remove the event registration and detach the abort listener. Forgetting either path leaves work alive, while manual cleanup must also cooperate with a later abort.\n\nImport `subscribeUntil` from the `/subscriber` entry and pass the channel, page signal and listener. It ties the registration to that signal and returns an idempotent manual unsubscribe for earlier cleanup.',
        '组件离开时取消了 `AbortController` 管理的操作，事件订阅却仍在更新已经离开的页面。\n\n手写取消接线有两条清理路径：退订事件登记，移除取消监听。漏掉任何一条都会留下工作，手动提前清理还必须能与之后的取消配合。\n\n从 `/subscriber` 子入口导入 `subscribeUntil`，传入通道、页面信号和监听者。它把登记绑定到信号，并返回可重复调用的手动退订函数，供提前清理。'
      ),
      example: {
        en: "import { createEventChannel } from '@migaia/event-subscriber'\nimport { subscribeUntil } from '@migaia/event-subscriber/subscriber'\n\nconst updates = createEventChannel<string>()\nconst page = new AbortController()\nconst stop = subscribeUntil(updates, page.signal, ({ value }) => { console.log('render:', value) })\nupdates.publish('saved')\npage.abort()\nupdates.publish('not shown')\nstop()\nconsole.log('subscriptions left:', updates.size)",
        zh: "import { createEventChannel } from '@migaia/event-subscriber'\nimport { subscribeUntil } from '@migaia/event-subscriber/subscriber'\n\nconst updates = createEventChannel<string>()\nconst page = new AbortController()\nconst stop = subscribeUntil(updates, page.signal, ({ value }) => { console.log('展示:', value) })\nupdates.publish('已保存')\npage.abort()\nupdates.publish('不会显示')\nstop()\nconsole.log('剩余订阅:', updates.size)"
      },
      result: t(
        'Prints `render: saved`, then `subscriptions left: 0`; publishing after abort prints nothing.\n\nAborting removes future deliveries, and calling `stop` afterwards is harmless. An already-running listener is not interrupted. An already-aborted signal registers nothing by default; `throwOnAborted: true` instead requests an abort error during subscription.',
        '输出 `展示: 已保存`，然后是 `剩余订阅: 0`，取消后发布的值没有输出。\n\n取消移除了后续交付，之后再调用 `stop` 没有副作用。已经执行中的监听者不会被打断。传入已取消的信号时默认不建立登记，`throwOnAborted: true` 则要求在订阅时抛出取消错误。'
      )
    }
  ],
  invokeParallelSettled: [
    {
      title: t(
        'Keep successful results when another listener fails',
        '一个监听者失败时仍保留其他结果'
      ),
      problem: t(
        'An export asks several handlers for results, but one failure leaves the caller without the data returned successfully by other handlers.\n\nA caller that handles only the rejection of a combined Promise receives the overall failure instead of an array containing the successful replies. Completion order can also differ from registration order.\n\nCall `invokeParallelSettled(channel, value)` to start the captured listeners immediately and await every outcome. The returned array follows registration order and carries either the listener’s value or its original failure reason.',
        '导出操作同时向多个处理者索取结果，一个处理者失败后，调用方却连其他处理者成功返回的数据也拿不到。\n\n只处理组合 Promise 的整体拒绝，拿到的是失败，而不是包含各个成功回复的数组。异步完成顺序也可能与监听者登记顺序不同。\n\n调用 `invokeParallelSettled(channel, value)`，立即启动捕获的监听者并等待每个结果。返回数组按登记顺序排列，每项分别保留监听者的成功值或原始失败原因。'
      ),
      example: {
        en: "import { createEventChannel, invokeParallelSettled, EventSubscriberState } from '@migaia/event-subscriber'\n\nconst checks = createEventChannel<number, number>()\nchecks.subscribe(async ({ value }) => {\n  await Promise.resolve()\n  return value * 2\n})\nchecks.subscribe(() => { throw new Error('remote unavailable') })\nconst results = await invokeParallelSettled(checks, 3)\nfor (const result of results) {\n  if (result.status === EventSubscriberState.fulfilled) console.log('success:', result.value)\n  else console.log('failure:', (result.reason as Error).message)\n}\nchecks.clear()",
        zh: "import { createEventChannel, invokeParallelSettled, EventSubscriberState } from '@migaia/event-subscriber'\n\nconst checks = createEventChannel<number, number>()\nchecks.subscribe(async ({ value }) => {\n  await Promise.resolve()\n  return value * 2\n})\nchecks.subscribe(() => { throw new Error('远端暂不可用') })\nconst results = await invokeParallelSettled(checks, 3)\nfor (const result of results) {\n  if (result.status === EventSubscriberState.fulfilled) console.log('成功:', result.value)\n  else console.log('失败:', (result.reason as Error).message)\n}\nchecks.clear()"
      },
      result: t(
        'Prints `success: 6`, then `failure: remote unavailable`.\n\nThe second listener fails before the first resumes after its microtask, but the result array follows registration order and retains the successful value. This collects listener failures; an invalid `channel` still throws synchronously during admission.',
        '输出 `成功: 6`，然后是 `失败: 远端暂不可用`。\n\n第二个监听者在第一个监听者恢复微任务前失败，但结果数组仍按登记顺序排列，成功值没有丢失。它收集的是监听者失败，非法 `channel` 仍会在接纳时同步抛错。'
      )
    }
  ],
  invokeSerial: [
    {
      title: t('Wait for one handler before starting the next', '前一个处理者结束后再运行下一个'),
      problem: t(
        'A notification starts before a preceding asynchronous write finishes, so its reader can observe data that has not been saved yet.\n\nCalling `publish()` invokes listeners without waiting for their returned Promises. Merely registering the write listener first therefore does not make its async work finish before the notification listener starts.\n\nUse `invokeSerial(channel, value)` to await each captured listener before starting the next. Every listener receives the same input, not the previous result; the logs below stand in for a write and a notification.',
        '前一个异步写入尚未完成，通知就开始发送，接收通知的一方可能读到还没保存的数据。\n\n`publish()` 调用监听者时，不会等待它们返回的 Promise。即使先登记写入监听者，也不代表它的异步工作会在通知监听者启动前完成。\n\n用 `invokeSerial(channel, value)` 等待每个捕获的监听者结束，再启动下一个。它们都收到同一个输入，不接收前一个的返回值；下面用日志模拟写入和通知。'
      ),
      example: {
        en: "import { createEventChannel, invokeSerial } from '@migaia/event-subscriber'\n\nconst steps = createEventChannel<string, string>()\nsteps.subscribe(async ({ value }) => {\n  console.log('write:', value)\n  await Promise.resolve()\n  console.log('write complete')\n  return 'written'\n})\nsteps.subscribe(({ value }) => {\n  console.log('notify:', value)\n  return 'notified'\n})\nconsole.log('results:', (await invokeSerial(steps, 'order-1')).join(','))\nsteps.clear()",
        zh: "import { createEventChannel, invokeSerial } from '@migaia/event-subscriber'\n\nconst steps = createEventChannel<string, string>()\nsteps.subscribe(async ({ value }) => {\n  console.log('写入:', value)\n  await Promise.resolve()\n  console.log('写入完成')\n  return '已写入'\n})\nsteps.subscribe(({ value }) => {\n  console.log('通知:', value)\n  return '已通知'\n})\nconsole.log('结果:', (await invokeSerial(steps, 'order-1')).join(','))\nsteps.clear()"
      },
      result: t(
        'Prints `write: order-1`, `write complete`, `notify: order-1`, then `results: written,notified`.\n\nThe notification starts after the write listener finishes, and both receive `order-1`. This controls order without providing a transaction: a failed listener does not skip later listeners; failures are aggregated after all have run.',
        '依次输出 `写入: order-1`、`写入完成`、`通知: order-1`、`结果: 已写入,已通知`。\n\n通知在写入监听者结束后启动，两者都收到 `order-1`。这只控制顺序，不提供事务：某个监听者失败不会跳过后续监听者，全部执行后才汇总失败。'
      )
    }
  ],
  invokeTask: [
    {
      title: t(
        'Reject duplicate command targets before doing any work',
        '执行前拒绝重复登记的命令目标'
      ),
      problem: t(
        'A save command should run one handler, but a component mounts twice and one command now performs two writes.\n\nA handwritten loop invokes every matching name, so duplicate registration becomes duplicate work. Selecting the first match hides the duplicate instead of reporting the ambiguous command target.\n\nRegister a `taskId` and call `invokeTask(channel, taskId, value)`. It selects exactly one matching registration before invoking any listener and rejects missing or duplicate matches without running a handler for that attempt.',
        '保存命令本来只应调用一个处理者，组件重复挂载后，一次命令却执行了两次写入。\n\n手写循环会调用所有同名处理者，把重复登记变成重复工作；只取第一项又会隐藏重复登记，没有报告命令目标不唯一。\n\n登记时提供 `taskId`，再调用 `invokeTask(channel, taskId, value)`。它在执行任何监听者之前选择唯一匹配，缺失或重复时直接拒绝，此次不会运行处理者。'
      ),
      example: {
        en: "import { createEventChannel, invokeTask, type IEventContext } from '@migaia/event-subscriber'\n\nconst tasks = createEventChannel<number, number>()\nlet calls = 0\nconst save = ({ value }: IEventContext<number>) => { calls += 1; return value + 1 }\ntasks.subscribe(save, { taskId: 'save' })\ntasks.subscribe(({ value }) => value * 10, { taskId: 'preview' })\nconsole.log('save result:', await invokeTask(tasks, 'save', 2))\ntasks.subscribe(save, { taskId: 'save' })\ntry {\n  await invokeTask(tasks, 'save', 2)\n} catch (error) {\n  console.log('duplicate target:', (error as Error & { code?: string }).code)\n}\nconsole.log('save calls:', calls)\ntasks.clear()",
        zh: "import { createEventChannel, invokeTask, type IEventContext } from '@migaia/event-subscriber'\n\nconst tasks = createEventChannel<number, number>()\nlet calls = 0\nconst save = ({ value }: IEventContext<number>) => { calls += 1; return value + 1 }\ntasks.subscribe(save, { taskId: 'save' })\ntasks.subscribe(({ value }) => value * 10, { taskId: 'preview' })\nconsole.log('保存结果:', await invokeTask(tasks, 'save', 2))\ntasks.subscribe(save, { taskId: 'save' })\ntry {\n  await invokeTask(tasks, 'save', 2)\n} catch (error) {\n  console.log('重复目标:', (error as Error & { code?: string }).code)\n}\nconsole.log('保存调用次数:', calls)\ntasks.clear()"
      },
      result: t(
        'Prints `save result: 3`, `duplicate target: TASK_NOT_UNIQUE`, then `save calls: 1`.\n\nThe ambiguous second attempt performs no extra save, and other task names are not invoked. Missing matches throw `TASK_NOT_FOUND` and duplicate matches throw `TASK_NOT_UNIQUE` synchronously; a selected listener failure instead rejects with `PUBLISH_FAILED` while retaining its original error.',
        '依次输出 `保存结果: 3`、`重复目标: TASK_NOT_UNIQUE`、`保存调用次数: 1`。\n\n第二次选择不唯一时没有再次保存，其他任务名也不会被执行。缺失匹配同步抛 `TASK_NOT_FOUND`，重复匹配同步抛 `TASK_NOT_UNIQUE`；被选中的监听者失败时则以 `PUBLISH_FAILED` 拒绝，并保留原始错误。'
      )
    }
  ]
}
