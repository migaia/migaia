import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createStore } from '@migaia/store/store'
import { createRuntime } from '@migaia/store/kernel'
import { setScheduler } from '../../store/src/core/kernel'
import { persist } from '@migaia/store/persist'
import { indexedDbStorage } from './indexed-db'

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** 每个用例一套全新的 IndexedDB，避免相互串数据。 */
const freshStorage = () =>
	indexedDbStorage({
		factory: new IDBFactory(),
		dbName: `test-${Math.random().toString(36).slice(2)}`
	})

describe('indexedDbStorage：两条通道', () => {
	it('round-trips bytes without base64', async () => {
		const storage = freshStorage()
		const payload = new Uint8Array([0, 1, 2, 250, 255])

		await storage.setBytes('k', payload)
		const read = await storage.getBytes('k')
		// 原样存取：一个字节都不该变形，这正是选 IndexedDB 的唯一理由
		expect(read).toEqual(payload)
	})

	it('round-trips strings on the text channel', async () => {
		const storage = freshStorage()
		await storage.setItem('k', '{"a":1}')
		expect(await storage.getItem('k')).toBe('{"a":1}')
		expect(await storage.getBytes('k')).toBeNull()
	})

	it('reports a missing key as null on both channels', async () => {
		const storage = freshStorage()
		expect(await storage.getItem('nope')).toBeNull()
		expect(await storage.getBytes('nope')).toBeNull()
	})

	it('removes a key', async () => {
		const storage = freshStorage()
		await storage.setBytes('k', encoder.encode('x'))
		await storage.removeItem('k')
		expect(await storage.getBytes('k')).toBeNull()
	})

	it('rejects an operation whose signal is already aborted', async () => {
		const storage = freshStorage()
		const controller = new AbortController()
		controller.abort()

		await expect(
			storage.setItem('k', 'v', { signal: controller.signal })
		).rejects.toBeDefined()
	})

	it('refuses to build without an IndexedDB implementation', () => {
		expect(() =>
			indexedDbStorage({ factory: undefined as unknown as IDBFactory })
		).toThrow('IndexedDB is unavailable')
	})
})

describe('persist × IndexedDB：字节通道端到端', () => {
	/** 产出字节的 codec，代表 MessagePack 那一类二进制格式。 */
	const binaryPlugin = {
		type: 'bin',
		parser: {
			name: 'bin',
			encode: (value: unknown) =>
				['bytes', encoder.encode(JSON.stringify(value))] as const,
			decode: (chunk: readonly [string, unknown]) =>
				JSON.parse(decoder.decode(chunk[1] as Uint8Array))
		}
	}

	it('writes raw bytes rather than base64', async () => {
		setScheduler((run) => run())
		const storage = freshStorage()
		const store = createStore({ count: 0 }, { runtime: createRuntime() })
		const handle = persist(store, {
			key: 'k',
			storage,
			serializePlugins: [binaryPlugin]
		})
		await handle.settled
		store.count = 7
		await tick()

		const stored = await storage.getBytes('k')
		expect(stored).toBeInstanceOf(Uint8Array)
		// 头以 UTF-8 前缀贴在原始字节前面，没有 base64 那 1/3 膨胀
		expect(decoder.decode(stored!.subarray(0, 8))).toBe('MW1|bin|')
		expect(await storage.getItem('k')).toBeNull()

		handle.dispose()
		setScheduler((run) => queueMicrotask(run))
	})

	it('hydrates a fresh store from the byte archive', async () => {
		setScheduler((run) => run())
		const storage = freshStorage()
		const first = createStore({ count: 0 }, { runtime: createRuntime() })
		const writer = persist(first, {
			key: 'k',
			storage,
			serializePlugins: [binaryPlugin]
		})
		await writer.settled
		first.count = 11
		await tick()
		writer.dispose()

		const second = createStore({ count: 0 }, { runtime: createRuntime() })
		const reader = persist(second, {
			key: 'k',
			storage,
			serializePlugins: [binaryPlugin]
		})
		await reader.settled

		expect(second.count).toBe(11)
		expect(reader.hydrationStatus.value).toBe('success')
		reader.dispose()
		setScheduler((run) => queueMicrotask(run))
	})

	it('still reads an archive written to the text channel', async () => {
		setScheduler((run) => run())
		const storage = freshStorage()
		// 字节支持是后加的：更早写进字符串通道的存档必须照读
		await storage.setItem(
			'k',
			JSON.stringify({ version: 0, state: { count: 42 } })
		)
		const store = createStore({ count: 0 }, { runtime: createRuntime() })
		const handle = persist(store, { key: 'k', storage })
		await handle.settled

		expect(store.count).toBe(42)
		expect(handle.hydrationStatus.value).toBe('success')
		handle.dispose()
		setScheduler((run) => queueMicrotask(run))
	})

	it('falls back to base64 when the backend has no byte channel', async () => {
		setScheduler((run) => run())
		const map = new Map<string, string>()
		const textOnly = {
			getItem: (k: string) => map.get(k) ?? null,
			setItem: (k: string, v: string) => void map.set(k, v),
			removeItem: (k: string) => void map.delete(k)
		}
		const store = createStore({ count: 0 }, { runtime: createRuntime() })
		const handle = persist(store, {
			key: 'k',
			storage: textOnly,
			serializePlugins: [binaryPlugin]
		})
		await handle.settled
		store.count = 5
		await tick()

		// 没有字节通道就退回 base64，行为与从前一致
		expect(map.get('k')!.startsWith('MW1|bin|b|')).toBe(true)
		handle.dispose()
		setScheduler((run) => queueMicrotask(run))
	})

	it('refuses a byte archive whose codec is not registered', async () => {
		setScheduler((run) => run())
		const storage = freshStorage()
		await storage.setBytes('k', encoder.encode('MW1|msgpack|b|xxxx'))
		const store = createStore({ count: 1 }, { runtime: createRuntime() })
		const handle = persist(store, { key: 'k', storage })
		await handle.settled

		expect(handle.hydrationStatus.value).toBe('error')
		expect(String(handle.hydrationError.value)).toContain(
			'was written by codec "msgpack"'
		)
		// 状态保持原样，不被读不懂的存档覆盖
		expect(store.count).toBe(1)
		handle.dispose()
		setScheduler((run) => queueMicrotask(run))
	})

	it('reports a truncated byte header instead of guessing', async () => {
		setScheduler((run) => run())
		const storage = freshStorage()
		await storage.setBytes('k', encoder.encode('MW1|bin'))
		const store = createStore({ count: 1 }, { runtime: createRuntime() })
		const handle = persist(store, { key: 'k', storage })
		await handle.settled

		expect(handle.hydrationStatus.value).toBe('error')
		expect(String(handle.hydrationError.value)).toContain('truncated')
		handle.dispose()
		setScheduler((run) => queueMicrotask(run))
	})
})

describe('indexedDbStorage：连接与事务语义', () => {
	it('creates its store even when the database already exists without it', async () => {
		const factory = new IDBFactory()
		const dbName = 'shared-db'
		// 先由别处用另一个 storeName 建库。写死 version 1 的话这里不会触发
		// upgrade，随后 transaction(storeName) 直接抛 NotFoundError。
		const other = indexedDbStorage({ factory, dbName, storeName: 'other' })
		await other.setItem('x', '1')

		const mine = indexedDbStorage({ factory, dbName, storeName: 'mine' })
		await mine.setItem('k', 'v')
		expect(await mine.getItem('k')).toBe('v')
		// 先建的那个 store 不能被升级过程弄丢
		expect(await other.getItem('x')).toBe('1')
	})

	it('does not stay poisoned after a failed open', async () => {
		let attempts = 0
		const real = new IDBFactory()
		const flaky = {
			open: (name: string, version?: number) => {
				attempts++
				if (attempts === 1) {
					// 第一次开库失败：不清缓存的话，这个实例就永久报错了
					const request = { onerror: null, onsuccess: null, onupgradeneeded: null, onblocked: null, error: new Error('boom') } as unknown as IDBOpenDBRequest
					queueMicrotask(() => request.onerror?.(new Event('error')))
					return request
				}
				return version === undefined
					? real.open(name)
					: real.open(name, version)
			}
		} as unknown as IDBFactory

		const storage = indexedDbStorage({ factory: flaky, dbName: 'retry-db' })
		await expect(storage.getItem('k')).rejects.toBeDefined()
		// 第二次必须重新尝试，而不是复用那个已失败的 Promise
		await storage.setItem('k', 'v')
		expect(await storage.getItem('k')).toBe('v')
	})

	it('reports a write as done only after the transaction commits', async () => {
		const factory = new IDBFactory()
		const storage = indexedDbStorage({ factory, dbName: 'commit-db' })

		await storage.setBytes('k', new Uint8Array([1, 2, 3]))
		// 单条 put 的 success 只说明请求被接受；事务随后仍可能因配额或 abort 回滚。
		// 写入返回后立刻用一个全新连接读，读得到才说明真的 commit 了。
		const reader = indexedDbStorage({ factory, dbName: 'commit-db' })
		expect(await reader.getBytes('k')).toEqual(new Uint8Array([1, 2, 3]))
	})

	it('surfaces an aborted transaction as a failed write', async () => {
		const factory = new IDBFactory()
		const storage = indexedDbStorage({ factory, dbName: 'abort-db' })
		await storage.setItem('seed', 'v')

		const controller = new AbortController()
		const pending = storage.setItem('k', 'v', { signal: controller.signal })
		controller.abort()
		await expect(pending).rejects.toBeDefined()
	})
})
