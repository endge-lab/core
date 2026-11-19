import type { OidcBrowserSession_Adapter } from '../adapters/OidcBrowserSession_Adapter'

type OidcRedirectSource = Pick<OidcBrowserSession_Adapter, 'completeRedirectCallback' | 'hasSession' | 'loginRedirect'>

interface OidcRedirectInitializationOptions {
  /** Очищает одноразовые параметры callback после успешного обмена или ошибки. */
  clearCallback: (url: URL) => void
  beforeRedirect?: () => void
}

/** Переиспользует одну попытку восстановления или запуска browser redirect flow. */
export function createOidcRedirectInitializer(
  source: OidcRedirectSource,
  options: OidcRedirectInitializationOptions,
): () => Promise<boolean> {
  let pending: Promise<boolean> | null = null

  async function initialize(): Promise<boolean> {
    const url = new URL(globalThis.location.href)
    if (url.searchParams.has('state') && (url.searchParams.has('code') || url.searchParams.has('error'))) {
      try {
        await source.completeRedirectCallback(url.href)
      }
      finally {
        options.clearCallback(url)
      }
      return true
    }
    if (await source.hasSession()) {
      return true
    }
    options.beforeRedirect?.()
    await source.loginRedirect()
    return false
  }

  return () => {
    pending ??= initialize().finally(() => {
      pending = null
    })
    return pending
  }
}
