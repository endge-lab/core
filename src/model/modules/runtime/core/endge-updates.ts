import { EndgeModule } from '@/domain/entities/endge/EndgeModule'

/**
 * Модуль применения внешних update-сообщений к runtime state.
 * Устаревшие update-профили из документа настроек удалены; новый SSE pipeline
 * должен описываться отдельной доменной моделью.
 */
export class EndgeUpdates extends EndgeModule {
  /** Обрабатывает legacy update profile; текущая реализация оставлена как no-op boundary. */
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
