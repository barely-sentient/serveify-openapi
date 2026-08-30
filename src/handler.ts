import { Request, Response } from "express"
import { CreateServerConfig } from "./types/create-server-config.js"

export type Endpoint<TContext = unknown> = {
    handler: (req: Request, session: TContext) => Promise<unknown>
}

export const defaultHandler = <TContext = unknown>(req: Request, session: TContext) => {
    throw Object.assign(new Error("This endpoint has not been implemented"), { status_code: 500 })
}

export const useDefaultHandler = () => {
    return {
        handler: defaultHandler
    }
}

export type EnhancedRequest = Request & {
    route: string
}

export const executeHandler = (endpoint: Endpoint, config: CreateServerConfig, matchingRoute: string) => {
    return async (request: EnhancedRequest, response: Response) => {
        
        let result: unknown;
        request.route = matchingRoute;

        try
        {
            
            const sessionCtx = await config.buildContext(request);

            await Promise.all(
                (config.plugins ?? []).map(
                    plugin => plugin.preRequest?.(request, sessionCtx)
                )
            );

            result = await endpoint.handler(request, sessionCtx);

            await Promise.all(
                (config.plugins ?? []).map(
                    async plugin => {
                        const tempResult = await plugin.postRequest?.(request, sessionCtx, result)
                        if (tempResult)
                        {
                            result = tempResult;
                        }
                    }
                )
            );

            response.statusCode = 200;
        
        }catch(error)
        {
            if ((error as any).status_code) {
                response.statusCode = (error as any).status_code;
            }
            result = {
                status: 'failed', 
                message: (error as Error).message ?? error
            }
        }

        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(result));
    };
}