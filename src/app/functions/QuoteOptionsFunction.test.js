const assert = require('node:assert/strict');
const test = require('node:test');

const { calculateQuote } = require('./calculator');
const { CATALOG } = require('./lineItemModel');
const {
  defaultSettings,
  normalizeSettings,
  quoteTemplateSettings,
  dealCategory,
} = require('./appSettings');
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
// A quote that is already expired cannot be accepted. Quote 42607873610 was created on
// 2026-08-31 and expired 2025-08-31, because the expiration was pinned to the contract start.
//
// 90 days matches the portal's own "default expiration period" setting. That default only applies
// to a quote created without an explicit expiration, and the API requires hs_expiration_date on a
// CPQ quote -- so the app's value always wins, and it should be the same 90 days a rep gets
// creating a quote by hand.
test('the quote expires 90 days from creation, never from the contract start', () => {
  const expiry = _test.quoteExpirationDate;
  const now = new Date('2026-09-01T10:00:00Z');

  assert.equal(expiry('2026-09-01', now), '2026-11-30');

  // THE CASE THIS EXISTS FOR: the contract start does not influence it at all, so a back-dated
  // or missing start can never produce an expired quote.
  assert.equal(expiry('2025-08-31', now), '2026-11-30');
  assert.equal(expiry('2030-01-01', now), '2026-11-30');
  assert.equal(expiry('', now), '2026-11-30');
  assert.equal(expiry(null, now), '2026-11-30');

  // Always a real date, never an empty string -- HubSpot reads empty as the epoch and prints
  // January 1, 1970.
  assert.match(expiry('not a date', now), /^\d{4}-\d{2}-\d{2}$/);

  // Year boundary.
  assert.equal(expiry('2026-01-01', new Date('2026-11-15T00:00:00Z')), '2027-02-13');

  // And it is always sent on the create -- hs_expiration_date is required on a CPQ quote.
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'QuoteOptionsFunction.js'),
    'utf8',
  );
  const create = source.match(
    /quote = await client\.crm\.quotes\.basicApi\.create\(\{([\s\S]*?)\n      \},/,
  );
  assert.match(
    create[1],
    /hs_expiration_date: quoteExpirationDate\(option\.result\.dates\.contractStartDate\),/,
    'the expiration must be derived, not pinned to the contract start',
  );
  assert.match(source, /const QUOTE_EXPIRY_DAYS = 90;/);
});

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
  // GATED ON needsApproval. Removed once on 2026-09-01 to match the 2026-08-31 build exactly, and
  // restored the same evening on live evidence: Deal 60785797504 has
  // pricing_approval_tier_required = "none" and 0% discretionary discount, and quote 42608430360
  // (20:26) still went to PENDING_APPROVAL. Holly: "it shouldn't have been."
  //
  // The portal's rejection -- "Quote cannot be published without going through the pending
  // approval state" -- refuses PUBLISHING. APPROVAL_NOT_NEEDED is a published state and is
  // refused; PENDING_APPROVAL is the state that message names as the way through, for the deals
  // that actually need it.
  //
  // Never APPROVAL_NOT_NEEDED: on this portal that is the value that loses the whole quote.
  assert.doesNotMatch(
    source,
    /const desiredQuoteStatus = QUOTE_STATUS_PENDING_APPROVAL;/,
    'the desired status must depend on needsApproval, not be hardcoded',
  );
  assert.match(
    source,
    /const desiredQuoteStatus = needsApproval\s+\? QUOTE_STATUS_PENDING_APPROVAL\s+: QUOTE_STATUS_DRAFT;/,
  );
  assert.match(source, /const QUOTE_STATUS_DRAFT = 'DRAFT';/);
  assert.doesNotMatch(
    source,
    /desiredQuoteStatus = QUOTE_STATUS_APPROVAL_NOT_NEEDED/,
    'APPROVAL_NOT_NEEDED is refused on this portal and loses the quote',
  );

  // NEVER ON THE CREATE. HubSpot, verbatim, after this was tried both ways:
  //
  //   "CPQ Quotes cannot be published on create. Create as draft and then update to be published."
  //
  // This assertion exists because the status was moved onto the create, off it, and onto it again
  // over one night. It does not go on the create. Not PENDING_APPROVAL either.
  const create = source.match(
    /quote = await client\.crm\.quotes\.basicApi\.create\(\{([\s\S]*?)\n      \},/,
  );
  assert.ok(create, 'the quote create call must be findable');
  assert.doesNotMatch(
    create[1],
    /hs_status:/,
    'CPQ quotes cannot be published on create -- create as draft, then update',
  );

  // ...and the transition must come AFTER the line items, because HubSpot requires an associated
  // QUOTE_TO_LINE_ITEM before it will accept PENDING_APPROVAL.
  const lineItemsAt = source.indexOf('const createdQuoteLines = await createLineItemsBatch(');
  const transitionAt = source.indexOf('if (quoteStatus !== desiredQuoteStatus)');
  assert.ok(lineItemsAt > 0 && transitionAt > 0);
  assert.ok(
    lineItemsAt < transitionAt,
    'the quote line items must exist before the status transition is attempted',
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
test('the quote create sends only what a CPQ quote structurally needs', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'QuoteOptionsFunction.js'),
    'utf8',
  );
  // Read off the source rather than the built object: generateQuote needs a whole portal to run,
  // and what matters here is which properties are on the create call at all.
  const create = source.match(
    /quote = await client\.crm\.quotes\.basicApi\.create\(\{([\s\S]*?)\n      \},/,
  );
  assert.ok(create, 'the quote create call must be findable');
  // Comments name the properties they explain the absence of, so match on code only.
  const body = create[1]
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');

  // THE SELLER STAYS. The template's Seller block is configured to read *Quote owner* -- confirmed
  // in the template editor 2026-09-01: "The quote owner's name and email will show as the seller
  // contact on quotes." Removing hubspot_owner_id is what a blank Seller looks like, and it was
  // removed once and reverted the same day.
  assert.match(body, /hubspot_owner_id: dealOwnerId/, 'the seller must be the deal owner');
  assert.match(body, /hs_quote_owner_id: dealOwnerId,/, 'the quote sender must be set');
  // Guarded, because an empty string is not "no owner" to HubSpot.
  assert.match(body, /\.\.\.\(dealOwnerId\s*\n?\s*\?\s*\{/);

  // THE ACCEPTANCE METHOD IS SENT, AND HAS TO BE. Removed on 2026-09-01 and restored 14 minutes
  // later on measured evidence:
  //
  //   20:04:45  app sends clickwrap  -> clickwrap,      signature box OFF
  //   20:14:58  app sends nothing    -> print_and_sign, signature box ON
  //   20:15:34  app sends nothing    -> print_and_sign, signature box ON
  //   20:18:04  app sends nothing    -> print_and_sign, signature box ON
  //
  // All three templates are set to clickwrap and HubSpot does not inherit it. Not sending this
  // asks every customer for a signature. Holly: "all are accept without signature."
  assert.match(body, /hs_acceptance_method: QUOTE_ACCEPTANCE_METHOD/);
  const method = source.match(/const QUOTE_ACCEPTANCE_METHOD = '([a-z_]+)';/);
  assert.ok(method, 'the acceptance method must be a named constant');
  assert.equal(method[1], 'clickwrap', 'Holly: quotes accept without a signature');

  // NOT SENT. hs_cover_letter and hs_executive_summary are what a hand-made quote carries and a
  // generated one does not -- HubSpot's Quotes tool writes that prose, and the app is not its
  // owner. hs_esign_enabled belongs to the portal.
  for (const property of ['hs_esign_enabled', 'hs_cover_letter', 'hs_executive_summary']) {
    assert.doesNotMatch(
      body,
      new RegExp(`${property}\\s*:`),
      `${property} must not be sent on the quote create`,
    );
  }

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
  //
  // Not pinned to sitting immediately after 'hs_status' any more: the same read-back now also
  // asks for hs_type, hs_net_payment_terms and hs_terms, which is what proves the template was
  // applied. What matters is that the sender keys are in the list, not what precedes them.
  assert.match(
    source,
    /const finalized = await client\.crm\.quotes\.basicApi\.getById\(String\(quote\.id\), \[[\s\S]{0,600}?\.\.\.Object\.keys\(sender\),/,
  );
  assert.match(source, /const senderMissing = Object\.entries\(sender\)\.filter\(/);
  assert.match(source, /await client\.crm\.quotes\.basicApi\.update\(String\(quote\.id\), \{/);
});

// EVERYTHING CPQ INITIALIZATION READS IS ON THE CREATE REQUEST.
//
// Measured 2026-09-01 on deal 63835136345 with New Business Template 567553820432: a quote whose
// template was associated AFTER the create came out with no terms block and net terms 0, while the
// hand-made quote and an API quote carrying the template ON the create both came out with the
// template's terms and net terms 30. The association was identical in all three; the ORDER was
// not. These tests exist so that ordering cannot quietly regress again -- it looks harmless in a
// diff and costs a day to rediagnose.
test('the quote template is associated on the create request, never after it', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'QuoteOptionsFunction.js'),
    'utf8',
  );
  // 286 is carried into the create's associations array.
  assert.match(
    source,
    /const quoteCreateAssociations = \[[\s\S]{0,600}?createAssociation\(templateId, 286\)/,
    'the quote template must be on the create request',
  );
  assert.match(
    source,
    /associations: quoteCreateAssociations,/,
    'the create must send the built association list, not an empty one',
  );
  assert.doesNotMatch(
    source,
    /associations: \[\],\n\s*\}\);/,
    'the quote create must never be sent with an empty associations array',
  );
  // And nothing re-associates a template afterwards.
  assert.doesNotMatch(
    source,
    /basicApi\.create\(\s*'quotes',\s*String\(quote\.id\),\s*'quote_template'/,
    'a template associated after the create does not initialize the quote',
  );
});

test('the quote is created as INITIAL, because the API refuses every other type', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'QuoteOptionsFunction.js'),
    'utf8',
  );
  // HubSpot, verbatim, on a create that sent RENEWAL:
  //   "When creating a quote via the public API, 'hs_type' must be set to 'INITIAL' and cannot be
  //    set to any other value."
  // Sending CHANGE or RENEWAL does not produce a wrong quote -- it produces NO quote, HTTP 400,
  // and a failed Lock in. This test exists because the kind -> type mapping is the obvious thing
  // to write and it breaks every change and renewal Lock in.
  assert.match(
    source,
    /hs_template_type: 'CPQ_QUOTE',[\s\S]{0,600}?hs_type: CPQ_QUOTE_TYPE_INITIAL,/,
    'hs_type must be sent on the create, and must be the INITIAL constant',
  );
  assert.match(source, /const CPQ_QUOTE_TYPE_INITIAL = 'INITIAL';/);
  assert.doesNotMatch(
    source,
    /hs_type: ['"`](?:CHANGE|RENEWAL)['"`]/,
    'the API rejects a create carrying any hs_type but INITIAL',
  );
  assert.doesNotMatch(
    source,
    /CPQ_QUOTE_TYPE_BY_KIND/,
    'a kind -> hs_type map cannot exist: every value but INITIAL fails the create',
  );
});

test("HubSpot's cloned line items are cleared before the calculator's own are created", () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'QuoteOptionsFunction.js'),
    'utf8',
  );
  // Associating the Deal on the create makes HubSpot clone the Deal's line items onto the quote
  // (verified: quote 42620168501 came out carrying ten). The app creates its own, so without this
  // every product prints twice.
  const afterCreate = source.slice(source.indexOf('const clonedLineItemIds'));
  assert.match(source, /const clonedLineItemIds = await associatedIds\(/);
  assert.match(afterCreate.slice(0, 1200), /lineItems\.basicApi\.archive\(String\(id\)\)/);
  // Order matters: the clearing must happen before the calculator's lines are sent.
  assert.ok(
    source.indexOf('const clonedLineItemIds') <
      source.indexOf('const sendingQuoteLines = lineItems.map'),
    "HubSpot's clones must be cleared before the calculator's own lines are created",
  );
});

// THE TEMPLATE DECIDES THE KIND. There is no separate Quote Type control -- one existed briefly
// and let the two disagree on screen: Quote Type "Change" beside the New Business template. The
// template is what actually prints, so it is the input and the kind is read off it.
// Only ACTIVE CPQ templates may be offered. A quote is created with hs_template_type CPQ_QUOTE;
// associating it to a legacy customizable_quote_template is a mismatch HubSpot reports as
// "One or more associations are invalid", naming the association rather than the template.
// This portal holds three legacy records -- Default Original, Default Basic, Default Modern.
test('legacy and archived quote templates are never offered', async () => {
  const page = {
    results: [
      { id: '567553820432', properties: { hs_name: 'New Business Template', hs_type: 'cpq_template', hs_active: 'true' } },
      { id: '583243623796', properties: { hs_name: 'Change Quote Template', hs_type: 'cpq_template', hs_active: 'true' } },
      // The portal's real legacy records.
      { id: '292990114640', properties: { hs_name: 'Default Original', hs_type: 'customizable_quote_template', hs_active: 'true' } },
      { id: '292990114638', properties: { hs_name: 'Default Basic', hs_type: 'customizable_quote_template', hs_active: 'false' } },
      // A CPQ template that has been archived is no more usable than a legacy one.
      { id: '559754016006', properties: { hs_name: 'Template - Proof of Concept (POC)', hs_type: 'cpq_template', hs_active: 'false' } },
      // No type at all -- treated as not CPQ rather than assumed to be fine.
      { id: '999999999999', properties: { hs_name: 'Mystery' } },
    ],
  };
  const client = { crm: { objects: { basicApi: { getPage: async () => page } } } };
  const offered = await _test.usableQuoteTemplates(client);
  assert.deepEqual(
    offered.map(({ id }) => id),
    ['583243623796', '567553820432'],
    'only the active cpq_template records, sorted by name',
  );
});

// The picker filter is not enough on its own: a stale card, a stored option, or the configured
// secret can all put a template id into the lock that the picker never offered. The lock refuses
// it too -- and BEFORE the quote record exists, so a refusal leaves nothing behind.
test('the lock refuses a legacy template, before any quote is created', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'QuoteOptionsFunction.js'),
    'utf8',
  );
  assert.match(
    source,
    /if \(templateType !== REQUIRED_QUOTE_TEMPLATE_TYPE && templateType !== 'unknown'\) \{[\s\S]{0,600}?QUOTE_TEMPLATE_NOT_CPQ/,
    'a non-CPQ template must throw QUOTE_TEMPLATE_NOT_CPQ',
  );
  const guardAt = source.indexOf("throw failure;\n  }\n  // A new Quote every time");
  const createAt = source.indexOf('quote = await client.crm.quotes.basicApi.create({');
  assert.ok(guardAt > 0, 'the guard must be findable');
  assert.ok(createAt > 0, 'the quote create must be findable');
  assert.ok(
    guardAt < createAt,
    'the template type must be checked BEFORE the quote record is created',
  );
  // And the rep gets told which thing to change, not just that something failed.
  assert.match(source, /QUOTE_TEMPLATE_NOT_CPQ:\s*\n?\s*'That quote template is a legacy template/);
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

// THE DEAL'S OWN PROFESSIONAL SERVICES AND ADD-ON PROPERTIES.
//
// Before this, the rep's picks lived only inside pricing_quote_inputs_payload -- a JSON blob no
// HubSpot list, report or order-form workflow can read. professional_services_package and
// pricing_subscription_addons are the portal's own properties for exactly this, and they were
// sitting empty. Holly, 2026-09-01: "set this field".
//
// Values read from the portal's property editor on 2026-09-01, NOT from the labels: two of the
// professional-services internal names are the strings "true" and "false", left over from when the
// property was a yes/no field. Getting these wrong is the "was not one of the allowed options"
// rejection that emptied a Deal on 2026-08-28.
test('the calculator picks are mirrored onto the Deal choice properties', () => {
  const {
    hubSpotChoiceList,
    professionalServiceHubSpotValue,
    addOnHubSpotValue,
    PROFESSIONAL_SERVICES_NONE,
  } = _test;

  // The two internal names that do not look like their labels. If either of these ever "reads
  // wrong" and gets tidied, the write silently stops matching the portal.
  assert.equal(professionalServiceHubSpotValue.architecture_workflow_review, 'true');
  assert.equal(professionalServiceHubSpotValue.gtm_review, 'false');
  // SINGULAR "Project". The card's label and the rate card both say "Projects"; the portal does
  // not, and the portal is what the write has to match.
  assert.equal(addOnHubSpotValue.verified_oauth, 'Turnkey Verified OAuth Project');

  // Semicolon-joined, sorted, de-duplicated.
  assert.equal(
    hubSpotChoiceList(
      ['gtm_review', 'google_verification_review', 'gtm_review'],
      professionalServiceHubSpotValue,
    ),
    'Google Verification Review;false',
  );
  assert.equal(
    hubSpotChoiceList(['verified_oauth', 'shared_oauth_app'], addOnHubSpotValue),
    'Shared Google OAuth App;Turnkey Verified OAuth Project',
  );

  // Sorting is what keeps a re-lock from showing as a change. Order in must not change order out.
  assert.equal(
    hubSpotChoiceList(['privacy_filter', 'shared_oauth_app'], addOnHubSpotValue),
    hubSpotChoiceList(['shared_oauth_app', 'privacy_filter'], addOnHubSpotValue),
  );

  // An unknown key contributes nothing rather than being passed through as an invalid option.
  // enterprise_accelerator is the live case: retired from the card, still present on stored
  // configurations, and absent from the portal's option list.
  assert.equal(hubSpotChoiceList(['enterprise_accelerator'], addOnHubSpotValue), '');
  assert.equal(
    hubSpotChoiceList(['shared_oauth_app', 'enterprise_accelerator'], addOnHubSpotValue),
    'Shared Google OAuth App',
  );

  // Nothing selected, and the shapes a stored configuration can actually arrive in.
  for (const empty of [[], undefined, null, 'not an array']) {
    assert.equal(hubSpotChoiceList(empty, addOnHubSpotValue), '');
    assert.equal(hubSpotChoiceList(empty, professionalServiceHubSpotValue), '');
  }

  // "No" is a real option carrying 119 Deals -- it is how the portal records "none", and it is
  // what an empty pick must become. Add-ons have no such option, so empty clears the property.
  assert.equal(PROFESSIONAL_SERVICES_NONE, 'No');
});

// DRIFT GUARD. The maps above are handwritten, so nothing stops someone adding a professional
// service or an add-on to the rate card and leaving it unmapped -- it would simply vanish from the
// Deal with no error anywhere.
test('every offered professional service and add-on has a HubSpot value', () => {
  const rules = require('./pricingRules');
  const { professionalServiceHubSpotValue, addOnHubSpotValue } = _test;

  for (const { key } of rules.professionalServiceOptions) {
    assert.ok(
      professionalServiceHubSpotValue[key],
      `professional service "${key}" is offered in the card but has no professional_services_package value`,
    );
  }

  for (const rule of rules.addOnRules) {
    if (rule.deprecated) {
      assert.equal(
        addOnHubSpotValue[rule.key],
        undefined,
        `retired add-on "${rule.key}" must not be written -- the portal has no option for it`,
      );
      continue;
    }
    assert.ok(
      addOnHubSpotValue[rule.key],
      `add-on "${rule.key}" is offered in the card but has no pricing_subscription_addons value`,
    );
  }

  // ...and nothing in the maps that the card cannot produce.
  const offeredServices = new Set(rules.professionalServiceOptions.map(({ key }) => key));
  for (const key of Object.keys(professionalServiceHubSpotValue)) {
    assert.ok(offeredServices.has(key), `${key} is mapped but not offered`);
  }
  const offeredAddOns = new Set(rules.addOnRules.map(({ key }) => key));
  for (const key of Object.keys(addOnHubSpotValue)) {
    assert.ok(offeredAddOns.has(key), `${key} is mapped but not an add-on`);
  }
});

// Both properties ride in the same update as everything else, which on Lock in runs AFTER the
// Deal's line items have been replaced. Whether either is a multiple-checkboxes field or a
// single-select was read off a screenshot; a single-select rejects a semicolon-joined value. The
// guard turns that from a lost lock into a warning.
test('the new Deal choice properties are covered by the rejection guard', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'QuoteOptionsFunction.js'),
    'utf8',
  );
  const guarded = source.match(/const UNVERIFIED_DEAL_PROPERTIES = \[([\s\S]*?)\n\];/);
  assert.ok(guarded, 'UNVERIFIED_DEAL_PROPERTIES must be findable');
  assert.match(guarded[1], /'professional_services_package',/);
  assert.match(guarded[1], /'pricing_subscription_addons',/);
});

// Onboarding defaults to None. It used to default to Quick Launch, which put $5,000 on every new
// configuration before the rep had chosen anything -- an opt-out charge on a customer quote.
test('a new configuration starts with no onboarding', () => {
  const card = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'cards', 'NylasPricingBuilder.tsx'),
    'utf8',
  );
  const empty = card.match(/const emptyInput = \(\): QuoteInput => \(\{([\s\S]*?)\n\}\);/);
  assert.ok(empty, 'emptyInput must be findable');
  assert.match(empty[1], /onboardingPackage: "none",/);
  assert.doesNotMatch(empty[1], /onboardingPackage: "quick_launch",/);

  // And 'none' is a real onboarding rule priced at zero, not an unrecognised string.
  const { onboardingRules } = require('./pricingRules');
  const none = onboardingRules.find(({ key }) => key === 'none');
  assert.ok(none, "onboardingRules must offer 'none'");
  assert.equal(none.oneTimeAmount, 0);
});

// THE CONTRACT SUMMARY IN WORDS. Holly, 2026-09-01: "I created a multi line text field property
// called pricing_contract_summary and I want you to write in a readable format what the contract
// summary was."
//
// Everything in it already exists on the Deal, either as a scattered pricing_* property or inside
// the pricing_quote_inputs_payload blob. Neither is readable. This asserts the summary says what
// the calculation says -- a summary that drifts from the quote beside it is worse than none.
const summaryFor = (input, name = 'Option A') => {
  const result = calculateQuote(input, defaultSettings());
  return _test.contractSummaryText({
    id: 'o1',
    name,
    input: result.normalizedInput || input,
    result,
  });
};

const FULL_INPUT = Object.freeze({
  startDate: '2026-10-01',
  termMonths: 24,
  paymentFrequency: 'quarterly_in_advance',
  volumes: { connect_ca: 5000, calendar_ca: 1000 },
  supportLevel: 'full',
  onboardingPackage: 'quick_launch',
  addOns: ['shared_oauth_app', 'privacy_filter'],
  professionalServices: ['gtm_review', 'google_verification_review'],
  autoRenewal: true,
  renewalTermMonths: 12,
  discretionaryDiscount: 0.05,
});

test('the contract summary states the term, dates and billing in words', () => {
  const summary = summaryFor(FULL_INPUT);

  assert.match(summary, /^Option A\n=+\n/);
  assert.match(summary, /Term {12}24 months/);
  // Day-month-year with a named month. "10/01/2026" means two different dates depending on who
  // is reading it, and this field is read by people, which is the whole point of it.
  assert.match(summary, /Starts {10}1 Oct 2026/);
  assert.match(summary, /Ends {12}30 Sep 2028/);
  assert.match(summary, /Billing {9}Quarterly In Advance/);
  assert.match(summary, /Auto-renews {5}1 Oct 2028 for 12 months/);
  assert.match(summary, /Notice by {7}1 Aug 2028/);
});

test('the contract summary prices every product, extra and discount', () => {
  const summary = summaryFor(FULL_INPUT);
  const result = calculateQuote(FULL_INPUT, defaultSettings());

  // Products, with the volume and the rate the customer is actually charged.
  assert.match(summary, /5,000 CA\/month at \$1\.39 = \$83,182\.95\/year \(5% off list\)/);

  // The extras, each named and priced.
  assert.match(summary, /Support: Full Support = \$9,793\.17\/year/);
  assert.match(summary, /Onboarding: Quick Launch = \$5,000\.00 one-time/);
  assert.match(summary, /Add-on: Shared Google OAuth App = \$2,484\.00\/year/);
  assert.match(summary, /Add-on: Privacy Filter Mode = \$5,175\.00\/year/);
  assert.match(
    summary,
    /Professional services \(2\): Go-to-Market Review, Google Verification Review = \$3,800\.00 one-time/,
  );

  // Discounts named individually -- "why is this below list" is what this section answers.
  assert.match(summary, /Multi-year term {7}2\.5%/);
  assert.match(summary, /Payment frequency {5}\+6%/);
  assert.match(summary, /Largest line discount 5%/);
  // Two decimals, not the raw 4.2839%. The exact figure lives on
  // pricing_blended_effective_discount_pct; this is a summary.
  assert.match(summary, /Blended effective {5}4\.28% \(\$10,722\.26 off list\)/);

  // TOTALS must equal the calculation, not a second arithmetic done here.
  assert.ok(summary.includes(`Total contract value $${result.tcv.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`));
  assert.match(summary, /Per quarter/);
});

test('the contract summary states the approval answer by name, including none', () => {
  // A real tier prints the approver's name, never the raw key -- "ccso" in a summary reads as a
  // bug rather than as a person.
  assert.match(summaryFor(FULL_INPUT), /Required {13}Sales Director/);

  // 'none' is STATED, not omitted. A blank here would read as "not checked" rather than
  // "checked, and nobody has to sign off".
  const clean = summaryFor({
    startDate: '2026-10-01',
    termMonths: 12,
    paymentFrequency: 'annual_in_advance',
    volumes: { connect_ca: 1000 },
    supportLevel: 'basic',
    onboardingPackage: 'none',
    addOns: [],
    professionalServices: [],
    autoRenewal: false,
  });
  assert.match(clean, /Required {13}No approval needed/);
  assert.match(clean, /Auto-renews {5}No/);
  assert.match(clean, /Onboarding: None/);
  // Sections with nothing in them are left out entirely rather than printed empty.
  assert.doesNotMatch(clean, /Add-on:/);
  assert.doesNotMatch(clean, /Professional services/);
  assert.doesNotMatch(clean, /DISCOUNTS/);
  // A zero-volume product is not on the contract and must not be listed.
  assert.doesNotMatch(clean, /Notetaker/);
});

test('the contract summary is written to the Deal and guarded', () => {
  const result = calculateQuote(FULL_INPUT, defaultSettings());
  const properties = _test.buildSelectedProperties(
    { id: 'o1', name: 'Option A', input: result.normalizedInput || FULL_INPUT, result },
    'draft',
  );
  assert.equal(
    properties.pricing_contract_summary,
    _test.contractSummaryText({
      id: 'o1',
      name: 'Option A',
      input: result.normalizedInput || FULL_INPUT,
      result,
    }),
  );
  // Multi-line, because that is the property type and the point.
  assert.ok(properties.pricing_contract_summary.includes('\n'));

  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'QuoteOptionsFunction.js'),
    'utf8',
  );
  const guarded = source.match(/const UNVERIFIED_DEAL_PROPERTIES = \[([\s\S]*?)\n\];/);
  assert.match(guarded[1], /'pricing_contract_summary',/);
});

// The SELLER BLOCK stays on the quote. It was removed once on 2026-09-01 and reverted the same
// day: the template's Seller section is configured to read *Quote owner*, so removing
// hubspot_owner_id is what a blank Seller looks like. The quote status is no longer pinned here --
// it is gated on needsApproval again, asserted in the status test above.
test('the seller block stays on the quote create', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'QuoteOptionsFunction.js'),
    'utf8',
  );
  const create = source.match(
    /quote = await client\.crm\.quotes\.basicApi\.create\(\{([\s\S]*?)\n      \},/,
  );
  assert.ok(create, 'the quote create call must be findable');
  assert.match(create[1], /hs_quote_owner_id: dealOwnerId,/, 'the seller block stays');
  assert.match(create[1], /\.\.\.sender,/, 'the sender block stays');
});

test('the card drops a template selection the Deal no longer offers', () => {
  const card = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'cards', 'NylasPricingBuilder.tsx'),
    'utf8',
  );
  // The rep's choice still wins -- but only while it is a choice this Deal can make.
  // Whitespace-tolerant: prettier wraps this across two lines at its current length.
  assert.match(
    card,
    /if \(current && templates\.some\(\(\{ id \}\) => id === current\)\)\s+return current;/,
  );
  // The bare form is what pinned a stale template across a pipeline move.
  assert.doesNotMatch(card, /\n\s*if \(current\) return current;/);
});

// THE CONTRACT START DATE IS NEVER TODAY.
//
// Holly, 2026-09-01: "It can't be today. So if it's the 1st of the month set it to the next
// month." The rule was `saved >= todayIso()`, which accepted a saved start date of TODAY. That is
// invisible on most days -- a stale date is in the past and gets replaced anyway -- and surfaces
// on exactly one: a configuration saved on the 1st restores "the 1st of this month", which is
// simultaneously today and a plausible first-of-month, so it was kept.
test('a restored start date must be strictly after today', () => {
  const card = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'cards', 'NylasPricingBuilder.tsx'),
    'utf8',
  );
  const usable = card.match(/const usableStartDate = \(saved\?: string \| null\) => \{([\s\S]*?)\n\};/);
  assert.ok(usable, 'usableStartDate must be findable');
  const body = usable[1]
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');

  assert.match(body, /saved > todayIso\(\) \? saved : firstDayOfFollowingMonth\(\)/);
  assert.doesNotMatch(
    body,
    /saved >= todayIso\(\)/,
    'a start date of today must fall through to the first of next month',
  );

  // The fallback is the first of the FOLLOWING month, so "not today" can never resolve to another
  // date in the current month either.
  assert.match(
    card,
    /const firstDayOfFollowingMonth = \(\) => \{[\s\S]*?today\.getMonth\(\) \+ 1, 1\)/,
  );

  // And an unusable or missing value takes the same path.
  assert.match(body, /if \(!saved \|\| !\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(saved\)\)/);
});

// THE EFFECTIVE DATE IS PINNED TO THE ORDER START.
//
// Holly, 2026-09-01: "the effective date needs to be the first of the next month."
//
// All three quote templates carry hs_contract_effective_start_date_type = ON_AGREEMENT, so
// HubSpot resolves the effective date to the acceptance date -- quote 42608004129 came out
// effective 2026-09-01 rather than the 2026-10-01 order start. Pinning the type to CUSTOM makes
// the date the app sends survive.
//
// This test does NOT assert that line items share the effective date. A billing start after the
// effective date is supported -- HubSpot files it under Future payments -- and an earlier version
// of this test wrongly treated that as the defect. What it does assert is that both values read
// the SAME source, so a change to one cannot silently move the other.
test('the quote effective start date is pinned to the same source as the line items', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'QuoteOptionsFunction.js'),
    'utf8',
  );
  const create = source.match(
    /quote = await client\.crm\.quotes\.basicApi\.create\(\{([\s\S]*?)\n      \},/,
  );
  assert.ok(create, 'the quote create call must be findable');
  const body = create[1]
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');

  assert.match(
    body,
    /hs_contract_effective_start_date: option\.result\.dates\.contractStartDate,/,
  );
  assert.match(body, /hs_contract_effective_start_date_type: 'CUSTOM',/);
  // Both sit inside the same guard, so the type is never sent without a date to pin.
  assert.match(body, /\.\.\.\(option\.result\.dates\.contractStartDate\s*\n?\s*\?\s*\{/);

  // ...and the line items bill from the SAME value. If these two ever read different sources the
  // quote can go out with lines starting after the contract does.
  const model = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'lineItemModel.js'),
    'utf8',
  );
  assert.match(
    model,
    /hs_recurring_billing_start_date: option\.result\.dates\.contractStartDate/,
  );
});

// ONE TEMPLATE LIST, no kinds and no contract picker. Removed 2026-09-01 with the change and
// renewal flows; these pin the shape that replaced them.
test('the template picker offers the one configured list, and is never left empty', () => {
  const all = [
    { id: '567553820432', name: 'New business' },
    { id: '583243623796', name: 'Change' },
    { id: '583243745379', name: 'Renewal' },
  ];
  const narrowed = normalizeSettings({
    ...defaultSettings(),
    enabledQuoteTemplateIds: ['567553820432'],
    defaultQuoteTemplateId: '567553820432',
  });
  assert.deepEqual(
    _test.offeredQuoteTemplates(all, narrowed).map(({ id }) => id),
    ['567553820432'],
  );
  assert.equal(_test.defaultQuoteTemplate(narrowed), '567553820432');

  // An EMPTY list means "offer every usable template" -- the behaviour before the setting
  // existed -- so an unconfigured portal is unchanged rather than shown an empty picker.
  const unconfigured = normalizeSettings({ ...defaultSettings() });
  assert.deepEqual(_test.offeredQuoteTemplates(all, unconfigured), all);

  // And a list whose every template has since been deleted falls back to everything rather than
  // rendering an empty picker, which reads as a broken card.
  const stale = normalizeSettings({
    ...defaultSettings(),
    enabledQuoteTemplateIds: ['999999999999'],
  });
  assert.deepEqual(_test.offeredQuoteTemplates(all, stale), all);
});

// THE QUOTE KINDS AND THE CONTRACT OBJECT ARE GONE. A guard, not a behaviour test.
//
// Both grew back more than once during the day they were being removed, because a kind -> template
// map and a contract picker are the obvious things to write when a renewal Deal needs different
// treatment. It does not: HubSpot will not create a change or renewal quote through the public API
// ("'hs_type' must be set to 'INITIAL'"), so those documents are made in HubSpot, from the Deal.
test('no quote-kind or Contract-object surface remains in the function', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'QuoteOptionsFunction.js'),
    'utf8',
  );
  for (const gone of [
    'quoteKind',
    'quoteTemplatesByKind',
    'quoteTemplatesForCategory',
    'contractApplies',
    'assertContractChosen',
    'contractOptions',
    'associatedContractIds',
    'inspect_contracts',
    'QUOTE_KIND_NOT_API_CREATABLE',
    'QUOTE_CONTRACT_REQUIRED',
  ]) {
    assert.equal(source.includes(gone), false, `${gone} is back in the function`);
  }
  // ...while the PRICING sense of "contract" is untouched. These are contract dates and terms,
  // not the CPQ Contract object, and confusing the two breaks the calculator.
  for (const kept of [
    'contract_term__months_',
    'hs_contract_effective_start_date',
    'contractStartDate',
    'pricing_contract_summary',
  ]) {
    assert.equal(source.includes(kept), true, `${kept} must not be removed`);
  }
});

// The server still checks the card's template against Settings, and still SUBSTITUTES rather than
// refusing. The per-category version of this guard was measured on 2026-09-01: with it, the right
// template three times in a row; without it, a Change Quote Template on a new-business Deal. The
// category is gone but the second half of the reason is not -- the card bundle caches in the
// browser independently of this function, so a stale card can still send a stale template.
test('a template outside the configured list is substituted, not refused', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'QuoteOptionsFunction.js'),
    'utf8',
  );
  assert.match(
    source,
    /const allowedTemplateIds = new Set\(quoteTemplateSettings\(settings\)\.enabledIds\.map\(String\)\);/,
  );
  assert.match(
    source,
    /if \(allowedTemplateIds\.size > 0 && !allowedTemplateIds\.has\(String\(requestedTemplateId\)\)\) \{[\s\S]{0,700}?templateId = String\(configuredDefault\);/,
    'a template outside the list is replaced by the configured default',
  );
  assert.doesNotMatch(
    source,
    /allowedTemplateIds[\s\S]{0,300}?throw new Error\('QUOTE_TEMPLATE/,
    'a wrong template is recoverable; a discarded configuration is not',
  );
});
