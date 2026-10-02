import { readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import {
  PRISM_HANDLER_ID,
  readFixture,
  renderFixtures,
  serialize,
  UCP_FIXTURES,
  withoutPrismOwnedKeys,
} from "./helpers/render-wire"

const VERSION = "2026-04-08"
const GOLDEN = "2026-04-08-prism-nsid"
const goldens = readdirSync(join(UCP_FIXTURES, GOLDEN)).filter((name) => name.endsWith(".json"))

describe.each([
  ["the current 2026-04-08 Prism entry", "current-handlers-2026-04-08.json"],
  ["the legacy Prism entry served by prod", "legacy-handlers.json"],
])("2026-04-08 wire fed %s against the 0.1.12 + 0.3.3 namespace-id goldens", (_label, recorded) => {
  it.each(goldens)("keeps %s equal outside Prism-owned handler fields", async (name) => {
    const rendered = await renderFixtures({ version: VERSION, supported: [], recordedPrism: recorded })
    const original = JSON.parse(readFixture(GOLDEN, name))
    expect(serialize(withoutPrismOwnedKeys(rendered[name]))).toBe(serialize(withoutPrismOwnedKeys(original)))
  })

  it("advertises one canonical Prism entry", async () => {
    const rendered = await renderFixtures({ version: VERSION, supported: [], recordedPrism: recorded })
    const entries = (rendered["profile.json"] as any).ucp.payment_handlers[PRISM_HANDLER_ID]
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ id: PRISM_HANDLER_ID, version: expect.any(String), spec: expect.any(String), schema: expect.any(String) })
  })
})
