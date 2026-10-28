/**
 * Owns the private WeakMap connecting genuine probe handles to compiled callback/mask records.
 * Definition and emitter collaborators use this single registration and stage-subscription
 * boundary; public structural fields do not grant probe identity or execution authority.
 */
import type { IRpcProbe, IRpcProbeDefinition } from './types.ts'

/**
 * Only package-owned emitters can access compiled fields, callbacks and stage-change subscribers.
 * Installs these references once into an emitter's fixed-shape record; hot paths never read hosts.
 */
export type IRpcProbeState = {
  stageMask: number
  readonly captureMask: number
  readonly methods: ReadonlySet<string> | undefined
  readonly sampleThreshold: number
  readonly emit: IRpcProbeDefinition['emit']
  readonly redact: IRpcProbeDefinition['redact']
  readonly describe: IRpcProbeDefinition['describe']
  readonly onError: IRpcProbeDefinition['onError']
  readonly listeners: Set<() => void>
}

/** Handles own no public installation API; private state survives only while a handle is retained. */
const probeStates = new WeakMap<IRpcProbe, IRpcProbeState>()

/** Registers a newly compiled genuine probe without activating any emitter or transport. */
export function registerProbeState(probe: IRpcProbe, state: IRpcProbeState): void {
  probeStates.set(probe, state)
}

/** Reads genuine definition state; structural handles have no package-owned callbacks. */
export function readProbeState(probe: IRpcProbe): IRpcProbeState | undefined {
  return probeStates.get(probe)
}

/** Reads the current cold subscription mask, including frozen hosts whose public mask is initial. */
export function readProbeStages(probe: IRpcProbe): number {
  return probeStates.get(probe)?.stageMask ?? probe.stageMask
}

/** Subscribes once per changed stage mask; the returned release removes the cold subscription. */
export function subscribeProbeStages(probe: IRpcProbe, listener: () => void): () => void {
  /** Only a probe minted by defineProbe owns the private subscription list. */
  const state = probeStates.get(probe)
  state?.listeners.add(listener)
  return () => {
    state?.listeners.delete(listener)
  }
}
