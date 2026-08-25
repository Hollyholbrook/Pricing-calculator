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
  const items = buildDealLineItems(selected, {
    bundleId: '67653718',
    name: 'Enterprise OneSub',
    category: 'Platform',
  });
  const recurring = items
    .filter(({ properties }) => properties.recurringbillingfrequency)
    .reduce(
      (sum, { properties }) =>
        sum + Number(properties.price || 0) * Number(properties.quantity),
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
  const recurringItems = items.filter(
    ({ properties }) => properties.recurringbillingfrequency,
  );
  assert.equal(recurringItems.length, 8);
  assert.equal(recurringItems[0].key, 'subscription:nylas_enterprise');
  assert.equal(recurringItems[0].properties.hs_product_id, undefined);
  assert.equal(recurringItems[0].properties.name, 'Enterprise OneSub');
  assert.equal(recurringItems[0].properties.quantity, '1');
  assert.equal(
    recurringItems[0].properties.nylas_pricing_component,
    'subscription_drawdown',
  );
  const usageRates = recurringItems.slice(1);
  assert.equal(usageRates.length, 7);
  assert.ok(usageRates.every(({ properties }) => properties.quantity === '0'));
  assert.ok(
    usageRates.every(
      ({ properties }) => properties.price == null || Number(properties.price) >= 0,
    ),
  );
  const email = usageRates.find(({ key }) => key === 'rate_schedule:agent_email_thousands');
  assert.equal(email.properties.hs_product_id, '45867076721');
  assert.equal(email.properties.price, undefined);
  assert.equal(email.properties.hs_pricing_model, 'graduated');
  assert.deepEqual(JSON.parse(email.properties.hs_tier_ranges), [
    { start: 0, end: 49_999 },
    { start: 50_000, end: 99_999 },
    { start: 100_000, end: 499_999 },
    { start: 500_000 },
  ]);
  const calculatedEmail = selected.result.lines.find(
    ({ productKey }) => productKey === 'agent_email_thousands',
  );
  assert.deepEqual(
    JSON.parse(email.properties.hs_tier_prices),
    calculatedEmail.proposedBandRates.map(({ rate }, index) => ({ index, price: rate })),
  );
  assert.equal(email.properties.recurringbillingfrequency, 'monthly');
  assert.equal(email.properties.hs_recurring_billing_period, 'P24M');
  assert.equal(email.properties.hs_recurring_billing_number_of_payments, '24');
  assert.equal(email.properties.hs_recurring_billing_start_date, '2026-09-01');
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
