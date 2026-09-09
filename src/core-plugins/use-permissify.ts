import { access } from "fs/promises";
import { useGlobLoader } from "./use-glob.js";
import { ServerPlugin } from "../types/plugin-sdk.js";

export const usePermissify = (): ServerPlugin => ({
    async beforeRouting(schema) {
        try
        {
            await access("node_modules/permissify-openapi");
        } catch (err) {
            console.warn("permissify-openapi is not installed. Please install it to use permissify features.");
            return;
        }

        return await useGlobLoader("./**/*.permissions.ts").beforeRouting?.(schema);
    }
});