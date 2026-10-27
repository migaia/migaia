import { expect, test } from '@playwright/test'

test('真实 Chromium/WebKit byte-brand guard 拒绝伪造对象并接受合法跨 realm 值', async ({
  page
}) => {
  await page.goto('/')
  await expect(page.evaluate(() => window.runByteBrandScenario())).resolves.toEqual({
    foreignUint8Accepted: true,
    foreignArrayBufferAccepted: true,
    subclassAccepted: true,
    forgedInt8Rejected: true,
    clampedRejected: true,
    dataViewRejected: true,
    sharedRejected: true,
    hostileTagRejected: true,
    proxyRejected: true,
    forgedBufferRejected: true,
    detachedUint8Branded: true,
    detachedBufferBranded: true
  })
})
