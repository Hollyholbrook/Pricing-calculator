const crypto = require('node:crypto');

const CATALOG = Object.freeze({
  enterprise: { id: '47269087321', name: 'Enterprise OneSub', category: 'Platform' },
  connect_ca: { id: '45820463620', name: 'Connect', category: 'Platform' },
  calendar_ca: { id: '45887560099', name: 'Calendar Only - CAs', category: 'Calendar' },
  notetaker_bot_hours: { id: '45816248707', name: 'Notetaker', category: 'Notetaker' },
  agent_accounts: { id: '45816248710', name: 'Agent Accounts', category: 'Platform' },
  agent_email_thousands: { id: '45867076721', name: 'Email Send', category: 'Platform' },
  agent_storage_gb: { id: '45820463625', name: 'Storage', category: 'Platform' },
  agent_bandwidth_gb: { id: '45820401689', name: 'Bandwidth', category: 'Platform' },
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
  quick_launch_plus: {
    id: '42724377715',
    name: 'QuickLaunch Onboarding',
    category: 'Professional Services',
  },
  strategic: {
    id: '42724501576',
    name: 'QuickLaunch+ Onboarding',
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
    id: '42870410890',
    name: 'Notification & Webhook Best Practices',
    category: 'Professional Services',
  },
});

const PRESENTATIONS = Object.freeze(['itemized_products', 'subscription_summary']);

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

const defaultExpirationDate = () => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 30);
  return date.toISOString().slice(0, 10);
};

const normalizeQuoteContent = (raw = {}, fallbackTitle = 'Nylas Enterprise Quote') => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('INVALID_QUOTE_CONTENT');
  }
  const allowed = new Set([
    'title',
    'expirationDate',
    'presentation',
    'includeUncommittedRateSchedule',
    'includeRenewalTerms',
    'includeSpecialTerms',
  ]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) throw new Error('INVALID_QUOTE_CONTENT');
  }
  const title = typeof raw.title === 'string' ? raw.title.trim() : fallbackTitle;
  if (!title || title.length > 160) throw new Error('INVALID_QUOTE_CONTENT');
  const presentation = raw.presentation || 'itemized_products';
  if (!PRESENTATIONS.includes(presentation)) throw new Error('INVALID_QUOTE_CONTENT');

  return {
    title,
    expirationDate: normalizeDate(raw.expirationDate, defaultExpirationDate()),
    presentation,
    includeUncommittedRateSchedule: raw.includeUncommittedRateSchedule === true,
    includeRenewalTerms: raw.includeRenewalTerms !== false,
    includeSpecialTerms: raw.includeSpecialTerms !== false,
  };
};

const baseManagedProperties = ({ option, key, component, product, source }) => ({
  name: product.name,
  ...(product.id ? { hs_product_id: product.id } : {}),
  product_category: product.category,
  nylas_pricing_managed: 'true',
  nylas_line_item_key: key,
  nylas_pricing_component: component,
  nylas_quote_option_id: option.id,
  nylas_pricing_state_hash: option.result.stateHash,
  nylas_line_item_source: source,
});

const recurringProperties = ({ option, key, component, product, price, quantity, description, source }) => {
  const paymentsPerYear = option.result.paymentsPerYear;
  return {
    ...baseManagedProperties({ option, key, component, product, source }),
    quantity: String(quantity),
    price: String(round(price, 9)),
    description: String(description || '').slice(0, 5_000),
    recurringbillingfrequency: paymentFrequency(paymentsPerYear),
    hs_recurring_billing_period: `P${option.input.termMonths}M`,
    hs_recurring_billing_number_of_payments: String(
      (option.input.termMonths / 12) * paymentsPerYear,
    ),
    ...(option.input.startDate
      ? { hs_recurring_billing_start_date: option.input.startDate }
      : {}),
  };
};

const oneTimeProperties = ({ option, key, component, product, price, description, source }) => ({
  ...baseManagedProperties({ option, key, component, product, source }),
  quantity: '1',
  price: String(round(price)),
  description: String(description || '').slice(0, 5_000),
});

const formatBand = ({ lower, upper, rate }) =>
  `${lower.toLocaleString('en-US')}–${upper == null ? '+' : upper.toLocaleString('en-US')}: ` +
  `$${rate.toFixed(2)} per 1,000 emails`;

const productDescription = (line) => {
  const bandDetail = line.proposedBandRates?.length
    ? ` Graduated monthly rates: ${line.proposedBandRates.map(formatBand).join('; ')}.`
    : '';
  return (
    `${line.volume.toLocaleString('en-US')} ${line.unitOfMeasure} committed average per month at ` +
    `$${line.proposedUnitRate.toFixed(2)} blended per ${line.unitOfMeasure} per month.` +
    bandDetail +
    ' Usage draws down from the shared prepaid subscription pool at these rates.'
  );
};

const hubSpotGraduatedEmailPricing = (line) => {
  const bands = line.proposedBandRates?.length
    ? line.proposedBandRates
    : line.baseBandRates;
  if (!Array.isArray(bands) || bands.length === 0) {
    throw new Error('PRODUCT_RATE_CONFIGURATION_REQUIRED');
  }
  const ranges = bands.map(({ lower, upper }) => ({
    start: Math.round(Number(lower) * 1_000),
    ...(upper == null ? {} : { end: Math.round(Number(upper) * 1_000) - 1 }),
  }));
  const prices = bands.map(({ rate }, index) => ({
    index,
    price: round(Number(rate), 9),
  }));
  if (
    ranges.some(({ start, end }) => !Number.isSafeInteger(start) || (end != null && !Number.isSafeInteger(end))) ||
    prices.some(({ price }) => !Number.isFinite(price) || price < 0)
  ) {
    throw new Error('PRODUCT_RATE_CONFIGURATION_REQUIRED');
  }
  return {
    hs_pricing_model: 'graduated',
    hs_tier_ranges: JSON.stringify(ranges),
    hs_tier_prices: JSON.stringify(prices),
  };
};

const rateScheduleText = (option, includeUncommitted) =>
  option.result.lines
    .filter((line) => line.committed || includeUncommitted)
    .map(
      (line) =>
        `${line.productName}: $${line.availableUnitRate.toFixed(2)} per ${line.unitOfMeasure}/month` +
        (line.committed ? ` (${line.volume.toLocaleString('en-US')} committed/month)` : ' (uncommitted)'),
    )
    .join('\n');

const buildMeteredLines = (option, source) => {
  const items = option.result.lines
    .filter(({ committed }) => committed)
    .map((line) => {
      const product = CATALOG[line.productKey];
      if (!product) throw new Error('PRODUCT_MAPPING_REQUIRED');
      const monthsPerPayment = 12 / option.result.paymentsPerYear;
      return {
        key: `metered:${line.productKey}`,
        properties: {
          ...recurringProperties({
            option,
            key: `metered:${line.productKey}`,
            component: 'subscription_product',
            product,
            quantity: line.volume,
            price: line.billingUnitRate * monthsPerPayment,
            description: productDescription(line),
            source,
          }),
          monthly_unit_price: String(line.billingUnitRate),
        },
      };
    });
  const targetPerPeriod =
    option.result.recurringPerPeriod -
    option.result.supportAnnual / option.result.paymentsPerYear -
    option.result.annualAddOns / option.result.paymentsPerYear;
  const currentPerPeriod = items.reduce(
    (sum, item) => sum + Number(item.properties.price) * Number(item.properties.quantity),
    0,
  );
  const residual = targetPerPeriod - currentPerPeriod;
  const finalItem = items.at(-1);
  if (finalItem && Math.abs(residual) > 1e-9) {
    const quantity = Number(finalItem.properties.quantity);
    const adjustedPrice = round(Number(finalItem.properties.price) + residual / quantity, 9);
    finalItem.properties.price = String(adjustedPrice);
    finalItem.properties.monthly_unit_price = String(
      round(adjustedPrice / (12 / option.result.paymentsPerYear), 9),
    );
  }
  return items;
};

const buildSubscriptionSummaryLine = (option, source, includeUncommitted) => ({
  key: 'subscription:drawdown',
  properties: recurringProperties({
    option,
    key: 'subscription:drawdown',
    component: 'subscription_drawdown',
    product: CATALOG.enterprise,
    quantity: 1,
    price: option.result.proposedPlatformArr / option.result.paymentsPerYear,
    description:
      'Prepaid Nylas Enterprise subscription drawdown pool. Product rates:\n' +
      rateScheduleText(option, includeUncommitted),
    source,
  }),
});

const buildDealBundleLine = (option, dealBundleProduct = CATALOG.enterprise) => ({
  key: 'subscription:nylas_enterprise',
  properties: recurringProperties({
    option,
    key: 'subscription:nylas_enterprise',
    component: 'subscription_drawdown',
    product: dealBundleProduct,
    quantity: 1,
    price:
      option.result.recurringPerPeriod -
      option.result.supportAnnual / option.result.paymentsPerYear -
      option.result.annualAddOns / option.result.paymentsPerYear,
    description:
      `Bundled Nylas Enterprise subscription (bundle ${dealBundleProduct.bundleId || 'configured'}), including committed usage products. Support and recurring add-ons are itemized separately.\n` +
      `Product rate schedule:\n${rateScheduleText(option, true)}`,
    source: 'deal',
  }),
});

const buildDealUsageRateLines = (option) =>
  option.result.lines.map((line) => {
    const product = CATALOG[line.productKey];
    if (!product) throw new Error('PRODUCT_MAPPING_REQUIRED');
    const isGraduatedEmail = line.productKey === 'agent_email_thousands';
    return {
      key: `rate_schedule:${line.productKey}`,
      properties: {
        ...baseManagedProperties({
          option,
          key: `rate_schedule:${line.productKey}`,
          component: 'subscription_product',
          product,
          source: 'deal',
        }),
        quantity: '0',
        ...(isGraduatedEmail
          ? hubSpotGraduatedEmailPricing(line)
          : { price: String(round(line.availableUnitRate, 9)) }),
        monthly_unit_price: String(round(line.availableUnitRate, 9)),
        description: productDescription({
          ...line,
          volume: 0,
          proposedUnitRate: line.availableUnitRate,
        }),
        recurringbillingfrequency: 'monthly',
        hs_recurring_billing_period: `P${option.input.termMonths}M`,
        hs_recurring_billing_number_of_payments: String(option.input.termMonths),
        ...(option.input.startDate
          ? { hs_recurring_billing_start_date: option.input.startDate }
          : {}),
      },
    };
  });

const buildSupportLine = (option, source) => {
  if (option.result.supportAnnual <= 0) return [];
  const product = CATALOG[option.input.supportLevel];
  if (!product) throw new Error('PRODUCT_MAPPING_REQUIRED');
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
        description: `${product.name}, billed with the subscription.`,
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
        description: `${addOn.label}, billed with the subscription.`,
        source,
      }),
    };
  });

const buildOnboardingLines = (option, source) => {
  if (option.input.onboardingPackage === 'none' || option.result.onboardingAmount <= 0) return [];
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
        description: 'One-time onboarding fee.',
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
        description: `One-time professional service. Price reflects the ${selected.length}-item bundle.`,
        source,
      }),
    };
  });
};

const buildLineItems = (option, { source, presentation = 'itemized_products', includeUncommitted = false }) => {
  if (!option?.id || !option?.input || !option?.result?.stateHash) {
    throw new Error('OPTION_REQUIRED');
  }
  const subscriptionLines =
    presentation === 'subscription_summary'
      ? [buildSubscriptionSummaryLine(option, source, includeUncommitted)]
      : buildMeteredLines(option, source);
  return [
    ...subscriptionLines,
    ...buildSupportLine(option, source),
    ...buildAddOnLines(option, source),
    ...buildOnboardingLines(option, source),
    ...buildProfessionalServiceLines(option, source),
  ];
};

const buildDealLineItems = (option, dealBundleProduct) => [
  buildDealBundleLine(option, dealBundleProduct),
  ...buildDealUsageRateLines(option),
  ...buildSupportLine(option, 'deal'),
  ...buildAddOnLines(option, 'deal'),
  ...buildOnboardingLines(option, 'deal'),
  ...buildProfessionalServiceLines(option, 'deal'),
];

const buildQuoteLineItems = (option, content) =>
  buildLineItems(option, {
    source: 'quote',
    presentation: content.presentation,
    includeUncommitted: content.includeUncommittedRateSchedule,
  });

const buildQuoteText = (option, content) => {
  const comments = [
    'Subscription usage draws down from one prepaid pool across all products at the quoted rates. ' +
      'Unused funds carry forward during the term and expire at term end. Usage beyond the pool is ' +
      'billed monthly in arrears at the same quoted rates; there is no separate overage premium.',
  ];
  if (content.includeUncommittedRateSchedule) {
    comments.push(`Product rate schedule:\n${rateScheduleText(option, true)}`);
  }

  const terms = [];
  if (content.includeRenewalTerms) {
    terms.push(
      option.input.autoRenewal
        ? 'Automatically renews for 12 months unless notice is given at least 60 days before renewal.'
        : 'Does not automatically renew. Non-renewal notice must be provided at least 60 days before the subscription end date.',
    );
  }
  if (content.includeSpecialTerms && option.input.specialTerms) {
    terms.push(option.input.specialTerms);
  }
  return {
    comments: comments.join('\n\n').slice(0, 5_000),
    terms: terms.join('\n\n').slice(0, 5_000),
  };
};

const contentHash = (option, content) =>
  crypto
    .createHash('sha256')
    .update(JSON.stringify({ optionId: option.id, stateHash: option.result.stateHash, content }))
    .digest('hex');

module.exports = {
  CATALOG,
  buildDealLineItems,
  buildQuoteLineItems,
  buildQuoteText,
  contentHash,
  normalizeQuoteContent,
};
