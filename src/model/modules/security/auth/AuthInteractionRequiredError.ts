/** Сигнал host-приложению, что продолжение требует пользовательского OIDC flow. */
export class AuthInteractionRequiredError extends Error {
  public readonly code = 'auth_interaction_required'

  public constructor(public readonly profileIdentity: string) {
    super(`[EndgeAuth] Authentication is required: ${profileIdentity}`)
    this.name = 'AuthInteractionRequiredError'
  }
}
