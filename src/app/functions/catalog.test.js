const assert = require('node:assert/strict');
const test = require('node:test');

const { buildCatalog, emptyProductMap, RETIRED_ADD_ONS, _test } = require('./catalog');
const pricingRules = require('./pricingRules');

// ===========================================================================
// PHASE 1 PARITY -- the "before" snapshot
// ===========================================================================
//
// Every literal below was copied out of NylasPricingBuilder.tsx as it stood at 59c6e85, BEFORE the
// card was rewired to render from the catalogue. This file is the proof that Phase 1 changes
// nothing a rep sees: if the catalogue and these values ever disagree, the card's wording moved and
// somebody has to have meant it.
//
// This is a data snapshot, not a source-text assertion. It compares the built catalogue's VALUES,
// so it survives reformatting and catches an actual change of meaning.

test('products: keys, labels, descriptions, units and order all match the card', () => {
  assert.deepEqual(buildCatalog().products, [
    { key: 'connect_ca', label: 'Email + Calendar', description: 'Connected accounts', unit: 'CA/month', role: 'metered', sort: 10, billingUnit: 'per month', listPrice: null, deprecated: false },
    { key: 'calendar_ca', label: 'Calendar Only', description: 'Calendar-only accounts', unit: 'calendars/month', role: 'metered', sort: 20, billingUnit: 'per month', listPrice: null, deprecated: false },
    { key: 'notetaker_bot_hours', label: 'Notetaker', description: 'Bot hours', unit: 'bot hours/month', role: 'metered', sort: 30, billingUnit: 'per month', listPrice: null, deprecated: false },
    { key: 'agent_accounts', label: 'Agent Accounts', description: 'Agent accounts', unit: 'accounts/month', role: 'metered', sort: 40, billingUnit: 'per month', listPrice: null, deprecated: false },
    { key: 'agent_email_thousands', label: 'Agent Email', description: 'Emails in thousands', unit: '1,000 emails', role: 'metered', sort: 50, billingUnit: 'per month', listPrice: null, deprecated: false },
    { key: 'agent_storage_gb', label: 'Agent Data Storage', description: 'Storage', unit: 'GB/month', role: 'metered', sort: 60, billingUnit: 'per month', listPrice: null, deprecated: false },
    { key: 'agent_bandwidth_gb', label: 'Agent Bandwidth', description: 'Bandwidth', unit: 'GB/month', role: 'metered', sort: 70, billingUnit: 'per month', listPrice: null, deprecated: false },
  ]);
});

test('services carry a billing unit and a list price, or say why they cannot', () => {
  const catalog = buildCatalog();

  // Onboarding and add-ons are flat amounts -- these are the two the table can edit directly.
  assert.deepEqual(
    catalog.onboarding.map(({ key, listPrice, billingUnit }) => [key, listPrice, billingUnit]),
    [
      ['none', 0, 'one-time'],
      ['quick_launch', 5000, 'one-time'],
      ['quick_launch_plus', 10000, 'one-time'],
      ['strategic', 15000, 'one-time'],
    ],
  );
  assert.deepEqual(
    catalog.addOns
      .filter(({ deprecated }) => !deprecated)
      .map(({ key, listPrice, billingUnit }) => [key, listPrice, billingUnit]),
    [
      ['shared_oauth_app', 2400, 'per year'],
      ['privacy_filter', 5000, 'per year'],
      ['verified_oauth', 5000, 'per year'],
    ],
  );

  // SUPPORT HAS NO LIST PRICE. It is a percentage of proposed platform ARR, capped -- so the
  // figure depends on the deal. null, not 0: 0 would render as a real price of nothing.
  for (const row of catalog.support) {
    assert.equal(row.listPrice, null, `${row.key} must not claim a fixed price`);
    assert.equal(row.billingUnit, 'per year');
  }
  assert.deepEqual(
    catalog.support.map(({ key, percentOfPlatformArr, annualCap }) => [key, percentOfPlatformArr, annualCap]),
    [['basic', 0, 0], ['full', 0.1, 10000], ['premium', 0.2, 20000]],
  );

  // PROFESSIONAL SERVICES ARE PRICED BY COUNT, so no service carries a price either.
  for (const row of catalog.professionalServices) {
    assert.equal(row.listPrice, null, `${row.key} must not claim a per-service price`);
    assert.equal(row.billingUnit, 'one-time');
  }
  // The ladder is what prices them, and the break at 2 is real: 3,800, not 4,000.
  assert.deepEqual(
    catalog.professionalServicesLadder.map(({ itemCount, listPrice }) => [itemCount, listPrice]),
    [[0, 0], [1, 2000], [2, 3800], [3, 5500], [4, 7200], [5, 8800]],
  );
  assert.notEqual(catalog.professionalServicesLadder[2].listPrice, 4000, 'the volume break is not a rounding artefact');

  // Metered products are band-priced, so no single list price there either.
  for (const row of catalog.products) {
    assert.equal(row.listPrice, null);
    assert.equal(row.billingUnit, 'per month');
  }
});

test('prices come from the ACTIVE rules, so a Settings override shows on the card', () => {
  // Passing the frozen rate card here would show a price the calculator does not charge.
  const overridden = buildCatalog({
    onboardingAmounts: { quick_launch: 7777 },
    addOnAnnualAmounts: { privacy_filter: 1234 },
    support: { full: { percent: 0.15, cap: 12345 } },
    professionalServicesAmounts: { 2: 4444 },
  });
  assert.equal(overridden.onboarding.find(({ key }) => key === 'quick_launch').listPrice, 7777);
  assert.equal(overridden.addOns.find(({ key }) => key === 'privacy_filter').listPrice, 1234);
  const full = overridden.support.find(({ key }) => key === 'full');
  assert.equal(full.percentOfPlatformArr, 0.15);
  assert.equal(full.annualCap, 12345);
  assert.equal(overridden.professionalServicesLadder[2].listPrice, 4444);
  // And the default build is unaffected -- no shared mutable state between calls.
  assert.equal(buildCatalog().onboarding.find(({ key }) => key === 'quick_launch').listPrice, 5000);
});

test('support labels are the card\'s short forms, not the rate card\'s', () => {
  // The rate card says "Basic Support"; the card shows "Basic". The card wins in Phase 1.
  assert.deepEqual(
    buildCatalog().support.map(({ key, label }) => [key, label]),
    [['basic', 'Basic'], ['full', 'Full'], ['premium', 'Premium']],
  );
  assert.equal(pricingRules.supportRules[0].level, 'Basic Support', 'the rate card still differs, deliberately');
});

test('onboarding: "Quick Launch Plus", not the rate card\'s "Quick Launch +"', () => {
  assert.deepEqual(
    buildCatalog().onboarding.map(({ key, label }) => [key, label]),
    [
      ['none', 'None'],
      ['quick_launch', 'Quick Launch'],
      ['quick_launch_plus', 'Quick Launch Plus'],
      ['strategic', 'Strategic Onboarding'],
    ],
  );
});

test('add-ons keep the "(requires Professional Services)" rule in the label', () => {
  const addOns = buildCatalog().addOns;
  const verified = addOns.find(({ key }) => key === 'verified_oauth');
  // Not decoration: selecting it without a PS item blocks Lock in. Dropping the suffix would move
  // that discovery to a red banner after the rep has built the quote.
  assert.equal(verified.label, 'Turnkey Verified OAuth Projects (requires Professional Services)');
});

test('the retired add-on is reported as deprecated, never omitted', () => {
  const accelerator = buildCatalog().addOns.find(({ key }) => key === 'enterprise_accelerator');
  // MultiSelect is given `value` and `options` together, so a stored value with no matching option
  // STOPS THE CARD RENDERING -- "refresh stopped working" with an empty function log. The catalogue
  // must therefore always carry the key and let the card decide whether to offer it.
  assert.ok(accelerator, 'a key that has ever been quoted must keep resolving');
  assert.equal(accelerator.deprecated, true);
  assert.ok(RETIRED_ADD_ONS.includes('enterprise_accelerator'));
});

test('professional services, terms and payment cadences match the card', () => {
  const catalog = buildCatalog();
  assert.deepEqual(catalog.professionalServices.map(({ key }) => key), [
    'google_verification_review',
    'architecture_workflow_review',
    'gtm_review',
    'provider_oauth_app_creation',
    'notification_webhook_best_practices',
  ]);
  assert.deepEqual(catalog.terms, [
    { key: 12, label: '12 months' },
    { key: 24, label: '24 months' },
    { key: 36, label: '36 months' },
  ]);
  // Lowercase "in" -- the card's form, not the rate card's "Annual In Advance".
  assert.deepEqual(catalog.payments.map(({ label }) => label), [
    'Annual in Advance',
    'Semi-Annual in Advance',
    'Quarterly in Advance',
    'Monthly in Advance',
  ]);
});

// ===========================================================================
// The drift guard -- the reason this module exists
// ===========================================================================

test('the catalogue offers exactly what the calculator can price', () => {
  const catalogKeys = buildCatalog().products.map(({ key }) => key).sort();
  const ruleKeys = pricingRules.products.map(({ key }) => key).sort();
  // Not "contains" -- EQUAL. A catalogue entry the calculator cannot price is the $0.00 line the
  // smoke test found; a rate-card product missing from the catalogue is a key absent from
  // `volumes`, which throws UNSUPPORTED_FIELD on the rep's next submit.
  assert.deepEqual(catalogKeys, ruleKeys);
});

test('a product with no presentation entry is refused, in both directions', () => {
  const { presentationMismatch } = _test;
  assert.equal(presentationMismatch(['a', 'b'], ['a', 'b']), '');
  assert.match(presentationMismatch(['a', 'b'], ['a']), /missing b/);
  assert.match(presentationMismatch(['a'], ['a', 'b']), /extra b/);
  assert.match(presentationMismatch(['a', 'c'], ['a', 'b']), /missing c.*extra b/);
  // And the live pair agrees, which is what stops a real deploy shipping a blank unit.
  assert.doesNotThrow(() => _test.assertPresentationCoverage());
});

test('the zero-filled maps are derived, not restated', () => {
  const map = emptyProductMap();
  assert.deepEqual(Object.keys(map).sort(), pricingRules.products.map(({ key }) => key).sort());
  assert.ok(Object.values(map).every((value) => value === 0));
  // The card used to hand-write these twice (emptyVolumes and emptyProductDiscounts). A product
  // added to the rate card and forgotten in one of them is UNSUPPORTED_FIELD on submit.
  assert.equal(Object.keys(map).length, pricingRules.products.length);
});
