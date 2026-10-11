import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { IpcBenchErrorText } from './error-text.mjs'
import { judgeSdkRegression } from './ipc.mjs'

/**
 * Record the actual supplementary SDK paths through the original 100/1000 side and PID observer.
 *
 * @param {{
 *   output: string
 *   selectedId?: string
 *   prepare?: boolean
 *   freezeSdk?: boolean
 *   noisePath?: string
 * }} options
 *   Fresh raw destination.
 * @returns {Promise<object[]>} Three retained RPC rounds per cell, with no invented bare
 *   denominator.
 * @throws {Error} Original side failure or a configuration selecting no registered cell.
 */
export async function measureRuntimeUnits({
  output,
  selectedId,
  prepare = false,
  freezeSdk = false,
  noisePath
}) {
  const bytes = await readFile(new URL('./runtime-units.json', import.meta.url))
  const inventory = JSON.parse(bytes)
  const units = inventory.units.filter((unit) => !selectedId || unit.id === selectedId)
  if (!units.length || !output) throw new TypeError(IpcBenchErrorText.configuration)
  await mkdir(output, { recursive: true })
  /** This scope tracks SDK absolute measurements; original 76 normalized W3 cells stay untouched. */
  const results = []
  /** Final SDK source baselines are shared with original W3, without inventing a bare topology. */
  const baseline =
    prepare || freezeSdk
      ? undefined
      : JSON.parse(await readFile(new URL('./w3-sdk-baseline.json', import.meta.url)))
  const noise = prepare || freezeSdk ? undefined : JSON.parse(await readFile(noisePath))
  /** Fail closed before launching if a registered supplemental cell lacks its own current A/A. */
  if (baseline && units.some((unit) => !baseline.cells[unit.id] || !noise.sdkCells?.[unit.id]))
    throw new TypeError(IpcBenchErrorText.paired)
  for (const unit of units) {
    const rounds = []
    for (let round = 0; round < (prepare ? 1 : 3); round++) {
      const stem = join(output, unit.id.replaceAll(':', '-') + '-' + round)
      const args = [
        fileURLToPath(new URL('./ipc-side.mjs', import.meta.url)),
        JSON.stringify({
          unit,
          side: 'rpc',
          options: { check: prepare, samples: 1000, warmup: 100 }
        })
      ]
      const receipt = await new Promise((resolve, reject) => {
        const child = spawn(unit.executable, args, {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, IPC_BENCH_STEM: stem }
        })
        let stdout = '',
          stderr = ''
        child.stdout.on('data', (data) => {
          stdout += data.toString()
        })
        child.stderr.on('data', (data) => {
          stderr += data.toString()
        })
        child.once('error', reject)
        child.once('close', async (code) => {
          try {
            await writeFile(stem + '.stderr.log', stderr, { flag: 'wx' })
            if (code !== 0) throw new Error(IpcBenchErrorText.sideFailed(code, stderr))
            const value = JSON.parse(stdout)
            await writeFile(
              stem + '.json',
              JSON.stringify({
                ...value,
                execution: {
                  command: [unit.executable, ...args],
                  inventorySHA256: createHash('sha256').update(bytes).digest('hex')
                }
              }),
              { flag: 'wx' }
            )
            resolve(value)
          } catch (error) {
            reject(error)
          }
        })
      })
      rounds.push(receipt)
    }
    /** A supplemental regression verdict stays separate from preparation and unfrozen collection. */
    const sdkRegression = baseline
      ? judgeSdkRegression(rounds, baseline.cells[unit.id], noise.sdkCells[unit.id])
      : undefined
    const result = {
      unit,
      rounds,
      ...(sdkRegression ? { sdkRegression } : {}),
      status: prepare ? 'prepared' : (sdkRegression?.status ?? 'unfrozen'),
      scope: 'supplemental actual RPC topology; RPC-only final SDK relative metrics'
    }
    await writeFile(
      join(output, unit.id.replaceAll(':', '-') + '-result.json'),
      JSON.stringify(result),
      { flag: 'wx' }
    )
    results.push(result)
    if (result.sdkRegression?.status === 'fail') process.exitCode = 1
    console.log(JSON.stringify({ unit: unit.id, rounds: rounds.length, status: result.status }))
  }
  return results
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const options = {}
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--output') options.output = args[++index]
    else if (args[index] === '--unit') options.selectedId = args[++index]
    else if (args[index] === '--prepare') options.prepare = true
    else if (args[index] === '--freeze-sdk') options.freezeSdk = true
    else if (args[index] === '--noise') options.noisePath = args[++index]
    else throw new TypeError(IpcBenchErrorText.configuration)
  }
  measureRuntimeUnits(options).catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
