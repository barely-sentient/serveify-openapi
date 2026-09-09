import { access } from "fs/promises";
import { JectOptions } from "json-ject";


export const useTsify = (openApiFile: string, jectConfig: JectOptions) => ({
    async beforeRouting() {
        try
        {
            await access("node_modules/tsify-openapi");

            // @ts-expect-error
            const { tsifyOpenApi } = await import("tsify-openapi");

            await tsifyOpenApi({
                jectCfg: jectConfig,
                input: openApiFile,
                type: 'file',
                outDir: 'src/generated',
                headers: { Authorization: 'Bearer ' + process.env.TOKEN },
                tsconfigPath: 'tsconfig.json'
            })
        }
        catch (err) {
            console.warn("tsify-openapi is not installed. Please install it to use tsify features.");
            return;
        }
    }
})