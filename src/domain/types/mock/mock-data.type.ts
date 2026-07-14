/** Регистрация JSON-compatible mock payload в EndgeMock. */
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
  identity: string
  description?: string
}

/** Сериализуемый snapshot модуля EndgeMock. */
export interface EndgeMockSnapshot {
  mocks: EndgeMockDescriptor[]
}

/** Compiler/runtime reference на mock payload. */
export interface EndgeMockReference {
  kind: 'mock'
  identity: string
}
