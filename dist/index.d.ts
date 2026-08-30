import { JectOptions } from 'json-ject';
import { Request } from 'express';

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
    /**
     * Executes before any of the routing happens, perfect opportunity to
     * find any handlers and add them.
     */
    beforeRouting?: () => Promise<void>;
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
    jectOptions?: JectOptions;
    /**
     * Construct a session
     */
    buildSession: (req: Request) => Promise<TContext>;
};

type Endpoint<TContext = unknown> = {
    handler: (req: Request, session: TContext) => Promise<unknown>;
};

declare const registerEndpointHandler: <TContext = unknown>(method: HttpMethod, path: string, handler: Endpoint<TContext>) => void;
declare const createHttpServer: (conf: CreateServerConfig) => Promise<void>;
type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE' | 'HEAD' | 'OPTIONS';

declare const useCustomHandlers: ServerPlugin;

declare const useEventify: ServerPlugin;

/**
 * Load files ahead of routing being available.
 * @param path - the path FROM the root of the project
 * @returns
 */
declare const useGlobLoader: (path: string) => ServerPlugin;

export { type CreateServerConfig, type SSLConfig, type ServerPlugin, createHttpServer, registerEndpointHandler, useCustomHandlers, useEventify, useGlobLoader };
