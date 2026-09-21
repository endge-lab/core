export type RQueryAuthMode = 'none' | 'inherit' | 'profile'

export interface RQueryAuth {
  mode: RQueryAuthMode
  /** Identity auth-profile для mode=profile. */
  profile?: string

  /** Схема для заголовка (по умолчанию "Bearer"). */
  scheme?: string

  /** Имя заголовка (по умолчанию "Authorization"). */
  headerName?: string

  /**
   * Куда класть токен: в заголовок или в query.
   * По умолчанию 'header'.
   */
  sendAs?: 'header' | 'query'

  /** Имя query-параметра (если sendAs='query', по умолчанию 'access_token'). */
  queryParamName?: string
}
