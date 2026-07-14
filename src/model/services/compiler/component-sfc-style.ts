import type { RComponentDiagnostic } from '@/domain/types/component/component-core.types'
import type {
  RComponentSFC_AST_Style,
  RComponentSFC_IR_Style,
} from '@/domain/types/component/sfc'

/** Результат компиляции style-секции. */
export interface ComponentSFCStyleCompileResult {
  /** IR style или null, если style отсутствует. */
  style: RComponentSFC_IR_Style | null

  /** Diagnostics style pass. */
  diagnostics: RComponentDiagnostic[]
}

/** Компилирует style-секцию в renderer-neutral IR. */
export function compileComponentSFCStyle(style: RComponentSFC_AST_Style | null): ComponentSFCStyleCompileResult {
  const diagnostics: RComponentDiagnostic[] = []

  if (!style) {
    return {
      style: null,
      diagnostics,
    }
  }

  if (style.lang && style.lang !== 'endgecss') {
    diagnostics.push({
      severity: 'warning',
      code: 'sfc-style-lang-unsupported',
      message: `Для SFC v1 ожидается style lang="endgecss", получено "${style.lang}".`,
      sourcePath: 'style',
      start: style.range.start,
      end: style.range.end,
    })
  }

  return {
    style: {
      scoped: style.scoped,
      content: style.content,
      rules: [],
    },
    diagnostics,
  }
}
