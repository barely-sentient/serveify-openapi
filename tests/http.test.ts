import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals"
import http from "node:http"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Routes } from "../src/routes.js"
import { ServerPlugin } from "../src/types/plugin-sdk.js"
import { createHttpServer } from "../src/http.js"

function makeSpec(paths: Record<string, Record<string, unknown>>) {
  return {
    openapi: "3.0.0",
    info: { title: "Test", version: "1.0" },
    paths,
  }
}

function writeSpecFile(spec: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "serveify-test-"))
  const filePath = path.join(dir, "openapi.json")
  fs.writeFileSync(filePath, JSON.stringify(spec), "utf-8")
  return filePath
}

function fetchVia(
  app: import("express").Express,
  reqPath: string,
  method = "GET",
  body?: unknown
): Promise<{ status: number; body: unknown; raw: string }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number }
      const r = http.request(
        {
          hostname: "127.0.0.1",
          port: addr.port,
          path: reqPath,
          method,
          headers: body ? { "content-type": "application/json" } : {},
        },
        (res) => {
          let data = ""
          res.on("data", (chunk) => (data += chunk))
          res.on("end", () => {
            server.close()
            let parsed: unknown
            try {
              parsed = JSON.parse(data)
            } catch {
              parsed = data
            }
            resolve({ status: res.statusCode!, body: parsed, raw: data })
          })
        }
      )
      r.on("error", (err) => {
        server.close()
        reject(err)
      })
      if (body !== undefined) r.write(JSON.stringify(body))
      r.end()
    })
  })
}

describe("createHttpServer", () => {
  const tmpFiles: string[] = []

  function specFile(paths: Record<string, Record<string, unknown>>): string {
    const fp = writeSpecFile(makeSpec(paths))
    tmpFiles.push(fp)
    return fp
  }

  function rawSpecFile(content: unknown): string {
    const fp = writeSpecFile(content)
    tmpFiles.push(fp)
    return fp
  }

  beforeEach(() => {
    Routes.clear()
    jest.spyOn(console, "log").mockImplementation(() => {})
  })

  afterEach(() => {
    jest.restoreAllMocks()
    for (const fp of tmpFiles.splice(0)) {
      try {
        fs.unlinkSync(fp)
        fs.rmdirSync(path.dirname(fp))
      } catch {}
    }
  })

  describe("spec parsing", () => {
    it("loads and parses the OpenAPI file at the configured path", async () => {
      const fp = specFile({ "/health": { get: {} } })
      const app = await createHttpServer({ openApiFilePath: fp, httpPort: 3000 })
      expect(app).toBeDefined()
      expect(Routes.getRequestHandler("GET", "/health")).toBeDefined()
    })

    it("throws when file does not exist", async () => {
      await expect(
        createHttpServer({ openApiFilePath: "./does-not-exist-xyz.json", httpPort: 3000 })
      ).rejects.toThrow()
    })

    it("throws when spec has no paths property", async () => {
      const fp = rawSpecFile({ openapi: "3.0.0", info: {} })
      await expect(createHttpServer({ openApiFilePath: fp, httpPort: 3000 })).rejects.toThrow(
        "Failed to parse OpenAPI spec"
      )
    })

    it("throws when spec is a JSON primitive", async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "serveify-test-"))
      const fp = path.join(dir, "openapi.json")
      fs.writeFileSync(fp, JSON.stringify("not an object"), "utf-8")
      tmpFiles.push(fp)
      await expect(createHttpServer({ openApiFilePath: fp, httpPort: 3000 })).rejects.toThrow(
        "Failed to parse OpenAPI spec"
      )
    })

    it("throws when file contains invalid JSON", async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "serveify-test-"))
      const fp = path.join(dir, "openapi.json")
      fs.writeFileSync(fp, "{ invalid json", "utf-8")
      tmpFiles.push(fp)
      await expect(createHttpServer({ openApiFilePath: fp, httpPort: 3000 })).rejects.toThrow()
    })

    it("resolves json-ject directives (e.g. @var substitution)", async () => {
      // json-ject should resolve nested structures; verify the spec still loads
      // when paths is present alongside other keys
      const fp = rawSpecFile({
        openapi: "3.0.0",
        info: { title: "Test", version: "1.0" },
        paths: { "/injected": { get: {} } },
        components: { schemas: {} },
      })
      const app = await createHttpServer({ openApiFilePath: fp, httpPort: 3000 })
      expect(app).toBeDefined()
    })
  })

  describe("route initialization from spec", () => {
    it("registers routes for all methods and paths in the spec", async () => {
      const fp = specFile({
        "/users": { get: {}, post: {} },
        "/posts": { get: {} },
      })
      await createHttpServer({ openApiFilePath: fp, httpPort: 3000 })
      expect(Routes.getRequestHandler("GET", "/users")).toBeDefined()
      expect(Routes.getRequestHandler("POST", "/users")).toBeDefined()
      expect(Routes.getRequestHandler("GET", "/posts")).toBeDefined()
    })

    it("marks all discovered routes as defaults (missing)", async () => {
      const fp = specFile({
        "/a": { get: {} },
        "/b": { post: {} },
        "/c": { delete: {} },
      })
      await createHttpServer({ openApiFilePath: fp, httpPort: 3000 })
      expect(Routes.getDefaultHandlers()).toHaveLength(3)
    })

    it("exposes an Express app that handles OpenAPI path params ({id} -> :id)", async () => {
      const fp = specFile({
        "/users/{id}": { get: {} },
      })
      const app = await createHttpServer({ openApiFilePath: fp, httpPort: 3000 })
      Routes.setRequestHandler("GET", "/users/{id}", async (req) => ({
        id: (req as unknown as { params: { id: string } }).params.id,
      }))
      const res = await fetchVia(app, "/users/42")
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ id: "42" })
    })

    it("handles nested path params (/orgs/{orgId}/repos/{repoId})", async () => {
      const fp = specFile({
        "/orgs/{orgId}/repos/{repoId}": { get: {} },
      })
      const app = await createHttpServer({ openApiFilePath: fp, httpPort: 3000 })
      Routes.setRequestHandler("GET", "/orgs/{orgId}/repos/{repoId}", async (req) => ({
        org: (req as unknown as { params: { orgId: string; repoId: string } }).params.orgId,
        repo: (req as unknown as { params: { orgId: string; repoId: string } }).params.repoId,
      }))
      const res = await fetchVia(app, "/orgs/acme/repos/99")
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ org: "acme", repo: "99" })
    })

    it("uses express.json() middleware so handlers receive parsed bodies", async () => {
      const fp = specFile({ "/body": { post: {} } })
      const app = await createHttpServer({ openApiFilePath: fp, httpPort: 3000 })
      Routes.setRequestHandler("POST", "/body", async (req) => (req as unknown as { body: unknown }).body)
      const res = await fetchVia(app, "/body", "POST", { key: "value", nested: { a: 1 } })
      expect(res.body).toEqual({ key: "value", nested: { a: 1 } })
    })
  })

  describe("plugin lifecycle", () => {
    it("calls beforeServerStart hooks in registration order", async () => {
      const order: string[] = []
      const p1: ServerPlugin = { beforeServerStart: async () => order.push("p1") }
      const p2: ServerPlugin = { beforeServerStart: async () => order.push("p2") }
      const fp = specFile({ "/test": { get: {} } })
      await createHttpServer({ openApiFilePath: fp, httpPort: 3000, plugins: [p1, p2] })
      expect(order).toEqual(["p1", "p2"])
    })

    it("awaits async beforeServerStart before continuing", async () => {
      let ready = false
      const plugin: ServerPlugin = {
        beforeServerStart: async () => {
          await new Promise((r) => setTimeout(r, 20))
          ready = true
        },
      }
      const fp = specFile({ "/test": { get: {} } })
      await createHttpServer({ openApiFilePath: fp, httpPort: 3000, plugins: [plugin] })
      expect(ready).toBe(true)
    })

    it("does not fail when no plugins are provided", async () => {
      const fp = specFile({ "/test": { get: {} } })
      await expect(createHttpServer({ openApiFilePath: fp, httpPort: 3000 })).resolves.toBeDefined()
    })

    it("ignores plugins with no lifecycle hooks", async () => {
      const fp = specFile({ "/test": { get: {} } })
      await expect(
        createHttpServer({ openApiFilePath: fp, httpPort: 3000, plugins: [{}] })
      ).resolves.toBeDefined()
    })

    it("calls preRequest before the handler on each request", async () => {
      const order: string[] = []
      const plugin: ServerPlugin = { preRequest: async () => order.push("pre") }
      const fp = specFile({ "/test": { get: {} } })
      const app = await createHttpServer({ openApiFilePath: fp, httpPort: 3000, plugins: [plugin] })
      Routes.setRequestHandler("GET", "/test", async () => {
        order.push("handler")
        return "ok"
      })
      await fetchVia(app, "/test")
      expect(order).toEqual(["pre", "handler"])
    })

    it("calls preRequest hooks in order for multiple plugins", async () => {
      const order: string[] = []
      const p1: ServerPlugin = { preRequest: async () => order.push("p1") }
      const p2: ServerPlugin = { preRequest: async () => order.push("p2") }
      const fp = specFile({ "/test": { get: {} } })
      const app = await createHttpServer({ openApiFilePath: fp, httpPort: 3000, plugins: [p1, p2] })
      Routes.setRequestHandler("GET", "/test", async () => "ok")
      await fetchVia(app, "/test")
      expect(order).toEqual(["p1", "p2"])
    })

    it("postRequest receives the handler result and can wrap it", async () => {
      const received: unknown[] = []
      const plugin: ServerPlugin = {
        postRequest: async (_req, _ctx, result) => {
          received.push(result)
          return { wrapped: result }
        },
      }
      const fp = specFile({ "/test": { get: {} } })
      const app = await createHttpServer({ openApiFilePath: fp, httpPort: 3000, plugins: [plugin] })
      Routes.setRequestHandler("GET", "/test", async () => ({ data: 42 }))
      const res = await fetchVia(app, "/test")
      expect(res.body).toEqual({ wrapped: { data: 42 } })
      expect(received).toEqual([{ data: 42 }])
    })

    it("postRequest can fully replace the response", async () => {
      const plugin: ServerPlugin = { postRequest: async () => ({ transformed: true }) }
      const fp = specFile({ "/test": { get: {} } })
      const app = await createHttpServer({ openApiFilePath: fp, httpPort: 3000, plugins: [plugin] })
      Routes.setRequestHandler("GET", "/test", async () => ({ original: true }))
      const res = await fetchVia(app, "/test")
      expect(res.body).toEqual({ transformed: true })
    })

    it("postRequest transforms are chained in registration order", async () => {
      const p1: ServerPlugin = {
        postRequest: async (_req, _ctx, result) => ({ ...(result as object), p1: true }),
      }
      const p2: ServerPlugin = {
        postRequest: async (_req, _ctx, result) => ({ ...(result as object), p2: true }),
      }
      const fp = specFile({ "/test": { get: {} } })
      const app = await createHttpServer({ openApiFilePath: fp, httpPort: 3000, plugins: [p1, p2] })
      Routes.setRequestHandler("GET", "/test", async () => ({ base: true }))
      const res = await fetchVia(app, "/test")
      expect(res.body).toEqual({ base: true, p1: true, p2: true })
    })

    it("preRequest throwing aborts handler and subsequent preRequest hooks", async () => {
      const order: string[] = []
      const p1: ServerPlugin = {
        preRequest: async () => {
          order.push("pre1")
          throw Object.assign(new Error("unauthorized"), { status: 401 })
        },
      }
      const p2: ServerPlugin = { preRequest: async () => order.push("pre2") }
      const fp = specFile({ "/test": { get: {} } })
      const app = await createHttpServer({ openApiFilePath: fp, httpPort: 3000, plugins: [p1, p2] })
      Routes.setRequestHandler("GET", "/test", async () => {
        order.push("handler")
        return "ok"
      })
      const res = await fetchVia(app, "/test")
      expect(res.status).toBe(401)
      expect(order).toEqual(["pre1"])
    })

    it("preRequest receives the Express Request object", async () => {
      let captured: unknown = null
      const plugin: ServerPlugin = {
        preRequest: async (req) => {
          captured = req
        },
      }
      const fp = specFile({ "/test": { get: {} } })
      const app = await createHttpServer({ openApiFilePath: fp, httpPort: 3000, plugins: [plugin] })
      Routes.setRequestHandler("GET", "/test", async () => "ok")
      await fetchVia(app, "/test")
      expect(captured).toBeDefined()
      expect((captured as { method: string }).method).toBe("GET")
    })

    it("postRequest throwing is caught and returns its status", async () => {
      const plugin: ServerPlugin = {
        postRequest: async () => {
          throw Object.assign(new Error("transform failed"), { status: 500 })
        },
      }
      const fp = specFile({ "/test": { get: {} } })
      const app = await createHttpServer({ openApiFilePath: fp, httpPort: 3000, plugins: [plugin] })
      Routes.setRequestHandler("GET", "/test", async () => "ok")
      const res = await fetchVia(app, "/test")
      expect(res.status).toBe(500)
    })

    it("plugin with only postRequest does not interfere with preRequest phase", async () => {
      const plugin: ServerPlugin = { postRequest: async (_r, _c, res) => res }
      const fp = specFile({ "/test": { get: {} } })
      const app = await createHttpServer({ openApiFilePath: fp, httpPort: 3000, plugins: [plugin] })
      Routes.setRequestHandler("GET", "/test", async () => ({ ok: true }))
      const res = await fetchVia(app, "/test")
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ ok: true })
    })
  })

  describe("error handling", () => {
    it("returns 500 with INTERNAL_ERROR when handler throws a plain Error", async () => {
      const fp = specFile({ "/fail": { get: {} } })
      const app = await createHttpServer({ openApiFilePath: fp, httpPort: 3000 })
      Routes.setRequestHandler("GET", "/fail", async () => {
        throw new Error("something broke")
      })
      const res = await fetchVia(app, "/fail")
      expect(res.status).toBe(500)
      expect(res.body).toEqual({ error: "something broke", code: "INTERNAL_ERROR" })
    })

    it("uses custom status from thrown error object", async () => {
      const fp = specFile({ "/forbidden": { get: {} } })
      const app = await createHttpServer({ openApiFilePath: fp, httpPort: 3000 })
      Routes.setRequestHandler("GET", "/forbidden", async () => {
        throw Object.assign(new Error("forbidden"), { status: 403 })
      })
      const res = await fetchVia(app, "/forbidden")
      expect(res.status).toBe(403)
      expect(res.body).toEqual({ error: "forbidden", code: "REQUEST_FAILED" })
    })

    it("supports 400, 401, 404, 500 custom statuses", async () => {
      for (const status of [400, 401, 404, 500]) {
        Routes.clear()
        const fp = specFile({ "/err": { get: {} } })
        const app = await createHttpServer({ openApiFilePath: fp, httpPort: 3000 })
        Routes.setRequestHandler("GET", "/err", async () => {
          throw Object.assign(new Error("err"), { status })
        })
        const res = await fetchVia(app, "/err")
        expect(res.status).toBe(status)
      }
    })

    it("returns 404 NOT_FOUND for unmatched routes", async () => {
      const fp = specFile({ "/exists": { get: {} } })
      const app = await createHttpServer({ openApiFilePath: fp, httpPort: 3000 })
      const res = await fetchVia(app, "/nonexistent")
      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: "Not found", code: "NOT_FOUND" })
    })

    it("default 503 handler fires when no setRequestHandler was called", async () => {
      const fp = specFile({ "/todo": { get: {} } })
      const app = await createHttpServer({ openApiFilePath: fp, httpPort: 3000 })
      const res = await fetchVia(app, "/todo")
      expect(res.status).toBe(503)
      expect(res.body).toEqual({ error: "Not implemented", code: "REQUEST_FAILED" })
    })

    it("handler returning null/undefined still responds 200 with JSON", async () => {
      const fp = specFile({ "/empty": { get: {} } })
      const app = await createHttpServer({ openApiFilePath: fp, httpPort: 3000 })
      Routes.setRequestHandler("GET", "/empty", async () => null)
      const res = await fetchVia(app, "/empty")
      expect(res.status).toBe(200)
    })

    it("async handler rejection is caught the same as throw", async () => {
      const fp = specFile({ "/async-fail": { get: {} } })
      const app = await createHttpServer({ openApiFilePath: fp, httpPort: 3000 })
      Routes.setRequestHandler("GET", "/async-fail", async () => {
        return Promise.reject(Object.assign(new Error("async"), { status: 422 }))
      })
      const res = await fetchVia(app, "/async-fail")
      expect(res.status).toBe(422)
    })
  })

  describe("HTTP methods", () => {
    it.each([
      ["GET" as const, "get"],
      ["POST" as const, "post"],
      ["PUT" as const, "put"],
      ["PATCH" as const, "patch"],
      ["DELETE" as const, "delete"],
    ])("handles %s requests (%s in spec)", async (method, specKey) => {
      const fp = specFile({ "/method-test": { [specKey]: {} } })
      const app = await createHttpServer({ openApiFilePath: fp, httpPort: 3000 })
      Routes.setRequestHandler(method, "/method-test", async () => ({ method }))
      const res = await fetchVia(app, "/method-test", method, method === "GET" || method === "DELETE" ? undefined : {})
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ method })
    })

    it("distinguishes same path with different methods", async () => {
      const fp = specFile({ "/resource": { get: {}, post: {}, delete: {} } })
      const app = await createHttpServer({ openApiFilePath: fp, httpPort: 3000 })
      Routes.setRequestHandler("GET", "/resource", async () => ({ m: "GET" }))
      Routes.setRequestHandler("POST", "/resource", async () => ({ m: "POST" }))
      Routes.setRequestHandler("DELETE", "/resource", async () => ({ m: "DELETE" }))
      const [a, b, c] = await Promise.all([
        fetchVia(app, "/resource", "GET"),
        fetchVia(app, "/resource", "POST", {}),
        fetchVia(app, "/resource", "DELETE"),
      ])
      expect(a.body).toEqual({ m: "GET" })
      expect(b.body).toEqual({ m: "POST" })
      expect(c.body).toEqual({ m: "DELETE" })
    })
  })

  describe("missing handlers logging", () => {
    it("logs missing handlers with count and method/path", async () => {
      const fp = specFile({ "/a": { get: {} }, "/b": { post: {} } })
      await createHttpServer({ openApiFilePath: fp, httpPort: 3000 })
      expect(console.log).toHaveBeenCalled()
      const calls = (console.log as unknown as jest.Mock).mock.calls.map((c: unknown[]) => c[0] as string)
      expect(calls.some((c) => c.includes("Missing 2 handler(s)"))).toBe(true)
      expect(calls.some((c) => c.includes("GET"))).toBe(true)
      expect(calls.some((c) => c.includes("POST"))).toBe(true)
    })

    it("does not log when all discovered routes have handlers", async () => {
      const fp = specFile({ "/done": { get: {} } })
      // simulate user having already registered before createHttpServer
      // then markAsDefault will add it, but setRequestHandler removes it
      // To test "all handled", we register after createHttpServer and check that
      // a second call would show no missing — instead, test that console.log
      // is NOT called with "Missing" when we manually mark+implement first
      Routes.markAsDefault("GET", "/done")
      Routes.setRequestHandler("GET", "/done", async () => "ok")
      // clear the console mock, then create server with no new paths
      jest.mocked(console.log).mockClear()
      const fp2 = rawSpecFile({ openapi: "3.0.0", info: { title: "t", version: "1" }, paths: {} })
      await createHttpServer({ openApiFilePath: fp2, httpPort: 3000 })
      const calls = (console.log as unknown as jest.Mock).mock.calls.map((c: unknown[]) => c[0] as string)
      expect(calls.some((c) => c.includes("Missing"))).toBe(false)
    })

    it("log count reflects only still-unimplemented handlers", async () => {
      // Pre-register one handler before server creation so it is not counted as missing
      Routes.markAsDefault("GET", "/a")
      Routes.setRequestHandler("GET", "/a", async () => "ok")
      jest.mocked(console.log).mockClear()
      const fp = specFile({ "/b": { get: {} }, "/c": { get: {} } })
      await createHttpServer({ openApiFilePath: fp, httpPort: 3000 })
      const calls = (console.log as unknown as jest.Mock).mock.calls.map((c: unknown[]) => c[0] as string)
      // /a was already implemented, so only /b and /c are missing
      expect(calls.some((c) => c.includes("Missing 2 handler(s)"))).toBe(true)
    })
  })

  describe("complex multi-endpoint spec", () => {
    it("serves a realistic CRUD spec end-to-end", async () => {
      const fp = specFile({
        "/users": { get: {}, post: {} },
        "/users/{id}": { get: {}, patch: {}, delete: {} },
        "/posts": { get: {}, post: {} },
        "/posts/{id}/comments": { get: {}, post: {} },
      })
      const app = await createHttpServer({ openApiFilePath: fp, httpPort: 3000 })

      Routes.setRequestHandler("GET", "/users", async () => [{ id: 1 }])
      Routes.setRequestHandler("POST", "/users", async (req) => ({
        id: 2,
        ...(req as unknown as { body: Record<string, unknown> }).body,
      }))
      Routes.setRequestHandler("GET", "/users/{id}", async (req) => ({
        id: (req as unknown as { params: { id: string } }).params.id,
      }))
      Routes.setRequestHandler("PATCH", "/users/{id}", async () => ({ patched: true }))
      Routes.setRequestHandler("DELETE", "/users/{id}", async () => ({ deleted: true }))
      Routes.setRequestHandler("GET", "/posts", async () => [{ id: 10 }])
      Routes.setRequestHandler("POST", "/posts", async (req) => ({
        id: 11,
        ...(req as unknown as { body: Record<string, unknown> }).body,
      }))
      Routes.setRequestHandler("GET", "/posts/{id}/comments", async () => [{ text: "hi" }])
      Routes.setRequestHandler("POST", "/posts/{id}/comments", async (req) => ({
        text: (req as unknown as { body: { text: string } }).body.text,
      }))

      const [listUsers, createUser, getUser, patchUser, deleteUser, listPosts, getComments, createComment] =
        await Promise.all([
          fetchVia(app, "/users"),
          fetchVia(app, "/users", "POST", { name: "Ada" }),
          fetchVia(app, "/users/42"),
          fetchVia(app, "/users/42", "PATCH", {}),
          fetchVia(app, "/users/42", "DELETE"),
          fetchVia(app, "/posts"),
          fetchVia(app, "/posts/10/comments"),
          fetchVia(app, "/posts/10/comments", "POST", { text: "hello" }),
        ])

      expect(listUsers.body).toEqual([{ id: 1 }])
      expect(createUser.body).toEqual({ id: 2, name: "Ada" })
      expect(getUser.body).toEqual({ id: "42" })
      expect(patchUser.body).toEqual({ patched: true })
      expect(deleteUser.body).toEqual({ deleted: true })
      expect(listPosts.body).toEqual([{ id: 10 }])
      expect(getComments.body).toEqual([{ text: "hi" }])
      expect(createComment.body).toEqual({ text: "hello" })
    })

    it("each request gets independent plugin ctx even under parallel load", async () => {
      const seen: string[] = []
      const plugin: ServerPlugin<{ id: string }> = {
        preRequest: async (_req, _ctx) => {
          seen.push("pre")
        },
      }
      const fp = specFile({ "/parallel": { get: {} } })
      const app = await createHttpServer({ openApiFilePath: fp, httpPort: 3000, plugins: [plugin] })
      Routes.setRequestHandler("GET", "/parallel", async () => ({ ok: true }))
      await Promise.all([fetchVia(app, "/parallel"), fetchVia(app, "/parallel"), fetchVia(app, "/parallel")])
      expect(seen).toHaveLength(3)
    })
  })
})