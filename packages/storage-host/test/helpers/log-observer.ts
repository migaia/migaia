import type { ILogEntry, ILogPluginCore } from '@migaia/log-host'

/** Expected durable diagnostics stay silent without replacing the real scheduler or lifecycle. */
export function ignoreLogFailure(): void {}

/** A real plugin observes entries through the supported core installation capability. */
export class StorageLogObserver {
  /** Each fixture installs only one observer registration in its logger. */
  readonly name = 'storage-test-log-observer'
  /** Entries retain the owner's exact payload and nested object identities. */
  readonly entries: ILogEntry[] = []

  /** Register the observation with the host's original plugin lifetime. */
  install(core: ILogPluginCore): Record<string, never> {
    core.useSink((entry) => this.receive(entry))
    return {}
  }

  /** Preserve the entry received from the actual host without rebuilding it. */
  receive(entry: ILogEntry): void {
    this.entries.push(entry)
  }
}
