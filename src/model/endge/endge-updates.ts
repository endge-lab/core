import { EndgeModule } from '@/domain/entities/endge/EndgeModule'

/**
 * Модуль применения внешних update-сообщений к runtime state.
 * Legacy update-профили из документа настроек удалены; новый SSE pipeline
 * должен описываться отдельной доменной моделью.
 */
export class EndgeUpdates extends EndgeModule {
  public applyUpdateForProfile(
    profileIdentity: string,
    message: unknown,
    opts: { vars?: Record<string, string> } = {},
  ): number {
    void profileIdentity
    void message
    void opts
    return 0
  }
}
