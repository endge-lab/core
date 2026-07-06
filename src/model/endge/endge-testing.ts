import type { EndgeScenarioTestingOptions } from '@/domain/types/types'
import type { RaphUpdateRunner } from '@/tools/updates-generator'
import { startRaphUpdates } from '@/tools/updates-generator'
import { EndgeModule } from '@/domain/entities/endge/EndgeModule'

/**
 * Модуль управления тестовыми сценариями и генераторами updates.
 */
export class EndgeTesting extends EndgeModule {
  private _testingOptions: EndgeScenarioTestingOptions | null = null
  private _updatesRunner: RaphUpdateRunner | null = null

  /**
   * Если настройки тестирования установлены,
   * то запуск сценария будет происходить с этими настройками.
   */
  setupTestingOptions(
    options: EndgeScenarioTestingOptions | null,
    opts?: { mode: 'append' | 'replace' },
  ): void {
    opts = opts || { mode: 'replace' }

    if (opts?.mode === 'append' && this._testingOptions) {
      this._testingOptions = {
        ...this._testingOptions,
        ...options,
      }
    } else {
      this._testingOptions = options
    }
    this.notify()
  }

  /**
   * Запускает генератор Raph updates согласно текущим testing options.
   */
  startUpdatesThread(): void {
    if (this._testingOptions && this._testingOptions.updatesPerSeconds) {
      this._updatesRunner = startRaphUpdates({
        count: this._testingOptions.generatorCount || 0,
        templates: this._testingOptions.updatesOptions?.paths || new Set(),
        vars: this._testingOptions.updatesOptions?.vars || {},
        updatesPerSec: this._testingOptions.updatesPerSeconds,
      })
    }
  }

  /**
   * Останавливает активный генератор updates.
   */
  stopUpdatesThread(): void {
    this._updatesRunner?.stop()
  }

  //
  // ACCESS
  //

  /**
   * Возвращает текущие настройки тестового сценария.
   */
  get testingOptions(): EndgeScenarioTestingOptions | null {
    return this._testingOptions
  }
}
