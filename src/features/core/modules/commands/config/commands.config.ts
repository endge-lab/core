import type { EndgeCommandExecutor, EndgeCommandHandler } from '@/features/core/modules/commands/types/command-executor.type'
import type { EndgeContextCommandTarget } from '@/features/core/modules/commands/types/context-command-target.type'
import type { EndgeRuntimeCommandTarget } from '@/features/core/modules/commands/types/runtime-command-target.type'
import { SetDataModeCommand } from '@/features/core/modules/commands/services/context/SetDataModeCommand'
import { SetEnvironmentCommand } from '@/features/core/modules/commands/services/context/SetEnvironmentCommand'
import { SetLocaleCommand } from '@/features/core/modules/commands/services/context/SetLocaleCommand'
import { SetProjectCommand } from '@/features/core/modules/commands/services/context/SetProjectCommand'
import { SetTenantCommand } from '@/features/core/modules/commands/services/context/SetTenantCommand'
import { SetThemeCommand } from '@/features/core/modules/commands/services/context/SetThemeCommand'
import { SetTimezoneCommand } from '@/features/core/modules/commands/services/context/SetTimezoneCommand'
import { SetUserCommand } from '@/features/core/modules/commands/services/context/SetUserCommand'
import { SetWorkspaceCommand } from '@/features/core/modules/commands/services/context/SetWorkspaceCommand'
import { LocalCommandExecutor } from '@/features/core/modules/commands/services/LocalCommandExecutor'
import { PauseRuntimeCommand } from '@/features/core/modules/commands/services/runtime/PauseRuntimeCommand'
import { ResumeRuntimeCommand } from '@/features/core/modules/commands/services/runtime/ResumeRuntimeCommand'
import { StopRuntimeCommand } from '@/features/core/modules/commands/services/runtime/StopRuntimeCommand'

/** Создаёт явный набор локальных обработчиков; регистрация не выполняет сами команды. */
export function createContextCommandHandlers(context: EndgeContextCommandTarget): readonly EndgeCommandHandler[] {
  return [
    new SetWorkspaceCommand(context),
    new SetTenantCommand(context),
    new SetProjectCommand(context),
    new SetEnvironmentCommand(context),
    new SetUserCommand(context),
    new SetLocaleCommand(context),
    new SetThemeCommand(context),
    new SetTimezoneCommand(context),
    new SetDataModeCommand(context),
  ]
}

/** Привязывает команды к штатным операциям конкретного приложения без изменения обработчиков. */
export function createContextCommandExecutor(context: EndgeContextCommandTarget): EndgeCommandExecutor {
  return new LocalCommandExecutor(createContextCommandHandlers(context))
}

/** Runtime использует одинаковые обработчики для локальных и принятых удалённых команд. */
export function createRuntimeCommandHandlers(runtime: EndgeRuntimeCommandTarget): readonly EndgeCommandHandler[] {
  return [new PauseRuntimeCommand(runtime), new ResumeRuntimeCommand(runtime), new StopRuntimeCommand(runtime)]
}
