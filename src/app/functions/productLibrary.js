// Reads the HubSpot product library and reports where it disagrees with pricingRules.js.
//
// WHY THIS EXISTS
//
// On 2026-08-27 two sources of truth disagreed and nobody knew until a rep looked at a quote. The
// HubSpot product "Agent Accounts - Per 1,000 Emails Sent" said the first 50,000 emails were free;
// pricingRules.js and the workbook said $1.00 per thousand. Separately, onboarding said $0/$5K/$10K
// here and $5K/$10K/$15K in HubSpot. Both were found by eye, in the middle of quoting.
//
// This module makes that comparison mechanical. It is deliberately READ-ONLY and changes no
// pricing: it is the diagnostic that has to exist before the product library can safely become the
// single source of truth, because it answers the two questions that decision depends on --
//   1. does this portal actually expose tiered pricing over the API, and
//   2. which products disagree with the code right now.
//
// WHAT HUBSPOT EXPOSES  (developers.hubspot.com, Products API guide, 2026-03)
//
//   hs_pricing_model  enumeration: 'flat' | 'volume' | 'graduated' | 'stairstep'.
//                     NULL MEANS FLAT -- it is the effective default, not missing data.
//                       volume     -- one unit price for all units, set by the total quantity
//                       graduated  -- each tier prices only the units inside it  <-- our model
//                       stairstep  -- a flat fee based on the highest tier reached
//   hs_tier_ranges    stringified JSON: [{"start":0,"end":49999},{"start":50000}]
//                     The LAST tier omits "end" to mean open-ended.
//   hs_tier_prices    stringified JSON: [{"index":0,"price":0},{"index":1,"price":0.7}]
//                     `index` is the POSITION in hs_tier_ranges. Every range needs a price.
//                     In multi-currency portals each entry also carries "currency".
//
// TWO CAVEATS THAT DECIDE WHETHER THE FULL SWITCH IS EVEN POSSIBLE
//
//   1. hs_tier_ranges and hs_tier_prices are documented ONLY under the dated 2026-03 API and are
//      ABSENT from HubSpot's default-property table for products. They appear to be gated on a
//      Revenue Hub subscription. If this portal lacks them the read returns the product without
//      those keys -- which is why `tiersAvailable` below reports what actually came back rather
//      than assuming.
//   2. They are non-default properties, so a bare GET does not return them. They must be named
//      explicitly in `properties`. Forgetting that looks identical to the portal not having them,
//      so the request below always names them.
//
// The Node client's products binding is pinned to /crm/v3 paths, where tiered pricing is not
// documented (it should still serve arbitrary named properties, but that is inference). So the
// read goes through both: v3 via the typed client, and 2026-03 via apiRequest, and reports which
// one produced the tier data. That is the whole point -- to find out rather than to guess.

const rules = require('./pricingRules');
const { CATALOG } = require('./lineItemModel');

const TIER_PROPERTIES = ['hs_pricing_model', 'hs_tier_ranges', 'hs_tier_prices'];
const PRODUCT_PROPERTIES = ['name', 'price', 'hs_sku', 'recurringbillingfrequency', ...TIER_PROPERTIES];

// Cents, not dollars: every figure compared here is money, and 0.35 vs 0.3500000001 is not a
// disagreement worth reporting. Anything at or below half a cent is treated as equal.
const sameMoney = (left, right) => {
  if (left == null || right == null) return left == null && right == null;
  return Math.abs(Number(left) - Number(right)) <= 0.005;
};

const parseJsonProperty = (raw, label) => {
  if (raw == null || raw === '') return { value: null, error: null };
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) {
      return { value: null, error: `${label} is not a JSON array` };
    }
    return { value, error: null };
  } catch {
    // Reported, never thrown. One malformed product must not take down the whole comparison --
    // the point of this report is to see everything at once.
    return { value: null, error: `${label} is not valid JSON` };
  }
};

// HubSpot's two tier arrays, joined into the shape pricingRules uses: [lower, upper, rate].
//
// Boundaries are converted from HubSpot's INCLUSIVE end to our EXCLUSIVE upper. HubSpot's
// "0 - 49,999" and "50,000 - 99,999" are our [0, 50000) and [50000, 100000), so upper = end + 1.
// Getting this wrong by one is invisible in a rate table and wrong on exactly one unit per tier.
const bandsFromTiers = (ranges, prices) => {
  const priceByIndex = new Map();
  for (const entry of prices) {
    // Multi-currency portals repeat each index once per currency. Only USD is priced here, and a
    // missing currency field means a single-currency portal.
    if (entry?.currency && entry.currency !== rules.currency) continue;
    if (Number.isInteger(entry?.index)) priceByIndex.set(entry.index, Number(entry.price));
  }
  return ranges.map((range, index) => [
    Number(range?.start ?? 0),
    range?.end == null ? null : Number(range.end) + 1,
    priceByIndex.has(index) ? priceByIndex.get(index) : null,
  ]);
};

// Emails are stored in THOUSANDS in pricingRules -- unitOfMeasure '1,000 emails', so a rep typing
// 120 means 120,000. HubSpot states the same tiers in single emails. Comparing 50 against 50000
// would report a disagreement on every tier of a product that actually agrees, so the HubSpot
// boundaries are divided down to the unit pricingRules counts in.
const UNIT_DIVISOR = { agent_email_thousands: 1_000 };

const scaleBands = (bands, key) => {
  const divisor = UNIT_DIVISOR[key];
  if (!divisor) return bands;
  return bands.map(([lower, upper, rate]) => [
    lower / divisor,
    upper == null ? null : upper / divisor,
    rate,
  ]);
};

// What pricingRules claims each catalogued product costs, in the product's own terms, so there is
// something to compare a HubSpot product against. Returns null for products whose price is a RULE
// rather than a figure -- support is a percentage of platform ARR with a cap, and professional
// services are priced by how many were selected, not per item. Neither has a single number that
// could agree or disagree with a product's unit price, and pretending otherwise would produce
// noise in the report that a reader would learn to ignore.
const localExpectation = (key) => {
  const product = rules.products.find((entry) => entry.key === key);
  if (product) {
    return {
      kind: 'metered',
      bands: product.bands.map(([lower, upper, rate]) => [lower, upper, rate]),
      pricingModel: product.pricingModel === 'graduated_adjusted_bands' ? 'graduated' : 'flat',
      unitOfMeasure: product.unitOfMeasure,
    };
  }
  const onboarding = rules.onboardingRules.find((entry) => entry.key === key);
  if (onboarding) return { kind: 'one_time', amount: onboarding.oneTimeAmount };
  const addOn = rules.addOnRules.find((entry) => entry.key === key);
  if (addOn) return { kind: 'recurring_annual', amount: addOn.annualAmount };
  if (key === 'enterprise') {
    // The drawdown fee carries the whole platform commitment: its price is proposedPlatformArr
    // divided across the payments in a year. There is no unit price in the library that could
    // agree or disagree with it, and HubSpot's own price on this product is ignored entirely.
    return { kind: 'formula', note: 'platform ARR divided across the payments in a year' };
  }
  if (rules.supportRules.some((entry) => entry.key === key)) {
    return { kind: 'formula', note: 'percentage of platform ARR with an annual cap' };
  }
  if (rules.professionalServiceOptions.some((entry) => entry.key === key)) {
    return { kind: 'formula', note: 'priced by how many services were selected, not per item' };
  }
  return { kind: 'unpriced' };
};

const compareProduct = (key, catalogEntry, hubspot) => {
  const row = {
    key,
    productId: catalogEntry.id,
    localName: catalogEntry.name,
    found: Boolean(hubspot),
    disagreements: [],
    notes: [],
  };
  if (!hubspot) {
    // A catalogued id that HubSpot does not return is the most serious finding here: every line
    // item for it is built from that id, so the product is either archived or gone.
    row.disagreements.push({
      field: 'product',
      local: catalogEntry.id,
      hubspot: null,
      detail: 'no product with this id — line items built from it will fail',
    });
    return row;
  }

  const properties = hubspot.properties || {};
  row.hubspotName = properties.name ?? null;
  row.hubspotPrice = properties.price == null ? null : Number(properties.price);
  row.sku = properties.hs_sku ?? null;
  // Null is not missing data: HubSpot documents it as the effective 'flat' default.
  row.hubspotPricingModel = properties.hs_pricing_model || 'flat';
  row.tiersAvailable = Object.prototype.hasOwnProperty.call(properties, 'hs_tier_ranges');

  if (row.hubspotName && row.hubspotName !== catalogEntry.name) {
    // This is the "Enterprise Drawdown Fee" class of problem. It no longer reaches a line item --
    // the app stopped sending `name` -- but a stale local label still shows up in logs and tests,
    // and it is how the drift was noticed in the first place.
    row.disagreements.push({
      field: 'name',
      local: catalogEntry.name,
      hubspot: row.hubspotName,
      detail: 'local label is stale; HubSpot owns the name',
    });
  }

  const expectation = localExpectation(key);
  row.localKind = expectation.kind;

  if (expectation.kind === 'formula') {
    row.notes.push(`priced by rule, not by unit price: ${expectation.note}`);
    return row;
  }

  if (expectation.kind === 'one_time' || expectation.kind === 'recurring_annual') {
    if (!sameMoney(expectation.amount, row.hubspotPrice)) {
      row.disagreements.push({
        field: 'price',
        local: expectation.amount,
        hubspot: row.hubspotPrice,
        detail: 'fixed amount differs',
      });
    }
    return row;
  }

  if (expectation.kind !== 'metered') return row;

  row.localPricingModel = expectation.pricingModel;
  if (row.hubspotPricingModel !== expectation.pricingModel) {
    // Graduated vs volume is not a rounding difference. At 60,000 emails graduated bills $7 and
    // volume bills $42 on the same tier table, so this single field can be a 6x error.
    row.disagreements.push({
      field: 'hs_pricing_model',
      local: expectation.pricingModel,
      hubspot: row.hubspotPricingModel,
      detail: 'graduated bills each tier separately; volume bills every unit at the landed tier',
    });
  }

  if (!row.tiersAvailable) {
    // Distinguishes "this portal cannot express tiers" from "this product has none". Only the
    // first blocks sourcing the rate card from HubSpot.
    row.notes.push(
      'hs_tier_ranges absent — either this portal has no tiered pricing (Revenue Hub) or the ' +
        'property was not requested',
    );
    if (expectation.bands.length === 1 && !sameMoney(expectation.bands[0][2], row.hubspotPrice)) {
      row.disagreements.push({
        field: 'price',
        local: expectation.bands[0][2],
        hubspot: row.hubspotPrice,
        detail: 'single-rate product, unit price differs',
      });
    }
    return row;
  }

  const ranges = parseJsonProperty(properties.hs_tier_ranges, 'hs_tier_ranges');
  const prices = parseJsonProperty(properties.hs_tier_prices, 'hs_tier_prices');
  if (ranges.error) row.notes.push(ranges.error);
  if (prices.error) row.notes.push(prices.error);
  if (!ranges.value || !prices.value) return row;

  const hubspotBands = scaleBands(bandsFromTiers(ranges.value, prices.value), key);
  row.hubspotBands = hubspotBands;
  row.localBands = expectation.bands;

  if (hubspotBands.length !== expectation.bands.length) {
    row.disagreements.push({
      field: 'tier count',
      local: expectation.bands.length,
      hubspot: hubspotBands.length,
      detail: 'different number of tiers — compare the tables directly',
    });
    return row;
  }
  expectation.bands.forEach(([lower, upper, rate], index) => {
    const [hsLower, hsUpper, hsRate] = hubspotBands[index];
    if (lower !== hsLower || upper !== hsUpper) {
      row.disagreements.push({
        field: `tier ${index + 1} range`,
        local: `${lower}–${upper == null ? '∞' : upper}`,
        hubspot: `${hsLower}–${hsUpper == null ? '∞' : hsUpper}`,
        detail: 'boundaries differ (HubSpot end is inclusive; these are exclusive uppers)',
      });
    }
    if (!sameMoney(rate, hsRate)) {
      row.disagreements.push({
        field: `tier ${index + 1} rate`,
        local: rate,
        hubspot: hsRate,
        detail: 'rate differs',
      });
    }
  });
  return row;
};

// Two reads, deliberately. The typed client is pinned to /crm/v3, where tiered pricing is not
// documented; 2026-03 is where it is. Rather than pick one and hope, both run and the report says
// which produced the tier data -- that is the fact the full switch depends on.
const readProducts = async (client, ids) => {
  const inputs = ids.map((id) => ({ id }));
  const attempts = [];

  const record = (source, results, error) => {
    attempts.push({
      source,
      ok: !error,
      count: results ? results.length : 0,
      tierPropertyReturned: Boolean(
        results?.some((entry) =>
          Object.prototype.hasOwnProperty.call(entry.properties || {}, 'hs_tier_ranges'),
        ),
      ),
      error: error ? String(error?.message || error) : null,
    });
  };

  let results = null;
  try {
    const response = await client.crm.products.batchApi.read({
      inputs,
      properties: PRODUCT_PROPERTIES,
      propertiesWithHistory: [],
    });
    results = response?.results || [];
    record('crm/v3 batch read', results, null);
  } catch (error) {
    record('crm/v3 batch read', null, error);
  }

  // Only worth a second call if v3 gave nothing or gave no tier data.
  if (!results?.length || !attempts[0].tierPropertyReturned) {
    try {
      const response = await client.apiRequest({
        method: 'POST',
        path: '/crm/objects/2026-03/products/batch/read',
        body: { inputs, properties: PRODUCT_PROPERTIES, propertiesWithHistory: [] },
      });
      const body = typeof response?.json === 'function' ? await response.json() : response?.body;
      const dated = body?.results || [];
      record('crm/objects/2026-03 batch read', dated, null);
      // Preferred only when it actually adds the tier data; otherwise v3's answer stands.
      if (dated.length && (!results?.length || attempts[1].tierPropertyReturned)) {
        results = dated;
      }
    } catch (error) {
      record('crm/objects/2026-03 batch read', null, error);
    }
  }

  return { results: results || [], attempts };
};

const inspectProductLibrary = async (client) => {
  const entries = Object.entries(CATALOG);
  const { results, attempts } = await readProducts(
    client,
    entries.map(([, entry]) => entry.id),
  );
  const byId = new Map(results.map((entry) => [String(entry.id), entry]));
  const rows = entries.map(([key, entry]) => compareProduct(key, entry, byId.get(String(entry.id))));

  const disagreeing = rows.filter((row) => row.disagreements.length > 0);
  return {
    checkedAt: new Date().toISOString(),
    priceListVersion: rules.priceListVersion,
    reads: attempts,
    // The headline: whether this portal can express tiered pricing over the API at all. Sourcing
    // the rate card from HubSpot is impossible for graduated products if this is false.
    tieredPricingAvailable: rows.some((row) => row.tiersAvailable),
    productCount: rows.length,
    missingCount: rows.filter((row) => !row.found).length,
    disagreementCount: disagreeing.reduce((sum, row) => sum + row.disagreements.length, 0),
    rows,
  };
};

module.exports = {
  inspectProductLibrary,
  _test: {
    bandsFromTiers,
    scaleBands,
    compareProduct,
    localExpectation,
    parseJsonProperty,
    sameMoney,
    PRODUCT_PROPERTIES,
  },
};
