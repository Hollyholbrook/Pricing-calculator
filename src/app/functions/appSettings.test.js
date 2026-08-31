const assert = require('node:assert/strict');
const test = require('node:test');

const {
  defaultSettings,
  isDealAllowed,
  normalizeSettings,
  quoteKindsForCategory,
  quoteTemplateSettings,
} = require('./appSettings');

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

// Which quote templates the card offers, and which it preselects -- per QUOTE KIND, under their
// own key, with flat legacy mirrors beside them.
const byKind = (map) => ({
  new_business: { enabledIds: [], defaultId: '' },
  change: { enabledIds: [], defaultId: '' },
  renewal: { enabledIds: [], defaultId: '' },
  ...map,
});

test('quote template settings default to today behaviour, for every kind', () => {
  const settings = defaultSettings();
  // Empty means "every usable template" -- an unconfigured portal must be unchanged, not shown an
  // empty picker. That has to hold for each kind separately, or adding the change and renewal
  // kinds would have emptied the picker on a portal that never configured them.
  for (const kind of ['new_business', 'change', 'renewal']) {
    assert.deepEqual(quoteTemplateSettings(settings, kind), { enabledIds: [], defaultId: '' });
  }
  // And the legacy mirrors are the flat shape older code expects, not objects.
  assert.deepEqual(settings.enabledQuoteTemplateIds, []);
  assert.equal(settings.defaultQuoteTemplateId, '');
});

test('quote template ids are validated per kind, and blank stays meaningful', () => {
  const base = defaultSettings();
  const saved = normalizeSettings({
    ...base,
    quoteTemplatesByKind: byKind({ renewal: { enabledIds: ['123', '456'], defaultId: '123' } }),
  });
  assert.deepEqual(quoteTemplateSettings(saved, 'renewal'), {
    enabledIds: ['123', '456'],
    defaultId: '123',
  });
  // A kind that was not configured stays empty rather than inheriting another kind's choice.
  assert.deepEqual(quoteTemplateSettings(saved, 'new_business').enabledIds, []);
  assert.equal(quoteTemplateSettings(saved, 'change').defaultId, '');
  // Junk is not accepted, and the error names the kind that carried it.
  assert.throws(
    () =>
      normalizeSettings({
        ...base,
        quoteTemplatesByKind: byKind({ change: { enabledIds: [], defaultId: 'not-an-id' } }),
      }),
    /INVALID_SETTINGS:quoteTemplatesByKind\.change\.defaultId/,
  );
});

// THE ROLLBACK GUARANTEE. The per-kind data lives under its own key so that code predating it
// still finds a plain array and a plain id in the old fields. Without this, a record saved by the
// new Settings screen made the OLD normalizeSettings throw INVALID_SETTINGS, which readSettings
// turns into SETTINGS_CONFIGURATION_REQUIRED -- taking the whole card down for anyone who rolled
// back after a save. Verified on 2026-08-30 by running the previous version against this output.
test('the legacy mirrors keep a rollback survivable', () => {
  const saved = normalizeSettings({
    ...defaultSettings(),
    quoteTemplatesByKind: byKind({
      new_business: { enabledIds: ['567553820432'], defaultId: '567553820432' },
      change: { enabledIds: ['583243623796'], defaultId: '583243623796' },
      renewal: { enabledIds: ['583243745379'], defaultId: '583243745379' },
    }),
  });
  // Flat, not nested -- this is the shape older code parses.
  assert.equal(Array.isArray(saved.enabledQuoteTemplateIds), true);
  assert.equal(typeof saved.defaultQuoteTemplateId, 'string');
  // Mirroring NEW BUSINESS, which is what one shared list meant before kinds existed.
  assert.deepEqual(saved.enabledQuoteTemplateIds, ['567553820432']);
  assert.equal(saved.defaultQuoteTemplateId, '567553820432');
  // Derived every save: they cannot drift, because they are never read or edited.
  assert.deepEqual(
    saved.enabledQuoteTemplateIds,
    saved.quoteTemplatesByKind.new_business.enabledIds,
  );
});

// The shape changed on 2026-08-30. A portal configured before that has no quoteTemplatesByKind key
// at all, and its settings must keep working without anyone touching the Settings screen.
test('a portal saved with the old flat template settings still works', () => {
  const legacy = { ...defaultSettings(), version: 9 };
  delete legacy.quoteTemplatesByKind;
  legacy.enabledQuoteTemplateIds = ['123', '456'];
  legacy.defaultQuoteTemplateId = '123';
  const migrated = normalizeSettings(legacy, 9);
  // The flat value means "every kind uses this" -- not "new business only", which would have
  // silently narrowed renewal Deals to templates chosen for new business.
  for (const kind of ['new_business', 'change', 'renewal']) {
    assert.deepEqual(quoteTemplateSettings(migrated, kind), {
      enabledIds: ['123', '456'],
      defaultId: '123',
    });
  }
});

// Precedence is decided on the WHOLE key, not entry by entry: an empty enabledIds under
// quoteTemplatesByKind is a real answer ("offer every usable template"), and must not silently
// inherit the legacy list instead.
test('a kind an admin deliberately cleared stays cleared', () => {
  const saved = normalizeSettings({
    ...defaultSettings(),
    quoteTemplatesByKind: byKind({
      new_business: { enabledIds: ['567553820432'], defaultId: '567553820432' },
    }),
    // Present, non-empty, and it must be ignored -- the canonical key wins outright.
    enabledQuoteTemplateIds: ['999999999999'],
    defaultQuoteTemplateId: '999999999999',
  });
  assert.deepEqual(quoteTemplateSettings(saved, 'change'), { enabledIds: [], defaultId: '' });
  assert.deepEqual(quoteTemplateSettings(saved, 'new_business').enabledIds, ['567553820432']);

  // Same rule where a kind is MISSING from the key rather than present-and-empty -- a record
  // written by a partial or hand-edited save. The key is still authoritative, so the absent kind
  // reads as empty ("offer every usable template") and does not fall back to the legacy mirror.
  // Falling back would resurrect a list the admin had moved away from, on a kind they never set.
  const partial = normalizeSettings({
    ...defaultSettings(),
    quoteTemplatesByKind: {
      new_business: { enabledIds: ['567553820432'], defaultId: '567553820432' },
    },
    enabledQuoteTemplateIds: ['999999999999'],
    defaultQuoteTemplateId: '999999999999',
  });
  assert.deepEqual(quoteTemplateSettings(partial, 'change'), { enabledIds: [], defaultId: '' });
  assert.deepEqual(quoteTemplateSettings(partial, 'renewal'), { enabledIds: [], defaultId: '' });
});

// The kinds are not the categories: the renewal CATEGORY prints two different documents.
test('a renewal deal chooses between two kinds; new business has one', () => {
  assert.deepEqual(quoteKindsForCategory('renewal'), ['change', 'renewal']);
  assert.deepEqual(quoteKindsForCategory('new_business'), ['new_business']);
  // 'unsupported' never reaches this -- isDealAllowed refuses those Deals -- but it must not
  // resolve to an empty list, which would leave the card with no picker at all.
  assert.deepEqual(quoteKindsForCategory('unsupported'), ['new_business']);
});

test('an unknown quote kind reads as new business rather than as "offer everything"', () => {
  const settings = normalizeSettings({
    ...defaultSettings(),
    quoteTemplatesByKind: byKind({
      new_business: { enabledIds: ['111'], defaultId: '111' },
      change: { enabledIds: ['222'], defaultId: '222' },
      renewal: { enabledIds: ['333'], defaultId: '333' },
    }),
  });
  assert.deepEqual(quoteTemplateSettings(settings, 'change'), {
    enabledIds: ['222'],
    defaultId: '222',
  });
  // An empty enabledIds means "every usable template", so an unrecognised kind must NOT fall
  // through to empty -- that would quietly widen the picker instead of narrowing it.
  assert.deepEqual(quoteTemplateSettings(settings, 'nonsense'), {
    enabledIds: ['111'],
    defaultId: '111',
  });
});
