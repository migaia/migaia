# `@migaia/middleware-pipeline` 使用指南

## 1. sync

```ts
runSyncMiddleware(stages, value, done, onViolation);
```

sync stage 的 `next()` 只记录下一阶段输入。下游 stage 会在当前 stage 返回后执行，因此调用 `next()` 后没有下游返回值可等待。

不调用 `next()` 会短路整条链；重复调用会触发 `duplicate`，stage 返回后调用会触发 `late`。具体如何记录或抛错由调用方提供 `onViolation`。

## 2. async

```ts
await runAsyncMiddleware(stages, value, done, {
  onViolation,
  assertActive,
  combineStageAndDownstreamError
});
```

async stage 的 `next()` 返回 Promise。`await next(value)` 会等待完整下游链，因此可以执行后置逻辑。

`assertActive` 由宿主提供，用于在进入 stage 和下游完成后检查 host 是否仍然有效。执行器不认识 lifecycle 或 plugin-host 状态。

如果当前 stage 和下游同时失败，执行器调用 `combineStageAndDownstreamError(stageError, downstreamError)`，参数顺序固定为 `[stageError, downstreamError]`，即使两个 rejection value/identity 相同。plugin-host 在此处创建带 `PIPELINE_FAILED` 的错误；独立消费者使用默认 `AggregateError`，并获得 `@migaia/middleware-pipeline + EXECUTION_FAILED` 契约。只失败一个 channel 时抛出 exact value；`next()` 返回原生 Promise，不追踪消费、constructor、species 或 Promise lineage，组合器返回 `undefined`/`null` 时也原样抛出。

下游 stage 入口或成功但未调用 `next()` 后，`assertActive` 是 runner-owned control path。上游以 `await next()` 或 `return next()` 传播该 exact active error，不生成重复双失败 slots；普通同一 identity 双失败仍按上面的组合规则处理。plugin-host 的 `PIPELINE_FAILED` 组合器只处理普通双失败，不处理该 control path。

## 3. generator

```ts
runGeneratorMiddleware(stages, value, done);
```

- 普通 return value：作为下一 stage 输入。
- `GENERATOR_CONTINUE`：使用最后一次 yield 的值继续。
- `GENERATOR_HALT`：终止整条链且不调用 done。
- `GENERATOR_UNDEFINED`：显式传递 undefined。

generator stage 可以多次 yield，但只有最后一次 yield 参与 `GENERATOR_CONTINUE`。

## 4. 生命周期边界

执行器不创建后台任务，不保存跨调用资源，也不提供 `close()`/`drain()`。plugin-host 负责 stage registration 的 disposer 和运行期间的深度门禁。

如果系统需要有界队列、并发槽位、超时、取消 in-flight 或 drain，应设计独立的 dispatcher，并使用 lifecycle 的 scope、pending tracker 和 deadline 语义；不要把这些能力添加到本包。

## 5. tree-shaking

所有执行器位于同一 ESM 入口且没有顶层副作用。消费方只 import 所需函数；构建级测试会打包一个 sync-only 入口，并断言 generator sentinel 与 async 双失败路径不进入产物。只有未来出现无法被 bundler 消除的跨模式依赖时，才考虑增加 `/sync`、`/async`、`/generator` 子路径，当前不为形式上的拆包增加公开入口。
