import { ServerPlugin } from "./plugin-sdk.js"

/**
 * Configuration options for setting up secure HTTPS communication via SSL/TLS.
 */
export type SSLConfig = {
    /**
     * The network port on which the HTTPS server will listen for incoming encrypted traffic.
     */
    httpsPort: number, 
    /**
     * Path to the TLS/SSL certificate file (e.g., `.crt` or `.pem`), or the raw certificate content string.
     */
    cert: string, 
    /**
     * Path to the TLS/SSL private key file (e.g., `.key` or `.pem`), or the raw private key content string.
     */
    key: string
}

/**
 * Configuration schema for instantiating a new server instance.
 * 
 * @template TContext - The shared context type passed throughout the server's request execution lifecycle and plugin ecosystem. Defaults to `unknown`.
 */
export type CreateServerConfig<TContext = unknown> = {
    /**
     * Absolute or relative file path to the OpenAPI specification file (e.g., JSON or YAML).
     * Used for API contract generation, validation, or documentation routing.
     */
    openApiFilePath: string,
    /**
     * Optional collection of server plugins used to extend core server functionality, 
     * hook into lifecycle events, or modify request handling.
     */
    plugins?: ServerPlugin<TContext>[],
    /**
     * Optional SSL configuration parameters. When provided, enables secure HTTPS listener support.
     */
    ssl?: SSLConfig,
    /**
     * The network port on which the standard HTTP server will listen for incoming unencrypted traffic.
     */
    httpPort: number
}