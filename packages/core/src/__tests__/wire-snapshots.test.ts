import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect, beforeAll } from "vitest"
import { readFixture, renderFixtures, serialize, UCP_FIXTURES, type RenderedFixtures } from "./helpers/render-wire"

const UPDATE = process.env.UPDATE_UCP_SNAPSHOTS === "1"

describe.each([
  ["2026-08-25", "current-handlers-2026-08-25.json"],
  ["2026-01-23", "current-handlers-2026-01-23.json"],
])("%s wire snapshots", (version, recorded) => {
  const folder = join(UCP_FIXTURES, version)
  let rendered: RenderedFixtures

  beforeAll(async () => {
    rendered = await renderFixtures({ version, supported: [], recordedPrism: recorded })
    delete rendered["order__get.json"]
    if (UPDATE) {
      mkdirSync(folder, { recursive: true })
      for (const [name, value] of Object.entries(rendered)) writeFileSync(join(folder, name), serialize(value))
    }
  })

  it("has a snapshot for every rendered document and nothing else", () => {
    expect(existsSync(folder)).toBe(true)
    expect(readdirSync(folder).filter((n) => n.endsWith(".json")).sort()).toEqual(Object.keys(rendered).sort())
  })

  it("matches every snapshot", () => {
    for (const [name, value] of Object.entries(rendered)) {
      expect(serialize(value), name).toBe(readFixture(version, name))
    }
  })
})
