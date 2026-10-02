import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { describe, it, expect } from "vitest"

const REPO = join(__dirname, "..", "..", "..", "..")
const ROOTS = ["packages/core/src", "packages/prism-payment/src"]
const SKIPPED_DIRS = new Set(["__tests__", "__fixtures__"])
const ALLOWED = ["packages/core/src/lib/ucp-wire/", "packages/core/src/lib/ucp-version-registry.ts"]
const VERSION_LITERAL = /2026-01-23|2026-04-08|2026-08-25|ucp\.dev\/\d{4}-\d{2}-\d{2}/

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return SKIPPED_DIRS.has(name) ? [] : sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

describe("UCP version literals", () => {
  it("appear only in the version registry and the wire translators", () => {
    const hits: string[] = []
    for (const root of ROOTS) {
      for (const file of sourceFiles(join(REPO, root))) {
        const path = relative(REPO, file).split(sep).join("/")
        if (ALLOWED.some((allowed) => path === allowed || path.startsWith(allowed))) continue
        readFileSync(file, "utf8").split("\n").forEach((line, index) => {
          if (VERSION_LITERAL.test(line)) hits.push(`${path}:${index + 1}: ${line.trim()}`)
        })
      }
    }
    expect(hits).toEqual([])
  })
})
