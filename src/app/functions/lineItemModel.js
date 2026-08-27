const crypto = require('node:crypto');

const CATALOG = Object.freeze({
  // 'Platform Subscription - Enterprise' (45820463617) is classified as a Bundle in the product
  // library, and HubSpot will not hydrate a line item from a bundle. 46037350773 'Enterprise' is
  // the standalone Platform product inside that bundle (SKU ENT-FY26), so it is what the
  // subscription line is built from. The previous id, 47269087321, is not in the library export
  // at all and HubSpot rejected it as a bundle.
  enterprise: {
    id: '46037350773',
    // Local label only -- nothing sends it. Corrected from 'Enterprise Drawdown Fee' against the
    // 2026-08-27 product export, which is also where the SKU ENT-FY26 below comes from.
    name: 'Enterprise Drawdown Commitment',
    category: 'Platform',
  },
  connect_ca: {
    id: '45820463620',
    name: 'Connect - Email + Calendar Connected Accounts (CA)',
    category: 'Platform',
  },
  calendar_ca: {
    id: '45887560099',
    name: 'Connect - Calendar-Only Connected Accounts (CA)',
    category: 'Calendar',
  },
  notetaker_bot_hours: {
    id: '45816248707',
    name: 'Notetaker - Bot Hours',
    category: 'Notetaker',
  },
  agent_accounts: {
    id: '45816248710',
    name: 'Agent Accounts - # of Agents',
    category: 'Platform',
  },
  agent_email_thousands: {
    id: '45867076721',
    name: 'Agent Accounts - Per 1,000 Emails Sent',
    category: 'Platform',
  },
  agent_storage_gb: {
    id: '45820463625',
    name: 'Agent Accounts - GB / Storage',
    category: 'Platform',
  },
  agent_bandwidth_gb: {
    id: '45820401689',
    name: 'Agent Accounts - GB / Bandwidth',
    category: 'Platform',
  },
  enterprise_accelerator: {
    id: '46102266003',
    name: 'Accelerator Package',
    category: 'Add-Ons',
  },
  privacy_filter: { id: '46060960674', name: 'Privacy Filter Mode', category: 'Add-Ons' },
  verified_oauth: {
    id: '46047848295',
    name: 'Turnkey Verified OAuth Project',
    category: 'Professional Services',
  },
  basic: { id: '40270989858', name: 'Support Services: Basic', category: 'Support' },
  full: { id: '41648477792', name: 'Support Services: Full', category: 'Support' },
  premium: { id: '41732581464', name: 'Support Services: Premium', category: 'Support' },
  // Each onboarding key was previously mapped to the NEXT package's product: Quick Launch+ held
  // "QuickLaunch Onboarding" and Strategic held "QuickLaunch+ Onboarding", so every onboarding
  // line item named and billed the wrong package. Quick Launch had no entry at all, which made
  // pricing it above $0 fail with PRODUCT_MAPPING_REQUIRED after the Deal had already been
  // rewritten.
  quick_launch: {
    id: '42724377715',
    name: 'QuickLaunch Onboarding',
    category: 'Professional Services',
  },
  quick_launch_plus: {
    id: '42724501576',
    name: 'QuickLaunch+ Onboarding',
    category: 'Professional Services',
  },
  strategic: {
    id: '42724439648',
    name: 'Strategic Onboarding',
    category: 'Professional Services',
  },
  google_verification_review: {
    id: '42870472964',
    name: 'Google Verification Review',
    category: 'Professional Services',
  },
  architecture_workflow_review: {
    id: '42870349120',
    name: 'Architecture Design & Workflow Review',
    category: 'Professional Services',
  },
  gtm_review: {
    id: '42870410889',
    name: 'Go-To-Market (GTM) Review',
    category: 'Professional Services',
  },
  provider_oauth_app_creation: {
    id: '42870596743',
    name: 'Provider OAuth App Creation',
    category: 'Professional Services',
  },
  notification_webhook_best_practices: {
    // Confirmed against the full product export: Standalone, Professional Services, $2,000.
    // It was absent from the bundles export only because it belongs to no bundle.
    id: '42870410890',
    name: 'Notification & Webhook Best Practices',
    category: 'Professional Services',
  },
});

const PRESENTATIONS = Object.freeze(['itemized_products', 'subscription_summary']);
// The order line items must appear in on the Deal and the Quote. HubSpot does not honour creation
// order -- display order comes from hs_position_on_quote -- so the sequence is stated here and
// stamped onto every line below.
const PRODUCT_LINE_ORDER = Object.freeze([
  'connect_ca',
  'calendar_ca',
  'notetaker_bot_hours',
  'agent_accounts',
  'agent_storage_gb',
  'agent_bandwidth_gb',
  'agent_email_thousands',
]);

const productOrderIndex = (productKey) => {
  const index = PRODUCT_LINE_ORDER.indexOf(productKey);
  return index === -1 ? PRODUCT_LINE_ORDER.length : index;
};

// hs_position_on_quote drives display order. Stamped as a 0-based sequence over the final list, so
// the order is whatever the builders produced rather than whatever HubSpot happened to return.
const withPositions = (items) =>
  items.map((item, index) => ({
    ...item,
    properties: { ...item.properties, hs_position_on_quote: String(index) },
  }));

// The four fee columns from the Contract Summary, carried on each line item that holds money.
//
// EMPTY UNTIL THE PORTAL'S INTERNAL NAMES ARE FILLED IN. These are custom Line item properties, so
// a name the portal does not have returns 400 -- and because syncDealLineItems archives before it
// creates, one wrong name empties the Deal and creates nothing. While a slot is '', that field is
// simply not sent, so the code is safe to deploy before the properties exist.
//
// Fill each value with the internal name from Settings > Properties > object: Line item, and add
// the same names to HUBSPOT_LINE_ITEM_PROPERTIES in QuoteOptionsFunction.js.
const FEE_TOTAL_PROPERTIES = Object.freeze({
  oneTime: 'one_time_fees',
  // The per-BILLING-PERIOD amount, not the annualised one: it sits on a record that already
  // carries recurringbillingfrequency, so "recurring fees" on that line reads as what is billed
  // each cycle. There is no separate ARR property in the portal. If this should be the annual
  // figure instead, change this one mapping to recurringPerYear -- both are computed.
  recurringPerPeriod: 'recurring_fees',
  totalForTerm: 'total_fees_for_term',
});

// Only lines that carry money. The seven metered lines are a rate schedule at quantity 0: they
// contribute nothing to any total, so all four values would be 0 on them -- noise on a
// customer-facing quote.
const carriesFees = (key) => !String(key).startsWith('metered:');

const feeTotals = (item, option) => {
  const price = Number(item.properties.price);
  if (!Number.isFinite(price)) return null;
  // Net of the discount. `price` is now the LIST price on any discounted line, so reading it
  // alone would report list amounts in the fee columns and overstate every total.
  const net = price - Number(item.properties.discount || 0);
  const amount = net * Number(item.properties.quantity || 0);
  // A line is recurring exactly when it carries a billing frequency -- the same test the Contract
  // Summary and the reconciliation test use.
  const recurring = Boolean(item.properties.recurringbillingfrequency);
  const perPeriod = recurring ? amount : 0;
  const perYear = perPeriod * option.result.paymentsPerYear;
  return {
    oneTime: recurring ? 0 : amount,
    recurringPerPeriod: perPeriod,
    recurringPerYear: perYear,
    totalForTerm: recurring ? perYear * (option.input.termMonths / 12) : amount,
  };
};

const withFeeTotals = (items, option) =>
  items.map((item) => {
    if (!carriesFees(item.key)) return item;
    const values = feeTotals(item, option);
    if (!values) return item;
    const properties = { ...item.properties };
    for (const [slot, name] of Object.entries(FEE_TOTAL_PROPERTIES)) {
      if (name) properties[name] = String(round(values[slot], 2));
    }
    return { ...item, properties };
  });

const round = (value, decimals = 2) => {
  const multiplier = 10 ** decimals;
  return Math.round((Number(value) + Number.EPSILON) * multiplier) / multiplier;
};

const paymentFrequency = (paymentsPerYear) => {
  const value = {
    1: 'annually',
    2: 'per_six_months',
    4: 'quarterly',
    12: 'monthly',
  }[paymentsPerYear];
  if (!value) throw new Error('INVALID_QUOTE_CONTENT');
  return value;
};

const normalizeDate = (value, fallback) => {
  const candidate = value || fallback;
  if (typeof candidate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    throw new Error('INVALID_QUOTE_CONTENT');
  }
  const parsed = new Date(`${candidate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== candidate) {
    throw new Error('INVALID_QUOTE_CONTENT');
  }
  return candidate;
};

// No default expiration. Quotes are not meant to expire here, so an unset expirationDate stays
// unset rather than silently becoming "30 days from whenever this ran" -- a date the rep never
// chose, printed on a customer-facing quote.
//
// Note: the Quotes API guide lists hs_expiration_date among the properties a quote must include
// at creation. Omitting it may be rejected. If it is, the failure will say so, and the fix is a
// deliberate far-future date rather than a rolling 30 days.
const normalizeOptionalDate = (value) => {
  if (value == null || value === '') return '';
  return normalizeDate(value);
};

const normalizeQuoteContent = (raw = {}, fallbackTitle = 'Nylas Enterprise Quote') => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('INVALID_QUOTE_CONTENT');
  }
  const allowed = new Set([
    'title',
    'expirationDate',
    'presentation',
    // These three no longer change anything the app sends. They used to select what went into the
    // quote's hs_comments and hs_terms; the app no longer writes either, because hs_terms is what
    // the template's "Payment Terms:" section renders and the template owns that text. They stay
    // accepted so the card's existing payload still validates, and they stay in the content hash.
    // Do not build new behaviour on them without deciding what owns the quote's prose.
    'includeUncommittedRateSchedule',
    'includeRenewalTerms',
    'includeSpecialTerms',
    // Part of the content, not a side channel: the template changes what the customer sees, so
    // it belongs in the hash. Switching template on an already-generated quote must produce a new
    // quote rather than silently reusing the old one.
    'templateId',
  ]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) throw new Error('INVALID_QUOTE_CONTENT');
  }
  const title = typeof raw.title === 'string' ? raw.title.trim() : fallbackTitle;
  if (!title || title.length > 160) throw new Error('INVALID_QUOTE_CONTENT');
  const presentation = raw.presentation || 'itemized_products';
  if (!PRESENTATIONS.includes(presentation)) throw new Error('INVALID_QUOTE_CONTENT');

  const templateId = raw.templateId == null ? '' : String(raw.templateId);
  if (templateId && !/^\d{1,20}$/.test(templateId)) throw new Error('INVALID_QUOTE_CONTENT');

  return {
    title,
    templateId,
    expirationDate: normalizeOptionalDate(raw.expirationDate),
    presentation,
    includeUncommittedRateSchedule: raw.includeUncommittedRateSchedule === true,
    includeRenewalTerms: raw.includeRenewalTerms !== false,
    includeSpecialTerms: raw.includeSpecialTerms !== false,
  };
};

// `name` is deliberately NOT built. The product name belongs to the HubSpot product library, and
// hs_product_id is all HubSpot needs to resolve it. Sending our own copy overwrote the library's
// name on every line item, so any rename in HubSpot was silently reverted by the next Lock in --
// which is how "Enterprise Drawdown Fee" kept coming back after the product had been renamed to
// "Enterprise Drawdown Commitment" (confirmed against the 2026-08-27 product export).
//
// Same rule the description already follows: the library owns what a product IS, this app owns
// what was SOLD -- quantities, rates, discounts, fees. The `name` still on each CATALOG entry
// below is a LOCAL LABEL for logs, tests and the product-library drift check. It never leaves
// this process.
const baseManagedProperties = ({ option, key, component, product, source }) => ({
  hs_product_id: product.id,
  product_category: product.category,
  nylas_pricing_managed: 'true',
  nylas_line_item_key: key,
  nylas_pricing_component: component,
  nylas_quote_option_id: option.id,
  nylas_pricing_state_hash: option.result.stateHash,
  nylas_line_item_source: source,
});

// price + discount, expressed the way HubSpot models a discounted line.
//
// Sending only the net price hid the discount entirely: the quote showed the agreed rate with no
// indication anything had been given away. So the LIST price goes in `price` and the difference
// goes in `discount`, HubSpot's own field, and HubSpot's net comes out at the agreed amount.
//
// A flat amount, not hs_discount_percentage, for a reason worth keeping. Support is priced as a
// share of platform ARR, so its list-to-net gap already carries the product discounts as well as
// its own -- 15% entered, 23.41% effective. A percentage rounded to two decimals against a
// five-figure base drifts by tens of cents; list minus net is exact to the cent by construction.
const priceProperties = (price, listPrice) => {
  if (price == null) return {};
  const net = round(price, 2);
  // No discount to state when nothing was given away. Guard on a positive gap rather than
  // inequality: floating point can leave a sub-cent difference on an undiscounted line.
  if (listPrice == null) return { price: String(net) };
  const list = round(listPrice, 2);
  if (list - net < 0.01) return { price: String(net) };
  return { price: String(list), discount: String(round(list - net, 2)) };
};

// billingPeriodsPerYear defaults to the payment schedule, but a line can override it. The seven
// package products are priced as MONTHLY rates and must stay monthly: stamping them with the
// payment schedule said "quarterly" on a line whose price is a per-month figure. They bill nothing
// (quantity 0), so this is about the line describing itself honestly.
const recurringProperties = ({
  option,
  key,
  component,
  product,
  price,
  listPrice,
  quantity,
  description,
  source,
  billingPeriodsPerYear,
}) => {
  const paymentsPerYear = billingPeriodsPerYear || option.result.paymentsPerYear;
  return {
    ...baseManagedProperties({ option, key, component, product, source }),
    quantity: String(quantity),
    // An omitted price means "use the product's default", and must stay omitted: round(undefined)
    // is NaN, and String(NaN) is the literal "NaN", which HubSpot would take as the price.
    ...priceProperties(price, listPrice),
    // Omitted when blank so HubSpot falls back to the product library's own description.
    // Sending '' would overwrite that with nothing.
    ...(description ? { description: String(description).slice(0, 5_000) } : {}),
    recurringbillingfrequency: paymentFrequency(paymentsPerYear),
    hs_recurring_billing_period: `P${option.input.termMonths}M`,
    // Follows the line's own frequency, not the deal's: a monthly line over a 24-month term has
    // 24 payments, not the 8 a quarterly schedule would give.
    hs_recurring_billing_number_of_payments: String(
      (option.input.termMonths / 12) * paymentsPerYear,
    ),
    // The derived contract start, so a line item's billing start cannot disagree with the
    // quote's effective start date or the Deal's contract dates.
    ...(option.result.dates?.contractStartDate
      ? { hs_recurring_billing_start_date: option.result.dates.contractStartDate }
      : {}),
  };
};

const oneTimeProperties = ({ option, key, component, product, price, listPrice, description, source }) => ({
  ...baseManagedProperties({ option, key, component, product, source }),
  quantity: '1',
  ...priceProperties(price, listPrice),
  ...(description ? { description: String(description).slice(0, 5_000) } : {}),
});


// Every product in the bundle appears on every quote, committed or not. A product with no volume
// still has a rate the customer would draw down at if they used it, and the drawdown fee they are
// paying covers all of them -- so leaving the unused ones off made the quote look like a narrower
// entitlement than it is. No filter on `committed`.
const buildMeteredLines = (option, source) => {
  const items = option.result.lines
    .slice()
    .sort(
      (left, right) =>
        productOrderIndex(left.productKey) - productOrderIndex(right.productKey),
    )
    .map((line) => {
      const product = CATALOG[line.productKey];
      if (!product) throw new Error('PRODUCT_MAPPING_REQUIRED');
      // A graduated product publishes per-band rates; a flat one publishes none. Read off the
      // calculation rather than re-listing which products are graduated, so the two cannot drift.
      const isGraduated = line.listBandRates.length > 0;
      return {
        key: `metered:${line.productKey}`,
        properties: {
          ...recurringProperties({
            option,
            key: `metered:${line.productKey}`,
            component: 'subscription_product',
            product,
            // Quantity 0: the Enterprise Drawdown Fee carries the money and usage comes out of
            // that pool, so these lines are the rate schedule and add nothing to the total.
            quantity: 0,
            // Monthly, whatever the payment schedule. These rates are per month, and the drawdown
            // fee is the only charge in the package that follows the deal's billing cadence.
            billingPeriodsPerYear: 12,
            // ALWAYS send this deal's rate. Never leave it to the product's default.
            //
            // The price used to be omitted unless the rep had discounted the product, on the
            // reasoning that HubSpot would then hydrate "the number the product library already
            // holds and the one the customer should see". That was wrong, and Shane Tjin caught it
            // on a live quote: the library holds ONE FLAT LIST PRICE per product, which is not
            // this deal's rate. Our rates are blended across the volume bands and adjusted for the
            // contract term and payment schedule, so they differ from the flat price on every
            // single line. On his quote Calendar-Only printed $1.20 where the agreed rate was
            // $0.96 -- 25% over -- and Email + Calendar printed $1.60 where it was $1.76.
            //
            // This is the same ownership rule the rest of the file follows, applied correctly: the
            // product library owns what a product IS (its name, its description), and this app
            // owns what was SOLD -- and the rate is what was sold.
            //
            // The original complaint behind the omission was real but separate: the code used to
            // send the monthly rate multiplied up to the billing period, so a $1.30/month product
            // showed $15.60. billingUnitRate is the MONTHLY rate, which is the basis the product
            // is priced on, so that does not recur here.
            //
            // Undiscounted, list and net are the same number and `discount` is omitted. Discounted,
            // `price` carries the list rate and `discount` the concession -- Holly's model: "The
            // unit price should always be the same, then we can add a unit discount, and then I
            // will show the net price."
            //
            // EXCEPT for a graduated product, where a single price is the wrong shape entirely.
            //
            // Agent Email is priced across four tiers, and the product carries those tiers in
            // HubSpot -- the quote renders them as "View tiered rates". Sending one blended figure
            // would collapse all four into a flat rate and throw that away, which is a worse
            // misrepresentation than the flat-price bug this block fixes. So a graduated line
            // still leaves the price alone and lets the product's own tiers show.
            //
            // That leaves a known gap, tracked separately: a DISCOUNTED graduated line cannot
            // express its concession this way, because the discounted per-tier rates need
            // hs_tier_prices, which is Revenue-Hub gated and not yet confirmed in this portal.
            // Until then a discounted Agent Email line shows list tiers rather than agreed ones.
            //
            // Zero is not sent either: a rate that blends to $0.00 would replace a real price
            // with a flat "$0.00".
            ...(!isGraduated && line.billingUnitRate > 0
              ? {
                  price: line.billingUnitRate,
                  listPrice:
                    line.discretionaryDiscount !== 0
                      ? line.billingUnitRate / (1 - line.discretionaryDiscount)
                      : undefined,
                }
              : {}),
            source,
          }),
          monthly_unit_price: String(line.billingUnitRate),
          // The monthly committed average, as data rather than the prose it used to sit in.
          // quantity stays 0 so these lines still contribute nothing to the Deal total -- the
          // committed money is carried by the drawdown fee, not by these rate-schedule lines.
          committed_quantity: String(line.volume),
        },
      };
    });
  // The residual reconciliation that used to live here existed to make these lines sum exactly to
  // the platform total. They sum to zero now by design, and the drawdown line is taken straight
  // from proposedPlatformArr, so there is nothing left to reconcile.
  return items;
};

// No description on the drawdown fee either, which makes this the last app-authored line item
// description to go.
//
// It used to carry the whole rate schedule. HubSpot collapses newlines when it renders a line item
// description, so the per-product rates arrived as one unbroken paragraph -- and reformatting
// cannot fix that, because there is no line break to reformat with. The information is not lost:
// every product is its own line below this one, with its rate and its committed_quantity, and the
// product library's own copy for Enterprise Drawdown Fee already ends "Monthly usage based rates
// for the products are indicated below:", which is exactly what follows.
//
// includeUncommittedRateSchedule no longer reaches a line item at all. It still selects which
// products appear in the rate schedule inside the quote's hs_comments, which is rich text and does
// keep its formatting.
const buildSubscriptionSummaryLine = (option, source) => ({
  key: 'subscription:drawdown',
  properties: recurringProperties({
    option,
    key: 'subscription:drawdown',
    component: 'subscription_drawdown',
    product: CATALOG.enterprise,
    quantity: 1,
    price: option.result.proposedPlatformArr / option.result.paymentsPerYear,
    listPrice: option.result.listPlatformArr / option.result.paymentsPerYear,
    source,
  }),
});

// The subscription line covers the monthly product commitments ONLY.
//
// It used to be priced at result.recurringPerPeriod, which is committedArr per period — and
// committedArr already includes support and recurring add-ons. Those are now their own line
// items (support is always present, at least Basic), so pricing this line off committedArr
// would bill both of them twice. Platform + support + add-ons still sums to committedArr, so
// the Deal's native amount is unchanged; it is just itemized instead of bundled.
const buildDealBundleLine = (option) => ({
  key: 'subscription:nylas_enterprise',
  properties: recurringProperties({
    option,
    key: 'subscription:nylas_enterprise',
    component: 'subscription_drawdown',
    product: CATALOG.enterprise,
    quantity: 1,
    price: option.result.proposedPlatformArr / option.result.paymentsPerYear,
    listPrice: option.result.listPlatformArr / option.result.paymentsPerYear,
    source: 'deal',
  }),
});

const buildSupportLine = (option, source) => {
  // Every quote carries a support line, Basic at $0 included — the tier is part of what the
  // customer is buying, so it belongs on the Deal and the Quote whether or not it costs anything.
  const product = CATALOG[option.input.supportLevel] || CATALOG.basic;
  return [
    {
      key: `support:${option.input.supportLevel}`,
      properties: recurringProperties({
        option,
        key: `support:${option.input.supportLevel}`,
        component: 'support',
        product,
        quantity: 1,
        price: option.result.supportAnnual / option.result.paymentsPerYear,
        listPrice: option.result.listSupportAnnual / option.result.paymentsPerYear,
        source,
      }),
    },
  ];
};

const buildAddOnLines = (option, source) =>
  option.result.selectedAddOns.map((addOn) => {
    const product = CATALOG[addOn.key];
    if (!product) throw new Error('PRODUCT_MAPPING_REQUIRED');
    return {
      key: `addon:${addOn.key}`,
      properties: recurringProperties({
        option,
        key: `addon:${addOn.key}`,
        component: 'subscription_add_on',
        product,
        quantity: 1,
        price: addOn.annualAmount / option.result.paymentsPerYear,
        listPrice: addOn.listAnnualAmount / option.result.paymentsPerYear,
        source,
      }),
    };
  });

const buildOnboardingLines = (option, source) => {
  // Onboarding is optional. "none" is a real selection meaning no onboarding was sold, so it
  // produces no line item; every other package does, including $0 Quick Launch, because the
  // package itself is part of the agreement.
  if (option.input.onboardingPackage === 'none') return [];
  const product = CATALOG[option.input.onboardingPackage];
  if (!product) throw new Error('PRODUCT_MAPPING_REQUIRED');
  return [
    {
      key: `onboarding:${option.input.onboardingPackage}`,
      properties: oneTimeProperties({
        option,
        key: `onboarding:${option.input.onboardingPackage}`,
        component: 'onboarding',
        product,
        price: option.result.onboardingAmount,
        listPrice: option.result.listOnboardingAmount,
        source,
      }),
    },
  ];
};

const allocateBundle = (total, count) => {
  if (!count) return [];
  const share = round(total / count);
  const values = Array.from({ length: count }, () => share);
  values[count - 1] = round(total - share * (count - 1));
  return values;
};

const buildProfessionalServiceLines = (option, source) => {
  const selected = option.input.professionalServices || [];
  const prices = allocateBundle(option.result.professionalServicesAmount, selected.length);
  // The list amounts are allocated the same way, so each line's discount is its own share of the
  // bundle's concession and the shares still sum to the totals exactly.
  const listPrices = allocateBundle(
    option.result.listProfessionalServicesAmount,
    selected.length,
  );
  return selected.map((key, index) => {
    const product = CATALOG[key];
    if (!product) throw new Error('PRODUCT_MAPPING_REQUIRED');
    return {
      key: `professional_service:${key}`,
      properties: oneTimeProperties({
        option,
        key: `professional_service:${key}`,
        component: 'professional_services',
        product,
        price: prices[index],
        listPrice: listPrices[index],
        source,
      }),
    };
  });
};

const buildLineItems = (option, { source, presentation = 'itemized_products' }) => {
  if (!option?.id || !option?.input || !option?.result?.stateHash) {
    throw new Error('OPTION_REQUIRED');
  }
  // The Enterprise Drawdown Fee always leads and always carries the platform total. The metered
  // product lines follow it as a zero-priced rate schedule, in the fixed product order.
  // 'subscription_summary' means the drawdown line alone, with no per-product breakdown.
  const subscriptionLines = [
    buildSubscriptionSummaryLine(option, source),
    ...(presentation === 'subscription_summary' ? [] : buildMeteredLines(option, source)),
  ];
  return withFeeTotals(
    withPositions([
      ...subscriptionLines,
      ...buildSupportLine(option, source),
      ...buildAddOnLines(option, source),
      ...buildOnboardingLines(option, source),
      ...buildProfessionalServiceLines(option, source),
    ]),
    option,
  );
};

// The Deal carries the same structure as the Quote: drawdown fee first with the platform total,
// then the zero-priced product rate schedule, then support, add-ons and one-time charges. Both
// surfaces showing the same lines in the same order is the point.
const buildDealLineItems = (option) =>
  withFeeTotals(
    withPositions([
      buildDealBundleLine(option),
      ...buildMeteredLines(option, 'deal'),
      ...buildSupportLine(option, 'deal'),
      ...buildAddOnLines(option, 'deal'),
      ...buildOnboardingLines(option, 'deal'),
      ...buildProfessionalServiceLines(option, 'deal'),
    ]),
    option,
  );

const buildQuoteLineItems = (option, content) =>
  buildLineItems(option, {
    source: 'quote',
    presentation: content.presentation,
  });


const contentHash = (option, content) =>
  crypto
    .createHash('sha256')
    .update(JSON.stringify({ optionId: option.id, stateHash: option.result.stateHash, content }))
    .digest('hex');

module.exports = {
  CATALOG,
  FEE_TOTAL_PROPERTIES,
  _test: { feeTotals, withFeeTotals },
  buildDealLineItems,
  buildQuoteLineItems,
  contentHash,
  normalizeQuoteContent,
};
