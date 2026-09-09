import { PathLike } from "fs";
import { ServerPlugin } from "../types/plugin-sdk.js";
import { useStaticDirectory } from "./use-static.js";
import { mkdir } from 'fs/promises'

export const useWebApp = (route: string, staticDir: PathLike): ServerPlugin => ({
    async beforeRouting() {
        
        await mkdir(`web/${staticDir}/static`, { recursive: true });
        await mkdir(`web/${staticDir}/src`, { recursive: true });

        useStaticDirectory(`web/${staticDir}/static`, {
            route: route
        });
    }
});