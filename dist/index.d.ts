import { JectOptions } from 'json-ject';
import { Request } from 'express';
import { PathLike } from 'fs';

type Endpoint<TContext = unknown> = {
    handler: (req: Request, session: TContext) => Promise<unknown>;
};
type EnhancedRequest = Request & {
    route: string;
    reroute: (webAppKey: string) => Promise<void>;
};

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
    preRequest?: (req: EnhancedRequest, ctx: TContext) => Promise<void>;
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
    postRequest?: (req: EnhancedRequest, ctx: TContext, result: unknown) => Promise<unknown>;
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
    beforeRouting?: (schema: unknown) => Promise<void>;
    /**
     * What to do when a request is made to a route that doesn't exist. This is called after all other plugins have been called and the request has been processed.
     * @param req - The incoming Express Request object.
     * @param ctx - The shared application context for the current scope.
     * @param result - The payload returned by the main request handler.
     * @returns A promise resolving to either the original or transformed response payload.
     */
    on404NotFound?: (req: EnhancedRequest, ctx: TContext) => Promise<void>;
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
    buildContext: (req: Request) => Promise<TContext>;
};

declare const registerEndpointHandler: <TContext = unknown>(method: HttpMethod, path: string, handler: Endpoint<TContext>) => void;
declare let getRequestSchemaForEndpoint: (method: HttpMethod, url: string) => any;
declare let getResponseSchemaForEndpoint: (method: HttpMethod, url: string) => any;
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

declare const usePermissify: ServerPlugin;

type StaticOptions = {
    /** URL route to register. Defaults to the file path for useStatic. */
    route?: string;
    contentType?: string;
    "content-type"?: string;
};
/** Registers a GET route that serves one file without JSON serialization. */
declare const useStatic: (filePath: string, options?: StaticOptions) => ServerPlugin;
/** Registers a GET wildcard route that serves files, including nested files, from a directory. */
declare const useStaticDirectory: (directoryPath: string, options?: StaticOptions) => ServerPlugin;

declare const useWebApp: (route: string, staticDir: PathLike) => ServerPlugin;

export { type CreateServerConfig, type EnhancedRequest, type HttpMethod, type SSLConfig, type ServerPlugin, type StaticOptions, createHttpServer, getRequestSchemaForEndpoint, getResponseSchemaForEndpoint, registerEndpointHandler, useCustomHandlers, useEventify, useGlobLoader, usePermissify, useStatic, useStaticDirectory, useWebApp };
