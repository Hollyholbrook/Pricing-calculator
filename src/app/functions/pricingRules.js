module.exports = Object.freeze({
  schemaVersion: '1.0',
  priceListVersion: 'FY26 v1',
  calculationMethod: 'excel_compatible',
  currency: 'USD',
  effectiveDate: '2026-07-01',
  allowedTerms: [12, 24, 36],
  maximumVolume: 1_000_000_000,
  minimumCommittedArr: 25_000,
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
      bands: [
        [0, 50, 1],
        [50, 100, 0.75],
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
  termRules: [
    { months: 12, discount: 0 },
    { months: 24, discount: 0.025 },
    { months: 36, discount: 0.05 },
  ],
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
  onboardingRules: [
    { key: 'none', package: 'None', oneTimeAmount: 0 },
    { key: 'quick_launch', package: 'Quick Launch', oneTimeAmount: 0 },
    { key: 'quick_launch_plus', package: 'Quick Launch +', oneTimeAmount: 5_000 },
    { key: 'strategic', package: 'Strategic Onboarding', oneTimeAmount: 10_000 },
  ],
  professionalServicesRules: [
    { itemCount: 0, oneTimeAmount: 0 },
    { itemCount: 1, oneTimeAmount: 2_000 },
    { itemCount: 2, oneTimeAmount: 3_800 },
    { itemCount: 3, oneTimeAmount: 5_500 },
    { itemCount: 4, oneTimeAmount: 7_200 },
    { itemCount: 5, oneTimeAmount: 8_800 },
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
  ],
  addOnRules: [
    {
      key: 'enterprise_accelerator',
      label: 'Enterprise Accelerator Package',
      annualAmount: 2_400,
    },
    {
      key: 'privacy_filter',
      label: 'Privacy Filter Mode',
      annualAmount: 6_000,
    },
    {
      key: 'verified_oauth',
      label: 'Turnkey Verified OAuth Projects',
      annualAmount: 5_000,
      requiresProfessionalServices: true,
    },
  ],
});
