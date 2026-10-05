import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import type { IProcessUsage } from '@migaia/supervision/process'
import { RpcProcessErrorCode } from '../error-code.js'
import { RpcProcessErrorText } from '../error-text.js'
import { createProcessError } from '../error.js'

/** OS field names and argument grammar belong only to this local sampler. */
const ProcessUsageSource = {
  ps: 'ps',
  getconf: 'getconf',
  ticks: 'CLK_TCK',
  psFields: ['pid=', 'rss=', 'utime=', 'stime=']
} as const

/** Executes a read-only native utility without a shell or caller-supplied argument grammar. */
function nativeRead(command: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      { encoding: 'utf8', timeout: 2000, maxBuffer: 65536 },
      (error, stdout) => {
        if (error) reject(error)
        else resolve(stdout)
      }
    )
  })
}

/** Converts ps cumulative duration, including optional day/hour fields, to microseconds. */
function cpuMicros(text: string): number {
  /** Ps prefixes elapsed days only once its cumulative duration spans a day. */
  const days = text.split('-')
  /** The final duration is minutes:seconds or hours:minutes:seconds. */
  const fields = days.at(-1)!.split(':').map(Number)
  if ((days.length !== 1 && days.length !== 2) || (fields.length !== 2 && fields.length !== 3))
    throw new TypeError(RpcProcessErrorText.usageInvalid)
  return Math.round(
    ((days.length === 2 ? Number(days[0]) * 86400 : 0) +
      fields.reduce((total, value) => total * 60 + value, 0)) *
      1e6
  )
}

/**
 * Reads current RSS and cumulative CPU for this exact native PID; unsupported OSs provide no
 * fields.
 */
export async function sampleNativeProcess(pid: number): Promise<IProcessUsage> {
  try {
    /** No parent process resource API is used as a fallback for a child PID. */
    let rssBytes: number
    /** Cumulative accounting retains separate user/kernel time and its explicit microsecond unit. */
    let cpuUserMicros: number
    /** This is the selected PID's system CPU, never descendants' or aggregate parent CPU. */
    let cpuSystemMicros: number
    if (process.platform === 'darwin') {
      /** Ps returns current resident KiB and separate cumulative user/system durations. */
      const fields = (
        await nativeRead(ProcessUsageSource.ps, [
          '-p',
          String(pid),
          '-o',
          ProcessUsageSource.psFields.join(',')
        ])
      )
        .trim()
        .split(/\s+/u)
      if (fields.length !== 4 || Number(fields[0]) !== pid)
        throw new TypeError(RpcProcessErrorText.usageInvalid)
      rssBytes = Number(fields[1]) * 1024
      cpuUserMicros = cpuMicros(fields[2]!)
      cpuSystemMicros = cpuMicros(fields[3]!)
    } else if (process.platform === 'linux') {
      /** Kernel stat user/system jiffies exclude child CPU; status separates current RSS from HWM. */
      const [stat, status, frequency] = await Promise.all([
        readFile(`/proc/${pid}/stat`, 'utf8'),
        readFile(`/proc/${pid}/status`, 'utf8'),
        nativeRead(ProcessUsageSource.getconf, [ProcessUsageSource.ticks])
      ])
      /** Process names may contain spaces or parentheses; the final ')' precedes field 3. */
      const fields = stat
        .slice(stat.lastIndexOf(')') + 2)
        .trim()
        .split(/\s+/u)
      /** VmRSS is current resident KiB; VmHWM is intentionally not projected as current memory. */
      const resident = /^VmRSS:\s+(\d+)\s+kB$/mu.exec(status)
      /** Native clock frequency comes from the same OS, rather than an assumed 100Hz constant. */
      const ticksPerSecond = Number(frequency.trim())
      if (!resident || !Number.isFinite(ticksPerSecond) || ticksPerSecond <= 0)
        throw new TypeError(RpcProcessErrorText.usageInvalid)
      rssBytes = Number(resident[1]) * 1024
      cpuUserMicros = Math.round((Number(fields[11]) * 1e6) / ticksPerSecond)
      cpuSystemMicros = Math.round((Number(fields[12]) * 1e6) / ticksPerSecond)
    } else return {}
    if (
      ![rssBytes, cpuUserMicros, cpuSystemMicros].every(
        (value) => Number.isFinite(value) && value >= 0
      )
    )
      throw new TypeError(RpcProcessErrorText.usageInvalid)
    return {
      rssBytes,
      cpuUserMicros,
      cpuSystemMicros,
      cpuTimeMs: (cpuUserMicros + cpuSystemMicros) / 1000
    }
  } catch (cause) {
    throw createProcessError(RpcProcessErrorCode.usageSampleFailed, cause)
  }
}
