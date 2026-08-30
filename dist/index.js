// src/routes.ts
var routeMap = /* @__PURE__ */ new Map();
var defaultHandlers = /* @__PURE__ */ new Set();
function normalizePath(path) {
  return path.replace(/:([^/]+)/g, "{$1}");
}
function routeKey(method, path) {
  return `${method} ${normalizePath(path)}`;
}
function getMethodMap(method) {
  let methodMap = routeMap.get(method);
  if (!methodMap) {
    methodMap = /* @__PURE__ */ new Map();
    routeMap.set(method, methodMap);
  }
  return methodMap;
}
var Routes = {
  /**
   * Registers a custom request handler for a given HTTP method and route path.
   *
   * Overwrites any existing handler or default placeholder bound to the target route
   * and marks the route as implemented in the spec audit log.
   *
   * @param method - The target HTTP verb.
   * @param path - The OpenAPI-compatible route path (e.g., `"/users/{userId}"`).
   * @param handler - The custom domain logic handler function.
   *
   * @example
   * ```typescript
   * Routes.setRequestHandler("GET", "/health", async (req, ctx) => {
   *   return { status: "ok" }
   * })
   * ```
   */
  setRequestHandler(method, path, handler) {
    const normalized = normalizePath(path);
    const methodMap = getMethodMap(method);
    methodMap.set(normalized, handler);
    defaultHandlers.delete(routeKey(method, normalized));
  },
  /**
   * Retrieves the currently registered handler for an HTTP method and path combination.
   *
   * @param method - The target HTTP verb.
   * @param path - The registered route path.
   * @returns The registered {@link Handler} callback, or `undefined` if no handler exists for the route.
   */
  getRequestHandler(method, path) {
    return routeMap.get(method)?.get(normalizePath(path));
  },
  /**
   * Returns the underlying nested route map containing all registered HTTP methods, paths, and handlers.
   *
   * @returns The complete map of HTTP methods to path-handler entries.
   */
  getRoutes() {
    return routeMap;
  },
  /**
   * Audits the registry and returns a list of spec-declared routes that still lack a custom handler.
   *
   * Routes marked via {@link Routes.markAsDefault} remain in this list until a custom handler
   * is attached via {@link Routes.setRequestHandler}.
   *
   * @returns An array of objects describing unimplemented routes, each containing `method` and `path`.
   *
   * @example
   * ```typescript
   * const missing = Routes.getDefaultHandlers()
   * missing.forEach(({ method, path }) => {
   *   console.warn(`Missing handler for ${method} ${path}`)
   * })
   * ```
   */
  getDefaultHandlers() {
    const missing = [];
    for (const key of defaultHandlers) {
      const space = key.indexOf(" ");
      const method = key.substring(0, space);
      const path = key.substring(space + 1);
      missing.push({ method, path });
    }
    return missing;
  },
  /**
    * Registers an OpenAPI specification endpoint into the default tracker with a `503 Not Implemented` fallback handler.
    *
    * Called during server initialization to populate the expected API surface before user routes are attached.
    * If a handler was already registered for the route (e.g., via pre-registration before server start),
    * the existing handler is preserved and the route is not marked as missing.
    *
    * @param method - The HTTP method declared in the specification.
    * @param path - The path declared in the specification.
    * @internal
    */
  markAsDefault(method, path) {
    const normalized = normalizePath(path);
    const key = routeKey(method, normalized);
    if (routeMap.get(method)?.has(normalized)) {
      return;
    }
    if (defaultHandlers.has(key)) {
      return;
    }
    defaultHandlers.add(key);
    const methodMap = getMethodMap(method);
    methodMap.set(normalized, async () => {
      throw { status: 503, message: "Not implemented" };
    });
  },
  /**
   * Resets the entire routing registry, removing all registered route handlers and pending default routes.
   *
   * Useful for tearing down state between automated test suites.
   *
   * @example
   * ```typescript
   * beforeEach(() => {
   *   Routes.clear()
   * })
   * ```
   */
  clear() {
    routeMap.clear();
    defaultHandlers.clear();
  }
};

// src/http.ts
import express from "express";
import { parseFromUri } from "json-ject";
var activeServer = null;
function openApiPathToExpress(path) {
  return path.replace(/\{([^}]+)\}/g, ":$1");
}
function registerRoute(app, method, path, handler) {
  const methodKey = method.toLowerCase();
  const registerer = app[methodKey];
  if (typeof registerer === "function") {
    registerer.call(app, path, handler);
  } else {
    console.warn(`[Server] Skipping unsupported HTTP method '${method}' for route '${path}'`);
  }
}
var createHttpServer = async (config) => {
  const app = express();
  app.use(express.json());
  const spec = await parseFromUri(config.openApiFilePath, config.jectOptions);
  if (!spec || typeof spec !== "object" || !("paths" in spec)) {
    throw new Error("Failed to parse OpenAPI spec: Invalid structure or missing 'paths'");
  }
  const paths = spec.paths;
  for (const [openApiPath, methods] of Object.entries(paths)) {
    if (!methods || typeof methods !== "object") continue;
    for (const method of Object.keys(methods)) {
      const upperMethod = method.toUpperCase();
      Routes.markAsDefault(upperMethod, openApiPath);
    }
  }
  const plugins = config.plugins ?? [];
  for (const plugin of plugins) {
    if (plugin.beforeServerStart) {
      await plugin.beforeServerStart();
    }
  }
  const missing = Routes.getDefaultHandlers();
  if (missing.length > 0) {
    console.log(`
Missing ${missing.length} handler(s):`);
    for (const { method, path } of missing) {
      console.log(`  ${method.padEnd(7)} ${path}`);
    }
    console.log();
  }
  for (const [method, pathMap] of Routes.getRoutes()) {
    for (const [openApiPath, handler] of pathMap) {
      const ep = openApiPathToExpress(openApiPath);
      registerRoute(app, method, ep, async (req, res) => {
        try {
          const sessionCtx = config.createContext ? await config.createContext(req) : {};
          for (const plugin of plugins) {
            if (plugin.preRequest) {
              await plugin.preRequest(req, sessionCtx);
            }
          }
          const currentHandler = Routes.getRequestHandler(method, openApiPath);
          const effectiveHandler = currentHandler ?? handler;
          if (!effectiveHandler) {
            res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
            return;
          }
          const result = await effectiveHandler(req, sessionCtx);
          let finalResult = result;
          for (const plugin of plugins) {
            if (plugin.postRequest) {
              finalResult = await plugin.postRequest(req, sessionCtx, finalResult);
            }
          }
          res.json(finalResult);
        } catch (err) {
          console.error(`[Error] ${req.method} ${req.path}:`, err);
          const status = err.status ?? 500;
          const message = err.message ?? "Internal server error";
          res.status(status).json({
            error: message,
            code: status === 500 ? "INTERNAL_ERROR" : "REQUEST_FAILED"
          });
        }
      });
    }
  }
  app.use((_req, res) => {
    res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
  });
  if (activeServer) {
    await new Promise((resolve) => {
      try {
        activeServer.close(() => resolve());
      } catch {
        resolve();
      }
      setTimeout(resolve, 100);
    });
    activeServer = null;
  }
  const tryListen = (port) => new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      console.log(`Running OpenAPI schema server`);
      console.log(`http://localhost:${server.address()?.port ?? port}`);
      if (config.ssl) {
        console.log(`https://localhost:${config.ssl.httpsPort}`);
      }
      resolve(server);
    });
    server.on("error", (err) => {
      if (err.code === "EADDRINUSE" && port !== 0) {
        try {
          server.close();
        } catch {
        }
        const fallback = app.listen(0, () => {
          const addr = fallback.address();
          console.log(`Running OpenAPI schema server (fallback)`);
          console.log(`http://localhost:${addr?.port}`);
          resolve(fallback);
        });
        fallback.on("error", reject);
      } else {
        reject(err);
      }
    });
  });
  activeServer = await tryListen(config.httpPort);
  activeServer.unref();
  app.__server = activeServer;
  return app;
};

// src/index.ts
var setRequestHandler = Routes.setRequestHandler.bind(Routes);
var Routes2 = {
  setRequestHandler
};
export {
  Routes2 as Routes,
  createHttpServer,
  setRequestHandler
};
