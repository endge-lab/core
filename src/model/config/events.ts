/**
 * Статические события Endge Core
 */
export interface EndgeCoreEventMap {
  //
  // SSE
  //
  'sse:message': { message: unknown }

  //
  // UPDATES
  //
  'updates:message': { type: string; message: unknown }
  'updates:applied': { identity: string; count: number }
}
