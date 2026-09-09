import { readFile } from "node:fs/promises"
import { resolve, relative, sep, join, extname } from "node:path"
import mime from "mime-types"
import { registerEndpointHandler } from "../http.js"
import { ServerPlugin } from "../types/plugin-sdk.js"

export type StaticOptions = {
    /** URL route to register. Defaults to the file path for useStatic. */
    route?: string
    contentType?: string
    "content-type"?: string
}

type StaticResult = {
    __serveifyStatic: true
    body: Buffer
    contentType?: string
}

const getContentType = (filePath: string, options: StaticOptions) => {
    const detected = mime.contentType(extname(filePath))
    return options.contentType ?? options["content-type"] ?? (typeof detected === "string" ? detected : "application/octet-stream")
}

const toRoute = (route: string) => {
    const normalized = route.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "")
    return normalized ? `/${normalized}` : "/"
}

const staticResult = async (filePath: string, options: StaticOptions): Promise<StaticResult> => ({
    __serveifyStatic: true,
    body: await readFile(filePath),
    contentType: getContentType(filePath, options),
})

/** Registers a GET route that serves one file without JSON serialization. */
export const useStatic = (filePath: string, options: StaticOptions = {}): ServerPlugin => ({
    beforeRouting: async () => {
        registerEndpointHandler("GET", toRoute(options.route ?? filePath), {
            handler: async (): Promise<StaticResult> => staticResult(filePath, options),
        })
    },
})

/** Registers a GET wildcard route that serves files, including nested files, from a directory. */
export const useStaticDirectory = (directoryPath: string, options: StaticOptions = {}): ServerPlugin => ({
    beforeRouting: async () => {
        const root = resolve(directoryPath)
        const route = toRoute(options.route ?? "/")

        registerEndpointHandler("GET", route === "/" ? "/*" : `${route}/*`, {
            handler: async (request): Promise<StaticResult> => {
                const requestedPath = request.params[0] || "index.html"
                const filePath = resolve(root, requestedPath)
                const pathFromRoot = relative(root, filePath)

                if (pathFromRoot.startsWith(`..${sep}`) || pathFromRoot === ".." || resolve(root, pathFromRoot) !== filePath) {
                    throw Object.assign(new Error("Not found"), { status_code: 404 })
                }

                return staticResult(join(root, pathFromRoot), options)
            },
        })
    }
});