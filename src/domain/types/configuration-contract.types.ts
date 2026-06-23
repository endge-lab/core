import type {
  EndgeFacetType,
  FacetedCascadeContractBase,
  FacetedCascadeSchema,
} from '@/domain/types/faceted-cascade'

/**
 * Канонический тип значения конфигурационного поля.
 * Нужен для UI, валидации и безопасной навигации по runtime-config mirror.
 */
export enum ConfigurationValueType {
  String = 'string',
  Number = 'number',
  Boolean = 'boolean',
  Object = 'object',
  Array = 'array',
  Enum = 'enum',
  Unknown = 'unknown',
}

/**
 * Политика runtime-мутации поля.
 * `none` - поле вычисляется только через base/cascade.
 * `patch` - поле допускает временный runtime patch.
 * `replace` - поле можно полностью заменить во время исполнения.
 */
export type ConfigurationMutationPolicy = 'none' | 'patch' | 'replace'

/**
 * Контракт одного конфигурационного поля сущности.
 * Описывает не реакцию и не renderer, а сам слот конфигурации.
 */
export interface ConfigurationContract<TEntity extends string = string>
  extends FacetedCascadeContractBase<TEntity> {
  facet: EndgeFacetType.Configuration

  /**
   * Канонический путь поля внутри конфигурации сущности.
   * Примеры: `tree[*].disabled`, `params.pageSize`, `layout.header.visible`.
   */
  fieldPath: string

  /**
   * Тип значения поля.
   */
  valueType: ConfigurationValueType

  /**
   * Можно ли подписываться на поле через runtime-config mirror.
   */
  supportsWatch?: boolean

  /**
   * Можно ли изменять поле во время исполнения без мутации base-модели.
   */
  runtimeMutationPolicy?: ConfigurationMutationPolicy

  /**
   * Необязательная схема для валидации и editor UI.
   */
  schema?: FacetedCascadeSchema | null

  /**
   * Необязательное значение по умолчанию для документации/inspectors.
   */
  defaultValue?: unknown
}
