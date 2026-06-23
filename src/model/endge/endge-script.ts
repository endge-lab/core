import { ScriptRunner } from '@endge/utils'
import type { RuntimeContext } from '@/domain/entities/runtime/RuntimeContext'
import { Endge } from '@/model/endge/endge'
import { RuntimeEnvironment } from '@/domain/entities/runtime/RuntimeEnvironment'
import { apiMount } from '@/domain/script-api/mount'
import { apiQuery } from '@/domain/script-api/query'
import { apiWatch } from '@/domain/script-api/watch'
import type { RuntimeScope } from '@/domain/entities/runtime/RuntimeScope'
import { apiExpose } from '@/domain/script-api/expose'
import { formatDatetimeTZ } from '@endge/utils'
import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
// import * as monaco from 'monaco-editor'
// import declareScenario from '@/domain/declare/scenario?raw'

/**
 * Логика работы со скриптами и JSX.
 */
export class EndgeScript extends EndgeModule {
  // Создает наш контекст скрипта для коммуникации между слоями (мост).
  // Окружение общее на весь проект.
  // Пока не нашел кейсов, когда нужно несколько окружений.
  // Для модульности окружение сегментируется на scopes.
  env: RuntimeEnvironment = new RuntimeEnvironment()

  /**
   * Настроить глобальный контекст редактора для живых подсказок (Контекст сценария)
   */
  declareScenario(): void {
    // monaco.languages.typescript.typescriptDefaults.setExtraLibs([])
    // monaco.languages.typescript.typescriptDefaults.addExtraLib(
    //   declareScenario,
    //   'ts:endge-runtime.d.ts',
    // )
    //
    // monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
    //   target: monaco.languages.typescript.ScriptTarget.ES2020,
    //   module: monaco.languages.typescript.ModuleKind.ESNext,
    //   allowNonTsExtensions: true,
    //   noLib: true,
    //   lib: [],
    // })
  }

  /**
   * Настроить глобальный контекст редактора для живых подсказок (Контекст DSL рендера)
   */
  declareJSX(): void {
    // monaco.languages.typescript.typescriptDefaults.setExtraLibs([])
    // monaco.languages.typescript.typescriptDefaults.addExtraLib(
    //   declareJSX,
    //   'ts:endge-runtime.d.ts',
    // )
    //
    // monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
    //   jsx: monaco.languages.typescript.JsxEmit.Preserve,
    //   target: monaco.languages.typescript.ScriptTarget.ESNext,
    //   allowJs: true,
    //   allowNonTsExtensions: true,
    //   moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    // })
  }

  /**
   * Создает внутренний контекст скрипта, доступный пользователю
   */
  makeContext(
    scope: RuntimeScope,
    ctxExtended: Partial<RuntimeContext> = {},
  ): RuntimeContext {
    const context = {
      UnsafeEndge: Endge,
      scopeId: scope.id,
      expose: (data: Record<string, CallableFunction>) =>
        apiExpose(scope, data),
      query: (queryId: string) => apiQuery(scope, queryId),
      watch: (queryId: string) => apiWatch(scope, queryId),
      mount: (componentId: string) => apiMount(scope, componentId),
      format: (date: Date, format: string = 'HH:mm') => {
        return formatDatetimeTZ(date, format)
      },
      ...ctxExtended,
    }

    // Автоматически включаем экспортируемые функции
    if (scope.export.names) {
      for (const [name, fn] of Object.entries(scope.export.names)) {
        if (!(name in context)) {
          context[name] = fn
        }
      }
    }

    //
    return context
  }

  /**
   * Возвращает наш контекст скрипта для коммуникации между слоями (мост)
   */
  getEnvironment(): RuntimeEnvironment {
    return this.env
  }

  /**
   * Возвращает сегмент окружения по id.
   */
  getScope(id: string, parent?: RuntimeScope): RuntimeScope {
    return this.getEnvironment().getScope(id, parent)
  }

  /**
   * Запуск скрипта асинхронно.
   */
  async runAsync(
    script: string,
    scope: RuntimeScope,
    ctx: Partial<RuntimeContext> = {},
    exportNames: Set<string> = new Set(), // Имена, которые экспортирует скрипт неявно (глобальным определением)
  ): Promise<void> {
    const context = this.makeContext(scope, ctx)

    const runner = new ScriptRunner(script)
    return await runner.runAsync(context, exportNames)
  }

  /**
   * Запуск скрипта синхронно.
   */
  runSync(
    script: string,
    scope: RuntimeScope,
    ctx: Partial<RuntimeContext> = {},
    exportNames: Set<string> = new Set(), // Имена, которые экспортирует скрипт неявно (глобальным определением)
  ): void {
    const context = this.makeContext(scope, ctx)

    const runner = new ScriptRunner(script)
    return runner.runSync(context, exportNames)
  }

  /**
   * Вычисление выражения синхронно с возвратом результата.
   */
  evaluate(
    script: string,
    scope: RuntimeScope,
    ctx: Partial<RuntimeContext> = {},
  ): any {
    const context = this.makeContext(scope, ctx)

    const runner = new ScriptRunner(script)
    return runner.evaluate(context)
  }
}

// import { ScriptRunner } from '@endge/utils'
// import type { RuntimeContext } from '@/domain/entities/runtime/RuntimeContext'
// import { Endge } from '@/domain/endge/endge'
// import { RuntimeEnvironment } from '@/domain/entities/runtime/RuntimeEnvironment'
// import { apiMount } from '@/domain/script-api/mount'
// import { apiQuery } from '@/domain/script-api/query'
// import { apiWatch } from '@/domain/script-api/watch'
// import declareJSX from '@/domain/declare/jsx.ts?raw'
// import type { RuntimeScope } from '@/domain/entities/runtime/RuntimeScope'
// import { apiExpose } from '@/domain/script-api/expose'
// import * as monaco from 'monaco-editor'
// import declareScenario from '@/domain/declare/scenario?raw'
// import { formatDatetimeTZ } from '@endge/utils'
//
// /**
//  * Логика работы со скриптами и JSX.
//  */
// export class EndgeScript {
//   // Создает наш контекст скрипта для коммуникации между слоями (мост).
//   // Окружение общее на весь проект.
//   // Пока не нашел кейсов, когда нужно несколько окружений.
//   // Для модульности окружение сегментируется на scopes.
//   env: RuntimeEnvironment = new RuntimeEnvironment()
//
//   /**
//    * Настроить глобальный контекст редактора для живых подсказок (Контекст сценария)
//    */
//   declareScenario(): void {
//     monaco.languages.typescript.typescriptDefaults.setExtraLibs([])
//     monaco.languages.typescript.typescriptDefaults.addExtraLib(
//       declareScenario,
//       'ts:endge-runtime.d.ts',
//     )
//
//     monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
//       target: monaco.languages.typescript.ScriptTarget.ES2020,
//       module: monaco.languages.typescript.ModuleKind.ESNext,
//       allowNonTsExtensions: true,
//       noLib: true,
//       lib: [],
//     })
//   }
//
//   /**
//    * Настроить глобальный контекст редактора для живых подсказок (Контекст DSL рендера)
//    */
//   declareJSX(): void {
//     monaco.languages.typescript.typescriptDefaults.setExtraLibs([])
//     monaco.languages.typescript.typescriptDefaults.addExtraLib(
//       declareJSX,
//       'ts:endge-runtime.d.ts',
//     )
//
//     monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
//       jsx: monaco.languages.typescript.JsxEmit.Preserve,
//       target: monaco.languages.typescript.ScriptTarget.ESNext,
//       allowJs: true,
//       allowNonTsExtensions: true,
//       moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
//     })
//   }
//
//   /**
//    * Создает внутренний контекст скрипта, доступный пользователю
//    */
//   makeContext(
//     scope: RuntimeScope,
//     ctxExtended: Partial<RuntimeContext> = {},
//   ): RuntimeContext {
//     const context = {
//       UnsafeEndge: Endge,
//       scopeId: scope.id,
//       expose: (data: Record<string, CallableFunction>) =>
//         apiExpose(scope, data),
//       query: (queryId: string) => apiQuery(scope, queryId),
//       watch: (queryId: string) => apiWatch(scope, queryId),
//       mount: (componentId: string) => apiMount(scope, componentId),
//       format: (date: Date, format: string = 'HH:mm') => {
//         return formatDatetimeTZ(date, format)
//       },
//       ...ctxExtended,
//     }
//
//     // Автоматически включаем экспортируемые функции
//     if (scope.export.names) {
//       for (const [name, fn] of Object.entries(scope.export.names)) {
//         if (!(name in context)) {
//           context[name] = fn
//         }
//       }
//     }
//
//     //
//     return context
//   }
//
//   /**
//    * Возвращает наш контекст скрипта для коммуникации между слоями (мост)
//    */
//   getEnvironment(): RuntimeEnvironment {
//     return this.env
//   }
//
//   /**
//    * Возвращает сегмент окружения по id.
//    */
//   getScope(id: string, parent?: RuntimeScope): RuntimeScope {
//     return this.getEnvironment().getScope(id, parent)
//   }
//
//   /**
//    * Запуск скрипта асинхронно.
//    */
//   async runAsync(
//     script: string,
//     scope: RuntimeScope,
//     ctx: Partial<RuntimeContext> = {},
//     exportNames: Set<string> = new Set(), // Имена, которые экспортирует скрипт неявно (глобальным определением)
//   ): Promise<void> {
//     const context = this.makeContext(scope, ctx)
//
//     const runner = new ScriptRunner(script)
//     return await runner.runAsync(context, exportNames)
//   }
//
//   /**
//    * Запуск скрипта синхронно.
//    */
//   runSync(
//     script: string,
//     scope: RuntimeScope,
//     ctx: Partial<RuntimeContext> = {},
//     exportNames: Set<string> = new Set(), // Имена, которые экспортирует скрипт неявно (глобальным определением)
//   ): void {
//     const context = this.makeContext(scope, ctx)
//
//     const runner = new ScriptRunner(script)
//     return runner.runSync(context, exportNames)
//   }
//
//   /**
//    * Вычисление выражения синхронно с возвратом результата.
//    */
//   evaluate(
//     script: string,
//     scope: RuntimeScope,
//     ctx: Partial<RuntimeContext> = {},
//   ): any {
//     const context = this.makeContext(scope, ctx)
//
//     const runner = new ScriptRunner(script)
//     return runner.evaluate(context)
//   }
// }
