import type { RComponentSFC_IR_Prop } from '@/features/core/modules/domain/types/component/sfc/ir.types'
import type {
  ComponentSFCPropsSourcePatchResult,
  ComponentSFCPropsVisualProjection,
} from '@/features/core/modules/domain/types/component/sfc/props-visual.types'

import { compileComponentSFC } from '@/features/core/modules/compiler/services/component-sfc/component-sfc-compile'
import { parseComponentSFCTypeFields } from '@/features/core/modules/compiler/services/component-sfc/component-sfc-script'

/** Читает defineProps как проекцию на основе Source. Именованные и runtime-контракты остаются во владении Source. */
export function inspectComponentSFCProps(source: string): ComponentSFCPropsVisualProjection {
  const compiled = compileComponentSFC(source)
  const declaration = compiled.ast?.script?.props
  const props = declaration && compiled.ast?.script
    ? parseComponentSFCTypeFields(declaration.source, compiled.ast.script.content)
    : []

  if (!declaration) {
    return {
      mode: 'missing',
      editable: true,
      props,
      sourceRange: null,
    }
  }

  if (declaration.mode === 'runtime') {
    return {
      mode: 'runtime',
      editable: false,
      props,
      sourceRange: declaration.range,
      message: 'Runtime defineProps можно изменить только в Source.',
    }
  }

  const inline = declaration.source.trim().startsWith('{')
    && declaration.source.trim().endsWith('}')
  return {
    mode: inline ? 'inline-type' : 'named-type',
    editable: inline,
    props,
    sourceRange: declaration.range,
    message: inline
      ? undefined
      : 'Named TypeScript contract можно изменить только в Source.',
  }
}

/** Заменяет только вызов defineProps либо вставляет его в script setup при отсутствии. */
export function patchComponentSFCPropsSource(
  source: string,
  props: readonly RComponentSFC_IR_Prop[],
): ComponentSFCPropsSourcePatchResult {
  const compiled = compileComponentSFC(source)
  const current = inspectComponentSFCProps(source)
  if (!current.editable) {
    return {
      ok: false,
      source,
      changed: false,
      projection: current,
      diagnostics: compiled.diagnostics,
      message: current.message,
    }
  }

  const declaration = compiled.ast?.script?.props
  const macro = serializeDefineProps(props)
  let nextSource: string
  if (declaration) {
    nextSource = replaceRange(source, declaration.range.start, declaration.range.end, macro)
  }
  else if (compiled.ast?.script) {
    nextSource = insertAt(source, compiled.ast.script.range.start, `${macro}\n\n`)
  }
  else {
    const prefix = `<script setup lang="ts">\n${macro}\n</script>\n\n`
    nextSource = `${prefix}${source}`
  }

  const nextCompiled = compileComponentSFC(nextSource)
  const nextProjection = inspectComponentSFCProps(nextSource)
  const valid = nextProjection.mode === 'inline-type'
    && nextProjection.props.length === props.length

  if (!valid) {
    return {
      ok: false,
      source,
      changed: false,
      projection: current,
      diagnostics: nextCompiled.diagnostics,
      message: 'Не удалось безопасно обновить inline defineProps contract.',
    }
  }

  return {
    ok: true,
    source: nextSource,
    changed: nextSource !== source,
    projection: nextProjection,
    diagnostics: nextCompiled.diagnostics,
  }
}

function serializeDefineProps(props: readonly RComponentSFC_IR_Prop[]): string {
  if (props.length === 0) {
    return 'defineProps<{}>()'
  }

  const fields = props.map((prop) => {
    const name = /^[A-Z_$][\w$]*$/i.test(prop.name)
      ? prop.name
      : JSON.stringify(prop.name)
    const optional = prop.optional ? '?' : ''
    const type = normalizeType(prop.type, prop.isArray === true)
    return `  ${name}${optional}: ${type}`
  })
  return `defineProps<{\n${fields.join('\n')}\n}>()`
}

function normalizeType(rawType: string, array: boolean): string {
  const type = rawType.trim() || 'unknown'
  if (!array || /\[\]$/.test(type) || /^Array<.+>$/.test(type)) {
    return type
  }
  return needsArrayParentheses(type) ? `(${type})[]` : `${type}[]`
}

function needsArrayParentheses(type: string): boolean {
  return type.includes('|') || type.includes('&') || type.includes('=>')
}

function replaceRange(source: string, start: number, end: number, value: string): string {
  return `${source.slice(0, start)}${value}${source.slice(end)}`
}

function insertAt(source: string, offset: number, value: string): string {
  return `${source.slice(0, offset)}${value}${source.slice(offset)}`
}
