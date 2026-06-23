/**
 * Endge Модуль
 */
export interface EndgeModule {
  //
  // Lifecycle
  id: string
  setup(): void
  destroy?(): void

  //
  // Сериализация модуля
  toPlain?(): object
  fromPlain?(data: object): void
}

export type EndgeEventMap = Record<string, any>

/**
 * Токены (типизированные идентификаторы сервисов)
 */
export type EndgeToken<T, E extends EndgeEventMap> = string & {
  __t?: T
  __ev?: E
}

export const endgeToken = <T, E extends EndgeEventMap = object>(
  id: string,
): EndgeToken<T, E> => id as EndgeToken<T, E>

export type EndgeModuleCtor = new () => EndgeModule
export type EndgeModuleSpec = EndgeModule | EndgeModuleCtor
export type EndgeModuleLoader =
  | (() => Promise<EndgeModuleSpec> | EndgeModuleSpec)
  | EndgeModuleSpec

export interface EndgeModuleInstall<
  T extends EndgeModule,
  E extends EndgeEventMap = object,
> {
  name: string
  version: string
  description: string
  author: string
  token: EndgeToken<T, E>
  loader: EndgeModuleLoader
}
