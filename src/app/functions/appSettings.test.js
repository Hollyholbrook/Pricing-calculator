const assert = require('node:assert/strict');
const test = require('node:test');

const pricingRules = require('./pricingRules');
const { calculateQuote } = require('./calculator');
const {
  productRateDescriptors,
  defaultSettings,
  isDealAllowed,
  normalizeSettings,
  normalizeCatalogConfiguration,
  quoteKindsForCategory,
  quoteTemplateSettings,
} = require('./appSettings');

test('catalog configuration defaults preserve the current builder and HubSpot mappings', () => {
  const catalog = defaultSettings().catalogConfiguration;
  assert.deepEqual(
    new Set(Object.keys(catalog.products)),
    new Set(pricingRules.products.map(({ key }) => key)),
  );
  assert.ok(Object.values(catalog.products).every(({ enabled, productId }) => enabled && /^\d+$/.test(productId)));
  assert.equal(catalog.products.agent_email_thousands.order, 70);
  assert.equal(catalog.options.addOns.enterprise_accelerator.enabled, false);
  assert.equal(catalog.hubspotMappings.products.enterprise, '46037350773');
  assert.equal(
    catalog.hubspotMappings.lineItemProperties.proposedRate,
    'proposed_rate',
  );
});

test('legacy settings acquire catalog defaults without changing their pricing policy', () => {
  const legacy = defaultSettings();
  delete legacy.catalogConfiguration;
  legacy.schemaVersion = '1.0';
  const normalized = normalizeSettings(legacy);
  assert.equal(normalized.schemaVersion, '1.1');
  assert.equal(normalized.catalogConfiguration.products.connect_ca.enabled, true);
  assert.deepEqual(normalized.pricingPolicy, legacy.pricingPolicy);
});

test('catalog configuration validates keys and fails closed on unsafe mappings', () => {
  const catalog = defaultSettings().catalogConfiguration;
  catalog.hubspotMappings.lineItemProperties.proposedRate = 'bad-property!';
  assert.throws(
    () => normalizeCatalogConfiguration(catalog),
    /INVALID_SETTINGS:hubspotMappings\.lineItemProperties\.proposedRate/,
  );

  const noProducts = defaultSettings().catalogConfiguration;
  for (const product of Object.values(noProducts.products)) product.enabled = false;
  assert.throws(
    () => normalizeCatalogConfiguration(noProducts),
    /INVALID_SETTINGS:products\.enabled/,
  );
});

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
    [1, 0.7, 0.35, 0.25],
  );

  legacy.pricingPolicy.productBandRates.agent_email_thousands = [0.6];
  assert.deepEqual(
    normalizeSettings(legacy).pricingPolicy.productBandRates.agent_email_thousands,
    [0.6, 0.7, 0.35, 0.25],
  );
});

// NOTHING HARDCODES A RATE OR A PRODUCT OUTSIDE pricingRules AND THE SETTINGS. Holly, 2026-08-31.
//
// The Settings screen used to carry its own copy of the product structure -- seven keys, seven
// labels, every band boundary as a literal string. It matched, but nothing kept it matching: a
// band moved in pricingRules would have left the screen labelling the wrong boundary over the
// right input, which is worse than an obvious error because it looks fine.
test('the settings product rows are derived from the rate card', () => {
  const rows = productRateDescriptors();
  assert.deepEqual(
    rows.map(({ key }) => key),
    pricingRules.products.map(({ key }) => key),
    'one row per product, in rate-card order',
  );
  // A band label per band, always -- the screen puts one input under each label, so a count
  // mismatch means an input labelled with the wrong boundary.
  for (const [i, row] of rows.entries()) {
    assert.equal(
      row.bands.length,
      pricingRules.products[i].bands.length,
      `${row.key}: one label per band`,
    );
  }
  // The labels the screen showed before deriving them, so the change is invisible to the admin.
  const connect = rows.find(({ key }) => key === 'connect_ca');
  assert.deepEqual(connect.bands, [
    '0\u2013500',
    '500\u20131K',
    '1K\u20132K',
    '2K\u20135K',
    '5K\u201310K',
    '10K\u201320K',
    '20K\u201350K',
    '50K\u2013100K',
    '100K\u2013200K',
    '200K\u2013500K',
    '500K\u20131.1M',
    '1.1M+',
  ]);
  // An open-ended last band reads "N+", never "N-null".
  const storage = rows.find(({ key }) => key === 'agent_storage_gb');
  assert.deepEqual(storage.bands, ['0+']);
  for (const row of rows) {
    for (const label of row.bands) {
      assert.equal(/null|undefined|NaN/.test(label), false, `${row.key}: ${label}`);
    }
  }
  // Labels carry the product's own name and unit, not a second copy of them.
  assert.equal(connect.label, 'Email + Calendar \u2014 CA');
});

// THE RATE CARD IS pricingRules.js, AND NOTHING MAY QUIETLY DISAGREE WITH IT.
//
// This is the test that was missing on 2026-08-27. pricingRules said onboarding was 5/10/15K --
// confirmed by Holly, the workbook RATE CARD, QUOTE BUILDER row 38 and the HubSpot product export
// -- while defaultPricingPolicy still said 0/5/10K. buildActiveRules reads the POLICY first, so
// the stale copy won and every onboarding package was quoted $5,000 short for four days.
//
// The existing tests could not catch it: they pass `{}` as the pricing policy, which falls through
// to pricingRules and never reads this table at all.
test('every default pricing policy table equals the rate card', () => {
  const policy = defaultSettings().pricingPolicy;

  assert.deepEqual(
    policy.onboardingAmounts,
    Object.fromEntries(pricingRules.onboardingRules.map((r) => [r.key, r.oneTimeAmount])),
    'onboarding amounts must equal pricingRules -- this is the one that drifted',
  );
  assert.deepEqual(
    policy.termDiscounts,
    Object.fromEntries(pricingRules.termRules.map((r) => [String(r.months), r.discount])),
  );
  assert.deepEqual(
    policy.paymentPremiums,
    Object.fromEntries(pricingRules.paymentRules.map((r) => [r.key, r.premium])),
  );
  assert.deepEqual(
    policy.support,
    Object.fromEntries(
      pricingRules.supportRules.map((r) => [
        r.key,
        { percent: r.percentOfPlatformArr, cap: r.annualCap },
      ]),
    ),
  );
  assert.deepEqual(
    policy.professionalServicesAmounts,
    pricingRules.professionalServicesRules.map((r) => r.oneTimeAmount),
  );
  assert.deepEqual(
    policy.addOnAnnualAmounts,
    Object.fromEntries(pricingRules.addOnRules.map((r) => [r.key, r.annualAmount])),
  );
  assert.deepEqual(
    policy.productBandRates,
    Object.fromEntries(pricingRules.products.map((p) => [p.key, p.bands.map((b) => b[2])])),
  );

  // The SCALAR thresholds too, not just the tables. These were hardcoded twice over -- once here
  // and once as bare 0.1 / 0.3 fallbacks in calculator.js -- with nothing keeping the copies in
  // step. Asserting the tables alone left that whole class open.
  for (const key of [
    'minimumCommittedArr',
    'redliningMinimumArr',
    'creditCardMaximumInvoice',
    'salesDirectorDiscountMax',
    'headSalesDiscountMax',
  ]) {
    assert.equal(policy[key], pricingRules[key], `${key} must come from the rate card`);
    assert.notEqual(pricingRules[key], undefined, `${key} must exist on the rate card`);
  }
});

// calculator.js must not carry its own copy either. It falls back to the RULES when the policy
// omits a key; it used to fall back to bare literals, which is a second source of truth that
// nothing compares against the first.
test('the calculator falls back to the rate card, never to a literal', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'calculator.js'),
    'utf8',
  );
  const merge = source.slice(source.indexOf('const buildActiveRules'));
  const block = merge.slice(0, merge.indexOf('\n};'));
  for (const key of [
    'minimumCommittedArr',
    'redliningMinimumArr',
    'creditCardMaximumInvoice',
    'salesDirectorDiscountMax',
    'headSalesDiscountMax',
  ]) {
    const line = new RegExp(`${key}:[\\s\\S]{0,120}?pricingPolicy\\.${key} \\?\\? rules\\.${key}`);
    assert.match(block, line, `${key} must fall back to rules.${key}, not to a number`);
  }
});

// allowedTerms used to be a SECOND handwritten copy of termRules' months, and calculator.js
// carried a THIRD as the literal bounds 12/36 on its requireInteger call. Three copies of one
// fact: adding a 48-month term to the rate card would have been rejected by the bounds check
// before the allowedTerms check could accept it.
test('the term ladder is stated once and derived everywhere else', () => {
  assert.deepEqual(
    pricingRules.allowedTerms,
    pricingRules.termRules.map(({ months }) => months),
    'allowedTerms must be derived from termRules, not restated',
  );
  const rulesSource = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'pricingRules.js'),
    'utf8',
  );
  // deepEqual alone would still pass against a handwritten [12, 24, 36] that HAPPENS to agree
  // today. The point is that it cannot stop agreeing, so the source must not restate the numbers.
  assert.doesNotMatch(
    rulesSource,
    /allowedTerms:\s*\[/,
    'allowedTerms must be derived from termRules, not written out as a literal array',
  );
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'calculator.js'),
    'utf8',
  );
  assert.doesNotMatch(
    source,
    /requireInteger\(\s*input\.termMonths,\s*\d/,
    'termMonths bounds must come from the rate card, not from numbers typed into calculator.js',
  );
});

// Proven from the OUTSIDE: a term the rate card allows must actually price, and one it does not
// must be refused -- by the allowedTerms check, not by a stale numeric bound.
test('every term the rate card allows is priceable, and nothing else is', () => {
  const base = {
    paymentFrequency: 'annual_in_advance',
    volumes: { connect_ca: 5_000 },
    supportLevel: 'basic',
    onboardingPackage: 'none',
  };
  for (const termMonths of pricingRules.allowedTerms) {
    const quote = calculateQuote({ ...base, termMonths }, {});
    assert.ok(quote.committedArr > 0, `${termMonths} months must price`);
  }
  for (const termMonths of [6, 18, 48]) {
    assert.throws(
      () => calculateQuote({ ...base, termMonths }, {}),
      /UNSUPPORTED_TERM|INVALID_INTEGER|termMonths/,
      `${termMonths} months is not on the rate card and must be refused`,
    );
  }
});

// The same thing from the OUTSIDE, because equal tables are only worth having if they produce
// equal money. A quote priced with the default policy must cost exactly what the rate card alone
// would charge -- the settings layer is for overriding a rate deliberately, never by accident.
test('the default policy prices a quote identically to the rate card alone', () => {
  const base = {
    termMonths: 12,
    paymentFrequency: 'annual_in_advance',
    volumes: { connect_ca: 5_000, agent_email_thousands: 120 },
    supportLevel: 'full',
    professionalServices: ['gtm_review', 'provider_oauth_app_creation'],
    addOns: ['privacy_filter', 'verified_oauth'],
  };
  const policy = defaultSettings().pricingPolicy;
  for (const onboardingPackage of ['none', 'quick_launch', 'quick_launch_plus', 'strategic']) {
    const input = { ...base, onboardingPackage };
    const fromRateCard = calculateQuote(input, {});
    const fromPolicy = calculateQuote(input, policy);
    // oneTime is where the drift showed: Quick Launch quoted $0 instead of $5,000.
    assert.equal(
      fromPolicy.oneTime,
      fromRateCard.oneTime,
      `${onboardingPackage}: one-time fees must match the rate card`,
    );
    assert.equal(fromPolicy.tcv, fromRateCard.tcv, `${onboardingPackage}: TCV must match`);
    assert.equal(fromPolicy.committedArr, fromRateCard.committedArr, `${onboardingPackage}: ARR`);
  }
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
