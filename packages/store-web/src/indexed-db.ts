import type {
	IBinaryStorageAdapter,
	IPersistOperationContext
} from '@migai/store/persist'

/**
 * IndexedDB 后端。
 *
 * 存在的理由只有一个：它能原样存 Uint8Array。localStorage 只认字符串，字节进去 必须
 * base64，体积涨三分之一——恰好把二进制格式省下来的空间赔光，也就抵消了 走 worker/wasm
 * 转码的意义。这条通路要有落脚点，就得有一个真正认字节的后端。
 */
export type IIndexedDbStorageOptions = {
	readonly dbName?: string
	readonly storeName?: string
	/** 注入点：测试环境（jsdom 没有 IndexedDB）与非浏览器环境用。 */
	readonly factory?: IDBFactory
}

/** 把一次 IDBRequest 包成 Promise，并接上取消信号。 */
function fromRequest<T>(
	request: IDBRequest<T>,
	context?: IPersistOperationContext
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const onAbort = () => reject(context?.signal.reason)
		request.onsuccess = () => {
			context?.signal.removeEventListener('abort', onAbort)
			resolve(request.result)
		}
		request.onerror = () => {
			context?.signal.removeEventListener('abort', onAbort)
			reject(
				request.error ?? new Error('[store] IndexedDB request failed')
			)
		}
		// 协作式取消：IndexedDB 的单次请求撤不回来，只能丢弃结果。
		// 事务本身仍会跑完，这与 IStorageAdapter 上写明的语义一致。
		if (context?.signal.aborted) return onAbort()
		context?.signal.addEventListener('abort', onAbort, { once: true })
	})
}

/**
 * 等到事务真正 commit 才算写成功。
 *
 * 单个 put 请求 success 只代表「这条请求被接受了」，事务随后仍可能因配额超限、 commit 失败或被 abort 而整体回滚。只等
 * request.onsuccess 的话，flush() 会把 一次根本没落盘的写报告成成功——这是持久化里最不该有的谎。
 */
function commitOf(
	transaction: IDBTransaction,
	context?: IPersistOperationContext
): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const onAbort = () => reject(context?.signal.reason)
		const finish = (settle: () => void) => {
			context?.signal.removeEventListener('abort', onAbort)
			settle()
		}
		transaction.oncomplete = () => finish(resolve)
		transaction.onerror = () =>
			finish(() =>
				reject(
					transaction.error ??
						new Error('[store] IndexedDB transaction failed')
				)
			)
		transaction.onabort = () =>
			finish(() =>
				reject(
					transaction.error ??
						new Error('[store] IndexedDB transaction was aborted')
				)
			)
		if (context?.signal.aborted) return onAbort()
		context?.signal.addEventListener('abort', onAbort, { once: true })
	})
}

export function indexedDbStorage(
	options: IIndexedDbStorageOptions = {}
): IBinaryStorageAdapter {
	const {
		dbName = 'morning-watch-store',
		storeName = 'persist',
		factory = globalThis.indexedDB
	} = options
	if (!factory) {
		throw new Error(
			'[store] IndexedDB is unavailable; pass a factory or use another adapter'
		)
	}

	// 只开一次库，之后所有事务复用同一个连接。失败时要清掉缓存，否则一次瞬时
	// 故障（另一个标签页正卡在旧版本上）会把这个实例永久毒死。
	let connection: Promise<IDBDatabase> | undefined

	const openOnce = (version?: number): Promise<IDBDatabase> =>
		new Promise<IDBDatabase>((resolve, reject) => {
			let settled = false
			const request =
				version === undefined
					? factory.open(dbName)
					: factory.open(dbName, version)
			request.onupgradeneeded = () => {
				if (!request.result.objectStoreNames.contains(storeName)) {
					request.result.createObjectStore(storeName)
				}
			}
			// 别的标签页握着旧版本连接时会走到这里；不处理就永远挂着
			request.onblocked = () => {
				if (settled) return
				settled = true
				reject(
					new Error(
						'[store] IndexedDB upgrade is blocked by another open connection'
					)
				)
			}
			request.onsuccess = () => {
				if (settled) {
					request.result.close()
					return
				}
				settled = true
				resolve(request.result)
			}
			request.onerror = () => {
				if (settled) return
				settled = true
				reject(request.error ?? new Error('[store] IndexedDB open failed'))
			}
		})

	const open = (): Promise<IDBDatabase> =>
		(connection ??= (async () => {
			// 不写死版本号：同一个 dbName 可能已被别处用别的 storeName 建过，
			// 硬开 version 1 不会触发 upgrade，之后 transaction(storeName) 直接
			// 抛 NotFoundError。先按当前版本开，缺 store 再升一版补建。
			let database = await openOnce()
			if (!database.objectStoreNames.contains(storeName)) {
				const nextVersion = database.version + 1
				database.close()
				database = await openOnce(nextVersion)
			}
			// 别的标签页要升级时必须让路，否则对方会一直 blocked
			database.onversionchange = () => {
				database.close()
				connection = undefined
			}
			database.onclose = () => {
				connection = undefined
			}
			return database
		})().catch((error: unknown) => {
			connection = undefined
			throw error
		}))

	const read = async <T>(
		run: (store: IDBObjectStore) => IDBRequest<T>,
		context?: IPersistOperationContext
	): Promise<T> => {
		const database = await open()
		const transaction = database.transaction(storeName, 'readonly')
		return fromRequest(run(transaction.objectStore(storeName)), context)
	}

	/** 写入等事务 commit，而不是等单条请求 success。 */
	const write = async (
		// 只关心副作用，请求结果不读，所以不必约束其泛型参数
		run: (store: IDBObjectStore) => unknown,
		context?: IPersistOperationContext
	): Promise<void> => {
		const database = await open()
		const transaction = database.transaction(storeName, 'readwrite')
		const committed = commitOf(transaction, context)
		run(transaction.objectStore(storeName))
		await committed
	}

	return {
		namespace: 'shared',
		dispose: async () => {
			const pending = connection
			connection = undefined
			if (!pending) return
			try {
				;(await pending).close()
			} catch {
				// Failed/opening connections are already unusable; disposal is best effort.
			}
		},
		// 字符串通道照常提供：同一个后端也能存旧的文本存档
		getItem: async (key, context) => {
			const value = await read<unknown>(
				(store) => store.get(key) as IDBRequest<unknown>,
				context
			)
			return typeof value === 'string' ? value : null
		},
		setItem: (key, value, context) =>
			write((store) => store.put(value, key), context),
		removeItem: (key, context) =>
			write((store) => store.delete(key), context),

		getBytes: async (key, context) => {
			const value = await read<unknown>(
				(store) => store.get(key) as IDBRequest<unknown>,
				context
			)
			if (value instanceof Uint8Array) return value
			// IndexedDB 可能把它还原成 ArrayBuffer，取决于实现
			if (value instanceof ArrayBuffer) return new Uint8Array(value)
			return null
		},
		setBytes: (key, value, context) =>
			write((store) => store.put(value, key), context)
	}
}
