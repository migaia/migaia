/** Both real browser carriers exercise the same application surface through the public Peer. */
export type IBrowserFixtureApi = {
  echo(value: string): string
  record(value: string): void
  recorded(): string[]
  values(value: number): AsyncIterableIterator<number>
  hold(): Promise<void>
  sessions(): Promise<number>
}

/** Providers contain business data only; the actual Core Peer owns protocol and lifecycle state. */
export function fixtureProviders() {
  /** Notifications remain observable through an ordinary typed request after delivery. */
  const recorded: string[] = []
  return {
    echo: (value: string) => value,
    record: (value: string) => {
      recorded.push(value)
    },
    recorded: () => [...recorded],
    values: async function* (value: number) {
      yield value
      yield value + 1
    },
    hold: () => new Promise<void>(() => undefined)
  }
}
