import { access } from "fs/promises";
import { useGlobLoader } from "./use-glob.js";
import { ServerPlugin } from "../types/plugin-sdk.js";

export const useEventify = (openApiJson: string): ServerPlugin => ({
    async beforeRouting(schema) {
        try
        {
            await access("node_modules/eventify-openapi");

            // @ts-expect-error
            const { eventifyOpenApi } = await import("eventify-openapi");

            await eventifyOpenApi({
                input: openApiJson,
                type: "file",
                tsconfigPath: "tsconfig.json",
                contextType: { from: "./ctx.js", name: "SessionCtx" }
            });

            return await useGlobLoader("./**/*.events.ts")?.beforeRouting?.(schema);

        } catch (err) {
            console.warn("eventify-openapi is not installed. Please install it to use eventify features.", err);
            return;
        }
    }
});