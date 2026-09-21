import type { ProgramEntityType } from '../domain/types/program.types'
import {
  bundleObject,
  bundleText,
} from '@/features/core/kernel/tools/bundle-json'

/** Проверяет форму каждой исполняемой семьи без парсинга исходного языка. */
export function validatePortableProgramPayload(
  type: ProgramEntityType,
  input: unknown,
): void {
  const value = bundleObject(input, `${type} payload`)
  const arrays = (keys: string[], owner = value) => {
    for (const key of keys) {
      if (!Array.isArray(owner[key])) {
        throw new TypeError(`[Bundle] Invalid ${type}.${key}`)
      }
    }
  }
  const objects = (keys: string[], owner = value) => {
    for (const key of keys) {
      bundleObject(owner[key], `${type}.${key}`)
    }
  }
  if (value.ast != null) {
    bundleObject(value.ast, `${type} AST`)
  }
  if (
    !['component-sfc', 'computation', 'style', 'data-view'].includes(type)
    && (!Number.isSafeInteger(value.sourceVersion)
      || Number(value.sourceVersion) < 1)
  ) {
    throw new Error('[Bundle] Invalid source contract version')
  }
  if (
    [
      'type',
      'configuration',
      'action',
      'data-view',
      'store',
      'stream',
      'simulation',
      'update',
      'filter',
      'composition',
    ].includes(type)
    && value.type !== type
  ) {
    throw new Error('[Bundle] Payload family mismatch')
  }
  switch (type) {
    case 'component-sfc': {
      const ir = bundleObject(value.ir, 'SFC IR')
      if (ir.version !== 2) {
        throw new Error('[Bundle] Unsupported SFC IR; rebuild the program')
      }
      arrays(
        ['props', 'locals', 'portCalls'],
        bundleObject(ir.script, 'SFC script'),
      )
      arrays(['roots'], bundleObject(ir.template, 'SFC template'))
      objects(['contract', 'dependencies', 'runtimeDependencies'])
      break
    }
    case 'type':
      if (value.definition !== null) {
        objects(['definition'])
      }
      break
    case 'configuration':
      arrays(['values'])
      bundleText(value.identity, 'configuration identity')
      break
    case 'computation':
      arrays(['nodes'])
      if (!['sync', 'async'].includes(String(value.execution))) {
        throw new Error('[Bundle] Invalid computation execution')
      }
      break
    case 'action':
      if (value.sourceDocument !== null) {
        objects(['sourceDocument'])
      }
      if (value.target !== null) {
        arrays(['target'])
      }
      break
    case 'query':
      bundleText(value.type, 'query type')
      arrays(['props', 'outputs'])
      if (
        !Object.hasOwn(value, 'endpoint')
        || !Object.hasOwn(value, 'requestBody')
      ) {
        throw new Error('[Bundle] Missing query request')
      }
      break
    case 'vocab':
      arrays(['outputs'])
      if (value.provider !== null) {
        objects(['provider'])
      }
      break
    case 'data-view':
      arrays(['steps'])
      objects(['output'])
      if (
        !['manual', 'pipeline', 'projection', 'expression'].includes(
          String(value.mode),
        )
      ) {
        throw new Error('[Bundle] Invalid DataView mode')
      }
      break
    case 'store':
      arrays(['data', 'updateHandlers'])
      break
    case 'stream':
      objects(['transport'])
      arrays(['events'])
      break
    case 'simulation':
      objects(['target'])
      arrays(['runtimes'])
      break
    case 'update':
      arrays(['handles', 'mutations'])
      bundleText(value.storeIdentity, 'update store')
      break
    case 'filter':
      arrays(['fields', 'outputs'])
      objects(['defaults'])
      break
    case 'composition':
      arrays([
        'props',
        'data',
        'resources',
        'scopes',
        'runtimes',
        'hooks',
        'outputs',
      ])
      arrays(
        ['inputs', 'updates', 'publications', 'mounts'],
        bundleObject(value.graph, 'composition graph'),
      )
      break
    case 'style':
      objects(['stylesheet'])
      arrays(['themes', 'dependencies'])
      break
  }
}
