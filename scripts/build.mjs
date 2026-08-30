import { copyFileSync, mkdirSync, rmSync } from "node:fs";
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

if (process.argv.includes('--deploy-local'))
{
  const thisDir = resolve(import.meta.dirname, "..", "dist")
  const thatDir = resolve(process.cwd(), "..", "openapi-server-test/node_modules/serveify-openapi/dist");

  rmSync(
    thatDir,
    { recursive: true, force: true }
  )

  mkdirSync(thatDir)

  copyFileSync(`${thisDir}/index.js`, `${thatDir}/index.js`)
  copyFileSync(`${thisDir}/index.d.ts`, `${thatDir}/index.d.ts`)
}
