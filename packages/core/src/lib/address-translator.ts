/**
 * Bidirectional address translation between Medusa internal format
 * and protocol-specific formats (ACP, UCP).
 */

// --- Types ---

export type MedusaAddress = {
  first_name?: string
  last_name?: string
  address_1?: string
  address_2?: string
  city?: string
  province?: string
  postal_code?: string
  country_code?: string
  phone?: string
}

export type AcpAddress = {
  name?: string
  line_one?: string
  line_two?: string
  city?: string
  state?: string
  postal_code?: string
  country?: string
  phone_number?: string
}

export type UcpAddress = {
  name?: string
  line1?: string
  line2?: string
  city?: string
  state?: string
  postal_code?: string
  country?: string
  phone?: string
}

// --- Medusa <-> ACP ---

export function medusaToAcpAddress(addr: MedusaAddress): AcpAddress {
  const nameParts = [addr.first_name, addr.last_name].filter(Boolean)
  return {
    name: nameParts.length > 0 ? nameParts.join(" ") : undefined,
    line_one: addr.address_1 || undefined,
    line_two: addr.address_2 || undefined,
    city: addr.city || undefined,
    state: addr.province || undefined,
    postal_code: addr.postal_code || undefined,
    country: addr.country_code || undefined,
    phone_number: addr.phone || undefined,
  }
}

export function acpAddressToMedusa(addr: AcpAddress): MedusaAddress {
  let firstName: string | undefined
  let lastName: string | undefined
  if (addr.name) {
    const parts = addr.name.trim().split(/\s+/)
    firstName = parts[0]
    lastName = parts.length > 1 ? parts.slice(1).join(" ") : undefined
  }

  return {
    first_name: firstName,
    last_name: lastName,
    address_1: addr.line_one || undefined,
    address_2: addr.line_two || undefined,
    city: addr.city || undefined,
    province: addr.state || undefined,
    postal_code: addr.postal_code || undefined,
    country_code: addr.country || undefined,
    phone: addr.phone_number || undefined,
  }
}

// --- Medusa <-> UCP ---

export function medusaToUcpAddress(addr: MedusaAddress): UcpAddress {
  const nameParts = [addr.first_name, addr.last_name].filter(Boolean)
  return {
    name: nameParts.length > 0 ? nameParts.join(" ") : undefined,
    line1: addr.address_1 || undefined,
    line2: addr.address_2 || undefined,
    city: addr.city || undefined,
    state: addr.province || undefined,
    postal_code: addr.postal_code || undefined,
    country: addr.country_code || undefined,
    phone: addr.phone || undefined,
  }
}

export function ucpAddressToMedusa(addr: UcpAddress): MedusaAddress {
  let firstName: string | undefined
  let lastName: string | undefined
  if (addr.name) {
    const parts = addr.name.trim().split(/\s+/)
    firstName = parts[0]
    lastName = parts.length > 1 ? parts.slice(1).join(" ") : undefined
  }

  return {
    first_name: firstName,
    last_name: lastName,
    address_1: addr.line1 || undefined,
    address_2: addr.line2 || undefined,
    city: addr.city || undefined,
    province: addr.state || undefined,
    postal_code: addr.postal_code || undefined,
    country_code: addr.country || undefined,
    phone: addr.phone || undefined,
  }
}
