# @migaia/part-plugin-devtools

A development-only inspection panel for part hosts: per part address it shows enhancement steps, the resolved configuration, bound state, derive dependencies, events and effect runs. It works only under the `development` condition; production builds resolve to a no-op plugin of the same name, so bundles carry no panel code.

## Start here

```ts
import { devtoolsPlugin } from '@migaia/part-plugin-devtools'

const host = await createPartHost({ plugins: [domPlugin, reactPlugin, devtoolsPlugin, ...appPlugins] })
```

Press `Alt+Shift+D` to toggle the panel; click "Pick" and then a page element to select its nearest ancestor with `data-part-address`. The plugin adds the Feature `devtools`: `open()`, `close()`, `select(address)`, `selected()`.

All data comes from the host's `trace` and `state` Features; the panel never reads host internals and is read-only (edit through the editor). See [USEGUIDE.en.md](USEGUIDE.en.md).
