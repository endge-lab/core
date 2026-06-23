import { RuntimeScope } from '@/domain/entities/runtime/RuntimeScope'

/**
 * Среда исполнения скрипта для коммуникации между UI и скриптом
 */
export class RuntimeEnvironment {
  private scopes = new Map<string, RuntimeScope>()

  /**
   * Возвращает RuntimeScope по id.
   * Если не существует, создает новый.
   */
  getScope(id: string, parent?: RuntimeScope): RuntimeScope {
    if (!this.scopes.has(id)) {
      this.scopes.set(id, new RuntimeScope(id, parent))
    }
    return this.scopes.get(id)!
  }
}
