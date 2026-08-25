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

test('locking an option creates replacements before archiving existing Deal line items', async () => {
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
            events.push(`create:${properties.nylas_line_item_key}`);
            return { id: 'new-1' };
          },
        },
      },
      deals: { basicApi: { update: async () => undefined } },
    },
  };

  const synced = await _test.syncDealLineItems(client, 'deal-1', state, settings);
  assert.equal(synced.count, 1);
  assert.deepEqual(events, [
    'create:subscription:nylas_enterprise',
    'archive:old-unmanaged',
    'archive:old-managed',
  ]);
});

test('a rejected replacement leaves existing Deal line items intact', async () => {
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
  const archived = [];
  const client = {
    crm: {
      associations: { v4: { basicApi: { getPage: async () => ({ results: [{ toObjectId: 'old-1' }] }) } } },
      lineItems: {
        basicApi: {
          archive: async (id) => archived.push(id),
          create: async () => {
            const error = new Error('validation failed');
            error.statusCode = 400;
            error.body = { category: 'VALIDATION_ERROR' };
            throw error;
          },
        },
      },
      deals: { basicApi: { update: async () => undefined } },
    },
  };

  await assert.rejects(
    _test.syncDealLineItems(client, 'deal-1', state, settings),
    /LINE_ITEM_SYNC_FAILED/,
  );
  assert.deepEqual(archived, []);
});
