import { definePlugin, PluginHost } from '../src/index.js'

declare const host: PluginHost<Record<string, never>>
const a = definePlugin({ name: 'a', install: () => ({ a: () => 1 }) })
const b = definePlugin({ name: 'b', install: () => ({ b: () => 2 }) })

const handles = await host.use(a, b)
handles[0].extensions.a()
handles[1].extensions.b()
// @ts-expect-error Handles expose plugin capabilities, not Host mutations.
handles[0].use(b)
// @ts-expect-error Handles never carry the retired `view.host` back-reference (probe P1).
void handles[0].host
// @ts-expect-error Handles never expose Host-level unUse (retired `view.unUse`).
void handles[0].unUse
void handles[0].config.get()
// @ts-expect-error Duplicate literal plugin names are rejected in one batch.
await host.use(a, a)
