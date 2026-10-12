# `@migaia/rpc-bridge-jsonrpc` 使用手册

本手册面向两类读者：在 TypeScript 端使用桥接的应用开发者（第 1–3、6 节），以及用其它语言实现对端的开发者（第 4–5 节）。安装与最短示例见 [README](./README.md)。

## 目录

1. [TypeScript 端：createJsonRpcRemoteChannel](#1-typescript-端createjsonrpcremotechannel)
2. [获得字节通道：子进程与本机 socket](#2-获得字节通道子进程与本机-socket)
3. [调用与限制](#3-调用与限制)
4. [对端最小实现（Python）](#4-对端最小实现python)
5. [高阶用法：对端协议规范](#5-高阶用法对端协议规范)
6. [错误处理](#6-错误处理)
7. [常见问题](#7-常见问题)

---

## 1. TypeScript 端：createJsonRpcRemoteChannel

```ts
import { createJsonRpcRemoteChannel } from '@migaia/rpc-bridge-jsonrpc'
```

`createJsonRpcRemoteChannel(options)` 在一条有序字节连接上完成 `migaia.hello` 握手，返回协议通道。它通常作为 `createRuntimePeer` 的 `connect` 来源使用（完整示例见 README）。

| 选项                   | 说明                                                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `byte`                 | 有序字节连接（`IProcessByteChannel`），来自 `@migaia/rpc-process` 的 launcher handle 或 socket 适配器。            |
| `peerId`               | 对端标识。                                                                                                        |
| `target`               | `{ kind: 'plugin', contract }`（单个服务）或 `{ kind: 'host', catalog }`（对端是一个插件宿主）。见下文。          |
| `offer`                | 本端提议：`versions`、`peer: { id, runtime }`、`capabilities`。`codecs` 与 `auth` 由本包填写。                     |
| `offer.capabilities`   | 只能从 `deadline@1`、`trace@1`、`idempotency@1`（以及桥接必需能力）中选择；其它能力以 `JSONRPC_PROFILE_INVALID` 拒绝。 |
| `token`                | 会话凭据，随 `migaia.hello` 发给对端认证。                                                                        |
| `scheduler`、`wallClock` | 计时依赖，通常用 `@migaia/utils/scheduler` 的 `systemScheduler` 与 `systemWallClock`。                         |
| `ipc`                  | `{ connectionId, sessionId, log }`：诊断标签与日志回调。                                                          |
| `handshakeTimeoutMs`   | 可选，握手超时；超时以 `JSONRPC_HANDSHAKE_TIMEOUT` 失败。                                                          |
| `signal`               | 可选，取消握手。                                                                                                  |
| `report`               | 接收后台错误。                                                                                                    |

**关于 `target.contract`**：它是本地声明，桥接只用它在建立连接前校验"没有 stream 方法"。真正可以调用的方法以对端 `migaia.describe` 返回的目录为准；调用目录之外的方法会以 `PROVIDER_NOT_FOUND` 拒绝。

必需能力 `jsonrpc-bridge@1`、`runtime-api@1`、`batch@1`、`abort@1`、`wire-error@1` 由本包自动加入提议，不需要在 `offer.capabilities` 中列出。

## 2. 获得字节通道：子进程与本机 socket

**子进程**：用 `@migaia/rpc-process` 的 launcher 启动对端，取 `handle.channel`。`spec.stdio` 设为 `{ stdin: 'channel', stdout: 'channel', stderr: 'drain' }`，对端从 stdin 读、向 stdout 写；stderr 由库持续读取，对端可以放心向 stderr 写日志。用 `bootstrap: { via: 'stdin', payload }` 把 token 交给对端，对端会先读到一个"4 字节大端长度 + 内容"的 bootstrap 帧（见第 5.1 节）。

**本机 socket**：对端已经在监听时，用 `@migaia/rpc-process/adapters/node-socket` 的 `dialProcessByteChannel({ address })` 拨号，把返回的通道作为 `byte`。token 需要通过你自己的方式（例如配置或密钥服务）让双方事先共享。

**所有权**：`connect` 来源只拥有这条连接。`peer.close()` 关闭连接，但不会结束对端进程；如果进程是你启动的，用 `handle.terminate()` 结束它。

## 3. 调用与限制

| 调用                     | 映射到                               | 说明                                                       |
| ------------------------ | ------------------------------------ | ---------------------------------------------------------- |
| `request(method, payload)` | 带 `id` 的 `migaia.invoke`          | 等待对端回复                                               |
| `notify(method, payload)`  | 不带 `id` 的 `migaia.invoke`        | 对端执行但不回复                                           |
| 并发的多个调用           | JSON-RPC 批量数组                    | 对端按数组顺序处理，并以数组回复（notify 不出现在回复中）  |
| `signal` / 超时取消      | `migaia.cancel`                      | 通知对端放弃该调用；不等待确认，不回滚已发生的副作用       |
| `stream`                 | —                                    | 不支持                                                     |
| `transfer`               | —                                    | 不支持                                                     |

- payload 必须是数组，作为对端方法的位置参数列表；传入非数组以 `JSONRPC_PROFILE_INVALID` 拒绝。
- 数据经 JSON 编码。跨语言传整数时，超过 ±(2^53 − 1) 的值请用字符串表示。
- 帧、UTF-8 或 JSON 格式非法时连接会被终止（`JSONRPC_FRAME_INVALID`）。
- 收到未知 `id` 或迟到的回复会被报告并丢弃，不影响其它调用。

## 4. 对端最小实现（Python）

下面的实现只依赖 Python 标准库，已与 README 中的 TypeScript 端实际联调通过：`request`、`notify`、并发批量调用和业务错误都按预期工作。把它保存为 `service.py`，即可作为其它语言实现的参照。

```python
"""A minimal migaia JSON-RPC bridge responder using only the Python standard library."""
import json
import struct
import sys

# 本端提供的业务方法：只支持 request / notify，不支持 stream。
METHODS = {
    "echo": lambda args: args,
    "math.add": lambda args: args[0] + args[1],
}
# 本端握手时声明的能力；前五项是桥接协议的必需能力。
CAPABILITIES = ["jsonrpc-bridge@1", "runtime-api@1", "batch@1", "abort@1", "wire-error@1",
                "deadline@1", "trace@1", "idempotency@1"]
PEER = {"id": "python-service", "runtime": "python"}

stdin, stdout = sys.stdin.buffer, sys.stdout.buffer


def read_exact(size):
    data = stdin.read(size)
    if len(data) != size:
        raise SystemExit(0)
    return data


def read_message():
    """Read one Content-Length frame; return None at EOF."""
    header = b""
    while not header.endswith(b"\r\n\r\n"):
        byte = stdin.read(1)
        if not byte:
            return None
        header += byte
    length = next(int(line.split(b":", 1)[1]) for line in header.split(b"\r\n")
                  if line.lower().startswith(b"content-length:"))
    return json.loads(read_exact(length).decode("utf-8"))


def write_message(message):
    body = json.dumps(message, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    stdout.write(b"Content-Length: %d\r\n\r\n" % len(body) + body)
    stdout.flush()


def wire_error(code, message):
    """JSON-RPC error carrying the migaia wire error tree in data.migaiaWireError."""
    return {"code": -32000, "message": message, "data": {"migaiaWireError": {
        "source": "python-service", "code": code, "name": "Error",
        "message": message, "stack": "Error: " + message}}}


def handle(message, state):
    method, params, ident = message.get("method"), message.get("params", {}), message.get("id")
    if method == "migaia.hello":
        hello = json.loads(params["hello"])
        ok = hello.get("auth") == state["token"] and {"major": 1, "minor": 1} in hello["versions"]
        state["authenticated"] = ok
        if ok:
            reply = {"kind": "handshake", "step": "accept", "protocol": "migaia.rpc",
                     "major": 1, "minor": 1, "codec": "json", "peer": PEER,
                     "capabilities": [c for c in hello["capabilities"] if c in CAPABILITIES]}
        else:
            reply = {"kind": "handshake", "step": "reject", "protocol": "migaia.rpc",
                     "error": wire_error("AUTH_REJECTED", "authentication rejected")["data"]["migaiaWireError"]}
        result = {"reply": json.dumps(reply), "methods": ["migaia.hello", "migaia.describe",
                                                          "migaia.invoke", "migaia.cancel"]}
        return {"jsonrpc": "2.0", "id": ident, "result": result}
    if not state["authenticated"]:
        raise SystemExit(1)
    if method == "migaia.describe":
        return {"jsonrpc": "2.0", "id": ident, "result": {
            "schemaVersion": 2, "self": {"name": "python-service", "instanceId": PEER["id"]},
            "methods": [{"name": name, "supportedModes": ["request", "notify"], "modeSource": "declared"}
                        for name in METHODS]}}
    if method == "migaia.cancel":
        return None  # 本示例的方法都是同步完成，没有可取消的在途调用
    if method == "migaia.invoke":
        provider = METHODS.get(params["method"])
        if ident is None:  # 无 id 即 notify：执行但不回复
            if provider:
                provider(params["args"])
            return None
        if provider is None:
            return {"jsonrpc": "2.0", "id": ident,
                    "error": wire_error("PROVIDER_NOT_FOUND", "method not found")}
        try:
            return {"jsonrpc": "2.0", "id": ident, "result": provider(params["args"])}
        except Exception as error:  # 业务异常转换为 wire error
            return {"jsonrpc": "2.0", "id": ident, "error": wire_error("BUSINESS", str(error))}
    return {"jsonrpc": "2.0", "id": ident, "error": {"code": -32601, "message": "method not found"}}


def main():
    # 父进程先写入一个 4 字节大端长度前缀的 bootstrap 帧，内容是会话 token。
    (length,) = struct.unpack(">I", read_exact(4))
    state = {"token": read_exact(length).decode("utf-8"), "authenticated": False}
    while (message := read_message()) is not None:
        if isinstance(message, list):  # 已协商 batch：逐个处理，按顺序回复数组
            replies = [r for r in (handle(m, state) for m in message) if r is not None]
            if replies:
                write_message(replies)
        else:
            reply = handle(message, state)
            if reply is not None:
                write_message(reply)


main()
```

实现要点：

- 先读 bootstrap 帧拿到 token，再进入 Content-Length 消息循环。
- 握手通过前，除 `migaia.hello` 外的任何消息都应拒绝（示例直接退出）。
- 握手回复中的 `capabilities` 必须包含五个必需能力，`methods` 必须列出全部四个扩展方法，否则 TypeScript 端以 `JSONRPC_EXTENSION_MISSING` 拒绝。
- 回复写到 stdout，日志写到 stderr，不要把日志混进 stdout。

## 5. 高阶用法：对端协议规范

### 5.1 分帧

- **bootstrap 帧**（仅子进程场景、启用 `bootstrap` 时）：连接建立后，对端最先从 stdin 收到一个 4 字节大端无符号长度，紧接着是该长度的 UTF-8 内容（通常是 token）。之后才是 JSON-RPC 消息。
- **消息帧**：`Content-Length: <字节数>\r\n\r\n<UTF-8 JSON>`。长度按 UTF-8 字节计算，不是字符数。头部不超过 1024 字节，单帧不超过 16 MiB。
- 消息体是一个 JSON-RPC 2.0 对象，或者（握手成功后）一个由这些对象组成的数组（批量）。

### 5.2 `migaia.hello`：握手

请求：

```json
{ "jsonrpc": "2.0", "id": "…", "method": "migaia.hello", "params": { "hello": "<JSON 字符串>" } }
```

`params.hello` 是一个 JSON 字符串，解析后为：

```json
{
  "kind": "handshake", "step": "hello", "protocol": "migaia.rpc",
  "versions": [{ "major": 1, "minor": 1 }],
  "codecs": ["json"],
  "capabilities": ["jsonrpc-bridge@1", "runtime-api@1", "batch@1", "abort@1", "wire-error@1", "deadline@1"],
  "peer": { "id": "node-client-1", "runtime": "node" },
  "auth": "<token>"
}
```

对端校验 `auth`，选出双方共同的版本（目前为 1.1）、codec（`json`）与能力，然后回复：

```json
{
  "jsonrpc": "2.0", "id": "…",
  "result": {
    "reply": "<JSON 字符串>",
    "methods": ["migaia.hello", "migaia.describe", "migaia.invoke", "migaia.cancel"]
  }
}
```

`result.reply` 是一个 JSON 字符串。接受时为：

```json
{ "kind": "handshake", "step": "accept", "protocol": "migaia.rpc",
  "major": 1, "minor": 1, "codec": "json",
  "capabilities": ["…双方都支持的能力，按请求中的顺序…"],
  "peer": { "id": "python-service", "runtime": "python" } }
```

拒绝时为 `{ "kind": "handshake", "step": "reject", "protocol": "migaia.rpc", "error": <wire error> }`，wire error 的结构见 5.6 节；凭据错误用 code `AUTH_REJECTED`。

### 5.3 `migaia.describe`：方法目录

请求 `params` 为 `{ "args": [] }`，回复：

```json
{
  "schemaVersion": 2,
  "self": { "name": "python-service", "instanceId": "python-service" },
  "methods": [
    { "name": "echo", "supportedModes": ["request", "notify"], "modeSource": "declared" },
    { "name": "math.add", "supportedModes": ["request", "notify"], "modeSource": "declared" }
  ]
}
```

- `self.instanceId` 必须与握手回复中的 `peer.id` 一致。
- `supportedModes` 只能包含 `request` 与 `notify`；出现 `stream` 时 TypeScript 端以 `JSONRPC_UNSUPPORTED_MODE` 拒绝。
- 可选字段 `idempotent: boolean` 声明该方法是否幂等。

### 5.4 `migaia.invoke`：调用

```json
{ "jsonrpc": "2.0", "id": "7", "method": "migaia.invoke",
  "params": { "method": "math.add", "args": [20, 22], "meta": { "timeoutMs": 30000 } } }
```

- `params.args` 就是 TypeScript 端传入的 payload，必须是数组（按位置的参数列表）：`request('math.add', [20, 22])` 发出 `"args": [20, 22]`；不传 payload 时为 `[]`。
- `params.meta` 可选，只会包含 `timeoutMs`、`idempotencyKey`、`trace` 中实际设置了的字段。对端可以忽略它。
- 成功：`{ "jsonrpc": "2.0", "id": "7", "result": 42 }`。
- 没有 `id` 的 invoke 是 notify：执行，但不回复。
- 方法不存在：回复 wire error，code 为 `PROVIDER_NOT_FOUND`。

### 5.5 `migaia.cancel`：取消

```json
{ "jsonrpc": "2.0", "method": "migaia.cancel", "params": { "id": "7", "reason": "…可选，取消原因…" } }
```

通知对端放弃 `id` 为 `"7"` 的在途调用。这是一条通知，对端不回复确认。之后再到达的该调用结果会被 TypeScript 端丢弃。

### 5.6 错误格式

业务失败时，按 JSON-RPC 规范回复 `error`，并把完整错误信息放在 `data.migaiaWireError`：

```json
{
  "jsonrpc": "2.0", "id": "7",
  "error": {
    "code": -32000,
    "message": "list index out of range",
    "data": {
      "migaiaWireError": {
        "source": "python-service", "code": "BUSINESS", "name": "Error",
        "message": "list index out of range", "stack": "Error: list index out of range"
      }
    }
  }
}
```

wire error 至少包含 `source`、`code`、`name`、`message`、`stack`；可选的 `cause` 与 `errors` 用于嵌套原因。JSON-RPC 整数 `code` 建议使用标准值：`-32700`（解析错误）、`-32600`（无效请求）、`-32601`（方法不存在）、`-32602`（参数无效）、`-32603`（内部错误）、`-32000`（业务错误）。

TypeScript 实现的对端可以直接用 `@migaia/rpc-contract/errors` 的 `toJsonRpcError(serialized, code)` 与 `fromJsonRpcError(value)` 生成和解析这种格式，并用 `@migaia/rpc-contract/framing/jsonrpc` 的 `encodeJsonRpcFrame`、`createJsonRpcFrameDecoder` 处理 Content-Length 分帧。

### 5.7 批量

握手成功后，TypeScript 端可能把多个调用放进一个数组发送。对端应按数组顺序逐个处理，并把所有带 `id` 的回复按顺序放进一个数组写回；某个成员失败不影响其它成员。全是 notify 的批量不需要回复。

## 6. 错误处理

### 本包错误码

source 均为 `@migaia/rpc/bridge/jsonrpc`。

| code                         | 何时发生                                                     | 处理                                                       |
| ---------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------- |
| `JSONRPC_FRAME_INVALID`      | 头部、UTF-8、JSON 非法，或连接在一帧中途关闭；连接随之终止  | 修正对端的分帧与编码；已发出的调用先对账                   |
| `JSONRPC_EXTENSION_MISSING`  | 握手回复缺少必需能力或四个扩展方法                           | 对端补齐扩展实现                                           |
| `JSONRPC_PROFILE_INVALID`    | 本端选项不合法，或提议了桥接不支持的能力                     | 修正选项；原样重试无效                                     |
| `JSONRPC_UNSUPPORTED_MODE`   | 本地声明或对端目录中包含 stream 方法                         | 流式场景改用原生协议                                       |
| `JSONRPC_HANDSHAKE_TIMEOUT`  | 握手超时                                                     | 检查对端是否在读 stdin / socket，然后重新建立连接          |

这些常量从包根导入：

```ts
import { JSONRPC_BRIDGE_ERROR_SOURCE, JsonRpcBridgeErrorCode } from '@migaia/rpc-bridge-jsonrpc'
```

### 对端返回的业务错误

通过 `createProcessPeer` 或 `createRuntimePeer` 调用时，对端回复的 wire error 按原始 `name`、`source`、`code`、`message`、`stack` 和原因链恢复。Python 示例中的业务错误因此携带 `source: 'python-service'`、`code: 'BUSINESS'`。这些字段只用于诊断，不会获得本地库的控制身份；不要用对端声明的 source / code 判断本地取消、重试或认证策略。

### 重试原则

超时、取消或连接中断都不能证明对端没有执行。对非幂等方法，重试前请先确认结果，或者让对端在 `meta.idempotencyKey` 上实现去重。

## 7. 常见问题

**握手一直超时？**
确认对端在读 stdin（或 socket），并且回复写到了 stdout 而不是 stderr；确认先消费了 bootstrap 帧。

**对端日志打乱了协议？**
stdout 只能输出协议帧，日志写 stderr。

**需要流式返回？**
桥接不支持。可以拆成分页的 `request`，或者把对端改为原生协议实现。

**对端能主动调用 TypeScript 端吗？**
桥接协议在同一连接上允许对端发送 `migaia.invoke`，调用 TypeScript 端 `provide` 的方法。本手册的示例只演示 TypeScript 端发起调用；需要反向调用时，请先在你的场景中验证。
