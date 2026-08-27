const assert = require('node:assert/strict');
const test = require('node:test');

const { calculateQuote } = require('./calculator');
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
            events.push(`create:${properties.name}`);
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
    'create:Enterprise Drawdown Fee',
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
    ({ name }) => name === 'Connect - Email + Calendar Connected Accounts (CA)',
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
