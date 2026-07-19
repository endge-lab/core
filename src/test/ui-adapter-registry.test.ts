import {
  ENDGE_SFC_RENDER_ADAPTER_PROTOCOL,
  ENDGE_SFC_RENDER_ADAPTER_PROTOCOL_VERSION,
} from '@/domain/types/ui/ui-render-adapter.type'
import { UIAdapterRegistry } from '@/model/endge/ui/registry/UIAdapterRegistry'
import { describe, expect, it, vi } from 'vitest'

describe('UIAdapterRegistry', () => {
  it('registers, validates and activates an adapter', () => {
    const onChange = vi.fn()
    const registry = new UIAdapterRegistry(onChange)
    const renderer = () => null

    registry.register({
      id: 'native-vue',
      protocol: ENDGE_SFC_RENDER_ADAPTER_PROTOCOL,
      protocolVersion: ENDGE_SFC_RENDER_ADAPTER_PROTOCOL_VERSION,
      renderer: 'vue',
      renderers: { Input: renderer },
    })

    const active = registry.activate({
      id: 'native-vue',
      protocol: ENDGE_SFC_RENDER_ADAPTER_PROTOCOL,
      protocolVersion: ENDGE_SFC_RENDER_ADAPTER_PROTOCOL_VERSION,
      renderer: 'vue',
      requiredRendererKeys: ['Input'],
    })

    expect(active.renderers.Input).toBe(renderer)
    expect(registry.active?.id).toBe('native-vue')
    expect(registry.list()).toEqual([{
      id: 'native-vue',
      protocol: ENDGE_SFC_RENDER_ADAPTER_PROTOCOL,
      protocolVersion: ENDGE_SFC_RENDER_ADAPTER_PROTOCOL_VERSION,
      renderer: 'vue',
      rendererKeys: ['Input'],
      rootKeys: [],
    }])
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('preserves opaque roots and validates required root entry points', () => {
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

  it('rejects duplicate ids and incomplete adapters', () => {
    const registry = new UIAdapterRegistry()
    registry.register({
      id: 'native-vue',
      protocol: ENDGE_SFC_RENDER_ADAPTER_PROTOCOL,
      protocolVersion: ENDGE_SFC_RENDER_ADAPTER_PROTOCOL_VERSION,
      renderer: 'vue',
      renderers: { Input: () => null },
    })

    expect(() => registry.register({
      id: 'native-vue',
      protocol: ENDGE_SFC_RENDER_ADAPTER_PROTOCOL,
      protocolVersion: ENDGE_SFC_RENDER_ADAPTER_PROTOCOL_VERSION,
      renderer: 'vue',
      renderers: { Input: () => null },
    })).toThrow('already registered')

    expect(() => registry.require({
      id: 'native-vue',
      requiredRendererKeys: ['Input', 'Select'],
    })).toThrow('missing renderers: Select')
  })

  it('reports the selected id and actually registered adapters', () => {
    const registry = new UIAdapterRegistry()
    registry.register({
      id: 'native-vue',
      protocol: ENDGE_SFC_RENDER_ADAPTER_PROTOCOL,
      protocolVersion: ENDGE_SFC_RENDER_ADAPTER_PROTOCOL_VERSION,
      renderer: 'vue',
      renderers: { Input: () => null },
    })

    expect(() => registry.activate('customer-aodb')).toThrow(
      'adapter "customer-aodb" is not registered. Registered adapters: native-vue',
    )
  })
})
