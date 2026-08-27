const assert = require('node:assert/strict');
const test = require('node:test');

const { inspectProductLibrary, _test } = require('./productLibrary');
const { CATALOG } = require('./lineItemModel');

// HubSpot states a tier's end INCLUSIVELY ("0 - 49,999"); pricingRules stores an EXCLUSIVE upper
// ([0, 50000]). Off by one here is invisible in a rate table and wrong on exactly one unit per
// tier, so it gets its own test.
test('HubSpot inclusive tier ends convert to exclusive upper bounds', () => {
  const bands = _test.bandsFromTiers(
    [{ start: 0, end: 49_999 }, { start: 50_000, end: 99_999 }, { start: 500_000 }],
    [
      { index: 0, price: 0 },
      { index: 1, price: 0.7 },
      { index: 2, price: 0.25 },
    ],
  );
  assert.deepEqual(bands, [
    [0, 50_000, 0],
    [50_000, 100_000, 0.7],
    // The final tier omits "end", which HubSpot documents as open-ended.
    [500_000, null, 0.25],
  ]);
});

test('tier prices are matched by index, not by array position', () => {
  // HubSpot documents `index` as a reference INTO hs_tier_ranges. A portal is free to return the
  // price entries in any order, and zipping the two arrays positionally would then misprice every
  // tier while looking perfectly reasonable.
  const bands = _test.bandsFromTiers(
    [{ start: 0, end: 9 }, { start: 10, end: 19 }, { start: 20 }],
    [
      { index: 2, price: 3 },
      { index: 0, price: 1 },
      { index: 1, price: 2 },
    ],
  );
  assert.deepEqual(bands.map(([, , rate]) => rate), [1, 2, 3]);
});

test('a range with no matching price entry is reported as null, not as free', () => {
  // HubSpot requires a price for every range. If one is missing, the honest answer is "unknown" --
  // defaulting to 0 would quietly claim the tier is free, which is the most expensive possible
  // wrong guess.
  const bands = _test.bandsFromTiers(
    [{ start: 0, end: 9 }, { start: 10 }],
    [{ index: 0, price: 5 }],
  );
  assert.deepEqual(bands, [
    [0, 10, 5],
    [10, null, null],
  ]);
});

test('multi-currency tier prices keep USD and ignore the rest', () => {
  const bands = _test.bandsFromTiers(
    [{ start: 0, end: 9 }, { start: 10 }],
    [
      { index: 0, price: 100, currency: 'GBP' },
      { index: 0, price: 130, currency: 'USD' },
      { index: 1, price: 80, currency: 'GBP' },
      { index: 1, price: 110, currency: 'USD' },
    ],
  );
  assert.deepEqual(bands.map(([, , rate]) => rate), [130, 110]);
});

// Emails are stored in thousands locally and in single emails in HubSpot. Without the scaling, a
// product that agrees perfectly would report a disagreement on every tier.
test('Agent Email boundaries are scaled from emails to thousands before comparing', () => {
  const scaled = _test.scaleBands(
    [
      [0, 50_000, 1],
      [50_000, 100_000, 0.75],
      [500_000, null, 0.25],
    ],
    'agent_email_thousands',
  );
  assert.deepEqual(scaled, [
    [0, 50, 1],
    [50, 100, 0.75],
    [500, null, 0.25],
  ]);
  // Every other product is counted in the same unit on both sides and must pass through untouched.
  assert.deepEqual(_test.scaleBands([[0, null, 0.2]], 'agent_accounts'), [[0, null, 0.2]]);
});

test('the real Agent Email product reports no disagreement when HubSpot matches the workbook', () => {
  const row = _test.compareProduct('agent_email_thousands', CATALOG.agent_email_thousands, {
    id: CATALOG.agent_email_thousands.id,
    properties: {
      name: CATALOG.agent_email_thousands.name,
      hs_pricing_model: 'graduated',
      hs_tier_ranges: JSON.stringify([
        { start: 0, end: 49_999 },
        { start: 50_000, end: 99_999 },
        { start: 100_000, end: 499_999 },
        { start: 500_000 },
      ]),
      hs_tier_prices: JSON.stringify([
        { index: 0, price: 1 },
        { index: 1, price: 0.75 },
        { index: 2, price: 0.35 },
        { index: 3, price: 0.25 },
      ]),
    },
  });
  assert.deepEqual(row.disagreements, [], JSON.stringify(row.disagreements, null, 2));
  assert.equal(row.tiersAvailable, true);
});

test('the exact drift found on 2026-08-27 is reported', () => {
  // This is what the HubSpot product actually said that morning: first tier free, second $0.70.
  const row = _test.compareProduct('agent_email_thousands', CATALOG.agent_email_thousands, {
    id: CATALOG.agent_email_thousands.id,
    properties: {
      name: CATALOG.agent_email_thousands.name,
      hs_pricing_model: 'graduated',
      hs_tier_ranges: JSON.stringify([
        { start: 0, end: 49_999 },
        { start: 50_000, end: 99_999 },
        { start: 100_000, end: 499_999 },
        { start: 500_000 },
      ]),
      hs_tier_prices: JSON.stringify([
        { index: 0, price: 0 },
        { index: 1, price: 0.7 },
        { index: 2, price: 0.35 },
        { index: 3, price: 0.25 },
      ]),
    },
  });
  const fields = row.disagreements.map(({ field }) => field);
  assert.deepEqual(fields, ['tier 1 rate', 'tier 2 rate']);
  assert.equal(row.disagreements[0].local, 1);
  assert.equal(row.disagreements[0].hubspot, 0);
  assert.equal(row.disagreements[1].local, 0.75);
  assert.equal(row.disagreements[1].hubspot, 0.7);
});

test('graduated versus volume is reported, because it is a 6x error not a rounding one', () => {
  const row = _test.compareProduct('agent_email_thousands', CATALOG.agent_email_thousands, {
    id: CATALOG.agent_email_thousands.id,
    properties: {
      name: CATALOG.agent_email_thousands.name,
      hs_pricing_model: 'volume',
      hs_tier_ranges: JSON.stringify([{ start: 0, end: 49_999 }]),
      hs_tier_prices: JSON.stringify([{ index: 0, price: 1 }]),
    },
  });
  assert.ok(
    row.disagreements.some(({ field }) => field === 'hs_pricing_model'),
    'a different pricing model must be reported',
  );
});

test('a null pricing model is read as flat, which is what HubSpot documents', () => {
  const row = _test.compareProduct('agent_accounts', CATALOG.agent_accounts, {
    id: CATALOG.agent_accounts.id,
    properties: { name: CATALOG.agent_accounts.name, price: '0.2' },
  });
  assert.equal(row.hubspotPricingModel, 'flat');
  // Agent Accounts is a single flat rate locally too, so nothing should be reported.
  assert.deepEqual(row.disagreements, []);
});

test('the onboarding mismatch is reported as a price disagreement', () => {
  // pricingRules currently has Quick Launch at $0 (the workbook figure). HubSpot says $5,000.
  const row = _test.compareProduct('quick_launch', CATALOG.quick_launch, {
    id: CATALOG.quick_launch.id,
    properties: { name: CATALOG.quick_launch.name, price: '5000' },
  });
  assert.equal(row.localKind, 'one_time');
  assert.deepEqual(
    row.disagreements.map(({ field, local, hubspot }) => [field, local, hubspot]),
    [['price', 0, 5000]],
  );
});

test('a stale local product name is reported', () => {
  const row = _test.compareProduct('enterprise', CATALOG.enterprise, {
    id: CATALOG.enterprise.id,
    properties: { name: 'Enterprise Drawdown Commitment', price: '0' },
  });
  assert.ok(row.disagreements.some(({ field }) => field === 'name'));
});

test('support and professional services are not compared on unit price', () => {
  // Support is a percentage of platform ARR with a cap; professional services are priced by how
  // many were selected. Neither has a single number that could agree with a product price, and
  // reporting one would be noise a reader learns to skip past.
  for (const key of ['full', 'google_verification_review']) {
    const row = _test.compareProduct(key, CATALOG[key], {
      id: CATALOG[key].id,
      properties: { name: CATALOG[key].name, price: '12345' },
    });
    assert.equal(row.localKind, 'formula', key);
    assert.deepEqual(row.disagreements, [], key);
    assert.ok(row.notes.length > 0, `${key} must explain why it was not compared`);
  }
});

test('a catalogued product HubSpot does not return is the loudest finding', () => {
  const row = _test.compareProduct('connect_ca', CATALOG.connect_ca, undefined);
  assert.equal(row.found, false);
  assert.equal(row.disagreements.length, 1);
  assert.match(row.disagreements[0].detail, /line items built from it will fail/);
});

test('malformed tier JSON is reported, never thrown', () => {
  // One bad product must not take down the whole report -- seeing everything at once is the point.
  const row = _test.compareProduct('agent_email_thousands', CATALOG.agent_email_thousands, {
    id: CATALOG.agent_email_thousands.id,
    properties: {
      name: CATALOG.agent_email_thousands.name,
      hs_pricing_model: 'graduated',
      hs_tier_ranges: '{not json',
      hs_tier_prices: '[]',
    },
  });
  assert.ok(row.notes.some((note) => /not valid JSON/.test(note)));
});

test('an absent tier property is distinguished from a product having no tiers', () => {
  const row = _test.compareProduct('agent_email_thousands', CATALOG.agent_email_thousands, {
    id: CATALOG.agent_email_thousands.id,
    properties: { name: CATALOG.agent_email_thousands.name, hs_pricing_model: 'graduated' },
  });
  assert.equal(row.tiersAvailable, false);
  assert.ok(
    row.notes.some((note) => /Revenue Hub/.test(note)),
    'the report must say why the tiers are missing, since it decides whether the switch is possible',
  );
});

test('every catalogued product is classified, so none is silently skipped', () => {
  for (const key of Object.keys(CATALOG)) {
    const expectation = _test.localExpectation(key);
    assert.notEqual(
      expectation.kind,
      'unpriced',
      `${key} has no local price to compare — add it to localExpectation`,
    );
  }
});

test('the tier properties are always requested by name', () => {
  // They are non-default, so a bare read omits them -- and that looks identical to the portal not
  // supporting them, which is the one question this whole module exists to answer.
  for (const property of ['hs_pricing_model', 'hs_tier_ranges', 'hs_tier_prices']) {
    assert.ok(_test.PRODUCT_PROPERTIES.includes(property), property);
  }
});

test('the report falls back to the dated API when v3 returns no tier data', async () => {
  const paths = [];
  const client = {
    crm: {
      products: {
        batchApi: {
          read: async () => ({
            // v3 answers, but without the tier properties.
            results: Object.values(CATALOG).map((entry) => ({
              id: entry.id,
              properties: { name: entry.name, price: '0' },
            })),
          }),
        },
      },
    },
    apiRequest: async ({ path, body }) => {
      paths.push(path);
      return {
        json: async () => ({
          results: body.inputs.map(({ id }) => ({
            id,
            properties: {
              name: 'x',
              hs_pricing_model: 'graduated',
              hs_tier_ranges: JSON.stringify([{ start: 0 }]),
              hs_tier_prices: JSON.stringify([{ index: 0, price: 1 }]),
            },
          })),
        }),
      };
    },
  };

  const report = await inspectProductLibrary(client);
  assert.deepEqual(paths, ['/crm/objects/2026-03/products/batch/read']);
  assert.equal(report.tieredPricingAvailable, true);
  assert.equal(report.reads.length, 2);
  assert.equal(report.reads[0].tierPropertyReturned, false);
  assert.equal(report.reads[1].tierPropertyReturned, true);
  assert.equal(report.productCount, Object.keys(CATALOG).length);
});

test('a total read failure reports rather than throws', async () => {
  const client = {
    crm: { products: { batchApi: { read: async () => { throw new Error('403 forbidden'); } } } },
    apiRequest: async () => { throw new Error('403 forbidden'); },
  };
  const report = await inspectProductLibrary(client);
  assert.equal(report.missingCount, Object.keys(CATALOG).length);
  assert.equal(report.reads.every(({ ok }) => ok === false), true);
  assert.match(report.reads[0].error, /403/);
});
