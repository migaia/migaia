import assert from 'node:assert/strict'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Optional immutable baseline build permits the same real-GC oracle to prove the prior defect. */
const runtimeDirectory = process.argv[2]
  ? pathToFileURL(`${resolve(process.argv[2])}${sep}`)
  : new URL('../../dist/', import.meta.url)
const { definePlugin, isPluginHandleCurrent, PluginHost } = await import(
  new URL('index.js', runtimeDirectory)
)
const { PluginHostState } = await import(new URL('host-state.js', runtimeDirectory))

/** Exact registration captured weakly at the canonical logical-removal boundary. */
let removedRegistration
/** Completion evidence from the collector; it never holds the target registration. */
let collected = false
/** Observe the exact removed object, rather than inferring collection from heap size. */
const finalization = new FinalizationRegistry(() => {
  collected = true
})
/** Preserve the owning implementation while observing its input without a strong reference. */
const closeRegistration = PluginHostState.prototype.closeRegistration
PluginHostState.prototype.closeRegistration = function (registration) {
  removedRegistration = new WeakRef(registration)
  finalization.register(registration, 'removed-registration')
  return Reflect.apply(closeRegistration, this, [registration])
}

/** Keep the real Host and both generations' handles alive throughout garbage collection. */
const host = new PluginHost({
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
})
/** Reinstalling one definition must issue a different registration token even with reused output. */
const output = { value: 'shared-output' }
/** The owner and its output intentionally remain reachable; only the registration must be freed. */
const plugin = definePlugin({ name: 'collectable', install: () => output })
/** This handle outlives removal and still reads replacement members by name. */
const [original] = await host.use(plugin)
assert.equal(isPluginHandleCurrent(original), true)
await host.unUse('collectable')
PluginHostState.prototype.closeRegistration = closeRegistration
assert.equal(isPluginHandleCurrent(original), false)
/** A second registration of the identical definition and output must not revive the old probe. */
const [replacement] = await host.use(plugin)
assert.equal(isPluginHandleCurrent(original), false)
assert.equal(isPluginHandleCurrent(replacement), true)
assert.equal(original.extensions.value, output.value)

for (let attempt = 0; attempt < 100 && !collected; attempt++) {
  // WeakRef dereferences stay alive until the current job ends; yield before requesting GC.
  await nextTurn()
  globalThis.gc()
  await nextTurn()
}
assert.equal(collected, true, 'removed registration must be collectable with its old handle alive')
assert.equal(removedRegistration.deref(), undefined)
assert.equal(isPluginHandleCurrent(original), false)
assert.equal(isPluginHandleCurrent(replacement), true)
assert.equal(original.extensions.value, output.value)
console.log(JSON.stringify({ collected, oldCurrent: false, replacementCurrent: true }))
await host.dispose()
