# `@migaia/tray`

运行时中立的静态组合根：一次声明完整的 capability 集合，按依赖顺序启动，并在全部 entry 就绪后安全取值。Tray 基于 [`@migaia/capability/graph`](../capability/README.md)，Graph 负责启动、依赖、释放与 Promise 身份；Tray 只提供更小、更适合应用装配的公开面。

## 适用边界

**适用**：同一 realm 内、启动前就能确定完整集合的配置、服务、资源与派生值。

**不适用**：运行期动态增删、通知 UI、跨 realm/Worker 传输、宿主强制终止。这些能力不在 Tray core 内，避免让静态组合根承担领域和平台策略。

## 安装

```bash
pnpm add @migaia/tray
```

静态组合根从 `@migaia/tray` 导入；PluginHost 托管组合从 `@migaia/tray/host` 导入。

## 最小可运行示例

```ts
import { createTray, type ITrayEntryDefinition, type ITrayKey } from '@migaia/tray';

const key = (value: string): ITrayKey => value as ITrayKey;
const configKey = key('config');
const apiKey = key('api');

const entries: readonly ITrayEntryDefinition<unknown>[] = [
  {
    key: configKey,
    kind: 'value',
    start: () => ({ value: { baseUrl: '/api' }, release: () => undefined })
  },
  {
    key: apiKey,
    kind: 'service',
    requires: [configKey],
    start: (context) => {
      const config = context.get<{ baseUrl: string }>(configKey);
      const client = { baseUrl: config.baseUrl };
      return { value: client, release: () => undefined };
    }
  }
];

const tray = createTray(entries);
await tray.ready();
const api = tray.get<{ baseUrl: string }>(apiKey);

try {
  console.log(api.baseUrl);
} finally {
  await tray.dispose();
}
```

关键规则：

- `createTray()` 只接收完整数组；key 必须是非空字符串且不能重复，`requires` 只能引用同一数组内的其他 entry。
- `start()` 必须返回或 resolve 为 `{ value, release }`；依赖可通过 `context.get()` 读取。
- 必须先 `await tray.ready()` 再 `get()`。未就绪、失败、未知 key 或已释放时都会显式失败，不返回半初始化值。
- `dispose()` 由 Graph 按依赖逆序释放，幂等并保留清理失败。

## 错误处理

所有 Tray 自有边界错误都带 `source: '@migaia/tray'` 与稳定 `code`。生产代码按 `(source, code)` 分支，不依赖 message：

```ts
import { TRAY_SOURCE, TrayErrorCode } from '@migaia/tray';

try {
  tray.get(apiKey);
} catch (error) {
  const diagnostic = error as { source?: string; code?: string };
  if (diagnostic.source === TRAY_SOURCE && diagnostic.code === TrayErrorCode.unavailable) {
    // 等待 ready()，或处理启动/就绪门失败。
  } else {
    throw error;
  }
}
```

完整 entry 契约、readiness gate、状态、错误码与生命周期语义见 [USEGUIDE.md](./USEGUIDE.md)。

## 托管 PluginHost：动态加载与卸载

`@migaia/tray/host` 是 Tray 的 Host stage/decorator，不创建第二个运行时身份。`createHost()`
异步完成 admission、依赖图启动与 Host 发布后才返回；返回值实现异步显式资源管理：

```ts
import { PluginHost, type IPlugin } from '@migaia/plugin-host';
import { createHost } from '@migaia/tray/host';

class AppHost extends PluginHost<Record<string, never>, string> {}

const provider = {
  name: 'provider',
  install: () => ({ providerValue: 1 })
} satisfies IPlugin<AppHost, { readonly providerValue: number }>;

await using host = await createHost({
  create: () =>
    new AppHost({ execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: 100 } }),
  plugins: [provider] as const,
  mutationAdmissionMs: 100,
  quiescenceMs: 100,
  shutdown: { mode: 'bounded' }
});

await host.use({ name: 'late', requires: ['provider'], install: () => ({ late: true }) });
await host.unUse('provider'); // `late` 保留为 blocked definition，不再留在 Host 可见面。
```

同名 `replace()` 与 provider 恢复会复用该 definition 的 Host ordering slot；真正
`unUse()` 删除 definition 后 slot 永久退休，之后同名 `use()` 获得新的单调 slot。逻辑 bounded
结果可能先返回 `cleanupComplete: false`，但 `physicalCompletion` 严格等待 Graph binding lease、
pipeline lease、插件 disposer 与资源 disposer，未完成前不会启动后项。不能使用
`await using` 的编译目标可用 `try/finally { await host.dispose() }`。
