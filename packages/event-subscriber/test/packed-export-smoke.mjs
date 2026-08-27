import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDirectory = resolve(fileURLToPath(new URL('..', import.meta.url)))
const utilsPackageDirectory = resolve(packageDirectory, '../utils')
const smokeDirectory = mkdtempSync(join(tmpdir(), 'migaia-event-subscriber-packed-'))
const extractDirectory = join(smokeDirectory, 'extract')
const consumerDirectory = join(smokeDirectory, 'consumer')

/**
 * Verifies the published root at both runtime and TypeScript declaration resolution boundaries. The
 * package is resolved from an extracted tarball, never from the workspace source tree.
 */
function main() {
  try {
    mkdirSync(extractDirectory, { recursive: true })
    mkdirSync(join(consumerDirectory, 'node_modules', '@migaia'), { recursive: true })
    const eventExtractDirectory = join(extractDirectory, 'event')
    const utilsExtractDirectory = join(extractDirectory, 'utils')
    mkdirSync(eventExtractDirectory, { recursive: true })
    mkdirSync(utilsExtractDirectory, { recursive: true })
    const packedPackage = join(eventExtractDirectory, 'package')
    const packedUtilsPackage = join(utilsExtractDirectory, 'package')
    execFileSync('tar', ['-xzf', pack(packageDirectory, 'event'), '-C', eventExtractDirectory])
    execFileSync('tar', ['-xzf', pack(utilsPackageDirectory, 'utils'), '-C', utilsExtractDirectory])
    const packedFiles = readdirSync(join(packedPackage, 'dist'), { recursive: true })
    if (
      packedFiles.some((entry) => {
        const filePath = join(packedPackage, 'dist', String(entry))
        return (
          existsSync(filePath) &&
          statSync(filePath).isFile() &&
          readFileSync(filePath, 'utf8').includes('setSubscriptionReleaseProbe')
        )
      })
    ) {
      throw new Error('packed artifact contains subscription probe instrumentation')
    }
    symlinkSync(
      packedPackage,
      join(consumerDirectory, 'node_modules', '@migaia/event-subscriber'),
      'dir'
    )
    symlinkSync(packedUtilsPackage, join(consumerDirectory, 'node_modules', '@migaia/utils'), 'dir')
    mkdirSync(join(packedPackage, 'node_modules', '@migaia'), { recursive: true })
    symlinkSync(packedUtilsPackage, join(packedPackage, 'node_modules', '@migaia/utils'), 'dir')
    writeFileSync(join(consumerDirectory, 'package.json'), '{"type":"module"}\n', 'utf8')
    writeFileSync(
      join(consumerDirectory, 'runtime.mjs'),
      "import { createEventChannel, createEventHub, defineEventApiStyle, invokeParallelSettled } from '@migaia/event-subscriber';\nconst channel = createEventChannel(); const legacy = channel.subscribe(() => {}); if (legacy.unsubscribe !== legacy) throw new Error('legacy self identity'); const chain = legacy.subscribe(() => {}); chain.unsubscribe(); if (channel.size !== 0) throw new Error('channel chain close'); const styled = createEventChannel({ style: 'on-emit' }); const styledHandle = styled.on(() => {}).on(() => {}); if (styled.on !== styled.subscribe || styled.emit !== styled.publish || styledHandle.on !== styledHandle.subscribe || styledHandle.off !== styledHandle) throw new Error('style identity'); await invokeParallelSettled(styled, 1); styledHandle.off(); const style = defineEventApiStyle({ subscribe: 'observe', publish: 'dispatch', unsubscribe: 'dispose' }); const custom = createEventChannel({ style }); const customHandle = custom.observe(() => {}).observe(() => {}); if (customHandle.dispose !== customHandle || customHandle.unsubscribe !== customHandle) throw new Error('custom cancellation identity'); customHandle.dispose(); const listen = createEventChannel({ style: 'listen-fire' }); const listenHandle = listen.listen(() => {}); if (listenHandle.unlisten !== listenHandle) throw new Error('listen cancellation identity'); listenHandle.unlisten(); const hub = createEventHub(); const hubHandle = hub.subscribe('ready', () => {}); if (hubHandle.unsubscribe !== hubHandle) throw new Error('hub self identity'); hubHandle.subscribe('done', () => {}); hubHandle(); if (hub.size() !== 0) throw new Error('hub chain close'); const styledHub = createEventHub({ style: 'listen-fire' }); if (styledHub.listen !== styledHub.subscribe || styledHub.fire !== styledHub.publish) throw new Error('hub style identity'); const customHub = createEventHub({ style }); if (customHub.observe !== customHub.subscribe || customHub.dispatch !== customHub.publish) throw new Error('custom hub style identity'); const module = await import('@migaia/event-subscriber'); for (const legacyName of ['publishParallelSettled', 'publishParallel', 'publishSerialSettled', 'publishSerial', 'publishTaskSettled', 'publishTask']) if (legacyName in module) throw new Error('legacy helper export');\n",
      'utf8'
    )
    writeFileSync(
      join(consumerDirectory, 'types.ts'),
      "import { createEventChannel, createEventHub, defineEventApiStyle, invokeParallel, invokeParallelSettled, invokeSerial, invokeSerialSettled, invokeTask, invokeTaskSettled, type IEventChannelSubscription, type IEventHubSubscription, type IEventContext } from '@migaia/event-subscriber';\nconst channel = createEventChannel<number>();\nconst listener = (event: IEventContext<number>): void => { void event.value; };\nconst textListener = (event: IEventContext<string>): void => { void event.value; };\nconst channelHandle: IEventChannelSubscription<number> = channel.subscribe(listener);\nchannelHandle.subscribe(listener);\n// @ts-expect-error The default style does not install the on alias.\nchannel.on(listener);\nconst styled = createEventChannel<number>({ style: 'on-emit' });\nconst styledHandle = styled.on(listener).on(listener); styledHandle.off(); styled.emit(1);\nconst style = defineEventApiStyle({ subscribe: 'observe', publish: 'dispatch', unsubscribe: 'dispose' });\nconst custom = createEventChannel<number, void, typeof style>({ style });\nconst customHandle = custom.observe(listener).observe(listener); customHandle.dispose(); custom.dispatch(1);\nconst listenStyle = createEventChannel<number>({ style: 'listen-fire' });\nlistenStyle.listen(listener).unlisten(); listenStyle.fire(1);\nconst asConstStyle = { subscribe: 'watch', publish: 'send' } as const;\nconst asConstCustom = createEventChannel<number, void, typeof asConstStyle>({ style: asConstStyle });\nasConstCustom.watch(listener); asConstCustom.send(1);\nconst widenedStyle: { readonly subscribe: string; readonly publish: string } = { subscribe: 'observe', publish: 'dispatch' };\nconst widened = createEventChannel<number, void, typeof widenedStyle>({ style: widenedStyle });\n// @ts-expect-error A widened custom style must not expose an arbitrary exact alias.\nwidened.observe(listener);\n// @ts-expect-error Channel custom styles require the explicit third style generic.\ncreateEventChannel<number>({ style: { subscribe: 'observe', publish: 'dispatch' } });\n// @ts-expect-error custom collision is rejected at the options boundary\ncreateEventChannel<number, void, { readonly subscribe: 'publish'; readonly publish: 'emit' }>({ style: { subscribe: 'publish', publish: 'emit' } });\nconst hub = createEventHub<{ ready: number; done: string }>();\nconst hubHandle: IEventHubSubscription<{ ready: number; done: string }, 'ready'> = hub.subscribe('ready', listener);\nhubHandle.subscribe('done', (event) => { const value: string = event.value; void value; });\n// @ts-expect-error finite key cannot repeat in one chain\nhubHandle.subscribe('ready', listener);\nconst styledHub = createEventHub<{ ready: number; done: string }>({ style: 'on-emit' });\nconst styledHubHandle = styledHub.on('ready', listener).on('done', textListener); styledHubHandle.off();\nconst customHub = createEventHub<{ ready: number }, typeof style>({ style });\nconst customHubHandle = customHub.observe('ready', listener); customHubHandle.dispose(); customHub.dispatch('ready', 1);\n// @ts-expect-error Hub custom styles require the explicit second style generic.\ncreateEventHub<{ ready: number }>({ style: { subscribe: 'observe', publish: 'dispatch' } });\nconst wide = createEventHub<Record<string, number>>();\nwide.subscribe('dynamic', listener).subscribe('dynamic', listener);\nconst result = invokeParallelSettled(channel, 1); const result2 = invokeParallel(channel, 1); const result3 = invokeSerialSettled(channel, 1); const result4 = invokeSerial(channel, 1); const result5 = invokeTaskSettled(channel, 'task', 1); const result6 = invokeTask(channel, 'task', 1); void [result, result2, result3, result4, result5, result6];\n// @ts-expect-error legacy publish helper exports are intentionally removed.\nimport { publishParallel } from '@migaia/event-subscriber';\nvoid publishParallel;\n",
      'utf8'
    )
    execFileSync(process.execPath, [join(consumerDirectory, 'runtime.mjs')], {
      cwd: consumerDirectory,
      stdio: 'inherit'
    })
    execFileSync(
      'pnpm',
      [
        'exec',
        'tsc',
        '--noEmit',
        '--strict',
        '--skipLibCheck',
        '--target',
        'ES2022',
        '--module',
        'NodeNext',
        '--moduleResolution',
        'NodeNext',
        'types.ts'
      ],
      { cwd: consumerDirectory, stdio: 'inherit' }
    )
  } finally {
    rmSync(smokeDirectory, { recursive: true, force: true })
  }
}

/** Packs the current package and returns the only generated tarball. */
function pack(packageRoot, packageLabel) {
  const packDirectory = join(smokeDirectory, `pack-${packageLabel}`)
  mkdirSync(packDirectory, { recursive: true })
  execFileSync('pnpm', ['pack', '--pack-destination', packDirectory], {
    cwd: packageRoot,
    stdio: 'inherit'
  })
  const tarballs = readdirSync(packDirectory).filter((entry) => entry.endsWith('.tgz'))
  if (tarballs.length !== 1 || !existsSync(join(packDirectory, tarballs[0])))
    throw new Error(`Expected exactly one event-subscriber tarball, found ${tarballs.length}`)
  return join(packDirectory, tarballs[0])
}

main()
