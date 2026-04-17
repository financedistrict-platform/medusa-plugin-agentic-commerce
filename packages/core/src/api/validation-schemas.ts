import { z } from "@medusajs/framework/zod"

// --- Shared schemas ---

// Medusa internal address format (used by workflows)
const MedusaAddressSchema = z.object({
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  address_1: z.string(),
  address_2: z.string().optional(),
  city: z.string(),
  province: z.string().optional(),
  postal_code: z.string(),
  country_code: z.string().min(2).max(2),
  phone: z.string().optional(),
})

// ACP address format (protocol-facing)
const AcpAddressSchema = z.object({
  name: z.string().optional(),
  line_one: z.string(),
  line_two: z.string().optional(),
  city: z.string(),
  state: z.string().optional(),
  postal_code: z.string(),
  country: z.string().min(2).max(2),
  phone_number: z.string().optional(),
})

// UCP address format — per spec postal_address.json
const UcpAddressSchema = z.object({
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  street_address: z.string(),
  extended_address: z.string().optional(),
  address_locality: z.string(),
  address_region: z.string().optional(),
  address_country: z.string().min(2),
  postal_code: z.string(),
  phone_number: z.string().optional(),
})

// UCP buyer — per spec buyer.json
const UcpBuyerSchema = z.object({
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  email: z.string().email().optional(),
  phone_number: z.string().optional(),
})

// --- ACP schemas ---
// ACP uses items[].id (not variant_id), fulfillment_details (not fulfillment_address)

export const CreateAcpCheckoutSessionSchema = z.object({
  items: z.array(z.object({
    id: z.string(),
    quantity: z.number().int().positive(),
  })).min(1),
  region_id: z.string().optional(),
  currency_code: z.string().optional(),
  buyer: z.object({
    email: z.string().email(),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    phone_number: z.string().optional(),
  }).optional(),
  fulfillment_details: z.object({
    name: z.string().optional(),
    email: z.string().email().optional(),
    phone_number: z.string().optional(),
    address: AcpAddressSchema,
  }).optional(),
  webhook_url: z.string().url().optional(),
})

export const UpdateAcpCheckoutSessionSchema = z.object({
  items: z.array(z.object({
    id: z.string(),
    quantity: z.number().int().positive(),
  })).optional(),
  buyer: z.object({
    email: z.string().email().optional(),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
  }).optional(),
  fulfillment_details: z.object({
    name: z.string().optional(),
    address: AcpAddressSchema,
  }).optional(),
  fulfillment_option_id: z.string().optional(),
})

/**
 * ACP complete checkout schema.
 * Instrument type is handler-defined — we accept "eip3009_authorization" for Prism.
 * The credential contains the base64-encoded x402 PaymentAuthorizationResult.
 */
export const CompleteAcpCheckoutSessionSchema = z.object({
  payment_data: z.object({
    handler_id: z.string().optional(),
    instrument: z.object({
      type: z.string().optional(), // "eip3009_authorization" for Prism
      credential: z.object({
        /** Base64-encoded x402 PaymentAuthorizationResult JSON */
        authorization: z.string().optional(),
        /** x402 protocol version (1 or 2) */
        x402_version: z.number().int().optional(),
        /** @deprecated Use authorization field. Kept for backwards compat. */
        token: z.string().optional(),
      }).optional(),
    }).optional(),
  }).optional(),
  buyer: z.object({
    email: z.string().email().optional(),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
  }).optional(),
  billing_address: AcpAddressSchema.optional(),
})

// --- UCP schemas ---
// UCP uses line_items[].item.id (not variant_id)

export const CreateUcpCheckoutSessionSchema = z.object({
  line_items: z.array(z.object({
    item: z.object({ id: z.string() }),
    quantity: z.number().int().positive(),
  })).min(1),
  context: z.object({
    address_country: z.string().optional(),
    address_region: z.string().optional(),
    postal_code: z.string().optional(),
    currency: z.string().optional(),
    language: z.string().optional(),
  }).optional(),
  buyer: UcpBuyerSchema.optional(),
  shipping_address: UcpAddressSchema.optional(),
})

export const UpdateUcpCheckoutSessionSchema = z.object({
  line_items: z.array(z.object({
    item: z.object({ id: z.string() }).optional(),
    line_item_id: z.string().optional(),
    quantity: z.number().int().min(0),
  })).optional(),
  buyer: UcpBuyerSchema.optional(),
  shipping_address: UcpAddressSchema.optional(),
})

/**
 * UCP payment instrument schema.
 * Matches the UCP spec: checkout.json → payment.json → payment_instrument.json
 */
const UcpPaymentInstrumentSchema = z.object({
  /** Unique identifier for this instrument instance */
  id: z.string().optional(),
  /** The handler instance that produced this instrument (e.g., "prism_default") */
  handler_id: z.string().optional(),
  /** Broad category of the instrument (e.g., "default", "card") */
  type: z.string().optional(),
  /** Payment credential — structure is handler-defined */
  credential: z.record(z.unknown()).optional(),
})

/**
 * UCP complete checkout schema.
 * Matches the UCP spec: payment is required on complete, contains instruments[].
 * Also accepts legacy payment_credentials for backwards compatibility.
 */
export const CompleteUcpCheckoutSessionSchema = z.object({
  /** UCP spec payment field — required on complete per checkout.json */
  payment: z.object({
    instruments: z.array(UcpPaymentInstrumentSchema).min(1),
  }).optional(),
})

// --- UCP Cart schemas ---

export const CreateUcpCartSchema = z.object({
  line_items: z.array(z.object({
    item: z.object({ id: z.string() }),
    quantity: z.number().int().positive(),
  })).optional(),
  context: z.object({
    address_country: z.string().optional(),
    address_region: z.string().optional(),
    postal_code: z.string().optional(),
    currency: z.string().optional(),
    language: z.string().optional(),
  }).optional(),
  buyer: UcpBuyerSchema.optional(),
})

export const UpdateUcpCartSchema = z.object({
  line_items: z.array(z.object({
    item: z.object({ id: z.string() }).optional(),
    line_item_id: z.string().optional(),
    quantity: z.number().int().min(0),
  })).optional(),
  buyer: UcpBuyerSchema.optional(),
  shipping_address: UcpAddressSchema.optional(),
})

// --- UCP Catalog schemas ---

export const CatalogSearchSchema = z.object({
  query: z.string().optional(),
  filters: z.object({
    category: z.string().optional(),
    min_price: z.number().optional(),
    max_price: z.number().optional(),
  }).optional(),
  pagination: z.object({
    limit: z.number().int().positive().max(100).optional().default(20),
    offset: z.number().int().min(0).optional().default(0),
  }).optional(),
})

export const CatalogLookupSchema = z.object({
  ids: z.array(z.string()).min(1),
})
