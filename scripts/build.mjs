import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
rmSync(resolve(root, "dist"), { recursive: true, force: true });

execFileSync(
  process.execPath,
  [
    resolve(root, "node_modules/tsup/dist/cli-default.js"),
    "src/index.ts",
    "--format",
    "esm",
    "--dts",
    "--clean"
  ],
  { cwd: root, stdio: "inherit" }
);
