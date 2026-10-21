import type { ICaseDoc } from './contract.js'

/** Complete diagnostics examples use real Store and Runtime owners. */
export const storeDevtoolsCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
  createStoreDevTools: [
    {
      title: {
        en: 'Replay retained state without creating replay history',
        zh: '回放保留状态而不新增回放历史'
      },
      problem: {
        en: 'An investigation needs to revisit an earlier Store state and then continue editing from it.\n\nA plain change listener can record the hydration caused by replay as another user edit, making the history grow every time the investigator jumps.\n\nAttach tools to a real Store, retain its initial id, and call jumpTo(); the session suppresses replay-generated history while later edits still record.',
        zh: '排查问题时，需要回到较早的 Store 状态，再从那里继续修改。\n\n普通变更监听若把回放触发的注水也当成用户编辑，每跳转一次就会多记一条历史。\n\n把工具接到真实 Store，保留初始 id 后调用 `jumpTo()`；会话会抑制回放产生的历史，后续真实修改仍正常记录。'
      },
      example: {
        en: "import { createRuntime } from '@migaia/reactive'\nimport { createStore } from '@migaia/store-light'\nimport { createStoreDevTools } from '@migaia/store-devtools'\n\nconst runtime = createRuntime({ schedulerStrategy: (run) => run() })\nconst store = createStore({ count: 0 }, { runtime })\nconst tools = createStoreDevTools(store, { captureRuntimeTrace: false })\ntry {\n  const initial = tools.history[0]!\n  store.count = 1\n  store.count = 2\n  console.log(store.count, tools.history.length)\n  tools.jumpTo(initial.id)\n  console.log(store.count, tools.history.length)\n  store.count = 1\n  console.log(store.count, tools.history.length)\n  console.log(initial.state.count, Object.isFrozen(initial.state))\n} finally {\n  tools.dispose()\n  await store.$dispose()\n}",
        zh: "import { createRuntime } from '@migaia/reactive'\nimport { createStore } from '@migaia/store-light'\nimport { createStoreDevTools } from '@migaia/store-devtools'\n\nconst runtime = createRuntime({ schedulerStrategy: (run) => run() })\nconst store = createStore({ count: 0 }, { runtime })\nconst tools = createStoreDevTools(store, { captureRuntimeTrace: false })\ntry {\n  const initial = tools.history[0]!\n  store.count = 1\n  store.count = 2\n  console.log(store.count, tools.history.length)\n  tools.jumpTo(initial.id)\n  console.log(store.count, tools.history.length)\n  store.count = 1\n  console.log(store.count, tools.history.length)\n  console.log(initial.state.count, Object.isFrozen(initial.state))\n} finally {\n  tools.dispose()\n  await store.$dispose()\n}"
      },
      result: {
        en: 'Output is `2 3`, `0 3`, `1 4`, then `0 true`: replay restores count without extending history, the next edit records again, and the initial state stays shallow-frozen.\n\njumpTo hydrates retained Store fields; it does not undo external side effects, restore evicted entries, or guarantee deep isolation for every diagnostic value.',
        zh: '输出为 `2 3`、`0 3`、`1 4`、`0 true`：回放恢复计数但不追加历史，后续修改继续记录，初始状态保持浅冻结。\n\n`jumpTo` 只向 Store 已知字段注水，不会撤销外部副作用、恢复已淘汰条目，也不保证所有诊断值都完全深度隔离。'
      }
    },
    {
      title: {
        en: 'Bound history and manual action queues independently',
        zh: '分别限制历史与手动动作队列'
      },
      problem: {
        en: 'A long debugging session needs a small recent history while still retaining selected manual action notes.\n\nOne shared queue can make action notes evict states, and treating clear as a fresh session can reuse old ids or leave ambiguous anchors.\n\nSet independent maxHistory and maxTrace limits, disable automatic trace, add manual actions, then clear and inspect the new initial entry.',
        zh: '长时间调试时，需要只保留少量最近状态，同时留下选定的手动动作说明。\n\n共用一个队列会让动作说明挤掉状态；把清空当成新会话，还可能重用旧 id，留下含混的锚点。\n\n分别设置 `maxHistory`、`maxTrace`，关闭自动追踪并追加手动动作，再清空并检查新的初始条目。'
      },
      example: {
        en: "import { createRuntime } from '@migaia/reactive'\nimport { createStore } from '@migaia/store-light'\nimport { createStoreDevTools } from '@migaia/store-devtools'\n\nconst runtime = createRuntime({ schedulerStrategy: (run) => run() })\nconst store = createStore({ count: 0 }, { runtime })\nconst tools = createStoreDevTools(store, {\n  maxHistory: 2,\n  maxTrace: 2,\n  captureRuntimeTrace: false,\n  now: () => 100\n})\ntry {\n  const initialId = tools.history[0]!.id\n  store.count = 1\n  store.count = 2\n  store.count = 3\n  for (const name of ['first', 'second', 'third']) tools.recordAction({ name })\n  console.log(tools.history.map((entry) => entry.state.count).join(','))\n  console.log(tools.actions.map((entry) => entry.name).join(','), tools.trace.length)\n  try {\n    tools.jumpTo(initialId)\n  } catch (error) {\n    const failure = error as Error & { code?: string }\n    if (failure.code !== 'UNKNOWN_HISTORY_ENTRY') throw error\n    console.log(failure instanceof RangeError, failure.code)\n  }\n  tools.clear()\n  console.log(\n    tools.history[0]!.id,\n    tools.history[0]!.label,\n    tools.actions.length,\n    tools.trace.length\n  )\n} finally {\n  tools.dispose()\n  await store.$dispose()\n}",
        zh: "import { createRuntime } from '@migaia/reactive'\nimport { createStore } from '@migaia/store-light'\nimport { createStoreDevTools } from '@migaia/store-devtools'\n\nconst runtime = createRuntime({ schedulerStrategy: (run) => run() })\nconst store = createStore({ count: 0 }, { runtime })\nconst tools = createStoreDevTools(store, {\n  maxHistory: 2,\n  maxTrace: 2,\n  captureRuntimeTrace: false,\n  now: () => 100\n})\ntry {\n  const initialId = tools.history[0]!.id\n  store.count = 1\n  store.count = 2\n  store.count = 3\n  for (const name of ['第一', '第二', '第三']) tools.recordAction({ name })\n  console.log(tools.history.map((entry) => entry.state.count).join(','))\n  console.log(tools.actions.map((entry) => entry.name).join(','), tools.trace.length)\n  try {\n    tools.jumpTo(initialId)\n  } catch (error) {\n    const failure = error as Error & { code?: string }\n    if (failure.code !== 'UNKNOWN_HISTORY_ENTRY') throw error\n    console.log(failure instanceof RangeError, failure.code)\n  }\n  tools.clear()\n  console.log(\n    tools.history[0]!.id,\n    tools.history[0]!.label,\n    tools.actions.length,\n    tools.trace.length\n  )\n} finally {\n  tools.dispose()\n  await store.$dispose()\n}"
      },
      result: {
        en: 'Output is `2,3`, `second,third 0`, `true UNKNOWN_HISTORY_ENTRY`, then `5 initial 0 0`: queues keep their own newest entries and clear preserves the id sequence.\n\nmaxHistory defaults to 100; maxTrace defaults to 1000 for each of actions and trace, and captureRuntimeTrace false also disables automatic action capture.',
        zh: '输出为 `2,3`、`第二,第三 0`、`true UNKNOWN_HISTORY_ENTRY`、`5 initial 0 0`：两个队列各自保留最近条目，清空也不重置 id 序列。\n\n`maxHistory` 默认 `100`；`maxTrace` 默认分别为 actions、trace 保留 `1000` 条，`captureRuntimeTrace: false` 也会关闭自动动作捕获。'
      }
    },
    {
      title: {
        en: 'Report snapshot failure without interrupting the business write',
        zh: '报告快照失败而不打断业务写入'
      },
      problem: {
        en: 'A diagnostic snapshot callback fails during an ordinary Store update, but the update must remain usable.\n\nLetting that callback escape the Store listener turns a debugging failure into a business failure; reserving an id before preparation also leaves a hole after failure.\n\nUse the real Runtime reporter and a failing clone callback; automatic capture reports the original error, while manual record throws it before publishing.',
        zh: '普通 Store 更新期间，诊断快照回调可能失败，但业务写入仍应可用。\n\n让该回调从 Store 监听器直接逃出，就把调试失败变成业务失败；准备完成前先占用 id，也会在失败后留下空号。\n\n使用真实 Runtime 报告入口和会失败的克隆回调；自动捕获报告原错，手动 `record()` 则在发布前抛出它。'
      },
      example: {
        en: "import { createRuntime } from '@migaia/reactive'\nimport { createStore } from '@migaia/store-light'\nimport { createStoreDevTools } from '@migaia/store-devtools'\n\nconst reports: unknown[] = []\nconst runtime = createRuntime({\n  schedulerStrategy: (run) => run(),\n  onError: (error) => {\n    reports.push(error)\n  }\n})\nconst store = createStore({ count: 0 }, { runtime })\nconst original = new TypeError('diagnostic snapshot failed')\nlet fail = false\nconst tools = createStoreDevTools(store, {\n  captureRuntimeTrace: false,\n  clone: (state) => {\n    if (fail) throw original\n    return { ...state }\n  }\n})\ntry {\n  fail = true\n  store.count = 1\n  console.log(store.count, tools.history.length)\n  console.log(reports[0] === original, (original as Error & { code?: string }).code)\n  try {\n    tools.record()\n  } catch (error) {\n    if (error !== original) throw error\n    console.log(error === original)\n  }\n  fail = false\n  console.log(tools.record().id)\n} finally {\n  tools.dispose()\n  await store.$dispose()\n}",
        zh: "import { createRuntime } from '@migaia/reactive'\nimport { createStore } from '@migaia/store-light'\nimport { createStoreDevTools } from '@migaia/store-devtools'\n\nconst reports: unknown[] = []\nconst runtime = createRuntime({\n  schedulerStrategy: (run) => run(),\n  onError: (error) => {\n    reports.push(error)\n  }\n})\nconst store = createStore({ count: 0 }, { runtime })\nconst original = new TypeError('诊断快照失败')\nlet fail = false\nconst tools = createStoreDevTools(store, {\n  captureRuntimeTrace: false,\n  clone: (state) => {\n    if (fail) throw original\n    return { ...state }\n  }\n})\ntry {\n  fail = true\n  store.count = 1\n  console.log(store.count, tools.history.length)\n  console.log(reports[0] === original, (original as Error & { code?: string }).code)\n  try {\n    tools.record()\n  } catch (error) {\n    if (error !== original) throw error\n    console.log(error === original)\n  }\n  fail = false\n  console.log(tools.record().id)\n} finally {\n  tools.dispose()\n  await store.$dispose()\n}"
      },
      result: {
        en: 'Output is `1 1`, `true CALLBACK_FAILED`, `true`, then `2`: the write succeeds, automatic reporting keeps the original TypeError, manual recording throws it, and recovery uses the next id.\n\nOnly diagnostic preparation is isolated here; unclassified replay clone failures throw with `CALLBACK_FAILED`, while Store hydration keeps its own failure path; this custom clone is a shallow spread.',
        zh: '输出为 `1 1`、`true CALLBACK_FAILED`、`true`、`2`：写入成功，自动报告保留原 TypeError，手动记录抛出同一个错误，恢复后使用下一个 id。\n\n这里隔离的只是诊断准备失败；回放克隆的未归属失败会带 `CALLBACK_FAILED` 抛出，Store 注水仍沿自身失败路径传播；此自定义克隆仅作浅展开。'
      }
    },
    {
      title: {
        en: 'Release diagnostics while leaving the Store usable',
        zh: '释放诊断会话后继续使用 Store'
      },
      problem: {
        en: 'A debugging panel closes, while the application still needs the Store it was inspecting.\n\nDisposing the Store with the panel releases a resource owned by the application, but keeping the diagnostic listeners attached makes hidden history keep growing.\n\nDispose only the diagnostic session, retain its read-only queues, and continue writing the real Store; new diagnostic mutations reject.',
        zh: '调试面板关闭后，应用仍需要它刚才查看的 Store。\n\n面板退出时连 Store 一起释放，会越过应用的所有权边界；保留诊断监听器，又会让隐藏历史继续增长。\n\n只释放诊断会话，保留其只读队列，再继续写真实 Store；新的诊断修改会被拒绝。'
      },
      example: {
        en: "import { createRuntime } from '@migaia/reactive'\nimport { createStore } from '@migaia/store-light'\nimport { createStoreDevTools } from '@migaia/store-devtools'\n\nconst runtime = createRuntime({ schedulerStrategy: (run) => run() })\nconst store = createStore({ count: 0 }, { runtime })\nconst tools = createStoreDevTools(store, { captureRuntimeTrace: false })\ntry {\n  tools.dispose()\n  tools.dispose()\n  store.count = 1\n  console.log(store.count, tools.history.length)\n  try {\n    tools.record()\n  } catch (error) {\n    const failure = error as Error & { code?: string }\n    if (failure.code !== 'SESSION_DISPOSED') throw error\n    console.log(failure.code)\n  }\n  store.count = 2\n  console.log(store.count)\n} finally {\n  tools.dispose()\n  await store.$dispose()\n}",
        zh: "import { createRuntime } from '@migaia/reactive'\nimport { createStore } from '@migaia/store-light'\nimport { createStoreDevTools } from '@migaia/store-devtools'\n\nconst runtime = createRuntime({ schedulerStrategy: (run) => run() })\nconst store = createStore({ count: 0 }, { runtime })\nconst tools = createStoreDevTools(store, { captureRuntimeTrace: false })\ntry {\n  tools.dispose()\n  tools.dispose()\n  store.count = 1\n  console.log(store.count, tools.history.length)\n  try {\n    tools.record()\n  } catch (error) {\n    const failure = error as Error & { code?: string }\n    if (failure.code !== 'SESSION_DISPOSED') throw error\n    console.log(failure.code)\n  }\n  store.count = 2\n  console.log(store.count)\n} finally {\n  tools.dispose()\n  await store.$dispose()\n}"
      },
      result: {
        en: 'Output is `1 1`, `SESSION_DISPOSED`, then `2`: repeated disposal is harmless, the old history remains readable and unchanged, and the caller-owned Store still accepts writes.\n\nSession dispose detaches its Store and Runtime subscriptions; it does not clear queues or dispose the borrowed Store, which the caller releases separately.',
        zh: '输出为 `1 1`、`SESSION_DISPOSED`、`2`：重复释放无额外影响，旧历史仍可读且不增长，调用方拥有的 Store 仍能写入。\n\n会话释放只移除 Store 与 Runtime 订阅，不清空队列，也不释放借用的 Store；调用方最后单独释放 Store。'
      }
    }
  ],
  getDependencyTree: [
    {
      title: {
        en: 'Expand both paths of a shared dependency',
        zh: '展开共享依赖的两条路径'
      },
      problem: {
        en: 'Two computed values share one signal, and an effect reads both; an investigation needs to see both paths back to that signal.\n\nA global visited set can label the second shared path as a cycle or omit it, even though that path does not recurse into itself.\n\nBuild the diamond with real Runtime handles and inspect the effect; traversal tracks only the current path and respects an explicit depth bound.',
        zh: '两个计算值共享一个信号，effect 同时读取两者；排查时需要看见回到同一信号的两条路径。\n\n全局已访问集合可能把第二条共享路径误标为环，或直接省略它，尽管它并没有递归回到自身。\n\n用真实 Runtime 句柄组成菱形依赖，再检查 effect；遍历只跟踪当前路径，并遵守显式深度上限。'
      },
      example: {
        en: "import { createRuntime } from '@migaia/reactive'\nimport { getDependencyTree } from '@migaia/store-devtools'\n\nconst runtime = createRuntime()\nconst source = runtime.signal(1, { debugName: 'source' })\nconst left = runtime.computed(() => source.value + 1, { debugName: 'left' })\nconst right = runtime.computed(() => source.value + 2, { debugName: 'right' })\nconst view = runtime.effect(\n  () => {\n    void (left.value + right.value)\n  },\n  { debugName: 'view' }\n)\ntry {\n  const tree = getDependencyTree(view)\n  console.log(tree.label, tree.children.map((node) => node.label).join(','))\n  console.log(tree.children.map((node) => node.children[0]!.label).join(','))\n  console.log(tree.children.every((node) => node.children[0]!.circular !== true))\n  console.log(getDependencyTree(view, 0).children.length)\n} finally {\n  view.dispose()\n  left.dispose()\n  right.dispose()\n  source.dispose()\n}",
        zh: "import { createRuntime } from '@migaia/reactive'\nimport { getDependencyTree } from '@migaia/store-devtools'\n\nconst runtime = createRuntime()\nconst source = runtime.signal(1, { debugName: '来源' })\nconst left = runtime.computed(() => source.value + 1, { debugName: '左分支' })\nconst right = runtime.computed(() => source.value + 2, { debugName: '右分支' })\nconst view = runtime.effect(\n  () => {\n    void (left.value + right.value)\n  },\n  { debugName: '视图' }\n)\ntry {\n  const tree = getDependencyTree(view)\n  console.log(tree.label, tree.children.map((node) => node.label).join(','))\n  console.log(tree.children.map((node) => node.children[0]!.label).join(','))\n  console.log(tree.children.every((node) => node.children[0]!.circular !== true))\n  console.log(getDependencyTree(view, 0).children.length)\n} finally {\n  view.dispose()\n  left.dispose()\n  right.dispose()\n  source.dispose()\n}"
      },
      result: {
        en: 'Output is `view left,right`, `source,source`, `true`, then `0`: both shared paths expand without a cycle flag, and maxDepth zero returns no direct edges.\n\nThe default depth is 20 and must be a nonnegative safe integer; this is an instantaneous upstream view, not a new subscription or an effect execution.',
        zh: '输出为 `视图 左分支,右分支`、`来源,来源`、`true`、`0`：共享依赖的两条路径都展开，且没有环标记；深度为零时不展开直接边。\n\n默认深度为 `20`，必须是非负安全整数；返回的是上游关系的即时视图，不会新增订阅，也不会执行 effect。'
      }
    }
  ],
  getObserverTree: [
    {
      title: {
        en: 'Find current subscribers after an effect releases its subscription',
        zh: '在 effect 释放后查看当前订阅者'
      },
      problem: {
        en: "A signal feeds a computed value and two effects, but one panel has already stopped observing it.\n\nA separately maintained subscriber list can retain the closed panel and mislead an investigation into what can still rerun.\n\nRead the real signal's downstream tree, dispose one effect through its public handle, and inspect again without creating a diagnostic session.",
        zh: '一个信号通过计算值供两个 effect 使用，但其中一个面板已经停止观察。\n\n另外维护订阅者清单，容易留下已经关闭的面板，误导排查人员判断哪些观察者还会重跑。\n\n直接读取真实信号的下游树，用公开句柄释放一个 effect，再次检查；整个过程不需要创建诊断会话。'
      },
      example: {
        en: "import { createRuntime } from '@migaia/reactive'\nimport { getObserverTree } from '@migaia/store-devtools'\n\nconst runtime = createRuntime()\nconst count = runtime.signal(2, { debugName: 'count' })\nconst total = runtime.computed(() => count.value * 2, { debugName: 'total' })\nconst first = runtime.effect(\n  () => {\n    void total.value\n  },\n  { debugName: 'first' }\n)\nconst second = runtime.effect(\n  () => {\n    void total.value\n  },\n  { debugName: 'second' }\n)\ntry {\n  const before = getObserverTree(count)\n  console.log(before.label, before.children[0]!.label)\n  console.log(before.children[0]!.children.map((node) => node.label).join(','))\n  first.dispose()\n  console.log(\n    getObserverTree(count)\n      .children[0]!.children.map((node) => node.label)\n      .join(',')\n  )\n  console.log(getObserverTree(count, 0).children.length)\n} finally {\n  first.dispose()\n  second.dispose()\n  total.dispose()\n  count.dispose()\n}",
        zh: "import { createRuntime } from '@migaia/reactive'\nimport { getObserverTree } from '@migaia/store-devtools'\n\nconst runtime = createRuntime()\nconst count = runtime.signal(2, { debugName: '计数' })\nconst total = runtime.computed(() => count.value * 2, { debugName: '合计' })\nconst first = runtime.effect(\n  () => {\n    void total.value\n  },\n  { debugName: '第一个' }\n)\nconst second = runtime.effect(\n  () => {\n    void total.value\n  },\n  { debugName: '第二个' }\n)\ntry {\n  const before = getObserverTree(count)\n  console.log(before.label, before.children[0]!.label)\n  console.log(before.children[0]!.children.map((node) => node.label).join(','))\n  first.dispose()\n  console.log(\n    getObserverTree(count)\n      .children[0]!.children.map((node) => node.label)\n      .join(',')\n  )\n  console.log(getObserverTree(count, 0).children.length)\n} finally {\n  first.dispose()\n  second.dispose()\n  total.dispose()\n  count.dispose()\n}"
      },
      result: {
        en: 'Output is `count total`, `first,second`, `second`, then `0`: the fresh tree reflects public effect disposal, while a zero depth omits all subscriber edges.\n\nThe default depth is 20; returned trees are point-in-time data and do not update themselves after another subscription change.',
        zh: '输出为 `计数 合计`、`第一个,第二个`、`第二个`、`0`：重新取得的树反映了公开 effect 释放，深度为零则省略全部订阅边。\n\n默认深度为 `20`；返回的树是即时数据，下一次订阅变化后不会自行更新，需要再次读取。'
      }
    }
  ]
}
