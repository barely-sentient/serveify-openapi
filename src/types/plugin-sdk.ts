import { Request } from "express"
import { EnhancedRequest } from "../handler.js"

/**
 * Defines a plugin interface for extending server behavior across key lifecycle events.
 *
 * @template TContext - The shared context type accessible across request handlers and plugins. Defaults to `unknown`.
 */
export type ServerPlugin<TContext = unknown> = {

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
    preRequest?: (req: EnhancedRequest, ctx: TContext) => Promise<void>

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
    postRequest?: (req: EnhancedRequest, ctx: TContext, result: unknown) => Promise<unknown>

    /**
     * Executes once during server bootstrap, right before network listeners open.
     * 
     * Use this to establish database connections, warm up caches, or execute required startup tasks.
     *
     * @returns A promise that resolves when startup tasks complete.
     */
    beforeServerStart?: () => Promise<void>

    /**
     * Executes before any of the routing happens, perfect opportunity to
     * find any handlers and add them. 
     */
    beforeRouting?: (schema: unknown) => Promise<void>
}