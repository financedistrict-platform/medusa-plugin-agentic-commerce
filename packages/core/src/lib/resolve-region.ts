/**
 * Region resolution utility.
 *
 * When an agent updates a cart's shipping address to a country that's not
 * in the cart's current region's country list, Medusa rejects the update
 * with "Country with code X is not within region Y".
 *
 * This utility finds the right region for a given country by querying the
 * store's region configuration, so we can either switch the cart's region
 * automatically or emit a spec-compliant error listing supported countries.
 */

export type RegionMatch = {
  id: string
  name: string
  currency_code: string
  countries: string[]
}

/**
 * Find a region that contains the given (alpha-2 lowercase) country code.
 * Returns null if no region supports it.
 */
export async function findRegionForCountry(
  scope: any,
  countryCode: string
): Promise<RegionMatch | null> {
  const query = scope.resolve("query") as any
  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["id", "name", "currency_code", "countries.iso_2"],
  })

  for (const region of regions || []) {
    const codes = (region.countries || []).map((c: any) => c.iso_2?.toLowerCase())
    if (codes.includes(countryCode.toLowerCase())) {
      return {
        id: region.id,
        name: region.name,
        currency_code: region.currency_code,
        countries: codes,
      }
    }
  }
  return null
}

/**
 * Return all countries supported by any region in the store.
 * Used in error messages so agents can adapt.
 */
export async function getSupportedCountries(scope: any): Promise<string[]> {
  const query = scope.resolve("query") as any
  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["countries.iso_2"],
  })

  const set = new Set<string>()
  for (const region of regions || []) {
    for (const c of region.countries || []) {
      if (c.iso_2) set.add(c.iso_2.toLowerCase())
    }
  }
  return Array.from(set).sort()
}

/**
 * Resolve a cart's region for an incoming address update.
 *
 * Returns:
 *   - { supported: true, regionId, shouldSwitch } — we can proceed. shouldSwitch
 *     is true when the cart's current region doesn't match and we need to switch.
 *   - { supported: false, supportedCountries } — no region supports this country;
 *     caller should emit a spec-compliant error listing alternatives.
 */
export async function resolveRegionForAddressUpdate(
  scope: any,
  cartId: string,
  countryCode: string
): Promise<
  | { supported: true; regionId: string; shouldSwitch: boolean }
  | { supported: false; supportedCountries: string[] }
> {
  const query = scope.resolve("query") as any
  const [{ data: [cart] }, match] = await Promise.all([
    query.graph({
      entity: "cart",
      fields: ["id", "region_id"],
      filters: { id: cartId },
    }),
    findRegionForCountry(scope, countryCode),
  ])

  if (!match) {
    const supportedCountries = await getSupportedCountries(scope)
    return { supported: false, supportedCountries }
  }

  const shouldSwitch = cart && cart.region_id !== match.id
  return { supported: true, regionId: match.id, shouldSwitch }
}
