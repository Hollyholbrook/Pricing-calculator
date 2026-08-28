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

test('a published or viewed quote is never archived', async () => {
  // Every status that is not DRAFT must survive, including ones this code does not know about --
  // the test is positive for DRAFT so a status HubSpot adds later fails safe.
  for (const status of ['APPROVED', 'PENDING_APPROVAL', 'REJECTED', 'EXPIRED', 'SOMETHING_NEW', undefined]) {
    const { client, archived } = quoteClient(status);
    const result = await _test.archiveSupersededQuote(client, '111', '222');
    assert.equal(result, null, `status ${status} must not be archived`);
    assert.deepEqual(archived, [], `status ${status} must not be archived`);
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
  assert.match(body, /\.\.\.\(dealOwnerId \? \{ hubspot_owner_id/);

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
