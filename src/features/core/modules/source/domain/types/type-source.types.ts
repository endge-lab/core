import type { ProgramMetadataMap } from '@/features/core/modules/program/domain/types/program-metadata.types'
import type { ProgramDiagnostic } from '@/features/core/modules/program/domain/types/program.types'

// Все ветки contextSwitch, из которых выбрано выражение при компиляции (default первым).
// Нужны только для проверки ссылок и зависимостей невыбранных веток; runtime их не читает.
export interface TypeSourceContextVariants {
  contextVariants?: TypeSourceExpression[]
}

// Ссылка Type Source на примитивный или пользовательский тип домена.
export interface TypeSourceReference extends TypeSourceContextVariants {
  kind: 'reference'
  identity: string
}

// Поле объектного Type Source v1.
export interface TypeSourceField {
  key: string
  type: TypeSourceExpression
  description?: string
  optional: boolean
  array: boolean
  min?: number
  max?: number
  examples: unknown[]
  // Identity Type, от которого поле унаследовано через extends; у собственных полей отсутствует.
  inheritedFrom?: string
}

export interface TypeSourceObjectDefinition extends TypeSourceContextVariants {
  kind: 'object'
  fields: TypeSourceField[]
  // `defineType({ extends: type('Base'), fields })`: базовый Type. В artifact поля уже развёрнуты
  // (унаследованные первыми, с inheritedFrom); в authored document — только собственные.
  extends?: TypeSourceReference
}

export interface TypeSourceEnumDefinition extends TypeSourceContextVariants {
  kind: 'enum'
  values: Array<string | number | boolean>
}

export interface TypeSourceUnionDefinition extends TypeSourceContextVariants {
  kind: 'union'
  variants: TypeSourceExpression[]
}

export interface TypeSourceArrayDefinition extends TypeSourceContextVariants {
  kind: 'array'
  items: TypeSourceExpression
}

// Словарь с произвольными string-ключами и единым типом значений.
export interface TypeSourceRecordDefinition extends TypeSourceContextVariants {
  kind: 'record'
  values: TypeSourceExpression
}

// Поддержанные корневые формы Type Source v1.
export type TypeSourceDefinition
  = | TypeSourceObjectDefinition
    | TypeSourceEnumDefinition
    | TypeSourceUnionDefinition
    | TypeSourceArrayDefinition

// Рекурсивное выражение типа: ссылка или анонимное inline-определение.
export type TypeSourceExpression
  = | TypeSourceReference
    | TypeSourceDefinition
    | TypeSourceRecordDefinition

// Канонический authoring-документ Type Source v1.
export interface TypeSourceDocument {
  definition: TypeSourceDefinition
}

// Compiler payload Type Source. Runtime пока не потребляет этот artifact.
export interface TypeProgramPayload {
  // Optional parser tree retained for inspection; runtime does not require it.
  ast?: unknown
  type: 'type'
  sourceVersion: number
  // Стабильная identity скомпилированного типа. Артефакты только parser могут её не содержать.
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

// Проекция только для чтения, используемая редакторами и языковыми инструментами.
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

// Результат безопасного разбора Type Source.
export interface TypeSourceCompileResult {
  ast: unknown | null
  document: TypeSourceDocument | null
  artifact: TypeProgramPayload | null
  metadata: ProgramMetadataMap
  diagnostics: Omit<ProgramDiagnostic, 'entityRef'>[]
}
