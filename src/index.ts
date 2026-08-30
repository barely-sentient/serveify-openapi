export { CreateServerConfig, SSLConfig } from './types/create-server-config.js'
export { ServerPlugin } from './types/plugin-sdk.js'
export { HttpMethod, Handler } from './routes.js'
export { createHttpServer } from './http.js'
import { Routes as InternalRoutes } from './routes.js'
/**
 * Public routing facade — only `setRequestHandler` is exposed to consumers.
 * Internal helpers (`markAsDefault`, `getRequestHandler`, `getRoutes`, `getDefaultHandlers`, `clear`)
 * remain available via direct `src/routes.js` imports for testing but are not re-exported here.
 */
export const setRequestHandler = InternalRoutes.setRequestHandler.bind(InternalRoutes)
export const Routes = {
  setRequestHandler,
} as const