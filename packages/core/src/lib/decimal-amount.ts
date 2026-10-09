const DECIMAL = /^(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i

const MAX_EXPONENT = 40
const MAX_DIGITS = 60

export function decimalAmount(value: unknown): string | null {
  const text = textOf(value)
  const match = text === null ? null : DECIMAL.exec(text.trim())
  if (!match) return null

  const [, whole = "", fraction = "", exponent = "0"] = match
  const shift = Number(exponent)
  if (whole.length + fraction.length === 0 || Math.abs(shift) > MAX_EXPONENT) return null

  const digits = whole + fraction
  const point = whole.length + shift
  const integer = point >= digits.length ? digits + "0".repeat(point - digits.length) : point > 0 ? digits.slice(0, point) : ""
  const decimals = point >= digits.length ? "" : point > 0 ? digits.slice(point) : "0".repeat(-point) + digits

  const plainInteger = integer.replace(/^0+/, "") || "0"
  const plainDecimals = decimals.replace(/0+$/, "")
  if (plainInteger.length + plainDecimals.length > MAX_DIGITS) return null
  return plainDecimals ? `${plainInteger}.${plainDecimals}` : plainInteger
}

function textOf(value: unknown): string | null {
  if (typeof value === "string") return value
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null
  if (typeof value === "bigint") return value.toString()
  if (typeof value !== "object" || value === null) return null

  const raw = (value as { raw?: { value?: unknown } }).raw?.value
  if (typeof raw === "string" || typeof raw === "number") return textOf(raw)
  const primitive = typeof value.valueOf === "function" ? value.valueOf() : null
  return typeof primitive === "object" ? null : textOf(primitive)
}
