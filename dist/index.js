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
        response.statusCode = error.status_code ?? 500;
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
    if (result?.__serveifyStatic === true) {
      const staticResult2 = result;
      if (staticResult2.contentType) response.setHeader("Content-Type", staticResult2.contentType);
      response.end(staticResult2.body);
      return;
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
var webAppMap = {};
var toExpressPath = (path) => path.replace(/{([^}]+)}/g, ":$1");
var registerEndpointHandler = (method, path, handler) => {
  routeMap[method.toUpperCase()][toExpressPath(path)] = handler;
};
var registerWebApp = (key, route, endpoint) => {
  webAppMap[key] = { route, endpoint };
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
  for (const plugin of conf.plugins ?? []) {
    await plugin.beforeRouting?.(openapiDoc);
  }
  const app = express();
  app.use(express.json());
  getEndpointsFromSchema(app, openapiDoc, conf);
  app.use((err, _req, res, next) => {
    const status = err?.status ?? err?.statusCode;
    const isBodyParseError = err?.type === "entity.parse.failed" || err instanceof SyntaxError && "body" in err;
    if (isBodyParseError || status === 400) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ status: "failed", message: "Invalid JSON body" }));
      return;
    }
    next(err);
  });
  if ((conf.plugins ?? []).some((plugin) => plugin.on404NotFound)) app.use(async (request, response) => {
    const enhancedRequest = request;
    let rerouted = false;
    enhancedRequest.route = request.path;
    enhancedRequest.reroute = async (webAppKey) => {
      const webApp = webAppMap[webAppKey];
      if (!webApp) {
        throw new Error(`Unknown web app: ${webAppKey}`);
      }
      rerouted = true;
      await executeHandler(webApp.endpoint, conf, webApp.route)(enhancedRequest, response);
    };
    const sessionCtx = await conf.buildContext(enhancedRequest);
    for (const plugin of conf.plugins ?? []) {
      await plugin.on404NotFound?.(enhancedRequest, sessionCtx);
      if (response.headersSent || response.writableEnded || rerouted) return;
    }
    response.statusCode = 404;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ status: "failed", message: "Not found" }));
  });
  for (const plugin of conf.plugins ?? []) {
    await plugin.beforeServerStart?.();
  }
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
  Object.keys(routeMap).forEach((httpMethod) => {
    const schemaRoutes = new Set(openApiEndpoints[httpMethod]);
    for (const url of Object.keys(routeMap[httpMethod])) {
      if (schemaRoutes.has(url)) continue;
      createEndpoints(express2, httpMethod, [url], config);
    }
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
import { access } from "fs/promises";
var useEventify = () => ({
  async beforeRouting(schema) {
    try {
      await access("node_modules/eventify-openapi");
      const { eventifyOpenApi } = await import("eventify-openapi");
      await eventifyOpenApi({
        input: "openapi.json",
        type: "file",
        tsconfigPath: "tsconfig.json",
        contextType: { from: "./ctx.js", name: "SessionCtx" }
      });
      return await useGlobLoader("./**/*.events.ts")?.beforeRouting?.(schema);
    } catch (err) {
      console.warn("eventify-openapi is not installed. Please install it to use eventify features.");
      return;
    }
  }
});

// src/core-plugins/use-permissify.ts
import { access as access2 } from "fs/promises";
var usePermissify = () => ({
  async beforeRouting(schema) {
    try {
      await access2("node_modules/permissify-openapi");
    } catch (err) {
      console.warn("permissify-openapi is not installed. Please install it to use permissify features.");
      return;
    }
    return await useGlobLoader("./**/*.permissions.ts").beforeRouting?.(schema);
  }
});

// src/core-plugins/use-static.ts
import { readFile } from "fs/promises";
import { resolve, relative, sep, join, extname } from "path";
import mime from "mime-types";
var getContentType = (filePath, options) => {
  const detected = mime.contentType(extname(filePath));
  return options.contentType ?? options["content-type"] ?? (typeof detected === "string" ? detected : "application/octet-stream");
};
var toRoute = (route) => {
  const normalized = route.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  return normalized ? `/${normalized}` : "/";
};
var staticResult = async (filePath, options) => ({
  __serveifyStatic: true,
  body: await readFile(filePath),
  contentType: getContentType(filePath, options)
});
var createStaticDirectoryEndpoint = (directoryPath, options = {}) => {
  const root = resolve(directoryPath);
  return {
    handler: async (request) => {
      const requestedPath = request.params[0] || "index.html";
      const filePath = resolve(root, requestedPath);
      const pathFromRoot = relative(root, filePath);
      if (pathFromRoot.startsWith(`..${sep}`) || pathFromRoot === ".." || resolve(root, pathFromRoot) !== filePath) {
        throw Object.assign(new Error("Not found"), { status_code: 404 });
      }
      return staticResult(join(root, pathFromRoot), options);
    }
  };
};
var useStatic = (filePath, options = {}) => ({
  beforeRouting: async () => {
    registerEndpointHandler("GET", toRoute(options.route ?? filePath), {
      handler: async () => staticResult(filePath, options)
    });
  }
});
var useStaticDirectory = (directoryPath, options = {}) => ({
  beforeRouting: async () => {
    const route = toRoute(options.route ?? "/");
    registerEndpointHandler("GET", route === "/" ? "/*" : `${route}/*`, createStaticDirectoryEndpoint(directoryPath, options));
  }
});

// src/core-plugins/use-web-app.ts
import { mkdir } from "fs/promises";
var useWebApp = (route, staticDir) => ({
  async beforeRouting() {
    await mkdir(`web/${staticDir}/static`, { recursive: true });
    await mkdir(`web/${staticDir}/src`, { recursive: true });
    const endpoint = createStaticDirectoryEndpoint(`web/${staticDir}/static`, { route });
    const normalizedRoute = route.replace(/^\/+|\/+$/g, "");
    const staticRoute = normalizedRoute ? `${route.replace(/\/+$/g, "")}/*` : "/*";
    registerEndpointHandler("GET", staticRoute, endpoint);
    registerWebApp(route, staticRoute, endpoint);
  }
});
export {
  createHttpServer,
  getRequestSchemaForEndpoint,
  getResponseSchemaForEndpoint,
  registerEndpointHandler,
  useCustomHandlers,
  useEventify,
  useGlobLoader,
  usePermissify,
  useStatic,
  useStaticDirectory,
  useWebApp
};
