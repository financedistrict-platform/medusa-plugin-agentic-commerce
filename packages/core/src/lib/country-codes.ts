/**
 * Country code normalization utility.
 *
 * UCP spec (postal_address.json) permits address_country as ISO 3166-1 alpha-2
 * (preferred), alpha-3 (backward compat), or full country name. Medusa's
 * internal cart/region model only accepts alpha-2 lowercase country codes, so
 * we normalize at the protocol boundary.
 */

// ISO 3166-1 alpha-3 → alpha-2 mapping (most-used countries).
// Add more as needed; unknown codes return null.
const ALPHA3_TO_ALPHA2: Record<string, string> = {
  AFG: "AF", ALB: "AL", DZA: "DZ", AND: "AD", AGO: "AO", ARG: "AR", ARM: "AM",
  AUS: "AU", AUT: "AT", AZE: "AZ", BHS: "BS", BHR: "BH", BGD: "BD", BRB: "BB",
  BLR: "BY", BEL: "BE", BLZ: "BZ", BEN: "BJ", BTN: "BT", BOL: "BO", BIH: "BA",
  BWA: "BW", BRA: "BR", BRN: "BN", BGR: "BG", BFA: "BF", BDI: "BI", KHM: "KH",
  CMR: "CM", CAN: "CA", CPV: "CV", CAF: "CF", TCD: "TD", CHL: "CL", CHN: "CN",
  COL: "CO", COM: "KM", COG: "CG", COD: "CD", CRI: "CR", CIV: "CI", HRV: "HR",
  CUB: "CU", CYP: "CY", CZE: "CZ", DNK: "DK", DJI: "DJ", DMA: "DM", DOM: "DO",
  ECU: "EC", EGY: "EG", SLV: "SV", GNQ: "GQ", ERI: "ER", EST: "EE", SWZ: "SZ",
  ETH: "ET", FJI: "FJ", FIN: "FI", FRA: "FR", GAB: "GA", GMB: "GM", GEO: "GE",
  DEU: "DE", GHA: "GH", GRC: "GR", GRD: "GD", GTM: "GT", GIN: "GN", GNB: "GW",
  GUY: "GY", HTI: "HT", HND: "HN", HUN: "HU", ISL: "IS", IND: "IN", IDN: "ID",
  IRN: "IR", IRQ: "IQ", IRL: "IE", ISR: "IL", ITA: "IT", JAM: "JM", JPN: "JP",
  JOR: "JO", KAZ: "KZ", KEN: "KE", KIR: "KI", KWT: "KW", KGZ: "KG", LAO: "LA",
  LVA: "LV", LBN: "LB", LSO: "LS", LBR: "LR", LBY: "LY", LIE: "LI", LTU: "LT",
  LUX: "LU", MDG: "MG", MWI: "MW", MYS: "MY", MDV: "MV", MLI: "ML", MLT: "MT",
  MHL: "MH", MRT: "MR", MUS: "MU", MEX: "MX", FSM: "FM", MDA: "MD", MCO: "MC",
  MNG: "MN", MNE: "ME", MAR: "MA", MOZ: "MZ", MMR: "MM", NAM: "NA", NRU: "NR",
  NPL: "NP", NLD: "NL", NZL: "NZ", NIC: "NI", NER: "NE", NGA: "NG", PRK: "KP",
  MKD: "MK", NOR: "NO", OMN: "OM", PAK: "PK", PLW: "PW", PSE: "PS", PAN: "PA",
  PNG: "PG", PRY: "PY", PER: "PE", PHL: "PH", POL: "PL", PRT: "PT", QAT: "QA",
  ROU: "RO", RUS: "RU", RWA: "RW", KNA: "KN", LCA: "LC", VCT: "VC", WSM: "WS",
  SMR: "SM", STP: "ST", SAU: "SA", SEN: "SN", SRB: "RS", SYC: "SC", SLE: "SL",
  SGP: "SG", SVK: "SK", SVN: "SI", SLB: "SB", SOM: "SO", ZAF: "ZA", KOR: "KR",
  SSD: "SS", ESP: "ES", LKA: "LK", SDN: "SD", SUR: "SR", SWE: "SE", CHE: "CH",
  SYR: "SY", TWN: "TW", TJK: "TJ", TZA: "TZ", THA: "TH", TLS: "TL", TGO: "TG",
  TON: "TO", TTO: "TT", TUN: "TN", TUR: "TR", TKM: "TM", TUV: "TV", UGA: "UG",
  UKR: "UA", ARE: "AE", GBR: "GB", USA: "US", URY: "UY", UZB: "UZ", VUT: "VU",
  VAT: "VA", VEN: "VE", VNM: "VN", YEM: "YE", ZMB: "ZM", ZWE: "ZW",
  HKG: "HK", MAC: "MO", TWN_: "TW",
}

// Common country name → alpha-2 (not exhaustive — just the frequent spellings)
const NAME_TO_ALPHA2: Record<string, string> = {
  "afghanistan": "AF", "albania": "AL", "algeria": "DZ", "argentina": "AR",
  "australia": "AU", "austria": "AT", "bangladesh": "BD", "belgium": "BE",
  "bolivia": "BO", "brazil": "BR", "bulgaria": "BG", "cambodia": "KH",
  "cameroon": "CM", "canada": "CA", "chile": "CL", "china": "CN",
  "colombia": "CO", "costa rica": "CR", "croatia": "HR", "cuba": "CU",
  "cyprus": "CY", "czech republic": "CZ", "czechia": "CZ", "denmark": "DK",
  "dominican republic": "DO", "ecuador": "EC", "egypt": "EG", "estonia": "EE",
  "ethiopia": "ET", "finland": "FI", "france": "FR", "germany": "DE",
  "ghana": "GH", "greece": "GR", "guatemala": "GT", "honduras": "HN",
  "hong kong": "HK", "hungary": "HU", "iceland": "IS", "india": "IN",
  "indonesia": "ID", "iran": "IR", "iraq": "IQ", "ireland": "IE",
  "israel": "IL", "italy": "IT", "japan": "JP", "jordan": "JO",
  "kazakhstan": "KZ", "kenya": "KE", "kuwait": "KW", "laos": "LA",
  "latvia": "LV", "lebanon": "LB", "libya": "LY", "lithuania": "LT",
  "luxembourg": "LU", "malaysia": "MY", "mexico": "MX", "morocco": "MA",
  "netherlands": "NL", "new zealand": "NZ", "nigeria": "NG", "norway": "NO",
  "pakistan": "PK", "panama": "PA", "paraguay": "PY", "peru": "PE",
  "philippines": "PH", "poland": "PL", "portugal": "PT", "qatar": "QA",
  "romania": "RO", "russia": "RU", "russian federation": "RU",
  "saudi arabia": "SA", "serbia": "RS", "singapore": "SG", "slovakia": "SK",
  "slovenia": "SI", "south africa": "ZA", "south korea": "KR", "korea": "KR",
  "spain": "ES", "sri lanka": "LK", "sudan": "SD", "sweden": "SE",
  "switzerland": "CH", "syria": "SY", "taiwan": "TW", "thailand": "TH",
  "tunisia": "TN", "turkey": "TR", "uganda": "UG", "ukraine": "UA",
  "united arab emirates": "AE", "uae": "AE", "united kingdom": "GB", "uk": "GB",
  "great britain": "GB", "united states": "US", "united states of america": "US",
  "usa": "US", "uruguay": "UY", "venezuela": "VE", "vietnam": "VN",
  "yemen": "YE", "zambia": "ZM", "zimbabwe": "ZW",
}

/**
 * Normalize a country input (alpha-2, alpha-3, or name) to ISO 3166-1 alpha-2
 * in lowercase, which is what Medusa expects.
 *
 * Returns null if the input cannot be resolved.
 */
export function normalizeCountryCode(input: string | undefined | null): string | null {
  if (!input) return null
  const s = input.trim()
  if (!s) return null

  // Check alias map first — it contains common non-ISO two-letter forms
  // like "UK" (officially GB) that should be rewritten, not passed through.
  const lower = s.toLowerCase()
  if (NAME_TO_ALPHA2[lower]) {
    return NAME_TO_ALPHA2[lower].toLowerCase()
  }

  // Alpha-2 passthrough
  if (s.length === 2 && /^[A-Za-z]{2}$/.test(s)) {
    return lower
  }

  // Alpha-3
  if (s.length === 3 && /^[A-Za-z]{3}$/.test(s)) {
    const alpha2 = ALPHA3_TO_ALPHA2[s.toUpperCase()]
    return alpha2 ? alpha2.toLowerCase() : null
  }

  // Multi-word country name not in alias map
  return null
}

/**
 * Check whether an input looks like a valid country specifier (for validation
 * before attempting normalization).
 */
export function isValidCountryInput(input: string | undefined | null): boolean {
  return normalizeCountryCode(input) !== null
}
