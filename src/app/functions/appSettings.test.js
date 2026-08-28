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

// Which quote templates the card offers, and which it preselects.
test('quote template settings default to today behaviour', () => {
  const settings = defaultSettings();
  // Empty means "every usable template" -- an unconfigured portal must be unchanged, not shown an
  // empty picker.
  assert.deepEqual(settings.enabledQuoteTemplateIds, []);
  // Empty means "fall back to the QUOTE_TEMPLATE_ID secret", which is where the default lived.
  assert.equal(settings.defaultQuoteTemplateId, '');
});

test('quote template ids are validated, and blank stays meaningful', () => {
  const base = defaultSettings();
  const saved = normalizeSettings({
    ...base,
    enabledQuoteTemplateIds: ['123', '456'],
    defaultQuoteTemplateId: '123',
  });
  assert.deepEqual(saved.enabledQuoteTemplateIds, ['123', '456']);
  assert.equal(saved.defaultQuoteTemplateId, '123');
  // Blank is allowed: it is how the fallback is expressed.
  assert.equal(
    normalizeSettings({ ...base, defaultQuoteTemplateId: '' }).defaultQuoteTemplateId,
    '',
  );
  // Junk is not.
  assert.throws(
    () => normalizeSettings({ ...base, defaultQuoteTemplateId: 'not-an-id' }),
    /INVALID_SETTINGS:defaultQuoteTemplateId/,
  );
});
