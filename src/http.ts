import express, { Express, Handler, Request } from "express"
import { parseFromUri } from "json-ject"
import { CreateServerConfig } from "./types/create-server-config.js"
import { Endpoint, executeHandler, useDefaultHandler } from "./handler.js";

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

const unhandledEndpoints: MissingEndpoint[] = [];

const routeMap: Record<HttpMethod, Record<string, Endpoint>> = {
    GET: {},
    POST: {},
    PATCH: {},
    PUT: {},
    DELETE: {},
    HEAD: {},
    OPTIONS: {}
}

const toExpressPath = (path: string) => path.replace(/{([^}]+)}/g, ':$1');

export const registerEndpointHandler = <TContext = unknown>(method: HttpMethod, path: string, handler: Endpoint<TContext>) => {
    routeMap[method.toUpperCase() as HttpMethod][toExpressPath(path)] = handler as Endpoint;
}

export let getRequestSchemaForEndpoint: (method: HttpMethod, url: string) => any;
export let getResponseSchemaForEndpoint: (method: HttpMethod, url: string) => any;

const toOpenApiPath = (path: string) => path.replace(/:([^/]+)/g, '{$1}');

const isParamSegment = (seg: string) => seg.startsWith(':') || (seg.startsWith('{') && seg.endsWith('}'));

const isPathMatch = (a: string, b: string) => {
    const aSegs = a.split('/');
    const bSegs = b.split('/');
    if (aSegs.length !== bSegs.length) return false;
    for (let i = 0; i < aSegs.length; i++) {
        if (aSegs[i] === bSegs[i]) continue;
        // either side is a param placeholder -> treat as wildcard (covers :id vs {id} vs {userId} vs concrete 123)
        if (isParamSegment(aSegs[i]) || isParamSegment(bSegs[i])) continue;
        return false;
    }
    return true;
};

const resolveOperation = (doc: any, method: HttpMethod, url: string) => {
    const lowerMethod = method.toLowerCase();
    // 1) fast exact + syntax-converted exact matches (covers same param names)
    const candidates = [url, toOpenApiPath(url), toExpressPath(url)];
    for (const candidate of candidates) {
        const op = doc?.paths?.[candidate]?.[lowerMethod];
        if (op) return op;
    }
    // 2) structural match: handles :id vs {userId} name mismatch and concrete urls like /users/123
    //    param segments are wildcards regardless of name or syntax
    for (const [openApiPath, methods] of Object.entries((doc as any)?.paths ?? {})) {
        if (!isPathMatch(url, openApiPath)) continue;
        const op = (methods as any)?.[lowerMethod];
        if (op) return op;
    }
    return undefined;
};

const resolveJsonPointer = (ref: string, root: any): any => {
    if (!ref.startsWith('#/')) return undefined;
    const parts = ref.slice(2).split('/').map(p => decodeURIComponent(p.replace(/~1/g, '/').replace(/~0/g, '~')));
    let cur: any = root;
    for (const part of parts) {
        if (cur == null || typeof cur !== 'object' || !(part in cur)) return undefined;
        cur = cur[part];
    }
    return cur;
};

const dereferenceSchema = (node: any, root: any, seen: Set<string> = new Set()): any => {
    if (Array.isArray(node)) {
        return node.map(item => dereferenceSchema(item, root, seen));
    }
    if (node == null || typeof node !== 'object') return node;
    if (typeof node.$ref === 'string') {
        const ref: string = node.$ref;
        // circular guard
        if (seen.has(ref)) {
            const target = resolveJsonPointer(ref, root);
            // return shallow clone of target without further expansion to break cycle
            return target && typeof target === 'object' ? { ...target } : target ?? { ...node };
        }
        const target = resolveJsonPointer(ref, root);
        if (target === undefined) {
            // unresolved ref: return copy without infinite loop, still dereference siblings
            const { $ref, ...siblings } = node;
            const out: any = {};
            for (const [k, v] of Object.entries(siblings)) out[k] = dereferenceSchema(v, root, seen);
            return Object.keys(out).length ? { $ref, ...out } : { $ref };
        }
        seen.add(ref);
        const resolved = dereferenceSchema(target, root, seen);
        seen.delete(ref);
        const { $ref, ...siblings } = node;
        if (Object.keys(siblings).length === 0) return resolved;
        const dereffedSiblings: any = {};
        for (const [k, v] of Object.entries(siblings)) dereffedSiblings[k] = dereferenceSchema(v, root, seen);
        if (resolved && typeof resolved === 'object' && !Array.isArray(resolved)) {
            return { ...resolved, ...dereffedSiblings };
        }
        return dereffedSiblings;
    }
    const out: any = {};
    for (const [k, v] of Object.entries(node)) {
        out[k] = dereferenceSchema(v, root, seen);
    }
    return out;
};

export const createHttpServer = async (conf: CreateServerConfig) => {
    
    const openapiDoc = await parseFromUri(conf.openApiFilePath, conf.jectOptions);

    getRequestSchemaForEndpoint = (method: HttpMethod, url: string) => {
        const operation = resolveOperation(openapiDoc, method, url);
        if (!operation?.requestBody?.content) return undefined;
        const content = operation.requestBody.content;
        const schema = content['application/json']?.schema ?? (Object.values(content as Record<string, any>)[0] as any)?.schema;
        if (!schema) return undefined;
        return dereferenceSchema(schema, openapiDoc);
    };

    getResponseSchemaForEndpoint = (method: HttpMethod, url: string) => {
        const operation = resolveOperation(openapiDoc, method, url);
        const responses = operation?.responses;
        if (!responses) return undefined;
        const response = responses['200'] ?? responses['201'] ?? responses['default']
            ?? Object.entries(responses).find(([code]) => code.startsWith('2'))?.[1] as any;
        if (!response?.content) return undefined;
        const schema = response.content['application/json']?.schema ?? (Object.values(response.content as Record<string, any>)[0] as any)?.schema;
        if (!schema) return undefined;
        return dereferenceSchema(schema, openapiDoc);
    };

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
            if (m in openApiEndpoints) openApiEndpoints[m].push(toExpressPath(url));
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
            express[method.toLowerCase() as keyof Express](url, executeHandler(useDefaultHandler(), config, url));
            return;
        }
        express[method.toLowerCase() as keyof Express](url, executeHandler(endpoint, config, url));
    });
}

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE' | 'HEAD' | 'OPTIONS';