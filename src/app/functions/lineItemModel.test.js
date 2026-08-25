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
  const recurring = items
    .filter(({ properties }) => properties.recurringbillingfrequency)
    .reduce(
      (sum, { properties }) => sum + Number(properties.price) * Number(properties.quantity),
      0,
    );
  const oneTime = items
    .filter(({ properties }) => !properties.recurringbillingfrequency)
    .reduce(
      (sum, { properties }) => sum + Number(properties.price) * Number(properties.quantity),
      0,
    );

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
  assert.deepEqual(
    recurringItems.map(({ key }) => key),
    [
      'subscription:nylas_enterprise',
      'support:full',
      'addon:enterprise_accelerator',
    ],
  );
  assert.equal(recurringItems[0].properties.hs_product_id, '46037350773');
  assert.equal(recurringItems[0].properties.name, 'Enterprise');
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
  assert.equal(recurringItems[1].properties.name, 'Support Services: Full');
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
  const recurring = items
    .filter(({ properties }) => properties.recurringbillingfrequency)
    .reduce(
      (sum, { properties }) => sum + Number(properties.price) * Number(properties.quantity),
      0,
    );
  const oneTime = items
    .filter(({ properties }) => !properties.recurringbillingfrequency)
    .reduce(
      (sum, { properties }) => sum + Number(properties.price) * Number(properties.quantity),
      0,
    );
  assert.equal(Math.round(recurring * 100) / 100, selected.result.recurringPerPeriod);
  assert.equal(Math.round(oneTime * 100) / 100, selected.result.oneTime);
});

test('Quote content rejects unknown fields', () => {
  assert.throws(
    () => normalizeQuoteContent({ title: 'Test', unexpected: true }),
    /INVALID_QUOTE_CONTENT/,
  );
});
