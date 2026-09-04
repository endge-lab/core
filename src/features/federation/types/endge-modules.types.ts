import type { EndgeModule } from '@/features/federation/EndgeModule'
import type { EndgeFederationContext } from '@/features/federation/types/federation.types'

export type AnyEndgeModule = EndgeModule<any>

export type EndgeModuleOrder = string | readonly string[]

/** Доступ к уже объявленным модулям во время создания graph dependencies. */
export interface EndgeModuleFactoryContext {
  getModule: <T extends AnyEndgeModule = AnyEndgeModule>(key: string) => T
}

/** Декларативное описание лениво создаваемого модуля федерации. */
export interface EndgeModuleDefinition<
  TKey extends string = string,
  TModule extends AnyEndgeModule = AnyEndgeModule,
> {
  readonly key: TKey
  readonly create: (context: EndgeModuleFactoryContext) => TModule
  readonly before?: EndgeModuleOrder
  readonly after?: EndgeModuleOrder
}

export interface EndgeModuleDescriptor<T extends AnyEndgeModule = AnyEndgeModule> {
  key: string
  module: T
  before?: EndgeModuleOrder
  after?: EndgeModuleOrder
}

export type EndgeModuleDefinitions = readonly EndgeModuleDefinition[]

/** Lifecycle context, объявленный concrete Module. */
export type EndgeModuleContext<TModule extends AnyEndgeModule>
  = TModule extends EndgeModule<infer TContext> ? TContext : never

type UnionToIntersection<TValue>
  = (TValue extends unknown ? (value: TValue) => void : never) extends ((value: infer TResult) => void)
    ? TResult
    : never

/** Наиболее строгий lifecycle context, требуемый всеми Modules федерации. */
export type EndgeFederationContextOf<TDefinitions extends EndgeModuleDefinitions>
  = UnionToIntersection<EndgeModuleContext<ReturnType<TDefinitions[number]['create']>>> extends infer TContext extends EndgeFederationContext
    ? TContext
    : EndgeFederationContext

/** Readonly module accessors, выведенные из literal keys и factory return types. */
export type EndgeFederationModuleAccessors<TDefinitions extends EndgeModuleDefinitions> = {
  readonly [TDefinition in TDefinitions[number] as TDefinition['key']]: ReturnType<TDefinition['create']>
}

export interface EndgePlugin {
  id: string
  install: () => void
}
