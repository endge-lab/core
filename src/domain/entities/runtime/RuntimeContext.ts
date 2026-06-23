export type StoreWriter = {
  to: (storeKey: string) => Promise<void>
}

export type StoreReader = {
  from: (storeKey: string) => Promise<void>
}

/**
 * Контекст, который пробрасывается в скрипт (ВНУТРЕННИЙ)
 */
export interface RuntimeContext extends Record<string, unknown> {
  scopeId: string

  Data: {
    [key: string]: any
  }

  UnsafeEndge: {
    domain: any
    extract: any
    render: any
    store: any
    script: any
  }

  // Примитивный DSL
  expose: (data: Record<string, CallableFunction>) => void
  query: (queryId: string) => StoreWriter
  watch: (queryId: string, seconds?: number) => StoreWriter
  mount: (componentId: string) => StoreReader
}
