/** Registers one stage and records an idempotent disposer for its exact array slot. */
export const registerStage = <TStage>(
  stages: TStage[],
  stage: TStage,
  track: (dispose: () => void) => void
): void => {
  stages.push(stage)
  let active = true
  track(() => {
    if (!active) return
    active = false
    const index = stages.indexOf(stage)
    if (index !== -1) stages.splice(index, 1)
  })
}
