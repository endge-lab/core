/** Browser boundary bridge. Не владеет сессиями или политикой доступа. */
export class BrowserBridge_Adapter {
  /** Открывает стандартный WebSocket; cookie authentication выполняет браузер. */
  public open(url: string): WebSocket {
    return new WebSocket(url)
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
