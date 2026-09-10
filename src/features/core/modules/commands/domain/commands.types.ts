import type { EndgeDataMode } from '@/features/core/modules/workspace/domain/workspace.types'

/** Параметры явных команд Core; это запросы на изменение, а не произошедшие события. */
export interface EndgeCommandMap {
  'context:set-workspace': { workspace: string | null }
  'context:set-tenant': { tenant: string }
  'context:set-project': { project: string }
  'context:set-environment': { environment: string }
  'context:set-user': { user: string }
  'context:set-locale': { locale: string | null }
  'context:set-theme': { theme: string | null }
  'context:set-timezone': { timezone: string | null }
  'context:set-data-mode': { dataMode: EndgeDataMode | null }
}

export type EndgeCommandType = keyof EndgeCommandMap

/** Связывает имя команды с её payload для единой точки execute(). */
export type EndgeCommand = {
  [K in EndgeCommandType]: {
    readonly type: K
    readonly payload: Readonly<EndgeCommandMap[K]>
  }
}[EndgeCommandType]
