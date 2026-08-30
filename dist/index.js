// src/http.ts
import express from "express";
import { parseFromUri } from "json-ject";

// src/handler.ts
var defaultHandler = (req, session) => {
  throw Object.assign(new Error("This endpoint has not been implemented"), { status_code: 500 });
};
var useDefaultHandler = () => {
  return {
    handler: defaultHandler
  };
};
var executeHandler = (endpoint, config, matchingRoute) => {
  return async (request, response) => {
    let result;
    request.route = matchingRoute;
    try {
      const sessionCtx = await config.buildContext(request);
      await Promise.all(
        (config.plugins ?? []).map(
          (plugin) => plugin.preRequest?.(request, sessionCtx)
        )
      );
      result = await endpoint.handler(request, sessionCtx);
      await Promise.all(
        (config.plugins ?? []).map(
          async (plugin) => {
            const tempResult = await plugin.postRequest?.(request, sessionCtx, result);
            if (tempResult) {
              result = tempResult;
            }
          }
        )
      );
      response.statusCode = 200;
    } catch (error) {
      if (error.errors) {
        response.statusCode = 500;
        result = {
          status: "failed",
          message: error.message ?? error,
          errors: error.errors,
          response: result,
          schema: {
            request: getRequestSchemaForEndpoint(request.method.toUpperCase(), request.route),
            response: getResponseSchemaForEndpoint(request.method.toUpperCase(), request.route)
          }
        };
      } else {
        if (error.status_code) {
          response.statusCode = error.status_code;
        }
        result = {
          status: "failed",
          message: error.message ?? error
        };
      }
    }
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(result));
  };
};

// src/http.ts
var openApiEndpoints = {
  GET: [],
  POST: [],
  PATCH: [],
  PUT: [],
  DELETE: [],
  HEAD: [],
  OPTIONS: []
};
var unhandledEndpoints = [];
var routeMap = {
  GET: {},
  POST: {},
  PATCH: {},
  PUT: {},
  DELETE: {},
  HEAD: {},
  OPTIONS: {}
};
var toExpressPath = (path) => path.replace(/{([^}]+)}/g, ":$1");
var registerEndpointHandler = (method, path, handler) => {
  routeMap[method.toUpperCase()][toExpressPath(path)] = handler;
};
var getRequestSchemaForEndpoint;
var getResponseSchemaForEndpoint;
var toOpenApiPath = (path) => path.replace(/:([^/]+)/g, "{$1}");
var isParamSegment = (seg) => seg.startsWith(":") || seg.startsWith("{") && seg.endsWith("}");
var isPathMatch = (a, b) => {
  const aSegs = a.split("/");
  const bSegs = b.split("/");
  if (aSegs.length !== bSegs.length) return false;
  for (let i = 0; i < aSegs.length; i++) {
    if (aSegs[i] === bSegs[i]) continue;
    if (isParamSegment(aSegs[i]) || isParamSegment(bSegs[i])) continue;
    return false;
  }
  return true;
};
var resolveOperation = (doc, method, url) => {
  const lowerMethod = method.toLowerCase();
  const candidates = [url, toOpenApiPath(url), toExpressPath(url)];
  for (const candidate of candidates) {
    const op = doc?.paths?.[candidate]?.[lowerMethod];
    if (op) return op;
  }
  for (const [openApiPath, methods] of Object.entries(doc?.paths ?? {})) {
    if (!isPathMatch(url, openApiPath)) continue;
    const op = methods?.[lowerMethod];
    if (op) return op;
  }
  return void 0;
};
var resolveJsonPointer = (ref, root) => {
  if (!ref.startsWith("#/")) return void 0;
  const parts = ref.slice(2).split("/").map((p) => decodeURIComponent(p.replace(/~1/g, "/").replace(/~0/g, "~")));
  let cur = root;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object" || !(part in cur)) return void 0;
    cur = cur[part];
  }
  return cur;
};
var dereferenceSchema = (node, root, seen = /* @__PURE__ */ new Set()) => {
  if (Array.isArray(node)) {
    return node.map((item) => dereferenceSchema(item, root, seen));
  }
  if (node == null || typeof node !== "object") return node;
  if (typeof node.$ref === "string") {
    const ref = node.$ref;
    if (seen.has(ref)) {
      const target2 = resolveJsonPointer(ref, root);
      return target2 && typeof target2 === "object" ? { ...target2 } : target2 ?? { ...node };
    }
    const target = resolveJsonPointer(ref, root);
    if (target === void 0) {
      const { $ref: $ref2, ...siblings2 } = node;
      const out2 = {};
      for (const [k, v] of Object.entries(siblings2)) out2[k] = dereferenceSchema(v, root, seen);
      return Object.keys(out2).length ? { $ref: $ref2, ...out2 } : { $ref: $ref2 };
    }
    seen.add(ref);
    const resolved = dereferenceSchema(target, root, seen);
    seen.delete(ref);
    const { $ref, ...siblings } = node;
    if (Object.keys(siblings).length === 0) return resolved;
    const dereffedSiblings = {};
    for (const [k, v] of Object.entries(siblings)) dereffedSiblings[k] = dereferenceSchema(v, root, seen);
    if (resolved && typeof resolved === "object" && !Array.isArray(resolved)) {
      return { ...resolved, ...dereffedSiblings };
    }
    return dereffedSiblings;
  }
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    out[k] = dereferenceSchema(v, root, seen);
  }
  return out;
};
var createHttpServer = async (conf) => {
  const openapiDoc = await parseFromUri(conf.openApiFilePath, conf.jectOptions);
  getRequestSchemaForEndpoint = (method, url) => {
    const operation = resolveOperation(openapiDoc, method, url);
    if (!operation?.requestBody?.content) return void 0;
    const content = operation.requestBody.content;
    const schema = content["application/json"]?.schema ?? Object.values(content)[0]?.schema;
    if (!schema) return void 0;
    return dereferenceSchema(schema, openapiDoc);
  };
  getResponseSchemaForEndpoint = (method, url) => {
    const operation = resolveOperation(openapiDoc, method, url);
    const responses = operation?.responses;
    if (!responses) return void 0;
    const response = responses["200"] ?? responses["201"] ?? responses["default"] ?? Object.entries(responses).find(([code]) => code.startsWith("2"))?.[1];
    if (!response?.content) return void 0;
    const schema = response.content["application/json"]?.schema ?? Object.values(response.content)[0]?.schema;
    if (!schema) return void 0;
    return dereferenceSchema(schema, openapiDoc);
  };
  await Promise.all(
    (conf.plugins ?? []).map((plugin) => plugin.beforeRouting?.(openapiDoc))
  );
  const app = express();
  getEndpointsFromSchema(app, openapiDoc, conf);
  await Promise.all(
    (conf.plugins ?? []).map((plugin) => plugin.beforeServerStart?.())
  );
  app.listen(conf.httpPort, () => {
    console.log(`OpenAPI server listening on http://localhost:${conf.httpPort}`);
    console.log();
    console.log(`Endpoints missing implementation: ${unhandledEndpoints.length}`);
    unhandledEndpoints.forEach((endpoint) => {
      console.log(`[${endpoint.method}] ${endpoint.url}`);
    });
  });
};
var getEndpointsFromSchema = (express2, openapiDoc, config) => {
  for (const [url, methods] of Object.entries(openapiDoc.paths ?? {})) {
    for (const method of Object.keys(methods)) {
      const m = method.toUpperCase();
      if (m in openApiEndpoints) openApiEndpoints[m].push(toExpressPath(url));
    }
  }
  Object.keys(openApiEndpoints).forEach((httpMethod) => {
    createEndpoints(
      express2,
      httpMethod,
      openApiEndpoints[httpMethod],
      config
    );
  });
};
var createEndpoints = (express2, method, urls, config) => {
  const routes = routeMap[method];
  urls.forEach((url) => {
    const endpoint = routes[url];
    if (!endpoint) {
      unhandledEndpoints.push({ method, url });
      express2[method.toLowerCase()](url, executeHandler(useDefaultHandler(), config, url));
      return;
    }
    express2[method.toLowerCase()](url, executeHandler(endpoint, config, url));
  });
};

// src/core-plugins/use-glob.ts
import { glob } from "tinyglobby";
var useGlobLoader = (path) => ({
  async beforeRouting() {
    const files = await glob([path, "!**/*.test.ts"], {
      expandDirectories: true,
      onlyFiles: true
    });
    await Promise.all(
      files.map((file) => resolveAndImport(file))
    );
  }
});
var resolveAndImport = async (file) => {
  let path = `${process.cwd()}/${file}`;
  if (path[1] === ":") {
    path = path.substring(2);
  }
  path = path.replaceAll("\\", "/");
  await import(path);
};

// src/core-plugins/use-custom-handlers.ts
var useCustomHandlers = useGlobLoader("./**/*.handler.ts");

// src/core-plugins/use-eventify.ts
var useEventify = useGlobLoader("./**/*.events.ts");

// src/core-plugins/use-permissify.ts
var usePermissify = useGlobLoader("./**/*.permissions.ts");
export {
  createHttpServer,
  getRequestSchemaForEndpoint,
  getResponseSchemaForEndpoint,
  registerEndpointHandler,
  useCustomHandlers,
  useEventify,
  useGlobLoader,
  usePermissify
};
