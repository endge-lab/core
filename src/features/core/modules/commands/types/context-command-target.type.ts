import type { EndgeDataMode } from '@/features/core/modules/workspace/domain/workspace.types'

/** Владелец локальных операций: Core setters либо штатные операции приложения с reset/boot. */
export interface EndgeContextCommandTarget {
  setCurrentWorkspace: (workspace: string | null) => void | Promise<void>
  setCurrentTenant: (tenant: string) => void | Promise<void>
  setCurrentProject: (project: string) => void | Promise<void>
  setCurrentEnvironment: (environment: string) => void | Promise<void>
  setCurrentUser: (user: string) => void | Promise<void>
  setCurrentLocale: (locale: string | null) => void | Promise<void>
  setCurrentTheme: (theme: string | null) => void | Promise<void>
  setCurrentTimezone: (timezone: string | null) => void | Promise<void>
  setDataMode: (dataMode: EndgeDataMode) => void | Promise<void>
  clearDataModeOverride: () => void | Promise<void>
}
