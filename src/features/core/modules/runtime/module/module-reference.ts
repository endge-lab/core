export interface ModuleReference {
  identity: string
  version: string
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
