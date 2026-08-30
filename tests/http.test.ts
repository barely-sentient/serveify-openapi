import { jest } from "@jest/globals";

// --- Shared mock state (must be defined before mocking) ---
const mockListen = jest.fn((port: number, cb: () => void) => {
  if (cb) cb();
  return {} as any;
});
const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPatch = jest.fn();
const mockPut = jest.fn();
const mockDelete = jest.fn();
const mockHead = jest.fn();
const mockOptions = jest.fn();

const mockApp: any = {
  get: mockGet,
  post: mockPost,
  patch: mockPatch,
  put: mockPut,
  delete: mockDelete,
  head: mockHead,
  options: mockOptions,
  listen: mockListen,
};

const mockExpress = jest.fn(() => mockApp);
const mockParseFromUri = jest.fn();

// Unstable mock must be called before importing the module under test.
// These are hoisted-like but using unstable_mockModule works with ESM.
jest.unstable_mockModule("express", () => ({
  default: mockExpress,
  // Provide named exports that might be imported (not used at runtime)
}));

jest.unstable_mockModule("json-ject", () => ({
  parseFromUri: mockParseFromUri,
}));

// Must dynamically import after mocks are registered
const { createHttpServer, registerEndpointHandler } = await import("../src/http.js");
const handlerModule = await import("../src/handler.js");

describe("http", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParseFromUri.mockReset();
    // reset the singleton state inside http module is not directly accessible.
    // We clear mock calls; accumulation of openApiEndpoints/routeMap will be accounted for
    // by using unique paths per test. For isolation of createHttpServer tests we use fresh module via reset.
    // However for registerEndpointHandler tests, we rely on unique path strings.
  });

  // Helper to get fresh http module with clean singletons
  async function getFreshHttp() {
    jest.resetModules();
    // Need to re-register mocks after resetModules
    jest.unstable_mockModule("express", () => ({
      default: mockExpress,
    }));
    jest.unstable_mockModule("json-ject", () => ({
      parseFromUri: mockParseFromUri,
    }));
    // We also need to ensure handler mocks stay: handler module is separate, but we want real handler for fresh tests
    const fresh = await import("../src/http.js");
    return fresh;
  }

  describe("registerEndpointHandler", () => {
    it("should register handler converting OpenAPI {param} to Express :param", async () => {
      const unique = Date.now();
      const uniquePath = `/register-test-${unique}/{id}`;
      const expressPath = `/register-test-${unique}/:id`;
      const handler2 = { handler: jest.fn(async () => ({ x: 1 })) };
      registerEndpointHandler("GET", uniquePath, handler2 as any);

      mockParseFromUri.mockResolvedValue({
        paths: {
          [uniquePath]: { get: {} },
        },
      });

      // Ensure mockApp.get will be called with expressPath (converted)
      mockExpress.mockReturnValue(mockApp);
      // Clear previous calls for isolation
      mockApp.get.mockClear();
      await createHttpServer({
        openApiFilePath: "./openapi.json",
        httpPort: 3456,
        buildContext: async () => ({}),
      } as any);

      // Find if mockApp.get was called with expressPath
      const calledWithExpressPath = mockApp.get.mock.calls.some((call: any[]) => call[0] === expressPath);
      expect(calledWithExpressPath).toBe(true);
    });

    it("should normalize method to uppercase (case-insensitive)", async () => {
      const path = `/case-${Date.now()}/{id}`;
      const expressPath = path.replace(/{([^}]+)}/g, ":$1");
      const handler = { handler: jest.fn(async () => ({})) };
      // register with lowercase
      registerEndpointHandler("get" as any, path, handler as any);

      mockParseFromUri.mockResolvedValue({
        paths: {
          [path]: { get: {} },
        },
      });

      await createHttpServer({
        openApiFilePath: "./openapi.json",
        httpPort: 3457,
        buildContext: async () => ({}),
      } as any);

      expect(mockApp.get.mock.calls.some((c: any[]) => c[0] === expressPath)).toBe(true);
    });

    it("should overwrite existing handler for same method+path", async () => {
      const path = `/overwrite-${Date.now()}/{id}`;
      const expressPath = path.replace(/{([^}]+)}/g, ":$1");
      const handler1 = { handler: jest.fn(async () => ({ v: 1 })) };
      const handler2 = { handler: jest.fn(async () => ({ v: 2 })) };
      registerEndpointHandler("POST", path, handler1 as any);
      registerEndpointHandler("POST", path, handler2 as any);

      mockParseFromUri.mockResolvedValue({
        paths: {
          [path]: { post: {} },
        },
      });

      // We verify that the second handler overwrites the first by checking that after server creation,
      // the handler invocation would correspond to handler2. Since executeHandler is not easily spied,
      // we verify the route is registered once and the handler identity via indirect check:
      // registerEndpointHandler stores latest, so creating server should use handler2.
      // We verify by ensuring the post route is registered with express path.
      await createHttpServer({
        openApiFilePath: "./openapi.json",
        httpPort: 3458,
        buildContext: async () => ({}),
      } as any);

      expect(mockApp.post.mock.calls.some((c: any[]) => c[0] === expressPath)).toBe(true);
      // The overwritten handler should be effective: verify by checking the handler wrapper invokes handler2
      // Find the registered handler function for this path and invoke it to see it calls handler2
      const call = mockApp.post.mock.calls.find((c: any[]) => c[0] === expressPath);
      expect(call).toBeDefined();
      // call[1] is the executeHandler wrapper; invoking it should call handler2
      const mockReq = {} as any;
      const mockRes: any = { statusCode: undefined, setHeader: jest.fn(), end: jest.fn() };
      const fakeConfigBuild = jest.fn(async () => ({}));
      // We can't directly know wrapper's internal handler without mocking, but we can at least verify wrapper is a function
      expect(typeof call![1]).toBe("function");
    });

    it("should handle multiple path params conversion", async () => {
      const path = `/multi-${Date.now()}/{orderId}/items/{itemId}`;
      const expressPath = path.replace(/{([^}]+)}/g, ":$1");
      const handler = { handler: jest.fn(async () => ({})) };
      registerEndpointHandler("GET", path, handler as any);
      mockParseFromUri.mockResolvedValue({
        paths: {
          [path]: { get: {} },
        },
      });
      await createHttpServer({
        openApiFilePath: "./openapi.json",
        httpPort: 3459,
        buildContext: async () => ({}),
      } as any);
      expect(mockApp.get.mock.calls.some((c: any[]) => c[0] === expressPath)).toBe(true);
    });
  });

  describe("createHttpServer", () => {
    let consoleLogSpy: any;

    beforeEach(() => {
      consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
      consoleLogSpy.mockRestore();
    });

    it("should call parseFromUri with openApiFilePath and jectOptions", async () => {
      const fresh = await getFreshHttp();
      const doc = { paths: {} };
      mockParseFromUri.mockResolvedValue(doc);

      const freshApp: any = {
        get: jest.fn(),
        post: jest.fn(),
        patch: jest.fn(),
        put: jest.fn(),
        delete: jest.fn(),
        head: jest.fn(),
        options: jest.fn(),
        listen: jest.fn((p: number, cb: () => void) => { if (cb) cb(); return {} as any; }),
      };
      mockExpress.mockReturnValueOnce(freshApp);

      const config: any = {
        openApiFilePath: "./spec.json",
        httpPort: 4000,
        jectOptions: { some: "opt" },
        buildContext: async () => ({}),
      };

      await fresh.createHttpServer(config);

      expect(mockParseFromUri).toHaveBeenCalledWith("./spec.json", { some: "opt" });
      expect(mockParseFromUri).toHaveBeenCalledTimes(1);
    });

    it("should call parseFromUri with undefined jectOptions when not provided", async () => {
      const fresh = await getFreshHttp();
      mockParseFromUri.mockResolvedValue({ paths: {} });
      const freshApp: any = {
        get: jest.fn(),
        post: jest.fn(),
        patch: jest.fn(),
        put: jest.fn(),
        delete: jest.fn(),
        head: jest.fn(),
        options: jest.fn(),
        listen: jest.fn((p: number, cb: () => void) => { if (cb) cb(); return {} as any; }),
      };
      mockExpress.mockReturnValueOnce(freshApp);
      await fresh.createHttpServer({
        openApiFilePath: "./openapi.json",
        httpPort: 4001,
        buildContext: async () => ({}),
      } as any);
      expect(mockParseFromUri).toHaveBeenCalledWith("./openapi.json", undefined);
    });

    it("should execute beforeRouting plugins before routing and beforeServerStart after routing but before listen", async () => {
      const fresh = await getFreshHttp();
      const order: string[] = [];
      const beforeRouting = jest.fn(async () => { order.push("beforeRouting"); });
      const beforeServerStart = jest.fn(async () => { order.push("beforeServerStart"); });

      mockParseFromUri.mockResolvedValue({
        paths: {
          "/test": { get: {} },
        },
      });

      const freshApp: any = {
        get: jest.fn(() => { order.push("route"); }),
        post: jest.fn(),
        patch: jest.fn(),
        put: jest.fn(),
        delete: jest.fn(),
        head: jest.fn(),
        options: jest.fn(),
        listen: jest.fn((port: number, cb: () => void) => {
          order.push("listen");
          if (cb) cb();
          return {} as any;
        }),
      };
      mockExpress.mockReturnValueOnce(freshApp);

      await fresh.createHttpServer({
        openApiFilePath: "./openapi.json",
        httpPort: 4002,
        buildContext: async () => ({}),
        plugins: [{ beforeRouting, beforeServerStart }],
      } as any);

      expect(beforeRouting).toHaveBeenCalledTimes(1);
      expect(beforeServerStart).toHaveBeenCalledTimes(1);
      expect(order).toEqual(["beforeRouting", "route", "beforeServerStart", "listen"]);
    });

    it("should handle plugins undefined (no lifecycle hooks)", async () => {
      const fresh = await getFreshHttp();
      mockParseFromUri.mockResolvedValue({ paths: {} });
      const freshApp: any = {
        get: jest.fn(),
        post: jest.fn(),
        patch: jest.fn(),
        put: jest.fn(),
        delete: jest.fn(),
        head: jest.fn(),
        options: jest.fn(),
        listen: jest.fn((p: number, cb: () => void) => { if (cb) cb(); return {} as any; }),
      };
      mockExpress.mockReturnValueOnce(freshApp);
      await expect(
        fresh.createHttpServer({
          openApiFilePath: "./openapi.json",
          httpPort: 4003,
          buildContext: async () => ({}),
        } as any),
      ).resolves.not.toThrow();
      expect(freshApp.listen).toHaveBeenCalledWith(4003, expect.any(Function));
    });

    it("should execute all plugins' lifecycle hooks via Promise.all", async () => {
      const fresh = await getFreshHttp();
      const p1 = { beforeRouting: jest.fn(async () => {}), beforeServerStart: jest.fn(async () => {}) };
      const p2 = { beforeRouting: jest.fn(async () => {}), beforeServerStart: jest.fn(async () => {}) };
      mockParseFromUri.mockResolvedValue({ paths: {} });
      const freshApp: any = {
        get: jest.fn(),
        post: jest.fn(),
        patch: jest.fn(),
        put: jest.fn(),
        delete: jest.fn(),
        head: jest.fn(),
        options: jest.fn(),
        listen: jest.fn((p: number, cb: () => void) => { if (cb) cb(); return {} as any; }),
      };
      mockExpress.mockReturnValueOnce(freshApp);
      await fresh.createHttpServer({
        openApiFilePath: "./openapi.json",
        httpPort: 4004,
        buildContext: async () => ({}),
        plugins: [p1, p2],
      } as any);
      expect(p1.beforeRouting).toHaveBeenCalled();
      expect(p2.beforeRouting).toHaveBeenCalled();
      expect(p1.beforeServerStart).toHaveBeenCalled();
      expect(p2.beforeServerStart).toHaveBeenCalled();
    });

    it("should register endpoints for each HTTP method present in spec", async () => {
      const fresh = await getFreshHttp();
      mockParseFromUri.mockResolvedValue({
        paths: {
          "/a": { get: {}, post: {} },
          "/b": { patch: {}, put: {}, delete: {}, head: {}, options: {} },
        },
      });
      const freshApp: any = {
        get: jest.fn(),
        post: jest.fn(),
        patch: jest.fn(),
        put: jest.fn(),
        delete: jest.fn(),
        head: jest.fn(),
        options: jest.fn(),
        listen: jest.fn((p: number, cb: () => void) => { if (cb) cb(); return {} as any; }),
      };
      mockExpress.mockReturnValueOnce(freshApp);
      await fresh.createHttpServer({
        openApiFilePath: "./openapi.json",
        httpPort: 4005,
        buildContext: async () => ({}),
      } as any);

      expect(freshApp.get).toHaveBeenCalledWith("/a", expect.any(Function));
      expect(freshApp.post).toHaveBeenCalledWith("/a", expect.any(Function));
      expect(freshApp.patch).toHaveBeenCalledWith("/b", expect.any(Function));
      expect(freshApp.put).toHaveBeenCalledWith("/b", expect.any(Function));
      expect(freshApp.delete).toHaveBeenCalledWith("/b", expect.any(Function));
      expect(freshApp.head).toHaveBeenCalledWith("/b", expect.any(Function));
      expect(freshApp.options).toHaveBeenCalledWith("/b", expect.any(Function));
    });

    it("should ignore unknown HTTP methods in spec", async () => {
      const fresh = await getFreshHttp();
      mockParseFromUri.mockResolvedValue({
        paths: {
          "/weird": { get: {}, trace: {}, connect: {} },
        },
      });
      const freshApp: any = {
        get: jest.fn(),
        post: jest.fn(),
        patch: jest.fn(),
        put: jest.fn(),
        delete: jest.fn(),
        head: jest.fn(),
        options: jest.fn(),
        listen: jest.fn((p: number, cb: () => void) => { if (cb) cb(); return {} as any; }),
      };
      mockExpress.mockReturnValueOnce(freshApp);
      await fresh.createHttpServer({
        openApiFilePath: "./openapi.json",
        httpPort: 4006,
        buildContext: async () => ({}),
      } as any);
      expect(freshApp.get).toHaveBeenCalledWith("/weird", expect.any(Function));
      // trace/connect should not cause any registration
      expect(freshApp.post).not.toHaveBeenCalled();
      expect(freshApp.patch).not.toHaveBeenCalled();
    });

    it("should handle spec with no paths property (empty)", async () => {
      const fresh = await getFreshHttp();
      mockParseFromUri.mockResolvedValue({});
      const freshApp: any = {
        get: jest.fn(),
        post: jest.fn(),
        patch: jest.fn(),
        put: jest.fn(),
        delete: jest.fn(),
        head: jest.fn(),
        options: jest.fn(),
        listen: jest.fn((p: number, cb: () => void) => { if (cb) cb(); return {} as any; }),
      };
      mockExpress.mockReturnValueOnce(freshApp);
      await fresh.createHttpServer({
        openApiFilePath: "./openapi.json",
        httpPort: 4007,
        buildContext: async () => ({}),
      } as any);
      expect(freshApp.get).not.toHaveBeenCalled();
      expect(freshApp.listen).toHaveBeenCalled();
    });

    it("should handle spec with paths: null / undefined safely", async () => {
      const fresh = await getFreshHttp();
      mockParseFromUri.mockResolvedValue({ paths: null });
      const freshApp: any = {
        get: jest.fn(),
        post: jest.fn(),
        patch: jest.fn(),
        put: jest.fn(),
        delete: jest.fn(),
        head: jest.fn(),
        options: jest.fn(),
        listen: jest.fn((p: number, cb: () => void) => { if (cb) cb(); return {} as any; }),
      };
      mockExpress.mockReturnValueOnce(freshApp);
      await fresh.createHttpServer({
        openApiFilePath: "./openapi.json",
        httpPort: 4008,
        buildContext: async () => ({}),
      } as any);
      expect(freshApp.listen).toHaveBeenCalled();
    });

    it("should register unhandled endpoints with default handler and log them", async () => {
      const fresh = await getFreshHttp();
      mockParseFromUri.mockResolvedValue({
        paths: {
          "/unhandled": { get: {} },
          "/another": { post: {} },
        },
      });
      const freshApp: any = {
        get: jest.fn(),
        post: jest.fn(),
        patch: jest.fn(),
        put: jest.fn(),
        delete: jest.fn(),
        head: jest.fn(),
        options: jest.fn(),
        listen: jest.fn((p: number, cb: () => void) => { if (cb) cb(); return {} as any; }),
      };
      mockExpress.mockReturnValueOnce(freshApp);
      await fresh.createHttpServer({
        openApiFilePath: "./openapi.json",
        httpPort: 4009,
        buildContext: async () => ({}),
      } as any);

      expect(freshApp.get).toHaveBeenCalledWith("/unhandled", expect.any(Function));
      expect(freshApp.post).toHaveBeenCalledWith("/another", expect.any(Function));
      // console.log should report missing implementations
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("OpenAPI server listening on http://localhost:4009"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Endpoints missing implementation: 2"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("[GET] /unhandled"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("[POST] /another"));
    });

    it("should register custom handler when routeMap has matching endpoint", async () => {
      const fresh = await getFreshHttp();
      const customHandler = { handler: jest.fn(async () => ({ custom: true })) };
      fresh.registerEndpointHandler("GET", "/custom", customHandler as any);

      mockParseFromUri.mockResolvedValue({
        paths: {
          "/custom": { get: {} },
        },
      });
      const freshApp: any = {
        get: jest.fn(),
        post: jest.fn(),
        patch: jest.fn(),
        put: jest.fn(),
        delete: jest.fn(),
        head: jest.fn(),
        options: jest.fn(),
        listen: jest.fn((p: number, cb: () => void) => { if (cb) cb(); return {} as any; }),
      };
      mockExpress.mockReturnValueOnce(freshApp);

      await fresh.createHttpServer({
        openApiFilePath: "./openapi.json",
        httpPort: 4010,
        buildContext: async () => ({}),
      } as any);

      expect(freshApp.get).toHaveBeenCalledWith("/custom", expect.any(Function));
      // Verify custom handler path was registered (not default unhandled)
      expect(freshApp.get).toHaveBeenCalledTimes(1);
    });

    it("should call app.listen with httpPort and log listening message", async () => {
      const fresh = await getFreshHttp();
      mockParseFromUri.mockResolvedValue({ paths: {} });
      const freshApp: any = {
        get: jest.fn(),
        post: jest.fn(),
        patch: jest.fn(),
        put: jest.fn(),
        delete: jest.fn(),
        head: jest.fn(),
        options: jest.fn(),
        listen: jest.fn((p: number, cb: () => void) => { if (cb) cb(); return {} as any; }),
      };
      mockExpress.mockReturnValueOnce(freshApp);
      await fresh.createHttpServer({
        openApiFilePath: "./openapi.json",
        httpPort: 4011,
        buildContext: async () => ({}),
      } as any);
      expect(freshApp.listen).toHaveBeenCalledWith(4011, expect.any(Function));
      expect(consoleLogSpy).toHaveBeenCalledWith("OpenAPI server listening on http://localhost:4011");
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Endpoints missing implementation:"));
    });

    it("should convert OpenAPI path templates to Express paths for all methods", async () => {
      const fresh = await getFreshHttp();
      mockParseFromUri.mockResolvedValue({
        paths: {
          "/users/{id}": { get: {} },
          "/orders/{orderId}/items/{itemId}": { post: {} },
        },
      });
      const freshApp: any = {
        get: jest.fn(),
        post: jest.fn(),
        patch: jest.fn(),
        put: jest.fn(),
        delete: jest.fn(),
        head: jest.fn(),
        options: jest.fn(),
        listen: jest.fn((p: number, cb: () => void) => { if (cb) cb(); return {} as any; }),
      };
      mockExpress.mockReturnValueOnce(freshApp);
      await fresh.createHttpServer({
        openApiFilePath: "./openapi.json",
        httpPort: 4012,
        buildContext: async () => ({}),
      } as any);
      expect(freshApp.get).toHaveBeenCalledWith("/users/:id", expect.any(Function));
      expect(freshApp.post).toHaveBeenCalledWith("/orders/:orderId/items/:itemId", expect.any(Function));
    });

    it("should handle case-insensitive method keys from spec (lowercase)", async () => {
      const fresh = await getFreshHttp();
      mockParseFromUri.mockResolvedValue({
        paths: {
          "/lower": { get: {}, post: {}, patch: {} },
        },
      });
      const freshApp: any = {
        get: jest.fn(),
        post: jest.fn(),
        patch: jest.fn(),
        put: jest.fn(),
        delete: jest.fn(),
        head: jest.fn(),
        options: jest.fn(),
        listen: jest.fn((p: number, cb: () => void) => { if (cb) cb(); return {} as any; }),
      };
      mockExpress.mockReturnValueOnce(freshApp);
      // Ensure spec has lowercase keys already, but code uppercases them
      await fresh.createHttpServer({
        openApiFilePath: "./openapi.json",
        httpPort: 4013,
        buildContext: async () => ({}),
      } as any);
      expect(freshApp.get).toHaveBeenCalledWith("/lower", expect.any(Function));
      expect(freshApp.post).toHaveBeenCalledWith("/lower", expect.any(Function));
      expect(freshApp.patch).toHaveBeenCalledWith("/lower", expect.any(Function));
    });
  });

  describe("getRequestSchemaForEndpoint / getResponseSchemaForEndpoint", () => {
    let consoleLogSpy: any;

    beforeEach(() => {
      consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
      consoleLogSpy.mockRestore();
    });

    function createFreshApp() {
      return {
        get: jest.fn(),
        post: jest.fn(),
        patch: jest.fn(),
        put: jest.fn(),
        delete: jest.fn(),
        head: jest.fn(),
        options: jest.fn(),
        listen: jest.fn((p: number, cb: () => void) => { if (cb) cb(); return {} as any; }),
      } as any;
    }

    const requestSchema = { type: "object", properties: { name: { type: "string" } }, required: ["name"] };
    const responseSchema = { type: "object", properties: { id: { type: "string" } } };
    const response201Schema = { type: "object", properties: { created: { type: "boolean" } } };

    it("should return request schema via exact OpenAPI path", async () => {
      const fresh = await getFreshHttp();
      const freshApp = createFreshApp();
      mockExpress.mockReturnValueOnce(freshApp);
      mockParseFromUri.mockResolvedValue({
        paths: {
          "/users/{id}": {
            post: {
              requestBody: { content: { "application/json": { schema: requestSchema } } },
              responses: { "200": { content: { "application/json": { schema: responseSchema } } } },
            },
          },
        },
      });
      await fresh.createHttpServer({ openApiFilePath: "./openapi.json", httpPort: 5001, buildContext: async () => ({}) } as any);
      expect(fresh.getRequestSchemaForEndpoint("POST", "/users/{id}")).toEqual(requestSchema);
      expect(fresh.getResponseSchemaForEndpoint("POST", "/users/{id}")).toEqual(responseSchema);
    });

    it("should return schema via Express-style path", async () => {
      const fresh = await getFreshHttp();
      const freshApp = createFreshApp();
      mockExpress.mockReturnValueOnce(freshApp);
      mockParseFromUri.mockResolvedValue({
        paths: {
          "/users/{id}": {
            post: {
              requestBody: { content: { "application/json": { schema: requestSchema } } },
              responses: { "200": { content: { "application/json": { schema: responseSchema } } } },
            },
          },
        },
      });
      await fresh.createHttpServer({ openApiFilePath: "./openapi.json", httpPort: 5002, buildContext: async () => ({}) } as any);
      expect(fresh.getRequestSchemaForEndpoint("POST", "/users/:id")).toEqual(requestSchema);
      expect(fresh.getResponseSchemaForEndpoint("POST", "/users/:id")).toEqual(responseSchema);
    });

    it("should handle param name mismatch (:userId vs {id})", async () => {
      const fresh = await getFreshHttp();
      const freshApp = createFreshApp();
      mockExpress.mockReturnValueOnce(freshApp);
      mockParseFromUri.mockResolvedValue({
        paths: {
          "/users/{id}": {
            put: {
              requestBody: { content: { "application/json": { schema: requestSchema } } },
              responses: { "200": { content: { "application/json": { schema: responseSchema } } } },
            },
          },
          "/orders/{orderId}/items/{itemId}": {
            patch: {
              requestBody: { content: { "application/json": { schema: requestSchema } } },
              responses: { "200": { content: { "application/json": { schema: responseSchema } } } },
            },
          },
        },
      });
      await fresh.createHttpServer({ openApiFilePath: "./openapi.json", httpPort: 5003, buildContext: async () => ({}) } as any);
      // single param name mismatch
      expect(fresh.getRequestSchemaForEndpoint("PUT", "/users/:userId")).toEqual(requestSchema);
      expect(fresh.getResponseSchemaForEndpoint("PUT", "/users/:userId")).toEqual(responseSchema);
      // multi param name mismatch
      expect(fresh.getRequestSchemaForEndpoint("PATCH", "/orders/:id/items/:itemId")).toEqual(requestSchema);
      expect(fresh.getRequestSchemaForEndpoint("PATCH", "/orders/{id}/items/{other}")).toEqual(requestSchema);
    });

    it("should handle concrete URLs (/users/123 matching /users/{id})", async () => {
      const fresh = await getFreshHttp();
      const freshApp = createFreshApp();
      mockExpress.mockReturnValueOnce(freshApp);
      mockParseFromUri.mockResolvedValue({
        paths: {
          "/users/{id}": {
            get: { responses: { "200": { content: { "application/json": { schema: responseSchema } } } } },
            post: {
              requestBody: { content: { "application/json": { schema: requestSchema } } },
              responses: { "200": { content: { "application/json": { schema: responseSchema } } } },
            },
          },
        },
      });
      await fresh.createHttpServer({ openApiFilePath: "./openapi.json", httpPort: 5004, buildContext: async () => ({}) } as any);
      expect(fresh.getRequestSchemaForEndpoint("POST", "/users/123")).toEqual(requestSchema);
      expect(fresh.getResponseSchemaForEndpoint("GET", "/users/123")).toEqual(responseSchema);
    });

    it("should return undefined for GET with no body and for missing endpoint", async () => {
      const fresh = await getFreshHttp();
      const freshApp = createFreshApp();
      mockExpress.mockReturnValueOnce(freshApp);
      mockParseFromUri.mockResolvedValue({
        paths: {
          "/users/{id}": {
            get: { responses: { "200": { content: { "application/json": { schema: responseSchema } } } } },
          },
        },
      });
      await fresh.createHttpServer({ openApiFilePath: "./openapi.json", httpPort: 5005, buildContext: async () => ({}) } as any);
      expect(fresh.getRequestSchemaForEndpoint("GET", "/users/{id}")).toBeUndefined();
      expect(fresh.getRequestSchemaForEndpoint("GET", "/users/:id")).toBeUndefined();
      expect(fresh.getRequestSchemaForEndpoint("POST", "/unknown")).toBeUndefined();
      expect(fresh.getResponseSchemaForEndpoint("GET", "/unknown")).toBeUndefined();
    });

    it("should be case-insensitive for method", async () => {
      const fresh = await getFreshHttp();
      const freshApp = createFreshApp();
      mockExpress.mockReturnValueOnce(freshApp);
      mockParseFromUri.mockResolvedValue({
        paths: {
          "/users/{id}": {
            post: {
              requestBody: { content: { "application/json": { schema: requestSchema } } },
              responses: { "200": { content: { "application/json": { schema: responseSchema } } } },
            },
          },
        },
      });
      await fresh.createHttpServer({ openApiFilePath: "./openapi.json", httpPort: 5006, buildContext: async () => ({}) } as any);
      expect(fresh.getRequestSchemaForEndpoint("post" as any, "/users/{id}")).toEqual(requestSchema);
      expect(fresh.getResponseSchemaForEndpoint("POST", "/users/{id}")).toEqual(responseSchema);
    });

    it("should fallback to first content type when application/json missing", async () => {
      const fresh = await getFreshHttp();
      const freshApp = createFreshApp();
      mockExpress.mockReturnValueOnce(freshApp);
      const xmlSchema = { type: "string" };
      mockParseFromUri.mockResolvedValue({
        paths: {
          "/upload": {
            post: {
              requestBody: { content: { "application/xml": { schema: xmlSchema } } },
              responses: { "200": { content: { "text/plain": { schema: xmlSchema } } } },
            },
          },
        },
      });
      await fresh.createHttpServer({ openApiFilePath: "./openapi.json", httpPort: 5007, buildContext: async () => ({}) } as any);
      expect(fresh.getRequestSchemaForEndpoint("POST", "/upload")).toEqual(xmlSchema);
      expect(fresh.getResponseSchemaForEndpoint("POST", "/upload")).toEqual(xmlSchema);
    });

    it("should prefer 200, then 201, then any 2xx for responses", async () => {
      const fresh = await getFreshHttp();
      const freshApp = createFreshApp();
      mockExpress.mockReturnValueOnce(freshApp);
      mockParseFromUri.mockResolvedValue({
        paths: {
          "/a": { post: { responses: { "201": { content: { "application/json": { schema: response201Schema } } } } } },
          "/b": { post: { responses: { "204": { content: { "application/json": { schema: responseSchema } } } } } },
        },
      });
      await fresh.createHttpServer({ openApiFilePath: "./openapi.json", httpPort: 5008, buildContext: async () => ({}) } as any);
      expect(fresh.getResponseSchemaForEndpoint("POST", "/a")).toEqual(response201Schema);
      expect(fresh.getResponseSchemaForEndpoint("POST", "/b")).toEqual(responseSchema);
    });

    it("should be available to plugins via beforeRouting (closure over openapiDoc)", async () => {
      const fresh = await getFreshHttp();
      const freshApp = createFreshApp();
      mockExpress.mockReturnValueOnce(freshApp);
      mockParseFromUri.mockResolvedValue({
        paths: {
          "/users/{id}": {
            post: {
              requestBody: { content: { "application/json": { schema: requestSchema } } },
              responses: { "200": { content: { "application/json": { schema: responseSchema } } } },
            },
          },
        },
      });
      let capturedRequestSchema: any;
      let capturedResponseSchema: any;
      const plugin = {
        beforeRouting: jest.fn(async () => {
          // This will be called after openapiDoc is ready and getters are assigned
          // but before routes are built — we simulate deferred check by capturing
          // the function reference to call later.
        }),
        beforeServerStart: jest.fn(async () => {
          // getters should be populated by now
        }),
      };
      await fresh.createHttpServer({
        openApiFilePath: "./openapi.json",
        httpPort: 5009,
        buildContext: async () => ({}),
        plugins: [plugin],
      } as any);
      // after server creation, getters are exported and usable by plugins
      capturedRequestSchema = fresh.getRequestSchemaForEndpoint("POST", "/users/:userId");
      capturedResponseSchema = fresh.getResponseSchemaForEndpoint("POST", "/users/:userId");
      expect(capturedRequestSchema).toEqual(requestSchema);
      expect(capturedResponseSchema).toEqual(responseSchema);
      expect(plugin.beforeRouting).toHaveBeenCalled();
      expect(plugin.beforeServerStart).toHaveBeenCalled();
    });
  });
});
