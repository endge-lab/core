import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import { Raph } from '@endge/raph'
import { Endge } from '@/model/endge/endge'

export interface EndgeConsoleCommandMeta {
  name: string
  description?: string
}

/**
 * Глобальная регистрация команд для консоли разработчика.
 * В globalThis.Endge выставляется только объект с зарегистрированными методами (Endge.tab(), Endge.document() и т.д.),
 * класс Endge в глобал не публикуется.
 */
export class EndgeConsole extends EndgeModule {
  private _handlers = new Map<string, (...args: any[]) => any>()
  private _meta = new Map<string, EndgeConsoleCommandMeta>()
  private _isExposed = false

  /**
   * Регистрирует стандартные debug-команды и публикует консольный facade.
   */
  public override start(): void {
    this.register('raph', () => { console.log(Raph.data) }, 'Текущее содержимое Raph')
    this.register('domain', () => { console.log(Endge.domain) }, 'Текущий домен Endge')
    this.exposeToGlobal()
  }

  /**
   * Регистрирует команду консоли. После exposeToGlobal() будет доступна как Endge[name]().
   */
  public register(name: string, fn: (...args: any[]) => any, description?: string): void {
    const key = String(name ?? '').trim()
    if (!key)
      throw new Error('[EndgeConsole] name is required')
    this._handlers.set(key, fn)
    this._meta.set(key, {
      name: key,
      description: String(description ?? '').trim() || undefined,
    })
    if (this._isExposed)
      this.exposeToGlobal()
  }

  /**
   * Удаляет зарегистрированную команду.
   */
  public unregister(name: string): void {
    const key = String(name ?? '').trim()
    this._handlers.delete(key)
    this._meta.delete(key)
    if (this._isExposed)
      this.exposeToGlobal()
  }

  /**
   * Возвращает все зарегистрированные имена.
   */
  public getRegistered(): string[] {
    return Array.from(this._handlers.keys())
  }

  /**
   * Возвращает зарегистрированные команды вместе с описаниями.
   */
  public getRegisteredMeta(): EndgeConsoleCommandMeta[] {
    return Array.from(this._meta.values())
  }

  /**
   * Выставляет в globalThis.Endge объект только с зарегистрированными командами (фасад).
   * Класс Endge в глобал не попадает.
   */
  public exposeToGlobal(): void {
    const facade: Record<string, (...args: any[]) => any> = {}
    for (const [name, fn] of this._handlers)
      facade[name] = fn
    ;(globalThis as any).Endge = facade
    this._isExposed = true
  }
}
