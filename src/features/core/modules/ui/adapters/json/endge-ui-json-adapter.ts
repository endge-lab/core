import type { ComponentSFCRenderPort } from '@/features/core/modules/runtime/domain/component-sfc-render-port.types'
import type { RuntimeHostInputSource } from '@/features/core/modules/runtime/domain/runtime-host.types'
import type {
  EndgeUIDispatchResult,
  EndgeUIJsonMount,
  EndgeUIJsonMountOptions,
  EndgeUIJsonSnapshot,
  EndgeUIPatch,
} from '@/features/core/modules/ui/domain/types/endge-ui-json.types'
import type { UIRenderAdapter } from '@/features/core/modules/ui/domain/types/ui-render-adapter.type'

import { Raph } from '@raphy-js/raph'
import { Endge } from '@/features/core/kernel/endge'
import { diffEndgeUIJsonSnapshots } from '@/features/core/modules/ui/adapters/json/endge-ui-json-patch'
import { ENDGE_UI_JSON_CONSUMER_SCOPE, EndgeUIJsonRenderer } from '@/features/core/modules/ui/adapters/json/EndgeUIJsonRenderer'
import {
  ENDGE_UI_JSON_ADAPTER_ID,
  ENDGE_UI_JSON_FORMAT,
  ENDGE_UI_JSON_RENDERER,
} from '@/features/core/modules/ui/domain/types/endge-ui-json.types'
import {
  ENDGE_SFC_RENDER_ADAPTER_PROTOCOL,
  ENDGE_SFC_RENDER_ADAPTER_PROTOCOL_VERSION,
  ENDGE_SFC_RENDER_ADAPTER_REQUIRED_KEYS,
} from '@/features/core/modules/ui/domain/types/ui-render-adapter.type'

const HOST_DIRTY_EVENTS = ['props:dirty', 'boundary:dirty', 'computation:dirty', 'resource:dirty'] as const
const DEFAULT_TABLE_ROW_LIMIT = 100

/**
 * Монтирует JSON UI `endge-ui/v1` поверх Component SFC runtime host-а.
 * Host владеет state, input и ресурсами; mount только проецирует IR в JSON.
 */
export function mountEndgeUIJson(host: ComponentSFCRenderPort, options: EndgeUIJsonMountOptions = {}): EndgeUIJsonMount {
  const listeners = new Set<(patch: EndgeUIPatch) => void>()
  const tableWindows = new Map<string, { offset: number, limit: number }>()
  const tableRowLimit = Math.max(1, Math.floor(options.tableRowLimit ?? DEFAULT_TABLE_ROW_LIMIT))
  let input: RuntimeHostInputSource | null = options.input ?? (host as { getInputSource?: () => RuntimeHostInputSource | null }).getInputSource?.() ?? null
  let handlers = new Map<string, Map<string, (payload: unknown) => Promise<void> | void>>()
  let current: EndgeUIJsonSnapshot
  let mounted = true
  let scheduled = false

  if (options.input) {
    host.setInputSource(options.input)
  }

  const render = (revision: number): EndgeUIJsonSnapshot => {
    const context = Endge.context.runtimeSnapshot() as { locale?: string | null, timezone?: string | null }
    const renderer = new EndgeUIJsonRenderer(host, {
      locale: options.locale ?? context.locale ?? undefined,
      timezone: options.timezone ?? context.timezone ?? undefined,
      theme: options.theme,
      tableWindows,
      tableRowLimit,
    })
    const result = renderer.render(resolveProps(input))
    handlers = result.handlers
    host.releaseComputationResources(ENDGE_UI_JSON_CONSUMER_SCOPE, key => result.consumerKeys.has(key))
    return { ...result.snapshot, revision }
  }

  const refresh = (): EndgeUIPatch | null => {
    scheduled = false
    if (!mounted) {
      return null
    }
    const next = render(current.revision + 1)
    const patch = diffEndgeUIJsonSnapshots(current, next)
    if (!patch.ops.length) {
      return null
    }
    current = next
    for (const listener of [...listeners]) {
      listener(patch)
    }
    return patch
  }

  const schedule = (): void => {
    if (!mounted) {
      return
    }
    if (options.schedule === 'sync') {
      refresh()
      return
    }
    if (!scheduled) {
      scheduled = true
      queueMicrotask(refresh)
    }
  }

  const onDirty = (): void => schedule()
  const onInputChanged = (): void => {
    input = (host as { getInputSource?: () => RuntimeHostInputSource | null }).getInputSource?.() ?? input
    schedule()
  }

  current = render(1)
  for (const event of HOST_DIRTY_EVENTS) {
    host.on(event, onDirty)
  }
  host.on('render-input:changed', onInputChanged)

  return {
    snapshot: () => structuredClone(current),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    refresh,
    dispatch: async (nodeId: string, event: string, payload?: unknown): Promise<EndgeUIDispatchResult> => {
      if (!mounted) {
        return { handled: false, reason: 'unmounted' }
      }
      const nodeHandlers = handlers.get(nodeId)
      if (!nodeHandlers) {
        return { handled: false, reason: 'unknown-node' }
      }
      const handler = nodeHandlers.get(event)
      if (!handler) {
        return { handled: false, reason: 'unknown-event' }
      }
      if (event === 'table.page') {
        const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
        const previous = tableWindows.get(nodeId) ?? { offset: 0, limit: tableRowLimit }
        const offset = Number(record.offset ?? previous.offset)
        const limit = Number(record.limit ?? previous.limit)
        tableWindows.set(nodeId, {
          offset: Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : previous.offset,
          limit: Number.isFinite(limit) && limit >= 1 ? Math.floor(limit) : previous.limit,
        })
      }
      await handler(payload)
      refresh()
      return { handled: true }
    },
    unmount: () => {
      if (!mounted) {
        return
      }
      mounted = false
      for (const event of HOST_DIRTY_EVENTS) {
        host.off(event, onDirty)
      }
      host.off('render-input:changed', onInputChanged)
      listeners.clear()
      handlers.clear()
      host.releaseComputationResources(ENDGE_UI_JSON_CONSUMER_SCOPE)
    },
  }
}

// Плоский props snapshot из input source host-а (как у DOM bridge).
function resolveProps(input: RuntimeHostInputSource | null): Record<string, unknown> {
  if (!input) {
    return {}
  }
  if (input.kind === 'local') {
    return { ...input.props }
  }
  const props: Record<string, unknown> = { ...(input.props ?? {}) }
  for (const [prop, binding] of Object.entries(input.bindings)) {
    props[prop] = Raph.get(binding.path)
  }
  return props
}

// Реализация одного primitive в JSON adapter-е: имя типа узла `endge-ui/v1`.
export interface EndgeUIJsonPrimitiveRenderer {
  type: string
}

/**
 * Renderer adapter протокола `endge-sfc` для JSON UI. Host регистрирует его в
 * `Endge.uiRegistry.adapters` и получает точку входа `roots['sfc-runtime']`.
 */
export const EndgeUIJsonAdapter: UIRenderAdapter<EndgeUIJsonPrimitiveRenderer> = Object.freeze({
  id: ENDGE_UI_JSON_ADAPTER_ID,
  protocol: ENDGE_SFC_RENDER_ADAPTER_PROTOCOL,
  protocolVersion: ENDGE_SFC_RENDER_ADAPTER_PROTOCOL_VERSION,
  renderer: ENDGE_UI_JSON_RENDERER,
  renderers: Object.freeze(Object.fromEntries(
    [...ENDGE_SFC_RENDER_ADAPTER_REQUIRED_KEYS, 'Tooltip', 'Table'].map(key => [key, Object.freeze({ type: key })]),
  )),
  roots: Object.freeze({ 'sfc-runtime': mountEndgeUIJson, 'format': ENDGE_UI_JSON_FORMAT }),
})
