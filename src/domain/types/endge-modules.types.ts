import type { EndgeModule } from '@/domain/entities/endge/EndgeModule'

export type EndgeModuleConstructor<T extends EndgeModule = EndgeModule> = new () => T

export interface EndgeModuleDefinition<T extends EndgeModule = EndgeModule> {
  key: string
  module: EndgeModuleConstructor<T>
  before?: string | string[]
  after?: string | string[]
}

export interface EndgeModuleDescriptor<T extends EndgeModule = EndgeModule> {
  key: string
  module: T
  before?: string | string[]
  after?: string | string[]
}

export interface EndgePlugin {
  id: string
  install(): void
}
