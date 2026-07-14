import type { RMock } from '@/domain/entities/reflect/RMock'

export type RMockContentSource = 'document' | 'code-provider'
export type RMockContentType = 'application/json' | 'text/plain'

/** Контекст вызова code provider для persisted mock-документа. */
export interface EndgeMockProviderContext {
  mock: RMock
}

/** Кодовая реализация содержимого, подключаемая к persisted mock по codeRef. */
export interface EndgeMockProvider {
  ref: string
  description?: string
  provide: (context: EndgeMockProviderContext) => unknown
}

/** @deprecated Используйте EndgeMockProvider. */
export interface EndgeMockRegistration {
  /** Стабильный identity, используемый в source через mock(identity). */
  identity: string

  /** Исходный mock payload. EndgeMock хранит и возвращает независимые копии. */
  data: unknown

  /** Необязательное описание сценария для diagnostics и configurator UI. */
  description?: string
}

/** Публичное описание зарегистрированного mock payload без самих данных. */
export interface EndgeMockDescriptor {
  ref: string
  description?: string
}

export type EndgeMockBindingStatus = 'document' | 'connected' | 'missing-document' | 'missing-provider' | 'invalid-content'

/** Сериализуемый snapshot модуля EndgeMock. */
export interface EndgeMockSnapshot {
  providers: EndgeMockDescriptor[]
}

/** Compiler/runtime reference на mock payload. */
export interface EndgeMockReference {
  kind: 'mock'
  identity: string
}
