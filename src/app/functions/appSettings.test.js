const assert = require('node:assert/strict');
const test = require('node:test');

const pricingRules = require('./pricingRules');
const { calculateQuote } = require('./calculator');
const {
  productRateDescriptors,
  defaultSettings,
  isDealAllowed,
  normalizeSettings,
  quoteTemplateSettings,
  quoteKindForTemplate,
  dealCategory,
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

// ONE TEMPLATE LIST. The per-kind split went with the change and renewal flows on 2026-09-01:
// HubSpot will not create either of those quotes through the public API, so the app prints one
// document and needs one list.
test('the flat template keys are authoritative', () => {
  const settings = normalizeSettings({
    ...defaultSettings(),
    enabledQuoteTemplateIds: ['567553820432', '583243745379'],
    defaultQuoteTemplateId: '567553820432',
  });
  assert.deepEqual(quoteTemplateSettings(settings).enabledIds, [
    '567553820432',
    '583243745379',
  ]);
  assert.equal(quoteTemplateSettings(settings).defaultId, '567553820432');
});

// THE MIGRATION, and it is a read-time fallback rather than a rewrite of every stored record.
// Every settings record in the portal today carries only quoteTemplatesByKind, so its new-business
// entry has to resolve on the FIRST read -- before anyone opens Settings and saves. Without this a
// live portal comes back with an empty list, which means "offer every template", which is a
// silently wider picker rather than a visible failure.
test('a record written before the kinds were removed still reads', () => {
  const legacy = normalizeSettings({
    ...defaultSettings(),
    enabledQuoteTemplateIds: [],
    defaultQuoteTemplateId: '',
    quoteTemplatesByKind: {
      new_business: { enabledIds: ['567553820432'], defaultId: '567553820432' },
      change: { enabledIds: ['583243623796'], defaultId: '583243623796' },
      renewal: { enabledIds: ['583243745379'], defaultId: '583243745379' },
    },
  });
  assert.deepEqual(legacy.enabledQuoteTemplateIds, ['567553820432']);
  assert.equal(legacy.defaultQuoteTemplateId, '567553820432');
  // The change and renewal lists are NOT merged in. They were the templates for documents this
  // app no longer prints; carrying them over would put a Change Quote Template back in the picker.
  assert.equal(legacy.enabledQuoteTemplateIds.includes('583243623796'), false);
  assert.equal(legacy.enabledQuoteTemplateIds.includes('583243745379'), false);
});

// ROLLBACK SAFETY, the inverse of what this key used to be for. Code that predates the removal
// reads quoteTemplatesByKind; if a save left it absent, that older normalizeSettings throws
// INVALID_SETTINGS, which readSettings turns into SETTINGS_CONFIGURATION_REQUIRED -- taking the
// whole card down, not just Settings, for anyone who rolls back.
test('quoteTemplatesByKind is still written, mirroring the one list', () => {
  const settings = normalizeSettings({
    ...defaultSettings(),
    enabledQuoteTemplateIds: ['567553820432'],
    defaultQuoteTemplateId: '567553820432',
  });
  for (const kind of ['new_business', 'change', 'renewal']) {
    assert.deepEqual(settings.quoteTemplatesByKind[kind], {
      enabledIds: ['567553820432'],
      defaultId: '567553820432',
    });
  }
});

// APPROVAL ROUTING SURVIVED THE REMOVAL. Holly, 2026-09-01, choosing to keep it: a renewal
// discount still routes to the renewal approver even though renewals no longer have their own
// templates or documents. dealCategory exists for this and nothing else now, so a change that
// deletes it as "unused" is deleting the approval matrix.
test('dealCategory still resolves the renewal pipeline, for approvals', () => {
  const settings = normalizeSettings({
    ...defaultSettings(),
    allowRenewals: true,
    newBusinessPipelineIds: ['db8895ce-da7b-4843-8d7b-4be80a0b7d7b'],
    renewalPipelineIds: ['876727403'],
  });
  assert.equal(dealCategory(settings, 'newbusiness', '876727403'), 'renewal');
  assert.equal(
    dealCategory(settings, '', 'db8895ce-da7b-4843-8d7b-4be80a0b7d7b'),
    'new_business',
  );
  assert.equal(isDealAllowed(settings, 'newbusiness', '876727403'), true);
});

// ALL THREE DOCUMENTS, KEPT AS THREE. Holly, 2026-09-02: "I want to make sure there's all three
// because I feel like the API will become available to do what we need to do. But for the time
// being I need to keep all of the data I can."
//
// Behaviourally change and renewal are identical today -- both are offered on a renewal-pipeline
// Deal, both produce an ordinary INITIAL quote. The lists are split so the app can still say WHICH
// document a quote was meant to be and record it on the Deal.
test('a renewal Deal sees all three lists and opens on the renewal default', () => {
  const NB = '567553820432';
  const RENEW = '583243745379';
  const CHANGE = '583243623796';
  const settings = normalizeSettings({
    ...defaultSettings(),
    allowRenewals: true,
    newBusinessPipelineIds: ['db8895ce-da7b-4843-8d7b-4be80a0b7d7b'],
    renewalPipelineIds: ['876727403'],
    enabledQuoteTemplateIds: [NB],
    defaultQuoteTemplateId: NB,
    renewalQuoteTemplateIds: [RENEW],
    changeQuoteTemplateIds: [CHANGE],
    renewalDefaultQuoteTemplateId: RENEW,
  });

  const renewal = quoteTemplateSettings(settings, 'renewal');
  assert.deepEqual(renewal.enabledIds, [NB, RENEW, CHANGE], 'all three, shared list first');
  assert.equal(renewal.defaultId, RENEW, 'and it opens on the renewal template');

  // DON'T TOUCH ANYTHING WITH NEW BUSINESS -- Holly, 2026-09-01. Still true.
  const newBusiness = quoteTemplateSettings(settings, 'new_business');
  assert.deepEqual(newBusiness.enabledIds, [NB]);
  assert.equal(newBusiness.defaultId, NB, 'the renewal default must not leak into new business');
});

test('the renewal default falls back to the shared default when unset', () => {
  const NB = '567553820432';
  const RENEW = '583243745379';
  const settings = normalizeSettings({
    ...defaultSettings(),
    allowRenewals: true,
    renewalPipelineIds: ['876727403'],
    enabledQuoteTemplateIds: [NB],
    defaultQuoteTemplateId: NB,
    renewalQuoteTemplateIds: [RENEW],
  });
  assert.equal(settings.renewalDefaultQuoteTemplateId, '');
  assert.equal(
    quoteTemplateSettings(settings, 'renewal').defaultId,
    NB,
    'a portal that never sets it behaves exactly as before the key existed',
  );
});

test('the quote kind is recoverable from the template, for recording', () => {
  const NB = '567553820432';
  const RENEW = '583243745379';
  const CHANGE = '583243623796';
  const settings = normalizeSettings({
    ...defaultSettings(),
    enabledQuoteTemplateIds: [NB],
    defaultQuoteTemplateId: NB,
    renewalQuoteTemplateIds: [RENEW],
    changeQuoteTemplateIds: [CHANGE],
  });
  assert.equal(quoteKindForTemplate(settings, CHANGE), 'change');
  assert.equal(quoteKindForTemplate(settings, RENEW), 'renewal');
  assert.equal(quoteKindForTemplate(settings, NB), 'new_business');
  assert.equal(quoteKindForTemplate(settings, '999'), null, 'unclaimed is null, not a guess');
  assert.equal(quoteKindForTemplate(settings, ''), null);

  // CHANGE AND RENEWAL WIN OVER new_business. A template in both lists -- which is how a renewal
  // Deal may send an ordinary new-business quote -- keeps the identity of the document it is.
  const shared = normalizeSettings({
    ...defaultSettings(),
    enabledQuoteTemplateIds: [CHANGE],
    changeQuoteTemplateIds: [CHANGE],
  });
  assert.equal(quoteKindForTemplate(shared, CHANGE), 'change');
});
