import type { EndgeCommand } from '@/features/core/modules/commands/domain/commands.types'
import { describe, expect, it, vi } from 'vitest'
import { Endge } from '@/features/core/kernel/endge'
import { createContextCommandExecutor } from '@/features/core/modules/commands/config/commands.config'
import { EndgeCommands_Module } from '@/features/core/modules/commands/EndgeCommands_Module'

describe('context command execution boundary', () => {
  it('selects remote execution without local fallback and revokes it on reset', async () => {
    const local = { execute: vi.fn() }
    const remote = { send: vi.fn().mockRejectedValue(new Error('client rejected')) }
    const module = new EndgeCommands_Module(local)
    const command: EndgeCommand = { type: 'context:set-locale', payload: { locale: 'en' } }
    await expect(module.execute(command)).rejects.toThrow('boot setup')
    module.setup({ mode: 'debugger', scope: {}, vars: {}, commands: { remote } })
    await expect(module.execute(command)).rejects.toThrow('client rejected')
    expect(remote.send).toHaveBeenCalledWith(command)
    expect(local.execute).not.toHaveBeenCalled()
    module.reset()
    await expect(module.execute(command)).rejects.toThrow('boot setup')
    module.setup({ mode: 'application', scope: {}, vars: {} })
    await module.execute(command)
    expect(local.execute).toHaveBeenCalledWith(command)
  })

  it('validates untrusted commands before mutation and awaits the host lifecycle', async () => {
    let finish!: () => void
    const setCurrentTenant = vi.fn(() => new Promise<void>((resolve) => {
      finish = resolve
    }))
    const setCurrentLocale = vi.fn()
    const clearDataModeOverride = vi.fn()
    const target = Object.create(Endge.context)
    Object.assign(target, { setCurrentTenant, setCurrentLocale, clearDataModeOverride })
    const executor = createContextCommandExecutor(target)
    await expect(executor.execute({ type: '__proto__', payload: {} } as unknown as EndgeCommand)).rejects.toThrow('Unknown command')
    await expect(executor.execute({ type: 'context:set-locale', payload: { locale: 42 } } as unknown as EndgeCommand)).rejects.toThrow()
    expect(setCurrentLocale).not.toHaveBeenCalled()
    await executor.execute({ type: 'context:set-locale', payload: { locale: null } })
    expect(setCurrentLocale).toHaveBeenCalledWith(null)
    await executor.execute({ type: 'context:set-data-mode', payload: { dataMode: null } })
    expect(clearDataModeOverride).toHaveBeenCalledOnce()
    const completed = vi.fn()
    const pending = executor.execute({ type: 'context:set-tenant', payload: { tenant: 'remote' } }).then(completed)
    await Promise.resolve()
    expect(completed).not.toHaveBeenCalled()
    finish()
    await pending
    expect(completed).toHaveBeenCalledOnce()
  })
})
