/**
 * Bidirectional address translation between Medusa internal format
 * and protocol-specific formats (ACP, UCP).
 */

import { normalizeCountryCode } from "./country-codes"

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

// Per ACP spec Address (2026-01-30):
// Required: name, line_one, city, state, country, postal_code
// NOTE: phone_number is NOT on Address — it's on FulfillmentDetails.
export type AcpAddress = {
  name?: string
  line_one?: string
  line_two?: string
  city?: string
  state?: string
  country?: string
  postal_code?: string
}

// Per spec postal_address.json:
// - street_address, extended_address, address_locality, address_region,
//   address_country, postal_code, first_name, last_name, phone_number
export type UcpAddress = {
  first_name?: string
  last_name?: string
  street_address?: string
  extended_address?: string
  address_locality?: string
  address_region?: string
  address_country?: string
  postal_code?: string
  phone_number?: string
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
    country: addr.country_code || undefined,
    postal_code: addr.postal_code || undefined,
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

  // Normalize country to ISO 3166-1 alpha-2 lowercase (Medusa requirement).
  // Input may be alpha-2, alpha-3, or full name per UCP/ACP spec tolerance.
  const country = normalizeCountryCode(addr.country) || undefined

  return {
    first_name: firstName,
    last_name: lastName,
    address_1: addr.line_one || undefined,
    address_2: addr.line_two || undefined,
    city: addr.city || undefined,
    province: addr.state || undefined,
    postal_code: addr.postal_code || undefined,
    country_code: country,
  }
}

// --- Medusa <-> UCP ---

export function medusaToUcpAddress(addr: MedusaAddress): UcpAddress {
  return {
    first_name: addr.first_name || undefined,
    last_name: addr.last_name || undefined,
    street_address: addr.address_1 || undefined,
    extended_address: addr.address_2 || undefined,
    address_locality: addr.city || undefined,
    address_region: addr.province || undefined,
    address_country: addr.country_code || undefined,
    postal_code: addr.postal_code || undefined,
    phone_number: addr.phone || undefined,
  }
}

export function ucpAddressToMedusa(addr: UcpAddress): MedusaAddress {
  // Normalize country. UCP spec explicitly permits alpha-2, alpha-3, or full
  // country name. Medusa internally requires alpha-2 lowercase.
  const country = normalizeCountryCode(addr.address_country) || undefined

  return {
    first_name: addr.first_name || undefined,
    last_name: addr.last_name || undefined,
    address_1: addr.street_address || undefined,
    address_2: addr.extended_address || undefined,
    city: addr.address_locality || undefined,
    province: addr.address_region || undefined,
    postal_code: addr.postal_code || undefined,
    country_code: country,
    phone: addr.phone_number || undefined,
  }
}
