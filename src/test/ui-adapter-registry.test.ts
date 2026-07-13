import {
  ENDGE_SFC_RENDER_ADAPTER_PROTOCOL,
  ENDGE_SFC_RENDER_ADAPTER_PROTOCOL_VERSION,
} from '@/domain/types/ui-render-adapter.type'
import { UIAdapterRegistry } from '@/model/endge/ui-registry/UIAdapterRegistry'
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
    }])
    expect(onChange).toHaveBeenCalledTimes(2)
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
