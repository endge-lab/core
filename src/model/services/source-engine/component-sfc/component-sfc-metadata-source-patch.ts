import type {
  ComponentSFCMetadataSourcePatchResult,
  ComponentSFCMetadataVisualProjection,
} from '@/domain/types/component/sfc'
import type { ProgramMetadataMap } from '@/domain/types/program/program-metadata.types'

import { compileComponentSFC } from '@/model/services/compiler/component-sfc/component-sfc-compile'

/** Reads component-level defineMetadata as strict JSON for the visual editor. */
export function inspectComponentSFCMetadata(source: string): ComponentSFCMetadataVisualProjection {
  const compiled = compileComponentSFC(source)
  const declarations = compiled.ast?.script?.metadata ?? []

  if (declarations.length > 1) {
    return {
      mode: 'duplicate',
      editable: false,
      metadata: {},
      json: '{}',
      sourceRange: declarations[0]?.range ?? null,
      message: 'Найдено несколько defineMetadata. Удалите дубликаты во вкладке Source.',
    }
  }

  const declaration = declarations[0]
  if (!declaration) {
    return {
      mode: 'missing',
      editable: true,
      metadata: {},
      json: '{}',
      sourceRange: null,
    }
  }

  const metadataErrors = compiled.diagnostics.filter(diagnostic => (
    diagnostic.severity === 'error'
    && (
      diagnostic.sourcePath?.startsWith('script.defineMetadata')
      || diagnostic.code.startsWith('program-metadata')
      || diagnostic.code.startsWith('sfc-metadata')
    )
  ))
  if (metadataErrors.length > 0) {
    return {
      mode: 'invalid',
      editable: false,
      metadata: {},
      json: declaration.source,
      sourceRange: declaration.range,
      message: 'defineMetadata не является статическим JSON-compatible object. Исправьте его во вкладке Source.',
    }
  }

  return {
    mode: 'static',
    editable: true,
    metadata: compiled.metadata.self,
    json: serializeMetadataJSON(compiled.metadata.self),
    sourceRange: declaration.range,
  }
}

/** Replaces one defineMetadata call or inserts it into script setup. */
export function patchComponentSFCMetadataSource(
  source: string,
  metadata: ProgramMetadataMap,
): ComponentSFCMetadataSourcePatchResult {
  const current = inspectComponentSFCMetadata(source)
  const compiled = compileComponentSFC(source)
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

  const macro = `defineMetadata(${serializeMetadataJSON(metadata)})`
  const declaration = compiled.ast?.script?.metadata[0]
  let nextSource: string
  if (declaration) {
    nextSource = replaceRange(source, declaration.range.start, declaration.range.end, macro)
  }
  else if (compiled.ast?.script) {
    nextSource = insertAt(source, compiled.ast.script.range.start, `${macro}\n\n`)
  }
  else {
    nextSource = `<script setup lang="ts">\n${macro}\n</script>\n\n${source}`
  }

  const nextCompiled = compileComponentSFC(nextSource)
  const nextProjection = inspectComponentSFCMetadata(nextSource)
  const valid = nextProjection.editable
    && nextProjection.mode === 'static'
    && serializeMetadataJSON(nextProjection.metadata) === serializeMetadataJSON(metadata)

  if (!valid) {
    return {
      ok: false,
      source,
      changed: false,
      projection: current,
      diagnostics: nextCompiled.diagnostics,
      message: 'Не удалось безопасно обновить defineMetadata.',
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

function serializeMetadataJSON(metadata: ProgramMetadataMap): string {
  return JSON.stringify(metadata, null, 2)
}

function replaceRange(source: string, start: number, end: number, value: string): string {
  return `${source.slice(0, start)}${value}${source.slice(end)}`
}

function insertAt(source: string, offset: number, value: string): string {
  return `${source.slice(0, offset)}${value}${source.slice(offset)}`
}
