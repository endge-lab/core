/** A user mutation was attempted against an inspected snapshot. */
export class EndgeDebuggerReadOnlyError extends Error {
  public readonly code = 'debugger_read_only'

  public constructor() {
    super('В режиме debugger доступен только просмотр документов')
    this.name = 'EndgeDebuggerReadOnlyError'
  }
}
