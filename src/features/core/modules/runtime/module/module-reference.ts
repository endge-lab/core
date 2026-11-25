export interface ModuleReference {
  identity: string
  version: string
}

export interface ModuleRendererReference extends ModuleReference {
  rendererId: string
}

export interface ModuleTimelinePresetReference extends ModuleReference {
  name: string
}

export function isTimelinePresetName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && new TextEncoder().encode(value).length <= 128
}

export const ADAPTER_RENDERER_SELECTION = 'adapter:default'

export function isModuleRendererId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 128
}

export function parseModuleRendererSelection(value: unknown): { attachment: string, rendererId: string } | undefined {
  if (typeof value !== 'string' || value === ADAPTER_RENDERER_SELECTION) {
    return undefined
  }
  const [attachment, rendererId, extra] = value.split(':')
  return attachment && isModuleRendererId(rendererId) && extra === undefined ? { attachment, rendererId } : undefined
}

const identityPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const versionPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-([0-9A-Z-]+(?:\.[0-9A-Z-]+)*))?(?:\+[0-9A-Z-]+(?:\.[0-9A-Z-]+)*)?$/i

export function isModuleReference(identity: string, version: string): boolean {
  if (identity.length > 128 || version.length > 128 || !identityPattern.test(identity)) {
    return false
  }
  const match = versionPattern.exec(version)
  return !!match && !match[1]?.split('.').some(part => /^0\d+$/.test(part))
}
