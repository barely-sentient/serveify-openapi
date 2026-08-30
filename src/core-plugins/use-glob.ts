import { glob } from "tinyglobby";
import { ServerPlugin } from "../types/plugin-sdk.js";
import os from 'os'

/**
 * Load files ahead of routing being available.
 * @param path - the path FROM the root of the project
 * @returns 
 */
export const useGlobLoader = (path: string): ServerPlugin => ({
    async beforeRouting() {
        const files = await glob([path, '!**/*.test.ts'], {
            expandDirectories: true,
            onlyFiles: true,
        });

        // import all that match.
        await Promise.all(
            files.map(file => resolveAndImport(file))
        );
    }
});

const resolveAndImport = async (file: string) => {
    let path = `${process.cwd()}/${file}`

    if (os.platform() == 'win32') {
        path = path.substring(2);
    }

    path = path.replaceAll("\\", "/")

    await import(path);
}