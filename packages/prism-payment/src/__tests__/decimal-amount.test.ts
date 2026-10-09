import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { decimalAmount } from "../lib/decimal-amount"

describe("decimalAmount", () => {
  it.each([
    [15, "15"],
    [17.5, "17.5"],
    [0, "0"],
    ["0.0", "0"],
    [" 15 ", "15"],
    ["007.500", "7.5"],
    [".5", "0.5"],
    ["5.", "5"],
    [1e21, "1000000000000000000000"],
    [1e-7, "0.0000001"],
    ["1.5e3", "1500"],
    ["1E-3", "0.001"],
    [12345678901234567890n, "12345678901234567890"],
    ["9007199254740993", "9007199254740993"],
    ["12.123456789012345678", "12.123456789012345678"],
    ["34.000000000000000000", "34"],
  ])("writes %s as %s", (input, expected) => {
    expect(decimalAmount(input)).toBe(expected)
  })

  it("reads the exact raw value of a Medusa BigNumber", () => {
    const bigNumber = { raw: { value: "15.250000000000000000", precision: 20 }, valueOf: () => 15.25 }

    expect(decimalAmount(bigNumber)).toBe("15.25")
  })

  it("falls back to the primitive value of an object that carries no raw value", () => {
    expect(decimalAmount({ valueOf: () => 42 })).toBe("42")
  })

  it.each([
    ["nothing", undefined],
    ["null", null],
    ["an empty string", ""],
    ["a lone point", "."],
    ["a lone exponent", "e5"],
    ["text", "abc"],
    ["a negative amount", "-5"],
    ["a signed amount", "+5"],
    ["not a finite number", NaN],
    ["an infinite number", Infinity],
    ["a boolean", true],
    ["an array", [15]],
    ["a plain object", { value: "15" }],
    ["an object without prototype", Object.create(null)],
    ["an exponent too large to expand", "1e41"],
    ["an exponent too small to expand", "1e-41"],
    ["more digits than any real total", "1".repeat(61)],
  ])("refuses %s", (_label, input) => {
    expect(decimalAmount(input)).toBeNull()
  })
})

describe("decimalAmount copies", () => {
  const source = (relative: string) => readFileSync(join(__dirname, relative), "utf8").replace(/\r\n/g, "\n")

  it("stay identical in the core and the Prism package", () => {
    expect(source("../lib/decimal-amount.ts")).toBe(source("../../../core/src/lib/decimal-amount.ts"))
  })
})
