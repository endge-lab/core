import type { FlowHandlerContext } from '@/domain/types/action.types'

export type { FlowHandlerContext }

/**
 * Параметр входа условия из реестра (для UI и валидации).
 */
export interface FlowConditionInputParam {
  name: string
  label: string
  valueType: string
  optional?: boolean
  /** Секции домена, с которых разрешён выбор сущности (например vocabs). */
  acceptSectionTypes?: string[]
}

/**
 * Спека условия для реестра (метаданные + evaluator).
 */
export interface FlowConditionSpec {
  id: string
  title: string
  description: string | null
  inputParams: FlowConditionInputParam[]
  evaluate(ctx: FlowHandlerContext, params: Record<string, unknown>): boolean | Promise<boolean>
}

/**
 * Конфиг одной ветки switch в режиме реестра.
 */
export interface FlowSwitchBranchConfig {
  conditionId: string
  params: Record<string, unknown>
  portId: string
}

/**
 * Параметры узла switch в flow.
 */
export interface FlowSwitchParams {
  conditionMode?: 'script' | 'registry'
  scriptExpression?: string
  branches?: FlowSwitchBranchConfig[]
}
