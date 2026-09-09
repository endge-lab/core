import type { DebugConnectionRequest } from '@/features/core/modules/bridge/domain/bridge.type'

/** Browser boundary bridge. Не владеет сессиями или политикой доступа. */
export class BrowserBridge_Adapter {
  /** Открывает стандартный WebSocket; cookie authentication выполняет браузер. */
  public open(url: string): WebSocket {
    return new WebSocket(url)
  }

  /** Показывает встроенное подтверждение. Отсутствие browser API означает отказ. */
  public async confirmDebugConnection(request: DebugConnectionRequest): Promise<boolean> {
    if (typeof window === 'undefined') {
      return false
    }
    // eslint-disable-next-line no-alert -- Явно согласованный native confirm (09.09.2026); исключение только до замены bridge dialog adapter.
    return window.confirm([
      `Пользователь ${request.displayName} запрашивает подключение для отладки.`,
      `Сервер: ${request.serverUrl}`,
      `Workspace: ${request.workspaceIdentity}`,
      '',
      'Разрешить получение полного диагностического снимка и команды симуляции?',
    ].join('\n'))
  }

  /** SHA-256 точного sourceVersion/source tuple, без имени и локального document id. */
  public async hashSimulation(source: { sourceVersion: number, source: string }): Promise<string> {
    const bytes = new TextEncoder().encode(JSON.stringify([source.sourceVersion, source.source]))
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  }

  /** Подписывает owner на уход/восстановление страницы и возвращает cleanup. */
  public subscribePage(onHide: () => void, onShow: () => void): () => void {
    if (typeof window === 'undefined') {
      return () => {}
    }
    window.addEventListener('pagehide', onHide)
    window.addEventListener('pageshow', onShow)
    return () => {
      window.removeEventListener('pagehide', onHide)
      window.removeEventListener('pageshow', onShow)
    }
  }
}
