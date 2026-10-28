/**
 * Owns the private concrete-Host claims and anchor sequence shared by creation and disposal. Does
 * not retain concrete Hosts after their managed session releases its WeakMap claim.
 */

/** The exact creation token prevents another session from disposing an already claimed Host. */
export const claims = new WeakMap<object, object>()
/** Monotonic names keep private anchors distinct without entering the managed Graph namespace. */
let anchorSequence = 0

/** Allocates the next private anchor name in the original construction order. */
export function createAnchorName(): string {
  return `__migaia_tray_anchor_${anchorSequence++}`
}
