// The term ladder. Hoisted out of the frozen export so `allowedTerms` can be DERIVED from it
// rather than restated -- a second handwritten copy is how the onboarding amounts drifted.
const termRules = Object.freeze([
  Object.freeze({ months: 12, discount: 0 }),
  Object.freeze({ months: 24, discount: 0.025 }),
  Object.freeze({ months: 36, discount: 0.05 }),
]);

module.exports = Object.freeze({
  schemaVersion: '1.0',
  priceListVersion: 'FY26 v1',
  calculationMethod: 'excel_compatible',
  currency: 'USD',
  effectiveDate: '2026-07-01',
  allowedTerms: termRules.map(({ months }) => months),
  maximumVolume: 1_000_000_000,
  minimumCommittedArr: 25_000,
  // DISABLED. Holly, 2026-08-31: "Just disable the arr minumum."
  //
  // The workbook states a $25,000 Enterprise recurring minimum, so the number stays above rather
  // than being deleted -- deleting it would lose the rate card's own statement of the rule and make
  // re-enabling it a guess. This flag is the switch, and Settings exposes it, so turning the
  // minimum back on is one checkbox and the threshold it uses is already correct.
  //
  // While false: committed ARR below the minimum neither escalates to Finance nor blocks Lock in.
  // The redlining/special-terms ARR threshold is SEPARATE and still enforced.
  enforceMinimumCommittedArr: false,
  redliningMinimumArr: 50_000,
  // Credit card is not accepted on an invoice above this amount -- ACH/Bank Transfer (wire) is
  // required. Holly, 2026-08-27, as a hard REQUIREMENT rather than an approval step.
  //
  // Compared against the LARGEST SINGLE INVOICE, not against ARR or TCV. The first invoice carries
  // the recurring payment plus every one-time charge (onboarding and professional services), so it
  // is the largest one and it is what decides this. A $240,000 ARR deal billed monthly invoices
  // $20,000 a period -- under the limit -- but $35,000 on the first invoice if $15,000 of
  // onboarding rides along with it, which is over. Testing ARR would have missed that.
  creditCardMaximumInvoice: 25_000,
  // The approval ladder's two thresholds. Here rather than only in appSettings so there is
  // exactly ONE place a rate or threshold lives -- calculator.js used to fall back to bare
  // 0.1 / 0.3 literals, a second copy nothing kept in step.
  salesDirectorDiscountMax: 0.1,
  headSalesDiscountMax: 0.3,
  products: [
    {
      key: 'connect_ca',
      // "Connect" alone is ambiguous next to "Calendar Only" on a customer-facing quote -- both
      // are Connect products. Display only; every lookup is by `key`.
      name: 'Email + Calendar',
      unitOfMeasure: 'CA',
      bands: [
        [0, 500, 1.7],
        [500, 1_000, 1.6],
        [1_000, 2_000, 1.5],
        [2_000, 5_000, 1.3],
        [5_000, 10_000, 1.1],
        [10_000, 20_000, 1],
        [20_000, 50_000, 0.9],
        [50_000, 100_000, 0.8],
        [100_000, 200_000, 0.7],
        [200_000, 500_000, 0.6],
        [500_000, 1_100_000, 0.5],
        [1_100_000, null, 0.4],
      ],
    },
    {
      key: 'calendar_ca',
      name: 'Calendar Only',
      unitOfMeasure: 'CA',
      bands: [
        [0, 500, 1.3],
        [500, 1_000, 1.2],
        [1_000, 2_000, 1],
        [2_000, 5_000, 0.8],
        [5_000, 10_000, 0.7],
        [10_000, 20_000, 0.6],
        [20_000, 50_000, 0.5],
        [50_000, 100_000, 0.4],
        [100_000, 200_000, 0.3],
        [200_000, 500_000, 0.2],
        [500_000, 1_100_000, 0.1],
        [1_100_000, null, 0.05],
      ],
    },
    {
      key: 'notetaker_bot_hours',
      name: 'Notetaker',
      unitOfMeasure: 'bot-hour',
      bands: [
        [0, 1_000, 0.6],
        [1_000, 2_000, 0.5],
        [2_000, 5_000, 0.4],
        [5_000, 10_000, 0.35],
        [10_000, null, 0.3],
      ],
    },
    {
      key: 'agent_accounts',
      name: 'Agent Accounts',
      unitOfMeasure: 'account',
      bands: [[0, null, 0.2]],
    },
    {
      key: 'agent_email_thousands',
      name: 'Agent Email',
      unitOfMeasure: '1,000 emails',
      pricingModel: 'graduated_adjusted_bands',
      // Tier 2 is 0.70, not 0.75. Settled 2026-08-31 against the FY26 MRD, which states it twice
      // -- table 11 (Enterprise) and table 5 (Pro Annual) -- and states that Enterprise
      // deliberately holds at the Pro Annual rates for Agent Accounts. The OneSubscription
      // workbook says 0.75; on that reasoning the workbook is the typo. Holly confirmed.
      bands: [
        [0, 50, 1],
        [50, 100, 0.7],
        [100, 500, 0.35],
        [500, null, 0.25],
      ],
    },
    {
      key: 'agent_storage_gb',
      name: 'Agent Data Storage',
      unitOfMeasure: 'GB',
      bands: [[0, null, 0.2]],
    },
    {
      key: 'agent_bandwidth_gb',
      name: 'Agent Bandwidth',
      unitOfMeasure: 'GB',
      bands: [[0, null, 0.5]],
    },
  ],
  paymentRules: [
    {
      key: 'annual_in_advance',
      label: 'Annual In Advance',
      premium: 0,
      paymentsPerYear: 1,
      period: 'Year',
      hubspotValue: 'annual',
    },
    {
      key: 'semi_annual_in_advance',
      label: 'Semi-Annual In Advance',
      premium: 0.04,
      paymentsPerYear: 2,
      period: 'Half-Year',
      hubspotValue: 'semi_annual',
    },
    {
      key: 'quarterly_in_advance',
      label: 'Quarterly In Advance',
      premium: 0.06,
      paymentsPerYear: 4,
      period: 'Quarter',
      hubspotValue: 'quarterly',
    },
    {
      key: 'monthly_in_advance',
      label: 'Monthly In Advance',
      premium: 0.08,
      paymentsPerYear: 12,
      period: 'Month',
      hubspotValue: 'monthly',
    },
  ],
  termRules,
  supportRules: [
    {
      key: 'basic',
      level: 'Basic Support',
      percentOfPlatformArr: 0,
      annualCap: 0,
    },
    {
      key: 'full',
      level: 'Full Support',
      percentOfPlatformArr: 0.1,
      annualCap: 10_000,
    },
    {
      key: 'premium',
      level: 'Premium Support',
      percentOfPlatformArr: 0.2,
      annualCap: 20_000,
    },
  ],
  // Corrected 2026-08-27, and this time corroborated by three independent sources that all agree:
  //   1. the updated pricing workbook, RATE CARD "ONBOARDING PACKAGES" -- 5,000 / 10,000 / 15,000
  //   2. the HubSpot product library export of the same day -- the same three figures
  //   3. Holly's explicit instruction
  // The old $0 / $5,000 / $10,000 ladder was one step low on every package, so every quote that
  // included onboarding under-charged by $5,000 while the line item billed the product's real
  // price -- the Deal's ARR and TCV disagreeing with the customer's own invoice.
  //
  // This was fixed once earlier in the day and then lost: it shared a commit with the Agent Email
  // tier change, so rolling that back took this with it even though the two are unrelated.
  onboardingRules: [
    { key: 'none', package: 'None', oneTimeAmount: 0 },
    { key: 'quick_launch', package: 'Quick Launch', oneTimeAmount: 5_000 },
    { key: 'quick_launch_plus', package: 'Quick Launch +', oneTimeAmount: 10_000 },
    { key: 'strategic', package: 'Strategic Onboarding', oneTimeAmount: 15_000 },
  ],
  professionalServicesRules: [
    { itemCount: 0, oneTimeAmount: 0 },
    { itemCount: 1, oneTimeAmount: 2_000 },
    { itemCount: 2, oneTimeAmount: 3_800 },
    { itemCount: 3, oneTimeAmount: 5_500 },
    { itemCount: 4, oneTimeAmount: 7_200 },
    { itemCount: 5, oneTimeAmount: 8_800 },
    // NO SIX-ITEM ROW YET, and that is why the sixth professional service is not offered.
    //
    // The MRD's bundle table lists the six-item price as TBD. Two things block adding it:
    // the price itself, and the fact that `professionalServicesAmounts` is a STORED settings
    // array whose length is validated at exactly 6 (indices 0..5) -- a seventh entry changes a
    // stored shape, which REQUIREMENTS section 9 says never to do in place. Both are one small
    // deliberate change once the number exists.
  ],
  professionalServiceOptions: [
    { key: 'google_verification_review', label: 'Google Verification Review' },
    { key: 'architecture_workflow_review', label: 'Architecture Design & Workflow Review' },
    { key: 'gtm_review', label: 'Go-to-Market Review' },
    { key: 'provider_oauth_app_creation', label: 'Provider OAuth App Creation' },
    {
      key: 'notification_webhook_best_practices',
      label: 'Notification & Webhook Best Practices',
    },
    // The FY26 MRD lists a sixth plan, Ad-hoc Expert Consultation. Its HubSpot product exists
    // (47446779731, $2,000) and lineItemModel's CATALOG can already bill it, but it is NOT
    // offered here until the six-item bundle price exists -- see professionalServicesRules.
  ],
  addOnRules: [
    {
      // What an Enterprise deal actually buys. The FY26 MRD is explicit: the Accelerator Package
      // is PRO ANNUAL ONLY, and on Enterprise the Hosted Auth Branding and custom domains it
      // bundles are already included in the contract -- the single paid Enterprise add-on is the
      // Shared OAuth App. Same 2,400 a year, correct SKU on the customer's quote.
      key: 'shared_oauth_app',
      label: 'Shared OAuth App',
      annualAmount: 2_400,
    },
    {
      // DEPRECATED 2026-08-31, superseded by shared_oauth_app. Kept because it is a STORED key --
      // it appears in saved quote configurations and in the addOnAnnualAmounts settings record,
      // and removing it would invalidate both. Not offered in the card any more; still prices.
      key: 'enterprise_accelerator',
      label: 'Enterprise Accelerator Package (legacy)',
      annualAmount: 2_400,
      deprecated: true,
    },
    {
      key: 'privacy_filter',
      label: 'Privacy Filter Mode',
      // 5,000, not 6,000. The FY26 MRD (add-ons table) and the HubSpot product PRIVACY
      // (46060960674) both say 5,000; the code was the only source saying 6,000, and every quote
      // carrying this add-on over-charged by 1,000 a year. Holly confirmed 2026-08-31.
      annualAmount: 5_000,
    },
    {
      key: 'verified_oauth',
      label: 'Turnkey Verified OAuth Projects',
      annualAmount: 5_000,
      // requiresProfessionalServices removed 2026-08-28, Holly: this add-on no longer depends on a
      // professional-services item, and a quote without one is no longer blocked. The enforcement
      // in calculator.js went with it. Recoverable from git if the dependency ever comes back.
    },
  ],
});
