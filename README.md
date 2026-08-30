# serveify-openapi

Turn your OpenAPI specification into a running HTTP server. Parses the spec with `json-ject`, boots Express, registers every endpoint from the spec as a route, and wires up a plugin lifecycle for pre/post request hooks.

## Installation

```bash
npm install serveify-openapi express json-ject
npm install -D @types/express @types/node typescript
```

## Quick start

```ts
import { createHttpServer, Routes } from "serveify-openapi"

const app = await createHttpServer({
  openApiFilePath: "./openapi.json",
  httpPort: 3000,
})

// Register a handler for an endpoint discovered from the spec
Routes.setRequestHandler("GET", "/users/{id}", async (req, ctx) => {
  return { id: req.params.id, name: "Ada" }
})

app.listen(3000)
```

## What it does

1. Reads and parses your OpenAPI JSON file using `json-ject` (supports `@require`, `@var`, `@env`, `@default` directives).
2. Discovers every `method + path` combination from the spec's `paths` object.
3. Initialises each discovered endpoint with an empty handler that returns a `503 Not Implemented` response until you assign a real handler.
4. Boots an Express instance with `express.json()` body parsing.
5. Calls plugin lifecycle hooks (`beforeServerStart`, `preRequest`, `postRequest`) at the appropriate times.
6. Catches all errors and returns a `503` status by default (or a custom status if the thrown error has a `status` property).

## Route map

All discovered endpoints are stored in a global route map. You assign handlers after the server is created:

```ts
import { Routes } from "serveify-openapi"

Routes.setRequestHandler("GET", "/users/{id}", async (req, sessionCtx) => {
  // req.params.id is available from the Express route
  // sessionCtx is the shared context for this request
  return { id: req.params.id, name: "Ada" }
})

Routes.setRequestHandler("POST", "/users", async (req, sessionCtx) => {
  return { id: "new", ...req.body }
})
```

### `Routes` API

| Method | Description |
|---|---|
| `setRequestHandler(method, path, handler)` | Register or replace a handler for a specific method + path |
| `getRequestHandler(method, path)` | Retrieve the current handler for a method + path |
| `getRoutes()` | Get the full route map (`Map<HttpMethod, Map<string, Handler>>`) |
| `clear()` | Remove all registered handlers |

### Types

```ts
type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS"

type Handler = (req: Request, sessionCtx: unknown) => Promise<unknown>
```

## Configuration

```ts
type CreateServerConfig<TContext = unknown> = {
  openApiFilePath: string          // Path to your OpenAPI JSON file
  httpPort: number                 // Port for the HTTP listener
  plugins?: ServerPlugin<TContext>[]  // Optional lifecycle plugins
  ssl?: SSLConfig                  // Optional HTTPS config
}
```

## Plugins

Plugins hook into the server lifecycle at three points:

```ts
import { ServerPlugin } from "serveify-openapi"

const myPlugin: ServerPlugin<MyContext> = {
  // Called once at startup, before any requests are accepted
  beforeServerStart: async () => {
    await connectToDatabase()
  },

  // Called before every request handler
  preRequest: async (req, ctx) => {
    const token = req.headers.authorization
    if (!token) throw Object.assign(new Error("Unauthorized"), { status: 401 })
  },

  // Called after every request handler, can transform the response
  postRequest: async (req, ctx, result) => {
    return { ...result, timestamp: Date.now() }
  },
}
```

Pass plugins via the config:

```ts
const app = await createHttpServer({
  openApiFilePath: "./openapi.json",
  httpPort: 3000,
  plugins: [myPlugin],
})
```

Plugins are executed in order. If a `preRequest` hook throws, subsequent plugins and the handler are skipped.

## Error handling

All errors thrown inside handlers or plugin hooks are caught and returned as JSON:

```json
{
  "error": "Internal server error",
  "code": "INTERNAL_ERROR"
}
```

The default status code is `503`. If the thrown error has a `status` property, that value is used instead:

```ts
throw Object.assign(new Error("Not found"), { status: 404 })
// Returns 404 with the error JSON
```

Unmatched routes return:

```json
{
  "error": "Not found",
  "code": "NOT_FOUND"
}
```

## Path conversion

OpenAPI path templates are automatically converted to Express route syntax:

| OpenAPI | Express |
|---|---|
| `/users/{id}` | `/users/:id` |
| `/orders/{orderId}/items/{itemId}` | `/orders/:orderId/items/:itemId` |

## SSL / HTTPS

Pass an `ssl` config to enable HTTPS:

```ts
const app = await createHttpServer({
  openApiFilePath: "./openapi.json",
  httpPort: 8080,
  ssl: {
    httpsPort: 8443,
    cert: "./certs/server.crt",
    key: "./certs/server.key",
  },
})
```

## Development

```bash
npm run build   # tsc -> dist/
npm run test    # jest
```

## License

MIT
