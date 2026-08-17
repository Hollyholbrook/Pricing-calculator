const crypto = require('node:crypto');
const pricingRules = require('./pricingRules');

const CONFIGURATION_KEY = 'default';
const OBJECT_NAME = 'nylas_pricing_configuration';
const MAX_PIPELINES = 30;
const CALCULATION_METHODS = Object.freeze(['excel_compatible', 'rounded_unit_rate']);

const defaultPricingPolicy = () => ({
  calculationMethod: 'excel_compatible',
  minimumCommittedArr: 25_000,
  redliningMinimumArr: 50_000,
  salesDirectorDiscountMax: 0.1,
  headSalesDiscountMax: 0.3,
  termDiscounts: { '12': 0, '24': 0.025, '36': 0.05 },
  paymentPremiums: {
    annual_in_advance: 0,
    semi_annual_in_advance: 0.04,
    quarterly_in_advance: 0.06,
    monthly_in_advance: 0.08,
  },
  support: {
    basic: { percent: 0, cap: 0 },
    full: { percent: 0.1, cap: 10_000 },
    premium: { percent: 0.2, cap: 20_000 },
  },
  onboardingAmounts: {
    quick_launch: 0,
    quick_launch_plus: 5_000,
    strategic: 10_000,
  },
  professionalServicesAmounts: [0, 2_000, 3_800, 5_500, 7_200, 8_800],
  addOnAnnualAmounts: {
    enterprise_accelerator: 2_400,
    privacy_filter: 6_000,
    verified_oauth: 5_000,
  },
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
  pricingPolicy: defaultPricingPolicy(),
});

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
    redliningMinimumArr: requireNumber(
      value.redliningMinimumArr ?? defaults.redliningMinimumArr,
      0,
      1_000_000_000,
      'redliningMinimumArr',
    ),
    salesDirectorDiscountMax: requireNumber(
      value.salesDirectorDiscountMax ?? defaults.salesDirectorDiscountMax,
      0,
      1,
      'salesDirectorDiscountMax',
    ),
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
      (!Array.isArray(incomingRates) || incomingRates.length !== product.bands.length)
    ) {
      throw new Error(`INVALID_SETTINGS:productBandRates.${product.key}`);
    }
    policy.productBandRates[product.key] = defaultRates.map((rate, index) =>
      requireNumber(
        incomingRates?.[index] ?? rate,
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
  return {
    schemaVersion: '1.0',
    version: currentVersion,
    allowNewBusiness: value.allowNewBusiness,
    allowRenewals: value.allowRenewals,
    newBusinessPipelineIds: normalizePipelineIds(
      value.newBusinessPipelineIds || [],
      'newBusinessPipelineIds',
    ),
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
  accountIdFromContext,
  defaultPricingPolicy,
  defaultSettings,
  isDealAllowed,
  isSettingsAdmin,
  normalizeSettings,
  readDealPipelines,
  readSettings,
  saveSettings,
  userIdFromContext,
};
