/** Existing r13 whole-block bootstrap; copied algorithm, no new measurement oracle. */
/**
 * Arithmetic median from the existing r13 reader; callers validate complete finite blocks first.
 *
 * @param {number[]} values Retained block observations.
 * @returns {number | null} Median, or null when no finite block exists.
 */
export function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!sorted.length) return null
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}
/**
 * Keep the original nearest-rank percentile, without interpolation or dropped samples.
 *
 * @param {number[]} values Retained finite observations.
 * @param {number} quantile Original requested percentile.
 * @returns {number} The same indexed original-order-statistic value.
 */
export function nearestRank(values, quantile) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.ceil(quantile * sorted.length) - 1]
}
/** Existing r13 xorshift stream fixes block bootstrap draw order. */
let seed = 0x434f5245
/** Return next existing deterministic bootstrap uniform draw. */
function random() {
  seed ^= seed << 13
  seed ^= seed >>> 17
  seed ^= seed << 5
  return (seed >>> 0) / 2 ** 32
}
/**
 * Existing r13 bootstrap resamples whole paired blocks, retaining the original seed/draw count.
 *
 * @param {number[]} values Complete block-level ratios.
 * @returns {object} Original percentile interval and its block/draw count.
 */
export function interval95(values) {
  if (values.length < 6) return { status: 'fewer than six complete blocks', count: values.length }
  const draws = []
  for (let iteration = 0; iteration < 10000; iteration++) {
    const selected = Array.from(
      { length: values.length },
      () => values[Math.floor(random() * values.length)]
    )
    draws.push(median(selected))
  }
  const center = median(values),
    lower = nearestRank(draws, 0.025),
    upper = nearestRank(draws, 0.975)
  return {
    status: 'block bootstrap percentile interval',
    blocks: values.length,
    center,
    lower,
    upper,
    relativeHalfWidth: Math.max(center - lower, upper - center) / center,
    samples: 10000
  }
}
/**
 * Reset the original r13 stream for a separately derived finite directed cell.
 *
 * @returns {void} No data or measurement is changed.
 */
export function resetSeed() {
  seed = 0x434f5245
}
