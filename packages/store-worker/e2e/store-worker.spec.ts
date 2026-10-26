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

test('真实 Worker 请求复制字节并保留调用方的完整 buffer', async ({ page }) => {
  await page.goto('/')
  await expect(page.evaluate(() => window.runStoreWorkerCopyScenario())).resolves.toEqual([
    [1, 2, 3, 4],
    4
  ])
})

test('主线程取消会终止在途 Worker 请求', async ({ page }) => {
  await page.goto('/')
  await expect(page.evaluate(() => window.runStoreWorkerAbortScenario())).rejects.toThrow(/abort/i)
})

test('Worker failure retains the original native error and stack across realms', async ({
  page
}) => {
  await page.goto('/')
  const messages = await page.evaluate(() => window.runStoreWorkerErrorScenario())
  expect(messages).toEqual([
    {
      name: 'Error',
      message: 'Unable to calculate the requested value',
      source: 'rpc.endpoint',
      code: 'INTERNAL',
      hasStack: true
    }
  ])
})

test('请求 options 在真实 Worker admission 时只读取一次', async ({ page }) => {
  await page.goto('/')
  await expect(page.evaluate(() => window.runStoreWorkerRequestOptionsScenario())).resolves.toEqual(
    [42, 1, 0]
  )
})

test('workerComputed 仅消费已知 options 快照并完成真实 Resource 请求', async ({ page }) => {
  await page.goto('/')
  await expect(page.evaluate(() => window.runStoreWorkerComputedScenario())).resolves.toEqual([
    42, 0, 0
  ])
})
