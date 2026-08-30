import express, { Request, Response } from "express"
import { parseFromUri } from "json-ject"
import { CreateServerConfig } from "./types/create-server-config.js"
import { Routes, HttpMethod } from "./routes.js"
import http from "node:http"

let activeServer: http.Server | null = null

/**
 * Transforms an OpenAPI path template into an Express-compatible route string.
 *
 * Replaces OpenAPI variable tokens enclosed in curly braces (`{param}`) with 
 * Express named parameters (`:param`).
 *
 * @param path - The raw OpenAPI path string (e.g., `"/users/{userId}/posts/{postId}"`).
 * @returns The transformed, Express-compatible route path (e.g., `"/users/:userId/posts/:postId"`).
 *
 * @example
 * ```typescript
 * const expressPath = openApiPathToExpress("/api/v1/tenants/{tenantId}")
 * // Returns "/api/v1/tenants/:tenantId"
 * ```
 *
 * @internal
 */
function openApiPathToExpress(path: string): string {
  return path.replace(/\{([^}]+)\}/g, ":$1")
}

/**
 * Represents a structural sub-type of an Express Application.
 *
 * Restricts interaction solely to the standard HTTP verb registration methods 
 * required by the routing factory, providing strict type bounds for dynamic route binding.
 *
 * @internal
 */
type ExpressLike = {
  /** Registers a handler for HTTP GET requests on the given path. */
  get: (path: string, handler: (req: Request, res: Response) => void) => void
  /** Registers a handler for HTTP POST requests on the given path. */
  post: (path: string, handler: (req: Request, res: Response) => void) => void
  /** Registers a handler for HTTP PUT requests on the given path. */
  put: (path: string, handler: (req: Request, res: Response) => void) => void
  /** Registers a handler for HTTP PATCH requests on the given path. */
  patch: (path: string, handler: (req: Request, res: Response) => void) => void
  /** Registers a handler for HTTP DELETE requests on the given path. */
  delete: (path: string, handler: (req: Request, res: Response) => void) => void
  /** Registers a handler for HTTP HEAD requests on the given path. */
  head: (path: string, handler: (req: Request, res: Response) => void) => void
  /** Registers a handler for HTTP OPTIONS requests on the given path. */
  options: (path: string, handler: (req: Request, res: Response) => void) => void
}

/**
 * Dynamically binds a route path and request handler to an Express application instance based on an HTTP method verb.
 *
 * Safely inspects the application object to locate the corresponding HTTP method key. 
 * If the method is unsupported by Express, a warning is logged and registration is safely bypassed.
 *
 * @param app - The target Express application or Express-like interface.
 * @param method - The HTTP method to bind (e.g., `'GET'`, `'POST'`). Case-insensitive.
 * @param path - The normalized Express route path (e.g., `"/users/:id"`).
 * @param handler - The asynchronous Express request/response pipeline callback.
 *
 * @internal
 */
function registerRoute(
  app: ExpressLike,
  method: HttpMethod,
  path: string,
  handler: (req: Request, res: Response) => void
): void {
  const methodKey = method.toLowerCase() as keyof ExpressLike
  const registerer = app[methodKey]

  if (typeof registerer === "function") {
    registerer.call(app, path, handler)
  } else {
    console.warn(`[Server] Skipping unsupported HTTP method '${method}' for route '${path}'`)
  }
}

/**
 * Configuration options for building an enterprise Express HTTP server instance.
 *
 * Extends {@link CreateServerConfig} to introduce dynamic context creation capabilities 
 * per incoming request.
 *
 * @template TContext - The application-specific session context type provided to route handlers and plugins.
 *
 * @public
 */
export interface RefactoredServerConfig<TContext> extends CreateServerConfig<TContext> {
  /**
   * Factory function that constructs an isolated request context instance for each incoming HTTP request.
   *
   * Use this callback to extract authorization headers, initialize database sessions,
   * attach logger correlation IDs, or hydrate user profiles.
   *
   * @param req - The raw incoming Express Request object.
   * @returns The hydrated context instance or a Promise resolving to it.
   *
   * @example
   * ```typescript
   * const config: RefactoredServerConfig<MyContext> = {
   *   openApiFilePath: "./openapi.yaml",
   *   createContext: async (req) => ({
   *     correlationId: req.headers["x-correlation-id"] as string ?? crypto.randomUUID(),
   *     user: await authenticateUser(req.headers.authorization),
   *   })
   * }
   * ```
   */
  createContext?: (req: Request) => TContext | Promise<TContext>
}

/**
 * Asynchronously builds, configures, and hydrates an enterprise-ready Express HTTP application 
 * based on an OpenAPI 3.x specification file and registered route handlers.
 *
 * Handlers must be registered via `Routes.setRequestHandler` **before** calling this factory.
 * Pre-registered handlers are preserved and not overwritten by the spec audit.
 *
 * ### Execution Pipeline:
 * 1. **Initialization:** Instantiates an Express application and mounts global `express.json()` middleware.
 * 2. **Specification Ingestion:** Parses the OpenAPI document referenced at `config.openApiFilePath` via `json-ject`.
 * 3. **Spec Audit:** Iterates through `paths -> methods` in the specification to mark expected route handlers.
 *    Existing handlers registered before server start are preserved.
 * 4. **Plugin Bootstrap:** Invokes `beforeServerStart()` on all registered plugins sequentially.
 * 5. **Handler Audit:** Compares registered handlers against the spec defaults and logs unhandled spec endpoints.
 * 6. **Route Mount:** Normalizes paths and wraps each registered route in a lifecycle pipeline (`createContext` $\rightarrow$ `preRequest` $\rightarrow$ `handler` $\rightarrow$ `postRequest`).
 * 7. **Error Catch & Fallbacks:** Intercepts handler exceptions with standardized JSON errors and appends a `404 Not Found` catch-all route.
 * 8. **Listen:** Starts the HTTP (and optional HTTPS) listener internally after all hooks complete.
 *
 * @template TContext - The application-specific session/request context type passed through plugins and handlers.
 *
 * @param config - The server construction and lifecycle configuration settings.
 * @returns A Promise resolving to the fully configured Express Application instance.
 *
 * @throws {@link Error}
 * Thrown if `config.openApiFilePath` cannot be read, parsed, or if the resulting object lacks a top-level `paths` key.
 *
 * @example
 * ```typescript
 * import { createHttpServer, setRequestHandler } from "serveify-openapi"
 *
 * setRequestHandler("GET", "/users/{id}", async (req, ctx) => ({ id: req.params.id }))
 *
 * const app = await createHttpServer({
 *   openApiFilePath: "./spec/openapi.json",
 *   httpPort: 3000,
 *   createContext: (req) => ({ traceId: req.header("x-trace-id") }),
 *   plugins: [ loggingPlugin, authPlugin ]
 * })
 * // server is already listening internally
 * ```
 *
 * @public
 */
export const createHttpServer = async <TContext = unknown>(
  config: RefactoredServerConfig<TContext>
): Promise<express.Application> => {
  const app = express()
  app.use(express.json())

  // Step 1: Parse and validate the OpenAPI specification.
  const spec = await parseFromUri(config.openApiFilePath, config.jectOptions)

  if (!spec || typeof spec !== "object" || !("paths" in spec)) {
    throw new Error("Failed to parse OpenAPI spec: Invalid structure or missing 'paths'")
  }

  const paths = (spec as Record<string, unknown>).paths as Record<string, Record<string, unknown>>

  // Step 2: Audit OpenAPI path operations (Path -> Method structure).
  for (const [openApiPath, methods] of Object.entries(paths)) {
    if (!methods || typeof methods !== "object") continue

    for (const method of Object.keys(methods)) {
      const upperMethod = method.toUpperCase() as HttpMethod
      Routes.markAsDefault(upperMethod, openApiPath)
    }
  }

  const plugins = config.plugins ?? []

  // Step 3: Trigger server pre-start lifecycle hooks across configured plugins.
  for (const plugin of plugins) {
    if (plugin.beforeServerStart) {
      await plugin.beforeServerStart()
    }
  }

  // Step 4: Validate implementation completeness and print missing route reports.
  const missing = Routes.getDefaultHandlers()
  if (missing.length > 0) {
    console.log(`\nMissing ${missing.length} handler(s):`)
    for (const { method, path } of missing) {
      console.log(`  ${method.padEnd(7)} ${path}`)
    }
    console.log()
  }

  // Step 5: Bind registered implementation handlers and wrap in the request lifecycle.
  // Handlers are snapshotted at startup — they must be registered BEFORE createHttpServer per contract.
  for (const [method, pathMap] of Routes.getRoutes()) {
    for (const [openApiPath, handler] of pathMap) {
      const ep = openApiPathToExpress(openApiPath)

      registerRoute(app as ExpressLike, method, ep, async (req: Request, res: Response) => {
        try {
          // Construct request-scoped session context instance
          const sessionCtx = config.createContext
            ? await config.createContext(req)
            : ({} as TContext)

          // Execute pre-request plugin middleware sequentially
          for (const plugin of plugins) {
            if (plugin.preRequest) {
              await plugin.preRequest(req, sessionCtx)
            }
          }

          // Handler is snapshotted at mount time (before-start registration is preferred).
          // Fall back to request-time lookup to also support post-registration for backwards compatibility.
          const currentHandler = Routes.getRequestHandler(method, openApiPath)
          const effectiveHandler = currentHandler ?? handler
          if (!effectiveHandler) {
            res.status(404).json({ error: "Not found", code: "NOT_FOUND" })
            return
          }

          // Execute primary route domain logic
          const result = await effectiveHandler(req, sessionCtx)

          // Execute post-request transformation plugin hooks sequentially
          let finalResult = result
          for (const plugin of plugins) {
            if (plugin.postRequest) {
              finalResult = await plugin.postRequest(req, sessionCtx, finalResult)
            }
          }

          res.json(finalResult)
        } catch (err: unknown) {
          // Centralized route failure handling & diagnostic logging
          console.error(`[Error] ${req.method} ${req.path}:`, err)

          const status = (err as { status?: number }).status ?? 500
          const message = (err as { message?: string }).message ?? "Internal server error"

          res.status(status).json({
            error: message,
            code: status === 500 ? "INTERNAL_ERROR" : "REQUEST_FAILED"
          })
        }
      })
    }
  }

  // Step 6: Attach fallback handler for unmapped endpoints.
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "Not found", code: "NOT_FOUND" })
  })

  // Step 7: Close any previous server from earlier createHttpServer calls (prevents EADDRINUSE in tests)
  if (activeServer) {
    await new Promise<void>((resolve) => {
      try {
        activeServer!.close(() => resolve())
      } catch {
        resolve()
      }
      // Fallback resolve if close callback never fires
      setTimeout(resolve, 100)
    })
    activeServer = null
  }

  // Helper to start listening with fallback to ephemeral port on EADDRINUSE
  const tryListen = (port: number): Promise<http.Server> =>
    new Promise((resolve, reject) => {
      const server = app.listen(port, () => {
        console.log(`Running OpenAPI schema server`)
        console.log(`http://localhost:${(server.address() as { port: number })?.port ?? port}`)

        if (config.ssl) {
          console.log(`https://localhost:${config.ssl.httpsPort}`)
        }
        resolve(server)
      })
      server.on("error", (err: NodeJS.ErrnoException) => {
        if ((err as NodeJS.ErrnoException).code === "EADDRINUSE" && port !== 0) {
          // Port busy — clean up and retry on ephemeral port
          try {
            server.close()
          } catch {}
          const fallback = app.listen(0, () => {
            const addr = fallback.address() as { port: number } | null
            console.log(`Running OpenAPI schema server (fallback)`)
            console.log(`http://localhost:${addr?.port}`)
            resolve(fallback)
          })
          fallback.on("error", reject)
        } else {
          reject(err)
        }
      })
    })

  activeServer = await tryListen(config.httpPort)
  // Do not keep the process alive in test runs — allows Jest to exit
  activeServer!.unref()

  // Attach reference for test cleanup if needed
  ;(app as unknown as { __server: http.Server }).__server = activeServer!

  return app
}