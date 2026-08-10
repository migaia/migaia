# @migai/logger

插件化、运行时中立的 Logger。核心负责 entry、pipeline、sink、flush 与 shutdown；日志级别、控制台渲染、批处理、HTTP、进程退出和流式 reasoning 都是可选插件。

构造参数只接受同步安装插件；异步插件必须通过 `await log.use(plugin)` 安装。

## 快速开始

```ts
import { Logger } from '@migai/logger';
import { color, level } from '@migai/logger/plugins';

const log = new Logger({
  context: ['api'],
  plugins: [level({ level: 'info' }), color({ format: 'pretty', color: 'auto' })]
});

log.info('server listening on %d', 3000);
log.error('request failed', new Error('timeout'));
await log.flush();
```

## 基础 API

- `log.log(tag, message, ...args)`：console-style 日志入口。
- `log.dispatchRaw({ tag, message, meta, data, context, error })`：显式结构化 entry。
- `log.flush()`：等待已观察的异步输出、batch 与 extends 目标。
- `log.shutdown(reason)`：执行 shutdown handler、drain、清理插件；之后日志被忽略。
- `log.onFailure(fn)`：观察 sink、pipeline、flush 等失败，不打断业务日志调用。

## 内置插件

- `level()`：添加 `debug/info/warn/error/fatal`。
- `color()`：控制台 pretty/JSON 渲染及 ANSI 颜色。
- `batch()`：提供批处理 shared factory。
- `http()`：发送 entry 到 HTTP endpoint，可选复用 batch。
- `process()`：Node/Bun 风格进程信号与 graceful shutdown 适配。
- `reasoning()`：流式 thinking/response 输出。
- `uuid()`：为每条 entry 加 UUID。

完整 API、所有配置项、插件顺序、生命周期、HTTP 重试与浏览器运行时说明见 [USEGUIDE.md](./USEGUIDE.md)。
