const assert = require('node:assert/strict');
const test = require('node:test');

const { calculateQuote } = require('./calculator');
const { CATALOG } = require('./lineItemModel');
const { defaultSettings } = require('./appSettings');
const { _test } = require('./QuoteOptionsFunction');

test('deleting the customer-selected option clears its Deal line items and selection', async () => {
  const archived = [];
  const updates = [];
  const client = {
    crm: {
      associations: {
        v4: {
          basicApi: {
            getPage: async () => ({ results: [{ toObjectId: 'line-1' }] }),
          },
        },
      },
      lineItems: { basicApi: { archive: async (id) => archived.push(id) } },
      deals: {
        basicApi: { update: async (_id, payload) => updates.push(payload) },
      },
    },
  };
  const state = {
    document: {
      schemaVersion: '1.0',
      revision: 2,
      options: [{ id: 'selected' }],
    },
    selectedOptionId: 'selected',
    selectedOptionName: 'Selected option',
    approvalStatus: 'draft',
    lineItemSyncStatus: 'synced',
  };

  const result = await _test.deleteOption(client, 'deal-1', state, {
    expectedRevision: 2,
    optionId: 'selected',
  });
  assert.deepEqual(archived, ['line-1']);
  assert.equal(result.selectedOptionId, null);
  assert.equal(result.document.options.length, 0);
  assert.equal(updates[0].properties.pricing_selected_option_id, '');
});

// Reverse of CATALOG, for readable assertions only. Nothing in the payload carries a name.
const labelForProductId = (id) =>
  Object.values(CATALOG).find((product) => product.id === id)?.name || `product:${id}`;

test('locking an option archives every existing Deal line item before creating replacements', async () => {
  const settings = defaultSettings();
  const input = {
    termMonths: 12,
    paymentFrequency: 'annual_in_advance',
    volumes: { connect_ca: 2_000 },
    supportLevel: 'basic',
    onboardingPackage: 'quick_launch',
    professionalServices: [],
    addOns: [],
  };
  const option = { id: 'selected-1', input, result: calculateQuote(input) };
  const state = {
    document: { options: [option] },
    selectedOptionId: option.id,
    selectedStateHash: option.result.stateHash,
  };
  const events = [];
  const createdProperties = [];
  const client = {
    crm: {
      associations: {
        v4: {
          basicApi: {
            getPage: async () => ({
              results: [{ toObjectId: 'old-unmanaged' }, { toObjectId: 'old-managed' }],
            }),
          },
        },
      },
      lineItems: {
        basicApi: {
          archive: async (id) => events.push(`archive:${id}`),
          create: async ({ properties }) => {
            // Assert on a HubSpot-defined property. nylas_line_item_key is bookkeeping that only
            // exists in portals where it was provisioned, so it is filtered out of the payload;
            // sending it made every create fail with a 400 in portals that lack it.
            createdProperties.push(properties);
            // Line items carry no `name` -- the product library owns it. The label is looked up
            // locally so this ordered list stays readable.
            events.push(`create:${labelForProductId(properties.hs_product_id)}`);
            return { id: 'new-1' };
          },
        },
      },
      deals: { basicApi: { update: async () => undefined } },
    },
  };

  const synced = await _test.syncDealLineItems(client, 'deal-1', state, settings);
  // Drawdown fee, then all seven bundle products as a rate schedule whether committed or not,
  // then the support tier (always present, at least Basic), then $0 Quick Launch onboarding.
  assert.equal(synced.count, 10);
  assert.deepEqual(events, [
    'archive:old-unmanaged',
    'archive:old-managed',
    'create:Enterprise Drawdown Commitment',
    'create:Connect - Email + Calendar Connected Accounts (CA)',
    'create:Connect - Calendar-Only Connected Accounts (CA)',
    'create:Notetaker - Bot Hours',
    'create:Agent Accounts - # of Agents',
    'create:Agent Accounts - GB / Storage',
    'create:Agent Accounts - GB / Bandwidth',
    'create:Agent Accounts - Per 1,000 Emails Sent',
    'create:Support Services: Basic',
    'create:QuickLaunch Onboarding',
  ]);
  // No nylas_* bookkeeping may reach HubSpot: a portal without those custom properties rejects
  // the whole create, which surfaced as "HubSpot could not replace the Deal line items."
  for (const properties of createdProperties) {
    assert.deepEqual(
      Object.keys(properties).filter((key) => key.startsWith('nylas_')),
      [],
    );
    assert.ok(properties.hs_product_id, 'line item must still carry hs_product_id');
    // Price may legitimately be absent: an undiscounted rate-schedule line leaves it to the
    // HubSpot product default. When present it must be a real number, never the string "NaN".
    if (properties.price != null) {
      assert.ok(
        Number.isFinite(Number(properties.price)),
        `price must be numeric, got ${properties.price}`,
      );
    }
  }
  // committed_quantity is custom, so the allow-list is the one place that can silently swallow it.
  // Connect is the only committed product in this fixture, at 2,000 CA per month.
  const connect = createdProperties.find(
    ({ hs_product_id: id }) => id === CATALOG.connect_ca.id,
  );
  assert.equal(connect.committed_quantity, '2000');
  assert.equal(connect.quantity, '0');
});

// payment_method is the one Deal property whose name and option values came from outside the code,
// and it rides in the same update as the pricing_* properties. A rejection over it must cost a
// warning and an unset property, never a failed Lock in -- by which point the Deal's line items
// have already been replaced.
test('a rejected payment_method is dropped and the rest of the Deal update still saves', async () => {
  const attempts = [];
  const client = {
    crm: {
      deals: {
        basicApi: {
          update: async (_id, { properties }) => {
            attempts.push(properties);
            if (attempts.length === 1 && properties.payment_method != null) {
              throw {
                body: {
                  message:
                    'Property values were not valid: payment_method is not a valid option',
                },
              };
            }
            return { id: _id };
          },
        },
      },
    },
  };

  await _test.updateDealProperties(client, 'deal-1', {
    pricing_arr: '1000',
    payment_method: 'Credit Card',
  });

  assert.equal(attempts.length, 2, 'the update is retried once');
  assert.equal(attempts[0].payment_method, 'Credit Card');
  assert.equal(attempts[1].payment_method, undefined, 'the retry omits the rejected property');
  assert.equal(attempts[1].pricing_arr, '1000', 'everything else still saves');
});

test('Payment Method maps the card keys to the portal values, and clears when unset', () => {
  assert.deepEqual(_test.paymentMethodProperties('credit_card'), {
    payment_method: 'Credit Card',
  });
  assert.deepEqual(_test.paymentMethodProperties('ach'), {
    payment_method: 'ACH/Bank Transfer',
  });
  // "Not specified" is a real answer and must clear the property rather than leave a stale value.
  assert.deepEqual(_test.paymentMethodProperties(''), { payment_method: '' });
  // A choice the map does not know is dropped, not sent: a bad enumeration value fails the update.
  assert.deepEqual(_test.paymentMethodProperties('paypal'), {});
});

test('Payment Schedule maps the calculator keys to the portal values', () => {
  assert.deepEqual(_test.paymentFrequencyProperties('annual_in_advance'), {
    payment_frequency: 'Annual In Advance',
  });
  assert.deepEqual(_test.paymentFrequencyProperties('semi_annual_in_advance'), {
    payment_frequency: 'Semi-Annual In Advance',
  });
  assert.deepEqual(_test.paymentFrequencyProperties('quarterly_in_advance'), {
    payment_frequency: 'Quarterly In Advance',
  });
  assert.deepEqual(_test.paymentFrequencyProperties('monthly_in_advance'), {
    payment_frequency: 'Monthly In Advance',
  });
  // Every schedule the card offers must be mapped: an unmapped one is dropped silently, so a
  // missing entry would leave the Deal quietly disagreeing with the pricing.
  assert.deepEqual(_test.paymentFrequencyProperties('fortnightly'), {});
});

test('a rejection over one mirrored property does not lose the others', async () => {
  const attempts = [];
  const client = {
    crm: {
      deals: {
        basicApi: {
          update: async (_id, { properties }) => {
            attempts.push(properties);
            // Both mirrored properties are wrong in this portal, one at a time.
            if (properties.payment_method != null) {
              throw { body: { message: 'payment_method is not a valid option' } };
            }
            if (properties.payment_frequency != null) {
              throw { body: { message: 'payment_frequency is not a valid option' } };
            }
            return { id: _id };
          },
        },
      },
    },
  };

  await _test.updateDealProperties(client, 'deal-1', {
    pricing_tcv: '94219',
    payment_method: 'Credit Card',
    payment_frequency: 'Annual In Advance',
  });

  assert.equal(attempts.length, 3, 'one attempt per rejected property, then the survivor');
  const final = attempts[attempts.length - 1];
  assert.equal(final.payment_method, undefined);
  assert.equal(final.payment_frequency, undefined);
  assert.equal(final.pricing_tcv, '94219', 'the pricing properties still save');
});

test('Auto-renewal writes Yes or No, and is never blank', () => {
  assert.deepEqual(_test.autoRenewalProperties(true), { auto_renewal__c: 'Yes' });
  assert.deepEqual(_test.autoRenewalProperties(false), { auto_renewal__c: 'No' });
  // A boolean the card always holds a value for, so anything falsy is No rather than "unset".
  // Blank would leave whatever was on the Deal before, which is worse than being explicit.
  assert.deepEqual(_test.autoRenewalProperties(undefined), { auto_renewal__c: 'No' });
});

test('the contract term is mirrored onto the Deal, and junk is never sent', () => {
  assert.deepEqual(_test.contractTermProperties(12), { contract_term__months_: '12' });
  assert.deepEqual(_test.contractTermProperties(24), { contract_term__months_: '24' });
  assert.deepEqual(_test.contractTermProperties(36), { contract_term__months_: '36' });
  // Nothing rather than something wrong: an absent or nonsense term would either fail the update
  // or overwrite a good number. A calculated option always carries a real term.
  assert.deepEqual(_test.contractTermProperties(undefined), {});
  assert.deepEqual(_test.contractTermProperties(0), {});
  assert.deepEqual(_test.contractTermProperties('not a number'), {});
});

// Credit card is not permitted on an invoice above the limit -- ACH/Bank Transfer (wire) is
// required. Holly, 2026-08-27.
//
// The card enforces this too, but the card can be running a stale bundle, so this is the guard
// that matters. What matters as much as refusing is WHEN it refuses: syncDealLineItems archives
// the Deal's existing line items before creating replacements, so a guard placed after it would
// reject the lock only after emptying the Deal. These tests assert nothing was written.
test('Lock in is refused when credit card is used above the invoice limit', async () => {
  const settings = defaultSettings();
  const input = {
    termMonths: 12,
    paymentFrequency: 'annual_in_advance',
    volumes: { connect_ca: 20_000 },
    supportLevel: 'basic',
    onboardingPackage: 'none',
    professionalServices: [],
    addOns: [],
  };
  // Proves the fixture actually crosses the limit, so the refusal below is the rule firing and not
  // some unrelated validation failure.
  const result = calculateQuote(input, settings.pricingPolicy);
  assert.equal(result.requiresBankTransfer, true);
  assert.ok(result.largestInvoiceAmount > 25_000);

  const touched = [];
  const client = {
    crm: {
      associations: { v4: { basicApi: { getPage: async () => {
        touched.push('read-associations');
        return { results: [] };
      } } } },
      lineItems: {
        basicApi: {
          archive: async () => touched.push('ARCHIVED A LINE ITEM'),
          create: async () => {
            touched.push('CREATED A LINE ITEM');
            return { id: 'li' };
          },
        },
      },
      deals: { basicApi: { update: async () => touched.push('WROTE TO THE DEAL') } },
      quotes: { basicApi: { create: async () => touched.push('CREATED A QUOTE') } },
    },
  };

  await assert.rejects(
    () =>
      _test.lockLiveCalculation(
        client,
        'deal-1',
        { document: { schemaVersion: '1.0', revision: 1, options: [] } },
        { input, quoteContent: {}, paymentMethod: 'credit_card', discountReason: '' },
        '45023718',
        settings,
      ),
    (error) => error.message === 'PAYMENT_METHOD_REQUIRES_BANK_TRANSFER',
  );
  // Nothing at all: no archive, no create, no Deal update, no quote.
  assert.deepEqual(touched, [], `the Deal must be untouched, but got: ${touched.join(', ')}`);
});

test('an unset payment method above the limit is refused too', async () => {
  const settings = defaultSettings();
  const input = {
    termMonths: 12,
    paymentFrequency: 'annual_in_advance',
    volumes: { connect_ca: 20_000 },
    supportLevel: 'basic',
    onboardingPackage: 'none',
    professionalServices: [],
    addOns: [],
  };
  const client = { crm: { deals: { basicApi: { update: async () => {
    throw new Error('must not be reached');
  } } } } };

  // "Not specified" does not satisfy a requirement that ACH IS selected, so blank is refused on the
  // same footing as credit card. Anything other than ach is refused.
  for (const paymentMethod of ['', undefined, 'credit_card', 'paypal']) {
    await assert.rejects(
      () =>
        _test.lockLiveCalculation(
          client,
          'deal-1',
          { document: { schemaVersion: '1.0', revision: 1, options: [] } },
          { input, quoteContent: {}, paymentMethod, discountReason: '' },
          '45023718',
          settings,
        ),
      (error) => error.message === 'PAYMENT_METHOD_REQUIRES_BANK_TRANSFER',
      `payment method ${JSON.stringify(paymentMethod)} must be refused`,
    );
  }
});

test('credit card is still allowed below the invoice limit', async () => {
  const settings = defaultSettings();
  // Monthly billing, deliberately. A deal small enough to invoice under $25,000 ANNUALLY would be
  // below the $25,000 Enterprise ARR minimum and blocked for that instead, so it would prove
  // nothing about the payment-method rule. Billed monthly, this is a $91,368 ARR deal invoicing
  // $7,614 a period: comfortably over the ARR minimum and comfortably under the card limit, which
  // is the only combination that isolates what this test is checking.
  const input = {
    termMonths: 12,
    paymentFrequency: 'monthly_in_advance',
    volumes: { connect_ca: 5_000 },
    supportLevel: 'basic',
    onboardingPackage: 'none',
    professionalServices: [],
    addOns: [],
  };
  const result = calculateQuote(input, settings.pricingPolicy);
  assert.equal(result.requiresBankTransfer, false, 'fixture must sit below the limit');
  assert.deepEqual(result.blockingReasons, [], 'and must not be blocked for any other reason');
  assert.ok(result.committedArr > 25_000, 'above the Enterprise ARR minimum');
  assert.ok(result.largestInvoiceAmount < 25_000, 'but below the credit card invoice limit');

  // Reaches the write path rather than being refused by the payment-method guard. It fails later,
  // on the stubbed-out quote creation, which is enough to show the guard let it through.
  let reachedWrite = false;
  const client = {
    crm: {
      associations: { v4: { basicApi: { getPage: async () => ({ results: [] }) } } },
      lineItems: { basicApi: { create: async () => ({ id: 'li' }) } },
      deals: {
        basicApi: {
          update: async () => {
            reachedWrite = true;
            return { id: 'deal-1' };
          },
        },
      },
    },
  };
  await _test
    .lockLiveCalculation(
      client,
      'deal-1',
      { document: { schemaVersion: '1.0', revision: 1, options: [] } },
      { input, quoteContent: {}, paymentMethod: 'credit_card', discountReason: '' },
      '45023718',
      settings,
    )
    .catch(() => undefined);
  assert.equal(reachedWrite, true, 'a small deal on credit card must not be blocked');
});

// A line item must never be created silently missing a field because HubSpot was busy.
//
// On the 2026-08-28 quote, one of five identical professional-services lines came back without
// `one_time_fees` while the other four kept it, so the Order Form printed a dash in the One-Time
// Fees column for that row alone. The portal has the property -- four writes in the same call
// proved it. The old guard was `message.includes(property) && /propert/i.test(message)`, which
// matched any failure whose text happened to list the properties it was sent.
const rejection = (status, message) => Object.assign(new Error(message), { code: status });

test('a busy HubSpot is not mistaken for a missing property', () => {
  const { isUnknownPropertyRejection } = _test;
  // The shape that caused the bug: a rate limit whose body echoes the properties sent.
  assert.equal(
    isUnknownPropertyRejection(
      rejection(429, 'Too many requests. properties: one_time_fees, recurring_fees'),
      'one_time_fees',
    ),
    false,
  );
  assert.equal(
    isUnknownPropertyRejection(
      rejection(502, 'Bad gateway while writing property one_time_fees'),
      'one_time_fees',
    ),
    false,
  );
  // A genuine missing property still drops, or a portal without the custom fields loses its Deal.
  assert.equal(
    isUnknownPropertyRejection(
      rejection(400, 'Property "one_time_fees" does not exist'),
      'one_time_fees',
    ),
    true,
  );
  // Named, but for some other reason: not a licence to drop it.
  assert.equal(
    isUnknownPropertyRejection(
      rejection(400, 'Value for property one_time_fees was too long'),
      'one_time_fees',
    ),
    false,
  );
});

test('a rate-limited line item create is retried whole, not degraded', async () => {
  const { createLineItem } = _test;
  const sent = [];
  let calls = 0;
  const client = {
    crm: {
      lineItems: {
        basicApi: {
          create: async ({ properties }) => {
            calls += 1;
            sent.push(properties);
            if (calls === 1) {
              throw rejection(429, 'Too many requests. properties: one_time_fees');
            }
            return { id: 'line-1' };
          },
        },
      },
    },
  };
  const properties = { price: '1760', one_time_fees: '1760', total_fees_for_term: '1760' };
  const created = await createLineItem(client, properties, []);

  assert.equal(created.id, 'line-1');
  assert.equal(calls, 2, 'the transient failure must be retried');
  assert.deepEqual(
    sent[1],
    properties,
    'the retry must send the SAME properties -- dropping one is how a quote loses a fee column',
  );
});

test('a genuinely missing property is still dropped so the Deal is not emptied', async () => {
  const { createLineItem } = _test;
  const sent = [];
  const client = {
    crm: {
      lineItems: {
        basicApi: {
          create: async ({ properties }) => {
            sent.push(properties);
            if (properties.one_time_fees != null) {
              throw rejection(400, 'Property "one_time_fees" does not exist');
            }
            return { id: 'line-2' };
          },
        },
      },
    },
  };
  const created = await createLineItem(
    client,
    { price: '1760', one_time_fees: '1760' },
    [],
  );
  assert.equal(created.id, 'line-2');
  assert.equal(sent.length, 2);
  assert.equal(sent[1].one_time_fees, undefined);
  assert.equal(sent[1].price, '1760', 'only the rejected field comes off');
});
