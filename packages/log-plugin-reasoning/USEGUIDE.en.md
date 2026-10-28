# Reasoning streaming guide

## Creation and phase methods

Install matching versions of `@migaia/log-host` and `@migaia/log-plugin-reasoning`. `createLogHost({ plugins: [reasoningPlugin(options)] })` infers six phase methods without requiring a level or console plugin.

| Method                  | Behavior                                                                  |
| ----------------------- | ------------------------------------------------------------------------- |
| `startThinking(label?)` | Enter thinking, first completing an active response                       |
| `thinking(delta)`       | Append the original fragment, starting thinking automatically when needed |
| `endThinking()`         | Write two newlines and complete the current thinking phase                |
| `startResponse(label?)` | Enter response, first completing active thinking                          |
| `response(delta)`       | Append the original fragment, starting response automatically when needed |
| `endResponse()`         | Write one newline and complete the current response                       |

Explicitly starting the same phase again resets its buffer. Empty buffers produce no completed entry. A call-level label takes precedence over `labels.thinking` / `labels.response`. Thinking defaults to `Thinking...`; response has no default heading. Headings end with two newlines. Fragments receive no extra newlines or ANSI.

## Writer and scheduling

```ts
import { createLogHost } from '@migaia/log-host'
import { reasoningPlugin } from '@migaia/log-plugin-reasoning'

/** Preserve each original stream write and its fragment boundary. */
const fragments: string[] = []
/** Explicitly enable asynchronous stream scheduling tracked by the host. */
const log = createLogHost({
  plugins: [
    reasoningPlugin({
      labels: { thinking: 'Plan', response: 'Answer' },
      asyncOutput: true,
      write: (text) => {
        fragments.push(text)
      }
    })
  ]
})
log.thinking('inspect')
log.response('ready')
log.endResponse()
await log.flush()
await log.shutdown('manual')
```

`write(text): void` is a borrowed synchronous capability. Uninstall does not close it. Without an injected writer, recognized server runtimes lend `process.stdout.write`; without stdout, the fallback is `globalThis.console?.log(text)`. `asyncOutput` defaults to false: stream writes happen immediately while completed entries still enter the asynchronous host pipeline. When enabled, both writes and completed-entry dispatch use host-tracked scheduling. `flush()` waits for admitted work.

## Completed entries and outputs

Ending or switching a nonempty phase publishes its full text as one message. Thinking uses `thinking` for both tag and data.reasoningPhase. Response uses the `response` tag and `responding` for data.reasoningPhase. Both set `data.silent: true`. The console plugin skips these entries. HTTP/file outputs still receive them for complete-text storage.

`ReasoningPhase` provides the stable values `idle`, `thinking` and `responding`. The plugin depends on no console package, acquires no color capability and calls no host/core raw method. Output format features still control other ordinary entries.

## Failures and release

Synchronous writer failures reach the host failure channel with the original error and do not leave phase methods. The plugin introduces no error codes; `LogReasoningErrorCode` is empty. After uninstall, retained phase methods become no-ops. Unfinished text is discarded without publishing a completed entry. Call the relevant end method before flush/shutdown when the full phase must be retained.
