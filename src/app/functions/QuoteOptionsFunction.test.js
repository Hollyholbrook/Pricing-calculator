const assert = require('node:assert/strict');
const test = require('node:test');

const { calculateQuote } = require('./calculator');
const { CATALOG } = require('./lineItemModel');
const { defaultSettings, normalizeSettings } = require('./appSettings');
const { _test } = require('./QuoteOptionsFunction');

const OPTION_PROPERTY = 'pricing_quote_options_payload';

// Line item writes are BATCHED -- one create, one read-back, one update, one archive per surface,
// instead of one of each per line item. A HubSpot app function is killed at 10 seconds and the
// per-item version spent the whole budget before it could create the quote. These fakes speak the
// batch shape; `read` answers "every fee property landed" so a test that is not about the repair
// does not have to describe one.
const batchLineItems = ({ create, archive, read, update } = {}) => ({
  batchApi: {
    create,
    archive,
    read:
      read ||
      (async ({ inputs }) => ({
        results: inputs.map(({ id }) => ({
          id,
          properties: { one_time_fees: '1', recurring_fees: '1', total_fees_for_term: '1' },
        })),
      })),
    update: update || (async () => undefined),
  },
});

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
      lineItems: batchLineItems({
        archive: async ({ inputs }) => inputs.forEach(({ id }) => archived.push(String(id))),
      }),
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

// THE STRUCTURAL FIX, 2026-08-30. A rejected create must no longer empty the Deal.
//
// Before this, syncDealLineItems archived the Deal's line items and then created replacements
// with no restore, so one bad property name took every line item with it. That happened for real
// on 2026-08-28: an invalid `units` enumeration value emptied a Deal. Every "never guess a
// property name" rule in section 9 of the requirements exists because of this sequence.
const lineItemSyncFixture = () => {
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
  return {
    document: { options: [option] },
    selectedOptionId: option.id,
    selectedStateHash: option.result.stateHash,
  };
};

test('a rejected line item leaves the Deal holding everything it already had', async () => {
  const archived = [];
  const created = [];
  let createCalls = 0;
  const client = {
    crm: {
      associations: { v4: { basicApi: { getPage: async () => ({
        results: [{ toObjectId: 'existing-1' }, { toObjectId: 'existing-2' }],
      }) } } },
      lineItems: {
        ...batchLineItems({
          archive: async ({ inputs }) => inputs.forEach(({ id }) => archived.push(String(id))),
          // A batch fails as ONE unit. `units` is not one of the optional custom properties, so
          // it is not droppable, and the create falls back to one line item at a time -- where
          // the fifth is refused, exactly as before.
          create: async () => {
            const error = new Error('PROPERTY_DOESNT_EXIST');
            error.code = 400;
            error.body = { message: 'Property "units" was not one of the allowed options' };
            throw error;
          },
        }),
        basicApi: {
          create: async () => {
            createCalls += 1;
            if (createCalls === 5) {
              const error = new Error('PROPERTY_DOESNT_EXIST');
              error.code = 400;
              error.body = { message: 'Property "units" was not one of the allowed options' };
              throw error;
            }
            const id = `new-${createCalls}`;
            created.push(id);
            return { id };
          },
        },
      },
      deals: { basicApi: { update: async () => undefined } },
    },
  };

  await assert.rejects(
    () => _test.syncDealLineItems(client, 'deal-1', lineItemSyncFixture(), defaultSettings()),
    (error) => error.message === 'LINE_ITEM_SYNC_FAILED',
  );

  // THE POINT: neither original was touched. The rep's Deal still shows its line items.
  assert.equal(archived.includes('existing-1'), false, 'an original line item was archived');
  assert.equal(archived.includes('existing-2'), false, 'an original line item was archived');
  // And the half-built replacement set was cleaned up rather than left beside the originals.
  for (const id of created) {
    assert.ok(archived.includes(id), `replacement ${id} was left behind`);
  }
});

// The other half of the trade. Once archiving has begun the replacements must be KEPT, because
// removing them too is the thing that empties the Deal. Duplicates are visible and fixable; an
// empty Deal is silent.
test('a failure while archiving keeps the replacements rather than emptying the Deal', async () => {
  const archived = [];
  const created = [];
  const client = {
    crm: {
      associations: { v4: { basicApi: { getPage: async () => ({
        results: [{ toObjectId: 'existing-1' }, { toObjectId: 'existing-2' }],
      }) } } },
      lineItems: batchLineItems({
        archive: async ({ inputs }) => {
          // The first original archives; the second refuses, part-way through the batch.
          for (const { id } of inputs) {
            if (id === 'existing-2') throw new Error('rate limited');
            archived.push(String(id));
          }
        },
        create: async ({ inputs }) => ({
          results: inputs.map(({ properties }) => {
            const id = `new-${created.length + 1}`;
            created.push(id);
            return { id, properties };
          }),
        }),
      }),
      deals: { basicApi: { update: async () => undefined } },
    },
  };

  await assert.rejects(
    () => _test.syncDealLineItems(client, 'deal-1', lineItemSyncFixture(), defaultSettings()),
    (error) => error.message === 'LINE_ITEM_SYNC_FAILED',
  );

  assert.ok(created.length > 0, 'replacements must have been created');
  for (const id of created) {
    assert.equal(archived.includes(id), false, `replacement ${id} was rolled back after an archive`);
  }
  // The Deal is not empty: it holds every replacement, plus whichever original survived.
  assert.deepEqual(archived, ['existing-1']);
});

// Reverse of CATALOG, for readable assertions only. Nothing in the payload carries a name.
const labelForProductId = (id) =>
  Object.values(CATALOG).find((product) => product.id === id)?.name || `product:${id}`;

test('locking an option creates the replacements BEFORE archiving what was there', async () => {
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
      lineItems: batchLineItems({
        archive: async ({ inputs }) =>
          inputs.forEach(({ id }) => events.push(`archive:${id}`)),
        create: async ({ inputs }) => ({
          results: inputs.map(({ properties }, index) => {
            // Assert on a HubSpot-defined property. nylas_line_item_key is bookkeeping that only
            // exists in portals where it was provisioned, so it is filtered out of the payload;
            // sending it made every create fail with a 400 in portals that lack it.
            createdProperties.push(properties);
            // Line items carry no `name` -- the product library owns it. The label is looked up
            // locally so this ordered list stays readable.
            events.push(`create:${labelForProductId(properties.hs_product_id)}`);
            return { id: `new-${index + 1}`, properties };
          }),
        }),
      }),
      deals: { basicApi: { update: async () => undefined } },
    },
  };

  const synced = await _test.syncDealLineItems(client, 'deal-1', state, settings);
  // Drawdown fee, then all seven bundle products as a rate schedule whether committed or not,
  // then the support tier (always present, at least Basic), then $0 Quick Launch onboarding.
  assert.equal(synced.count, 10);
  // ORDER IS THE ASSERTION. Every create precedes every archive, so a rejected create leaves the
  // Deal holding the line items it already had. The reverse order is what emptied a Deal on
  // 2026-08-28 when an invalid `units` enumeration was sent.
  assert.deepEqual(events, [
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
    'archive:old-unmanaged',
    'archive:old-managed',
  ]);
  assert.ok(
    events.findIndex((e) => e.startsWith('archive:')) >
      events.findLastIndex((e) => e.startsWith('create:')),
    'no line item may be archived until every replacement exists',
  );
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

// Superseded draft quotes are archived; anything a customer could have seen is not.
//
// Quote generation is unconditional, so every Lock in mints a new draft. Before this, nothing
// cleaned up the last one and a Deal collected a stack of them.
const quoteClient = (status, { archiveThrows = false } = {}) => {
  const archived = [];
  return {
    archived,
    client: {
      crm: {
        quotes: {
          basicApi: {
            getById: async (id) => ({ id, properties: { hs_status: status } }),
            archive: async (id) => {
              if (archiveThrows) throw new Error('quote is locked');
              archived.push(String(id));
            },
          },
        },
      },
    },
  };
};

test('the superseded draft quote is archived', async () => {
  const { client, archived } = quoteClient('DRAFT');
  const result = await _test.archiveSupersededQuote(client, '111', '222');
  assert.equal(result, '111');
  assert.deepEqual(archived, ['111']);
});

test('an accepted, live or unknown quote is never archived', async () => {
  // Anything not on the archivable list must survive, INCLUDING statuses this code does not know
  // about, so a value HubSpot adds later fails safe. The list is an allowlist for exactly that
  // reason -- a denylist would archive tomorrow's new status by default.
  for (const status of ['ACCEPTED', 'VOID', 'APPROVED', 'EXPIRED', 'SOMETHING_NEW', undefined]) {
    const { client, archived } = quoteClient(status);
    const result = await _test.archiveSupersededQuote(client, '111', '222');
    assert.equal(result, null, `status ${status} must not be archived`);
    assert.deepEqual(archived, [], `status ${status} must not be archived`);
  }
});

// Widened 2026-08-30, and it had to be. Locked quotes now carry a real status, so DRAFT-only
// would have quietly stopped "Replace the existing quote" archiving anything at all -- the
// checkbox would look like it worked and do nothing.
//
// ACCEPTED is a live agreement and VOID is already terminal; neither is ours to archive.
test('a superseded quote awaiting or clear of approval is archived', async () => {
  for (const status of ['DRAFT', 'PENDING_APPROVAL', 'APPROVAL_NOT_NEEDED', 'REJECTED']) {
    const { client, archived } = quoteClient(status);
    const result = await _test.archiveSupersededQuote(client, '111', '222');
    assert.equal(result, '111', `status ${status} must be archived`);
    assert.deepEqual(archived, ['111'], `status ${status} must be archived`);
  }
});

test('the quote just created is never archived as its own predecessor', async () => {
  const { client, archived } = quoteClient('DRAFT');
  assert.equal(await _test.archiveSupersededQuote(client, '222', '222'), null);
  assert.equal(await _test.archiveSupersededQuote(client, '', '222'), null);
  assert.deepEqual(archived, []);
});

test('a failed archive does not fail the Lock in', async () => {
  const { client } = quoteClient('DRAFT', { archiveThrows: true });
  // Resolves rather than throwing: the new quote and the Deal are already correct at this point,
  // and a leftover draft is untidy rather than wrong.
  assert.equal(await _test.archiveSupersededQuote(client, '111', '222'), null);
});

// THE APPROVAL HANDOFF. HubSpot's approval workflow enrols on hs_status becoming
// PENDING_APPROVAL, filtered to CPQ_QUOTE templates. The calculator already decides whether a
// quote needs approval; before this it kept that to itself and left the quote at DRAFT, so the
// workflow had nothing to fire on.
//
// Values confirmed against portal 45023718 by reading the property definition, not from docs:
// DRAFT, PENDING_APPROVAL, REJECTED, APPROVED, APPROVAL_NOT_NEEDED, ACCEPTED, VOID.
test('the quote status reports whether approval is required', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'QuoteOptionsFunction.js'),
    'utf8',
  );
  // Exactly the portal's spellings. A near-miss here is an invalid enum value, which is what
  // emptied a Deal on 2026-08-28 when `units` was sent.
  assert.match(source, /const QUOTE_STATUS_PENDING_APPROVAL = 'PENDING_APPROVAL';/);
  assert.match(source, /const QUOTE_STATUS_APPROVAL_NOT_NEEDED = 'APPROVAL_NOT_NEEDED';/);

  // Driven off approvalTierRequired, the calculator's own answer -- not a second judgement.
  assert.match(
    source,
    /const needsApproval =\s*\n?\s*String\(option\.result\?\.approvalTierRequired \|\| 'none'\) !== 'none';/,
  );
  // DRAFT when no approval is needed, not APPROVAL_NOT_NEEDED. This portal has quote approvals
  // enabled, and APPROVAL_NOT_NEEDED is a PUBLISHED state -- an app must not route around its own
  // account's approval policy.
  assert.match(
    source,
    /needsApproval\s*\n?\s*\? QUOTE_STATUS_PENDING_APPROVAL\s*\n?\s*: QUOTE_STATUS_DRAFT/,
  );
  assert.match(source, /const QUOTE_STATUS_DRAFT = 'DRAFT';/);

  // NOT on the create. On an approvals-enabled portal HubSpot refuses to create a quote in a
  // published state at all:
  //
  //   400 VALIDATION_ERROR -- "Quote cannot be published without going through the pending
  //   approval state on an approvals enabled portal. Current status: <EMPTY>"
  //
  // That rejection loses the whole quote, so this is the assertion that keeps it from coming
  // back. The status is reached by the one legal transition, from DRAFT, after the create.
  const create = source.match(
    /quote = await client\.crm\.quotes\.basicApi\.create\(\{([\s\S]*?)\n      \},/,
  );
  assert.ok(create, 'the quote create call must be findable');
  assert.doesNotMatch(
    create[1],
    /hs_status:/,
    'hs_status must NOT be sent on the create -- an approvals-enabled portal refuses it',
  );

  // Read back and repaired if HubSpot drops it -- the same pattern as the Seller block, and for
  // the same reason: a workflow watches this field, so silently missing it means an approval
  // nobody is asked for.
  assert.match(source, /if \(quoteStatus !== desiredQuoteStatus\) \{/);
  assert.match(source, /quoteStatusRepaired = quoteStatus === desiredQuoteStatus;/);
  // ...and never fatal: the pricing is already correct and committed by this point.
  const repair = source.slice(source.indexOf('if (quoteStatus !== desiredQuoteStatus)'));
  assert.match(repair.slice(0, 1400), /catch \(error\) \{[\s\S]*?console\.error\(/);
});

// The quote is created with the deal owner as seller, and set to accept without a signature.
//
// print_and_sign is the API's DEFAULT and is not inherited from the quote template, which is why
// every generated quote came out "Print and sign" while the saved template said otherwise.
test('a generated quote carries the deal owner and the clickwrap acceptance method', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'QuoteOptionsFunction.js'),
    'utf8',
  );
  // Read off the source rather than the built object: generateQuote needs a whole portal to run,
  // and what matters here is that the two properties are on the create call at all.
  const create = source.match(
    /quote = await client\.crm\.quotes\.basicApi\.create\(\{([\s\S]*?)\n      \},/,
  );
  assert.ok(create, 'the quote create call must be findable');
  const body = create[1];

  assert.match(body, /hubspot_owner_id: dealOwnerId/, 'the seller must be the deal owner');
  assert.match(
    body,
    /hs_acceptance_method: QUOTE_ACCEPTANCE_METHOD/,
    'the acceptance method must be set, or HubSpot defaults it to print_and_sign',
  );
  // Guarded, because an empty string is not "no owner" to HubSpot.
  assert.match(body, /\.\.\.\(dealOwnerId\s*\n?\s*\?\s*\{/);
  // hs_quote_owner_id is HubSpot's "Quote sender", a DIFFERENT property from hubspot_owner_id.
  // Quote 42562905272 proved hs_sender_* is accepted and discarded on this quote model, so the
  // sender id is the remaining documented candidate and must actually be sent.
  assert.match(body, /hs_quote_owner_id: dealOwnerId,/, 'the quote sender must be set');

  // One of the three values HubSpot documents. clickwrap is "accept without signature".
  const method = source.match(/const QUOTE_ACCEPTANCE_METHOD = '([a-z_]+)';/);
  assert.ok(method, 'the acceptance method must be a named constant');
  assert.ok(
    ['clickwrap', 'esignature', 'print_and_sign'].includes(method[1]),
    `${method[1]} is not one of HubSpot's documented acceptance methods`,
  );
  assert.equal(method[1], 'clickwrap', 'Holly: quotes accept without a signature');

  // The owner has to be read before the Deal update overwrites what we read alongside it.
  assert.match(source, /'hubspot_owner_id',\n\s*\]\);/, 'the deal owner must be read');
});

// Replacing the previous quote is opt-in.
//
// Every Lock in creates a new quote -- generation is unconditional. Archiving the one it
// supersedes used to happen automatically, which made a Deal look like it had a single quote being
// edited in place when in fact the old one was being thrown away. Holly, 2026-08-28: default to
// creating a new one and leaving the old, with a checkbox beside Lock in to replace instead.
test('the superseded quote is only archived when the rep asked for it', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'QuoteOptionsFunction.js'),
    'utf8',
  );

  // Gated, not unconditional.
  assert.match(
    source,
    /if \(parameters\.replaceExistingQuote === true\) \{\s*\n\s*await archiveSupersededQuote\(/,
    'archiveSupersededQuote must be gated on the rep opting in',
  );

  // Strict === true, so anything absent or malformed keeps the old quote. The destructive
  // reading has to be the one that is asked for.
  assert.match(
    source,
    /replaceExistingQuote: parameters\.replaceExistingQuote === true,/,
    'the flag must be read strictly, defaulting to keeping the quote',
  );
  assert.doesNotMatch(
    source,
    /replaceExistingQuote: parameters\.replaceExistingQuote \|\|/,
    'a truthy coercion would let a stray value archive a quote',
  );
});

test('an absent or junk flag never archives', async () => {
  // The helper itself stays unconditional -- the gate is the caller's -- so this pins the
  // behaviour the gate depends on: called with no predecessor, it does nothing.
  const archived = [];
  const client = {
    crm: {
      quotes: {
        basicApi: {
          getById: async (id) => ({ id, properties: { hs_status: 'DRAFT' } }),
          archive: async (id) => archived.push(String(id)),
        },
      },
    },
  };
  assert.equal(await _test.archiveSupersededQuote(client, '', '222'), null);
  assert.equal(await _test.archiveSupersededQuote(client, undefined, '222'), null);
  assert.deepEqual(archived, []);
});

// A discount cannot be locked in without a reason.
//
// The reason is what the approver reads and what the Deal keeps as the record of why a concession
// was given. Holly, 2026-08-28. Enforced on the server as well as the card, because the card is
// not the only way in -- and ABOVE every write, because syncDealLineItems archives the Deal's line
// items before it creates replacements.
const discountedInput = (extra = {}) => ({
  startDate: '2026-09-01',
  termMonths: 12,
  paymentFrequency: 'monthly_in_advance',
  volumes: {
    connect_ca: 100,
    calendar_ca: 0,
    notetaker_bot_hours: 0,
    agent_accounts: 0,
    agent_email_thousands: 0,
    agent_storage_gb: 0,
    agent_bandwidth_gb: 0,
  },
  supportLevel: 'premium',
  onboardingPackage: 'strategic',
  addOns: ['privacy_filter'],
  professionalServices: ['gtm_review'],
  discretionaryDiscount: 0,
  autoRenewal: true,
  renewalTermMonths: 12,
  nonRenewalNoticeDays: 60,
  redliningRequested: false,
  nonStandardTerms: false,
  specialTerms: '',
  ...extra,
});

test('every discount surface is caught by the reason requirement', () => {
  // The guard tests result.largestDiscretionaryDiscount, so what matters is that a discount on
  // ANY surface raises it -- not just the deal-wide one.
  const surfaces = {
    'deal-wide': { discretionaryDiscount: 0.1 },
    product: { productDiscounts: { connect_ca: 0.6 } },
    'add-on': { addOnDiscounts: { privacy_filter: 0.5 } },
    support: { supportDiscount: 0.2 },
    onboarding: { onboardingDiscount: 0.3 },
    'professional services': { professionalServicesDiscount: 0.4 },
  };
  for (const [name, extra] of Object.entries(surfaces)) {
    const result = calculateQuote(discountedInput(extra));
    assert.ok(
      result.largestDiscretionaryDiscount > 0,
      `a ${name} discount must raise largestDiscretionaryDiscount or the guard misses it`,
    );
  }
  assert.equal(calculateQuote(discountedInput()).largestDiscretionaryDiscount, 0);
});

test('the discount reason guard runs before anything is written', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'QuoteOptionsFunction.js'),
    'utf8',
  );
  const lock = source.slice(source.indexOf('const lockLiveCalculation'));
  const guard = lock.indexOf("throw new Error('DISCOUNT_REASON_REQUIRED')");
  const firstWrite = lock.indexOf('await syncDealLineItems(');
  assert.ok(guard > 0, 'the guard must exist');
  assert.ok(firstWrite > 0, 'the line item sync must be findable');
  assert.ok(
    guard < firstWrite,
    'the guard must run BEFORE syncDealLineItems, which archives before it creates',
  );
  // Whitespace is not a reason.
  assert.match(source, /String\(parameters\.discountReason \|\| ''\)\.trim\(\) === ''/);
});

// The stored discount reason must come back to the card.
//
// It was write-only -- sent on Lock in, written to pricing_discount_reason, never returned.
// Harmless while the field was optional. The moment a reason became REQUIRED (2026-08-28), every
// card reload emptied the box and disabled Lock in until the rep retyped a reason the Deal already
// had. The requirement and the read-back have to ship together.
test('the deal read returns the stored discount reason', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'QuoteOptionsFunction.js'),
    'utf8',
  );
  // Asked for in the read...
  const read = source.match(/'pricing_quote_content_hash',[\s\S]{0,400}?\]\);/);
  assert.ok(read, 'the deal property read must be findable');
  assert.match(
    read[0],
    /'pricing_discount_reason',/,
    'pricing_discount_reason must be requested, or the read returns it as undefined',
  );
  // ...and handed back to the card.
  assert.match(
    source,
    /discountReason: deal\.properties\.pricing_discount_reason \|\| '',/,
    'the read must return discountReason to the card',
  );
});

// The Seller block on the printed quote comes from hs_sender_*, not from the owner.
//
// Setting hubspot_owner_id alone left it blank -- confirmed on a real quote, 2026-08-28. The owner
// is the CRM record's owner; hs_sender_* is what the customer reads. Both are needed.
const ownerClient = (owner, { throws = false } = {}) => ({
  crm: {
    owners: {
      ownersApi: {
        getById: async (id) => {
          if (throws) throw new Error('owner not found');
          return { id, ...owner };
        },
      },
    },
  },
});

test('the Seller block is filled from the deal owner', async () => {
  const properties = await _test.senderProperties(
    ownerClient({ firstName: 'Holly', lastName: 'Holbrook', email: 'holly.holbrook@nylas.com' }),
    '12345',
  );
  assert.deepEqual(properties, {
    hs_sender_firstname: 'Holly',
    hs_sender_lastname: 'Holbrook',
    hs_sender_email: 'holly.holbrook@nylas.com',
  });
});

test('an unreadable owner leaves the Seller block alone rather than blanking it', async () => {
  // Blank strings would REPLACE whatever the template supplies with nothing, which is worse than
  // not writing at all. Every one of these must come back empty, not partially filled.
  assert.deepEqual(await _test.senderProperties(ownerClient({}, { throws: true }), '12345'), {});
  assert.deepEqual(await _test.senderProperties(ownerClient({}), '12345'), {});
  assert.deepEqual(await _test.senderProperties(ownerClient({}), ''), {});
  assert.deepEqual(
    await _test.senderProperties(ownerClient({ firstName: '', lastName: '', email: '' }), '1'),
    {},
  );
});

test('a partial owner record sends only the fields it has', async () => {
  const properties = await _test.senderProperties(
    ownerClient({ firstName: 'Holly', lastName: '', email: 'holly.holbrook@nylas.com' }),
    '12345',
  );
  assert.deepEqual(properties, {
    hs_sender_firstname: 'Holly',
    hs_sender_email: 'holly.holbrook@nylas.com',
  });
  assert.equal('hs_sender_lastname' in properties, false, 'an empty last name must not be sent');
});

test('the quote create carries the sender properties', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'QuoteOptionsFunction.js'),
    'utf8',
  );
  const create = source.match(
    /quote = await client\.crm\.quotes\.basicApi\.create\(\{([\s\S]*?)\n      \},/,
  );
  assert.ok(create, 'the quote create call must be findable');
  assert.match(create[1], /\.\.\.sender,/, 'the sender block must reach the create call');
  // Resolved before the try, so a failure cannot leave a half-made quote behind.
  const senderLine = source.indexOf('const sender = await senderProperties(');
  const createLine = source.indexOf('quote = await client.crm.quotes.basicApi.create(');
  assert.ok(senderLine > 0 && senderLine < createLine);
});

// Two unrelated reads must not share a failure.
//
// The owner read was bundled into the same try/catch as pricing_latest_quote_id -- a custom
// property this portal may not have. A failure reading that one silently produced an empty OWNER
// too, so the Seller block came out blank with no error anywhere. 2026-08-28.
test('a failed superseded-quote read does not blank the deal owner', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'QuoteOptionsFunction.js'),
    'utf8',
  );
  const generate = source.slice(source.indexOf('const generateQuote'));
  const supersededRead = generate.indexOf("'pricing_latest_quote_id',");
  const ownerRead = generate.indexOf("'hubspot_owner_id',");
  assert.ok(supersededRead > 0 && ownerRead > 0, 'both reads must exist');

  // They must be separate getById calls, not one shared list.
  const between = generate.slice(supersededRead, ownerRead);
  assert.match(
    between,
    /catch \(error\)[\s\S]*?getById/,
    'the owner must be read in its own call, after its own catch',
  );

  // And a silent catch is what hid this for three rounds.
  assert.doesNotMatch(
    generate.slice(0, ownerRead + 200),
    /\} catch \{\s*\n\s*supersededQuoteId = '';/,
    'the swallow-everything catch must not come back',
  );
});

// A line item's fee properties are read back and repaired if HubSpot did not keep them.
//
// One professional-services line came back missing one_time_fees while four identical siblings
// kept it, so the Order Form printed a dash and understated an $8,800 bundle by $1,760. Two
// attempts to find the cause by reasoning failed. This stops reasoning: verify the write.
const lineItemClient = (stored, { updateThrows = false, getThrows = false } = {}) => {
  const patched = [];
  return {
    patched,
    client: {
      crm: {
        lineItems: {
          batchApi: {
            read: async ({ inputs }) => {
              if (getThrows) throw new Error('gone');
              return { results: inputs.map(({ id }) => ({ id, properties: stored })) };
            },
            update: async ({ inputs }) => {
              if (updateThrows) throw new Error('read-only');
              for (const { id, properties } of inputs) {
                patched.push({ id: String(id), ...properties });
              }
            },
          },
        },
      },
    },
  };
};

const sentFees = {
  price: '1760',
  one_time_fees: '1760',
  recurring_fees: '0',
  total_fees_for_term: '1760',
};

test('a fee property HubSpot dropped is patched back', async () => {
  // Exactly the observed shape: total_fees_for_term kept, one_time_fees missing.
  const { client, patched } = lineItemClient({
    one_time_fees: '',
    recurring_fees: '0',
    total_fees_for_term: '1760',
  });
  const repaired = await _test.repairLineItemsBatch(client, [{ id: 'li-1', sent: sentFees }]);
  assert.deepEqual(repaired, ['li-1']);
  assert.deepEqual(patched, [{ id: 'li-1', one_time_fees: '1760' }]);
});

test('a line item that kept everything is left alone', async () => {
  const { client, patched } = lineItemClient({
    one_time_fees: '1760',
    recurring_fees: '0',
    total_fees_for_term: '1760',
  });
  assert.deepEqual(await _test.repairLineItemsBatch(client, [{ id: 'li-2', sent: sentFees }]), []);
  assert.deepEqual(patched, [], 'no write when nothing is missing');
});

test('only fee properties are verified, and only ones actually sent', async () => {
  const { client, patched } = lineItemClient({ one_time_fees: '' });
  // price is not a fee property; a metered line sends no fee properties at all.
  assert.deepEqual(
    await _test.repairLineItemsBatch(client, [{ id: 'li-3', sent: { price: '1.36' } }]),
    [],
  );
  assert.deepEqual(patched, []);
});

test('a failed verify or repair never fails the lock', async () => {
  const missing = { one_time_fees: '', recurring_fees: '0', total_fees_for_term: '1760' };
  const read = lineItemClient(missing, { getThrows: true });
  assert.deepEqual(
    await _test.repairLineItemsBatch(read.client, [{ id: 'li-4', sent: sentFees }]),
    [],
  );
  const write = lineItemClient(missing, { updateThrows: true });
  assert.deepEqual(
    await _test.repairLineItemsBatch(write.client, [{ id: 'li-5', sent: sentFees }]),
    [],
  );
});

// A batch fails as ONE unit, so a property the portal does not have cannot be dropped from just
// the line whose name appeared in the message -- it has to come off every input.
test('a property this portal lacks is dropped from EVERY input, then the batch is retried', async () => {
  const attempts = [];
  const client = {
    crm: {
      lineItems: {
        batchApi: {
          create: async ({ inputs }) => {
            attempts.push(inputs.map(({ properties }) => Object.keys(properties).sort().join(',')));
            if (inputs.some(({ properties }) => properties.proposed_rate != null)) {
              const error = new Error('PROPERTY_DOESNT_EXIST');
              error.code = 400;
              error.body = { message: 'Property "proposed_rate" does not exist' };
              throw error;
            }
            return { results: inputs.map((_input, index) => ({ id: `li-${index}`, properties: {} })) };
          },
        },
      },
    },
  };
  const createdIds = [];
  const results = await _test.createLineItemsBatch(
    client,
    [
      { properties: { price: '1', proposed_rate: '1' }, associations: [] },
      { properties: { price: '2', proposed_rate: '2' }, associations: [] },
    ],
    createdIds,
  );
  assert.equal(results.length, 2);
  assert.equal(attempts.length, 2, 'one refused batch, then one retry');
  assert.deepEqual(attempts[1], ['price', 'price'], 'dropped from BOTH inputs, not just one');
  assert.deepEqual(createdIds, ['li-0', 'li-1']);
});

// A batch refused for a reason we do not recognise must not cost the whole quote. Per-item is
// where the bundle fallback and the single-property drop still live.
test('a batch refused for an unrecognised reason falls back to one create per line item', async () => {
  const perItem = [];
  const client = {
    crm: {
      lineItems: {
        batchApi: {
          create: async () => {
            const error = new Error('nope');
            error.code = 400;
            error.body = { message: 'something else entirely' };
            throw error;
          },
        },
        basicApi: {
          create: async ({ properties }) => {
            perItem.push(properties.price);
            return { id: `li-${perItem.length}` };
          },
        },
      },
    },
  };
  const createdIds = [];
  const results = await _test.createLineItemsBatch(
    client,
    [
      { properties: { price: '1' }, associations: [] },
      { properties: { price: '2' }, associations: [] },
    ],
    createdIds,
  );
  assert.deepEqual(perItem, ['1', '2'], 'every line item was created individually');
  assert.deepEqual(results.map(({ id }) => id), ['li-1', 'li-2'], 'results stay in input order');
  assert.deepEqual([...createdIds].sort(), ['li-1', 'li-2'], 'ids recorded for the rollback');
});

// The repair patches by id. Patching the WRONG record would be worse than not patching at all, so
// a join that cannot be verified is abandoned and the repair is skipped.
test('the join back to what was sent is abandoned rather than guessed', () => {
  const sent = [
    { properties: { hs_product_id: 'p1', one_time_fees: '10' } },
    { properties: { hs_product_id: 'p2', one_time_fees: '20' } },
  ];
  assert.equal(
    _test.joinCreatedLineItems(sent, [{ id: 'a', properties: { hs_product_id: 'p1' } }]),
    null,
    'a short result set must not be joined by position',
  );
  assert.equal(
    _test.joinCreatedLineItems(sent, [
      { id: 'a', properties: { hs_product_id: 'p2' } },
      { id: 'b', properties: { hs_product_id: 'p1' } },
    ]),
    null,
    'a reordered result set must not be joined by position',
  );
  // A LONGER result set is the case the count guard exists for on its own: every position lines
  // up, so nothing else notices, and the extra record means the correspondence is not what it
  // looks like.
  assert.equal(
    _test.joinCreatedLineItems(sent, [
      { id: 'a', properties: { hs_product_id: 'p1' } },
      { id: 'b', properties: { hs_product_id: 'p2' } },
      { id: 'c', properties: { hs_product_id: 'p3' } },
    ]),
    null,
    'a result set with more records than were sent must not be joined',
  );
  assert.deepEqual(
    _test.joinCreatedLineItems(sent, [
      { id: 'a', properties: { hs_product_id: 'p1' } },
      { id: 'b', properties: { hs_product_id: 'p2' } },
    ]),
    [
      { id: 'a', sent: sent[0].properties },
      { id: 'b', sent: sent[1].properties },
    ],
  );
});

test('BOTH surfaces verify every line item they create', () => {
  // The quote has its OWN line items, separate records from the Deal's, and the printed Order Form
  // renders from those. The verify-and-repair originally went on the Deal sync only, so the
  // surface the customer actually reads stayed unchecked and a dropped one_time_fees still printed
  // as a dash. Both loops, or the fix is decorative.
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'QuoteOptionsFunction.js'),
    'utf8',
  );
  const calls = source.match(/await repairLineItemsBatch\(/g) || [];
  assert.equal(calls.length, 2, 'the Deal sync AND the quote line items must both verify');

  const dealLoop = source.slice(source.indexOf('const syncDealLineItems'));
  // 3000, not 2000: the rollback invariant now carries a comment explaining why it is a flag
  // rather than a count, which pushed the repair call past the old window.
  assert.match(dealLoop.slice(0, 3000), /await repairLineItemsBatch\(/, 'Deal sync verifies');

  const quoteLoop = source.slice(source.indexOf('The quote owns its line items'));
  assert.match(quoteLoop.slice(0, 4000), /await repairLineItemsBatch\(/, 'quote loop verifies');
});

test('the sync verifies every line item it creates', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'QuoteOptionsFunction.js'),
    'utf8',
  );
  const sync = source.slice(source.indexOf('const syncDealLineItems'));
  assert.match(
    sync,
    /const created = await createLineItemsBatch\(client, sending, createdIds\);[\s\S]{0,200}?await repairLineItemsBatch\(/,
    'every created line item must be read back',
  );
});

test('the quote Seller block is read back and set again if the create dropped it', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'QuoteOptionsFunction.js'),
    'utf8',
  );
  // The read-back must ask for the sender fields, or "missing" is always true.
  assert.match(source, /'hs_status',\s*\n\s*\.\.\.Object\.keys\(sender\),/);
  assert.match(source, /const senderMissing = Object\.entries\(sender\)\.filter\(/);
  assert.match(source, /await client\.crm\.quotes\.basicApi\.update\(String\(quote\.id\), \{/);
});

// The card is offered only the templates chosen in Settings -- narrowed per QUOTE KIND.
test('the template picker is narrowed per kind, and never left empty', () => {
  const settings = normalizeSettings({
    ...defaultSettings(),
    allowNewBusiness: true,
    allowRenewals: true,
    quoteTemplatesByKind: {
      new_business: { enabledIds: ['567553820432'], defaultId: '567553820432' },
      change: { enabledIds: ['583243623796'], defaultId: '583243623796' },
      renewal: { enabledIds: ['583243745379'], defaultId: '583243745379' },
    },
  });
  const all = [
    { id: '567553820432', name: 'New business' },
    { id: '583243623796', name: 'Change' },
    { id: '583243745379', name: 'Renewal' },
  ];

  // Each kind sees only its own template. Decision #1, Holly 2026-08-30: 583243623796 is CHANGE.
  assert.deepEqual(_test.offeredQuoteTemplates(all, settings, 'change'), [all[1]]);
  assert.deepEqual(_test.offeredQuoteTemplates(all, settings, 'renewal'), [all[2]]);
  assert.deepEqual(_test.offeredQuoteTemplates(all, settings, 'new_business'), [all[0]]);
  assert.equal(_test.defaultQuoteTemplateFor(settings, 'change'), '583243623796');
  assert.equal(_test.defaultQuoteTemplateFor(settings, 'renewal'), '583243745379');

  // An empty choice still means "all" -- an unconfigured kind must not empty the picker.
  const unconfigured = normalizeSettings({ ...defaultSettings(), allowRenewals: true });
  assert.deepEqual(_test.offeredQuoteTemplates(all, unconfigured, 'change'), all);

  // A chosen template the portal no longer has must not empty it either: everything comes back.
  const stale = normalizeSettings({
    ...defaultSettings(),
    quoteTemplatesByKind: {
      new_business: { enabledIds: [], defaultId: '' },
      change: { enabledIds: ['999999999999'], defaultId: '' },
      renewal: { enabledIds: [], defaultId: '' },
    },
  });
  assert.deepEqual(_test.offeredQuoteTemplates(all, stale, 'change'), all);
});

// THE TEMPLATE DECIDES THE KIND. There is no separate Quote Type control -- one existed briefly
// and let the two disagree on screen: Quote Type "Change" beside the New Business template. The
// template is what actually prints, so it is the input and the kind is read off it.
test('a deal is handed one merged template list plus which kind claims each', () => {
  const settings = normalizeSettings({
    ...defaultSettings(),
    allowRenewals: true,
    quoteTemplatesByKind: {
      new_business: { enabledIds: ['567553820432'], defaultId: '567553820432' },
      change: { enabledIds: ['583243623796'], defaultId: '583243623796' },
      renewal: { enabledIds: ['583243745379'], defaultId: '583243745379' },
    },
  });
  const all = [
    { id: '567553820432', name: 'New business' },
    { id: '583243623796', name: 'Change' },
    { id: '583243745379', name: 'Renewal' },
  ];

  // A renewal Deal sees BOTH its documents in one list -- no toggle to get from one to the other.
  const renewal = _test.quoteTemplatesForCategory(all, settings, 'renewal');
  assert.deepEqual(
    renewal.templates.map(({ id }) => id),
    ['583243623796', '583243745379'],
  );
  // ...and the new-business template is not among them, because its kind is not one a renewal
  // Deal can quote.
  assert.equal(renewal.templates.some(({ id }) => id === '567553820432'), false);
  // The claim map is what tells the card whether a contract applies.
  assert.deepEqual(renewal.templateKinds, {
    '583243623796': 'change',
    '583243745379': 'renewal',
  });

  // A template listed under BOTH kinds is claimed by the FIRST, deterministically. Without that
  // rule the label a rep sees would depend on object key order.
  const shared = normalizeSettings({
    ...defaultSettings(),
    allowRenewals: true,
    quoteTemplatesByKind: {
      new_business: { enabledIds: [], defaultId: '' },
      change: { enabledIds: ['583243623796'], defaultId: '' },
      renewal: { enabledIds: ['583243623796', '583243745379'], defaultId: '' },
    },
  });
  const merged = _test.quoteTemplatesForCategory(all, shared, 'renewal');
  assert.equal(merged.templateKinds['583243623796'], 'change', 'first kind claims it');
  assert.equal(merged.templateKinds['583243745379'], 'renewal');
  // ...and it appears once in the list, not twice.
  assert.deepEqual(
    merged.templates.map(({ id }) => id),
    ['583243623796', '583243745379'],
  );

  const newBusiness = _test.quoteTemplatesForCategory(all, settings, 'new_business');
  assert.deepEqual(newBusiness.templates.map(({ id }) => id), ['567553820432']);
  assert.deepEqual(newBusiness.templateKinds, { '567553820432': 'new_business' });
});

test('the kind is looked up from the template, and only among the kinds the category allows', () => {
  const settings = normalizeSettings({
    ...defaultSettings(),
    allowRenewals: true,
    quoteTemplatesByKind: {
      new_business: { enabledIds: ['567553820432'], defaultId: '' },
      change: { enabledIds: ['583243623796'], defaultId: '' },
      renewal: { enabledIds: ['583243745379'], defaultId: '' },
    },
  });
  assert.equal(_test.quoteKindForTemplate(settings, 'renewal', '583243623796'), 'change');
  assert.equal(_test.quoteKindForTemplate(settings, 'renewal', '583243745379'), 'renewal');
  assert.equal(
    _test.quoteKindForTemplate(settings, 'new_business', '567553820432'),
    'new_business',
  );

  // A new-business Deal cannot produce a change quote, whatever template id arrives. Otherwise a
  // stale card could make one ask for a contract that does not apply.
  assert.equal(_test.quoteKindForTemplate(settings, 'new_business', '583243623796'), null);
  // A template no kind claims -- normal on a portal where Settings has not assigned them yet.
  assert.equal(_test.quoteKindForTemplate(settings, 'renewal', '999999999999'), null);
  assert.equal(_test.quoteKindForTemplate(settings, 'renewal', ''), null);
});

// A contract applies to the DOCUMENT, not to the pipeline. A renewal-pipeline Deal quoting from
// the new-business template is a new-business document and has no contract to point at.
test('a contract applies only to a change or renewal template', () => {
  assert.equal(_test.contractApplies('change'), true);
  assert.equal(_test.contractApplies('renewal'), true);
  assert.equal(_test.contractApplies('new_business'), false);
  // Unclaimed template: nothing is asked for. The contract picker appears once an admin assigns
  // the change and renewal templates in Settings, not before.
  assert.equal(_test.contractApplies(null), false);
  assert.equal(_test.contractApplies(undefined), false);
});

// What gets RECORDED on a locked option, which must never be blank.
test('the recorded kind falls back rather than leaving an option kindless', () => {
  const settings = normalizeSettings({
    ...defaultSettings(),
    allowRenewals: true,
    quoteTemplatesByKind: {
      new_business: { enabledIds: [], defaultId: '' },
      change: { enabledIds: ['583243623796'], defaultId: '' },
      renewal: { enabledIds: ['583243745379'], defaultId: '' },
    },
  });
  // The template wins.
  assert.equal(_test.resolveQuoteKind(settings, 'renewal', '583243745379', null), 'renewal');
  // Then what the option already carried, so a reload does not silently relabel it.
  assert.equal(
    _test.resolveQuoteKind(settings, 'renewal', '999999999999', { quoteKind: 'renewal' }),
    'renewal',
  );
  // Then the category's first kind. Never null.
  assert.equal(_test.resolveQuoteKind(settings, 'renewal', '999999999999', null), 'change');
  assert.equal(_test.resolveQuoteKind(settings, 'new_business', '', null), 'new_business');
  // A stored kind the category does not allow is refused, not carried through.
  assert.equal(
    _test.resolveQuoteKind(settings, 'new_business', '', { quoteKind: 'change' }),
    'new_business',
  );
});

// The settings screen is where the narrowing is CHOSEN, so it must see every template.
test('the settings screen is not narrowed', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'QuoteOptionsFunction.js'),
    'utf8',
  );
  assert.match(
    source,
    /quoteTemplates: await usableQuoteTemplates\(getClient\(\)\)/,
    'the settings screen must see every template',
  );
  // The card list is narrowed by the resolved category, not by anything the card asserted.
  assert.match(source, /templateKinds: listTemplates\.templateKinds/);
  assert.match(
    source,
    /const listCategory = dealCategory\(settings, state\.dealType, state\.pipelineId\);/,
  );
  // No Quote Type parameter survives anywhere: the card must not be able to state a kind.
  assert.equal(
    /parameters\.quoteKind/.test(source),
    false,
    'the kind must come from the template, never from the card',
  );
});

// CONTRACTS. Read-only, dated path, and gated on a scope this app may not have yet.
// on: 'company' (default) or 'deal' -- which record the contracts hang off. portalHasContracts
// answers the probe made only when nothing is associated.
const contractClient = ({
  contractIds = [],
  details = null,
  fail = null,
  companyId = 'co-1',
  on = 'company',
  portalHasContracts = false,
  // This portal answers POST .../batch/read with 200-and-empty for real ids. Set true to
  // reproduce that and prove the single-record fallback carries the load.
  batchReadIsBlind = false,
  // This portal answers the per-id GET with nothing too, so only the LIST works. Set true to
  // reproduce that and prove the list-and-filter strategy carries it.
  singleReadIsBlind = false,
  // The portal's real object type id for contracts, answered by the schema endpoints. Set it to
  // reproduce a portal where 'contracts' resolves for associations but not for the objects API.
  schemaObjectTypeId = null,
  // Reads REFUSED (403) rather than answered-empty. The one fact that separates "the token is
  // not scoped for contracts" from "the object has nothing to give".
  readsAreRefused = false,
  // ONLY the per-id GET is refused. Batch and list answer emptily. This isolates the per-id catch,
  // which is where builds 4-7 lost the 403 -- it warned per id and moved on.
  singleReadIsRefused = false,
  // Which candidate object path actually holds the records. Defaults to the first one tried; set
  // it to the second to prove the probe does not stop at the first path that merely ANSWERS.
  recordsOnPath = '/crm/v3/objects/0-721',
}) => ({
  crm: {
    associations: {
      v4: {
        basicApi: {
          getPage: async (fromType, _id, toType) => {
            if (fail === 'associations' && String(toType).startsWith('contract')) {
              throw fail403();
            }
            if (toType === 'companies') {
              return { results: companyId ? [{ toObjectId: companyId }] : [] };
            }
            if (toType === 'contracts') {
              const here = fromType === 'deals' ? 'deal' : 'company';
              return {
                results:
                  on === 'both' || here === on
                    ? contractIds.map((id) => ({ toObjectId: id }))
                    : [],
              };
            }
            return { results: [] };
          },
        },
      },
    },
  },
  apiRequest: async ({ method, path, body }) => {
    if (fail === 'read') throw fail403();
    // The portal-wide probe: a GET, not the batch-read POST.
    // A single-record read: GET /<path>/<id>?properties=... Checked BEFORE the list probe below,
    // because both are GETs and the probe would otherwise answer for them.
    const single = String(path).match(/\/([^/?]+)\?properties=/);
    if (readsAreRefused && (method === 'POST' || single)) throw fail403();
    if (singleReadIsRefused && single) throw fail403();
    if (method === 'GET' && single) {
      if (singleReadIsBlind) return { json: async () => ({}) };
      const byIdSingle = Object.fromEntries((details || []).map((c) => [String(c.id), c]));
      if (!String(path).startsWith(recordsOnPath)) {
        throw Object.assign(new Error('Not found'), { code: 404 });
      }
      // An id the object does not have answers 200 with no record rather than throwing. Some
      // HubSpot endpoints do exactly this, and a bodyless 200 must not be counted as a contract.
      if (!byIdSingle[single[1]]) return { json: async () => ({}) };
      const contract = byIdSingle[single[1]];
      return {
        json: async () => ({
          id: contract.id,
          properties:
            fail === 'no_status'
              ? { ...contract.properties, hs_status: undefined }
              : contract.properties,
        }),
      };
    }
    // The schema endpoints, asked only when every documented path has already come back empty.
    if (method === 'GET' && /\/schemas$/.test(String(path))) {
      if (!schemaObjectTypeId) return { json: async () => ({ results: [] }) };
      return {
        json: async () => ({
          results: [
            // A decoy FIRST, so "take the first schema" is not mistaken for "find the contracts
            // one". A portal's schema list is not ordered for our convenience.
            { objectTypeId: '2-999', name: 'subscription', labels: { plural: 'Subscriptions' } },
            { objectTypeId: schemaObjectTypeId, name: 'contract', labels: { plural: 'Contracts' } },
          ],
        }),
      };
    }
    // A LIST read: GET /<path>?limit=100&properties=...
    if (method === 'GET' && /[?&]limit=100/.test(String(path))) {
      if (!String(path).startsWith(recordsOnPath)) return { json: async () => ({ results: [] }) };
      return {
        json: async () => ({
          results: (details || []).map((c) => ({ id: c.id, properties: c.properties })),
        }),
      };
    }
    if (method === 'GET') {
      if (fail === 'probe') throw fail403();
      // Only ONE candidate path answers with records, so the probe's path selection is actually
      // exercised rather than every path looking alike.
      const answers =
        portalHasContracts && String(path).startsWith(recordsOnPath);
      return { json: async () => ({ results: answers ? [{ id: 'somewhere' }] : [] }) };
    }
    if (fail === 'no_status' && (body?.properties || []).includes('hs_status')) {
      const error = new Error('Property "hs_status" does not exist');
      error.code = 400;
      throw error;
    }
    // Echo the ids ACTUALLY requested, one result each. Returning `details` wholesale regardless
    // of the input made the mock de-duplicate on the app's behalf, so a duplicate id in the batch
    // read was invisible to every test.
    const byId = Object.fromEntries((details || []).map((c) => [String(c.id), c]));
    // The batch read only answers on the path that holds the records -- and, when this portal's
    // behaviour is being reproduced, not even then.
    if (batchReadIsBlind || !String(path).startsWith(recordsOnPath)) {
      return { json: async () => ({ results: [] }) };
    }
    return {
      json: async () => ({
        results: (body?.inputs || [])
          .map(({ id }) => byId[String(id)])
          .filter(Boolean)
          .map((c) =>
            fail === 'no_status'
              ? { ...c, properties: { ...c.properties, hs_status: undefined } }
              : c,
          ),
      }),
    };
  },
});

const fail403 = () => {
  const error = new Error('Forbidden');
  error.code = 403;
  return error;
};

test('contracts are read from the Deal AND its company, newest effective date first', async () => {
  const client = contractClient({
    contractIds: ['c-1', 'c-2'],
    details: [
      { id: 'c-1', properties: { hs_name: 'Acme MSA 2024', hs_contract_effective_date: '2024-01-01' } },
      { id: 'c-2', properties: { hs_name: 'Acme MSA 2025', hs_contract_effective_date: '2025-06-15' } },
    ],
  });
  const result = await _test.contractOptions(client, 'deal-1');
  assert.equal(result.contractSource, 'company');
  assert.equal(result.contractsUnavailable, null);

  // The SAME contracts hanging off the DEAL instead must be found too. Reading only the company
  // is what made a real contract ("COVIS 2026 Manual Renewal") invisible on 2026-08-30.
  const onDeal = await _test.contractOptions(
    contractClient({
      on: 'deal',
      contractIds: ['c-1', 'c-2'],
      details: [
        { id: 'c-1', properties: { hs_name: 'Acme MSA 2024', hs_contract_effective_date: '2024-01-01' } },
        { id: 'c-2', properties: { hs_name: 'Acme MSA 2025', hs_contract_effective_date: '2025-06-15' } },
      ],
    }),
    'deal-1',
  );
  assert.equal(onDeal.contractSource, 'deal');
  assert.deepEqual(onDeal.contracts.map(({ id }) => id), ['c-2', 'c-1']);

  // The SAME contract associated to BOTH the Deal and its company appears ONCE. Unioning the two
  // reads without de-duplicating would show a rep the same contract twice, with no way to tell
  // which to pick.
  const onBoth = await _test.contractOptions(
    contractClient({
      on: 'both',
      contractIds: ['c-1', 'c-2'],
      details: [
        { id: 'c-1', properties: { hs_name: 'Acme MSA 2024', hs_contract_effective_date: '2024-01-01' } },
        { id: 'c-2', properties: { hs_name: 'Acme MSA 2025', hs_contract_effective_date: '2025-06-15' } },
      ],
    }),
    'deal-1',
  );
  assert.deepEqual(onBoth.contracts.map(({ id }) => id), ['c-2', 'c-1'], 'no duplicates');
  assert.deepEqual(
    result.contracts.map(({ id }) => id),
    ['c-2', 'c-1'],
    'newest effective date first',
  );
  // The date is part of the LABEL: it is what tells two contracts for the same customer apart.
  assert.equal(result.contracts[0].label, 'Acme MSA 2025 — effective 2025-06-15');
  // A nameless contract must still be pickable.
  const nameless = await _test.contractOptions(
    contractClient({ contractIds: ['c-9'], details: [{ id: 'c-9', properties: {} }] }),
    'deal-1',
  );
  assert.equal(nameless.contracts[0].label, 'Contract c-9');
});

// hs_status carries the contract status, and its four values are confirmed from HubSpot's
// Contracts API beta docs (Holly, 2026-08-30): DRAFT, ACTIVE, COMPLETED, TERMINATED.
test('only contracts a change or renewal can point at are offered', () => {
  assert.equal(_test.isQuotableContract('ACTIVE'), true);
  assert.equal(_test.isQuotableContract('DRAFT'), true, 'DRAFT is a future-dated contract');
  assert.equal(_test.isQuotableContract('COMPLETED'), false);
  assert.equal(_test.isQuotableContract('TERMINATED'), false);
  // Case-insensitive: this is read off a CRM record, not the commerce API that documents the
  // enum, so a portal storing 'Active' must not silently show nothing.
  assert.equal(_test.isQuotableContract('active'), true);
  assert.equal(_test.isQuotableContract(' Active '), true);
  // A substring match would call these active. 'inactive' means the opposite.
  assert.equal(_test.isQuotableContract('inactive'), false);
  assert.equal(_test.isQuotableContract('not active'), false);
  assert.equal(_test.isQuotableContract(''), false);
  assert.equal(_test.isQuotableContract(undefined), false);
});

test('finished contracts are hidden, ACTIVE outranks DRAFT, newest first within each', async () => {
  const client = contractClient({
    contractIds: ['done', 'draft', 'live', 'older-live', 'killed'],
    details: [
      { id: 'done', properties: { hs_name: 'Done', hs_status: 'COMPLETED', hs_contract_effective_date: '2026-05-01' } },
      { id: 'draft', properties: { hs_name: 'Upcoming', hs_status: 'DRAFT', hs_contract_effective_date: '2026-11-01' } },
      { id: 'live', properties: { hs_name: 'Live', hs_status: 'ACTIVE', hs_contract_effective_date: '2025-01-01' } },
      { id: 'older-live', properties: { hs_name: 'Older', hs_status: 'ACTIVE', hs_contract_effective_date: '2024-01-01' } },
      { id: 'killed', properties: { hs_name: 'Killed', hs_status: 'TERMINATED', hs_contract_effective_date: '2026-06-01' } },
    ],
  });
  const { contracts } = await _test.contractOptions(client, 'deal-1');
  assert.deepEqual(
    contracts.map(({ id }) => id),
    ['live', 'older-live', 'draft'],
    'ACTIVE first by date, then DRAFT; COMPLETED and TERMINATED hidden',
  );
  // Even though COMPLETED and TERMINATED have the NEWEST effective dates -- status outranks date.
  assert.equal(contracts.some(({ id }) => id === 'done' || id === 'killed'), false);
  // The status is on the option, so a rep can see a DRAFT is not active yet.
  assert.equal(contracts[2].label, 'Upcoming — DRAFT — effective 2026-11-01');
});

// The picker must never go empty because everything happens to be finished. That reads as "this
// company has no contracts", which is a different answer and a wrong one.
test('a company whose contracts are all finished still sees them', async () => {
  const client = contractClient({
    contractIds: ['done', 'killed'],
    details: [
      { id: 'done', properties: { hs_name: 'Done', hs_status: 'COMPLETED', hs_contract_effective_date: '2025-05-01' } },
      { id: 'killed', properties: { hs_name: 'Killed', hs_status: 'TERMINATED', hs_contract_effective_date: '2026-06-01' } },
    ],
  });
  const { contracts, contractsUnavailable } = await _test.contractOptions(client, 'deal-1');
  assert.equal(contractsUnavailable, null);
  assert.deepEqual(contracts.map(({ id }) => id), ['killed', 'done']);
});

// hs_status is not documented, so a portal without it must degrade to a working picker rather
// than a 400 that empties it. Same reasoning as createLineItem's dropped-property retry.
test('a portal without hs_status still lists its contracts', async () => {
  const client = contractClient({
    fail: 'no_status',
    contractIds: ['c-1'],
    details: [
      { id: 'c-1', properties: { hs_name: 'Acme MSA', hs_contract_effective_date: '2025-01-01' } },
    ],
  });
  const { contracts, contractsUnavailable } = await _test.contractOptions(client, 'deal-1');
  assert.equal(contractsUnavailable, null, 'a missing hs_status is not an unavailable list');
  assert.equal(contracts.length, 1);
  assert.equal(contracts[0].label, 'Acme MSA — effective 2025-01-01');
});

// The reason an empty list is empty has to survive to the card. Without it, "nobody added the
// scope" and "this customer has no contracts" look identical and need opposite responses.
test('an empty contract list says why it is empty', async () => {
  assert.equal(_test.contractUnavailableReason(fail403()), 'scope_missing');
  const notSupported = new Error('Bad Request');
  notSupported.code = 400;
  assert.equal(_test.contractUnavailableReason(notSupported), 'not_supported');
  assert.equal(_test.contractUnavailableReason(new Error('boom')), 'error');

  // Missing scope on the association read.
  // Every candidate association name rejected: a real failure, not "no contracts". One name
  // rejecting while another answers empty is just the wrong name -- that is what the loop is for.
  const scoped = await _test.contractOptions(contractClient({ fail: 'associations' }), 'deal-1');
  assert.equal(scoped.contractsUnavailable, 'scope_missing');
  assert.deepEqual(scoped.contracts, []);
  // Missing scope on the property read.
  const onRead = await _test.contractOptions(
    contractClient({ contractIds: ['c-1'], fail: 'read' }),
    'deal-1',
  );
  assert.equal(onRead.contractsUnavailable, 'scope_missing');
  // A Deal with NO company is no longer a special case: its own contracts are read too, so the
  // answer is whatever the association and the probe say. 'no_company' was removed rather than
  // left as a code nothing can produce.
  const noCompany = await _test.contractOptions(
    contractClient({ companyId: null, on: 'deal', contractIds: ['c-1'], details: [
      { id: 'c-1', properties: { hs_name: 'Direct', hs_status: 'ACTIVE' } },
    ] }),
    'deal-1',
  );
  assert.equal(noCompany.contractsUnavailable, null);
  assert.deepEqual(noCompany.contracts.map(({ id }) => id), ['c-1']);
  // Nothing associated and nothing listed. This is NOT reported as "no contracts exist" -- a
  // 200-and-empty cannot tell an empty portal apart from a read that is not finding them, and
  // claiming the former is exactly what went wrong on 2026-08-30.
  const none = await _test.contractOptions(
    contractClient({ contractIds: [], portalHasContracts: false }),
    'deal-1',
  );
  assert.equal(none.contractsUnavailable, 'none_found');
  assert.deepEqual(none.contracts, []);

  // THE CASE THAT ACTUALLY HAPPENED, 2026-08-30. Nothing associated to this Deal or its company,
  // but the portal HAS contracts -- "COVIS 2026 Manual Renewal" existed while the card said the
  // company had none. That is the rep's to fix, and it must not read as "there are no contracts".
  const orphaned = await _test.contractOptions(
    contractClient({ contractIds: [], portalHasContracts: true }),
    'deal-1',
  );
  assert.equal(orphaned.contractsUnavailable, 'none_associated');

  // The probe itself failing means we cannot tell the two apart, so we must not claim either --
  // and the REASON it failed is reported rather than flattened. A 403 here is the scope, which is
  // actionable; "not supported" would be a shrug.
  const cannotTell = await _test.contractOptions(
    contractClient({ contractIds: [], fail: 'probe' }),
    'deal-1',
  );
  assert.equal(cannotTell.contractsUnavailable, 'scope_missing');
});

// THE PORTAL'S ACTUAL BEHAVIOUR, 2026-08-30. Associations return two real contract ids, the LIST
// endpoint answers with records, and POST .../batch/read returns 200 with an EMPTY array for
// those same ids. Not an error -- nothing. So the single-record GET fallback has to carry it.
test('contracts are read one by one when batch read answers with nothing', async () => {
  const client = contractClient({
    contractIds: ['c-live', 'c-done'],
    portalHasContracts: true,
    batchReadIsBlind: true,
    details: [
      {
        id: 'c-live',
        properties: {
          hs_name: 'Renewal for Grow Therapy - Calendar - 2026-08',
          hs_status: 'ACTIVE',
          hs_contract_effective_date: '2026-08-01',
        },
      },
      {
        id: 'c-done',
        properties: {
          hs_name: 'Grow Therapy - Calendar',
          hs_status: 'COMPLETED',
          hs_contract_effective_date: '2025-08-01',
        },
      },
    ],
  });
  const { contracts, contractsUnavailable, contractDiagnostics } = await _test.contractOptions(
    client,
    'deal-1',
  );
  assert.equal(contractsUnavailable, null);
  assert.equal(contractDiagnostics.readStrategy, 'single', 'batch answered nothing, so single');
  assert.equal(contractDiagnostics.associatedCount, 2);
  // COMPLETED is filtered out, so only the ACTIVE renewal is offered.
  assert.deepEqual(contracts.map(({ id }) => id), ['c-live']);
  assert.equal(
    contracts[0].label,
    'Renewal for Grow Therapy - Calendar - 2026-08 — ACTIVE — effective 2026-08-01',
  );
});

// Batch is preferred WHEN IT WORKS -- one call instead of one per contract. Reversing the order
// would quietly turn every card load into N calls on a portal where batch is fine.
test('batch read is used when it works, single-record only as the fallback', async () => {
  const client = contractClient({
    contractIds: ['c-1'],
    portalHasContracts: true,
    details: [{ id: 'c-1', properties: { hs_name: 'Acme', hs_status: 'ACTIVE' } }],
  });
  const { contractDiagnostics, contracts } = await _test.contractOptions(client, 'deal-1');
  assert.equal(contractDiagnostics.readStrategy, 'batch');
  assert.deepEqual(contracts.map(({ id }) => id), ['c-1']);
});

// An association can point at an id the object read cannot produce -- a deleted contract, or one
// the app cannot see. A bodyless 200 must be skipped, not counted as a nameless contract.
test('an association to a contract that cannot be read is skipped, not shown blank', async () => {
  const client = contractClient({
    contractIds: ['c-live', 'c-ghost'],
    portalHasContracts: true,
    batchReadIsBlind: true,
    details: [{ id: 'c-live', properties: { hs_name: 'Real', hs_status: 'ACTIVE' } }],
  });
  const { contracts, contractsUnavailable } = await _test.contractOptions(client, 'deal-1');
  assert.equal(contractsUnavailable, null);
  assert.deepEqual(contracts.map(({ id }) => id), ['c-live'], 'the ghost is not offered');

  // And where the ghost is the ONLY thing associated, the never-empty fallback must not resurrect
  // it as "Contract undefined". The status filter hides it in the case above by luck; this is the
  // case where nothing else is there to hide behind.
  const ghostOnly = await _test.contractOptions(
    contractClient({
      contractIds: ['c-ghost'],
      portalHasContracts: true,
      batchReadIsBlind: true,
      details: [],
    }),
    'deal-1',
  );
  assert.deepEqual(ghostOnly.contracts, []);
  assert.equal(ghostOnly.contractsUnavailable, 'unreadable');
});

// THE ACTUAL ANSWER, confirmed against portal 45023718 on 2026-08-30 by querying it directly:
// contracts are object type 0-721, the portal holds 2,536 of them, and hs_status is stored
// LOWERCASE ('active') while the documented enum is uppercase.
test('contracts read from the 0-721 object type, with lowercase statuses', async () => {
  const client = contractClient({
    contractIds: ['583657705754', '583660476431'],
    portalHasContracts: true,
    // The NAME answers 200-with-nothing, exactly as the live portal does. Only the type id works.
    recordsOnPath: '/crm/v3/objects/0-721',
    details: [
      {
        id: '583657705754',
        properties: {
          hs_name: 'CodeCabin - PayGo - Full Platform',
          hs_status: 'active',
          hs_contract_effective_date: '2026-07-01',
        },
      },
      {
        id: '583660476431',
        properties: {
          hs_name: 'RedSeed - Calendar; Notetaker',
          hs_status: 'completed',
          hs_contract_effective_date: '2025-07-01',
        },
      },
    ],
  });
  const { contracts, contractsUnavailable, contractDiagnostics } = await _test.contractOptions(
    client,
    'deal-1',
  );
  assert.equal(contractsUnavailable, null);
  assert.equal(contractDiagnostics.objectPath, '/crm/v3/objects/0-721');
  // Lowercase 'active' must be offered and lowercase 'completed' must be hidden. A case-sensitive
  // comparison against the documented uppercase enum would have hidden every contract in the
  // portal -- which is what a "reasonable" strict match would have done.
  assert.deepEqual(contracts.map(({ id }) => id), ['583657705754']);
  assert.equal(
    contracts[0].label,
    'CodeCabin - PayGo - Full Platform — active — effective 2026-07-01',
  );
});

// hs_start_date is what the UI labels "Contract start date" and is populated where
// hs_contract_effective_date may not be.
test('the start date stands in when the effective date is absent', async () => {
  const client = contractClient({
    contractIds: ['c-1'],
    portalHasContracts: true,
    recordsOnPath: '/crm/v3/objects/0-721',
    details: [
      { id: 'c-1', properties: { hs_name: 'Acme', hs_status: 'active', hs_start_date: '2026-07-01' } },
    ],
  });
  const { contracts } = await _test.contractOptions(client, 'deal-1');
  assert.equal(contracts[0].label, 'Acme — active — effective 2026-07-01');
});

// BUILD 4's ANSWER, 2026-08-30: associations resolve 'contracts' and return a real id, while
// /crm/v3/objects/contracts answers 200 with ZERO records. A name that works for associations and
// not for the objects API means the objects API wants the numeric type id -- so the portal is
// asked for it rather than guessed at a fourth time.
test('the contracts object type id is discovered from the portal when the names fail', async () => {
  const client = contractClient({
    contractIds: ['c-live'],
    // Nothing answers on any DOCUMENTED path -- exactly what the live probe reported.
    portalHasContracts: false,
    recordsOnPath: '/crm/v3/objects/0-421',
    schemaObjectTypeId: '0-421',
    details: [
      {
        id: 'c-live',
        properties: {
          hs_name: 'Renewal for Grow Therapy - Calendar - 2026-08',
          hs_status: 'ACTIVE',
          hs_contract_effective_date: '2026-08-01',
        },
      },
    ],
  });
  const { contracts, contractsUnavailable, contractDiagnostics } = await _test.contractOptions(
    client,
    'deal-1',
  );
  assert.equal(contractsUnavailable, null);
  assert.deepEqual(contracts.map(({ id }) => id), ['c-live']);
  // It reports what it discovered, so the id can be written into the candidates and the lookup
  // stops happening on every failed load.
  assert.equal(contractDiagnostics.discoveredType, '0-421');
  assert.equal(contractDiagnostics.readPath, '/crm/v3/objects/0-421');
});

// A REFUSED read and an EMPTY read are different facts, and only one of them is about scopes.
// Builds 4-7 swallowed the refusal in a per-id catch, so the card could not tell them apart and
// five rounds were spent arguing about object paths instead.
test('a refused read is reported as a scope problem, not as an empty one', async () => {
  const refused = await _test.contractOptions(
    contractClient({
      contractIds: ['c-1'],
      // Faithful to the live portal: the LIST answers 200-and-empty while record reads are
      // REFUSED. That combination is what a missing scope looks like on this object, and it is
      // why five builds mistook it for a wrong object path.
      portalHasContracts: false,
      recordsOnPath: '/nowhere',
      readsAreRefused: true,
      details: [{ id: 'c-1', properties: { hs_name: 'Real', hs_status: 'active' } }],
    }),
    'deal-1',
  );
  // REFUSED is reported as the scope problem it is, not as "unreadable" or "none found".
  assert.equal(refused.contractsUnavailable, 'scope_missing');
  assert.deepEqual(refused.contracts, []);

  // The refusal arriving ONLY from the per-id read still has to reach the card. Builds 4-7
  // caught it in a per-id loop, warned, and carried on -- so the single fact that would have
  // ended this in one round never surfaced.
  const onlySingleRefused = await _test.contractOptions(
    contractClient({
      contractIds: ['c-1'],
      portalHasContracts: false,
      recordsOnPath: '/nowhere',
      batchReadIsBlind: true,
      singleReadIsRefused: true,
      details: [{ id: 'c-1', properties: { hs_name: 'Real', hs_status: 'active' } }],
    }),
    'deal-1',
  );
  assert.equal(onlySingleRefused.contractsUnavailable, 'unreadable');
  assert.equal(
    onlySingleRefused.contractDiagnostics.readReason,
    'scope_missing',
    'a refusal seen only by the per-id read must still reach the card',
  );

  // Answered-empty is the OTHER case and must not be reported as a scope problem.
  const empty = await _test.contractOptions(
    contractClient({
      contractIds: ['c-1'],
      portalHasContracts: false,
      recordsOnPath: '/nowhere',
      singleReadIsBlind: true,
      details: [{ id: 'c-1', properties: { hs_name: 'Real' } }],
    }),
    'deal-1',
  );
  assert.equal(empty.contractDiagnostics.readReason, 'answered_empty');
});

// Discovery can SUCCEED and the read still fail. Trusting the discovered type without checking
// it returned anything would put the card back on "no contract was found" -- the wrong message,
// arrived at a different way.
test('a discovered type that still reads nothing is reported as unreadable', async () => {
  const client = contractClient({
    contractIds: ['c-live'],
    portalHasContracts: false,
    // The discovered type is real, but nothing answers on it either.
    recordsOnPath: '/nowhere',
    schemaObjectTypeId: '0-421',
    details: [{ id: 'c-live', properties: { hs_name: 'Real' } }],
  });
  const result = await _test.contractOptions(client, 'deal-1');
  assert.equal(result.contractsUnavailable, 'unreadable');
  assert.deepEqual(result.contracts, []);
  // ...and it still reports what it found, so the next step is informed rather than blind.
  assert.equal(result.contractDiagnostics.discoveredType, '0-421');
});

// Discovery that finds nothing must not paper over the failure.
test('a portal whose schemas name no contracts object still reports unreadable', async () => {
  const client = contractClient({
    contractIds: ['c-live'],
    portalHasContracts: false,
    recordsOnPath: '/nowhere',
    schemaObjectTypeId: null,
    details: [{ id: 'c-live', properties: { hs_name: 'Real' } }],
  });
  const result = await _test.contractOptions(client, 'deal-1');
  assert.equal(result.contractsUnavailable, 'unreadable');
  assert.equal(result.contractDiagnostics.discoveredType, null);
});

// THE PORTAL, 2026-08-30, after the single-record fallback also came back empty. Associations
// hand over a real contract id; batch/read answers 200-and-empty; the per-id GET answers
// 200-and-empty; and the LIST endpoint has the records the whole time. HubSpot's own docs say as
// much -- individual retrieval is a different API from the list.
test('contracts are found by listing when neither batch nor per-id read answers', async () => {
  const client = contractClient({
    contractIds: ['c-live'],
    portalHasContracts: true,
    batchReadIsBlind: true,
    singleReadIsBlind: true,
    details: [
      {
        id: 'c-live',
        properties: {
          hs_name: 'Renewal for Grow Therapy - Calendar - 2026-08',
          hs_status: 'ACTIVE',
          hs_contract_effective_date: '2026-08-01',
        },
      },
    ],
  });
  const { contracts, contractsUnavailable, contractDiagnostics } = await _test.contractOptions(
    client,
    'deal-1',
  );
  assert.equal(contractsUnavailable, null);
  assert.equal(contractDiagnostics.readStrategy, 'listing');
  assert.deepEqual(contracts.map(({ id }) => id), ['c-live']);
  assert.equal(
    contracts[0].label,
    'Renewal for Grow Therapy - Calendar - 2026-08 — ACTIVE — effective 2026-08-01',
  );
});

// Listing must only return what was ASKED for. A company's contract picker showing every contract
// in the portal would be worse than showing none.
test('listing filters to the associated ids and nothing else', async () => {
  const client = contractClient({
    contractIds: ['c-mine'],
    portalHasContracts: true,
    batchReadIsBlind: true,
    singleReadIsBlind: true,
    details: [
      { id: 'c-mine', properties: { hs_name: 'Mine', hs_status: 'ACTIVE' } },
      { id: 'c-someone-else', properties: { hs_name: 'Not mine', hs_status: 'ACTIVE' } },
    ],
  });
  const { contracts } = await _test.contractOptions(client, 'deal-1');
  assert.deepEqual(contracts.map(({ id }) => id), ['c-mine']);
});

// Associations return real ids and the object read still comes back empty: the ids are right and
// the PATH is wrong. A different answer from "there are none", and it is what the card reported
// as "no contract was found" on 2026-08-30.
test('contracts that are linked but unreadable are reported as unreadable', async () => {
  const client = contractClient({
    contractIds: ['c-1'],
    portalHasContracts: false,
    recordsOnPath: '/nowhere',
    details: [{ id: 'c-1', properties: { hs_name: 'COVIS 2026 Manual Renewal' } }],
  });
  const result = await _test.contractOptions(client, 'deal-1');
  assert.equal(result.contractsUnavailable, 'unreadable');
  assert.deepEqual(result.contracts, []);
  // The diagnostics say what was seen, so the next step is reading a number rather than guessing.
  assert.equal(result.contractDiagnostics.associatedCount, 1);
  assert.equal(result.contractDiagnostics.readPath, null);
});

// The READ must try every candidate path too, not just the one the list probe liked. The two can
// disagree, and on 2026-08-30 they did.
test('the read falls through to another path when the preferred one answers with nothing', async () => {
  const client = contractClient({
    contractIds: ['c-1'],
    portalHasContracts: false,
    recordsOnPath: '/crm/objects/2026-03/contracts',
    details: [
      { id: 'c-1', properties: { hs_name: 'COVIS 2026 Manual Renewal', hs_status: 'ACTIVE' } },
    ],
  });
  const { contracts, contractsUnavailable, contractDiagnostics } = await _test.contractOptions(
    client,
    'deal-1',
  );
  assert.equal(contractsUnavailable, null);
  assert.deepEqual(contracts.map(({ id }) => id), ['c-1']);
  // ...and it reports which path worked, so nobody has to rediscover it.
  assert.equal(contractDiagnostics.readPath, '/crm/objects/2026-03/contracts');
});

// The probe must not stop at the first path that merely ANSWERS. A 200-and-empty proves the call
// worked, not that it is the right object -- and on 2026-08-30 an empty answer from the wrong
// path was read as "this portal has no contracts" while three sat on the company.
test('the probe keeps looking past a path that answers with nothing', async () => {
  const client = contractClient({
    contractIds: ['c-1'],
    portalHasContracts: true,
    recordsOnPath: '/crm/objects/2026-03/contracts',
    details: [
      { id: 'c-1', properties: { hs_name: 'COVIS 2026 Manual Renewal', hs_status: 'ACTIVE' } },
    ],
  });
  const { contracts, contractsUnavailable, contractDiagnostics } = await _test.contractOptions(
    client,
    'deal-1',
  );
  assert.equal(contractsUnavailable, null);
  assert.deepEqual(contracts.map(({ id }) => id), ['c-1']);
  // ...and it reports WHICH path answered, so the next person does not have to rediscover it.
  assert.equal(contractDiagnostics.objectPath, '/crm/objects/2026-03/contracts');
  assert.notEqual(contractDiagnostics.objectPath, '/crm/v3/objects/0-721');
  assert.equal(contractDiagnostics.sawRecords, true);
});

// The probe's whole job is to keep three situations apart. They were one message until today.
test('the contract probe distinguishes records, an answer, and no answer', () => {
  const withRecords = _test.readContractProbe({
    path: '/crm/v3/objects/0-721',
    attempts: [{ path: '/crm/v3/objects/0-721', ok: true, count: 1 }],
  });
  assert.deepEqual(withRecords, {
    path: '/crm/v3/objects/0-721',
    sawRecords: true,
    answered: true,
    reason: null,
    listed: 1,
  });

  // 200-and-empty: usable as a read path, but NOT proof that contracts exist anywhere.
  const answeredEmpty = _test.readContractProbe({
    path: null,
    attempts: [{ path: '/crm/v3/objects/0-721', ok: true, count: 0 }],
  });
  assert.equal(answeredEmpty.path, '/crm/v3/objects/0-721', 'still usable for reads');
  assert.equal(answeredEmpty.sawRecords, false, 'an empty page proves nothing about existence');
  assert.equal(answeredEmpty.listed, 0, 'and the count says so plainly');
  assert.equal(answeredEmpty.answered, true);

  // Nothing answered at all.
  const dead = _test.readContractProbe({
    path: null,
    attempts: [
      { path: '/crm/v3/objects/0-721', ok: false, reason: 'scope_missing' },
      { path: '/crm/objects/2026-03/contracts', ok: false, reason: 'not_supported' },
    ],
  });
  // The REASON survives. A 403 here means the scope, and reporting that instead of a generic
  // "not supported" is the difference between an actionable message and a shrug.
  assert.deepEqual(dead, {
    path: null,
    sawRecords: false,
    answered: false,
    reason: 'scope_missing',
    listed: 0,
  });
});

// A change or renewal must say which contract it is for -- but only where there was a choice.
//
// This is deliberately narrower than the Contact picker's rule. A rep can always create a
// contact; a rep CANNOT create a contract. So blocking whenever none is chosen would dead-end
// every change and renewal quote on a portal without the scope, with nothing the rep could do.
test('a change or renewal is blocked only when a contract could actually have been chosen', async () => {
  const withTwo = () =>
    contractClient({
      contractIds: ['c-1', 'c-2'],
      details: [
        { id: 'c-1', properties: { hs_name: 'A', hs_contract_effective_date: '2024-01-01' } },
        { id: 'c-2', properties: { hs_name: 'B', hs_contract_effective_date: '2025-01-01' } },
      ],
    });

  for (const kind of ['change', 'renewal']) {
    // Contracts exist and none was chosen: blocked.
    await assert.rejects(
      () => _test.assertContractChosen(withTwo(), 'deal-1', kind, ''),
      (error) => error.message === 'QUOTE_CONTRACT_REQUIRED',
      `${kind} with no contract chosen must be blocked`,
    );
    // An id that is not on this company is not a choice either -- it is a stale card or a typo.
    await assert.rejects(
      () => _test.assertContractChosen(withTwo(), 'deal-1', kind, 'c-999'),
      (error) => error.message === 'QUOTE_CONTRACT_REQUIRED',
    );
    // A real choice passes through, and the validated id is what comes back.
    assert.equal(await _test.assertContractChosen(withTwo(), 'deal-1', kind, 'c-2'), 'c-2');
  }

  // New business never asks -- and must not spend a round trip finding out.
  let touched = false;
  const watched = {
    crm: { associations: { v4: { basicApi: { getPage: async () => {
      touched = true;
      return { results: [] };
    } } } } },
  };
  assert.equal(await _test.assertContractChosen(watched, 'deal-1', 'new_business', ''), null);
  assert.equal(touched, false, 'a new business lock must not read contracts at all');

  // THE FAIL-SAFE. None of these may block, because the rep cannot resolve any of them.
  assert.equal(
    await _test.assertContractChosen(contractClient({ fail: 'associations' }), 'deal-1', 'change', ''),
    null,
    'a missing scope must not block the lock',
  );
  assert.equal(
    await _test.assertContractChosen(contractClient({ contractIds: [] }), 'deal-1', 'renewal', ''),
    null,
    'a company with no contracts must not block the lock',
  );
  assert.equal(
    await _test.assertContractChosen(contractClient({ companyId: null }), 'deal-1', 'change', ''),
    null,
    'a Deal with no company must not block the lock',
  );
});

// The kind has to survive a page reload, and it is now READ OFF THE TEMPLATE rather than stated.
//
// It is kept on the OPTION, inside the document property this portal is known to have, rather
// than on a new Deal property nobody has verified -- and rather than on option.input, which is
// hashed: choosing a different DOCUMENT must not change the state hash and mark the line items
// stale, because it moves no number.
test('the derived kind is stored on the locked option, and never in the hash', async () => {
  const settings = normalizeSettings({
    ...defaultSettings(),
    allowNewBusiness: true,
    allowRenewals: true,
    renewalPipelineIds: ['renewals'],
    quoteTemplatesByKind: {
      new_business: { enabledIds: ['567553820432'], defaultId: '567553820432' },
      change: { enabledIds: ['583243623796'], defaultId: '583243623796' },
      renewal: { enabledIds: ['583243745379'], defaultId: '583243745379' },
    },
  });
  const input = {
    termMonths: 12,
    paymentFrequency: 'annual_in_advance',
    volumes: { connect_ca: 1_000 },
    supportLevel: 'basic',
    onboardingPackage: 'none',
    professionalServices: [],
    addOns: [],
  };
  const state = {
    dealType: 'renewal',
    pipelineId: 'renewals',
    dealName: 'Acme',
    document: { schemaVersion: '1.0', revision: 4, options: [] },
  };

  // Stops at the line-item sync, which runs AFTER the document is written, so the assertions
  // below read exactly what Lock in persisted. The sync wraps what it catches, so
  // LINE_ITEM_SYNC_FAILED is what surfaces.
  const STOP = new Error('stop after the document write');
  const lockWith = async (templateId) => {
    const updates = [];
    const client = {
      crm: {
        deals: { basicApi: { update: async (_id, payload) => updates.push(payload) } },
        associations: { v4: { basicApi: { getPage: async () => {
          throw STOP;
        } } } },
      },
      // The contract read that assertContractChosen makes. Nothing to return.
      apiRequest: async () => ({ json: async () => ({ results: [] }) }),
    };
    await assert.rejects(
      () =>
        _test.lockLiveCalculation(
          client,
          'deal-1',
          state,
          {
            input,
            quoteContent: { templateId },
            paymentMethod: 'ach',
            discountReason: '',
          },
          '45023718',
          settings,
        ),
      (error) => error.message === 'LINE_ITEM_SYNC_FAILED',
    );
    const written = updates.find((payload) => payload.properties?.[OPTION_PROPERTY]);
    assert.ok(written, 'the option document must have been written');
    return JSON.parse(written.properties[OPTION_PROPERTY]).options[0];
  };

  const change = await lockWith('583243623796');
  const renewal = await lockWith('583243745379');
  // Read off the template, exactly as Settings assigns it. Decision #1, Holly 2026-08-30.
  assert.equal(change.quoteKind, 'change');
  assert.equal(renewal.quoteKind, 'renewal');

  // The SAME configuration, so the same hash and the same option id. If the kind had gone into
  // option.input instead, both would differ and switching document would mark the Deal's line
  // items stale over a choice that moves no number.
  assert.equal(change.result.stateHash, renewal.result.stateHash);
  assert.equal(change.id, renewal.id);
  // And it is genuinely absent from the stored input, not merely equal by luck.
  assert.equal('quoteKind' in change.input, false);

  // A template no kind claims still records a kind rather than leaving the option blank.
  assert.equal((await lockWith('999999999999')).quoteKind, 'change');
});

// THE UNCONFIGURED-PORTAL CASE, at the lock. The contract requirement must follow the TEMPLATE's
// kind, not the fallback kind recorded on the option.
//
// They differ exactly where it matters: on a renewal Deal quoting from a template no kind claims,
// the recorded kind falls back to 'change' so the option is never kindless -- but no contract is
// required, because nobody has said that template is a change document. Requiring one from the
// fallback would block every renewal lock on a portal where Settings has not been filled in yet.
test('an unclaimed template does not demand a contract, even when the company has them', async () => {
  const settings = normalizeSettings({
    ...defaultSettings(),
    allowNewBusiness: true,
    allowRenewals: true,
    renewalPipelineIds: ['renewals'],
    quoteTemplatesByKind: {
      new_business: { enabledIds: [], defaultId: '' },
      change: { enabledIds: ['583243623796'], defaultId: '' },
      renewal: { enabledIds: ['583243745379'], defaultId: '' },
    },
  });
  const input = {
    termMonths: 12,
    paymentFrequency: 'annual_in_advance',
    volumes: { connect_ca: 1_000 },
    supportLevel: 'basic',
    onboardingPackage: 'none',
    professionalServices: [],
    addOns: [],
  };
  const state = {
    dealType: 'renewal',
    pipelineId: 'renewals',
    dealName: 'Acme',
    document: { schemaVersion: '1.0', revision: 1, options: [] },
  };
  const STOP = new Error('stop at the line item sync');
  // This company DOES have a contract, so the requirement would fire if it applied.
  const client = {
    crm: {
      deals: { basicApi: { update: async () => undefined } },
      associations: { v4: { basicApi: { getPage: async (_from, _id, toType) => {
        if (toType === 'companies') return { results: [{ toObjectId: 'co-1' }] };
        if (toType === 'contracts') return { results: [{ toObjectId: 'c-1' }] };
        throw STOP;
      } } } },
    },
    apiRequest: async () => ({
      json: async () => ({
        results: [
          { id: 'c-1', properties: { hs_name: 'Acme MSA', hs_status: 'ACTIVE' } },
        ],
      }),
    }),
  };
  const lock = (templateId) =>
    _test.lockLiveCalculation(
      client,
      'deal-1',
      state,
      { input, quoteContent: { templateId }, paymentMethod: 'ach', discountReason: '' },
      '45023718',
      settings,
    );

  // The CHANGE template with no contract chosen: refused, before anything is written.
  await assert.rejects(
    () => lock('583243623796'),
    (error) => error.message === 'QUOTE_CONTRACT_REQUIRED',
  );

  // A template no kind claims: NOT refused. It gets past the guard and fails later, at the line
  // item sync, which is how we know the contract check let it through.
  await assert.rejects(
    () => lock('999999999999'),
    (error) => error.message === 'LINE_ITEM_SYNC_FAILED',
    'an unclaimed template must not be blocked for want of a contract',
  );
});

// The default Quote title. It used to be "<deal name> - Live calculator", which put an internal
// label in front of a customer: "COVIS 2026 Manual Renewal - Live calculator". Holly, 2026-08-30.
test('the default quote title is the company and the contract start year', () => {
  assert.equal(
    _test.defaultQuoteTitle('Dr. Glinz COVIS GmbH', '2026-09-01', 'COVIS 2026 Manual Renewal'),
    'Dr. Glinz COVIS GmbH - 2026',
  );
  // The CONTRACT START year, not today's: a quote written in December for a January term belongs
  // to the term it covers.
  assert.equal(_test.defaultQuoteTitle('Acme', '2027-01-15', 'Deal'), 'Acme - 2027');
  // No company: the deal name, rather than nothing.
  assert.equal(_test.defaultQuoteTitle('', '2026-09-01', 'COVIS 2026 Manual Renewal'), 'COVIS 2026 Manual Renewal - 2026');
  // An unreadable start date drops the year rather than printing "Acme - NaN" or "Acme - ".
  assert.equal(_test.defaultQuoteTitle('Acme', '', 'Deal'), 'Acme');
  assert.equal(_test.defaultQuoteTitle('Acme', 'not-a-date', 'Deal'), 'Acme');
  assert.equal(_test.defaultQuoteTitle('Acme', undefined, 'Deal'), 'Acme');
  // Nothing to name it after at all: empty, so the caller falls back rather than sending " - ".
  assert.equal(_test.defaultQuoteTitle('', '2026-09-01', ''), '');
  assert.equal(_test.defaultQuoteTitle('   ', '2026-09-01', '  '), '');
});

// A Quote must carry a Contact, and the rep chooses which.
//
// HubSpot lists Contact as a REQUIRED association on a CPQ quote. The app used to associate
// whatever the Deal happened to have -- an empty list was silently a no-op -- so a Deal with no
// contact produced a quote HubSpot refused with "One or more associations are invalid", an error
// that named the quote TEMPLATE and sent us looking in the wrong place for an evening.
test('the quote contact is required, chosen, and added to the Deal when it comes from the Company', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'QuoteOptionsFunction.js'),
    'utf8',
  );

  // Refused before the quote is created, with a message that says what to do.
  assert.match(source, /if \(contactIds\.length === 0\) throw new Error\('QUOTE_CONTACT_REQUIRED'\)/);
  assert.match(source, /QUOTE_CONTACT_REQUIRED:\s*\n\s*'A contact is required on the Quote/);

  // The rep's choice wins; the Deal's own contacts remain the fallback for a configuration saved
  // before the picker existed.
  assert.match(source, /const contactIds = chosenContactId \? \[chosenContactId\] : dealContactIds;/);

  // A contact picked from the COMPANY is put on the Deal -- that is the point of the picker.
  assert.match(
    source,
    /if \(chosenContactId && !dealContactIds\.includes\(chosenContactId\)\)/,
    'a company contact must be associated to the Deal',
  );
  // createDefault, not a guessed type id.
  assert.match(source, /associations\.v4\.basicApi\.createDefault\(\s*'deals',/);
  // ...and failing to do so must not fail the lock: the quote can still carry the contact.
  const block = source.slice(source.indexOf("if (chosenContactId && !dealContactIds"));
  assert.match(block.slice(0, 900), /catch \(error\) \{\s*\n\s*\/\/[\s\S]*?console\.warn\(/);

  // Deal contacts first, Company contacts only as a fallback.
  const options = source.slice(source.indexOf('const quoteContactOptions'));
  assert.match(options.slice(0, 2500), /if \(dealContactIds\.length > 0\) \{[\s\S]*?source: 'deal'/);
  assert.match(options.slice(0, 2500), /source: 'company'/);
  // A nameless option is unpickable, so a label is always produced.
  assert.match(options.slice(0, 2500), /name \|\| email \|\| `Contact \$\{contact\.id\}`/);
});
