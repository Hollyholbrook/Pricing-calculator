const assert = require('node:assert/strict');
const test = require('node:test');

const { defaultSettings, isDealAllowed, normalizeSettings } = require('./appSettings');

test('deal eligibility defaults to New Business only', () => {
  const settings = defaultSettings();
  assert.equal(settings.pricingPolicy.calculationMethod, 'excel_compatible');
  assert.equal(isDealAllowed(settings, '', 'default'), true);
  assert.equal(isDealAllowed(settings, 'newbusiness', 'default'), true);
  assert.equal(isDealAllowed(settings, 'renewal', 'renewals'), false);
});

test('invalid calculation methods fail closed', () => {
  const settings = defaultSettings();
  settings.pricingPolicy.calculationMethod = 'untrusted_method';
  assert.throws(
    () => normalizeSettings(settings),
    /INVALID_SETTINGS:calculationMethod/,
  );
});

test('Deal bundle product mapping is editable and validated', () => {
  const settings = defaultSettings();
  settings.dealBundleProduct = {
    bundleId: '67653718',
    name: 'Configured Enterprise Package',
    category: 'Platform',
  };
  assert.deepEqual(normalizeSettings(settings).dealBundleProduct, settings.dealBundleProduct);
  settings.dealBundleProduct.bundleId = 'not-a-bundle-id';
  assert.throws(
    () => normalizeSettings(settings),
    /INVALID_SETTINGS:dealBundleProduct.bundleId/,
  );
});

test('configured renewal pipeline enables Renewal deals', () => {
  const settings = {
    ...defaultSettings(),
    allowRenewals: true,
    renewalPipelineIds: ['renewals'],
  };
  assert.equal(isDealAllowed(settings, '', 'renewals'), true);
});

test('invalid approval thresholds fail closed', () => {
  const settings = defaultSettings();
  settings.pricingPolicy.salesDirectorDiscountMax = 0.4;
  settings.pricingPolicy.headSalesDiscountMax = 0.3;
  assert.throws(
    () => normalizeSettings(settings),
    /INVALID_SETTINGS:discountThresholds/,
  );
});

test('legacy Agent Email rates migrate while preserving custom settings', () => {
  const legacy = defaultSettings();
  legacy.pricingPolicy.productBandRates.agent_email_thousands = [0.5];
  assert.deepEqual(
    normalizeSettings(legacy).pricingPolicy.productBandRates.agent_email_thousands,
    [1, 0.75, 0.35, 0.25],
  );

  legacy.pricingPolicy.productBandRates.agent_email_thousands = [0.6];
  assert.deepEqual(
    normalizeSettings(legacy).pricingPolicy.productBandRates.agent_email_thousands,
    [0.6, 0.75, 0.35, 0.25],
  );
});
