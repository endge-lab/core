import { describe, expect, it, vi } from 'vitest'
import {
  ENDGE_SFC_RENDER_ADAPTER_PROTOCOL,
  ENDGE_SFC_RENDER_ADAPTER_PROTOCOL_VERSION,
} from '@/features/core/modules/ui/domain/types/ui-render-adapter.type'
import { UIAdapterRegistry } from '@/features/core/modules/ui/registry/UIAdapterRegistry'

describe('реестр UI-адаптеров', () => {
  it('регистрирует, проверяет и активирует адаптер', () => {
    const onChange = vi.fn()
    const registry = new UIAdapterRegistry(onChange)
    const renderer = () => null

    registry.register({
      id: 'vue-native',
      protocol: ENDGE_SFC_RENDER_ADAPTER_PROTOCOL,
      protocolVersion: ENDGE_SFC_RENDER_ADAPTER_PROTOCOL_VERSION,
      renderer: 'vue',
      renderers: { Input: renderer },
    })

    const active = registry.activate({
      id: 'vue-native',
      protocol: ENDGE_SFC_RENDER_ADAPTER_PROTOCOL,
      protocolVersion: ENDGE_SFC_RENDER_ADAPTER_PROTOCOL_VERSION,
      renderer: 'vue',
      requiredRendererKeys: ['Input'],
    })

    expect(active.renderers.Input).toBe(renderer)
    expect(registry.active?.id).toBe('vue-native')
    expect(registry.list()).toEqual([{
      id: 'vue-native',
      protocol: ENDGE_SFC_RENDER_ADAPTER_PROTOCOL,
      protocolVersion: ENDGE_SFC_RENDER_ADAPTER_PROTOCOL_VERSION,
      renderer: 'vue',
      rendererKeys: ['Input'],
      rootKeys: [],
    }])
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('сохраняет непрозрачные roots и проверяет обязательные корневые entrypoints', () => {
    const registry = new UIAdapterRegistry()
    const shell = { name: 'AdapterShell' }

    registry.register({
      id: 'self-contained',
      protocol: ENDGE_SFC_RENDER_ADAPTER_PROTOCOL,
      protocolVersion: ENDGE_SFC_RENDER_ADAPTER_PROTOCOL_VERSION,
      renderer: 'custom-host',
      renderers: { Input: () => null },
      roots: { shell },
    })

    expect(registry.require({
      id: 'self-contained',
      requiredRootKeys: ['shell'],
    }).roots?.shell).toBe(shell)
    expect(registry.list()[0]?.rootKeys).toEqual(['shell'])
    expect(() => registry.require({
      id: 'self-contained',
      requiredRootKeys: ['shell', 'runtime'],
    })).toThrow('missing roots: runtime')
  })

  it('отклоняет повторяющиеся ID и неполные адаптеры', () => {
    const registry = new UIAdapterRegistry()
    registry.register({
      id: 'vue-native',
      protocol: ENDGE_SFC_RENDER_ADAPTER_PROTOCOL,
      protocolVersion: ENDGE_SFC_RENDER_ADAPTER_PROTOCOL_VERSION,
      renderer: 'vue',
      renderers: { Input: () => null },
    })

    expect(() => registry.register({
      id: 'vue-native',
      protocol: ENDGE_SFC_RENDER_ADAPTER_PROTOCOL,
      protocolVersion: ENDGE_SFC_RENDER_ADAPTER_PROTOCOL_VERSION,
      renderer: 'vue',
      renderers: { Input: () => null },
    })).toThrow('already registered')

    expect(() => registry.require({
      id: 'vue-native',
      requiredRendererKeys: ['Input', 'Select'],
    })).toThrow('missing renderers: Select')
  })

  it('сообщает выбранный ID и фактически зарегистрированные адаптеры', () => {
    const registry = new UIAdapterRegistry()
    registry.register({
      id: 'vue-native',
      protocol: ENDGE_SFC_RENDER_ADAPTER_PROTOCOL,
      protocolVersion: ENDGE_SFC_RENDER_ADAPTER_PROTOCOL_VERSION,
      renderer: 'vue',
      renderers: { Input: () => null },
    })

    expect(() => registry.activate('customer-aodb')).toThrow(
      'adapter "customer-aodb" is not registered. Registered adapters: vue-native',
    )
  })
})
