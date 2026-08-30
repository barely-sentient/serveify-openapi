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
var executeHandler = (endpoint, config) => {
  return async (request, response) => {
    let result;
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
      if (error.status_code) {
        response.statusCode = error.status_code;
      }
      result = {
        status: "failed",
        message: error.message ?? error
      };
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
var createHttpServer = async (conf) => {
  const openapiDoc = await parseFromUri(conf.openApiFilePath, conf.jectOptions);
  getRequestSchemaForEndpoint = (method, url) => {
    const operation = resolveOperation(openapiDoc, method, url);
    if (!operation?.requestBody?.content) return void 0;
    const content = operation.requestBody.content;
    return content["application/json"]?.schema ?? Object.values(content)[0]?.schema;
  };
  getResponseSchemaForEndpoint = (method, url) => {
    const operation = resolveOperation(openapiDoc, method, url);
    const responses = operation?.responses;
    if (!responses) return void 0;
    const response = responses["200"] ?? responses["201"] ?? responses["default"] ?? Object.entries(responses).find(([code]) => code.startsWith("2"))?.[1];
    if (!response?.content) return void 0;
    return response.content["application/json"]?.schema ?? Object.values(response.content)[0]?.schema;
  };
  await Promise.all(
    (conf.plugins ?? []).map((plugin) => plugin.beforeRouting?.())
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
      express2[method.toLowerCase()](url, executeHandler(useDefaultHandler(), config));
      return;
    }
    express2[method.toLowerCase()](url, executeHandler(endpoint, config));
  });
};

// src/core-plugins/use-glob.ts
import { glob } from "tinyglobby";
import os from "os";
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
  if (os.platform() == "win32") {
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
  registerEndpointHandler,
  useCustomHandlers,
  useEventify,
  useGlobLoader,
  usePermissify
};
