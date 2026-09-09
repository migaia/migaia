import { expect, test } from '@playwright/test'

test('主线程可以请求 Worker 并收到计算结果', async ({ page }) => {
  await page.goto('/')
  await expect(page.evaluate(() => window.runStoreWorkerScenario())).resolves.toBe(42)
})

test('Worker 请求在处理端无响应时会超时并结束请求', async ({ page }) => {
  await page.goto('/')
  await expect(page.evaluate(() => window.runStoreWorkerTimeoutScenario())).rejects.toThrow(
    /timeout/i
  )
})

test('ArrayBuffer transfer 在真实 Worker 边界转移所有权', async ({ page }) => {
  await page.goto('/')
  await expect(page.evaluate(() => window.runStoreWorkerTransferScenario())).resolves.toEqual([
    4, 0
  ])
})

test('主线程取消会终止在途 Worker 请求', async ({ page }) => {
  await page.goto('/')
  await expect(page.evaluate(() => window.runStoreWorkerAbortScenario())).rejects.toThrow(/abort/i)
})

test('Worker failure retains canonical remote outer and meaningful native cause across realms', async ({
  page
}) => {
  await page.goto('/')
  const messages = await page.evaluate(() => window.runStoreWorkerErrorScenario())
  expect(messages).toEqual([
    {
      name: 'WebRpcRemoteError',
      message: 'Provider failed',
      source: '@migaia/web-rpc',
      code: 'INTERNAL',
      hasStack: true
    },
    {
      name: 'Error',
      message: 'Unable to calculate the requested value',
      source: '@migaia/web-rpc',
      code: 'INTERNAL',
      hasStack: true
    }
  ])
})

test('请求 options 在真实 Worker admission 时只读取一次', async ({ page }) => {
  await page.goto('/')
  await expect(page.evaluate(() => window.runStoreWorkerRequestOptionsScenario())).resolves.toEqual(
    [42, 1, 1]
  )
})

test('workerComputed 仅消费已知 options 快照并完成真实 Resource 请求', async ({ page }) => {
  await page.goto('/')
  await expect(page.evaluate(() => window.runStoreWorkerComputedScenario())).resolves.toEqual([
    42, 1, 0
  ])
})
