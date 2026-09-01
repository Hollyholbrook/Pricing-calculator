const crypto = require('node:crypto');
const pricingRules = require('./pricingRules');

const CONFIGURATION_KEY = 'default';
const OBJECT_NAME = 'nylas_pricing_configuration';
const MAX_PIPELINES = 30;
const CALCULATION_METHODS = Object.freeze(['excel_compatible', 'rounded_unit_rate']);
const LEGACY_PRODUCT_BAND_RATES = Object.freeze({
  agent_email_thousands: [0.5],
});

const defaultPricingPolicy = () => ({
  calculationMethod: 'excel_compatible',
  minimumCommittedArr: pricingRules.minimumCommittedArr,
  // Off, from the rate card, which is where the decision is written down. Holly, 2026-08-31.
  enforceMinimumCommittedArr: pricingRules.enforceMinimumCommittedArr,
  redliningMinimumArr: pricingRules.redliningMinimumArr,
  // Credit card is refused on an invoice above this. Configurable like the other thresholds,
  // because it is a finance policy rather than a rate -- and because a hard-coded limit could not
  // be tested at its own boundary without contriving a deal that lands exactly on $25,000.
  creditCardMaximumInvoice: pricingRules.creditCardMaximumInvoice,
  salesDirectorDiscountMax: pricingRules.salesDirectorDiscountMax,
  headSalesDiscountMax: pricingRules.headSalesDiscountMax,
  // APPROVAL MATRIX (Holly, 2026-08-28). The THRESHOLDS are shared by both deal types -- only
  // who signs off changes:
  //
  //   no approval      0% deviation                                      all
  //   first tier       up to salesDirectorDiscountMax (10%)              Sales Director / CS Director
  //   second tier      that up to headSalesDiscountMax (30%)             Head of Sales / CCSO
  //   finance          above 30%, any 100%-off line, non-standard terms  all
  //
  // Term and payment-frequency adjustments are pre-approved and never counted: the ladder reads
  // largestDiscretionaryDiscount, which is only what a rep typed.
  //
  // Configurable because the approver for a concession is policy. An earlier build routed ALL
  // renewal discounts to the CCSO with no ladder; this table replaced it.
  newBusinessFirstApprovalTier: 'sales_director',
  newBusinessSecondApprovalTier: 'head_sales',
  renewalFirstApprovalTier: 'cs_director',
  renewalSecondApprovalTier: 'ccso',
  // A line given away entirely goes to Finance whatever the thresholds say. Redundant while
  // headSalesDiscountMax is 30% -- 100% already exceeds it -- but it stops a raised threshold from
  // quietly letting a free line through at a lower tier.
  financeApprovesFullDiscount: true,
  // Renewals still skip the non-discount BLOCKS: the Enterprise ARR minimum and the redlining ARR
  // threshold. Holly's call, and untouched by the table above, which is about approval rather than
  // about refusing a lock -- a renewal is expected to land under the new-business minimum, and
  // that rule blocks rather than escalates.
  renewalRelaxesNonDiscountApprovals: true,
  // DERIVED FROM pricingRules, every one of them. Do not hand-copy a rate into this file.
  //
  // These used to be typed out here, duplicating the rate card, while productBandRates below was
  // derived. Onboarding drifted: pricingRules said 5/10/15K -- confirmed by Holly, the workbook
  // RATE CARD, QUOTE BUILDER row 38 and the HubSpot product export on 2026-08-27 -- and this file
  // still said 0/5/10K. Because buildActiveRules reads the POLICY first
  // (`pricingPolicy.onboardingAmounts?.[key] ?? rule.oneTimeAmount`), the stale copy won and every
  // onboarding package was quoted $5,000 short. The tests did not catch it because they pass `{}`
  // as the policy, which falls through to pricingRules and never sees this table.
  //
  // Deriving makes that class of drift impossible. A rate change now happens in pricingRules.js
  // alone, and a test below asserts these stay equal to it.
  termDiscounts: Object.fromEntries(
    pricingRules.termRules.map(({ months, discount }) => [String(months), discount]),
  ),
  paymentPremiums: Object.fromEntries(
    pricingRules.paymentRules.map(({ key, premium }) => [key, premium]),
  ),
  support: Object.fromEntries(
    pricingRules.supportRules.map(({ key, percentOfPlatformArr, annualCap }) => [
      key,
      { percent: percentOfPlatformArr, cap: annualCap },
    ]),
  ),
  onboardingAmounts: Object.fromEntries(
    pricingRules.onboardingRules.map(({ key, oneTimeAmount }) => [key, oneTimeAmount]),
  ),
  // Indexed by the NUMBER of professional-services items, so it stays a dense array 0..5 rather
  // than a keyed object -- professionalServicesAmounts[3] is the three-item bundle.
  professionalServicesAmounts: pricingRules.professionalServicesRules.map(
    ({ oneTimeAmount }) => oneTimeAmount,
  ),
  addOnAnnualAmounts: Object.fromEntries(
    pricingRules.addOnRules.map(({ key, annualAmount }) => [key, annualAmount]),
  ),
  productBandRates: Object.fromEntries(
    pricingRules.products.map(({ key, bands }) => [key, bands.map((band) => band[2])]),
  ),
});

const defaultSettings = () => ({
  schemaVersion: '1.0',
  version: 0,
  allowNewBusiness: true,
  allowRenewals: false,
  newBusinessPipelineIds: [],
  renewalPipelineIds: [],
  // WHICH quote templates the card offers, and which one it preselects. Holly, 2026-08-28.
  //
  // An EMPTY list means "every usable template", which is what the card did before this existed --
  // so an unconfigured portal behaves exactly as it always has rather than showing an empty picker.
  // Choosing templates here narrows it; it never adds one the portal does not have.
  //
  // PER QUOTE KIND since 2026-08-30, and the key is the KIND rather than the deal category
  // because there are three documents and only two categories. A renewal-pipeline Deal prints
  // either a change quote or a renewal quote depending on what the rep chooses; a new-business
  // Deal prints the third. Keying these by category would have left the renewal category holding
  // two defaults in one field.
  //
  // Everything else in Settings stays shared: one rate card, one set of thresholds. Only the
  // templates differ, so only the templates are nested.
  quoteTemplatesByKind: {
    new_business: { enabledIds: [], defaultId: '' },
    change: { enabledIds: [], defaultId: '' },
    renewal: { enabledIds: [], defaultId: '' },
  },
  // LEGACY MIRRORS, derived -- never edited directly, never read by this code.
  //
  // They exist so a ROLLBACK is survivable. The per-kind data lives under its own key, so code
  // that predates it still finds a plain array and a plain id here and keeps working. Without
  // this, a record saved by the new Settings screen made the old normalizeSettings throw
  // INVALID_SETTINGS, which readSettings turns into SETTINGS_CONFIGURATION_REQUIRED -- taking the
  // whole card down, not just Settings, for anyone who rolled back after a save.
  //
  // They mirror the NEW BUSINESS kind, which is what a single shared list meant before kinds
  // existed. Empty falls back to the QUOTE_TEMPLATE_ID secret, as it always did.
  enabledQuoteTemplateIds: [],
  defaultQuoteTemplateId: '',
  pricingPolicy: defaultPricingPolicy(),
});

// The tiers the card knows how to label. A tier it cannot label would render as a raw key on a
// blocking banner, so an unknown one fails closed at save time rather than at quote time.
// The product rate rows the Settings screen renders, DERIVED from pricingRules.
//
// The Settings page used to carry its own copy of this: seven product keys, seven labels and
// every band boundary spelled out as a string ("0-500", "500-1K", ...). It happened to match, but
// nothing kept it matching -- a band added or moved in pricingRules would have left the screen
// labelling the wrong boundary over the right input, which is worse than an obvious error.
//
// Holly, 2026-08-31: nothing is hardcoded outside the settings and the product information itself.
const compactVolume = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  if (n === 0) return '0';
  if (n % 1_000_000 === 0) return `${n / 1_000_000}M`;
  if (n >= 1_000_000) return `${Number((n / 1_000_000).toFixed(1))}M`;
  if (n % 1_000 === 0) return `${n / 1_000}K`;
  if (n >= 1_000) return `${Number((n / 1_000).toFixed(1))}K`;
  return String(n);
};

// An open-ended last band reads "1.1M+"; every other band reads "from-to". Matches what the
// screen showed before, so the change is invisible to whoever is looking at it.
const bandLabel = ([from, to]) =>
  to == null ? `${compactVolume(from)}+` : `${compactVolume(from)}\u2013${compactVolume(to)}`;

const productRateDescriptors = () =>
  pricingRules.products.map(({ key, name, unitOfMeasure, bands }) => ({
    key,
    label: unitOfMeasure ? `${name} \u2014 ${unitOfMeasure}` : name,
    bands: bands.map(bandLabel),
  }));

const APPROVAL_TIERS = Object.freeze([
  'none',
  'sales_director',
  'cs_director',
  'head_sales',
  'ccso',
  'finance',
]);

// A HubSpot object id, or blank for "not set". Blank is meaningful here -- it is how the default
// falls back to the QUOTE_TEMPLATE_ID secret -- so it is allowed rather than rejected.
const normalizeTemplateId = (value, field) => {
  if (value == null || value === '') return '';
  const id = String(value);
  if (!/^\d{1,20}$/.test(id)) throw new Error(`INVALID_SETTINGS:${field}`);
  return id;
};

// The three documents this app can print, from REQUIREMENTS.md section 2. Not the same axis as
// dealCategory, which has two values: the renewal CATEGORY covers two KINDS, and which of them a
// quote is is the rep's choice.
const QUOTE_KINDS = Object.freeze(['new_business', 'change', 'renewal']);

// Which kinds a resolved category may choose between. dealCategory also returns 'unsupported';
// isDealAllowed refuses those Deals before this is reached, so they fall to the new-business kind
// as a safety net rather than as a route anything takes.
//
// A RENEWAL DEAL MAY ALSO QUOTE FROM THE NEW BUSINESS KIND. Holly, 2026-09-01: "make it so I can
// submit a new business template from renewals."
//
// This is not a widening of the new-business rule, which still holds in the direction it was
// written: a NEW BUSINESS Deal offers new-business templates only, and nothing here changes that.
// This is the other direction -- a renewal-pipeline Deal that needs to send an ordinary quote.
//
// It has real teeth now rather than being a convenience. HubSpot refuses to create a change or
// renewal quote through the public API at all, so on a renewal Deal those two kinds hand off to
// HubSpot and produce no quote. Without new_business here, a renewal Deal has no path that ends
// in a quote this app can create.
//
// ORDER MATTERS AND new_business GOES LAST. kinds[0] is what the category's default template is
// read from, so appending rather than prepending leaves the renewal Deal still defaulting to the
// change template. It also matches quoteKindForTemplate's own precedence, which puts change and
// renewal ahead of new_business so a template listed under both keeps the identity of the
// document it actually is.
const quoteKindsForCategory = (category) =>
  category === 'renewal' ? ['change', 'renewal', 'new_business'] : ['new_business'];

// The per-kind template settings went under their own key, `quoteTemplatesByKind`, on 2026-08-30.
// Two older shapes have to keep working:
//
//   FLAT      enabledQuoteTemplateIds: ['123'],  defaultQuoteTemplateId: '123'
//             -- every portal configured before 2026-08-30. Read as "every kind uses this".
//   BY KIND   enabledQuoteTemplateIds: { change: [...] }, ...
//             -- the shape this file briefly used on 2026-08-30, before the rollback hazard was
//             found. Read per kind. Harmless to keep supporting and it costs four lines.
//
// A value that is none of these falls through to the empty default rather than throwing, because
// empty already means something safe: "offer every usable template".
// Precedence is decided on the WHOLE key, not entry by entry. New code always writes all three
// kinds, so if `quoteTemplatesByKind` is present it is authoritative and complete -- and an EMPTY
// enabledIds under it is a real answer ("offer every usable template"), not a gap to fill from
// somewhere else. Reading it entry by entry made an explicitly-empty kind silently inherit the
// legacy list, which is the opposite of what the admin chose.
const hasPerKindKey = (byKind) =>
  Boolean(byKind) && typeof byKind === 'object' && !Array.isArray(byKind);

const legacyTemplateIds = (legacyEnabled, kind) => {
  if (Array.isArray(legacyEnabled)) return legacyEnabled;
  if (legacyEnabled && typeof legacyEnabled === 'object') return legacyEnabled[kind];
  return [];
};

const legacyDefaultId = (legacyDefault, kind) => {
  if (typeof legacyDefault === 'string' || typeof legacyDefault === 'number') return legacyDefault;
  if (legacyDefault && typeof legacyDefault === 'object' && !Array.isArray(legacyDefault)) {
    return legacyDefault[kind];
  }
  return '';
};

const normalizeQuoteTemplatesByKind = (byKind, legacyEnabled, legacyDefault) => {
  const canonical = hasPerKindKey(byKind);
  return Object.fromEntries(
    QUOTE_KINDS.map((kind) => [
      kind,
      {
        enabledIds: normalizePipelineIds(
          (canonical
            ? byKind[kind]?.enabledIds
            : legacyTemplateIds(legacyEnabled, kind)) || [],
          `quoteTemplatesByKind.${kind}.enabledIds`,
        ),
        defaultId: normalizeTemplateId(
          canonical ? byKind[kind]?.defaultId : legacyDefaultId(legacyDefault, kind),
          `quoteTemplatesByKind.${kind}.defaultId`,
        ),
      },
    ]),
  );
};

// The template settings ONE kind uses. An unrecognised kind reads as new business rather than as
// nothing: an empty list would be indistinguishable from "offer every template", so an unknown
// kind must not be able to silently widen the picker.
const quoteTemplateSettings = (settings, quoteKind) => {
  const kind = QUOTE_KINDS.includes(quoteKind) ? quoteKind : 'new_business';
  return {
    enabledIds: settings?.quoteTemplatesByKind?.[kind]?.enabledIds || [],
    defaultId: settings?.quoteTemplatesByKind?.[kind]?.defaultId || '',
  };
};

const requireApprovalTier = (value, field) => {
  if (!APPROVAL_TIERS.includes(value)) throw new Error(`INVALID_SETTINGS:${field}`);
  return value;
};

const requireNumber = (value, min, max, field) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`INVALID_SETTINGS:${field}`);
  }
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
};

const normalizePricingPolicy = (incoming) => {
  const defaults = defaultPricingPolicy();
  const value = incoming && typeof incoming === 'object' && !Array.isArray(incoming)
    ? incoming
    : defaults;
  if (
    value.calculationMethod != null &&
    !CALCULATION_METHODS.includes(value.calculationMethod)
  ) {
    throw new Error('INVALID_SETTINGS:calculationMethod');
  }
  const policy = {
    calculationMethod: CALCULATION_METHODS.includes(value.calculationMethod)
      ? value.calculationMethod
      : defaults.calculationMethod,
    minimumCommittedArr: requireNumber(
      value.minimumCommittedArr ?? defaults.minimumCommittedArr,
      0,
      1_000_000_000,
      'minimumCommittedArr',
    ),
    enforceMinimumCommittedArr:
      typeof value.enforceMinimumCommittedArr === 'boolean'
        ? value.enforceMinimumCommittedArr
        : defaults.enforceMinimumCommittedArr,
    redliningMinimumArr: requireNumber(
      value.redliningMinimumArr ?? defaults.redliningMinimumArr,
      0,
      1_000_000_000,
      'redliningMinimumArr',
    ),
    creditCardMaximumInvoice: requireNumber(
      value.creditCardMaximumInvoice ?? defaults.creditCardMaximumInvoice,
      0,
      1_000_000_000,
      'creditCardMaximumInvoice',
    ),
    salesDirectorDiscountMax: requireNumber(
      value.salesDirectorDiscountMax ?? defaults.salesDirectorDiscountMax,
      0,
      1,
      'salesDirectorDiscountMax',
    ),
    newBusinessFirstApprovalTier: requireApprovalTier(
      value.newBusinessFirstApprovalTier ?? defaults.newBusinessFirstApprovalTier,
      'newBusinessFirstApprovalTier',
    ),
    newBusinessSecondApprovalTier: requireApprovalTier(
      value.newBusinessSecondApprovalTier ?? defaults.newBusinessSecondApprovalTier,
      'newBusinessSecondApprovalTier',
    ),
    renewalFirstApprovalTier: requireApprovalTier(
      value.renewalFirstApprovalTier ?? defaults.renewalFirstApprovalTier,
      'renewalFirstApprovalTier',
    ),
    renewalSecondApprovalTier: requireApprovalTier(
      value.renewalSecondApprovalTier ?? defaults.renewalSecondApprovalTier,
      'renewalSecondApprovalTier',
    ),
    financeApprovesFullDiscount:
      typeof value.financeApprovesFullDiscount === 'boolean'
        ? value.financeApprovesFullDiscount
        : defaults.financeApprovesFullDiscount,
    renewalRelaxesNonDiscountApprovals:
      typeof value.renewalRelaxesNonDiscountApprovals === 'boolean'
        ? value.renewalRelaxesNonDiscountApprovals
        : defaults.renewalRelaxesNonDiscountApprovals,
    headSalesDiscountMax: requireNumber(
      value.headSalesDiscountMax ?? defaults.headSalesDiscountMax,
      0,
      1,
      'headSalesDiscountMax',
    ),
    termDiscounts: {},
    paymentPremiums: {},
    support: {},
    onboardingAmounts: {},
    professionalServicesAmounts: [],
    addOnAnnualAmounts: {},
    productBandRates: {},
  };
  if (policy.salesDirectorDiscountMax > policy.headSalesDiscountMax) {
    throw new Error('INVALID_SETTINGS:discountThresholds');
  }
  for (const key of ['12', '24', '36']) {
    policy.termDiscounts[key] = requireNumber(
      value.termDiscounts?.[key] ?? defaults.termDiscounts[key],
      0,
      1,
      `termDiscounts.${key}`,
    );
  }
  for (const key of Object.keys(defaults.paymentPremiums)) {
    policy.paymentPremiums[key] = requireNumber(
      value.paymentPremiums?.[key] ?? defaults.paymentPremiums[key],
      0,
      1,
      `paymentPremiums.${key}`,
    );
  }
  for (const key of Object.keys(defaults.support)) {
    policy.support[key] = {
      percent: requireNumber(
        value.support?.[key]?.percent ?? defaults.support[key].percent,
        0,
        1,
        `support.${key}.percent`,
      ),
      cap: requireNumber(
        value.support?.[key]?.cap ?? defaults.support[key].cap,
        0,
        1_000_000_000,
        `support.${key}.cap`,
      ),
    };
  }
  for (const key of Object.keys(defaults.onboardingAmounts)) {
    policy.onboardingAmounts[key] = requireNumber(
      value.onboardingAmounts?.[key] ?? defaults.onboardingAmounts[key],
      0,
      1_000_000_000,
      `onboardingAmounts.${key}`,
    );
  }
  if (
    value.professionalServicesAmounts != null &&
    (!Array.isArray(value.professionalServicesAmounts) || value.professionalServicesAmounts.length !== 6)
  ) {
    throw new Error('INVALID_SETTINGS:professionalServicesAmounts');
  }
  policy.professionalServicesAmounts = defaults.professionalServicesAmounts.map((amount, index) =>
    requireNumber(
      value.professionalServicesAmounts?.[index] ?? amount,
      0,
      1_000_000_000,
      `professionalServicesAmounts.${index}`,
    ),
  );
  for (const key of Object.keys(defaults.addOnAnnualAmounts)) {
    policy.addOnAnnualAmounts[key] = requireNumber(
      value.addOnAnnualAmounts?.[key] ?? defaults.addOnAnnualAmounts[key],
      0,
      1_000_000_000,
      `addOnAnnualAmounts.${key}`,
    );
  }
  for (const product of pricingRules.products) {
    const incomingRates = value.productBandRates?.[product.key];
    const defaultRates = defaults.productBandRates[product.key];
    if (
      incomingRates != null &&
      (!Array.isArray(incomingRates) || incomingRates.length > product.bands.length)
    ) {
      throw new Error(`INVALID_SETTINGS:productBandRates.${product.key}`);
    }
    const legacyDefaults = LEGACY_PRODUCT_BAND_RATES[product.key];
    const isUnmodifiedLegacyDefault =
      Array.isArray(incomingRates) &&
      Array.isArray(legacyDefaults) &&
      incomingRates.length === legacyDefaults.length &&
      incomingRates.every((rate, index) => rate === legacyDefaults[index]);
    policy.productBandRates[product.key] = defaultRates.map((rate, index) =>
      requireNumber(
        isUnmodifiedLegacyDefault ? rate : (incomingRates?.[index] ?? rate),
        0,
        1_000_000,
        `productBandRates.${product.key}.${index}`,
      ),
    );
  }
  return policy;
};

const accountIdFromContext = (context) =>
  String(
    context?.accountId ||
    context?.portal?.id ||
    context?.portalId ||
    context?.hubId ||
    context?.hubspot?.portalId ||
    '',
  );

const userIdFromContext = (context) =>
  String(context?.userId || context?.user?.id || context?.user?.userId || '');

const objectTypeForAccount = (accountId) => {
  if (!/^\d{1,20}$/.test(accountId)) throw new Error('SETTINGS_CONFIGURATION_REQUIRED');
  return `p${accountId}_${OBJECT_NAME}`;
};

const normalizePipelineIds = (value, field) => {
  if (!Array.isArray(value) || value.length > MAX_PIPELINES) {
    throw new Error(`INVALID_SETTINGS:${field}`);
  }
  return [...new Set(value.map(String))].map((id) => {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error(`INVALID_SETTINGS:${field}`);
    return id;
  });
};

const normalizeSettings = (value, currentVersion = 0) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('INVALID_SETTINGS:settings');
  }
  if (typeof value.allowNewBusiness !== 'boolean' || typeof value.allowRenewals !== 'boolean') {
    throw new Error('INVALID_SETTINGS:allowedDealTypes');
  }
  if (!value.allowNewBusiness && !value.allowRenewals) {
    throw new Error('INVALID_SETTINGS:allowedDealTypes');
  }
  const byKind = normalizeQuoteTemplatesByKind(
    value.quoteTemplatesByKind,
    value.enabledQuoteTemplateIds,
    value.defaultQuoteTemplateId,
  );
  return {
    schemaVersion: '1.0',
    version: currentVersion,
    allowNewBusiness: value.allowNewBusiness,
    allowRenewals: value.allowRenewals,
    newBusinessPipelineIds: normalizePipelineIds(
      value.newBusinessPipelineIds || [],
      'newBusinessPipelineIds',
    ),
    quoteTemplatesByKind: byKind,
    // Derived, every save, from the new-business kind. See defaultSettings for why they exist.
    enabledQuoteTemplateIds: byKind.new_business.enabledIds,
    defaultQuoteTemplateId: byKind.new_business.defaultId,
    renewalPipelineIds: normalizePipelineIds(
      value.renewalPipelineIds || [],
      'renewalPipelineIds',
    ),
    pricingPolicy: normalizePricingPolicy(value.pricingPolicy),
  };
};

const request = async (accessToken, path, options = {}) => {
  if (typeof accessToken !== 'string' || accessToken.length < 20) {
    throw new Error('SETTINGS_CONFIGURATION_REQUIRED');
  }
  const response = await fetch(`https://api.hubapi.com${path}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  const text = await response.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = {};
    }
  }
  if (!response.ok) {
    const error = new Error(`HUBSPOT_SETTINGS_API:${response.status}`);
    error.statusCode = response.status;
    throw error;
  }
  return body;
};

const readSettings = async (accessToken, accountId) => {
  const objectType = objectTypeForAccount(accountId);
  let result;
  try {
    result = await request(accessToken, `/crm/v3/objects/${encodeURIComponent(objectType)}/search`, {
      method: 'POST',
      body: {
        filterGroups: [
          { filters: [{ propertyName: 'configuration_key', operator: 'EQ', value: CONFIGURATION_KEY }] },
        ],
        properties: ['configuration_key', 'configuration_json'],
        limit: 1,
      },
    });
  } catch (error) {
    if (error.statusCode === 400 || error.statusCode === 404) {
      return { recordId: null, settings: defaultSettings(), configured: false };
    }
    throw error;
  }
  const record = result.results?.[0];
  if (!record) return { recordId: null, settings: defaultSettings(), configured: true };
  try {
    const parsed = JSON.parse(record.properties?.configuration_json || '{}');
    const version = Number.isInteger(parsed.version) && parsed.version >= 0 ? parsed.version : 0;
    return {
      recordId: String(record.id),
      settings: normalizeSettings(parsed, version),
      configured: true,
    };
  } catch {
    throw new Error('SETTINGS_CONFIGURATION_REQUIRED');
  }
};

const saveSettings = async (accessToken, accountId, userId, incoming, expectedVersion) => {
  const current = await readSettings(accessToken, accountId);
  if (!current.configured) throw new Error('SETTINGS_CONFIGURATION_REQUIRED');
  if (!Number.isInteger(expectedVersion) || expectedVersion !== current.settings.version) {
    throw new Error('SETTINGS_CONFLICT');
  }
  const settings = normalizeSettings(incoming, current.settings.version + 1);
  const properties = {
    configuration_key: CONFIGURATION_KEY,
    configuration_json: JSON.stringify(settings),
    updated_by_user_id: String(userId).slice(0, 30),
    updated_at: new Date().toISOString(),
  };
  const objectType = objectTypeForAccount(accountId);
  if (current.recordId) {
    await request(
      accessToken,
      `/crm/v3/objects/${encodeURIComponent(objectType)}/${encodeURIComponent(current.recordId)}`,
      { method: 'PATCH', body: { properties } },
    );
  } else {
    await request(accessToken, `/crm/v3/objects/${encodeURIComponent(objectType)}`, {
      method: 'POST',
      body: { properties },
    });
  }
  return settings;
};

const readDealPipelines = async (accessToken) => {
  const result = await request(accessToken, '/crm/v3/pipelines/deals');
  return (result.results || [])
    .filter(({ id, label }) => id && label)
    .slice(0, MAX_PIPELINES)
    .map(({ id, label }) => ({ id: String(id), label: String(label).slice(0, 120) }));
};

const isSettingsAdmin = (context) => {
  const actual = userIdFromContext(context);
  const allowed = String(process.env.SETTINGS_ADMIN_USER_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return Boolean(actual) && allowed.some((expected) => {
    if (expected.length !== actual.length) return false;
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
  });
};

const dealCategory = (settings, dealType, pipelineId) => {
  if (settings.renewalPipelineIds.includes(pipelineId)) return 'renewal';
  if (settings.newBusinessPipelineIds.includes(pipelineId)) return 'new_business';
  const normalized = String(dealType || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!normalized) return 'new_business';
  if (normalized === 'newbusiness') return 'new_business';
  if (normalized === 'renewal') return 'renewal';
  return 'unsupported';
};

const isDealAllowed = (settings, dealType, pipelineId) => {
  const category = dealCategory(settings, dealType, pipelineId);
  return (
    (category === 'new_business' && settings.allowNewBusiness) ||
    (category === 'renewal' && settings.allowRenewals)
  );
};

module.exports = {
  APPROVAL_TIERS,
  QUOTE_KINDS,
  accountIdFromContext,
  productRateDescriptors,
  dealCategory,
  defaultPricingPolicy,
  defaultSettings,
  isDealAllowed,
  isSettingsAdmin,
  normalizeSettings,
  quoteKindsForCategory,
  quoteTemplateSettings,
  readDealPipelines,
  readSettings,
  saveSettings,
  userIdFromContext,
};
