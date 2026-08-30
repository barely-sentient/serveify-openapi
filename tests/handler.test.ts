import { jest } from "@jest/globals";
import { defaultHandler, useDefaultHandler, executeHandler, Endpoint } from "../src/handler.js";
import { CreateServerConfig } from "../src/types/create-server-config.js";
import { Request, Response } from "express";

describe("handler", () => {
  const mockRequest = (overrides: Partial<Request> = {}) =>
    ({ params: {}, headers: {}, ...overrides } as unknown as Request);

  const mockResponse = () => {
    const res = {
      statusCode: undefined as unknown as number,
      headers: {} as Record<string, string>,
      body: undefined as unknown as string,
      setHeader: jest.fn(function (this: any, key: string, value: string) {
        this.headers[key] = value;
      }),
      end: jest.fn(function (this: any, body: string) {
        this.body = body;
      }),
    } as unknown as Response & { headers: Record<string, string>; body: string };
    return res;
  };

  const createConfig = (overrides: Partial<CreateServerConfig> = {}): CreateServerConfig => ({
    openApiFilePath: "./openapi.json",
    httpPort: 3000,
    buildContext: jest.fn(async () => ({ userId: "test-ctx" })),
    ...overrides,
  });

  describe("defaultHandler", () => {
    it("should throw error with message 'This endpoint has not been implemented'", async () => {
      expect(() => defaultHandler({} as Request, {})).toThrow("This endpoint has not been implemented");
    });

    it("should throw error with status_code 500", async () => {
      try {
        defaultHandler({} as Request, {});
        throw new Error("should have thrown");
      } catch (e: any) {
        expect(e.status_code).toBe(500);
        expect(e.message).toBe("This endpoint has not been implemented");
      }
    });

    it("should be an async-compatible throw (works with await)", async () => {
      await expect(Promise.resolve().then(() => defaultHandler({} as Request, {}))).rejects.toThrow(
        "This endpoint has not been implemented",
      );
    });
  });

  describe("useDefaultHandler", () => {
    it("should return object with handler equal to defaultHandler", () => {
      const result = useDefaultHandler();
      expect(result).toEqual({ handler: defaultHandler });
      expect(result.handler).toBe(defaultHandler);
    });

    it("should return a new object on each call", () => {
      expect(useDefaultHandler()).not.toBe(useDefaultHandler());
    });
  });

  describe("executeHandler", () => {
    it("should call buildContext with request", async () => {
      const req = mockRequest();
      const res = mockResponse();
      const buildContext = jest.fn(async () => ({ ctx: 1 }));
      const handler = jest.fn(async () => ({ ok: true }));
      const config = createConfig({ buildContext });
      const endpoint: Endpoint = { handler: handler as any };

      await executeHandler(endpoint, config)(req, res);

      expect(buildContext).toHaveBeenCalledWith(req);
      expect(buildContext).toHaveBeenCalledTimes(1);
    });

    it("should call endpoint handler with request and session context", async () => {
      const req = mockRequest({ url: "/test" } as any);
      const res = mockResponse();
      const session = { id: "session-123" };
      const handler = jest.fn(async (r: Request, s: unknown) => ({ hello: "world" }));
      const config = createConfig({ buildContext: jest.fn(async () => session) });
      const endpoint: Endpoint = { handler: handler as any };

      await executeHandler(endpoint, config)(req, res);

      expect(handler).toHaveBeenCalledWith(req, session);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("should set statusCode 200 and return handler result as JSON on success", async () => {
      const req = mockRequest();
      const res = mockResponse();
      const result = { data: "value", count: 42 };
      const config = createConfig();
      const endpoint: Endpoint = { handler: jest.fn(async () => result) as any };

      await executeHandler(endpoint, config)(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "application/json");
      expect(res.end).toHaveBeenCalledWith(JSON.stringify(result));
      expect((res as any).body).toBe(JSON.stringify(result));
    });

    it("should handle handler returning null/undefined/primitive values", async () => {
      const req = mockRequest();
      for (const value of [null, undefined, 0, "", 42, "string"]) {
        const res = mockResponse();
        const config = createConfig();
        const endpoint: Endpoint = { handler: jest.fn(async () => value) as any };
        await executeHandler(endpoint, config)(req, res);
        expect(res.statusCode).toBe(200);
        expect(res.end).toHaveBeenCalledWith(JSON.stringify(value));
      }
    });

    it("should execute preRequest plugins before handler", async () => {
      const req = mockRequest();
      const res = mockResponse();
      const session = { user: "alice" };
      const order: string[] = [];
      const pre1 = jest.fn(async (r: Request, ctx: unknown) => { order.push("pre1"); });
      const pre2 = jest.fn(async (r: Request, ctx: unknown) => { order.push("pre2"); });
      const handler = jest.fn(async () => { order.push("handler"); return { ok: true }; });
      const config = createConfig({
        buildContext: jest.fn(async () => session),
        plugins: [{ preRequest: pre1 }, { preRequest: pre2 }],
      });

      await executeHandler({ handler: handler as any }, config)(req, res);

      expect(pre1).toHaveBeenCalledWith(req, session);
      expect(pre2).toHaveBeenCalledWith(req, session);
      expect(handler).toHaveBeenCalled();
      // handler should be after preRequests (Promise.all means both pres start before handler, but handler awaits them)
      expect(order.indexOf("handler")).toBeGreaterThan(order.indexOf("pre1"));
      expect(order.indexOf("handler")).toBeGreaterThan(order.indexOf("pre2"));
    });

    it("should handle config with no plugins (plugins undefined)", async () => {
      const req = mockRequest();
      const res = mockResponse();
      const config = createConfig({ plugins: undefined });
      const endpoint: Endpoint = { handler: jest.fn(async () => ({ ok: 1 })) as any };
      await executeHandler(endpoint, config)(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.end).toHaveBeenCalledWith(JSON.stringify({ ok: 1 }));
    });

    it("should handle config with empty plugins array", async () => {
      const req = mockRequest();
      const res = mockResponse();
      const config = createConfig({ plugins: [] });
      const endpoint: Endpoint = { handler: jest.fn(async () => "empty") as any };
      await executeHandler(endpoint, config)(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.end).toHaveBeenCalledWith(JSON.stringify("empty"));
    });

    it("should skip plugins without preRequest hook", async () => {
      const req = mockRequest();
      const res = mockResponse();
      const config = createConfig({ plugins: [{}, { postRequest: jest.fn(async () => "x") }] as any });
      const endpoint: Endpoint = { handler: jest.fn(async () => ({ a: 1 })) as any };
      await executeHandler(endpoint, config)(req, res);
      expect(res.statusCode).toBe(200);
    });

    it("should catch preRequest errors and return failed response with status_code", async () => {
      const req = mockRequest();
      const res = mockResponse();
      const preError = Object.assign(new Error("Unauthorized"), { status_code: 401 });
      const config = createConfig({
        plugins: [{ preRequest: jest.fn(async () => { throw preError; }) }],
      });
      const handler = jest.fn(async () => ({ should: "not be called" }));
      const endpoint: Endpoint = { handler: handler as any };

      await executeHandler(endpoint, config)(req, res);

      expect(handler).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(401);
      expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "application/json");
      expect(res.end).toHaveBeenCalledWith(JSON.stringify({ status: "failed", message: "Unauthorized" }));
    });

    it("should catch preRequest errors without status_code and not set custom status", async () => {
      const req = mockRequest();
      const res = mockResponse();
      // ensure initial statusCode undefined
      expect(res.statusCode).toBeUndefined();
      const config = createConfig({
        plugins: [{ preRequest: jest.fn(async () => { throw new Error("generic fail"); }) }],
      });
      const endpoint: Endpoint = { handler: jest.fn(async () => ({})) as any };
      await executeHandler(endpoint, config)(req, res);
      // current implementation leaves statusCode as undefined if error has no status_code (not defaulting to 500)
      expect(res.statusCode).toBeUndefined();
      expect(JSON.parse((res as any).body)).toEqual({ status: "failed", message: "generic fail" });
    });

    it("should catch handler errors and map status_code to response status", async () => {
      const req = mockRequest();
      const res = mockResponse();
      const err = Object.assign(new Error("Not found resource"), { status_code: 404 });
      const config = createConfig();
      const endpoint: Endpoint = { handler: jest.fn(async () => { throw err; }) as any };

      await executeHandler(endpoint, config)(req, res);

      expect(res.statusCode).toBe(404);
      expect(res.end).toHaveBeenCalledWith(JSON.stringify({ status: "failed", message: "Not found resource" }));
    });

    it("should catch handler errors without status_code and produce failed JSON", async () => {
      const req = mockRequest();
      const res = mockResponse();
      const config = createConfig();
      const endpoint: Endpoint = { handler: jest.fn(async () => { throw new Error("boom"); }) as any };

      await executeHandler(endpoint, config)(req, res);

      expect(res.statusCode).toBeUndefined();
      expect(res.end).toHaveBeenCalledWith(JSON.stringify({ status: "failed", message: "boom" }));
    });

    it("should handle thrown non-Error values (string, object) with message fallback", async () => {
      const req = mockRequest();
      const res = mockResponse();
      const config = createConfig();
      const endpoint: Endpoint = { handler: jest.fn(async () => { throw "string error"; }) as any };

      await executeHandler(endpoint, config)(req, res);

      // (error as Error).message is undefined for string, so message falls back to error itself ?? error
      // code: message: (error as Error).message ?? error => for string, undefined ?? "string error" => "string error"
      expect(JSON.parse((res as any).body)).toEqual({ status: "failed", message: "string error" });
    });

    it("should execute postRequest plugins after handler and allow transformation when truthy", async () => {
      const req = mockRequest();
      const res = mockResponse();
      const session = { role: "admin" };
      const handlerResult = { original: true };
      const transformed = { transformed: true };
      const post = jest.fn(async (r: Request, ctx: unknown, result: unknown) => {
        expect(result).toEqual(handlerResult);
        expect(ctx).toBe(session);
        return transformed;
      });
      const config = createConfig({
        buildContext: jest.fn(async () => session),
        plugins: [{ postRequest: post }],
      });
      const endpoint: Endpoint = { handler: jest.fn(async () => handlerResult) as any };

      await executeHandler(endpoint, config)(req, res);

      expect(post).toHaveBeenCalledWith(req, session, handlerResult);
      expect(res.end).toHaveBeenCalledWith(JSON.stringify(transformed));
      expect(res.statusCode).toBe(200);
    });

    it("should NOT replace result when postRequest returns falsy values", async () => {
      const req = mockRequest();
      const original = { keep: "me" };
      for (const falsy of [undefined, null, "", 0, false]) {
        const res = mockResponse();
        const post = jest.fn(async () => falsy);
        const config = createConfig({ plugins: [{ postRequest: post }] as any });
        const endpoint: Endpoint = { handler: jest.fn(async () => original) as any };
        await executeHandler(endpoint, config)(req, res);
        expect(res.end).toHaveBeenCalledWith(JSON.stringify(original));
      }
    });

    it("should call all postRequest plugins (parallel) each receiving original handler result", async () => {
      const req = mockRequest();
      const res = mockResponse();
      const session = {};
      const handlerResult = { id: 1 };
      const post1 = jest.fn(async (r: Request, c: unknown, result: unknown) => {
        expect(result).toEqual(handlerResult);
        return { from: "post1" };
      });
      const post2 = jest.fn(async (r: Request, c: unknown, result: unknown) => {
        expect(result).toEqual(handlerResult);
        return { from: "post2" };
      });
      const config = createConfig({
        buildContext: jest.fn(async () => session),
        plugins: [{ postRequest: post1 }, { postRequest: post2 }],
      });
      const endpoint: Endpoint = { handler: jest.fn(async () => handlerResult) as any };
      await executeHandler(endpoint, config)(req, res);
      expect(post1).toHaveBeenCalled();
      expect(post2).toHaveBeenCalled();
      // result will be one of the transformed values (race due to Promise.all); just verify it's one of them
      const body = JSON.parse((res as any).body);
      expect([{ from: "post1" }, { from: "post2" }]).toContainEqual(body);
    });

    it("should catch errors thrown by postRequest and return failed response", async () => {
      const req = mockRequest();
      const res = mockResponse();
      const postError = Object.assign(new Error("post failed"), { status_code: 502 });
      const config = createConfig({
        plugins: [{ postRequest: jest.fn(async () => { throw postError; }) }],
      });
      const endpoint: Endpoint = { handler: jest.fn(async () => ({ ok: true })) as any };
      await executeHandler(endpoint, config)(req, res);
      expect(res.statusCode).toBe(502);
      expect(JSON.parse((res as any).body)).toEqual({ status: "failed", message: "post failed" });
    });

    it("should catch buildContext errors and return failed response", async () => {
      const req = mockRequest();
      const res = mockResponse();
      const err = Object.assign(new Error("ctx fail"), { status_code: 500 });
      const config = createConfig({ buildContext: jest.fn(async () => { throw err; }) });
      const endpoint: Endpoint = { handler: jest.fn(async () => ({ never: true })) as any };
      await executeHandler(endpoint, config)(req, res);
      expect(res.statusCode).toBe(500);
      expect(JSON.parse((res as any).body)).toEqual({ status: "failed", message: "ctx fail" });
    });

    it("should always set Content-Type header even on error", async () => {
      const req = mockRequest();
      const res = mockResponse();
      const config = createConfig();
      const endpoint: Endpoint = { handler: jest.fn(async () => { throw new Error("fail"); }) as any };
      await executeHandler(endpoint, config)(req, res);
      expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "application/json");
    });

    it("should handle plugins that have both pre and post hooks", async () => {
      const req = mockRequest();
      const res = mockResponse();
      const session = { x: 1 };
      const pre = jest.fn(async () => {});
      const post = jest.fn(async (r: Request, c: unknown, result: unknown) => ({ wrapped: result }));
      const config = createConfig({
        buildContext: jest.fn(async () => session),
        plugins: [{ preRequest: pre, postRequest: post }],
      });
      const endpoint: Endpoint = { handler: jest.fn(async () => ({ data: 123 })) as any };
      await executeHandler(endpoint, config)(req, res);
      expect(pre).toHaveBeenCalledWith(req, session);
      expect(post).toHaveBeenCalled();
      expect(JSON.parse((res as any).body)).toEqual({ wrapped: { data: 123 } });
    });
  });
});
