import type { ICaseDoc, IText } from './contract.js'

/** Builds one bilingual text. */
const t = (en: string, zh: string): IText => ({ en, zh })

/**
 * Problems the reactive Runtime solves, each told as a situation, a runnable fix and the observed
 * output. Every example was run with Node 24 against the built package and its printed output is
 * quoted in `result`.
 */
export const reactiveCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
  createRuntime: [
    {
      title: t(
        'Keep derived values in sync without manual updates',
        '派生值自动更新，不用手动同步'
      ),
      problem: t(
        "A cart total is kept in its own variable, and whenever the price or quantity changes the page should show the new total.\n\nHand-written code has to recalculate the total in every place that changes price or quantity; miss one and the page shows a stale total, because the dependency exists only in the developer's head.\n\nWith a Runtime, `computed` declares the total once from the values it reads, and an `effect` that reads it reruns when any of them changes. Nobody has to list the dependencies: reading `price.value` inside the function is enough.",
        '把购物车合计单独存在一个变量里，单价或数量一变，页面就该显示新的合计。\n\n手写时每个修改单价或数量的地方都得记得重新计算合计，漏掉一处页面就显示旧值；依赖关系只存在于开发者的记忆里。\n\n用 Runtime 时，`computed` 只需根据它读到的值把合计声明一次；读取它的 `effect` 会在任一依赖变化后重跑。不需要列出依赖：在函数里读了 `price.value`，就自动依赖它。'
      ),
      example: {
        en: `import { createRuntime } from '@migaia/reactive'

const runtime = createRuntime()
const price = runtime.signal(30)
const quantity = runtime.signal(2)
// The total is derived from price and quantity; no code that changes them has to update it
const total = runtime.computed(() => price.value * quantity.value)

const render = runtime.effect(() => {
  console.log(\`cart total: \${total.value}\`)
})

quantity.value = 3 // change the quantity
runtime.flush() // flushed by hand here; normally a microtask does it
price.value = 25 // change the price
runtime.flush()

render.dispose()
total.dispose()`,
        zh: `import { createRuntime } from '@migaia/reactive'

const runtime = createRuntime()
const price = runtime.signal(30)
const quantity = runtime.signal(2)
// 合计由单价和数量推导出来，不需要在每个修改的地方手动更新
const total = runtime.computed(() => price.value * quantity.value)

const render = runtime.effect(() => {
  console.log(\`购物车合计：\${total.value} 元\`)
})

quantity.value = 3 // 改数量
runtime.flush() // 示例里手动冲刷；平时由微任务自动完成
price.value = 25 // 改单价
runtime.flush()

render.dispose()
total.dispose()`
      },
      result: t(
        'Prints `cart total: 60`, then `90` after the quantity changes and `75` after the price changes.\n\nThe effect ran on creation and once per change; `runtime.flush()` only makes the timing explicit, and without it the default microtask flush gives the same output.',
        '先输出 `购物车合计：60 元`，改数量后输出 `90 元`，改单价后输出 `75 元`。\n\n副作用在创建时运行一次，之后每次变化运行一次；`runtime.flush()` 只是让时机更明确，不写它时默认的微任务冲刷也得到同样的输出。'
      )
    },
    {
      title: t('Clean up the old subscription before switching', '切换订阅时先清理旧的'),
      problem: t(
        'A chat window joins a new room whenever the room changes but never leaves the old one, and ends up receiving messages from every room it ever visited.\n\nWith hand-written subscriptions, "leave" has to be written in every branch that switches rooms and again when the window closes; missing any one of them keeps an old subscription alive.\n\nAn `effect` may return a cleanup function. The Runtime calls it before the effect runs again and when the effect is disposed, so "leave" always runs before the next "join".',
        '聊天窗口每次切换房间都加入新房间，却从不离开旧房间，最后会收到所有去过的房间的消息。\n\n手写订阅时，“离开”要写在切换房间的每个分支里，还要记得在关闭窗口时再写一次；漏掉任何一处，旧订阅就一直留着。\n\n`effect` 可以返回一个清理函数，Runtime 会在副作用重跑之前、以及 `dispose()` 时调用它，所以“离开”总是先于下一次“进入”。'
      ),
      example: {
        en: `import { createRuntime } from '@migaia/reactive'

const runtime = createRuntime()
const room = runtime.signal('lobby')

const chat = runtime.effect(() => {
  const name = room.value
  console.log(\`join \${name}\`)
  // The returned function runs before the next rerun and on dispose()
  return () => console.log(\`leave \${name}\`)
})

room.value = 'engineering'
runtime.flush()
chat.dispose() // the user closes the chat window`,
        zh: `import { createRuntime } from '@migaia/reactive'

const runtime = createRuntime()
const room = runtime.signal('大厅')

const chat = runtime.effect(() => {
  const name = room.value
  console.log(\`进入 \${name}\`)
  // 返回的函数会在下次重跑之前、以及 dispose() 时执行
  return () => console.log(\`离开 \${name}\`)
})

room.value = '技术交流'
runtime.flush()
chat.dispose() // 用户关闭聊天窗口`
      },
      result: t(
        "Prints `join lobby`, `leave lobby`, `join engineering`, and `leave engineering` after `dispose()`.\n\nEach cleanup sees the room of its own run, because the closure captured that run's `name`.",
        '依次输出 `进入 大厅`、`离开 大厅`、`进入 技术交流`，`dispose()` 后输出 `离开 技术交流`。\n\n每次清理拿到的都是它那一次运行的房间，因为闭包捕获的是那一次的 `name`。'
      )
    },
    {
      title: t(
        'Several writes in one turn, one effect run, no half-updated values',
        '同一轮的多次写入只触发一次副作用，也看不到一半新一半旧的值'
      ),
      problem: t(
        'Changing first and last name together makes the header show a mixed value such as "Grace Lovelace" before the correct name.\n\nWhen every write notifies listeners at once, a listener runs between the two writes, reads half-updated data, and the page renders one extra time.\n\nA Runtime write only marks downstream nodes stale, and effects run at the next flush (a microtask by default), so writes in the same synchronous code are seen together. Derived values that read the same inputs through several paths (`initials` and `label` both read the name) are recomputed from the final inputs too.',
        '同时改名和姓，页头先显示 “Grace Lovelace” 这种混合值，再显示正确的名字。\n\n如果每次写入都立刻通知监听者，监听者会在两次写入之间运行，读到只改了一半的数据，页面也因此多渲染一次。\n\nRuntime 写入时只把下游标记为过期，副作用在下一次冲刷（默认是微任务）时才运行，所以同一段同步代码里的写入会被一起看到。从多条路径读取同一组值的派生值（`initials` 和 `label` 都读了名字）也按最终输入重新计算。'
      ),
      example: {
        en: `import { createRuntime } from '@migaia/reactive'

const runtime = createRuntime()
const first = runtime.signal('Ada')
const last = runtime.signal('Lovelace')
const initials = runtime.computed(() => \`\${first.value[0]}.\${last.value[0]}.\`)
const label = runtime.computed(() => \`\${first.value} \${last.value} (\${initials.value})\`)

let effectRuns = 0
const header = runtime.effect(() => {
  effectRuns += 1
  console.log('header shows:', label.value)
})

// Two values change in the same synchronous code
first.value = 'Grace'
last.value = 'Hopper'
await Promise.resolve() // wait for the default microtask flush
console.log('the effect ran', effectRuns, 'times')
header.dispose()`,
        zh: `import { createRuntime } from '@migaia/reactive'

const runtime = createRuntime()
const first = runtime.signal('Ada')
const last = runtime.signal('Lovelace')
const initials = runtime.computed(() => \`\${first.value[0]}.\${last.value[0]}.\`)
const label = runtime.computed(() => \`\${first.value} \${last.value}（\${initials.value}）\`)

let effectRuns = 0
const header = runtime.effect(() => {
  effectRuns += 1
  console.log('页头显示:', label.value)
})

// 同一段同步代码里改了两个值
first.value = 'Grace'
last.value = 'Hopper'
await Promise.resolve() // 等默认的微任务冲刷
console.log('副作用一共执行了', effectRuns, '次')
header.dispose()`
      },
      result: t(
        'Prints `header shows: Ada Lovelace (A.L.)` on creation and, after the two writes, a single `Grace Hopper (G.H.)`; `effect ran 2 times`.\n\nNo line ever shows a mixed first and last name: writes in the same turn merged into one effect run.',
        '创建时输出 `页头显示: Ada Lovelace（A.L.）`，两次写入后只输出一次 `Grace Hopper（G.H.）`；`副作用一共执行了 2 次`。\n\n没有任何一行出现名和姓混搭的值：同一轮里的写入合并成一次副作用运行。'
      )
    },
    {
      title: t('Skip work nobody reads', '没人读取的派生值不计算'),
      problem: t(
        'An expensive aggregation sits in a panel that can be collapsed, and it recalculates on every change even while the panel is closed.\n\nHand-written derived values usually recompute right when data is written, whether or not anyone is looking, so a closed panel still costs time.\n\nA `computed` is lazy: it does not run until something reads it. When its last reader (here the effect) is disposed, it disconnects from its inputs, so later writes trigger no recomputation; the next read checks whether its inputs changed and recomputes once if they did.',
        '一个昂贵的统计放在可以收起的面板里，面板关着时，数据每变一次它仍然重算一次。\n\n手写的派生值通常在写入时立刻重算，不管有没有人在看，关着的面板也在消耗时间。\n\n`computed` 是惰性的：没人读取就不运行。最后一个读取者（这里是副作用）被释放后，它会和输入断开，之后的写入不再引发重算；下次读取时先检查输入是否变化，变了才重算一次。'
      ),
      example: {
        en: `import { createRuntime } from '@migaia/reactive'

const runtime = createRuntime()
const orders = runtime.signal([120, 80, 45])
let computations = 0
const report = runtime.computed(() => {
  computations += 1 // pretend this is an expensive aggregation
  return orders.value.reduce((sum, amount) => sum + amount, 0)
})

orders.value = [...orders.peek(), 60] // nobody reads report yet
console.log('computations while unread:', computations)

const panel = runtime.effect(() => console.log('report panel:', report.value))
orders.value = [...orders.peek(), 10]
runtime.flush()
console.log('computations while the panel is open:', computations)

panel.dispose() // the panel closes; its last reader leaves
orders.value = [...orders.peek(), 99]
orders.value = [...orders.peek(), 1]
console.log('computations after closing:', computations)
console.log('read again:', report.value, 'computations:', computations)`,
        zh: `import { createRuntime } from '@migaia/reactive'

const runtime = createRuntime()
const orders = runtime.signal([120, 80, 45])
let computations = 0
const report = runtime.computed(() => {
  computations += 1 // 假设这是一段昂贵的统计
  return orders.value.reduce((sum, amount) => sum + amount, 0)
})

orders.value = [...orders.peek(), 60] // 还没人读取 report
console.log('没人读取时计算次数:', computations)

const panel = runtime.effect(() => console.log('报表面板:', report.value))
orders.value = [...orders.peek(), 10]
runtime.flush()
console.log('面板打开期间计算次数:', computations)

panel.dispose() // 面板关闭，最后一个读者离开
orders.value = [...orders.peek(), 99]
orders.value = [...orders.peek(), 1]
console.log('面板关闭后计算次数:', computations)
console.log('再次读取:', report.value, '计算次数:', computations)`
      },
      result: t(
        '`computations while unread: 0`; while the panel is open each change computes once (2 in total); after closing, two more writes leave the count at 2; reading again returns 415 and the count becomes 3.\n\nComputation happens only when something reads the value; writes after the panel closed trigger none.',
        '`没人读取时计算次数: 0`；面板打开期间每次变化计算一次（共 2 次）；面板关闭后又写入两次，计数仍是 2；再次读取得到 415，计数变为 3。\n\n计算只发生在有人读取的时候，关闭面板后的写入不会触发任何计算。'
      )
    },
    {
      title: t(
        'Two effects feeding each other do not freeze the page',
        '两个副作用互相写入时不会卡死页面'
      ),
      problem: t(
        'Two-way Celsius/Fahrenheit syncing is written with two effects that each write what the other reads; when the values never settle, the tab freezes.\n\nHand-written two-way syncing has no limit on rounds, so the two listeners trigger each other forever, the page stops responding, and nothing tells you which two pieces of code are fighting.\n\nEach flush is capped at `maxFlushPasses` passes (default 100). Past the cap the Runtime stops, drops the remaining queued effects and reports `FLUSH_LOOP` with their `debugName`s: to `onError` for automatic flushes, or as a thrown error from a manual `flush()`.',
        '用两个副作用实现摄氏度和华氏度的双向同步，每个都写对方读取的值；两个值始终对不上时，标签页卡死。\n\n手写的双向同步没有轮数限制，两个监听者会无限互相触发，卡在循环里的页面失去响应，也看不到是哪两段代码在打架。\n\n每次冲刷最多运行 `maxFlushPasses` 轮（默认 100）。超过上限后，Runtime 停止本次冲刷，丢弃剩下排队的副作用，并报告 `FLUSH_LOOP`，附上它们的 `debugName`：自动冲刷交给 `onError`，手动调用 `flush()` 时直接抛出。'
      ),
      example: {
        en: `import { createRuntime } from '@migaia/reactive'

const runtime = createRuntime({
  maxFlushPasses: 20, // default 100
  onError: (error, context) => console.log(context.phase, (error as { code?: string }).code)
})
const celsius = runtime.signal(0, { debugName: 'celsius' })
const fahrenheit = runtime.signal(32, { debugName: 'fahrenheit' })

// Two effects write the value the other reads, and the conversion is off by 1, so they never agree and keep triggering each other
runtime.effect(() => { fahrenheit.value = celsius.value * 1.8 + 33 }, { debugName: 'c-to-f' })
runtime.effect(() => { celsius.value = (fahrenheit.value - 32) / 1.8 }, { debugName: 'f-to-c' })

await new Promise((resolve) => setTimeout(resolve, 10))
console.log('the page stays responsive, celsius =', Math.round(celsius.peek()))`,
        zh: `import { createRuntime } from '@migaia/reactive'

const runtime = createRuntime({
  maxFlushPasses: 20, // 默认 100
  onError: (error, context) => console.log(context.phase, (error as { code?: string }).code)
})
const celsius = runtime.signal(0, { debugName: 'celsius' })
const fahrenheit = runtime.signal(32, { debugName: 'fahrenheit' })

// 两个副作用互相写对方读取的值，换算里又多加了 1，两个值永远对不上，于是互相触发
runtime.effect(() => { fahrenheit.value = celsius.value * 1.8 + 33 }, { debugName: 'c-to-f' })
runtime.effect(() => { celsius.value = (fahrenheit.value - 32) / 1.8 }, { debugName: 'f-to-c' })

await new Promise((resolve) => setTimeout(resolve, 10))
console.log('页面仍可响应，celsius =', Math.round(celsius.peek()))`
      },
      result: t(
        'Prints `async-flush FLUSH_LOOP` from `onError`, then `the page stays responsive, celsius = 12`.\n\nThe loop was cut after 20 passes (the `maxFlushPasses` set in the example) instead of running forever, and the reported `debugName`s point at the effects feeding each other.',
        '先由 `onError` 输出 `async-flush FLUSH_LOOP`，再输出 `页面仍可响应，celsius = 12`。\n\n循环在 20 轮（示例里设的 `maxFlushPasses`）后被截断，而不是一直运行下去；报告里带的 `debugName` 指出了互相触发的副作用。'
      )
    }
  ],
  defaultRuntime: [
    {
      title: t('One Runtime per request on the server', '服务端每个请求一个 Runtime'),
      problem: t(
        "A server renders pages for many users, and one user's data appears on another user's page.\n\n`defaultRuntime` is one shared Runtime for the whole process; request state kept in that shared graph can be written by one request and read by another, and the leak is hard to notice.\n\nCreate a Runtime per request with `createRuntime()`. Nodes of different Runtimes cannot depend on each other: a cross read throws `CROSS_RUNTIME` at once instead of quietly mixing data.",
        '服务端给很多用户渲染页面，一个用户的数据出现在另一个用户的页面上。\n\n`defaultRuntime` 是整个进程共用的一个 Runtime；把请求状态放在这张共享的依赖图里，一个请求写入的值会被另一个请求读到，而且很难发现。\n\n为每个请求用 `createRuntime()` 创建自己的 Runtime。不同 Runtime 的节点不能互相依赖：跨 Runtime 读取会立刻抛出 `CROSS_RUNTIME`，而不是悄悄把数据混在一起。'
      ),
      example: {
        en: `import { createRuntime } from '@migaia/reactive'

// Server rendering: one Runtime per request, so users never see each other's state
function renderPage(user: string) {
  const runtime = createRuntime()
  const name = runtime.signal(user)
  const greeting = runtime.computed(() => \`Hello, \${name.value}\`)
  return { runtime, greeting }
}

const pageA = renderPage('Ada')
const pageB = renderPage('Grace')
console.log(pageA.greeting.value, '|', pageB.greeting.value)

// Using a node of A inside the Runtime of B fails at once instead of silently mixing data
const leaked = pageB.runtime.computed(() => pageA.greeting.value)
try {
  leaked.value
} catch (error) {
  console.log('cross-Runtime read:', (error as { code?: string }).code)
}`,
        zh: `import { createRuntime } from '@migaia/reactive'

// 服务端渲染：每个请求一个 Runtime，用户之间的状态互不可见
function renderPage(user: string) {
  const runtime = createRuntime()
  const name = runtime.signal(user)
  const greeting = runtime.computed(() => \`你好，\${name.value}\`)
  return { runtime, greeting }
}

const pageA = renderPage('Ada')
const pageB = renderPage('Grace')
console.log(pageA.greeting.value, '|', pageB.greeting.value)

// 把 A 的节点拿到 B 的 Runtime 里使用，会立刻报错，而不是悄悄串数据
const leaked = pageB.runtime.computed(() => pageA.greeting.value)
try {
  leaked.value
} catch (error) {
  console.log('跨 Runtime 读取:', (error as { code?: string }).code)
}`
      },
      result: t(
        'Prints `Hello, Ada | Hello, Grace`: each request has its own state.\n\nThe leaked read prints `cross-Runtime read: CROSS_RUNTIME`: mixing Runtimes shows up at the exact line that does it.',
        '输出 `你好，Ada | 你好，Grace`：每个请求有自己的状态。\n\n把节点带到别的 Runtime 里读取时输出 `跨 Runtime 读取: CROSS_RUNTIME`：串用会在出错的那一行暴露出来。'
      )
    }
  ]
}
