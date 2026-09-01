const pricingRules = require('./pricingRules');

// Administrative catalog and HubSpot mapping defaults. Stable keys remain code-owned because
// calculations, saved quote inputs, and line-item builders use them as identifiers. Everything
// customer-facing or portal-specific around those keys can be overridden in stored settings.
const DEFAULT_PRODUCT_PRESENTATION = Object.freeze({
  connect_ca: Object.freeze({
    enabled: true,
    order: 10,
    section: 'Connect',
    name: 'Email + Calendar',
    description: 'Connected accounts',
    inputUnit: 'CA/month',
    productId: '45820463620',
  }),
  calendar_ca: Object.freeze({
    enabled: true,
    order: 20,
    section: 'Connect',
    name: 'Calendar Only',
    description: 'Calendar-only accounts',
    inputUnit: 'calendars/month',
    productId: '45887560099',
  }),
  notetaker_bot_hours: Object.freeze({
    enabled: true,
    order: 30,
    section: 'Notetaker',
    name: 'Notetaker',
    description: 'Bot hours',
    inputUnit: 'bot hours/month',
    productId: '45816248707',
  }),
  agent_accounts: Object.freeze({
    enabled: true,
    order: 40,
    section: 'Agent Accounts',
    name: 'Agent Accounts',
    description: 'Agent accounts',
    inputUnit: 'accounts/month',
    productId: '45816248710',
  }),
  agent_storage_gb: Object.freeze({
    enabled: true,
    order: 50,
    section: 'Agent Accounts',
    name: 'Agent Data Storage',
    description: 'Storage',
    inputUnit: 'GB/month',
    productId: '45820463625',
  }),
  agent_bandwidth_gb: Object.freeze({
    enabled: true,
    order: 60,
    section: 'Agent Accounts',
    name: 'Agent Bandwidth',
    description: 'Bandwidth',
    inputUnit: 'GB/month',
    productId: '45820401689',
  }),
  agent_email_thousands: Object.freeze({
    enabled: true,
    order: 70,
    section: 'Agent Accounts',
    name: 'Agent Email',
    description: 'Emails in thousands',
    inputUnit: '1,000 emails',
    productId: '45867076721',
  }),
});

const option = (enabled, order, name, description, productId) =>
  Object.freeze({ enabled, order, name, description, productId });

const DEFAULT_OPTION_PRESENTATION = Object.freeze({
  support: Object.freeze({
    basic: option(true, 10, 'Basic', 'Included support', '40270989858'),
    full: option(true, 20, 'Full', 'Full support', '41648477792'),
    premium: option(true, 30, 'Premium', 'Premium support', '41732581464'),
  }),
  onboarding: Object.freeze({
    none: option(true, 0, 'None', 'No onboarding package', ''),
    quick_launch: option(true, 10, 'Quick Launch', 'QuickLaunch onboarding', '42724377715'),
    quick_launch_plus: option(true, 20, 'Quick Launch Plus', 'QuickLaunch+ onboarding', '42724501576'),
    strategic: option(true, 30, 'Strategic Onboarding', 'Strategic onboarding', '42724439648'),
  }),
  addOns: Object.freeze({
    shared_oauth_app: option(true, 10, 'Shared OAuth App', 'Shared Google OAuth application', '34548719650'),
    privacy_filter: option(true, 20, 'Privacy Filter Mode', 'Privacy Filter Mode', '46060960674'),
    verified_oauth: option(true, 30, 'Turnkey Verified OAuth Projects', 'Verified OAuth project services', '46047848295'),
    enterprise_accelerator: option(false, 90, 'Enterprise Accelerator Package', 'Retired; retained for saved quotes', '46102266003'),
  }),
  professionalServices: Object.freeze({
    google_verification_review: option(true, 10, 'Google Verification Review', 'Google verification review', '42870472964'),
    architecture_workflow_review: option(true, 20, 'Architecture Design & Workflow Review', 'Architecture and workflow review', '42870349120'),
    gtm_review: option(true, 30, 'Go-to-Market Review', 'Go-to-market review', '42870410889'),
    provider_oauth_app_creation: option(true, 40, 'Provider OAuth App Creation', 'Provider OAuth application creation', '42870596743'),
    notification_webhook_best_practices: option(true, 50, 'Notification & Webhook Best Practices', 'Notification and webhook best practices', '42870410890'),
  }),
});

const DEFAULT_HUBSPOT_MAPPINGS = Object.freeze({
  products: Object.freeze({
    enterprise: '46037350773',
  }),
  dealProperties: Object.freeze({
    optionsPayload: 'pricing_quote_options_payload',
    selectedOptionId: 'pricing_selected_option_id',
    selectedOptionName: 'pricing_selected_option_name',
    paymentMethod: 'payment_method',
    paymentFrequency: 'payment_frequency',
    autoRenewal: 'auto_renewal__c',
    contractTermMonths: 'contract_term__months_',
  }),
  lineItemProperties: Object.freeze({
    committedQuantity: 'committed_quantity',
    proposedRate: 'proposed_rate',
    oneTimeFees: 'one_time_fees',
    recurringFees: 'recurring_fees',
    totalFeesForTerm: 'total_fees_for_term',
  }),
});

const clone = (value) => JSON.parse(JSON.stringify(value));

const defaultCatalogConfiguration = () => ({
  products: clone(DEFAULT_PRODUCT_PRESENTATION),
  options: clone(DEFAULT_OPTION_PRESENTATION),
  contractTerms: Object.fromEntries(
    pricingRules.termRules.map(({ months }) => [
      String(months),
      { enabled: true, order: months, label: `${months} months` },
    ]),
  ),
  paymentOptions: Object.fromEntries(
    pricingRules.paymentRules.map(({ key, label }, index) => [
      key,
      { enabled: true, order: (index + 1) * 10, label },
    ]),
  ),
  hubspotMappings: clone(DEFAULT_HUBSPOT_MAPPINGS),
});

module.exports = {
  defaultCatalogConfiguration,
};
