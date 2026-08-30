import { Request } from "express"

/**
 * Valid HTTP methods supported by the application router.
 *
 * @public
 */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS"

/**
 * Route handler callback function signature.
 *
 * Accepts the standard Express request object and a request-scoped session context,
 * returning a Promise that resolves to the route payload response.
 *
 * @template TContext - The request-scoped context type. Defaults to `unknown`.
 * @template TResult - The response body type returned by the handler. Defaults to `unknown`.
 *
 * @param req - The raw Express Request object for the incoming request.
 * @param sessionCtx - The request-scoped session context constructed for the request.
 * @returns A promise resolving to the data payload to send back to the client.
 *
 * @public
 */
export type Handler = (req: Request, sessionCtx: unknown) => Promise<unknown>

/**
 * Internal storage mapping HTTP methods to their respective path-to-handler maps.
 *
 * Structure: `Map<HttpMethod, Map<OpenApiPath, Handler>>`
 *
 * @internal
 */
const routeMap = new Map<HttpMethod, Map<string, Handler>>()

/**
 * Internal registry tracking paths expected by the OpenAPI spec that lack user-defined implementations.
 *
 * Stored as serialized strings in the format `"{METHOD} {PATH}"`.
 *
 * @internal
 */
const defaultHandlers = new Set<string>()

/**
 * Generates a unique composite cache key combining an HTTP method and route path.
 *
 * @param method - The HTTP method verb.
 * @param path - The target route path.
 * @returns The formatted route key string (e.g., `"GET /users/{id}"`).
 *
 * @internal
 */
function routeKey(method: HttpMethod, path: string): string {
  return `${method} ${path}`
}

/**
 * Retrieves or initializes the inner route map for a given HTTP method.
 *
 * @param method - The HTTP method to look up or initialize.
 * @returns The path-to-handler map bound to the specified HTTP method.
 *
 * @internal
 */
function getMethodMap(method: HttpMethod): Map<string, Handler> {
  let methodMap = routeMap.get(method)
  if (!methodMap) {
    methodMap = new Map()
    routeMap.set(method, methodMap)
  }
  return methodMap
}

/**
 * Central routing registry managing handler registration, spec compliance auditing,
 * and endpoint resolution for the HTTP server framework.
 *
 * @public
 */
export const Routes = {
  /**
   * Registers a custom request handler for a given HTTP method and route path.
   *
   * Overwrites any existing handler or default placeholder bound to the target route
   * and marks the route as implemented in the spec audit log.
   *
   * @param method - The target HTTP verb.
   * @param path - The OpenAPI-compatible route path (e.g., `"/users/{userId}"`).
   * @param handler - The custom domain logic handler function.
   *
   * @example
   * ```typescript
   * Routes.setRequestHandler("GET", "/health", async (req, ctx) => {
   *   return { status: "ok" }
   * })
   * ```
   */
  setRequestHandler(method: HttpMethod, path: string, handler: Handler): void {
    const methodMap = getMethodMap(method)
    methodMap.set(path, handler)
    defaultHandlers.delete(routeKey(method, path))
  },

  /**
   * Retrieves the currently registered handler for an HTTP method and path combination.
   *
   * @param method - The target HTTP verb.
   * @param path - The registered route path.
   * @returns The registered {@link Handler} callback, or `undefined` if no handler exists for the route.
   */
  getRequestHandler(method: HttpMethod, path: string): Handler | undefined {
    return routeMap.get(method)?.get(path)
  },

  /**
   * Returns the underlying nested route map containing all registered HTTP methods, paths, and handlers.
   *
   * @returns The complete map of HTTP methods to path-handler entries.
   */
  getRoutes(): Map<HttpMethod, Map<string, Handler>> {
    return routeMap
  },

  /**
   * Audits the registry and returns a list of spec-declared routes that still lack a custom handler.
   *
   * Routes marked via {@link Routes.markAsDefault} remain in this list until a custom handler
   * is attached via {@link Routes.setRequestHandler}.
   *
   * @returns An array of objects describing unimplemented routes, each containing `method` and `path`.
   *
   * @example
   * ```typescript
   * const missing = Routes.getDefaultHandlers()
   * missing.forEach(({ method, path }) => {
   *   console.warn(`Missing handler for ${method} ${path}`)
   * })
   * ```
   */
  getDefaultHandlers(): { method: HttpMethod; path: string }[] {
    const missing: { method: HttpMethod; path: string }[] = []
    for (const key of defaultHandlers) {
      const space = key.indexOf(" ")
      const method = key.substring(0, space) as HttpMethod
      const path = key.substring(space + 1)
      missing.push({ method, path })
    }
    return missing
  },

  /**
   * Registers an OpenAPI specification endpoint into the default tracker with a `503 Not Implemented` fallback handler.
   *
   * Called during server initialization to populate the expected API surface before user routes are attached.
   *
   * @param method - The HTTP method declared in the specification.
   * @param path - The path declared in the specification.
   */
  markAsDefault(method: HttpMethod, path: string): void {
    defaultHandlers.add(routeKey(method, path))
    const methodMap = getMethodMap(method)
    methodMap.set(path, async () => {
      throw { status: 503, message: "Not implemented" }
    })
  },

  /**
   * Resets the entire routing registry, removing all registered route handlers and pending default routes.
   *
   * Useful for tearing down state between automated test suites.
   *
   * @example
   * ```typescript
   * beforeEach(() => {
   *   Routes.clear()
   * })
   * ```
   */
  clear(): void {
    routeMap.clear()
    defaultHandlers.clear()
  },
}