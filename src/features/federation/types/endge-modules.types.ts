import type { EndgeModule } from '@/features/federation/EndgeModule'

export type EndgeModuleOrder = string | readonly string[]

/** Доступ к уже объявленным модулям во время создания graph dependencies. */
export interface EndgeModuleFactoryContext {
  getModule: <T extends EndgeModule = EndgeModule>(key: string) => T
}

/** Декларативное описание лениво создаваемого модуля федерации. */
export interface EndgeModuleDefinition<
  TKey extends string = string,
  TModule extends EndgeModule = EndgeModule,
> {
  readonly key: TKey
  readonly create: (context: EndgeModuleFactoryContext) => TModule
  readonly before?: EndgeModuleOrder
  readonly after?: EndgeModuleOrder
}

export interface EndgeModuleDescriptor<T extends EndgeModule = EndgeModule> {
  key: string
  module: T
  before?: EndgeModuleOrder
  after?: EndgeModuleOrder
}

export type EndgeModuleDefinitions = readonly EndgeModuleDefinition[]

/** Readonly module accessors, выведенные из literal keys и factory return types. */
export type EndgeFederationModuleAccessors<TDefinitions extends EndgeModuleDefinitions> = {
  readonly [TDefinition in TDefinitions[number] as TDefinition['key']]: ReturnType<TDefinition['create']>
}

export interface EndgePlugin {
  id: string
  install: () => void
}
