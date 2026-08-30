import express, { Express, Handler, Request } from "express"
import { parseFromUri } from "json-ject"
import { CreateServerConfig } from "./types/create-server-config.js"
import { Endpoint, executeHandler, useDefaultHandler } from "./handler.js";
import { ServerPlugin } from "./types/plugin-sdk.js";

const openApiEndpoints: Record<HttpMethod, string[]> = {
    GET: [],
    POST: [],
    PATCH: [],
    PUT: [],
    DELETE: [],
    HEAD: [],
    OPTIONS: []
};

type MissingEndpoint = {
    url: string, 
    method: HttpMethod
}

let unhandledEndpoints: MissingEndpoint[] = [];

const routeMap: Record<HttpMethod, Record<string, Endpoint>> = {
    GET: {},
    POST: {},
    PATCH: {},
    PUT: {},
    DELETE: {},
    HEAD: {},
    OPTIONS: {}
}

export const registerEndpointHandler = <TContext = unknown>(method: HttpMethod, path: string, handler: Endpoint<TContext>) => {
    routeMap[method][path] = handler as Endpoint;
}

export const createHttpServer = async (conf: CreateServerConfig) => {
    
    const openapiDoc = await parseFromUri(conf.openApiFilePath, conf.jectOptions);

    // before the routing starts
    await Promise.all(
        (conf.plugins ?? []).map(plugin => plugin.beforeRouting?.())
    );

    const app = express();

    // loads all the endpoints into the endpoints object.
    getEndpointsFromSchema(app, openapiDoc, conf);

    // before the server starts
    await Promise.all(
        (conf.plugins ?? []).map(plugin => plugin.beforeServerStart?.())
    );

    app.listen(conf.httpPort, () => {
        console.log(`OpenAPI server listening on http://localhost:${conf.httpPort}`)
        console.log()
        console.log(`Endpoints missing implementation: ${unhandledEndpoints.length}`)
        
        unhandledEndpoints.forEach(endpoint => {
            console.log(`[${endpoint.method}] ${endpoint.url}`)
        })
    })
}

const getEndpointsFromSchema = (express: Express, openapiDoc: any, config: CreateServerConfig) => {
    
    // load all endpoints from the schema.
    for (const [url, methods] of Object.entries((openapiDoc as any).paths ?? {})) {
        for (const method of Object.keys(methods as object)) {
            const m = method.toUpperCase() as HttpMethod;
            if (m in openApiEndpoints) openApiEndpoints[m].push(url);
        }
    }

    // iterate all the endpoints, here we check if 
    // they've already been defined, or they need
    // defining. 
    Object.keys(openApiEndpoints).forEach((httpMethod:string) => {
        createEndpoints(
            express, 
            httpMethod as HttpMethod, 
            openApiEndpoints[httpMethod as HttpMethod] as string[],
            config
        );
    })
}

const createEndpoints = (express: Express, method: HttpMethod, urls: string[], config: CreateServerConfig) => {
    
    const routes = routeMap[method];
    
    urls.forEach(url => {
        const endpoint: Endpoint | undefined = routes[url];

        if (!endpoint) {
            unhandledEndpoints.push({ method, url })
            express[method as keyof Express](url, executeHandler(useDefaultHandler(), config));
            return;
        }
        express[method as keyof Express](url, executeHandler(endpoint, config));
    });
}

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE' | 'HEAD' | 'OPTIONS';