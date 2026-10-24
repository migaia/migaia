/** Existing r13 whole-block bootstrap; order statistics retain the original measurement oracle. */
/**
 * Read one stable numeric rank without sorting caller-owned chronological observations. All callers
 * supply finite numeric samples. Original index breaks numeric ties so +0/-0 and repeated values
 * retain the same representative as stable Array.sort. Median-of-medians selects a pivot from
 * groups of at most five: T(n) <= T(n/5) + T(7n/10 + 6) + O(n), hence worst O(n).
 *
 * @param {number[]} values Finite samples in their original observation order.
 * @param {number} index Zero-based rank in ascending numeric order.
 * @returns {number | undefined} Original sample at that rank; undefined outside the array domain.
 */
export function orderStatistic(values, index) {
  if (!Number.isInteger(index) || index < 0 || index >= values.length) return undefined
  /** Only this operation's private records are partitioned; raw evidence is never rearranged. */
  const records = values.map((value, order) => ({ value, order }))
  return selectRecord(records, 0, records.length, index).value
}

/**
 * Compare original observations exactly as stable numeric sorting does for the supported samples.
 *
 * @param {{ value: number; order: number }} left Original observation and index.
 * @param {{ value: number; order: number }} right Original observation and index.
 * @returns {number} Numeric comparison, with original observation order for equal numbers.
 */
function compareRecord(left, right) {
  return left.value < right.value ? -1 : left.value > right.value ? 1 : left.order - right.order
}

/**
 * Order one compile-time bounded pivot group. Only selectRecord calls this, with at most five
 * records, so the local insertion loop is constant work, not a growing-domain comparison sort.
 *
 * @param {{ value: number; order: number }[]} records Private selection records.
 * @param {number} start First record in the group.
 * @param {number} end Exclusive bound, at most start + 5.
 * @returns {void} Reorders only this bounded group.
 */
function orderPivotGroup(records, start, end) {
  for (let index = start + 1; index < end; index++) {
    /** This original record moves across at most four neighboring pivot records. */
    const selected = records[index]
    /** At most four predecessor comparisons occur because the group bound is five. */
    let position = index
    while (position > start && compareRecord(records[position - 1], selected) > 0) {
      records[position] = records[position - 1]
      position--
    }
    records[position] = selected
  }
}

/**
 * Select one absolute rank with deterministic median-of-medians pivots and an explicit narrowing
 * loop. Recursive calls only select the smaller median array; no retry state is captured.
 *
 * @param {{ value: number; order: number }[]} records Private selection records.
 * @param {number} start Inclusive partition bound.
 * @param {number} end Exclusive partition bound.
 * @param {number} target Absolute index within this record array.
 * @returns {{ value: number; order: number }} The same original record as stable numeric sorting.
 */
function selectRecord(records, start, end, target) {
  while (end - start > 5) {
    /** Each disjoint group contributes one existing record; no observation is copied or dropped. */
    const medians = []
    for (let group = start; group < end; group += 5) {
      /** Five is the fixed BFPRT pivot-group bound, independent of runtime sample count. */
      const limit = Math.min(group + 5, end)
      orderPivotGroup(records, group, limit)
      medians.push(records[group + Math.floor((limit - group) / 2)])
    }
    /** The median pivot leaves at most seven tenths of the input plus a fixed tail to revisit. */
    const pivot = selectRecord(medians, 0, medians.length, Math.floor(medians.length / 2))
    /** The lower partition contains only records strictly before the selected pivot. */
    let lower = start
    /** The next unclassified record is visited exactly once in this partition pass. */
    let cursor = start
    /** The upper partition contains only records strictly after the selected pivot. */
    let upper = end
    while (cursor < upper) {
      /** The original index makes every record's comparison identity unique. */
      const comparison = compareRecord(records[cursor], pivot)
      if (comparison < 0) {
        ;[records[lower], records[cursor]] = [records[cursor], records[lower]]
        lower++
        cursor++
      } else if (comparison > 0) {
        upper--
        ;[records[cursor], records[upper]] = [records[upper], records[cursor]]
      } else cursor++
    }
    if (target < lower) end = lower
    else if (target >= upper) start = upper
    else return records[target]
  }
  orderPivotGroup(records, start, end)
  return records[target]
}
/**
 * Arithmetic median from the existing r13 reader; callers validate complete finite blocks first.
 *
 * @param {number[]} values Retained block observations.
 * @returns {number | null} Median, or null when no finite block exists.
 */
export function median(values) {
  /** The original reader excludes nonfinite blocks before computing its arithmetic median. */
  const finite = values.filter(Number.isFinite)
  if (!finite.length) return null
  /** One or two fixed rank selections retain every accepted block without comparison sorting. */
  const middle = Math.floor(finite.length / 2)
  return finite.length % 2
    ? orderStatistic(finite, middle)
    : (orderStatistic(finite, middle - 1) + orderStatistic(finite, middle)) / 2
}
/**
 * Keep the original nearest-rank percentile, without interpolation or dropped samples.
 *
 * @param {number[]} values Retained finite observations.
 * @param {number} quantile Original requested percentile.
 * @returns {number} The same indexed original-order-statistic value.
 */
export function nearestRank(values, quantile) {
  return orderStatistic(values, Math.ceil(quantile * values.length) - 1)
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
