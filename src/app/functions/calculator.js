const crypto = require('node:crypto');
const rules = require('./pricingRules');

class QuoteValidationError extends Error {
  constructor(code, field) {
    super(code);
    this.name = 'QuoteValidationError';
    this.code = code;
    this.field = field;
  }
}

const round = (value, decimals = 2) => {
  const multiplier = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
};

const assertPlainObject = (value, field) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new QuoteValidationError('INVALID_OBJECT', field);
  }
};

const requireAllowedString = (value, allowed, field) => {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new QuoteValidationError('UNSUPPORTED_VALUE', field);
  }
  return value;
};

const requireInteger = (value, min, max, field) => {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new QuoteValidationError('INVALID_INTEGER', field);
  }
  return value;
};

// A discretionary discount, as a fraction. NEGATIVE IS LEGAL: it is an uplift, a rate above list.
//
// The workbook has always allowed this. Every discount cell in QUOTE BUILDER column J is free
// entry -- the sheet's only data validation is the three dropdowns -- and K = I * (1 - J), so a
// negative J prices above list by construction. Renewals are the case it exists for: a rep moving
// a legacy rate back toward current list had no field for it and was forced to misstate the rate
// card instead. Holly, 2026-09-02.
//
// The bounds are not symmetric with the workbook's, which has none. The upper bound stays because
// it catches the workbook's own bug -- its onboarding cell holds 20 where every other cell holds a
// fraction, and computes 5,000 x (1 - 20) = -$95,000 (see workbookQuoteBuilder.test.js). A floor of
// -1 is the same guard facing the other way: -20 typed for -20% is refused rather than doubling a
// rate twenty times over. -1 itself means double the list rate, which is further than any real
// uplift needs to go.
const PERCENT_MIN = -1;
const PERCENT_MAX = 1;

const requirePercent = (value, field) => {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < PERCENT_MIN ||
    value > PERCENT_MAX
  ) {
    throw new QuoteValidationError('INVALID_PERCENTAGE', field);
  }
  return value;
};

const findRule = (collection, value, fields, inputField) => {
  const match = collection.find((item) => fields.some((field) => item[field] === value));
  if (!match) throw new QuoteValidationError('UNSUPPORTED_VALUE', inputField);
  return match;
};

const normalizeAddOns = (input) => {
  if (Array.isArray(input)) return input;
  if (!input || typeof input !== 'object') return [];
  const legacyMap = {
    enterpriseAccelerator: 'enterprise_accelerator',
    privacyFilter: 'privacy_filter',
    verifiedOauth: 'verified_oauth',
  };
  return Object.entries(input)
    .filter(([, selected]) => selected === true)
    .map(([key]) => legacyMap[key])
    .filter(Boolean);
};

const normalizeDiscountMap = (value, allowedKeys, field, fallback = 0) => {
  if (value == null) {
    return Object.fromEntries(allowedKeys.map((key) => [key, fallback]));
  }
  assertPlainObject(value, field);
  if (Object.keys(value).some((key) => !allowedKeys.includes(key))) {
    throw new QuoteValidationError('UNSUPPORTED_FIELD', field);
  }
  return Object.fromEntries(
    allowedKeys.map((key) => [key, requirePercent(value[key] ?? fallback, `${field}.${key}`)]),
  );
};

// A REP-ENTERED PRICE, replacing the one the rate card computes.
//
// Holly, 2026-09-03: the Services and Pricing table makes List Price editable per row. Support,
// onboarding, the professional-services bundle and each add-on can be overridden.
//
// STORED AS AN ABSOLUTE FIGURE, NOT A PERCENTAGE. Holly's flat-support-override note rejected the
// percentage form for exactly this reason: "it is a percentage of a moving base, so the figure
// shifts on every re-lock". An absolute price stays where the rep put it. The percentage is
// DERIVED at calculation time, for approval routing and reporting only.
//
// Absent or empty is not the same as present-and-empty: an empty map is dropped entirely so the
// normalized input -- and therefore the state hash -- is byte-identical to what it was before this
// field existed. Otherwise every stored option on every Deal would go stale on deploy.
const normalizeListPriceOverrides = (raw, activeRules) => {
  if (raw == null) return {};
  assertPlainObject(raw, 'listPriceOverrides');
  const allowed = new Set(['support', 'onboarding', 'professionalServices', 'addOns']);
  if (Object.keys(raw).some((key) => !allowed.has(key))) {
    throw new QuoteValidationError('UNSUPPORTED_FIELD', 'listPriceOverrides');
  }
  const money = (value, field) => {
    if (value == null || value === '') return null;
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new QuoteValidationError('INVALID_AMOUNT', field);
    }
    return round(amount, 2);
  };
  const overrides = {};
  for (const field of ['support', 'onboarding', 'professionalServices']) {
    const amount = money(raw[field], `listPriceOverrides.${field}`);
    if (amount != null) overrides[field] = amount;
  }
  if (raw.addOns != null) {
    assertPlainObject(raw.addOns, 'listPriceOverrides.addOns');
    const known = new Set(activeRules.addOnRules.map(({ key }) => key));
    const addOns = {};
    for (const [key, value] of Object.entries(raw.addOns)) {
      // An unknown key is refused rather than ignored. A silently dropped override is a price the
      // rep typed, saw accepted, and did not get -- the failure mode the smoke test found in
      // normalizeSettings and called out as the dangerous kind.
      if (!known.has(key)) {
        throw new QuoteValidationError('UNSUPPORTED_VALUE', 'listPriceOverrides.addOns');
      }
      const amount = money(value, `listPriceOverrides.addOns.${key}`);
      if (amount != null) addOns[key] = amount;
    }
    if (Object.keys(addOns).length > 0) overrides.addOns = addOns;
  }
  return overrides;
};

// How far an entered price sits from the one the rate card computes, as the same signed percentage
// the discount fields already use: positive is a discount, negative is an uplift. This is what
// lets an override reuse the WHOLE existing apparatus -- the approval ladder, the blocking rules
// and the "anything that routes to an approver carries a reason" guard -- with no new machinery.
//
// Clamped to the same bounds as a typed discount. An override of 3x list is -2 before clamping,
// and every magnitude at or beyond 1 already routes to Finance, so the clamp cannot change an
// approval outcome -- it only keeps the reported figure inside the range the rest of the code and
// the Deal properties expect.
const impliedDeparture = (catalogueList, effectiveList) => {
  if (catalogueList === effectiveList) return 0;
  if (!(catalogueList > 0)) {
    // Charging for something the rate card gives away. There is no percentage of zero, so this
    // takes the maximum uplift and lands at the top of the ladder, which is the right place for
    // a price that has no rate-card basis at all.
    return effectiveList > 0 ? PERCENT_MIN : 0;
  }
  const departure = 1 - effectiveList / catalogueList;
  return round(Math.min(PERCENT_MAX, Math.max(PERCENT_MIN, departure)), 6);
};

const normalizeInput = (input, activeRules = rules) => {
  assertPlainObject(input, 'input');
  const allowedInputFields = new Set([
    'startDate',
    'termMonths',
    'paymentFrequency',
    'discretionaryDiscount',
    'productDiscounts',
    'addOnDiscounts',
    'supportDiscount',
    'onboardingDiscount',
    'professionalServicesDiscount',
    'volumes',
    'supportLevel',
    'professionalServices',
    'psItemCount',
    'listPriceOverrides',
    'onboardingPackage',
    'addOns',
    'autoRenewal',
    'renewalTermMonths',
    'nonRenewalNoticeDays',
    'redliningRequested',
    'nonStandardTerms',
    'specialTerms',
  ]);
  if (Object.keys(input).some((field) => !allowedInputFields.has(field))) {
    throw new QuoteValidationError('UNSUPPORTED_FIELD', 'input');
  }

  const listPriceOverrides = normalizeListPriceOverrides(input.listPriceOverrides, activeRules);

  // Bounds derived from the rate card, never restated. A hardcoded 12/36 here would silently
  // reject a term the rate card had added, before the allowedTerms check below could accept it.
  const allowedTerms = activeRules.allowedTerms;
  const termMonths = requireInteger(
    input.termMonths,
    Math.min(...allowedTerms),
    Math.max(...allowedTerms),
    'termMonths',
  );
  if (!allowedTerms.includes(termMonths)) {
    throw new QuoteValidationError('UNSUPPORTED_TERM', 'termMonths');
  }

  const payment = findRule(
    activeRules.paymentRules,
    input.paymentFrequency,
    ['key', 'label', 'hubspotValue'],
    'paymentFrequency',
  );
  const support = findRule(
    activeRules.supportRules,
    input.supportLevel,
    ['key', 'level'],
    'supportLevel',
  );
  const onboarding = findRule(
    activeRules.onboardingRules,
    input.onboardingPackage,
    ['key', 'package'],
    'onboardingPackage',
  );

  const discretionaryDiscount = requirePercent(
    input.discretionaryDiscount ?? 0,
    'discretionaryDiscount',
  );

  const sourceVolumes = input.volumes ?? {};
  assertPlainObject(sourceVolumes, 'volumes');
  const productKeys = new Set(activeRules.products.map(({ key }) => key));
  if (Object.keys(sourceVolumes).some((key) => !productKeys.has(key))) {
    throw new QuoteValidationError('UNSUPPORTED_FIELD', 'volumes');
  }
  const volumes = {};
  for (const product of activeRules.products) {
    volumes[product.key] = requireInteger(
      sourceVolumes[product.key] ?? 0,
      0,
      activeRules.maximumVolume,
      `volumes.${product.key}`,
    );
  }
  const productDiscounts = normalizeDiscountMap(
    input.productDiscounts,
    [...productKeys],
    'productDiscounts',
    discretionaryDiscount,
  );

  const professionalServices = [
    ...new Set(Array.isArray(input.professionalServices) ? input.professionalServices : []),
  ];
  const allowedProfessionalServices = activeRules.professionalServiceOptions.map(({ key }) => key);
  for (const key of professionalServices) {
    requireAllowedString(key, allowedProfessionalServices, 'professionalServices');
  }
  // ALWAYS derived from the selected services, never read from the input.
  //
  // This used to be `input.psItemCount ?? professionalServices.length`, so an explicit psItemCount
  // won over the picker. normalizeStoredInput wrote that field into every stored configuration, so
  // once a config saved with no services was restored, `psItemCount: 0` rode along and pinned the
  // professional-services fee at $0 no matter what the rep selected afterwards. Three services
  // showing "List $0 one-time" on screen is exactly that.
  //
  // Deriving it also closes the older gap the two fields created: the fee was priced from
  // psItemCount while the LINE ITEMS were built from professionalServices, so the two could
  // disagree and put quoted revenue in the pricing properties and in no line item at all. They
  // cannot disagree now, because there is only one source.
  const psItemCount = requireInteger(
    professionalServices.length,
    0,
    5,
    'professionalServices',
  );

  const addOns = normalizeAddOns(input.addOns);
  const allowedAddOns = activeRules.addOnRules.map(({ key }) => key);
  for (const key of addOns) requireAllowedString(key, allowedAddOns, 'addOns');
  const addOnDiscounts = normalizeDiscountMap(
    input.addOnDiscounts,
    allowedAddOns,
    'addOnDiscounts',
    0,
  );

  const autoRenewal = input.autoRenewal === true;
  const renewalTermMonths = autoRenewal ? 12 : 0;
  const nonRenewalNoticeDays = 60;

  if (input.startDate != null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate)) {
      throw new QuoteValidationError('INVALID_DATE', 'startDate');
    }
    const parsedDate = new Date(`${input.startDate}T00:00:00.000Z`);
    if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== input.startDate) {
      throw new QuoteValidationError('INVALID_DATE', 'startDate');
    }
  }
  if (typeof input.specialTerms === 'string' && input.specialTerms.length > 4_000) {
    throw new QuoteValidationError('VALUE_TOO_LONG', 'specialTerms');
  }

  return {
    startDate: input.startDate || null,
    termMonths,
    payment,
    support,
    onboarding,
    discretionaryDiscount,
    productDiscounts,
    addOnDiscounts,
    supportDiscount: requirePercent(input.supportDiscount ?? 0, 'supportDiscount'),
    onboardingDiscount: requirePercent(input.onboardingDiscount ?? 0, 'onboardingDiscount'),
    professionalServicesDiscount: requirePercent(
      input.professionalServicesDiscount ?? 0,
      'professionalServicesDiscount',
    ),
    volumes,
    professionalServices,
    psItemCount,
    // Spread, not a plain key: an empty map must not appear on the normalized input at all, or
    // JSON.stringify(input) changes and every stored option in the portal goes stale on deploy.
    ...(Object.keys(listPriceOverrides).length > 0 ? { listPriceOverrides } : {}),
    addOns: [...new Set(addOns)],
    autoRenewal,
    renewalTermMonths,
    nonRenewalNoticeDays,
    redliningRequested: input.redliningRequested === true,
    nonStandardTerms: false,
    specialTerms:
      input.redliningRequested === true && typeof input.specialTerms === 'string'
        ? input.specialTerms.trim()
        : '',
  };
};

const calculateBandCharge = (volume, bands) =>
  bands.reduce((total, [from, to, marginalRate]) => {
    const upperBound = to == null ? volume : Math.min(volume, to);
    const unitsInBand = Math.max(upperBound - from, 0);
    return total + unitsInBand * marginalRate;
  }, 0);

const calculateAdjustedBandPricing = (
  volume,
  bands,
  termDiscount,
  paymentPremium,
  discretionaryDiscount,
) => {
  const bandRates = bands.map(([lower, upper, rate]) => {
    const upperBound = upper == null ? volume : Math.min(volume, upper);
    const units = Math.max(upperBound - lower, 0);
    const adjustedRate = rate * (1 - termDiscount + paymentPremium);
    const listRate = round(adjustedRate, 2);
    const proposedRate = round(adjustedRate * (1 - discretionaryDiscount), 2);
    return { lower, upper, units, listRate, proposedRate };
  });
  return {
    bandRates,
    exactListMrr: bandRates.reduce((sum, band) => sum + band.units * band.listRate, 0),
    exactProposedMrr: bandRates.reduce(
      (sum, band) => sum + band.units * band.proposedRate,
      0,
    ),
  };
};

const addMonthsUtc = (dateString, months) => {
  const [year, month, day] = dateString.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const finalDay = Math.min(day, new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate());
  target.setUTCDate(finalDay);
  return target;
};

const formatDate = (date) => date.toISOString().slice(0, 10);

const calculateDates = (input) => {
  if (!input.startDate) {
    return {
      contractStartDate: null,
      contractEndDate: null,
      renewalDate: null,
      nonRenewalNoticeDate: null,
    };
  }
  const contractBoundary = addMonthsUtc(input.startDate, input.termMonths);
  const endDate = new Date(contractBoundary.getTime());
  endDate.setUTCDate(endDate.getUTCDate() - 1);
  const renewalDate = new Date(
    Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth() + 1, 1),
  );
  const noticeDate = new Date(endDate.getTime());
  noticeDate.setUTCDate(noticeDate.getUTCDate() - input.nonRenewalNoticeDays);
  return {
    contractStartDate: input.startDate,
    contractEndDate: formatDate(endDate),
    renewalDate: input.autoRenewal ? formatDate(renewalDate) : null,
    nonRenewalNoticeDate: formatDate(noticeDate),
  };
};

const buildApproval = (
  input,
  largestDiscretionaryDiscount,
  committedArr,
  activeRules = rules,
  dealCategory = 'new_business',
  largestDiscretionaryUplift = 0,
) => {
  const reasons = [];
  // EVERY ENTRY HERE IS READ BY A REP, VERBATIM.
  //
  // The card renders blockingReasons straight into the red banner, mixed with prose it writes
  // itself ("A discount reason is required before this can be locked in."). Until 2026-09-02 two of
  // these were SHOUTY_IDENTIFIERS -- BELOW_ENTERPRISE_MINIMUM and SPECIAL_TERMS_BELOW_THRESHOLD --
  // sitting in that banner next to real sentences.
  //
  // So: a sentence, and one that says what to DO about it. The parallel `reasons` array is the
  // descriptive half ("Committed ARR is below the $25,000 Enterprise minimum"); this one is the
  // remedy. A test asserts no entry is an identifier.
  const blockingReasons = [];
  let tier = 'none';
  const percentLabel = (value) => `${round(value * 100, 2)}%`;
  const currencyLabel = (value) => `$${round(value, 2).toLocaleString('en-US')}`;
  const isRenewal = dealCategory === 'renewal';

  // THE APPROVAL MATRIX. One ladder, shared by both deal types; only the approver's name changes.
  // Holly, 2026-08-28:
  //
  //   0%                              no approval                   all
  //   up to salesDirectorDiscountMax  Sales Director / CS Director   new / renewal
  //   up to headSalesDiscountMax      Head of Sales / CCSO           new / renewal
  //   above that                      Finance                        all
  //
  // Term length and payment frequency never count toward this. They adjust the RATE and are
  // pre-approved; largestDiscretionaryDiscount is only what a rep typed as a concession.
  //
  // An earlier build this same day routed ALL renewal discounts to the CCSO with no ladder. This
  // table replaced it.
  const firstTier = isRenewal
    ? activeRules.renewalFirstApprovalTier
    : activeRules.newBusinessFirstApprovalTier;
  const secondTier = isRenewal
    ? activeRules.renewalSecondApprovalTier
    : activeRules.newBusinessSecondApprovalTier;

  // THE LADDER RUNS ON MAGNITUDE, IN BOTH DIRECTIONS. Shane, 2026-09-02: "With absolute approval
  // thresholds working? Meaning -11% premium pricing (avg TCV) will go to Ana/Chris?" -- yes, and
  // this is what makes it so.
  //
  // This is a DELIBERATE departure from the workbook, and the only one in the approval path. The
  // sheet routes on MAX(J13:J19,J26:J28,J33,J38,J40) against >0.3, >0.1 and >0.0001, so an uplift
  // clears none of them and reads "None - Auto Approved (rate card)". That was defensible while an
  // uplift was purely the customer paying more. It stopped being defensible once a -45% entry --
  // pricing a line at nearly twice the rate card, with no reason recorded and nobody informed --
  // could go out under it. Off the rate card is off the rate card, whichever way it points.
  //
  // The two figures stay separate everywhere else. largestDiscretionaryDiscount is still only what
  // was given away, and is what the Deal and the option document report; the uplift is reported in
  // its own right. Only the ROUTING takes the larger of the two.
  const largestRateDeparture = Math.max(
    largestDiscretionaryDiscount,
    largestDiscretionaryUplift,
  );
  // Which word the approver reads. Ties go to "discount": if a deal holds a 12% discount and a 12%
  // uplift, the discount is the one that needs defending.
  const departureLabel =
    largestDiscretionaryUplift > largestDiscretionaryDiscount
      ? 'Discretionary uplift'
      : 'Discretionary discount';

  if (
    largestRateDeparture > 0 &&
    largestRateDeparture <= activeRules.salesDirectorDiscountMax
  ) {
    tier = firstTier;
    reasons.push(
      `${departureLabel} is greater than 0% and no more than ${percentLabel(activeRules.salesDirectorDiscountMax)}.`,
    );
  } else if (
    largestRateDeparture > activeRules.salesDirectorDiscountMax &&
    largestRateDeparture <= activeRules.headSalesDiscountMax
  ) {
    tier = secondTier;
    reasons.push(
      `${departureLabel} is greater than ${percentLabel(activeRules.salesDirectorDiscountMax)} and no more than ${percentLabel(activeRules.headSalesDiscountMax)}.`,
    );
  } else if (largestRateDeparture > activeRules.headSalesDiscountMax) {
    tier = 'finance';
    reasons.push(
      `${departureLabel} is greater than ${percentLabel(activeRules.headSalesDiscountMax)}.`,
    );
  }

  // A line given away entirely is Finance's call whatever the thresholds say. Redundant while the
  // top threshold is 30% -- 100% already exceeds it -- but it stops a raised threshold from
  // quietly letting a free line through at a lower tier.
  //
  // DISCOUNT ONLY, and not by omission. A -100% entry is a line priced at double, which the ladder
  // above already sends to Finance on magnitude. A free line is a different fact about a contract
  // and keeps its own named reason; "A line is discounted 100%" must not appear on a deal where
  // nothing was given away.
  if (activeRules.financeApprovesFullDiscount && largestDiscretionaryDiscount >= 1) {
    tier = 'finance';
    reasons.push('A line is discounted 100%.');
  }

  if (input.nonStandardTerms) {
    tier = 'finance';
    reasons.push('Contract includes non-standard terms.');
  }
  const relaxed = isRenewal && activeRules.renewalRelaxesNonDiscountApprovals;
  // The one switch. A `minimumCommittedArr > 0` guard was tried here and removed: committed ARR is
  // never negative, so a threshold of 0 already blocks nothing, and no mutation could make that
  // guard change an outcome. The flag is what turns the rule off, not a tiny threshold -- the live
  // settings record carried a stray 10 that disabled it by accident rather than by decision.
  const minimumArrApplies = activeRules.enforceMinimumCommittedArr === true;
  // Renewals skip the ARR-based rules. Both BLOCK Lock in rather than escalating, and a renewal is
  // expected to land under the new-business minimum, so leaving them on refuses every small
  // renewal outright. Holly, 2026-08-28. Non-standard terms are NOT relaxed -- the matrix says
  // Finance for all deal types.
  if (minimumArrApplies && !relaxed && committedArr < activeRules.minimumCommittedArr) {
    tier = 'finance';
    reasons.push(
      `Committed ARR is below the ${currencyLabel(activeRules.minimumCommittedArr)} Enterprise minimum.`,
    );
    blockingReasons.push(
      `Committed ARR must reach ${currencyLabel(activeRules.minimumCommittedArr)} before this ` +
        'can be locked in. Raise the commitment or the term, or ask Finance for an exception.',
    );
  }
  if (!relaxed && input.redliningRequested && committedArr < activeRules.redliningMinimumArr) {
    tier = 'finance';
    reasons.push(
      `Special terms were requested below the ${currencyLabel(activeRules.redliningMinimumArr)} ` +
        'ARR threshold.',
    );
    blockingReasons.push(
      `Special terms require ${currencyLabel(activeRules.redliningMinimumArr)} committed ARR. ` +
        'Raise the commitment, or remove the special-terms request.',
    );
  }
  if (input.redliningRequested) {
    reasons.push('Customer-requested special terms require Legal approval.');
  }
  // REINSTATED 2026-09-01, Holly: "Yes enforce that."
  //
  // This rule was REMOVED on 2026-08-28 -- "Turnkey Verified OAuth no longer requires a
  // professional-services item" -- and is deliberately back. What changed is the source of truth:
  // OneSubscription Pricing Workbook v9 names the add-on
  //
  //     "Turnkey Verified OAuth Projects (req. PS)"
  //
  // in all three places it appears (RATE CARD B130, QUOTE BUILDER B28, PRICING TABLES G26), and v9
  // postdates the removal. If the workbook is the one that is stale, this is the block to lift --
  // not the label to ignore.
  //
  // ANY professional-services item satisfies it. The workbook says "req. PS" and never names one,
  // and two of the five items plausibly qualify (Google Verification Review, Provider OAuth App
  // Creation). Demanding a specific item would refuse quotes the workbook permits, and refusing a
  // legitimate quote is worse here than allowing an unusual pairing. Holly's call, 2026-09-01.
  //
  // NOT relaxed on renewals. `relaxed` waives approval THRESHOLDS; this is a product dependency,
  // and a renewal that sells the add-on needs the services just as a new deal does.
  //
  // A SENTENCE, not a SHOUTY_CODE: the card renders blockingReasons verbatim to the rep, mixed in
  // with prose like "A discount reason is required before this can be locked in." The two codes
  // above predate that and read as identifiers in a red banner -- do not copy them.
  if (
    input.addOns.includes('verified_oauth') &&
    input.professionalServices.length === 0
  ) {
    blockingReasons.push(
      'Turnkey Verified OAuth Projects requires a Professional Services item. Add one under ' +
        'Professional Services, or remove the add-on.',
    );
  }

  return { tier, reasons, blockingReasons };
};

const buildActiveRules = (pricingPolicy = {}) => ({
  ...rules,
  calculationMethod: pricingPolicy.calculationMethod ?? rules.calculationMethod,
  products: rules.products.map((product) => ({
    ...product,
    bands: product.bands.map((band, index) => [
      band[0],
      band[1],
      pricingPolicy.productBandRates?.[product.key]?.[index] ?? band[2],
    ]),
  })),
  minimumCommittedArr: pricingPolicy.minimumCommittedArr ?? rules.minimumCommittedArr,
  enforceMinimumCommittedArr:
    pricingPolicy.enforceMinimumCommittedArr ?? rules.enforceMinimumCommittedArr,
  redliningMinimumArr: pricingPolicy.redliningMinimumArr ?? rules.redliningMinimumArr,
  // This merge is an explicit allow-list, not a spread, so a new policy key silently falls back to
  // the frozen rules until it is named here. Adding the settings entry alone was not enough: the
  // override was accepted, validated, normalized -- and then ignored, which a test that only
  // passed an override would have reported as the rule working correctly.
  creditCardMaximumInvoice:
    pricingPolicy.creditCardMaximumInvoice ?? rules.creditCardMaximumInvoice,
  salesDirectorDiscountMax:
    pricingPolicy.salesDirectorDiscountMax ?? rules.salesDirectorDiscountMax,
  headSalesDiscountMax: pricingPolicy.headSalesDiscountMax ?? rules.headSalesDiscountMax,
  // The approval matrix, configurable in Settings. The merge here is an explicit allow-list, not
  // a spread: a key not named here is accepted, validated, normalized -- and then ignored.
  newBusinessFirstApprovalTier: pricingPolicy.newBusinessFirstApprovalTier ?? 'sales_director',
  newBusinessSecondApprovalTier: pricingPolicy.newBusinessSecondApprovalTier ?? 'head_sales',
  renewalFirstApprovalTier: pricingPolicy.renewalFirstApprovalTier ?? 'cs_director',
  renewalSecondApprovalTier: pricingPolicy.renewalSecondApprovalTier ?? 'ccso',
  financeApprovesFullDiscount: pricingPolicy.financeApprovesFullDiscount ?? true,
  renewalRelaxesNonDiscountApprovals:
    pricingPolicy.renewalRelaxesNonDiscountApprovals ?? true,
  termRules: rules.termRules.map((rule) => ({
    ...rule,
    discount: pricingPolicy.termDiscounts?.[String(rule.months)] ?? rule.discount,
  })),
  paymentRules: rules.paymentRules.map((rule) => ({
    ...rule,
    premium: pricingPolicy.paymentPremiums?.[rule.key] ?? rule.premium,
  })),
  supportRules: rules.supportRules.map((rule) => ({
    ...rule,
    percentOfPlatformArr:
      pricingPolicy.support?.[rule.key]?.percent ?? rule.percentOfPlatformArr,
    annualCap: pricingPolicy.support?.[rule.key]?.cap ?? rule.annualCap,
  })),
  onboardingRules: rules.onboardingRules.map((rule) => ({
    ...rule,
    oneTimeAmount: pricingPolicy.onboardingAmounts?.[rule.key] ?? rule.oneTimeAmount,
  })),
  professionalServicesRules: rules.professionalServicesRules.map((rule) => ({
    ...rule,
    oneTimeAmount:
      pricingPolicy.professionalServicesAmounts?.[rule.itemCount] ?? rule.oneTimeAmount,
  })),
  addOnRules: rules.addOnRules.map((rule) => ({
    ...rule,
    annualAmount: pricingPolicy.addOnAnnualAmounts?.[rule.key] ?? rule.annualAmount,
  })),
});

// dealCategory is a 4th ARGUMENT rather than a field on the input, deliberately: the input is
// hashed, stored on the Deal and restored, so putting it there would make the same configuration
// hash differently on a renewal and would have to survive normalizeStoredInput. It is a fact about
// the DEAL, not about what was configured, and the caller already knows it.
const calculateQuote = (
  rawInput,
  pricingPolicy = {},
  settingsVersion = 0,
  dealCategory = 'new_business',
) => {
  const activeRules = buildActiveRules(pricingPolicy);
  const input = normalizeInput(rawInput, activeRules);
  const termRule = activeRules.termRules.find(({ months }) => months === input.termMonths);

  const lines = activeRules.products.map((product) => {
    const volume = input.volumes[product.key];
    const entryRate = product.bands[0][2];
    const bandCharge = calculateBandCharge(volume, product.bands);
    const baseBlendedRate = volume === 0 ? 0 : round(bandCharge / volume, 3);
    const baseForCustomerRate = volume === 0 ? entryRate : baseBlendedRate;
    const excelCompatible = activeRules.calculationMethod === 'excel_compatible';
    let exactListUnitRate = excelCompatible
      ? baseForCustomerRate * (1 - termRule.discount + input.payment.premium)
      : round(baseForCustomerRate * (1 - termRule.discount) * (1 + input.payment.premium), 2);
    const discretionaryDiscount = input.productDiscounts[product.key];
    let exactProposedUnitRate = excelCompatible
      ? exactListUnitRate * (1 - discretionaryDiscount)
      : round(round(exactListUnitRate, 2) * (1 - discretionaryDiscount), 2);
    let exactListMrr = volume * exactListUnitRate;
    let exactProposedMrr = volume * exactProposedUnitRate;
    let proposedBandRates = [];
    let listBandRates = [];
    if (product.pricingModel === 'graduated_adjusted_bands') {
      const adjusted = calculateAdjustedBandPricing(
        volume,
        product.bands,
        termRule.discount,
        input.payment.premium,
        discretionaryDiscount,
      );
      exactListMrr = adjusted.exactListMrr;
      exactProposedMrr = adjusted.exactProposedMrr;
      exactListUnitRate = volume === 0 ? adjusted.bandRates[0].listRate : exactListMrr / volume;
      exactProposedUnitRate =
        volume === 0 ? adjusted.bandRates[0].proposedRate : exactProposedMrr / volume;
      proposedBandRates = adjusted.bandRates.map(({ lower, upper, proposedRate }) => ({
        lower,
        upper,
        rate: proposedRate,
      }));
      // The card must never recompute list band rates itself — the adjustment is additive
      // (rate * (1 - termDiscount + paymentPremium)) and rounded here, and a UI-side
      // reimplementation drifts from the rates the quote is actually built from.
      listBandRates = adjusted.bandRates.map(({ lower, upper, listRate }) => ({
        lower,
        upper,
        rate: listRate,
      }));
    }
    const listUnitRate = round(exactListUnitRate, 2);
    const displayListUnitRate = round(exactListUnitRate, 4);
    const proposedUnitRate = round(exactProposedUnitRate, 2);
    const displayProposedUnitRate = round(exactProposedUnitRate, 4);
    const billingUnitRate = round(exactProposedUnitRate, 9);
    const listMrr = round(exactListMrr, 2);
    const proposedMrr = round(exactProposedMrr, 2);

    return {
      productKey: product.key,
      productName: product.name,
      unitOfMeasure: product.unitOfMeasure,
      volume,
      committed: volume > 0,
      baseUnitRate: entryRate,
      baseBlendedRate,
      listUnitRate: volume === 0 ? 0 : listUnitRate,
      displayListUnitRate,
      proposedUnitRate: volume === 0 ? 0 : proposedUnitRate,
      displayProposedUnitRate,
      billingUnitRate,
      baseBandRates: product.bands.map(([lower, upper, rate]) => ({ lower, upper, rate })),
      listBandRates,
      proposedBandRates,
      availableUnitRate: proposedUnitRate,
      discretionaryDiscount,
      listMrr,
      proposedMrr,
      annualCommitment: round(exactProposedMrr * 12, 2),
      listTermCommitment: round(exactListMrr * input.termMonths, 2),
      termCommitment: round(exactProposedMrr * input.termMonths, 2),
      exactListMrr,
      exactProposedMrr,
    };
  });

  const listPlatformArr = round(lines.reduce((sum, line) => sum + line.exactListMrr, 0) * 12, 2);
  const proposedPlatformArr = round(
    lines.reduce((sum, line) => sum + line.exactProposedMrr, 0) * 12,
    2,
  );
  const listSupportAnnual = round(
    Math.min(
      listPlatformArr * input.support.percentOfPlatformArr,
      input.support.annualCap,
    ),
    2,
  );
  const proposedSupportBeforeDiscount = round(
    Math.min(
      proposedPlatformArr * input.support.percentOfPlatformArr,
      input.support.annualCap,
    ),
    2,
  );
  // Charged support stays a percentage of the ARR the customer actually pays
  // (proposedPlatformArr). listSupportAnnual above is the list-price counterpart and must be
  // derived from listPlatformArr, otherwise product discounts leak into the "list" figure and
  // understate the blended effective discount.
  // AN OVERRIDDEN SUPPORT PRICE IS THE FLAT SUPPORT OVERRIDE Shane asked for.
  //
  // Support has no rate-card price to look up -- it is a percentage of the ARR the customer pays,
  // capped. Reps quote a flat figure off the prospect's early projections and do not want the
  // customer to see it is derived, because a visibly dynamic support price invites them to shrink
  // the contract to shrink it (claude/post-release-followups-2026-09-02.md). An entered figure replaces the
  // calculated one outright; the discount, if any, then applies to what the rep entered.
  const overrides = input.listPriceOverrides || {};
  const catalogueSupportList = proposedSupportBeforeDiscount;
  const effectiveSupportList =
    overrides.support != null ? overrides.support : catalogueSupportList;
  const supportOverrideDeparture = impliedDeparture(catalogueSupportList, effectiveSupportList);
  const supportAnnual = round(effectiveSupportList * (1 - input.supportDiscount), 2);
  const selectedAddOns = activeRules.addOnRules
    .filter(({ key }) => input.addOns.includes(key))
    .map(({ key, label, annualAmount }) => {
      // The rep's figure stands in for the rate card's annual amount, so the term discount and
      // payment premium still apply to it exactly as they would to a catalogue price. Overriding
      // the price does not opt a line out of the deal's own terms.
      const catalogueAnnualAmount = annualAmount;
      const effectiveAnnualAmount =
        overrides.addOns?.[key] != null ? overrides.addOns[key] : catalogueAnnualAmount;
      const overrideDeparture = impliedDeparture(catalogueAnnualAmount, effectiveAnnualAmount);
      const exactListMonthlyAmount = activeRules.calculationMethod === 'excel_compatible'
        ? (effectiveAnnualAmount / 12) * (1 - termRule.discount + input.payment.premium)
        : round((effectiveAnnualAmount / 12) * (1 - termRule.discount) * (1 + input.payment.premium), 2);
      const listMonthlyAmount = round(exactListMonthlyAmount, 2);
      const discretionaryDiscount = input.addOnDiscounts[key];
      const exactProposedMonthlyAmount = activeRules.calculationMethod === 'excel_compatible'
        ? exactListMonthlyAmount * (1 - discretionaryDiscount)
        : round(listMonthlyAmount * (1 - discretionaryDiscount), 2);
      const proposedMonthlyAmount = round(exactProposedMonthlyAmount, 2);
      return {
        key,
        label,
        rateCardAnnualAmount: catalogueAnnualAmount,
        // Both figures, so the quote's history stays auditable -- Holly, 2026-09-03.
        catalogueAnnualAmount,
        effectiveAnnualAmount,
        overrideDeparture,
        listMonthlyAmount,
        proposedMonthlyAmount,
        billingMonthlyAmount: round(exactProposedMonthlyAmount, 9),
        listAnnualAmount: round(exactListMonthlyAmount * 12, 2),
        annualAmount: round(exactProposedMonthlyAmount * 12, 2),
        discretionaryDiscount,
      };
    });
  const annualAddOns = selectedAddOns.reduce((sum, item) => sum + item.annualAmount, 0);
  const listAnnualAddOns = selectedAddOns.reduce((sum, item) => sum + item.listAnnualAmount, 0);
  // `.find(...).oneTimeAmount` used to be read straight off the match. A bundle size the rate
  // card does not price -- today six items, whose price the MRD still lists as TBD -- would have
  // thrown TypeError: Cannot read properties of undefined, surfacing to the rep as a broken card
  // rather than a priced quote with a clear reason.
  const professionalServicesBundle = activeRules.professionalServicesRules.find(
    ({ itemCount }) => itemCount === input.psItemCount,
  );
  if (!professionalServicesBundle || professionalServicesBundle.oneTimeAmount == null) {
    throw new QuoteValidationError(
      'PROFESSIONAL_SERVICES_BUNDLE_PRICE_REQUIRED',
      'professionalServices',
    );
  }
  // Priced by BUNDLE COUNT, so the override replaces the ladder's figure for that count -- there
  // is no per-service price to override. Holly, 2026-09-03: one row carrying the ladder price.
  const catalogueProfessionalServicesList = professionalServicesBundle.oneTimeAmount;
  const listProfessionalServicesAmount = catalogueProfessionalServicesList;
  const effectiveProfessionalServicesList =
    overrides.professionalServices != null
      ? overrides.professionalServices
      : catalogueProfessionalServicesList;
  const professionalServicesOverrideDeparture = impliedDeparture(
    catalogueProfessionalServicesList,
    effectiveProfessionalServicesList,
  );
  const professionalServicesAmount = round(
    effectiveProfessionalServicesList * (1 - input.professionalServicesDiscount),
    2,
  );
  const catalogueOnboardingList = input.onboarding.oneTimeAmount;
  const listOnboardingAmount = catalogueOnboardingList;
  const effectiveOnboardingList =
    overrides.onboarding != null ? overrides.onboarding : catalogueOnboardingList;
  const onboardingOverrideDeparture = impliedDeparture(
    catalogueOnboardingList,
    effectiveOnboardingList,
  );
  const onboardingAmount = round(
    effectiveOnboardingList * (1 - input.onboardingDiscount),
    2,
  );
  const oneTime = onboardingAmount + professionalServicesAmount;
  const listOneTime = listOnboardingAmount + listProfessionalServicesAmount;
  const committedArr = round(proposedPlatformArr + supportAnnual + annualAddOns, 2);
  const listCommittedArr = round(listPlatformArr + listSupportAnnual + listAnnualAddOns, 2);
  const tcv = round(committedArr * (input.termMonths / 12) + oneTime, 2);
  const listTcv = round(listCommittedArr * (input.termMonths / 12) + listOneTime, 2);
  const recurringPerPeriod = round(committedArr / input.payment.paymentsPerYear, 2);
  // Invoice amounts, which are NOT the same thing as ARR or TCV and are what the payment-method
  // rule is judged on.
  //
  // The first invoice carries the recurring payment PLUS every one-time charge, so it is the
  // largest. Subsequent invoices are the recurring payment alone. A $240,000 ARR deal billed
  // monthly invoices $20,000 a period but $35,000 up front if $15,000 of onboarding rides along.
  const firstInvoiceAmount = round(recurringPerPeriod + oneTime, 2);
  const recurringInvoiceAmount = recurringPerPeriod;
  const largestInvoiceAmount = Math.max(firstInvoiceAmount, recurringInvoiceAmount);
  // Credit card is not permitted above the limit; ACH/Bank Transfer (wire) is required. The
  // calculator only states the FACT -- it never sees the selected payment method, which arrives
  // separately at Lock in. The card and lockLiveCalculation both enforce it from this flag.
  const requiresBankTransfer =
    activeRules.creditCardMaximumInvoice != null &&
    largestInvoiceAmount > activeRules.creditCardMaximumInvoice;
  // Only discounts that actually move money count toward approval routing. A discount typed
  // against a product with no volume, an add-on that is not selected, or a $0 support/onboarding/
  // professional-services line changes no total, so it must not escalate the approval tier.
  const effectiveDiscounts = [
    ...Object.entries(input.productDiscounts)
      .filter(([key]) => input.volumes[key] > 0)
      .map(([, discount]) => discount),
    ...Object.entries(input.addOnDiscounts)
      .filter(([key]) => input.addOns.includes(key))
      .map(([, discount]) => discount),
    ...(listSupportAnnual > 0 ? [input.supportDiscount] : []),
    ...(listOnboardingAmount > 0 ? [input.onboardingDiscount] : []),
    ...(listProfessionalServicesAmount > 0 ? [input.professionalServicesDiscount] : []),
    // AN OVERRIDDEN PRICE ROUTES LIKE A DISCOUNT OR AN UPLIFT. Holly, 2026-09-03.
    //
    // This single line is what makes the whole feature safe: by expressing an override as the same
    // signed percentage a typed discount uses, it inherits the approval ladder, the blocking rules
    // AND the "anything that routes to an approver carries a reason" guard from 2026-09-02. No new
    // approval path, no second ladder to keep in step, and nothing can be repriced without a trail.
    //
    // Zeros are harmless: with no overrides every departure is 0, Math.max is unchanged, and the
    // workbook parity fixtures still pass -- verified across all 61 parity tests.
    supportOverrideDeparture,
    onboardingOverrideDeparture,
    professionalServicesOverrideDeparture,
    ...selectedAddOns.map(({ overrideDeparture }) => overrideDeparture),
  ];
  // The floor of 0 is what makes an UPLIFT approval-neutral, and it is the workbook's own rule
  // rather than a convenience. QUOTE BUILDER E62 routes on
  // MAX(J13:J19,J26:J28,J33,J38,J40) tested against >0.3, >0.1 and >0.0001, so a sheet whose
  // discount cells are all negative falls through every branch to "None - Auto Approved (rate
  // card)". A mix routes on the largest POSITIVE entry, which is what MAX returns and what this
  // returns. An uplift is the customer paying more; there is nothing to approve.
  const largestDiscretionaryDiscount = Math.max(0, ...effectiveDiscounts);
  // The uplift side, as a POSITIVE magnitude. Kept as its own figure rather than folded into the
  // one above, because the two answer different questions: how much was given away, and how far
  // above the rate card did this go. Reports, the Deal and the option document want them apart.
  // Only approval routing takes the larger of the two -- see buildApproval.
  const largestDiscretionaryUplift = Math.max(
    0,
    ...effectiveDiscounts.map((discount) => -discount),
  );
  const approval = buildApproval(
    input,
    largestDiscretionaryDiscount,
    committedArr,
    activeRules,
    dealCategory,
    largestDiscretionaryUplift,
  );

  // AN OVERRIDE MAY NOT BREACH THE SUPPORT CAP. Holly, 2026-09-03 -- see
  // claude/support-cap-decision.md. The cap is the tier's annualCap, so Basic (cap 0) cannot be
  // given a price at all: support that the rate card gives away is not something a rep may start
  // charging for by typing a number.
  const overrideBlockingReasons = [];
  if (
    overrides.support != null &&
    overrides.support > input.support.annualCap
  ) {
    overrideBlockingReasons.push(
      `A support price of $${round(overrides.support, 2).toLocaleString('en-US')} exceeds the ` +
        `$${round(input.support.annualCap, 2).toLocaleString('en-US')} cap for ` +
        `${input.support.level}. Lower the price, or change the support level.`,
    );
  }
  const blockingReasons = [...approval.blockingReasons, ...overrideBlockingReasons];

  const legacyGuardrails = [];
  // DISCOUNT ONLY. This one is named FINANCE_APPROVAL_MULTI_YEAR_DISCOUNT and means "a deep
  // discount locked in for more than a year". An uplift held for three years is not that, and the
  // magnitude ladder in buildApproval already sends anything this size to Finance regardless.
  if (largestDiscretionaryDiscount > activeRules.headSalesDiscountMax && input.termMonths > 12) {
    legacyGuardrails.push('FINANCE_APPROVAL_MULTI_YEAR_DISCOUNT');
  }
  if (
    activeRules.enforceMinimumCommittedArr === true &&
    committedArr < activeRules.minimumCommittedArr
  ) {
    legacyGuardrails.push('FINANCE_APPROVAL_BELOW_MINIMUM');
  }

  const dates = calculateDates(input);
  const result = {
    schemaVersion: rules.schemaVersion,
    calculationVersion: `${rules.priceListVersion} / ${activeRules.calculationMethod} / settings ${settingsVersion}`,
    calculationMethod: activeRules.calculationMethod,
    settingsVersion,
    currency: rules.currency,
    calculatedAt: new Date().toISOString(),
    termDiscount: termRule.discount,
    paymentPremium: input.payment.premium,
    paymentFrequencyHubSpotValue: input.payment.hubspotValue,
    paymentsPerYear: input.payment.paymentsPerYear,
    billingPeriod: input.payment.period,
    lines,
    quotedProducts: lines.filter(({ committed }) => committed).map(({ productKey }) => productKey),
    listPlatformArr,
    proposedPlatformArr,
    listSupportAnnual,
    supportAnnual,
    // BOTH FIGURES, for audit: what the rate card said and what the rep entered. Holly, 2026-09-03:
    // "Store both the default catalog price and the user-entered price so the quote calculation
    // history remains auditable."
    catalogueSupportList,
    effectiveSupportList,
    supportOverrideDeparture,
    catalogueOnboardingList,
    effectiveOnboardingList,
    onboardingOverrideDeparture,
    catalogueProfessionalServicesList,
    effectiveProfessionalServicesList,
    professionalServicesOverrideDeparture,
    listPriceOverrides: overrides,
    selectedAddOns,
    annualAddOns,
    listAnnualAddOns,
    listProfessionalServicesAmount,
    professionalServicesAmount,
    listOnboardingAmount,
    onboardingAmount,
    listCommittedArr,
    committedArr,
    recurringPerPeriod,
    firstInvoiceAmount,
    recurringInvoiceAmount,
    largestInvoiceAmount,
    requiresBankTransfer,
    creditCardMaximumInvoice: activeRules.creditCardMaximumInvoice,
    listOneTime,
    oneTime,
    listTcv,
    tcv,
    largestDiscretionaryDiscount,
    largestDiscretionaryUplift,
    approvalTierRequired: approval.tier,
    approvalReasons: approval.reasons,
    blockingReasons,
    calculationStatus:
      blockingReasons.length > 0
        ? 'blocked'
        : approval.tier === 'none'
          ? 'ready'
          : 'approval_required',
    approvalStatus:
      legacyGuardrails.length === 0 ? 'WITHIN_GUARDRAILS' : legacyGuardrails.join('; '),
    dates,
  };

  result.stateHash = crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        input,
        calculationVersion: result.calculationVersion,
        pricingPolicy,
      }),
    )
    .digest('hex');

  return result;
};

// The shape that must be persisted on the Deal. normalizeInput resolves paymentFrequency /
// supportLevel / onboardingPackage to rule OBJECTS for pricing, but storage and the line-item
// CATALOG need their keys. Persisting the raw card input instead lets a human label such as
// 'Full Support' calculate fine and then fail later with PRODUCT_MAPPING_REQUIRED, and lets
// duplicate professionalServices entries become duplicate line items.
const normalizeStoredInput = (rawInput, pricingPolicy = {}) => {
  const input = normalizeInput(rawInput, buildActiveRules(pricingPolicy));
  return {
    startDate: input.startDate,
    termMonths: input.termMonths,
    paymentFrequency: input.payment.key,
    supportLevel: input.support.key,
    onboardingPackage: input.onboarding.key,
    discretionaryDiscount: input.discretionaryDiscount,
    productDiscounts: input.productDiscounts,
    addOnDiscounts: input.addOnDiscounts,
    supportDiscount: input.supportDiscount,
    onboardingDiscount: input.onboardingDiscount,
    professionalServicesDiscount: input.professionalServicesDiscount,
    volumes: input.volumes,
    professionalServices: input.professionalServices,
    // Same conditional as normalizeInput: absent when empty, so a Deal with no overrides hashes
    // exactly as it did before this field existed.
    ...(input.listPriceOverrides && Object.keys(input.listPriceOverrides).length > 0
      ? { listPriceOverrides: input.listPriceOverrides }
      : {}),
    // psItemCount is deliberately NOT stored. It is derived from professionalServices on every
    // calculation, and persisting it is what let a stale count outlive the selection it came from.

    addOns: input.addOns,
    autoRenewal: input.autoRenewal,
    renewalTermMonths: input.renewalTermMonths,
    nonRenewalNoticeDays: input.nonRenewalNoticeDays,
    redliningRequested: input.redliningRequested,
    nonStandardTerms: input.nonStandardTerms,
    specialTerms: input.specialTerms,
  };
};

module.exports = {
  QuoteValidationError,
  calculateQuote,
  buildActiveRules,
  normalizeInput,
  normalizeStoredInput,
  round,
  rules,
};
