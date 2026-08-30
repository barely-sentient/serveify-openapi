import { glob } from "tinyglobby";
import { ServerPlugin } from "../types/plugin-sdk.js";

export const useGlobLoader = (path: string): ServerPlugin => ({
    async beforeRouting() {
        const files = await glob([path, '!**/*.test.ts'], {
            expandDirectories: true,
            onlyFiles: true,
        });

        // import all that match.
        await Promise.all(
            files.map(file => import(file))
        );
    }
});