/**
 * Декларация контекста для setup-скрипта сценария
 */

declare const UnsafeEndge: {
  domain: any
  extract: any
  render: any
  store: any
  script: any
}

declare function query(queryId: string): {
  to(storeKey: string): Promise<void>
}

declare function watch(
  queryId: string,
  seconds?: number,
): {
  to(storeKey: string): Promise<void>
}

declare function mount(componentId: string): {
  from(storeKey: string): Promise<void>
}
