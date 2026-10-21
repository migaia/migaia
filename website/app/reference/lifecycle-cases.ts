import type { ICaseDoc, IText } from './contract.js'

/** Builds one bilingual text. */
const t = (en: string, zh: string): IText => ({ en, zh })

/**
 * Problems each lifecycle API solves, told as a situation, a runnable fix and the observed output.
 * Every example was run with Node 24 against the built packages and its printed output is quoted in
 * `result`.
 */
export const lifecycleCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
  createLifecycleScope: [
    {
      title: t('Clean up everything when a page closes', '离开页面时一起清理连接、订阅和计时器'),
      problem: t(
        'A subscription is missed when leaving the page, and after the user comes back every message is handled twice.\n\nCleanup functions scattered across a page need a matching line elsewhere for every new resource, which is easy to miss, and the release order is hand-written too.\n\nRegister each resource where it is created and call `dispose()` once when leaving. Release runs in reverse registration order, so the subscription that depends on the connection goes first.',
        '离开页面时漏掉了一个订阅，用户回到页面后，每条消息都被处理了两次。\n\n清理函数散落在页面各处，每加一个资源就要在别处记得加一行清理，很容易漏掉；释放顺序也全靠手写。\n\n在创建资源的地方把它登记到作用域，离开时只调用一次 `dispose()`。释放顺序与登记顺序相反，依赖连接的订阅会先于连接释放。'
      ),
      example: {
        en: `import { createLifecycleScope } from '@migaia/lifecycle/scope'

function openChatPage(messages: EventTarget) {
  const page = createLifecycleScope()

  page.own('connection', { force: () => console.log('connection closed') })

  const onMessage = () => console.log('message received')
  messages.addEventListener('message', onMessage)
  page.own(onMessage, {
    force: () => {
      messages.removeEventListener('message', onMessage)
      console.log('message subscription removed')
    }
  })

  const timer = setInterval(() => console.log('heartbeat'), 60_000)
  page.own(timer, {
    force: () => {
      clearInterval(timer)
      console.log('heartbeat timer cleared')
    }
  })
  return page
}

const messages = new EventTarget()
const page = openChatPage(messages)
messages.dispatchEvent(new Event('message'))
await page.dispose() // the page closes
messages.dispatchEvent(new Event('message')) // prints nothing now`,
        zh: `import { createLifecycleScope } from '@migaia/lifecycle/scope'

function openChatPage(messages: EventTarget) {
  const page = createLifecycleScope()

  page.own('connection', { force: () => console.log('断开连接') })

  const onMessage = () => console.log('收到消息')
  messages.addEventListener('message', onMessage)
  page.own(onMessage, {
    force: () => {
      messages.removeEventListener('message', onMessage)
      console.log('取消订阅消息')
    }
  })

  const timer = setInterval(() => console.log('心跳'), 60_000)
  page.own(timer, {
    force: () => {
      clearInterval(timer)
      console.log('清除心跳计时器')
    }
  })
  return page
}

const messages = new EventTarget()
const page = openChatPage(messages)
messages.dispatchEvent(new Event('message'))
await page.dispose() // 离开页面
messages.dispatchEvent(new Event('message')) // 不会再打印`
      },
      result: t(
        'Prints `message received`, then `heartbeat timer cleared`, `message subscription removed`, `connection closed`.\n\nThe second message prints nothing, and `own()` after `dispose()` throws `SCOPE_TERMINAL`, so the scope is never silently revived.',
        '输出 `收到消息`，然后依次是 `清除心跳计时器`、`取消订阅消息`、`断开连接`。\n\n第二条消息不会再打印；`dispose()` 之后再调用 `own()` 会抛出 `SCOPE_TERMINAL`，作用域不会被悄悄复活。'
      )
    },
    {
      title: t('One cleanup fails, the rest still run', '一项清理失败，其余照常释放'),
      problem: t(
        'Closing a cache file throws, the socket after it is never closed, and the original error is lost.\n\nIn a hand-written `finally`, a close that throws skips every close after it, and a later error can hide the original one.\n\nA scope attempts every release first and throws afterwards: one failure is thrown as the original error with `source` and `code` added, several become an `AggregateError`.',
        '关闭缓存文件时抛了错，后面的 socket 没有关，最初的错误也找不到了。\n\n手写的 `finally` 里，一个关闭操作抛错，后面的关闭都不会执行，最初的错误也可能被后来的错误盖掉。\n\n作用域会先把每个资源都尝试释放，结束后再抛出：一个失败时抛出原始错误本身，只多了 `source` 和 `code`；多个失败时合成 `AggregateError`。'
      ),
      example: {
        en: `import { createLifecycleScope } from '@migaia/lifecycle/scope'

const page = createLifecycleScope()
page.own('socket', { force: () => console.log('socket closed') })
page.own('cache', {
  force: () => {
    throw new Error('cache file is locked')
  }
})
page.own('timer', { force: () => console.log('timer cleared') })

try {
  await page.dispose()
} catch (error) {
  const failure = error as Error & { code?: string }
  console.log('dispose() failed:', failure.message, \`(\${failure.code})\`)
}
console.log('scope state:', page.lifecycle)`,
        zh: `import { createLifecycleScope } from '@migaia/lifecycle/scope'

const page = createLifecycleScope()
page.own('socket', { force: () => console.log('关闭 socket') })
page.own('cache', {
  force: () => {
    throw new Error('缓存文件被占用')
  }
})
page.own('timer', { force: () => console.log('清除计时器') })

try {
  await page.dispose()
} catch (error) {
  const failure = error as Error & { code?: string }
  console.log('dispose() 失败:', failure.message, \`(\${failure.code})\`)
}
console.log('作用域状态:', page.lifecycle)`
      },
      result: t(
        "Prints `timer cleared`, `socket closed`, then `dispose() failed: cache file is locked (SCOPE_DISPOSAL_FAILED)` and `scope state: terminal`.\n\nThe failure did not stop the other releases, and the original error was kept. Use `errorPolicy: 'collect'` to receive failures as an array, or `'report'` to send them to a logger.",
        "依次输出 `清除计时器`、`关闭 socket`，然后是 `dispose() 失败: 缓存文件被占用 (SCOPE_DISPOSAL_FAILED)` 和 `作用域状态: terminal`。\n\n失败没有阻断其他释放，原始错误也保留了下来。用 `errorPolicy: 'collect'` 可以把失败作为数组拿回来，用 `'report'` 交给日志函数。"
      )
    },
    {
      title: t(
        'A resource will not close: gracefully first, then by force',
        '资源关不掉时，先优雅、再强制'
      ),
      problem: t(
        'At shutdown a message consumer should finish the messages it holds, but it hangs, and the whole shutdown hangs with it.\n\nHand-written shutdown usually has one way to close: wait for a graceful close, possibly forever, or disconnect by force and drop the messages in hand.\n\nGive the descriptor both `graceful` and `force`: the scope waits up to `gracefulTimeoutMs` for `graceful`, then stops waiting and calls `force`, which must always complete.',
        '停机时消息消费者应该先处理完手头的消息，但它卡住了，整个停机也跟着卡住。\n\n手写停机通常只有一种关闭方式：要么一直等优雅关闭，可能永远等下去；要么直接强制断开，丢掉手头的消息。\n\n给释放说明同时提供 `graceful` 和 `force`：作用域最多等 `gracefulTimeoutMs`，超时后不再等待 `graceful`，改为调用一定能完成的 `force`。'
      ),
      example: {
        en: `import { createLifecycleScope } from '@migaia/lifecycle/scope'

const app = createLifecycleScope()
app.own('message-consumer', {
  // First ask the consumer to finish the messages it holds; it does not finish within 100 ms.
  graceful: () => new Promise((resolve) => setTimeout(resolve, 1_000).unref()),
  gracefulTimeoutMs: 100,
  // After the graceful attempt times out, disconnect by force.
  force: () => console.log('message consumer disconnected by force')
})
const started = performance.now()
await app.dispose()
console.log(\`shutdown took about \${Math.round((performance.now() - started) / 100) * 100} ms\`)`,
        zh: `import { createLifecycleScope } from '@migaia/lifecycle/scope'

const app = createLifecycleScope()
app.own('message-consumer', {
  // 先请求消费者处理完手头的消息；它在 100 毫秒内没完成。
  graceful: () => new Promise((resolve) => setTimeout(resolve, 1_000).unref()),
  gracefulTimeoutMs: 100,
  // 优雅关闭超时后，强制断开。
  force: () => console.log('强制断开消息消费者')
})
const started = performance.now()
await app.dispose()
console.log(\`停机用时约 \${Math.round((performance.now() - started) / 100) * 100} 毫秒\`)`
      },
      result: t(
        'Prints `message consumer disconnected by force`, then `shutdown took about 100 ms`.\n\nThe timed-out `graceful` is not cancelled, only no longer awaited; shutdown time now has an upper bound.',
        '输出 `强制断开消息消费者`，然后是 `停机用时约 100 毫秒`。\n\n超时的 `graceful` 不会被取消，只是不再被等待；停机时间有了上限。'
      )
    }
  ],
  createPendingTracker: [
    {
      title: t('Let in-flight requests finish before shutting down', '停机前等进行中的请求完成'),
      problem: t(
        'During a deploy a request that is writing to the database is cut off, and the client gets a 502.\n\nHand-written code that exits on SIGTERM does not know how many requests are still in progress; waiting for them means keeping a counter by hand and handling the cases where it goes wrong.\n\nRegister every request with `track()`, and on shutdown wait for `drain()` with a deadline, then close the connection pool.',
        '发布新版本时，正在写数据库的请求被砍断，客户端收到 502。\n\n收到 SIGTERM 就退出的手写代码不知道还有多少请求在处理中；想等它们，又得自己维护计数并处理计数出错的情况。\n\n用 `track()` 登记每个请求，停机时带截止时间等待 `drain()`，然后再关闭连接池。'
      ),
      example: {
        en: `import { createServer } from 'node:http'
import { boundedWait } from '@migaia/lifecycle'
import { createPendingTracker } from '@migaia/lifecycle/quiescence'
import { createLifecycleScope } from '@migaia/lifecycle/scope'

const app = createLifecycleScope()
const inFlight = createPendingTracker()

// Registered first, released last: the database pool closes at the end.
app.own('db-pool', { force: () => console.log('3. database pool closed') })

const server = createServer((request, response) => {
  // Every request is registered as work in flight; handling takes 200 ms.
  void inFlight.track(
    new Promise<void>((resolve) =>
      setTimeout(() => {
        response.end('order saved')
        resolve()
      }, 200)
    )
  )
})
app.own(server, {
  force: async () => {
    server.close() // stop accepting new connections
    console.log('1. stopped accepting requests, waiting for in-flight ones')
    const finished = await boundedWait(inFlight.drain(), performance.now() + 5_000)
    console.log(finished ? '2. all in-flight requests finished' : '2. timed out, closing anyway')
    server.closeAllConnections() // drop remaining idle keep-alive connections
  }
})
server.listen(0)

// In a real service: process.once('SIGTERM', () => void app.dispose())
const { port } = server.address() as { port: number }
const order = fetch(\`http://localhost:\${port}/orders\`, { method: 'POST' }).then((r) => r.text())
await new Promise((resolve) => setTimeout(resolve, 50)) // shut down while the request is in progress
await app.dispose()
console.log('client received:', await order)`,
        zh: `import { createServer } from 'node:http'
import { boundedWait } from '@migaia/lifecycle'
import { createPendingTracker } from '@migaia/lifecycle/quiescence'
import { createLifecycleScope } from '@migaia/lifecycle/scope'

const app = createLifecycleScope()
const inFlight = createPendingTracker()

// 先登记的后释放：数据库连接池最后关闭。
app.own('db-pool', { force: () => console.log('3. 关闭数据库连接池') })

const server = createServer((request, response) => {
  // 每个请求都登记为“进行中的工作”，处理需要 200 毫秒。
  void inFlight.track(
    new Promise<void>((resolve) =>
      setTimeout(() => {
        response.end('订单已保存')
        resolve()
      }, 200)
    )
  )
})
app.own(server, {
  force: async () => {
    server.close() // 不再接受新连接
    console.log('1. 停止接收新请求，等待进行中的请求')
    const finished = await boundedWait(inFlight.drain(), performance.now() + 5_000)
    console.log(finished ? '2. 进行中的请求都已完成' : '2. 等待超时，继续关闭')
    server.closeAllConnections() // 断开剩下的空闲长连接
  }
})
server.listen(0)

// 真实服务里写成：process.once('SIGTERM', () => void app.dispose())
const { port } = server.address() as { port: number }
const order = fetch(\`http://localhost:\${port}/orders\`, { method: 'POST' }).then((r) => r.text())
await new Promise((resolve) => setTimeout(resolve, 50)) // 请求处理到一半时开始停机
await app.dispose()
console.log('客户端收到:', await order)`
      },
      result: t(
        'Prints steps 1, 2 and 3 in order, then `client received: order saved`.\n\nThe request in progress when shutdown began still completed, and the pool closed only after it.',
        '依次输出第 1、2、3 步，然后是 `客户端收到: 订单已保存`。\n\n停机开始时正在处理的请求依然完成了，连接池在它之后才关闭。'
      )
    }
  ],
  boundedWait: [
    {
      title: t('Never let one stuck request hang the shutdown', '不让一个卡住的请求挂住整个停机'),
      problem: t(
        'An export request needs 10 seconds, but the platform kills the process 30 seconds after SIGTERM, before the later shutdown steps get to run.\n\nA hand-written `await drain()` has no deadline, so one stuck request can hold up the whole shutdown; adding a deadline with `Promise.race` easily leaves timers behind.\n\n`boundedWait` returns `false` at the deadline so shutdown continues; it does not cancel the request, it just stops waiting. The deadline is on the `performance.now()` clock, not `Date.now()`.',
        '一个导出请求需要 10 秒，而平台在 SIGTERM 之后 30 秒就会强制结束进程，后面的停机步骤还没来得及执行。\n\n手写的 `await drain()` 没有时限，一个卡住的请求就能拖住整个停机；用 `Promise.race` 加时限又容易留下没清理的计时器。\n\n`boundedWait` 到截止时间返回 `false`，停机流程继续往下走；它不会取消那个请求，只是不再等它。截止时间使用 `performance.now()` 的时间轴，不是 `Date.now()`。'
      ),
      example: {
        en: `import { boundedWait } from '@migaia/lifecycle'
import { createPendingTracker } from '@migaia/lifecycle/quiescence'
import { createLifecycleScope } from '@migaia/lifecycle/scope'

const app = createLifecycleScope()
const inFlight = createPendingTracker()
app.own('db-pool', { force: () => console.log('database pool closed') })
app.own('http', {
  force: async () => {
    const finished = await boundedWait(inFlight.drain(), performance.now() + 300)
    console.log(finished ? 'all in-flight requests finished' : \`\${inFlight.size} request(s) still running, closing anyway\`)
  }
})

// An export request that takes 10 seconds. unref() keeps it from holding the example process open.
void inFlight.track(new Promise((resolve) => setTimeout(resolve, 10_000).unref()))
await app.dispose()`,
        zh: `import { boundedWait } from '@migaia/lifecycle'
import { createPendingTracker } from '@migaia/lifecycle/quiescence'
import { createLifecycleScope } from '@migaia/lifecycle/scope'

const app = createLifecycleScope()
const inFlight = createPendingTracker()
app.own('db-pool', { force: () => console.log('关闭数据库连接池') })
app.own('http', {
  force: async () => {
    const finished = await boundedWait(inFlight.drain(), performance.now() + 300)
    console.log(finished ? '进行中的请求都已完成' : \`还有 \${inFlight.size} 个请求没完成，继续关闭\`)
  }
})

// 一个需要 10 秒的导出请求。unref() 让它不阻止示例进程退出。
void inFlight.track(new Promise((resolve) => setTimeout(resolve, 10_000).unref()))
await app.dispose()`
      },
      result: t(
        'Prints `1 request(s) still running, closing anyway`, then `database pool closed`, about 300 ms after shutdown began.\n\nWaiting now has an upper bound, and the later shutdown steps run on time.',
        '停机开始约 300 毫秒后输出 `还有 1 个请求没完成，继续关闭`，然后是 `关闭数据库连接池`。\n\n等待有了上限，后面的停机步骤按时执行。'
      )
    }
  ],
  createGenerationController: [
    {
      title: t('Show only the latest search result', '搜索框只显示最新一次请求的结果'),
      problem: t(
        'The user types "a" and then "ab"; the slow answer for "a" arrives last and overwrites the newer result.\n\nHand-written code writes each result as it arrives, so whichever answers last wins; preventing that means keeping request numbers by hand and comparing them at every exit.\n\nCall `begin()` before each request: it makes the previous request stale and aborts its signal. Before using a result, check `isCurrent(token)`.',
        '用户输入 “a” 又输入 “ab”，“a” 的慢响应最后到达，把新结果覆盖了。\n\n手写时每个请求返回后都直接写结果，谁最后返回谁就赢；要防止覆盖，得自己维护请求编号并在每个出口比较。\n\n每次请求前调用 `begin()`：它会让上一次请求过期并取消它的信号。使用结果之前，先用 `isCurrent(token)` 确认它仍是最新的。'
      ),
      example: {
        en: `import { createGenerationController } from '@migaia/lifecycle/generation'

// A fake search API: shorter keywords match more and answer more slowly.
const search = (keyword: string, signal: AbortSignal) =>
  new Promise<string[]>((resolve, reject) => {
    const timer = setTimeout(() => resolve([\`results for \${keyword}\`]), keyword.length === 1 ? 300 : 100)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason)
    })
  })

const requests = createGenerationController()
let shown: string[] = []

async function onInput(keyword: string) {
  const request = requests.begin() // a newer input makes the previous request stale and aborts it
  try {
    const results = await search(keyword, request.signal)
    if (requests.isCurrent(request.token)) shown = results
  } catch (error) {
    if (!requests.isCurrent(request.token)) return // replaced by newer input; ignore
    throw error
  }
}

// The user types "a" and immediately "ab".
await Promise.all([onInput('a'), onInput('ab')])
console.log('page shows:', shown)`,
        zh: `import { createGenerationController } from '@migaia/lifecycle/generation'

// 模拟搜索接口：越短的关键词结果越多，返回得越慢。
const search = (keyword: string, signal: AbortSignal) =>
  new Promise<string[]>((resolve, reject) => {
    const timer = setTimeout(() => resolve([\`\${keyword} 的结果\`]), keyword.length === 1 ? 300 : 100)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason)
    })
  })

const requests = createGenerationController()
let shown: string[] = []

async function onInput(keyword: string) {
  const request = requests.begin() // 新的输入会让上一次请求过期，并取消它
  try {
    const results = await search(keyword, request.signal)
    if (requests.isCurrent(request.token)) shown = results
  } catch (error) {
    if (!requests.isCurrent(request.token)) return // 被新输入取代，忽略
    throw error
  }
}

// 用户快速输入 “a”，紧接着输入 “ab”。
await Promise.all([onInput('a'), onInput('ab')])
console.log('页面显示:', shown)`
      },
      result: t(
        'Prints `page shows: [ \'results for ab\' ]`.\n\nThe request for "a" was aborted as soon as "ab" began, so its answer never reached the page.',
        "输出 `页面显示: [ 'ab 的结果' ]`。\n\n“ab” 开始时 “a” 的请求就被取消了，它的结果不会出现在页面上。"
      )
    }
  ],
  createProvisionalScope: [
    {
      title: t(
        'Reclaim what was created when setup fails halfway',
        '初始化到一半失败时，回收已经创建的资源'
      ),
      problem: t(
        "Installing a plugin connects a database and opens a cache, then step three fails and the first two stay open.\n\nHand-written setup must remember to reclaim everything created so far at every failing step; with enough steps the cleanup is longer than the setup, and easy to get wrong.\n\nRegister each step's resource in a provisional scope: `commitTo(app)` hands everything over on success, and `rollback()` releases it in reverse order on failure.",
        '安装插件时连上了数据库、打开了缓存，第三步却失败了，前两个资源一直开着。\n\n手写的初始化要在每一步失败时记得回收之前的所有资源，步骤一多，回收代码就比初始化代码还长，而且很容易漏。\n\n把每一步创建的资源先登记到临时作用域：成功时用 `commitTo(app)` 整体交给应用，失败时用 `rollback()` 按相反顺序回收。'
      ),
      example: {
        en: `import { createProvisionalScope } from '@migaia/lifecycle'
import { createLifecycleScope } from '@migaia/lifecycle/scope'

const app = createLifecycleScope()

// Installing a plugin takes three steps: connect the database, open the cache, register routes.
async function installPlugin(failAtStep3: boolean) {
  const setup = createProvisionalScope()
  try {
    setup.own('db', { force: () => console.log('  reclaimed: database disconnected') })
    setup.own('cache', { force: () => console.log('  reclaimed: cache closed') })
    if (failAtStep3) throw new Error('route conflict')
    await setup.commitTo(app) // all steps succeeded: hand everything to the app scope
    console.log('plugin installed')
  } catch (error) {
    await setup.rollback() // a step failed: release what was created, in reverse order
    console.log('install failed:', (error as Error).message)
  }
}

await installPlugin(true)
await installPlugin(false)
console.log('app shutting down:')
await app.dispose()`,
        zh: `import { createProvisionalScope } from '@migaia/lifecycle'
import { createLifecycleScope } from '@migaia/lifecycle/scope'

const app = createLifecycleScope()

// 安装插件分三步：连数据库、开缓存、注册路由。
async function installPlugin(failAtStep3: boolean) {
  const setup = createProvisionalScope()
  try {
    setup.own('db', { force: () => console.log('  回收：断开数据库') })
    setup.own('cache', { force: () => console.log('  回收：关闭缓存') })
    if (failAtStep3) throw new Error('路由冲突')
    await setup.commitTo(app) // 全部成功：整体交给应用作用域
    console.log('插件已安装')
  } catch (error) {
    await setup.rollback() // 失败：已经创建的资源按相反顺序回收
    console.log('安装失败:', (error as Error).message)
  }
}

await installPlugin(true)
await installPlugin(false)
console.log('应用关闭：')
await app.dispose()`
      },
      result: t(
        'The failed install reclaims the cache and then the database before printing `install failed: route conflict`.\n\nThe successful one prints `plugin installed`, and its resources are released with the app scope at shutdown.',
        '失败的那次先回收缓存、再回收数据库，然后输出 `安装失败: 路由冲突`。\n\n成功的那次输出 `插件已安装`，它的资源在应用关闭时随应用作用域一起释放。'
      )
    }
  ],
  createMutationQueue: [
    {
      title: t('Keep autosaves in submission order', '自动保存按提交顺序落地'),
      problem: t(
        'Two autosaves are sent almost at once, and the slower, older one lands last and overwrites newer content.\n\nHand-written autosave sends each request right away, so the network decides the order they reach the server, not the order they were submitted.\n\nA mutation queue runs one task at a time, so the second save starts only after the first has finished.',
        '两次自动保存几乎同时发出，较慢的旧请求最后到达，把新内容覆盖掉了。\n\n手写的自动保存每次都直接发请求，到达服务器的顺序由网络决定，不由提交顺序决定。\n\n变更队列一次只执行一个任务，第二次保存要等第一次完成后才开始。'
      ),
      example: {
        en: `import { createMutationQueue } from '@migaia/lifecycle'

// A fake server: the first save is slower than the second.
let stored = ''
const save = (text: string, delayMs: number) =>
  new Promise<void>((resolve) =>
    setTimeout(() => {
      stored = text
      resolve()
    }, delayMs)
  )

// Sent concurrently: the slow old version arrives last and overwrites the new one.
await Promise.all([save('draft v1', 100), save('draft v2', 10)])
console.log('without a queue the server keeps:', stored)

// Through a mutation queue: the later save waits for the earlier one.
const queue = createMutationQueue()
await Promise.all([
  queue.enqueue(() => save('draft v1', 100)),
  queue.enqueue(() => save('draft v2', 10))
])
console.log('with a queue the server keeps:', stored)`,
        zh: `import { createMutationQueue } from '@migaia/lifecycle'

// 模拟服务器：第一次保存的请求比第二次慢。
let stored = ''
const save = (text: string, delayMs: number) =>
  new Promise<void>((resolve) =>
    setTimeout(() => {
      stored = text
      resolve()
    }, delayMs)
  )

// 直接并发发送：慢的旧版本最后到达，覆盖了新版本。
await Promise.all([save('草稿 v1', 100), save('草稿 v2', 10)])
console.log('不排队时服务器保存的是:', stored)

// 交给变更队列：后一次保存等前一次完成后才开始。
const queue = createMutationQueue()
await Promise.all([
  queue.enqueue(() => save('草稿 v1', 100)),
  queue.enqueue(() => save('草稿 v2', 10))
])
console.log('排队后服务器保存的是:', stored)`
      },
      result: t(
        'Prints `without a queue the server keeps: draft v1`, then `with a queue the server keeps: draft v2`.\n\nWith the queue, the final content on the server is the last one submitted.',
        '输出 `不排队时服务器保存的是: 草稿 v1`，然后是 `排队后服务器保存的是: 草稿 v2`。\n\n排队之后，服务器上的最终内容就是最后一次提交的内容。'
      )
    }
  ]
}
