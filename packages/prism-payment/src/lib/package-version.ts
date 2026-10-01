import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"

const PACKAGE_NAME = "@financedistrict/medusa-plugin-prism-payment"

let cached: string | undefined

export function readPackageVersion(): string {
  if (cached) return cached
  let dir = __dirname
  for (;;) {
    const candidate = join(dir, "package.json")
    if (existsSync(candidate)) {
      const manifest = JSON.parse(readFileSync(candidate, "utf8")) as { name?: string; version?: string }
      if (manifest.name === PACKAGE_NAME && manifest.version) {
        cached = manifest.version
        return cached
      }
    }
    const parent = dirname(dir)
    if (parent === dir) throw new Error(`package.json for ${PACKAGE_NAME} not found from ${__dirname}`)
    dir = parent
  }
}
