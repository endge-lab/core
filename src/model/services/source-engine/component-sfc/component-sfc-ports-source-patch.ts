import { parse as parseTS } from '@babel/parser'

import type {
  ComponentSFCPortsSourcePatch,
  ComponentSFCPortsSourcePatchResult,
  ComponentSFCPortsSourceProjection,
  ComponentSFCPortRole,
  RComponentSFC_AST_Script,
} from '@/domain/types/component/sfc'
import { createEmptyComponentSFCPortManifest } from '@/domain/types/component/sfc'
import type { ComponentSFCCompileOptions } from '@/model/services/compiler/component-sfc/component-sfc-compile'
import { compileComponentSFC } from '@/model/services/compiler/component-sfc/component-sfc-compile'
import { parseComponentSFC } from '@/model/services/compiler/component-sfc/component-sfc-parse'

interface PortsAstContext {
  script: RComponentSFC_AST_Script
  bindingName: string
  call: any
  object: any
}

export function inspectComponentSFCPortsSource(
  source: string,
  options: ComponentSFCCompileOptions = {},
): ComponentSFCPortsSourceProjection {
  const compiled = compileComponentSFC(source, options)
  const parsed = parseComponentSFC(source)
  const manifest = compiled.ir?.script.ports ?? createEmptyComponentSFCPortManifest()

  if (!parsed.ast?.script) {
    return {
      editable: true,
      bindingName: null,
      manifest,
      diagnostics: compiled.diagnostics,
    }
  }

  const located = locatePortsContext(parsed.ast.script)
  if (located.kind === 'missing') {
    return {
      editable: true,
      bindingName: null,
      manifest,
      diagnostics: compiled.diagnostics,
    }
  }
  if (located.kind === 'unsupported') {
    return {
      editable: false,
      message: located.message,
      bindingName: null,
      manifest,
      diagnostics: compiled.diagnostics,
    }
  }

  return {
    editable: isEditablePortsObject(located.context.object),
    message: isEditablePortsObject(located.context.object)
      ? undefined
      : 'definePorts содержит spread, computed key или не-literal секцию. Доступен только Source-режим.',
    bindingName: located.context.bindingName,
    manifest,
    sourceRange: {
      start: located.context.script.range.start + located.context.call.start,
      end: located.context.script.range.start + located.context.call.end,
    },
    diagnostics: compiled.diagnostics,
  }
}

export function patchComponentSFCPortsSource(
  source: string,
  patch: ComponentSFCPortsSourcePatch,
  options: ComponentSFCCompileOptions = {},
): ComponentSFCPortsSourcePatchResult {
  const current = inspectComponentSFCPortsSource(source, options)
  if (!current.editable) {
    return { ok: false, changed: false, source, projection: current, message: current.message }
  }

  try {
    const nextSource = applyPortsPatch(source, patch, current)
    const projection = inspectComponentSFCPortsSource(nextSource, options)
    const hasPortErrors = projection.diagnostics.some(item => item.severity === 'error' && item.sourcePath?.startsWith('script.definePorts'))
    if (hasPortErrors) {
      return {
        ok: false,
        changed: false,
        source,
        projection: current,
        message: projection.diagnostics.find(item => item.severity === 'error' && item.sourcePath?.startsWith('script.definePorts'))?.message,
      }
    }
    return { ok: true, changed: nextSource !== source, source: nextSource, projection }
  }
  catch (error) {
    return {
      ok: false,
      changed: false,
      source,
      projection: current,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

function applyPortsPatch(
  source: string,
  patch: ComponentSFCPortsSourcePatch,
  projection: ComponentSFCPortsSourceProjection,
): string {
  if (patch.type === 'set-event') {
    return upsertPort(source, 'emits', patch.name, serializeEvent(patch.payloadType, patch.from, patch.actionSource), projection)
  }
  if (patch.type === 'remove-event-action') {
    const event = projection.manifest.emits.events.find(item => item.name === patch.name)
    if (!event) throw new Error(`Event "${patch.name}" не найден.`)
    return upsertPort(source, 'emits', patch.name, serializeEvent(event.payloadType, event.from, null), projection)
  }
  if (patch.type === 'upsert-port') {
    assertExpression(patch.declaration)
    return upsertPort(source, patch.role, patch.name, patch.declaration.trim(), projection)
  }
  if (patch.type === 'remove-port') {
    return removePort(source, patch.role, patch.name)
  }
  if (patch.type === 'set-forward') {
    if (patch.declaration != null) assertExpression(patch.declaration)
    return setSectionValue(source, 'forward', patch.declaration?.trim() ?? null, projection)
  }
  return source
}

function serializeEvent(
  payloadType: string,
  from: { ref: string, event: string } | null | undefined,
  actionSource: string | null | undefined,
): string {
  const type = payloadType.trim() || 'unknown'
  if (actionSource) assertExpression(actionSource)
  if (!from && !actionSource) return `event<${type}>()`
  const fields: string[] = []
  if (from) fields.push(`from: { ref: ${JSON.stringify(from.ref)}, event: ${JSON.stringify(from.event)} }`)
  if (actionSource) fields.push(`action: ${actionSource.trim()}`)
  return `event<${type}>({ ${fields.join(', ')} })`
}

function upsertPort(
  source: string,
  role: ComponentSFCPortRole,
  name: string,
  declaration: string,
  projection: ComponentSFCPortsSourceProjection,
): string {
  assertIdentifier(name)
  const ensured = ensureDefinePorts(source, projection)
  const context = requirePortsContext(ensured)
  const section = findProperty(context.object, role)
  if (!section) {
    return insertObjectProperty(ensured, context.script.range.start, context.object, `${role}: {\n      ${name}: ${declaration},\n    }`, 2)
  }
  if (section.value?.type !== 'ObjectExpression') throw new Error(`definePorts.${role} доступен только в Source-режиме.`)
  const existing = findProperty(section.value, name)
  if (existing) return replaceRelative(ensured, context.script.range.start, existing.value.start, existing.value.end, declaration)
  return insertObjectProperty(ensured, context.script.range.start, section.value, `${name}: ${declaration}`, 4)
}

function removePort(source: string, role: ComponentSFCPortRole, name: string): string {
  const context = requirePortsContext(source)
  const section = findProperty(context.object, role)
  if (!section || section.value?.type !== 'ObjectExpression') return source
  const existing = findProperty(section.value, name)
  return existing ? removeObjectProperty(source, context.script.range.start, section.value, existing) : source
}

function setSectionValue(
  source: string,
  sectionName: 'forward',
  declaration: string | null,
  projection: ComponentSFCPortsSourceProjection,
): string {
  if (declaration == null && !projection.bindingName) return source
  const ensured = ensureDefinePorts(source, projection)
  const context = requirePortsContext(ensured)
  const existing = findProperty(context.object, sectionName)
  if (declaration == null)
    return existing ? removeObjectProperty(ensured, context.script.range.start, context.object, existing) : ensured
  if (existing)
    return replaceRelative(ensured, context.script.range.start, existing.value.start, existing.value.end, declaration)
  return insertObjectProperty(ensured, context.script.range.start, context.object, `${sectionName}: ${declaration}`, 2)
}

function ensureDefinePorts(source: string, projection: ComponentSFCPortsSourceProjection): string {
  if (projection.bindingName) return source
  const parsed = parseComponentSFC(source)
  if (parsed.ast?.script) {
    const offset = parsed.ast.script.range.end
    const prefix = parsed.ast.script.content.trim() ? '\n\n' : '\n'
    return `${source.slice(0, offset)}${prefix}const ports = definePorts({})\n${source.slice(offset)}`
  }
  const templateOffset = source.search(/<template\b/i)
  const block = '<script setup lang="ts">\nconst ports = definePorts({})\n</script>\n\n'
  return templateOffset >= 0 ? `${source.slice(0, templateOffset)}${block}${source.slice(templateOffset)}` : `${block}${source}`
}

function insertObjectProperty(source: string, base: number, object: any, text: string, indent: number): string {
  const offset = base + object.end - 1
  const hasItems = object.properties.length > 0
  const insertion = `${hasItems ? ',' : ''}\n${' '.repeat(indent)}${text}\n${' '.repeat(Math.max(0, indent - 2))}`
  return `${source.slice(0, offset)}${insertion}${source.slice(offset)}`
}

function removeObjectProperty(source: string, base: number, object: any, property: any): string {
  const properties = object.properties
  const index = properties.indexOf(property)
  const propertyStart = base + property.start
  const propertyEnd = base + property.end

  if (index < properties.length - 1) {
    const nextStart = base + properties[index + 1].start
    const separator = removeStructuralComma(source.slice(propertyEnd, nextStart))
    return `${source.slice(0, propertyStart)}${separator}${source.slice(nextStart)}`
  }

  if (index > 0) {
    const previousEnd = base + properties[index - 1].end
    const separator = removeStructuralComma(source.slice(previousEnd, propertyStart))
    return `${source.slice(0, previousEnd)}${separator}${source.slice(propertyEnd)}`
  }

  const objectEnd = base + object.end - 1
  const suffix = removeStructuralComma(source.slice(propertyEnd, objectEnd))
  return `${source.slice(0, propertyStart)}${suffix}${source.slice(objectEnd)}`
}

/** Removes only the object separator, leaving comments and formatting intact. */
function removeStructuralComma(source: string): string {
  let lineComment = false
  let blockComment = false
  for (let index = 0; index < source.length; index++) {
    const char = source[index]
    const next = source[index + 1]
    if (lineComment) {
      if (char === '\n' || char === '\r') lineComment = false
      continue
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false
        index++
      }
      continue
    }
    if (char === '/' && next === '/') {
      lineComment = true
      index++
      continue
    }
    if (char === '/' && next === '*') {
      blockComment = true
      index++
      continue
    }
    if (char === ',') return `${source.slice(0, index)}${source.slice(index + 1)}`
  }
  return source
}

function replaceRelative(source: string, base: number, start: number, end: number, value: string): string {
  return `${source.slice(0, base + start)}${value}${source.slice(base + end)}`
}

function requirePortsContext(source: string): PortsAstContext {
  const script = parseComponentSFC(source).ast?.script
  if (!script) throw new Error('Не удалось создать script setup для definePorts.')
  const located = locatePortsContext(script)
  if (located.kind !== 'found') throw new Error(located.kind === 'unsupported' ? located.message : 'definePorts не найден.')
  if (!isEditablePortsObject(located.context.object)) throw new Error('definePorts доступен только в Source-режиме.')
  return located.context
}

function locatePortsContext(script: RComponentSFC_AST_Script):
  | { kind: 'found', context: PortsAstContext }
  | { kind: 'missing' }
  | { kind: 'unsupported', message: string } {
  let program: any
  try {
    program = parseTS(script.content, { sourceType: 'module', plugins: ['typescript', 'topLevelAwait'] }).program
  }
  catch {
    return { kind: 'unsupported', message: 'script setup содержит синтаксическую ошибку.' }
  }
  const found: PortsAstContext[] = []
  for (const statement of program.body) {
    if (statement.type !== 'VariableDeclaration') continue
    for (const declaration of statement.declarations) {
      const call = declaration.init
      if (call?.type !== 'CallExpression' || call.callee?.type !== 'Identifier' || call.callee.name !== 'definePorts') continue
      if (declaration.id?.type !== 'Identifier' || call.arguments.length !== 1 || call.arguments[0]?.type !== 'ObjectExpression') {
        return { kind: 'unsupported', message: 'Visual editor поддерживает только `const ports = definePorts({...})`.' }
      }
      found.push({ script, bindingName: declaration.id.name, call, object: call.arguments[0] })
    }
  }
  if (found.length === 0) return { kind: 'missing' }
  if (found.length > 1) return { kind: 'unsupported', message: 'Найдено несколько definePorts.' }
  return { kind: 'found', context: found[0] }
}

function isEditablePortsObject(object: any): boolean {
  return object.properties.every((property: any) => {
    if (property.type !== 'ObjectProperty' || property.computed) return false
    const name = propertyName(property)
    if (!name || !['require', 'provides', 'emits', 'forward'].includes(name)) return false
    if (name === 'forward') return true
    return property.value?.type === 'ObjectExpression'
      && property.value.properties.every((item: any) => item.type === 'ObjectProperty' && !item.computed && Boolean(propertyName(item)))
  })
}

function findProperty(object: any, name: string): any | null {
  return object.properties.find((property: any) => property.type === 'ObjectProperty' && propertyName(property) === name) ?? null
}

function propertyName(property: any): string | null {
  if (property.key?.type === 'Identifier') return property.key.name
  if (property.key?.type === 'StringLiteral') return property.key.value
  return null
}

function assertIdentifier(value: string): void {
  if (!/^[$A-Z_a-z][$\w]*$/.test(value)) throw new Error(`Недопустимое имя порта: "${value}".`)
}

function assertExpression(source: string): void {
  const text = source.trim()
  if (!text) throw new Error('Expression не может быть пустым.')
  parseTS(`const value = (${text})`, { sourceType: 'module', plugins: ['typescript'] })
}
