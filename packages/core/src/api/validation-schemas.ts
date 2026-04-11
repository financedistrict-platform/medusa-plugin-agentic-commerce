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

// UCP address format (protocol-facing)
const UcpAddressSchema = z.object({
  name: z.string().optional(),
  line1: z.string(),
  line2: z.string().optional(),
  city: z.string(),
  state: z.string().optional(),
  postal_code: z.string(),
  country: z.string().min(2).max(2),
  phone: z.string().optional(),
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
    country: z.string().optional(),
    region: z.string().optional(),
    currency: z.string().optional(),
  }).optional(),
  buyer: z.object({
    email: z.string().email().optional(),
    name: z.string().optional(),
  }).optional(),
  shipping_address: UcpAddressSchema.optional(),
})

export const UpdateUcpCheckoutSessionSchema = z.object({
  line_items: z.array(z.object({
    item: z.object({ id: z.string() }).optional(),
    line_item_id: z.string().optional(),
    quantity: z.number().int().min(0),
  })).optional(),
  buyer: z.object({
    email: z.string().email().optional(),
    name: z.string().optional(),
  }).optional(),
  shipping_address: UcpAddressSchema.optional(),
})

/**
 * UCP complete checkout schema.
 * Uses the instrument model matching UCP spec — handler + instrument with credential.
 */
export const CompleteUcpCheckoutSessionSchema = z.object({
  payment_credentials: z.object({
    handler: z.string().optional(), // "xyz.fd.prism_payment"
    instrument: z.object({
      type: z.string().optional(), // "eip3009_authorization"
      credential: z.object({
        /** Base64-encoded x402 PaymentAuthorizationResult JSON */
        authorization: z.string().optional(),
        /** x402 protocol version (1 or 2) */
        x402_version: z.number().int().optional(),
      }).optional(),
    }).optional(),
    /** @deprecated Legacy flat token field. Use instrument.credential.authorization instead. */
    token: z.string().optional(),
    chain: z.string().optional(),
    currency: z.string().optional(),
  }).optional(),
})

// --- UCP Cart schemas ---

export const CreateUcpCartSchema = z.object({
  line_items: z.array(z.object({
    item: z.object({ id: z.string() }),
    quantity: z.number().int().positive(),
  })).optional(),
  context: z.object({
    country: z.string().optional(),
    region: z.string().optional(),
    currency: z.string().optional(),
  }).optional(),
  buyer: z.object({
    email: z.string().email().optional(),
  }).optional(),
})

export const UpdateUcpCartSchema = z.object({
  line_items: z.array(z.object({
    item: z.object({ id: z.string() }).optional(),
    line_item_id: z.string().optional(),
    quantity: z.number().int().min(0),
  })).optional(),
  buyer: z.object({
    email: z.string().email().optional(),
  }).optional(),
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
