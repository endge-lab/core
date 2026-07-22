import type { ProgramDiagnostic } from '@/domain/types/program/program.types'

/** Ссылка Type Source на примитивный или пользовательский тип домена. */
export interface TypeSourceReference {
  kind: 'reference'
  identity: string
}

/** Поле объектного Type Source v1. */
export interface TypeSourceField {
  key: string
  type: TypeSourceExpression
  description?: string
  optional: boolean
  array: boolean
  min?: number
  max?: number
  examples: unknown[]
}

export interface TypeSourceObjectDefinition {
  kind: 'object'
  fields: TypeSourceField[]
}

export interface TypeSourceEnumDefinition {
  kind: 'enum'
  values: Array<string | number | boolean>
}

export interface TypeSourceUnionDefinition {
  kind: 'union'
  variants: TypeSourceExpression[]
}

export interface TypeSourceArrayDefinition {
  kind: 'array'
  items: TypeSourceExpression
}

/** Словарь с произвольными string-ключами и единым типом значений. */
export interface TypeSourceRecordDefinition {
  kind: 'record'
  values: TypeSourceExpression
}

/** Поддержанные корневые формы Type Source v1. */
export type TypeSourceDefinition
  = | TypeSourceObjectDefinition
    | TypeSourceEnumDefinition
    | TypeSourceUnionDefinition
    | TypeSourceArrayDefinition

/** Рекурсивное выражение типа: ссылка или анонимное inline-определение. */
export type TypeSourceExpression
  = | TypeSourceReference
    | TypeSourceDefinition
    | TypeSourceRecordDefinition

/** Canonical authoring document Type Source v1. */
export interface TypeSourceDocument {
  definition: TypeSourceDefinition
}

/** Compiler payload Type Source. Runtime пока не потребляет этот artifact. */
export interface TypeProgramPayload {
  type: 'type'
  sourceVersion: number
  /** Stable identity of the compiled type. Parser-only artifacts may omit it. */
  identity?: string
  displayName?: string
  category?: 'primitive' | 'reference' | 'user'
  definition: TypeSourceDefinition | null
  runtimeType?: string
  entityReference?: {
    target: string
    storage: 'id' | 'identity'
  }
}

/** Read-only projection used by editors and language tooling. */
export interface TypeProgramCatalogEntry {
  id: string | number
  identity: string
  displayName: string
  category: 'primitive' | 'reference' | 'user'
  sourceVersion: number
  definition: TypeSourceDefinition | null
  runtimeType?: string
  entityReference?: TypeProgramPayload['entityReference']
  status: 'valid' | 'warning' | 'error'
}

/** Результат безопасного разбора Type Source. */
export interface TypeSourceCompileResult {
  ast: unknown | null
  document: TypeSourceDocument | null
  artifact: TypeProgramPayload | null
  diagnostics: Omit<ProgramDiagnostic, 'entityRef'>[]
}
