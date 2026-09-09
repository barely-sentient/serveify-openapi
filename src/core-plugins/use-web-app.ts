import { PathLike } from "fs";
import { ServerPlugin } from "../types/plugin-sdk.js";
import { registerEndpointHandler, registerWebApp } from "../http.js";
import { createStaticDirectoryEndpoint } from "./use-static.js";
import { mkdir } from 'fs/promises'

export const useWebApp = (route: string, staticDir: PathLike): ServerPlugin => ({
    async beforeRouting() {
        
        await mkdir(`${process.cwd()}/web/${staticDir}/static`, { recursive: true });
        await mkdir(`${process.cwd()}/web/${staticDir}/src`, { recursive: true });

        const endpoint = createStaticDirectoryEndpoint(`${process.cwd()}/web/${staticDir}/static`, { route });
        const normalizedRoute = route.replace(/^\/+|\/+$/g, "");
        const staticRoute = normalizedRoute ? `${route.replace(/\/+$/g, "")}/*` : "/*";
        registerEndpointHandler("GET", staticRoute, endpoint);
        registerWebApp(route, staticRoute, endpoint);
    }
});