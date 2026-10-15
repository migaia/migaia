/** Removes an expired ordered prefix once, preserving timestamps exactly on the live boundary. */
export function trimTimestampWindow(timestamps: number[], now: number, windowMs: number): void {
  /** One local cursor avoids repeatedly shifting the surviving suffix; no state survives the call. */
  let expired = 0
  while (expired < timestamps.length && now - timestamps[expired]! >= windowMs) expired++
  if (expired > 0) timestamps.splice(0, expired)
}
