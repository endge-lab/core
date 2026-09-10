import { EndgeDebuggerReadOnlyError } from '@/features/core/kernel/errors/EndgeDebuggerReadOnlyError'

/** Protects materialized documents while preserving their entity prototypes and shared references. */
export function readOnlyDocument<T extends object>(value: T, mutableRootKeys: readonly string[] = []): T {
  const cache = new WeakMap<object, object>()
  function wrap<V>(target: V): V {
    if (target === null || typeof target !== 'object') {
      return target
    }
    const cached = cache.get(target)
    if (cached) {
      return cached as V
    }
    const proxy = new Proxy(target, {
      get(object, key, receiver) {
        if (object instanceof Date) {
          const result = Reflect.get(object, key, object)
          if (typeof result !== 'function') {
            return result
          }
          if (typeof key === 'string' && key.startsWith('set')) {
            return () => {
              throw new EndgeDebuggerReadOnlyError()
            }
          }
          return result.bind(object)
        }
        if (object instanceof Map || object instanceof Set) {
          if (['set', 'add', 'delete', 'clear'].includes(String(key))) {
            return () => {
              throw new EndgeDebuggerReadOnlyError()
            }
          }
          if (key === 'size') {
            return object.size
          }
          if (key === 'get' && object instanceof Map) {
            return (entry: unknown) => wrap(object.get(entry))
          }
          if (key === 'has') {
            return (entry: unknown) => object.has(entry)
          }
          if (key === 'forEach') {
            return (callback: (item: unknown, entry: unknown, collection: unknown) => void, thisArg?: unknown) => {
              object.forEach((item, entry) => callback.call(thisArg, wrap(item), wrap(entry), receiver))
            }
          }
          if (key === 'keys' || key === 'values' || key === 'entries' || key === Symbol.iterator) {
            return function* () {
              const iterator = key === 'keys' ? object.keys() : key === 'values' ? object.values() : key === 'entries' ? object.entries() : object[Symbol.iterator]()
              for (const item of iterator) {
                yield wrap(item)
              }
            }
          }
        }
        const result = Reflect.get(object, key, receiver)
        if ((object as object) === value && typeof key === 'string' && mutableRootKeys.includes(key)) {
          return result
        }
        return wrap(result)
      },
      set(object, key, next) {
        if (Reflect.get(object, key) === next) {
          return true
        }
        throw new EndgeDebuggerReadOnlyError()
      },
      deleteProperty() { throw new EndgeDebuggerReadOnlyError() },
      defineProperty() { throw new EndgeDebuggerReadOnlyError() },
      setPrototypeOf() { throw new EndgeDebuggerReadOnlyError() },
    })
    cache.set(target, proxy)
    return proxy
  }
  return wrap(value)
}
