# @migaia/log-plugin-reasoning

Thinking and response streaming phases for `@migaia/log-host`. Fragments go directly to a borrowed writer. Completing a phase also dispatches one structured entry containing its full text.

```ts
import { createLogHost } from '@migaia/log-host'
import { reasoningPlugin } from '@migaia/log-plugin-reasoning'

/** The application records the original text of each stream write. */
const fragments: string[] = []
/** Each installation owns independent phase and buffer state. */
const log = createLogHost({
  plugins: [
    reasoningPlugin({
      write: (text) => {
        fragments.push(text)
      }
    })
  ]
})
log.startThinking('Thinking')
log.thinking('inspect ')
log.thinking('the request')
log.endThinking()
log.startResponse()
log.response('Done.')
log.endResponse()
await log.shutdown('manual')
```

The six methods are `startThinking`, `thinking`, `endThinking`, `startResponse`, `response` and `endResponse`. The writer receives text without plugin-generated ANSI. By default, a recognized server runtime lends its stdout; without stdout, output falls back to `console.log`.

Completed entries have a `thinking` or `response` tag and data containing `reasoningPhase` and `silent: true`. Console output skips these entries while HTTP/file outputs can retain the complete text. This package depends on no console package and requires no host raw method.

`asyncOutput` defaults to false. Enabling it schedules stream writes and completed-entry dispatch through the host. Synchronous writer failures enter the host failure channel. Uninstall discards unfinished text without publishing a completed entry. The package's peer version must match the host version.

See [USEGUIDE.en.md](./USEGUIDE.en.md) for phase behavior and options.
