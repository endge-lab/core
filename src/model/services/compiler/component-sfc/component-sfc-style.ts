import type { RComponentDiagnostic } from '@/domain/types/component/component-core.types'
import type { RComponentSFC_AST_Style, RComponentSFC_IR_Style } from '@/domain/types/component/sfc'

import { compileEndgeCSS } from '@/model/services/style'

export interface ComponentSFCStyleCompileResult {
  style: RComponentSFC_IR_Style | null
  diagnostics: RComponentDiagnostic[]
}

export interface ComponentSFCStyleCompileOptions {
  identity?: string
}

function stableScopeId(identity: string): string {
  const readable = identity.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'component'
  let hash = 2166136261
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `es-${readable}-${(hash >>> 0).toString(36)}`
}

/** Compiles an SFC style block through the same EndgeCSS pipeline as RStyle. */
export function compileComponentSFCStyle(
  style: RComponentSFC_AST_Style | null,
  options: ComponentSFCStyleCompileOptions = {},
): ComponentSFCStyleCompileResult {
  if (!style)
    return { style: null, diagnostics: [] }

  if (style.lang && style.lang.toLowerCase() !== 'endgecss') {
    return {
      style: null,
      diagnostics: [{
        severity: 'error',
        code: 'sfc-style-lang-unsupported',
        message: `Explicit style language "${style.lang}" is unsupported. Use lang="endgecss" or omit lang.`,
        sourcePath: 'style',
        start: style.range.start,
        end: style.range.end,
      }],
    }
  }

  const identity = options.identity?.trim() || 'anonymous-component'
  const result = compileEndgeCSS(style.content, {
    identity: `${identity}:style`,
    scope: style.scoped ? 'component' : 'global',
    scopeId: style.scoped ? stableScopeId(identity) : undefined,
  })
  return {
    style: result.artifact,
    diagnostics: result.diagnostics.map(diagnostic => ({
      severity: diagnostic.severity,
      code: diagnostic.code,
      message: diagnostic.message,
      sourcePath: 'style',
      start: diagnostic.range ? style.range.start + diagnostic.range.start : style.range.start,
      end: diagnostic.range ? style.range.start + diagnostic.range.end : style.range.end,
    })),
  }
}
