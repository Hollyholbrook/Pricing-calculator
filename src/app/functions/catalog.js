// ===========================================================================
// The catalogue — ONE list instead of four
// ===========================================================================
//
// Phase 1 of claude/configurable-from-hubspot-proposal.md, built 2026-09-03.
//
// The product and option list existed in FOUR places: pricingRules, lineItemModel.CATALOG,
// NylasPricingBuilder.tsx (keys AND labels AND order, all literal) and PRODUCT_LINE_ORDER.
// Nothing enforced agreement between them; productLibrary.js exists because two of them drifted
// and it was found by eye, mid-quote.
//
// This module is the single source. Keys and pricing come from pricingRules -- so the catalogue can
// never offer something the calculator cannot price. Presentation comes from the table below, which
// is what the card used to hold.
//
// WHY A PRESENTATION TABLE AND NOT pricingRules LABELS: they differ, and the difference is
// deliberate. The rate card says "Basic Support", "Quick Launch +", "Annual In Advance"; the card
// shows "Basic", "Quick Launch Plus", "Annual in Advance". Phase 1 must change NOTHING a rep sees,
// so the card's strings are what moved here -- verbatim.
//
// WHY NOT PRODUCT NAMES FROM HUBSPOT: measured in claude/configurable-calculator-smoke-test.md --
// 15 of 21 labels change, "Email + Calendar" (16 chars) becomes "Connect - Email + Calendar
// Connected Accounts (CA)" (50) in a 300px column, and 5 of 7 metered products have a blank
// description. Product `name` keeps owning what prints on the QUOTE. That is already the rule.
//
// Amounts are NOT here. Holly, 2026-09-03: products own names, order and status; every amount stays
// in Settings behind SETTINGS_ADMIN_USER_IDS, because product-edit rights are portal-wide and
// cannot be narrowed. See claude/configurability-decisions-2026-09-03.md.

const pricingRules = require('./pricingRules');
const { buildActiveRules } = require('./calculator');

// Card presentation only: the description under a product name, its input unit, and the order the
// card lists them in. Labels come from pricingRules.products[].name, which already matches the
// card's product labels exactly (checked for all seven).
const PRODUCT_PRESENTATION = Object.freeze({
  connect_ca: { description: 'Connected accounts', unit: 'CA/month', sort: 10 },
  calendar_ca: { description: 'Calendar-only accounts', unit: 'calendars/month', sort: 20 },
  notetaker_bot_hours: { description: 'Bot hours', unit: 'bot hours/month', sort: 30 },
  agent_accounts: { description: 'Agent accounts', unit: 'accounts/month', sort: 40 },
  agent_email_thousands: { description: 'Emails in thousands', unit: '1,000 emails', sort: 50 },
  agent_storage_gb: { description: 'Storage', unit: 'GB/month', sort: 60 },
  agent_bandwidth_gb: { description: 'Bandwidth', unit: 'GB/month', sort: 70 },
});

// Where the card's wording differs from the rate card's, the card's wins -- see the header.
const LABEL_OVERRIDES = Object.freeze({
  support: { basic: 'Basic', full: 'Full', premium: 'Premium' },
  onboarding: { quick_launch_plus: 'Quick Launch Plus' },
  addOn: {
    // "(requires Professional Services)" is a real rule, not decoration: selecting this add-on
    // without a Professional Services item blocks Lock in. Saying so on the checkbox is cheaper
    // than letting the rep discover it from a red banner after building the quote.
    verified_oauth: 'Turnkey Verified OAuth Projects (requires Professional Services)',
  },
  payment: {
    annual_in_advance: 'Annual in Advance',
    semi_annual_in_advance: 'Semi-Annual in Advance',
    quarterly_in_advance: 'Quarterly in Advance',
    monthly_in_advance: 'Monthly in Advance',
  },
});

// RETIRED, not deleted.
//
// A Deal saved before 2026-08-31 carries enterprise_accelerator in input.addOns. MultiSelect is
// given `value` and `options` together, so a stored value with no matching option STOPS THE CARD
// RENDERING -- the failure that looked like "refresh stopped working" with an empty function log.
// The catalogue therefore reports it as deprecated rather than omitting it, and the card decides
// whether to offer it. Key retention is prerequisite #1 for Phase 2 in the smoke test.
const RETIRED_ADD_ONS = Object.freeze(['enterprise_accelerator']);

const override = (group, key, fallback) =>
  LABEL_OVERRIDES[group]?.[key] ?? fallback;

// Every key the calculator knows must reach the catalogue, and nothing may reach it that the
// calculator does not know. A presentation entry for a key that no longer exists, or a product
// with no presentation entry, is exactly the drift this module exists to end -- so it throws
// rather than rendering a product with a blank unit or silently dropping one.
// Pure, so it can be tested in both directions without doctoring the rate card at require time.
const presentationMismatch = (ruleKeys, presentationKeys) => {
  const missing = ruleKeys.filter((key) => !presentationKeys.includes(key));
  const extra = presentationKeys.filter((key) => !ruleKeys.includes(key));
  if (missing.length === 0 && extra.length === 0) return '';
  return (
    'CATALOG_PRESENTATION_MISMATCH:' +
    `${missing.length > 0 ? ` missing ${missing.join(',')}` : ''}` +
    `${extra.length > 0 ? ` extra ${extra.join(',')}` : ''}`
  );
};

const assertPresentationCoverage = () => {
  const problem = presentationMismatch(
    pricingRules.products.map(({ key }) => key),
    Object.keys(PRODUCT_PRESENTATION),
  );
  if (problem) throw new Error(problem);
};

// PRICES COME FROM THE ACTIVE RULES, NOT THE FROZEN RATE CARD.
//
// buildActiveRules merges the settings record's pricingPolicy over pricingRules, so an amount an
// admin changed in Settings shows on the card immediately. Passing the raw rate card here would
// have the card display a price the calculator does not charge -- the same class of bug as taking
// a figure from pricingRules for the contract summary.
//
// Only AMOUNTS come from there. Labels, descriptions, units and order stay presentation, and
// amounts stay behind SETTINGS_ADMIN_USER_IDS -- Holly, 2026-09-03.
const buildCatalog = (pricingPolicy = {}) => {
  assertPresentationCoverage();
  const active = buildActiveRules(pricingPolicy);
  return {
    products: pricingRules.products
      .map(({ key, name }) => ({
        key,
        label: name,
        description: PRODUCT_PRESENTATION[key].description,
        unit: PRODUCT_PRESENTATION[key].unit,
        role: 'metered',
        sort: PRODUCT_PRESENTATION[key].sort,
        // Band-priced per unit, so there is no single list price -- the bands are the price, and
        // they are already sent as productRates for the Settings screen.
        billingUnit: 'per month',
        listPrice: null,
        deprecated: false,
      }))
      .sort((left, right) => left.sort - right.sort),
    // SUPPORT HAS NO FIXED LIST PRICE. It is percentOfPlatformArr of the proposed platform ARR,
    // capped at annualCap -- so its figure depends on the deal and is computed, never looked up.
    // listPrice is null on purpose: the card must compute it, not display a constant. The percent
    // and cap are sent so it can, and so an override can be checked against the cap.
    support: active.supportRules.map(({ key, level, percentOfPlatformArr, annualCap }) => ({
      key,
      label: override('support', key, level),
      role: 'support',
      billingUnit: 'per year',
      listPrice: null,
      percentOfPlatformArr,
      annualCap,
      deprecated: false,
    })),
    onboarding: active.onboardingRules.map(({ key, package: name, oneTimeAmount }) => ({
      key,
      label: override('onboarding', key, name),
      role: 'onboarding',
      billingUnit: 'one-time',
      listPrice: oneTimeAmount,
      deprecated: false,
    })),
    addOns: active.addOnRules.map(({ key, label, deprecated, annualAmount }) => ({
      key,
      label: override('addOn', key, label),
      role: 'add_on',
      billingUnit: 'per year',
      listPrice: annualAmount,
      // Either flag retires it: the rate card's own `deprecated`, or this module's list.
      deprecated: Boolean(deprecated) || RETIRED_ADD_ONS.includes(key),
    })),
    // PROFESSIONAL SERVICES ARE PRICED BY BUNDLE COUNT, NOT PER SERVICE.
    //
    // 1 -> 2,000 | 2 -> 3,800 | 3 -> 5,500 | 4 -> 7,200 | 5 -> 8,800. Note the break at 2: 3,800,
    // not 4,000. There is no per-service price and inventing one would not sum to the ladder, so
    // listPrice is null on every service and the ladder is sent separately. Holly, 2026-09-03:
    // one row carrying the ladder price, with the chosen services named beneath it.
    professionalServices: pricingRules.professionalServiceOptions.map(({ key, label }) => ({
      key,
      label,
      role: 'professional_service',
      billingUnit: 'one-time',
      listPrice: null,
      deprecated: false,
    })),
    professionalServicesLadder: active.professionalServicesRules.map(
      ({ itemCount, oneTimeAmount }) => ({ itemCount, listPrice: oneTimeAmount }),
    ),
    // The card used to restate 12/24/36 as literals beside allowedTerms. One source now.
    terms: pricingRules.allowedTerms.map((months) => ({
      key: months,
      label: `${months} months`,
    })),
    payments: pricingRules.paymentRules.map(({ key, label }) => ({
      key,
      label: override('payment', key, label),
    })),
  };
};

// The zero-filled maps the card builds for a fresh calculation. Derived, so a product added to the
// rate card cannot be missing from them -- which is how a key ends up absent from `volumes` and
// throws UNSUPPORTED_FIELD on the next submit.
const emptyProductMap = () =>
  Object.fromEntries(pricingRules.products.map(({ key }) => [key, 0]));

module.exports = {
  buildCatalog,
  emptyProductMap,
  RETIRED_ADD_ONS,
  PRODUCT_PRESENTATION,
  _test: { assertPresentationCoverage, presentationMismatch, LABEL_OVERRIDES },
};
