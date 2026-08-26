const assert = require('node:assert/strict');
const test = require('node:test');

const { calculateQuote } = require('./calculator');
const {
  buildDealLineItems,
  buildQuoteLineItems,
  normalizeQuoteContent,
} = require('./lineItemModel');

const option = () => {
  const input = {
    startDate: '2026-09-01',
    termMonths: 24,
    paymentFrequency: 'quarterly_in_advance',
    volumes: {
      connect_ca: 2_800,
      calendar_ca: 2_800,
      notetaker_bot_hours: 150,
      agent_accounts: 0,
      agent_email_thousands: 0,
      agent_storage_gb: 0,
      agent_bandwidth_gb: 0,
    },
    supportLevel: 'full',
    onboardingPackage: 'quick_launch_plus',
    addOns: ['enterprise_accelerator'],
    professionalServices: [
      'google_verification_review',
      'architecture_workflow_review',
    ],
    discretionaryDiscount: 0.1,
    autoRenewal: true,
    renewalTermMonths: 12,
    nonRenewalNoticeDays: 60,
    redliningRequested: false,
    nonStandardTerms: false,
    specialTerms: '',
  };
  return { id: 'option-1', name: 'Preferred', input, result: calculateQuote(input) };
};

test('Deal line items reconcile to the approved calculation', () => {
  const selected = option();
  const items = buildDealLineItems(selected);
  // An absent price means "use the product default" and always sits on a quantity-0 rate
  // schedule line, so it contributes nothing either way.
  const lineAmount = ({ price, quantity }) =>
    price == null ? 0 : Number(price) * Number(quantity);
  const recurring = items
    .filter(({ properties }) => properties.recurringbillingfrequency)
    .reduce((sum, { properties }) => sum + lineAmount(properties), 0);
  const oneTime = items
    .filter(({ properties }) => !properties.recurringbillingfrequency)
    .reduce((sum, { properties }) => sum + lineAmount(properties), 0);

  assert.equal(Math.round(recurring * 100) / 100, selected.result.recurringPerPeriod);
  assert.equal(Math.round(oneTime * 100) / 100, selected.result.oneTime);
  assert.equal(new Set(items.map(({ key }) => key)).size, items.length);
  // Recurring charges are itemized: the product-commitment subscription, the support tier, and
  // one line per recurring add-on. The reconciliation above still holds because the subscription
  // line is priced off proposedPlatformArr rather than committedArr - pricing it off committedArr
  // while support and add-ons also had their own lines would bill both of them twice.
  const recurringItems = items.filter(
    ({ properties }) => properties.recurringbillingfrequency,
  );
  // Drawdown fee first, then the committed products as a zero-priced rate schedule in the fixed
  // product order, then the charges that sit outside the bundle.
  assert.deepEqual(
    recurringItems.map(({ key }) => key),
    [
      'subscription:nylas_enterprise',
      // All seven bundle products, in the fixed order, committed or not.
      'metered:connect_ca',
      'metered:calendar_ca',
      'metered:notetaker_bot_hours',
      'metered:agent_accounts',
      'metered:agent_storage_gb',
      'metered:agent_bandwidth_gb',
      'metered:agent_email_thousands',
      'support:full',
      'addon:enterprise_accelerator',
    ],
  );
  assert.equal(recurringItems[0].properties.hs_product_id, '46037350773');
  assert.equal(recurringItems[0].properties.name, 'Enterprise Drawdown Fee');

  // Positions are stamped in order, because HubSpot orders by hs_position_on_quote, not creation.
  assert.deepEqual(
    items.map(({ properties }) => properties.hs_position_on_quote),
    items.map((_item, index) => String(index)),
  );

  // Bundle members carry quantity 0 so they add nothing to the total. Price is left to HubSpot
  // unless the rep discounted the product, in which case the agreed monthly rate is sent.
  for (const item of items.filter(({ key }) => key.startsWith('metered:'))) {
    assert.equal(Number(item.properties.quantity), 0, `${item.key} quantity`);
    assert.notEqual(item.properties.price, 'NaN', `${item.key} price is never the string NaN`);
  }
  // This fixture carries a 10% discretionary discount, which normalizeInput spreads to every
  // product, so every rate schedule line here sends its agreed rate. The
  // no-discount-means-no-price case is covered by the all-products test below.
  for (const item of items.filter(({ key }) => key.startsWith('metered:'))) {
    assert.ok(
      Number(item.properties.price) > 0,
      `${item.key} sends the agreed rate when discounted`,
    );
  }

  // Everything outside the bundle keeps a real quantity: drawdown, support, add-ons, one-times.
  for (const item of items.filter(({ key }) => !key.startsWith('metered:'))) {
    assert.ok(
      Number(item.properties.quantity) > 0,
      `${item.key} is outside the bundle and keeps its quantity`,
    );
  }

  // A discounted product prices at the discounted rate. The app writes no description: the
  // customer-facing quote shows the product library's own copy, not text assembled here.
  const discounted = items.find(({ key }) => key === 'metered:connect_ca');
  assert.equal(discounted.properties.description, undefined);
  assert.equal(recurringItems[0].properties.quantity, '1');
  assert.equal(
    recurringItems[0].properties.nylas_pricing_component,
    'subscription_drawdown',
  );
  assert.equal(
    Math.round(
      (Number(recurringItems[0].properties.price) * selected.result.paymentsPerYear +
        Number.EPSILON) * 100,
    ) / 100,
    selected.result.proposedPlatformArr,
  );
  assert.equal(recurringItems[1].properties.name, 'Connect - Email + Calendar Connected Accounts (CA)');
});

test('every bundle product appears even with no commitment or discount', () => {
  const input = {
    termMonths: 12,
    paymentFrequency: 'annual_in_advance',
    // Only one product committed; the other six must still appear.
    volumes: { connect_ca: 1_000 },
    supportLevel: 'basic',
    onboardingPackage: 'none',
    professionalServices: [],
    addOns: [],
  };
  const items = buildDealLineItems({ id: 'o', input, result: calculateQuote(input) });
  const metered = items.filter(({ key }) => key.startsWith('metered:'));
  assert.deepEqual(
    metered.map(({ key }) => key.replace('metered:', '')),
    [
      'connect_ca',
      'calendar_ca',
      'notetaker_bot_hours',
      'agent_accounts',
      'agent_storage_gb',
      'agent_bandwidth_gb',
      'agent_email_thousands',
    ],
  );
  // An uncommitted product still states the rate it would draw down at.
  const uncommitted = metered.find(({ key }) => key === 'metered:agent_storage_gb');
  assert.equal(Number(uncommitted.properties.quantity), 0);
  assert.equal(
    uncommitted.properties.price,
    undefined,
    'price is left to the product default when nothing was discounted',
  );
  assert.equal(uncommitted.properties.description, undefined);
  // The committed volume rides on committed_quantity, not in prose, and not in quantity -- these
  // lines must keep quantity 0 so they add nothing to the Deal total.
  assert.equal(uncommitted.properties.committed_quantity, '0');
  const committed = metered.find(({ key }) => key === 'metered:connect_ca');
  assert.equal(committed.properties.committed_quantity, '1000');
  assert.equal(committed.properties.quantity, '0');
  // Nothing outside the rate schedule carries it.
  for (const item of items.filter(({ key }) => !key.startsWith('metered:'))) {
    assert.equal(
      item.properties.committed_quantity,
      undefined,
      `${item.key} is not a metered product line`,
    );
  }
});

test('every quote carries a support line, Basic at $0 included', () => {
  const input = {
    termMonths: 12,
    paymentFrequency: 'annual_in_advance',
    volumes: { connect_ca: 1_000 },
    supportLevel: 'basic',
    onboardingPackage: 'none',
    professionalServices: [],
    addOns: [],
  };
  const items = buildDealLineItems({ id: 'o', input, result: calculateQuote(input) });
  const support = items.find(({ key }) => key === 'support:basic');
  assert.ok(support, 'Basic support must still produce a line item');
  assert.equal(support.properties.name, 'Support Services: Basic');
  assert.equal(Number(support.properties.price), 0);
  // "None" onboarding is a real selection meaning none was sold, so it produces no line.
  assert.equal(
    items.some(({ key }) => key.startsWith('onboarding:')),
    false,
  );
});

test('onboarding packages map to their own products, not the next one up', () => {
  const forPackage = (onboardingPackage) => {
    const input = {
      termMonths: 12,
      paymentFrequency: 'annual_in_advance',
      volumes: { connect_ca: 1_000 },
      supportLevel: 'basic',
      onboardingPackage,
      professionalServices: [],
      addOns: [],
    };
    const items = buildDealLineItems({ id: 'o', input, result: calculateQuote(input) });
    return items.find(({ key }) => key.startsWith('onboarding:'))?.properties;
  };
  // Each key previously resolved to the NEXT package's product, and quick_launch had no entry.
  assert.equal(forPackage('quick_launch').name, 'QuickLaunch Onboarding');
  assert.equal(forPackage('quick_launch').hs_product_id, '42724377715');
  assert.equal(forPackage('quick_launch_plus').name, 'QuickLaunch+ Onboarding');
  assert.equal(forPackage('quick_launch_plus').hs_product_id, '42724501576');
  assert.equal(forPackage('strategic').name, 'Strategic Onboarding');
  assert.equal(forPackage('strategic').hs_product_id, '42724439648');
});

test('Quote can collapse only the subscription products, not other charges', () => {
  const selected = option();
  const content = normalizeQuoteContent({
    title: 'Acme – Nylas Enterprise',
    expirationDate: '2026-09-30',
    presentation: 'subscription_summary',
    includeUncommittedRateSchedule: true,
    includeRenewalTerms: true,
    includeSpecialTerms: true,
  });
  const items = buildQuoteLineItems(selected, content);

  assert.equal(items.filter(({ key }) => key === 'subscription:drawdown').length, 1);
  assert.equal(items.filter(({ key }) => key.startsWith('metered:')).length, 0);
  assert.equal(items.filter(({ key }) => key.startsWith('addon:')).length, 1);
  assert.equal(items.filter(({ key }) => key.startsWith('support:')).length, 1);
  assert.equal(items.filter(({ key }) => key.startsWith('professional_service:')).length, 2);
});

test('itemized Quote line items reconcile to recurring and one-time totals', () => {
  const selected = option();
  const items = buildQuoteLineItems(selected, normalizeQuoteContent({
    title: 'Acme – Itemized',
    expirationDate: '2026-09-30',
    presentation: 'itemized_products',
  }));
  // An absent price means "use the product default" and always sits on a quantity-0 rate
  // schedule line, so it contributes nothing either way.
  const lineAmount = ({ price, quantity }) =>
    price == null ? 0 : Number(price) * Number(quantity);
  const recurring = items
    .filter(({ properties }) => properties.recurringbillingfrequency)
    .reduce((sum, { properties }) => sum + lineAmount(properties), 0);
  const oneTime = items
    .filter(({ properties }) => !properties.recurringbillingfrequency)
    .reduce((sum, { properties }) => sum + lineAmount(properties), 0);
  assert.equal(Math.round(recurring * 100) / 100, selected.result.recurringPerPeriod);
  assert.equal(Math.round(oneTime * 100) / 100, selected.result.oneTime);
});

test('Quote content rejects unknown fields', () => {
  assert.throws(
    () => normalizeQuoteContent({ title: 'Test', unexpected: true }),
    /INVALID_QUOTE_CONTENT/,
  );
});

// The Quote title field in the card relies on all three of these. An untouched field must omit
// the key rather than send '', because a present-but-empty title is a validation error rather
// than a request for the default.
test('Quote title falls back only when the key is absent, never when it is blank', () => {
  assert.equal(normalizeQuoteContent({}, 'Acme – Live calculator').title, 'Acme – Live calculator');
  assert.equal(normalizeQuoteContent({ title: '  Renewal FY27  ' }).title, 'Renewal FY27');
  assert.throws(() => normalizeQuoteContent({ title: '' }), /INVALID_QUOTE_CONTENT/);
  assert.throws(() => normalizeQuoteContent({ title: '   ' }), /INVALID_QUOTE_CONTENT/);
  assert.throws(() => normalizeQuoteContent({ title: 'x'.repeat(161) }), /INVALID_QUOTE_CONTENT/);
  assert.equal(normalizeQuoteContent({ title: 'x'.repeat(160) }).title.length, 160);
});

// The Quote and the Deal must show the customer the same thing. They diverged once -- only in the
// drawdown fee's description wording -- and that difference was read, during a real debugging
// session, as evidence that two different systems were writing line items. Both sets were ours.
//
// The nylas_* properties are excluded: they are stripped by hubSpotLineItemProperties before any
// create, so they never reach HubSpot. Everything HubSpot actually receives must match.
const sentToHubSpot = ({ properties }) =>
  Object.fromEntries(
    Object.entries(properties).filter(([key]) => !key.startsWith('nylas_')),
  );

test('Quote and Deal line items carry identical properties', () => {
  const selected = option();
  const dealItems = buildDealLineItems(selected);
  const quoteItems = buildQuoteLineItems(
    selected,
    // What the card actually sends: itemized, with the uncommitted products in the rate schedule.
    normalizeQuoteContent({
      presentation: 'itemized_products',
      includeUncommittedRateSchedule: true,
    }),
  );

  assert.equal(quoteItems.length, dealItems.length);
  for (const [index, dealItem] of dealItems.entries()) {
    assert.deepEqual(
      sentToHubSpot(quoteItems[index]),
      sentToHubSpot(dealItem),
      `line ${index} (${dealItem.properties.name}) must match on the Quote and the Deal`,
    );
  }
});

// The app writes no line item descriptions at all, on either surface.
//
// The drawdown fee was the last holdout: it carried the whole per-product rate schedule, and
// HubSpot collapses newlines when rendering a line item description, so it arrived on the
// customer-facing quote as one unbroken paragraph. Omitting the property lets HubSpot fall back to
// the product library's own copy; sending '' would blank that instead.
test('no line item carries an app-authored description', () => {
  const selected = option();
  const content = normalizeQuoteContent({ includeUncommittedRateSchedule: true });
  for (const [surface, items] of [
    ['deal', buildDealLineItems(selected)],
    ['quote', buildQuoteLineItems(selected, content)],
  ]) {
    for (const item of items) {
      assert.equal(
        item.properties.description,
        undefined,
        `${surface} line ${item.properties.name} must leave description to the product library`,
      );
    }
  }
});
