import { Routes, Handler, HttpMethod } from "../src/routes.js"

describe("Routes", () => {
  beforeEach(() => {
    Routes.clear()
  })

  describe("setRequestHandler", () => {
    it("registers a handler for a method and path", () => {
      const handler: Handler = async () => "hello"
      Routes.setRequestHandler("GET", "/users", handler)
      expect(Routes.getRequestHandler("GET", "/users")).toBe(handler)
    })

    it("replaces an existing handler for the same method and path", () => {
      const first: Handler = async () => "first"
      const second: Handler = async () => "second"
      Routes.setRequestHandler("POST", "/items", first)
      Routes.setRequestHandler("POST", "/items", second)
      expect(Routes.getRequestHandler("POST", "/items")).toBe(second)
    })

    it("does not affect other paths on the same method", () => {
      const h1: Handler = async () => "a"
      const h2: Handler = async () => "b"
      Routes.setRequestHandler("GET", "/a", h1)
      Routes.setRequestHandler("GET", "/b", h2)
      expect(Routes.getRequestHandler("GET", "/a")).toBe(h1)
      expect(Routes.getRequestHandler("GET", "/b")).toBe(h2)
    })

    it("does not affect other methods on the same path", () => {
      const h1: Handler = async () => "get"
      const h2: Handler = async () => "post"
      Routes.setRequestHandler("GET", "/resource", h1)
      Routes.setRequestHandler("POST", "/resource", h2)
      expect(Routes.getRequestHandler("GET", "/resource")).toBe(h1)
      expect(Routes.getRequestHandler("POST", "/resource")).toBe(h2)
    })

    it("removes the route from defaultHandlers", () => {
      Routes.markAsDefault("DELETE", "/items/:id")
      expect(Routes.getDefaultHandlers()).toHaveLength(1)
      Routes.setRequestHandler("DELETE", "/items/:id", async () => "deleted")
      expect(Routes.getDefaultHandlers()).toHaveLength(0)
    })

    it("handles all HTTP methods", () => {
      const methods: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]
      for (const method of methods) {
        const handler: Handler = async () => method
        Routes.setRequestHandler(method, `/${method.toLowerCase()}`, handler)
        expect(Routes.getRequestHandler(method, `/${method.toLowerCase()}`)).toBe(handler)
      }
    })
  })

  describe("getRequestHandler", () => {
    it("returns undefined for an unregistered method and path", () => {
      expect(Routes.getRequestHandler("GET", "/nonexistent")).toBeUndefined()
    })

    it("returns undefined for unregistered method on existing path", () => {
      Routes.setRequestHandler("GET", "/users", async () => "ok")
      expect(Routes.getRequestHandler("POST", "/users")).toBeUndefined()
    })

    it("returns the exact handler reference", () => {
      const handler: Handler = async () => ({ data: 42 })
      Routes.setRequestHandler("PUT", "/update", handler)
      const retrieved = Routes.getRequestHandler("PUT", "/update")
      expect(retrieved).toBe(handler)
      expect(typeof retrieved).toBe("function")
    })
  })

  describe("getRoutes", () => {
    it("returns an empty map when no routes are registered", () => {
      const routes = Routes.getRoutes()
      expect(routes.size).toBe(0)
    })

    it("returns a map containing all registered methods", () => {
      Routes.setRequestHandler("GET", "/a", async () => 1)
      Routes.setRequestHandler("POST", "/b", async () => 2)
      Routes.setRequestHandler("DELETE", "/c", async () => 3)
      const routes = Routes.getRoutes()
      expect(routes.has("GET")).toBe(true)
      expect(routes.has("POST")).toBe(true)
      expect(routes.has("DELETE")).toBe(true)
      expect(routes.has("PUT")).toBe(false)
    })

    it("returns nested maps with correct path entries", () => {
      Routes.setRequestHandler("GET", "/users", async () => [])
      Routes.setRequestHandler("GET", "/posts", async () => [])
      const routes = Routes.getRoutes()
      const getMap = routes.get("GET")!
      expect(getMap.size).toBe(2)
      expect(getMap.has("/users")).toBe(true)
      expect(getMap.has("/posts")).toBe(true)
    })

    it("reflects live mutations", () => {
      Routes.setRequestHandler("GET", "/live", async () => 1)
      expect(Routes.getRoutes().get("GET")?.size).toBe(1)
      Routes.setRequestHandler("GET", "/live2", async () => 2)
      expect(Routes.getRoutes().get("GET")?.size).toBe(2)
    })
  })

  describe("markAsDefault", () => {
    it("registers a default 503 handler for the method and path", () => {
      Routes.markAsDefault("GET", "/users")
      const handler = Routes.getRequestHandler("GET", "/users")
      expect(handler).toBeDefined()
    })

    it("adds the route to the defaultHandlers set", () => {
      Routes.markAsDefault("GET", "/users")
      const defaults = Routes.getDefaultHandlers()
      expect(defaults).toHaveLength(1)
      expect(defaults[0]).toEqual({ method: "GET", path: "/users" })
    })

    it("the default handler throws with 503 status", async () => {
      Routes.markAsDefault("POST", "/submit")
      const handler = Routes.getRequestHandler("POST", "/submit")!
      await expect(handler({} as any, {})).rejects.toMatchObject({
        status: 503,
        message: "Not implemented",
      })
    })

    it("tracks multiple defaults across methods and paths", () => {
      Routes.markAsDefault("GET", "/a")
      Routes.markAsDefault("POST", "/b")
      Routes.markAsDefault("DELETE", "/c")
      const defaults = Routes.getDefaultHandlers()
      expect(defaults).toHaveLength(3)
      expect(defaults).toContainEqual({ method: "GET", path: "/a" })
      expect(defaults).toContainEqual({ method: "POST", path: "/b" })
      expect(defaults).toContainEqual({ method: "DELETE", path: "/c" })
    })

    it("does not duplicate defaults for the same method and path", () => {
      Routes.markAsDefault("GET", "/dup")
      Routes.markAsDefault("GET", "/dup")
      expect(Routes.getDefaultHandlers()).toHaveLength(1)
    })

    it("preserves a previously setRequestHandler handler when markAsDefault is called", async () => {
      Routes.setRequestHandler("PUT", "/conflict", async () => "custom")
      Routes.markAsDefault("PUT", "/conflict")
      const handler = Routes.getRequestHandler("PUT", "/conflict")!
      await expect(handler({} as any, {})).resolves.toBe("custom")
      expect(Routes.getDefaultHandlers()).toHaveLength(0)
    })
  })

  describe("getDefaultHandlers", () => {
    it("returns an empty array when no defaults exist", () => {
      expect(Routes.getDefaultHandlers()).toEqual([])
    })

    it("returns only defaults, not manually set handlers", () => {
      Routes.markAsDefault("GET", "/missing")
      Routes.setRequestHandler("GET", "/present", async () => "ok")
      const defaults = Routes.getDefaultHandlers()
      expect(defaults).toHaveLength(1)
      expect(defaults[0]).toEqual({ method: "GET", path: "/missing" })
    })

    it("returns defaults in insertion order", () => {
      Routes.markAsDefault("POST", "/first")
      Routes.markAsDefault("GET", "/second")
      Routes.markAsDefault("DELETE", "/third")
      const defaults = Routes.getDefaultHandlers()
      expect(defaults[0]).toEqual({ method: "POST", path: "/first" })
      expect(defaults[1]).toEqual({ method: "GET", path: "/second" })
      expect(defaults[2]).toEqual({ method: "DELETE", path: "/third" })
    })

    it("decreases count as handlers are implemented", () => {
      Routes.markAsDefault("GET", "/a")
      Routes.markAsDefault("POST", "/b")
      Routes.markAsDefault("DELETE", "/c")
      expect(Routes.getDefaultHandlers()).toHaveLength(3)
      Routes.setRequestHandler("POST", "/b", async () => "done")
      expect(Routes.getDefaultHandlers()).toHaveLength(2)
      Routes.setRequestHandler("GET", "/a", async () => "done")
      expect(Routes.getDefaultHandlers()).toHaveLength(1)
      Routes.setRequestHandler("DELETE", "/c", async () => "done")
      expect(Routes.getDefaultHandlers()).toHaveLength(0)
    })
  })

  describe("clear", () => {
    it("removes all routes", () => {
      Routes.setRequestHandler("GET", "/a", async () => 1)
      Routes.setRequestHandler("POST", "/b", async () => 2)
      Routes.clear()
      expect(Routes.getRoutes().size).toBe(0)
    })

    it("removes all default handlers", () => {
      Routes.markAsDefault("GET", "/a")
      Routes.markAsDefault("POST", "/b")
      Routes.clear()
      expect(Routes.getDefaultHandlers()).toHaveLength(0)
    })

    it("allows fresh registrations after clearing", () => {
      Routes.setRequestHandler("GET", "/old", async () => 1)
      Routes.clear()
      Routes.setRequestHandler("GET", "/new", async () => 2)
      expect(Routes.getRequestHandler("GET", "/old")).toBeUndefined()
      expect(Routes.getRequestHandler("GET", "/new")).toBeDefined()
    })
  })

  describe("concurrent handler registration", () => {
    it("handles rapid sequential registrations without corruption", () => {
      for (let i = 0; i < 100; i++) {
        Routes.setRequestHandler("GET", `/route-${i}`, async () => i)
      }
      const routes = Routes.getRoutes()
      expect(routes.get("GET")?.size).toBe(100)
      for (let i = 0; i < 100; i++) {
        expect(Routes.getRequestHandler("GET", `/route-${i}`)).toBeDefined()
      }
    })

    it("handles interleaved markAsDefault and setRequestHandler", () => {
      for (let i = 0; i < 50; i++) {
        Routes.markAsDefault("GET", `/route-${i}`)
      }
      expect(Routes.getDefaultHandlers()).toHaveLength(50)
      for (let i = 0; i < 50; i += 2) {
        Routes.setRequestHandler("GET", `/route-${i}`, async () => i)
      }
      expect(Routes.getDefaultHandlers()).toHaveLength(25)
    })
  })

  describe("handler execution", () => {
    it("handler receives req and sessionCtx arguments", async () => {
      const calls: unknown[][] = []
      const spy: Handler = async (...args: unknown[]) => {
        calls.push(args)
        return "result"
      }
      Routes.setRequestHandler("GET", "/spy", spy)
      const handler = Routes.getRequestHandler("GET", "/spy")!
      const mockReq = { params: { id: "123" } } as any
      const mockCtx = { userId: "user-1" }
      await handler(mockReq, mockCtx)
      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual([mockReq, mockCtx])
    })

    it("handler return value is accessible", async () => {
      Routes.setRequestHandler("GET", "/data", async () => ({
        users: [{ id: 1 }, { id: 2 }],
        total: 2,
      }))
      const handler = Routes.getRequestHandler("GET", "/data")!
      const result = await handler({} as any, {})
      expect(result).toEqual({ users: [{ id: 1 }, { id: 2 }], total: 2 })
    })

    it("handler can throw errors", async () => {
      Routes.setRequestHandler("POST", "/fail", async () => {
        throw Object.assign(new Error("forbidden"), { status: 403 })
      })
      const handler = Routes.getRequestHandler("POST", "/fail")!
      await expect(handler({} as any, {})).rejects.toThrow("forbidden")
    })

    it("handler can be async and return a promise", async () => {
      Routes.setRequestHandler("GET", "/async", async () => {
        return new Promise((resolve) => setTimeout(() => resolve("delayed"), 10))
      })
      const handler = Routes.getRequestHandler("GET", "/async")!
      const result = await handler({} as any, {})
      expect(result).toBe("delayed")
    })
  })
})