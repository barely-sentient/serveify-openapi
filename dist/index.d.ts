import { JectOptions } from 'json-ject';
import express, { Request } from 'express';

/**
 * Defines a plugin interface for extending server behavior across key lifecycle events.
 *
 * @template TContext - The shared context type accessible across request handlers and plugins. Defaults to `unknown`.
 */
type ServerPlugin<TContext = unknown> = {
    /**
     * Executes immediately before a request is processed.
     *
     * Throws an error to abort execution and prevent subsequent handlers from running.
     * Use this for authentication, authorization, rate limiting, or early request validation.
     *
     * @param req - The incoming Express Request object.
     * @param ctx - The shared application context for the current scope.
     * @returns A promise that resolves when pre-request processing completes successfully.
     *
     * @throws {Error} Aborts request processing when a hook throws an unhandled error or validation fails.
     */
    preRequest?: (req: Request, ctx: TContext) => Promise<void>;
    /**
     * Executes immediately after the primary request handler completes.
     *
     * Allows inspection or transformation of the response payload before it is returned.
     *
     * @param req - The incoming Express Request object.
     * @param ctx - The shared application context for the current scope.
     * @param result - The payload returned by the main request handler.
     * @returns A promise resolving to either the original or transformed response payload.
     */
    postRequest?: (req: Request, ctx: TContext, result: unknown) => Promise<unknown>;
    /**
     * Executes once during server bootstrap, right before network listeners open.
     *
     * Use this to establish database connections, warm up caches, or execute required startup tasks.
     *
     * @returns A promise that resolves when startup tasks complete.
     */
    beforeServerStart?: () => Promise<void>;
};

/**
 * Configuration options for setting up secure HTTPS communication via SSL/TLS.
 */
type SSLConfig = {
    /**
     * The network port on which the HTTPS server will listen for incoming encrypted traffic.
     */
    httpsPort: number;
    /**
     * Path to the TLS/SSL certificate file (e.g., `.crt` or `.pem`), or the raw certificate content string.
     */
    cert: string;
    /**
     * Path to the TLS/SSL private key file (e.g., `.key` or `.pem`), or the raw private key content string.
     */
    key: string;
};
/**
 * Configuration schema for instantiating a new server instance.
 *
 * @template TContext - The shared context type passed throughout the server's request execution lifecycle and plugin ecosystem. Defaults to `unknown`.
 */
type CreateServerConfig<TContext = unknown> = {
    /**
     * Absolute or relative file path to the OpenAPI specification file (e.g., JSON or YAML).
     * Used for API contract generation, validation, or documentation routing.
     */
    openApiFilePath: string;
    /**
     * Optional collection of server plugins used to extend core server functionality,
     * hook into lifecycle events, or modify request handling.
     */
    plugins?: ServerPlugin<TContext>[];
    /**
     * Optional SSL configuration parameters. When provided, enables secure HTTPS listener support.
     */
    ssl?: SSLConfig;
    /**
     * The network port on which the standard HTTP server will listen for incoming unencrypted traffic.
     */
    httpPort: number;
    /**
     * Passthrough to ject
     */
    jectOptions: JectOptions;
};

/**
 * Valid HTTP methods supported by the application router.
 *
 * @public
 */
type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
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
type Handler = (req: Request, sessionCtx: unknown) => Promise<unknown>;
/**
 * Central routing registry managing handler registration, spec compliance auditing,
 * and endpoint resolution for the HTTP server framework.
 *
 * @public
 */
declare const Routes: {
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
    setRequestHandler(method: HttpMethod, path: string, handler: Handler): void;
    /**
     * Retrieves the currently registered handler for an HTTP method and path combination.
     *
     * @param method - The target HTTP verb.
     * @param path - The registered route path.
     * @returns The registered {@link Handler} callback, or `undefined` if no handler exists for the route.
     */
    getRequestHandler(method: HttpMethod, path: string): Handler | undefined;
    /**
     * Returns the underlying nested route map containing all registered HTTP methods, paths, and handlers.
     *
     * @returns The complete map of HTTP methods to path-handler entries.
     */
    getRoutes(): Map<HttpMethod, Map<string, Handler>>;
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
    getDefaultHandlers(): {
        method: HttpMethod;
        path: string;
    }[];
    /**
     * Registers an OpenAPI specification endpoint into the default tracker with a `503 Not Implemented` fallback handler.
     *
     * Called during server initialization to populate the expected API surface before user routes are attached.
     *
     * @param method - The HTTP method declared in the specification.
     * @param path - The path declared in the specification.
     */
    markAsDefault(method: HttpMethod, path: string): void;
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
    clear(): void;
};

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
interface RefactoredServerConfig<TContext> extends CreateServerConfig<TContext> {
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
    createContext?: (req: Request) => TContext | Promise<TContext>;
}
/**
 * Asynchronously builds, configures, and hydrates an enterprise-ready Express HTTP application
 * based on an OpenAPI 3.x specification file and registered route handlers.
 *
 * ### Execution Pipeline:
 * 1. **Initialization:** Instantiates an Express application and mounts global `express.json()` middleware.
 * 2. **Specification Ingestion:** Parses the OpenAPI document referenced at `config.openApiFilePath` via `json-ject`.
 * 3. **Spec Audit:** Iterates through `paths -> methods` in the specification to mark expected route handlers.
 * 4. **Plugin Bootstrap:** Invokes `beforeServerStart()` on all registered plugins sequentially.
 * 5. **Handler Audit:** Compares registered handlers against the spec defaults and logs unhandled spec endpoints.
 * 6. **Route Mount:** Normalizes paths and wraps each registered route in a lifecycle pipeline (`createContext` $\rightarrow$ `preRequest` $\rightarrow$ `handler` $\rightarrow$ `postRequest`).
 * 7. **Error Catch & Fallbacks:** Intercepts handler exceptions with standardized JSON errors and appends a `404 Not Found` catch-all route.
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
 * import { createHttpServer } from "./server-factory.js"
 *
 * const app = await createHttpServer({
 *   openApiFilePath: "./spec/openapi.json",
 *   createContext: (req) => ({ traceId: req.header("x-trace-id") }),
 *   plugins: [ loggingPlugin, authPlugin ]
 * })
 *
 * app.listen(3000, () => console.log("Server listening on port 3000"))
 * ```
 *
 * @public
 */
declare const createHttpServer: <TContext = unknown>(config: RefactoredServerConfig<TContext>) => Promise<express.Application>;

export { type CreateServerConfig, type Handler, type HttpMethod, Routes, type SSLConfig, type ServerPlugin, createHttpServer };
