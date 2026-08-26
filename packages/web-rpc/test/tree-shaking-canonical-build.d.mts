export const input: string
export const packageDirectory: string
export function resolveCanonicalBuildConfig(): Promise<
  Record<string, unknown> & { webSocketToken?: string }
>
export function buildCanonicalRetainedGraph(): Promise<unknown>
