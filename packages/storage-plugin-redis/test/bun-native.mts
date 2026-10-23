import { RedisClient } from 'bun'
import { strict as assert } from 'node:assert'
import { bunRedisDriver } from '@migaia/storage-plugin-redis/bun'

/** This fixture consumes Bun's actual built-in client against every configured service. */
for (const name of ['MIGAIA_REDIS_URL', 'MIGAIA_VALKEY_URL', 'MIGAIA_REDIS_STACK_URL']) {
  const url = process.env[name]
  assert.ok(url, 'Real Redis service URL is required')
  const client = new RedisClient(url),
    key = 'bun-driver-test:' + crypto.randomUUID(),
    driver = bunRedisDriver(client)
  await client.connect()
  try {
    await driver.command(['SET', key, 'before'])
    await driver.withConnection(async (connection) => {
      assert.equal(connection.binaryCommand, undefined)
      await connection.command(['WATCH', key])
      await driver.command(['SET', key, 'concurrent'])
      assert.equal(await connection.exec([['SET', key, 'stale']]), null)
      const entries = await connection.exec([
        ['SET', key, 'text'],
        ['INCR', key]
      ])
      assert.equal(entries?.[0]?.ok, true)
      const failed = entries?.[1]
      assert.equal(failed?.ok, false)
      if (failed?.ok === false) assert.ok(failed.error instanceof Error)
      await assert.rejects(
        connection.exec([
          ['SET', key, 'invalid'],
          ['SET', key, new Uint8Array([1])]
        ]),
        { code: 'UNSUPPORTED_CAPABILITY' }
      )
      assert.equal(await connection.command(['GET', key]), 'text')
    })
    const value = Promise.withResolvers<string>(),
      resource = await driver.subscribe(key, (message) => value.resolve(message))
    try {
      assert.equal(await driver.command(['PUBLISH', key, 'payload']), 1)
      assert.equal(await value.promise, 'payload')
      const disposal = resource.dispose()
      assert.equal(resource.dispose(), disposal)
      const symbolic = resource[Symbol.asyncDispose]()
      assert.equal(resource[Symbol.asyncDispose](), symbolic)
      await disposal
      await symbolic
      assert.equal(await driver.command(['PUBLISH', key, 'closed']), 0)
    } finally {
      await resource.dispose()
    }
    assert.equal(await client.send('PING', []), 'PONG')
    console.log(name + ': PASS')
  } finally {
    await client.send('DEL', [key])
    client.close()
  }
}

/**
 * Failed subscription setup keeps its primary error even when closing the real duplicate also
 * fails.
 */
{
  const client = new RedisClient(process.env.MIGAIA_REDIS_URL!),
    primary = new TypeError('subscription setup failed'),
    secondary = new RangeError('subscription cleanup failed'),
    reports: unknown[] = [],
    previousError = console.error
  await client.connect()
  const owned = await client.duplicate(),
    nativeClose = owned.close
  owned.subscribe = async () => {
    throw primary
  }
  owned.close = () => {
    Reflect.apply(nativeClose, owned, [])
    throw secondary
  }
  client.duplicate = async () => owned
  console.error = (...args: unknown[]) => {
    reports.push(args.at(-1))
  }
  try {
    await assert.rejects(
      bunRedisDriver(client).subscribe('setup-failure', () => undefined),
      (error) => error === primary
    )
    assert.equal(reports.length, 1)
    assert.equal(reports[0], secondary)
    assert.equal(Reflect.get(primary, 'code'), 'REDIS_FAILED')
    assert.equal(await client.send('PING', []), 'PONG')
    console.log('Bun setup cleanup: PASS')
  } finally {
    console.error = previousError
    client.close()
  }
}
