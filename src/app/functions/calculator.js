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

const requirePercent = (value, field) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
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

  if (
    largestDiscretionaryDiscount > 0 &&
    largestDiscretionaryDiscount <= activeRules.salesDirectorDiscountMax
  ) {
    tier = firstTier;
    reasons.push(
      `Discretionary discount is greater than 0% and no more than ${percentLabel(activeRules.salesDirectorDiscountMax)}.`,
    );
  } else if (
    largestDiscretionaryDiscount > activeRules.salesDirectorDiscountMax &&
    largestDiscretionaryDiscount <= activeRules.headSalesDiscountMax
  ) {
    tier = secondTier;
    reasons.push(
      `Discretionary discount is greater than ${percentLabel(activeRules.salesDirectorDiscountMax)} and no more than ${percentLabel(activeRules.headSalesDiscountMax)}.`,
    );
  } else if (largestDiscretionaryDiscount > activeRules.headSalesDiscountMax) {
    tier = 'finance';
    reasons.push(
      `Discretionary discount is greater than ${percentLabel(activeRules.headSalesDiscountMax)}.`,
    );
  }

  // A line given away entirely is Finance's call whatever the thresholds say. Redundant while the
  // top threshold is 30% -- 100% already exceeds it -- but it stops a raised threshold from
  // quietly letting a free line through at a lower tier.
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
  const supportAnnual = round(proposedSupportBeforeDiscount * (1 - input.supportDiscount), 2);
  const selectedAddOns = activeRules.addOnRules
    .filter(({ key }) => input.addOns.includes(key))
    .map(({ key, label, annualAmount }) => {
      const exactListMonthlyAmount = activeRules.calculationMethod === 'excel_compatible'
        ? (annualAmount / 12) * (1 - termRule.discount + input.payment.premium)
        : round((annualAmount / 12) * (1 - termRule.discount) * (1 + input.payment.premium), 2);
      const listMonthlyAmount = round(exactListMonthlyAmount, 2);
      const discretionaryDiscount = input.addOnDiscounts[key];
      const exactProposedMonthlyAmount = activeRules.calculationMethod === 'excel_compatible'
        ? exactListMonthlyAmount * (1 - discretionaryDiscount)
        : round(listMonthlyAmount * (1 - discretionaryDiscount), 2);
      const proposedMonthlyAmount = round(exactProposedMonthlyAmount, 2);
      return {
        key,
        label,
        rateCardAnnualAmount: annualAmount,
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
  const listProfessionalServicesAmount = professionalServicesBundle.oneTimeAmount;
  const professionalServicesAmount = round(
    listProfessionalServicesAmount * (1 - input.professionalServicesDiscount),
    2,
  );
  const listOnboardingAmount = input.onboarding.oneTimeAmount;
  const onboardingAmount = round(
    listOnboardingAmount * (1 - input.onboardingDiscount),
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
  ];
  const largestDiscretionaryDiscount = Math.max(0, ...effectiveDiscounts);
  const approval = buildApproval(
    input,
    largestDiscretionaryDiscount,
    committedArr,
    activeRules,
    dealCategory,
  );

  const legacyGuardrails = [];
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
    approvalTierRequired: approval.tier,
    approvalReasons: approval.reasons,
    blockingReasons: approval.blockingReasons,
    calculationStatus:
      approval.blockingReasons.length > 0
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
