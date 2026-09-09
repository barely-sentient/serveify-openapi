# serveify-openapi

Turn your OpenAPI specification into a running HTTP server. Parses the spec with `json-ject`, boots Express, registers every endpoint from the spec as a route, and wires up a plugin lifecycle for pre/post request hooks.

## Installation

```bash
npm install serveify-openapi
```

## Quick start

Register your handlers first, then start the server.

```ts
import { 
  createHttpServer, 
  registerEndpointHandler 
} from "serveify-openapi"

// 1. Register handlers for endpoints defined in your spec
registerEndpointHandler("GET", "/users/{id}", async (req, ctx) => {
  return { id: req.params.id, name: "Ada" }
})

// 2. Create and start the server (boots listener automatically)
await createHttpServer({
  openApiFilePath: "./openapi.json",
  httpPort: 3000,
})

```

## What it does

1. Reads and parses your OpenAPI JSON file using `json-ject` (supports `@require`, `@var`, `@env`, `@default` directives).
2. Runs `beforeServerStart` and `beforeRouting` plugin lifecycle hooks (allowing auto-loading of route handlers or event listeners before routes are set up).
3. Discovers every `method + path` combination from the spec's `paths` object.
4. Matches discovered endpoints against your registered handlers (endpoints with no handler return `500 Not Implemented` until you register one).
5. Boots an Express instance with `express.json()` body parsing and starts listening on the configured port.
6. Calls request-level plugin lifecycle hooks (`preRequest`, `postRequest`) at the appropriate times.
7. Catches all errors and returns them as JSON (custom status via `status_code` on the thrown error — see Error handling).

## Registering Handlers

Handlers are registered using `registerEndpointHandler` before calling `createHttpServer`:

```ts
import { registerEndpointHandler } from "serveify-openapi"

registerEndpointHandler("GET", "/users/{id}", async (req, sessionCtx) => {
  // req.params.id is available from the Express route
  // sessionCtx is the shared context for this request
  return { id: req.params.id, name: "Ada" }
})

registerEndpointHandler("POST", "/users", async (req, sessionCtx) => {
  return { id: "new", ...req.body }
})

```

## Configuration

```ts
type CreateServerConfig<TContext unknown> = {
  openApiFilePath: string          // Path to your OpenAPI JSON file
  httpPort: number                 // Port for the HTTP listener
  plugins?: ServerPlugin<TContext>[]  // Optional lifecycle plugins
  ssl?: SSLConfig                  // Optional HTTPS config
}

```

## Plugins

Plugins hook into the server lifecycle at four key points:

```ts
import { ServerPlugin } from "serveify-openapi"

const myPlugin: ServerPlugin<MyContext> = {
  // Called once at startup, before any requests are accepted
  beforeServerStart: async () => {
    await connectToDatabase()
  },

  // Called before Express routes are initialized (great for auto-importing handlers/events)
  beforeRouting: async () => {
    await loadModules()
  },

  // Called before every request handler
  preRequest: async (req, ctx) => {
    const token = req.headers.authorization
    if (!token) throw Object.assign(new Error("Unauthorized"), { status_code: 401 })
  },

  // Called after every request handler, can transform the response
  postRequest: async (req, ctx, result) => {
    return { ...result, timestamp: Date.now() }
  },
}

```

Pass plugins via the config:

```ts
await createHttpServer({
  openApiFilePath: "./openapi.json",
  httpPort: 3000,
  plugins: [myPlugin],
})

```

Plugins are executed in order. If a `preRequest` hook throws, subsequent plugins and the handler are skipped.

---

### Built-in Glob Loader Plugins

`serveify-openapi` includes utility plugins that use `beforeRouting` to automatically discover and dynamically import your files before the server sets up routes. This allows you to auto-register handlers without manual imports.

#### `useGlobLoader(path)`

A general-purpose plugin factory that accepts a glob path string, searches your workspace, and dynamically imports all matching files. Automatically excludes `.test.ts` files.

```ts
import { createHttpServer, useGlobLoader } from "serveify-openapi"

await createHttpServer({
  openApiFilePath: "./openapi.json",
  httpPort: 3000,
  plugins: [
    // Auto-import all files in the scripts folder before routing starts
    useGlobLoader("src/scripts/**/*.ts"),
  ],
})

```

#### Preset Plugins

* **`useCustomHandlers()`**: Glob loader factory targeting **`src/**/*.handler.ts`**. Use this to keep handler logic in separate files and auto-register them via `registerEndpointHandler()`.
* **`useEventify()`**: Glob loader factory targeting **`src/**/*.events.ts`**. Use this to auto-import event listeners or pub/sub handlers during server setup.

#### Example Usage

In your main entry file:

```ts
import { 
  createHttpServer, 
  useCustomHandlers, 
  useEventify 
} from "serveify-openapi"

await createHttpServer({
  openApiFilePath: "./openapi.json",
  httpPort: 3000,
  plugins: [
    useCustomHandlers(), // Dynamically imports all *.handler.ts files before routing
    useEventify(),        // Dynamically imports all *.events.ts files before routing
  ],
})

```

In your separate handler files (e.g. `src/routes/user.handler.ts`):

```ts
import { registerEndpointHandler } from "serveify-openapi"

registerEndpointHandler("GET", "/users/{id}", async (req) => {
  return { id: req.params.id, name: "Ada" }
})

```

---

## Error handling

One rule to remember: **the HTTP status comes from `status_code` on whatever you
throw.** No `status_code`, no custom status. Every error response is JSON shaped
like `{ "status": "failed", "message": "..." }`.

```ts
// 404 with { status: "failed", message: "Not found" }
throw Object.assign(new Error("Not found"), { status_code: 404 })
```

What happens in each case:

| Situation | HTTP status | Response body |
| --- | --- | --- |
| Handler succeeds | `200` | Your return value as JSON |
| You throw with `status_code` | Your code | `{ status: "failed", message }` |
| A library error with details (Ajv validation, `persistify` permission/validation errors) | Its `status_code`, else `500` | `{ status: "failed", message, errors, response, schema }` — the `schema` shows the expected request/response shapes for debugging |
| You throw a plain `Error` with no `status_code` | `200` (!) | `{ status: "failed", message }` — always set `status_code`, otherwise failures look like successes |
| Spec endpoint with no registered handler | `500` | `{ status: "failed", message: "This endpoint has not been implemented" }` |
| Path not in the spec at all | Express default `404` | HTML page (no route is registered for it) |
| Malformed JSON body | `400` | `{ status: "failed", message: "Invalid JSON body" }` |

Common statuses to throw: `400` bad input, `401` not authenticated, `403` not
allowed, `404` not found. The companion packages already do this for you
(`persistify-openapi` throws `403` on denied permissions and `400` on failed
validation; `autocrudify-openapi` throws `404` for missing records).

## Path conversion

OpenAPI path templates are automatically converted to Express route syntax:

| OpenAPI | Express |
| --- | --- |
| `/users/{id}` | `/users/:id` |
| `/orders/{orderId}/items/{itemId}` | `/orders/:orderId/items/:itemId` |

## SSL / HTTPS

Pass an `ssl` config to enable HTTPS:

```ts
await createHttpServer({
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