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

// ACP Address — per schema.agentic_checkout.json (2026-01-30)
// Required: name, line_one, city, state, country, postal_code
// additionalProperties: false (no phone_number — that lives on FulfillmentDetails)
const AcpAddressSchema = z.object({
  name: z.string(),
  line_one: z.string(),
  line_two: z.string().optional(),
  city: z.string(),
  state: z.string(),
  country: z.string().length(2), // ISO 3166-1 alpha-2
  postal_code: z.string(),
})

// ACP FulfillmentDetails — per spec
// Required: address. Optional: name, email, phone_number.
const AcpFulfillmentDetailsSchema = z.object({
  name: z.string().optional(),
  email: z.string().email().optional(),
  phone_number: z.string().optional(),
  address: AcpAddressSchema,
})

// ACP Buyer — per spec schema.agentic_checkout.json
// Required: email
const AcpBuyerSchema = z.object({
  email: z.string().email(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  full_name: z.string().optional(),
  phone_number: z.string().optional(),
  customer_id: z.string().optional(),
  account_type: z.enum(["guest", "registered", "business"]).optional(),
  authentication_status: z.enum(["authenticated", "guest", "requires_signin"]).optional(),
})

// ACP Item (request) — per spec: { id (required), name?, unit_amount? }
// Note: quantity is NOT on Item per spec — duplicates in line_items[] imply quantity.
// For merchant convenience we also accept a non-spec `quantity` which, when present,
// is used directly; otherwise we aggregate by id.
const AcpItemSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  unit_amount: z.number().int().optional(),
  // Non-spec convenience field — accepted for backward compat
  quantity: z.number().int().positive().optional(),
})

// ACP Capabilities (request) — required on create per spec
const AcpCapabilitiesSchema = z.object({
  payment: z.object({
    handlers: z.array(z.any()).optional(),
  }).optional(),
  interventions: z.any().optional(),
  extensions: z.any().optional(),
})

// ACP SelectedFulfillmentOption — per spec
const AcpSelectedFulfillmentOptionSchema = z.object({
  fulfillment_option_id: z.string(),
  fulfillment_group_id: z.string().optional(),
})

// ACP DiscountsRequest — per spec
const AcpDiscountsRequestSchema = z.object({
  codes: z.array(z.string()).optional(),
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

// ACP CheckoutSessionCreateRequest — per spec
// Required: line_items, currency, capabilities
// additionalProperties: false in spec — we keep it tolerant but don't accept non-spec fields here.
export const CreateAcpCheckoutSessionSchema = z.object({
  line_items: z.array(AcpItemSchema).min(1),
  currency: z.string(),
  capabilities: AcpCapabilitiesSchema,
  buyer: AcpBuyerSchema.optional(),
  fulfillment_details: AcpFulfillmentDetailsSchema.optional(),
  fulfillment_groups: z.array(z.any()).optional(),
  affiliate_attribution: z.any().optional(),
  coupons: z.array(z.string()).optional(), // deprecated per spec
  discounts: AcpDiscountsRequestSchema.optional(),
  locale: z.string().optional(),
  timezone: z.string().optional(),
  quote_id: z.string().optional(),
  metadata: z.record(z.any()).optional(),
})

// ACP CheckoutSessionUpdateRequest — per spec
// All fields optional.
export const UpdateAcpCheckoutSessionSchema = z.object({
  buyer: AcpBuyerSchema.partial().optional(),
  line_items: z.array(AcpItemSchema).optional(),
  fulfillment_details: AcpFulfillmentDetailsSchema.optional(),
  fulfillment_groups: z.array(z.any()).optional(),
  selected_fulfillment_options: z.array(AcpSelectedFulfillmentOptionSchema).optional(),
  coupons: z.array(z.string()).optional(),
  discounts: AcpDiscountsRequestSchema.optional(),
})

// ACP CheckoutSessionCompleteRequest — per spec
// Required: payment_data
// payment_data.anyOf: { handler_id + instrument } OR { purchase_order_number }
// PaymentData.instrument.credential requires { type, token }.
// Billing address lives INSIDE payment_data per spec (not at top level).
export const CompleteAcpCheckoutSessionSchema = z.object({
  payment_data: z.object({
    handler_id: z.string().optional(),
    instrument: z.object({
      type: z.string(),
      credential: z.object({
        type: z.string(),
        token: z.string().optional(),
        // Handler-specific extension fields (for x402/Prism etc.)
        authorization: z.string().optional(),
        x402_version: z.number().int().optional(),
      }).passthrough(),
    }).optional(),
    billing_address: AcpAddressSchema.optional(),
    purchase_order_number: z.string().optional(),
    payment_terms: z.enum(["immediate", "net_15", "net_30", "net_60", "net_90"]).optional(),
    due_date: z.string().datetime().optional(),
    approval_required: z.boolean().optional(),
  }),
  buyer: AcpBuyerSchema.partial().optional(),
  authentication_result: z.any().optional(),
  affiliate_attribution: z.any().optional(),
  risk_signals: z.any().optional(),
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
