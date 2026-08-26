const crypto = require('node:crypto');
const hubspot = require('@hubspot/api-client');

const { QuoteValidationError, calculateQuote, normalizeStoredInput } = require('./calculator');
const {
  accountIdFromContext,
  isDealAllowed,
  isSettingsAdmin,
  readDealPipelines,
  readSettings,
  saveSettings,
  userIdFromContext,
} = require('./appSettings');
const {
  buildDealLineItems,
  buildQuoteLineItems,
  buildQuoteText,
  contentHash,
  normalizeQuoteContent,
} = require('./lineItemModel');

const OPTION_PROPERTY = 'pricing_quote_options_payload';
const SELECTED_OPTION_ID_PROPERTY = 'pricing_selected_option_id';
const SELECTED_OPTION_NAME_PROPERTY = 'pricing_selected_option_name';
const MAX_OPTIONS = 10;
const MAX_PAYLOAD_LENGTH = 60_000;

const SAFE_ERRORS = Object.freeze({
  CONFIGURATION_REQUIRED: 'The Nylas Pricing properties have not been provisioned yet.',
  CONFLICT: 'Another user changed these quote options. Reload the card and try again.',
  INVALID_DEAL: 'Nylas Pricing is available only on New Business Deals.',
  INVALID_OPTION: 'The quote option contains invalid or incomplete information.',
  INVALID_QUOTE_CONTENT: 'The quote display choices are invalid or incomplete.',
  LINE_ITEM_SYNC_FAILED: 'HubSpot could not replace the Deal line items. Review the Deal before trying again.',
  OPTION_BLOCKED: 'This option has blocking policy issues and cannot be selected.',
  OPTION_NOT_FOUND: 'The selected quote option could not be found.',
  OPTION_REQUIRED: 'Select or calculate a quote option first.',
  OPTION_RECALCULATION_REQUIRED: 'Pricing rules changed after this option was calculated. Recalculate it before continuing.',
  TOO_MANY_OPTIONS: `A Deal can contain no more than ${MAX_OPTIONS} active quote options.`,
  TOO_MANY_LINE_ITEMS: 'This Deal has more line items than the pricing app can manage. Reduce them and try again.',
  PAYLOAD_TOO_LARGE: 'The saved quote options exceed the allowed storage size.',
  PRODUCT_MAPPING_REQUIRED: 'A selected item is not mapped to the HubSpot product library.',
  QUOTE_CONFIGURATION_REQUIRED: 'The New Customer quote template has not been configured for the app.',
  QUOTE_CREATE_FAILED: 'HubSpot could not create the Quote. No partial Quote was retained.',
  SETTINGS_CONFIGURATION_REQUIRED: 'Pricing settings have not been initialized yet.',
  SETTINGS_CONFLICT: 'Another administrator changed the pricing settings. Reload and try again.',
  SETTINGS_INVALID: 'One or more pricing settings are invalid.',
  SETTINGS_UNAUTHORIZED: 'Only an authorized pricing administrator can change these settings.',
  WRITE_FAILED: 'HubSpot could not save the quote option. Try again or contact an administrator.',
});

const response = (statusCode, body) => ({ statusCode, body });

const safeError = (code, statusCode = 400, details) =>
  response(statusCode, {
    success: false,
    errorCode: code,
    error: SAFE_ERRORS[code] || SAFE_ERRORS.WRITE_FAILED,
    ...(details ? { details } : {}),
  });

const emptyDocument = () => ({ schemaVersion: '1.0', revision: 0, options: [] });

const parseDocument = (raw) => {
  if (!raw) return emptyDocument();
  try {
    const document = JSON.parse(raw);
    if (
      document?.schemaVersion !== '1.0' ||
      !Number.isInteger(document.revision) ||
      !Array.isArray(document.options)
    ) {
      return emptyDocument();
    }
    return document;
  } catch {
    return emptyDocument();
  }
};

const normalizeOptionName = (value, fallback) => {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, 80);
};

// A failed HubSpot call is the only thing that knows why a sync failed, and SAFE_ERRORS
// deliberately hides raw provider text from users. This keeps the shape of the failure -- HTTP
// status, HubSpot's error category, the error type, and a truncated, control-character-stripped
// message -- which is enough to name a bad property or a rejected value without exposing
// anything about the customer.
const safeProviderDiagnostics = (error, operation) => {
  const rawStatus =
    error?.statusCode || error?.status || error?.code || error?.response?.statusCode;
  const rawCategory = error?.body?.category || error?.response?.body?.category;
  const rawMessage = error?.body?.message || error?.response?.body?.message || error?.message;
  const errorType = String(error?.name || 'Error');
  return {
    operation: String(operation || 'unknown').slice(0, 60),
    providerStatus: /^\d{3}$/.test(String(rawStatus || '')) ? String(rawStatus) : 'unknown',
    providerCategory: /^[A-Z0-9_]{1,80}$/.test(String(rawCategory || ''))
      ? String(rawCategory)
      : 'unknown',
    errorType: /^[A-Za-z][A-Za-z0-9]{0,79}$/.test(errorType) ? errorType : 'Error',
    // HubSpot's validation messages lead with portal and object ids and only name the actual
    // problem at the very end, so a short cap truncates away the only useful part. 160 characters
    // cut "... : Quote Template should ha" mid-sentence.
    providerMessage: String(rawMessage || '')
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .trim()
      .slice(0, 400),
  };
};

const assertDealAccess = (context, requestedDealId) => {
  const contextDealId = context?.crm?.objectId == null ? null : String(context.crm.objectId);
  const dealId = requestedDealId == null ? contextDealId : String(requestedDealId);
  if (!dealId || !/^\d+$/.test(dealId)) throw new Error('INVALID_DEAL');
  // When the CRM context does carry a Deal id, the request must match it. HubSpot does not
  // always populate context.crm for a serverless call, so a missing context id cannot be fatal:
  // requiring it here made every card load fail with INVALID_DEAL.
  //
  // This means the check is advisory when the context is empty. Every call below uses the
  // private-app token, so per-user object permissions are never consulted, and a caller who can
  // invoke this function can address any Deal id. Closing that properly needs a different
  // mechanism (validating the caller against the Deal with their own credentials), not a guard
  // that takes the card down. Tracked as an open item.
  if (contextDealId && dealId !== contextDealId) throw new Error('INVALID_DEAL');
  return dealId;
};

const getAccessToken = () => {
  const accessToken = process.env.PRIVATE_APP_ACCESS_TOKEN;
  if (!accessToken) throw new Error('CONFIGURATION_REQUIRED');
  return accessToken;
};

const getClient = () => {
  // If @hubspot/api-client did not resolve at runtime (it is marked external in the esbuild
  // bundle, so the deployed function depends on it being installed), every call below fails with
  // a bare TypeError that the generic catch reports as "could not save the quote option".
  if (!hubspot?.Client) throw new Error('CONFIGURATION_REQUIRED');
  return new hubspot.Client({ accessToken: getAccessToken() });
};

const readDealState = async (client, dealId) => {
  try {
    if (!client?.crm?.deals?.basicApi) throw new Error('CONFIGURATION_REQUIRED');
    const deal = await client.crm.deals.basicApi.getById(dealId, [
      'dealtype',
      'pipeline',
      OPTION_PROPERTY,
      SELECTED_OPTION_ID_PROPERTY,
      SELECTED_OPTION_NAME_PROPERTY,
      'pricing_approval_status',
      'pricing_input_state_hash',
      'pricing_latest_quote_id',
      'pricing_latest_quote_url',
      'pricing_quote_content_hash',
      'pricing_line_item_sync_status',
      'dealname',
    ]);
    // A Deal response with no properties bag turned every downstream read into a TypeError that
    // escaped as a generic 500 naming no cause. Fail with something identifiable instead.
    if (!deal?.properties) throw new Error('CONFIGURATION_REQUIRED');
    return {
      dealType: deal.properties.dealtype || '',
      pipelineId: deal.properties.pipeline || '',
      document: parseDocument(deal.properties[OPTION_PROPERTY]),
      selectedOptionId: deal.properties[SELECTED_OPTION_ID_PROPERTY] || null,
      selectedOptionName: deal.properties[SELECTED_OPTION_NAME_PROPERTY] || null,
      approvalStatus: deal.properties.pricing_approval_status || 'draft',
      selectedStateHash: deal.properties.pricing_input_state_hash || null,
      latestQuoteId: deal.properties.pricing_latest_quote_id || null,
      latestQuoteUrl: deal.properties.pricing_latest_quote_url || null,
      quoteContentHash: deal.properties.pricing_quote_content_hash || null,
      lineItemSyncStatus: deal.properties.pricing_line_item_sync_status || 'not_started',
      dealName: deal.properties.dealname || 'Nylas Enterprise',
    };
  } catch (error) {
    if (error?.code === 404 || error?.statusCode === 404) throw new Error('INVALID_DEAL');
    if (error?.code === 400 || error?.statusCode === 400) {
      throw new Error('CONFIGURATION_REQUIRED');
    }
    throw error;
  }
};

const serializeDocument = (document) => {
  const serialized = JSON.stringify(document);
  if (serialized.length > MAX_PAYLOAD_LENGTH) throw new Error('PAYLOAD_TOO_LARGE');
  return serialized;
};

const assertRevision = (document, expectedRevision) => {
  if (expectedRevision == null) return;
  if (!Number.isInteger(expectedRevision) || expectedRevision !== document.revision) {
    throw new Error('CONFLICT');
  }
};

const writeDocument = async (client, dealId, document, additionalProperties = {}) => {
  await client.crm.deals.basicApi.update(dealId, {
    properties: {
      [OPTION_PROPERTY]: serializeDocument(document),
      ...additionalProperties,
    },
  });
};

const calculateAndSaveOption = async (client, dealId, state, parameters, settings) => {
  console.log('Nylas pricing calculate: validation started.');
  assertRevision(state.document, parameters.expectedRevision);
  const incoming = parameters.option;
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    throw new Error('INVALID_OPTION');
  }

  const result = calculateQuote(incoming.input, settings.pricingPolicy, settings.version);
  console.log('Nylas pricing calculate: calculation completed.');
  const existingIndex = incoming.id
    ? state.document.options.findIndex(({ id }) => id === incoming.id)
    : -1;
  if (existingIndex === -1 && state.document.options.length >= MAX_OPTIONS) {
    throw new Error('TOO_MANY_OPTIONS');
  }

  const now = new Date().toISOString();
  const previous = existingIndex >= 0 ? state.document.options[existingIndex] : null;
  const savedOption = {
    id: previous?.id || crypto.randomUUID(),
    name: normalizeOptionName(incoming.name, `Option ${state.document.options.length + 1}`),
    status: previous?.status === 'approved' ? 'pending_re_approval' : 'calculated',
    input: normalizeStoredInput(incoming.input, settings.pricingPolicy),
    result,
    createdAt: previous?.createdAt || now,
    updatedAt: now,
  };

  const options = [...state.document.options];
  if (existingIndex >= 0) options[existingIndex] = savedOption;
  else options.push(savedOption);

  const document = {
    ...state.document,
    revision: state.document.revision + 1,
    options,
  };
  console.log('Nylas pricing calculate: save started.');
  await writeDocument(client, dealId, document);
  console.log('Nylas pricing calculate: save completed.');
  return { document, option: savedOption };
};

const deleteOption = async (client, dealId, state, parameters) => {
  assertRevision(state.document, parameters.expectedRevision);
  if (!parameters.optionId) throw new Error('INVALID_OPTION');
  const deletingSelected = parameters.optionId === state.selectedOptionId;
  const options = state.document.options.filter(({ id }) => id !== parameters.optionId);
  if (options.length === state.document.options.length) throw new Error('OPTION_NOT_FOUND');
  const document = {
    ...state.document,
    revision: state.document.revision + 1,
    options,
  };
  if (deletingSelected) {
    const existingLineItemIds = await associatedIds(
      client,
      'deals',
      dealId,
      'line_items',
      1_000,
    );
    await inBatches(existingLineItemIds, (id) => client.crm.lineItems.basicApi.archive(id));
    await client.crm.deals.basicApi.update(dealId, {
      properties: {
        pricing_selected_option_id: '',
        pricing_selected_option_name: '',
        pricing_quote_inputs_payload: '',
        pricing_calculation_payload: '',
        pricing_calculation_status: '',
        pricing_arr: '',
        pricing_tcv: '',
        pricing_list_price_tcv: '',
        pricing_approval_tier_required: '',
        pricing_approval_status: 'draft',
        pricing_approval_reasons: '',
        pricing_line_item_sync_status: 'not_started',
        pricing_line_items_synced_at: '',
      },
    });
  }
  await writeDocument(client, dealId, document);
  return {
    document,
    selectedOptionId: deletingSelected ? null : state.selectedOptionId,
    selectedOptionName: deletingSelected ? null : state.selectedOptionName,
    approvalStatus: deletingSelected ? 'draft' : state.approvalStatus,
    lineItemSyncStatus: deletingSelected ? 'not_started' : state.lineItemSyncStatus,
  };
};

const toHubSpotDate = (date) => (date ? String(Date.parse(`${date}T00:00:00.000Z`)) : '');

const onboardingHubSpotValue = Object.freeze({
  quick_launch: 'quicklaunch',
  quick_launch_plus: 'quicklaunch_plus',
  strategic: 'strategic',
});

const productVolumeProperties = Object.freeze({
  connect_ca: 'pricing_connect_committed_monthly_volume',
  calendar_ca: 'pricing_calendar_committed_monthly_volume',
  notetaker_bot_hours: 'pricing_notetaker_committed_monthly_hours',
  agent_accounts: 'pricing_agent_accounts_committed_monthly_volume',
  agent_email_thousands: 'pricing_agent_email_committed_monthly_thousands',
  agent_storage_gb: 'pricing_agent_storage_committed_monthly_gb',
  agent_bandwidth_gb: 'pricing_agent_bandwidth_committed_monthly_gb',
});

const buildSelectedProperties = (option, approvalStatus) => {
  const { input, result } = option;
  // A stored option can predate normalizeStoredInput or arrive from an import, and validation
  // accepts an input with no volumes at all. Reading input.volumes.connect_ca directly turned that
  // into an unhandled TypeError and a generic 500 with no field detail.
  const volumes = input.volumes || {};
  const selectedProducts = result.quotedProducts.join(';');
  const effectiveDiscount = result.listTcv > 0 ? 1 - result.tcv / result.listTcv : 0;
  const properties = {
    [SELECTED_OPTION_ID_PROPERTY]: option.id,
    [SELECTED_OPTION_NAME_PROPERTY]: option.name,
    pricing_quote_inputs_payload: JSON.stringify(input),
    pricing_calculation_status: result.calculationStatus,
    pricing_drawdown_annual: String(result.proposedPlatformArr),
    pricing_recurring_per_period: String(result.recurringPerPeriod),
    pricing_one_time_fees: String(result.oneTime),
    pricing_largest_discretionary_discount_pct: String(
      result.largestDiscretionaryDiscount,
    ),
    pricing_calculation_payload: JSON.stringify(result),
    pricing_calculated_at: String(Date.parse(result.calculatedAt)),
    pricing_input_state_hash: result.stateHash,
    pricing_line_item_sync_status: 'stale',
    pricing_quoted_products: selectedProducts,
    pricing_product_count: String(result.quotedProducts.length),
    pricing_term_months: String(input.termMonths),
    pricing_payment_frequency: result.paymentFrequencyHubSpotValue || '',
    pricing_support_tier: input.supportLevel,
    pricing_onboarding_tier: onboardingHubSpotValue[input.onboardingPackage] || input.onboardingPackage,
    pricing_arr: String(result.committedArr),
    pricing_tcv: String(result.tcv),
    pricing_list_price_tcv: String(result.listTcv),
    pricing_blended_effective_discount_pct: String(roundForProperty(effectiveDiscount)),
    pricing_has_100pct_line: String(result.largestDiscretionaryDiscount === 1),
    pricing_100pct_lines_summary:
      result.largestDiscretionaryDiscount === 1 ? 'One or more quote lines are discounted 100%' : '',
    pricing_approval_tier_required: result.approvalTierRequired,
    pricing_approval_status: approvalStatus,
    pricing_approval_reasons: result.approvalReasons.join('\n'),
    pricing_primary_product: 'multi',
    pricing_ca_count: String(volumes.connect_ca || 0),
    contract_start_date: toHubSpotDate(input.startDate),
    pricing_contract_end_date: toHubSpotDate(result.dates.contractEndDate),
    pricing_auto_renewal: String(input.autoRenewal === true),
    pricing_renewal_term_months: input.autoRenewal ? String(input.renewalTermMonths) : '',
    pricing_renewal_date: toHubSpotDate(result.dates.renewalDate),
    pricing_non_renewal_notice_days: String(input.nonRenewalNoticeDays || 0),
    pricing_non_renewal_notice_date: toHubSpotDate(result.dates.nonRenewalNoticeDate),
    pricing_non_standard_terms: String(input.nonStandardTerms === true),
    special_terms: input.specialTerms || '',
  };

  if (approvalStatus === 'approved') {
    properties.pricing_last_approved_state_hash = result.stateHash;
    properties.pricing_line_item_sync_status = 'ready';
  }

  for (const [productKey, propertyName] of Object.entries(productVolumeProperties)) {
    properties[propertyName] = String(volumes[productKey] || 0);
  }
  return properties;
};

const roundForProperty = (value) => Math.round((value + Number.EPSILON) * 10_000) / 10_000;

const assertCurrentSettings = (option, settings) => {
  if (option?.result?.settingsVersion !== settings.version) {
    throw new Error('OPTION_RECALCULATION_REQUIRED');
  }
};

const chooseOption = async (client, dealId, state, parameters, settings) => {
  assertRevision(state.document, parameters.expectedRevision);
  const option = state.document.options.find(({ id }) => id === parameters.optionId);
  if (!option?.result) throw new Error('OPTION_NOT_FOUND');
  assertCurrentSettings(option, settings);
  if (option.result.blockingReasons.length > 0) throw new Error('OPTION_BLOCKED');

  const approvalStatus = 'draft';
  const now = new Date().toISOString();
  const options = state.document.options.map((item) => ({
    ...item,
    status:
      item.id === option.id
        ? 'selected'
        : item.status === 'selected'
          ? 'calculated'
          : item.status,
    updatedAt: item.id === option.id ? now : item.updatedAt,
  }));
  const document = {
    ...state.document,
    revision: state.document.revision + 1,
    options,
  };

  await writeDocument(
    client,
    dealId,
    document,
    buildSelectedProperties({ ...option, status: approvalStatus }, approvalStatus),
  );

  // HubSpot's native Deal totals are derived from associated line items. Keep
  // selection and line-item reconciliation in the same user action so the
  // official totals cannot intentionally diverge from the customer choice.
  const synced = await syncDealLineItems(
    client,
    dealId,
    {
      ...state,
      document,
      selectedOptionId: option.id,
      selectedOptionName: option.name,
      selectedStateHash: option.result.stateHash,
    },
    settings,
  );
  return {
    document,
    selectedOptionId: option.id,
    selectedOptionName: option.name,
    approvalStatus,
    lineItemSyncStatus: 'synced',
    lineItemCount: synced.count,
    lineItemsSyncedAt: synced.syncedAt,
  };
};

const lockLiveCalculation = async (
  client,
  dealId,
  state,
  parameters,
  portalId,
  settings,
) => {
  const result = calculateQuote(parameters.input, settings.pricingPolicy, settings.version);
  if (result.blockingReasons.length > 0) throw new Error('OPTION_BLOCKED');
  // Never carry the raw card input forward. It can hold human labels the CATALOG cannot key on,
  // duplicate professional-services entries, and — worst — redline text the rep already retracted
  // by unchecking redliningRequested, which would otherwise reach the customer-facing Quote.
  const input = normalizeStoredInput(parameters.input, settings.pricingPolicy);
  const liveOption = {
    id: `live-${result.stateHash.slice(0, 16)}`,
    name: 'Live calculation',
    status: 'draft',
    input,
    result,
  };
  const properties = buildSelectedProperties(liveOption, 'draft');
  properties[SELECTED_OPTION_ID_PROPERTY] = '';
  properties[SELECTED_OPTION_NAME_PROPERTY] = '';
  await client.crm.deals.basicApi.update(dealId, { properties });

  const liveState = {
    ...state,
    document: { schemaVersion: '1.0', revision: 0, options: [liveOption] },
    selectedOptionId: liveOption.id,
    selectedOptionName: liveOption.name,
    selectedStateHash: result.stateHash,
  };
  const synced = await syncDealLineItems(client, dealId, liveState, settings);
  const quote = await generateQuote(
    client,
    dealId,
    liveState,
    { quoteContent: parameters.quoteContent || {} },
    portalId,
    settings,
  );
  return { result, lineItemCount: synced.count, ...quote };
};

const selectedOptionForDraft = (state) => {
  const option = state.document.options.find(({ id }) => id === state.selectedOptionId);
  if (!option?.result || option.result.blockingReasons.length > 0) {
    throw new Error('OPTION_REQUIRED');
  }
  if (
    !state.selectedStateHash ||
    state.selectedStateHash !== option.result.stateHash
  ) {
    throw new Error('OPTION_RECALCULATION_REQUIRED');
  }
  return option;
};

const createAssociation = (toId, associationTypeId) => ({
  to: { id: String(toId) },
  types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId }],
});

const associatedIds = async (client, fromType, fromId, toType, limit = 100) => {
  const ids = [];
  let after;
  do {
    const page = await client.crm.associations.v4.basicApi.getPage(
      fromType,
      String(fromId),
      toType,
      after,
      Math.min(limit - ids.length, 500),
    );
    ids.push(...(page.results || []).map(({ toObjectId }) => String(toObjectId)));
    after = page.paging?.next?.after;
    if (ids.length >= limit && after != null && toType === 'line_items') {
      throw new Error('TOO_MANY_LINE_ITEMS');
    }
  } while (after != null && ids.length < limit);
  return ids;
};

const inBatches = async (values, action, batchSize = 10) => {
  for (let index = 0; index < values.length; index += batchSize) {
    await Promise.all(values.slice(index, index + batchSize).map(action));
  }
};

// buildDealLineItems and buildQuoteLineItems attach bookkeeping properties (nylas_pricing_managed,
// nylas_line_item_key, nylas_pricing_component, nylas_quote_option_id, nylas_pricing_state_hash,
// nylas_line_item_source) that only exist on the Line Item object if a portal has had them
// provisioned. HubSpot rejects a create naming a property it does not have, so in a portal that
// never got them EVERY line item create fails with a 400 and the whole sync collapses into
// "HubSpot could not replace the Deal line items."
//
// Send only the properties HubSpot defines. The trade-off is that the nylas_* bookkeeping is not
// written, so managed line items cannot be told apart from ones a rep added by hand — which
// matters for the open question of whether sync should preserve unmanaged items.
const HUBSPOT_LINE_ITEM_PROPERTIES = new Set([
  'name',
  'hs_product_id',
  'quantity',
  'price',
  'monthly_unit_price',
  'discount',
  'description',
  // 'product_category' deliberately omitted: it is not a HubSpot-defined Line Item property, so
  // in a portal that never had it created every create fails with a 400 and the sync collapses.
  'units',
  // Custom, not HubSpot-defined: it carries the monthly committed volume for each metered product,
  // which used to be stated in prose in the description. A portal that never created it rejects
  // the whole create, so createLineItem retries without it rather than failing the sync.
  'committed_quantity',
  'recurringbillingfrequency',
  'hs_recurring_billing_period',
  'hs_recurring_billing_terms',
  'hs_recurring_billing_number_of_payments',
  'hs_recurring_billing_start_date',
  'hs_billing_start_delay_type',
  // Drives display order on the Deal and the Quote.
  'hs_position_on_quote',
]);

const hubSpotLineItemProperties = (properties) =>
  Object.fromEntries(
    Object.entries(properties).filter(
      ([key, value]) => HUBSPOT_LINE_ITEM_PROPERTIES.has(key) && value != null,
    ),
  );

// HubSpot refuses to hydrate a line item from a product that is a BUNDLE:
//   "This API does not support creating line items from product bundles."
// The platform subscription maps to exactly such a product, so every create failed and the whole
// sync collapsed. A line item does not actually need a product: with hs_product_id dropped it
// still carries its name, price, quantity, description and billing terms, and shows correctly on
// the Deal and the Quote. It just is not linked back to the product record.
//
// The link is worth keeping wherever HubSpot allows it, so this only drops hs_product_id after
// HubSpot has specifically rejected the product, rather than guessing up front which products
// are bundles.
const isProductBundleRejection = (error) => {
  const message = String(
    error?.body?.message || error?.response?.body?.message || error?.message || '',
  );
  return /product bundle/i.test(message) || /could not hydrate/i.test(message);
};

// committed_quantity is a custom property. In a portal where it was never created, naming it
// returns 400 and — because the sync archives first and creates second — takes every line item on
// the Deal with it. The volume is useful but not worth that, so it is dropped and retried once.
const isUnknownPropertyRejection = (error, property) => {
  const message = String(
    error?.body?.message || error?.response?.body?.message || error?.message || '',
  );
  return message.includes(property) && /propert/i.test(message);
};

const createLineItem = async (client, properties, associations) => {
  try {
    return await client.crm.lineItems.basicApi.create({ properties, associations });
  } catch (error) {
    if (
      properties.committed_quantity != null &&
      isUnknownPropertyRejection(error, 'committed_quantity')
    ) {
      const { committed_quantity: unknown, ...withoutCommitted } = properties;
      console.warn(
        'Nylas pricing: this portal has no committed_quantity Line Item property. ' +
          'Creating the line item without it.',
      );
      return createLineItem(client, withoutCommitted, associations);
    }
    if (!properties.hs_product_id || !isProductBundleRejection(error)) throw error;
    const { hs_product_id: bundledProductId, ...withoutProduct } = properties;
    console.warn(
      `Nylas pricing: product ${bundledProductId} cannot back a line item (bundle). ` +
        'Creating the line item without a product link.',
    );
    return client.crm.lineItems.basicApi.create({
      properties: withoutProduct,
      associations,
    });
  }
};

const syncDealLineItems = async (client, dealId, state, settings) => {
  const option = selectedOptionForDraft(state);
  assertCurrentSettings(option, settings);
  const desired = buildDealLineItems(option);
  const createdIds = [];
  try {
    const existingIds = await associatedIds(client, 'deals', dealId, 'line_items', 1_000);
    await inBatches(existingIds, (id) => client.crm.lineItems.basicApi.archive(id));
    await inBatches(desired, async (item) => {
        const created = await createLineItem(
          client,
          hubSpotLineItemProperties(item.properties),
          [createAssociation(dealId, 20)],
        );
        createdIds.push(String(created.id));
    });

    const syncedAt = new Date().toISOString();
    await client.crm.deals.basicApi.update(dealId, {
      properties: {
        pricing_line_item_sync_status: 'synced',
        pricing_line_items_synced_at: syncedAt,
      },
    });
    return { count: desired.length, syncedAt };
  } catch (error) {
    await inBatches(
      createdIds,
      (id) => client.crm.lineItems.basicApi.archive(id).catch(() => undefined),
    );
    await client.crm.deals.basicApi
      .update(dealId, { properties: { pricing_line_item_sync_status: 'failed' } })
      .catch(() => undefined);
    // buildDealLineItems runs before the try, so PRODUCT_MAPPING_REQUIRED can never arrive here.
    // Log what HubSpot actually said before flattening it — otherwise every sync failure is
    // indistinguishable and undiagnosable.
    const diagnostics = safeProviderDiagnostics(error, 'sync_line_items');
    console.error('Nylas pricing line item sync failed.', diagnostics, error?.stack || error);
    if (error?.message === 'TOO_MANY_LINE_ITEMS') throw new Error('TOO_MANY_LINE_ITEMS');
    const failure = new Error('LINE_ITEM_SYNC_FAILED');
    failure.diagnostics = diagnostics;
    throw failure;
  }
};

// hs_quote_link is the only documented quote URL and it is the public buyer-facing one. HubSpot
// exposes no property for an internal CRM record link, and the hand-built
// /contacts/{portal}/record/0-14/{id} pattern 404s, so it is not built any more. A draft quote
// with no link yet gets no link, rather than one that leads nowhere.
// HubSpot accepts only a customizable quote template on this flow. A CPQ template is rejected at
// the very end, when the quote is flipped to DRAFT and validated as a whole -- after the quote and
// all of its line items have been created -- so the whole thing is built and then rolled back with
// a message that says nothing useful. Checking the type first turns that into an immediate,
// actionable error and creates nothing.
//
// The check itself must not become a new failure mode: if the template cannot be read (scope,
// permissions, an id that is not a template), it falls through to the original behaviour rather
// than blocking a quote that might have worked.
const REQUIRED_QUOTE_TEMPLATE_TYPE = 'customizable_quote_template';

// HubSpot's object type name for quote templates is not consistent across its APIs, so both
// spellings are tried rather than guessing one and failing the whole listing.
const QUOTE_TEMPLATE_OBJECT_TYPES = ['quote_template', 'quote_templates'];

const readQuoteTemplatePage = async (client, after) => {
  let lastError;
  for (const objectType of QUOTE_TEMPLATE_OBJECT_TYPES) {
    try {
      return await client.crm.objects.basicApi.getPage(
        objectType,
        100,
        after,
        ['hs_name', 'hs_type'],
        undefined,
        undefined,
        false,
      );
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
};

// Every template the portal has is listed, with no filtering on hs_type.
//
// Filtering here was a mistake: if hs_type is absent from the listing response -- a property that
// is not returned, or a different object type name -- then every template fails the comparison
// and the picker silently shows nothing, which is exactly what happened. A dropdown that hides
// the templates the user can see in HubSpot is worse than one that lists a template the API will
// later reject, and assertUsableQuoteTemplate already rejects a CPQ template up front with a
// clear message. Where hs_type IS present and wrong, the option is labelled rather than removed.
const usableQuoteTemplates = async (client) => {
  const templates = [];
  let after;
  try {
    do {
      const page = await readQuoteTemplatePage(client, after);
      for (const template of page?.results || []) {
        // No "(not supported)" suffix. That label came from the same wrong inference as the
        // filter before it: a cpq_template is not unsupported, it is the current model, and the
        // quote just had to declare hs_template_type CPQ_QUOTE to match it. Marking every real
        // template in the portal as unsupported was misinformation in the UI.
        templates.push({
          id: String(template.id),
          name: String(
            template?.properties?.hs_name || `Quote template ${template?.id}`,
          ).slice(0, 140),
        });
      }
      after = page?.paging?.next?.after;
    } while (after != null && templates.length < 200);
  } catch (error) {
    // The picker is a convenience. If templates cannot be listed the card falls back to the
    // configured secret rather than blocking the whole card from loading.
    console.warn(
      'Nylas pricing: could not list quote templates.',
      safeProviderDiagnostics(error, 'list_quote_templates'),
    );
    return [];
  }
  return templates.sort((left, right) => left.name.localeCompare(right.name));
};

// Observational only. HubSpot rejected one template for having hs_type 'cpq_template' when it
// wanted 'customizable_quote_template', but that single message is not enough to know the full
// rule, and blocking on it turned a diagnostic into a gate that refused every template in the
// portal. HubSpot decides; this just records what the template actually is so the failure -- if
// there is one -- names the type instead of leaving it to be guessed.
const describeQuoteTemplate = async (client, templateId) => {
  try {
    const template = await client.crm.objects.basicApi.getById('quote_template', templateId, [
      'hs_name',
      'hs_type',
    ]);
    const type = template?.properties?.hs_type || 'unknown';
    console.log(
      `Nylas pricing: quote template ${templateId} ("${template?.properties?.hs_name || ''}") ` +
        `has hs_type "${type}" (HubSpot has previously required "${REQUIRED_QUOTE_TEMPLATE_TYPE}").`,
    );
    return type;
  } catch (error) {
    console.warn(
      'Nylas pricing: could not read the quote template.',
      safeProviderDiagnostics(error, 'read_quote_template'),
    );
    return 'unknown';
  }
};

const generateQuote = async (client, dealId, state, parameters, portalId, settings) => {
  const option = selectedOptionForDraft(state);
  assertCurrentSettings(option, settings);
  const content = normalizeQuoteContent(
    parameters.quoteContent,
    `${state.dealName} – ${option.name}`,
  );
  // The rep's choice wins; QUOTE_TEMPLATE_ID remains the default for anyone who does not pick.
  const templateId = content.templateId || String(process.env.QUOTE_TEMPLATE_ID || '');
  if (!/^\d+$/.test(templateId)) throw new Error('QUOTE_CONFIGURATION_REQUIRED');
  const templateType = await describeQuoteTemplate(client, templateId);
  const hash = contentHash(option, content);
  if (state.quoteContentHash === hash && state.latestQuoteId) {
    return {
      quoteId: state.latestQuoteId,
      quoteUrl: state.latestQuoteUrl || '',
      reused: true,
    };
  }

  const lineItems = buildQuoteLineItems(option, content);
  const quoteText = buildQuoteText(option, content);
  let quote;
  const createdLineItemIds = [];
  try {
    quote = await client.crm.quotes.basicApi.create({
      properties: {
        hs_title: content.title,
        // Both dates are the order start date -- the contract start the calculator derived from
        // the rep's Start Date, not the raw input, so the quote and the Deal's contract dates
        // cannot disagree.
        //
        // hs_expiration_date is listed as required at creation, so it cannot simply be dropped.
        // Rather than invent a rolling "30 days from whenever this ran" and print a date on a
        // customer-facing quote that nobody chose, it is pinned to the order start date too.
        //
        // Never send an empty string for a date: in HubSpot that is not "no date", it lands as
        // the epoch and prints as January 1, 1970.
        ...(option.result.dates.contractStartDate
          ? {
              hs_expiration_date: option.result.dates.contractStartDate,
              hs_contract_effective_start_date: option.result.dates.contractStartDate,
            }
          : {}),
        hs_comments: quoteText.comments,
        hs_terms: quoteText.terms,
        // Required, and previously not sent at all. Every quote template in the portal is a
        // cpq_template, and a quote must declare CPQ_QUOTE to be compatible with them. Without
        // it the quote defaults to the legacy model and HubSpot rejects the CPQ template it is
        // associated with.
        hs_template_type: 'CPQ_QUOTE',
      },
      associations: [],
    });

    // Association type ids stated explicitly rather than relying on createDefault, which picks
    // the portal's DEFAULT type and not necessarily the one the CPQ quote model expects. These
    // are all created FROM the quote (0-14): deal 64, contact 69, company 71, quote template
    // 286. The line item association is declared on the line item itself, so it uses the
    // opposite direction (68) rather than the quote-side 67.
    await client.crm.associations.v4.basicApi.create('quotes', String(quote.id), 'deals', dealId, [
      { associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 64 },
    ]);
    await client.crm.associations.v4.basicApi.create(
      'quotes',
      String(quote.id),
      'quote_template',
      templateId,
      [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 286 }],
    );

    // Record each id as soon as it exists. Collecting them from Promise.all only records them
    // when every create succeeds, so the rollback below archived nothing in exactly the case it
    // was written for and leaked orphaned quote line items on every failed attempt.
    await Promise.all(lineItems.map(async (item) => {
      const created = await createLineItem(
        client,
        hubSpotLineItemProperties(item.properties),
        // 68, not 67. Association type ids are directional: 67 is defined FROM the quote
        // (0-14) TO the line item, but this association is declared on the line item's own
        // create call, so the "from" side is the line item (0-8). HubSpot rejected it with
        // "invalid from object type 0-8 ... expected: 0-14. For definition 0-67". 68 is the
        // line-item-to-quote direction, which is why it was here originally -- the same reason
        // the Deal sync uses 20 on its line-item creates.
        [createAssociation(quote.id, 68)],
      );
      createdLineItemIds.push(String(created.id));
    }));

    const [contactIds, companyIds] = await Promise.all([
      associatedIds(client, 'deals', dealId, 'contacts', 10),
      associatedIds(client, 'deals', dealId, 'companies', 1),
    ]);
    await Promise.all(
      contactIds.map((contactId) =>
        client.crm.associations.v4.basicApi.create(
          'quotes',
          String(quote.id),
          'contacts',
          contactId,
          [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 69 }],
        ),
      ),
    );
    if (companyIds[0]) {
      await client.crm.associations.v4.basicApi.create(
        'quotes',
        String(quote.id),
        'companies',
        companyIds[0],
        [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 71 }],
      );
    }

    // A quote created through the API is already DRAFT, so the update that set it was redundant
    // -- and it was the call that failed: it revalidates the whole quote, which is where the
    // template-type complaint came from. Read the quote instead of writing to it.
    const finalized = await client.crm.quotes.basicApi.getById(String(quote.id), [
      'hs_quote_link',
      'hs_status',
    ]);
    const quoteUrl = finalized?.properties?.hs_quote_link || '';
    const generatedAt = new Date().toISOString();
    await client.crm.deals.basicApi.update(dealId, {
      properties: {
        pricing_latest_quote_id: String(quote.id),
        pricing_latest_quote_url: quoteUrl,
        pricing_quote_content_hash: hash,
        pricing_quote_generation_status: 'draft_created',
        pricing_quote_generated_at: generatedAt,
      },
    });
    return { quoteId: String(quote.id), quoteUrl, generatedAt, reused: false };
  } catch (error) {
    for (const id of createdLineItemIds) {
      await client.crm.lineItems.basicApi.archive(id).catch(() => undefined);
    }
    if (quote?.id) await client.crm.quotes.basicApi.archive(quote.id).catch(() => undefined);
    await client.crm.deals.basicApi
      .update(dealId, { properties: { pricing_quote_generation_status: 'failed' } })
      .catch(() => undefined);
    // normalizeQuoteContent and buildQuoteLineItems both run before the try, so
    // INVALID_QUOTE_CONTENT and PRODUCT_MAPPING_REQUIRED cannot reach this catch. Everything that
    // does reach it is a HubSpot failure, and its detail is the only diagnostic that exists.
    const diagnostics = {
      ...safeProviderDiagnostics(error, 'generate_quote'),
      // Which template was used, and what HubSpot says it is. Without this the rep sees a
      // template complaint with no way to tell which template caused it.
      quoteTemplateId: templateId,
      quoteTemplateType: templateType,
    };
    console.error('Nylas pricing quote creation failed.', diagnostics, error?.stack || error);
    if (error?.message === 'TOO_MANY_LINE_ITEMS') throw new Error('TOO_MANY_LINE_ITEMS');
    const failure = new Error('QUOTE_CREATE_FAILED');
    failure.diagnostics = diagnostics;
    throw failure;
  }
};

const stateResponse = (state) => ({
  optionSet: state.document,
  selectedOptionId: state.selectedOptionId,
  selectedOptionName: state.selectedOptionName,
  approvalStatus: state.approvalStatus,
  lineItemSyncStatus: state.lineItemSyncStatus,
  latestQuoteId: state.latestQuoteId,
  latestQuoteUrl: state.latestQuoteUrl,
});

exports.main = async (context) => {
  try {
    const parameters = context?.parameters || {};
    const action = parameters.action;
    console.log(`Nylas pricing action started: ${String(action || 'missing')}.`);
    const accessToken = getAccessToken();
    const accountId = accountIdFromContext(context);
    const userId = userIdFromContext(context);

    if (action === 'get_settings') {
      const [settingsState, pipelines] = await Promise.all([
        readSettings(accessToken, accountId),
        readDealPipelines(accessToken),
      ]);
      return response(200, {
        success: true,
        settings: settingsState.settings,
        configured: settingsState.configured,
        canEdit: isSettingsAdmin(context),
        pipelines,
      });
    }
    if (action === 'update_settings') {
      if (!isSettingsAdmin(context)) throw new Error('SETTINGS_UNAUTHORIZED');
      const settings = await saveSettings(
        accessToken,
        accountId,
        userId,
        parameters.settings,
        parameters.expectedVersion,
      );
      return response(200, { success: true, settings, configured: true, canEdit: true });
    }

    const dealId = assertDealAccess(context, parameters.dealId);
    const client = getClient();
    const [state, settingsState] = await Promise.all([
      readDealState(client, dealId),
      readSettings(accessToken, accountId),
    ]);
    console.log('Nylas pricing action: deal state and settings loaded.');
    if (!settingsState.configured) throw new Error('SETTINGS_CONFIGURATION_REQUIRED');
    const settings = settingsState.settings;
    if (!isDealAllowed(settings, state.dealType, state.pipelineId)) throw new Error('INVALID_DEAL');

    if (action === 'list') {
      return response(200, {
        success: true,
        ...stateResponse(state),
        quoteTemplates: await usableQuoteTemplates(client),
        defaultQuoteTemplateId: String(process.env.QUOTE_TEMPLATE_ID || ''),
        // The card shows this as the Quote title placeholder, so a rep who leaves the field
        // blank can see the name the quote will actually get rather than being surprised by it.
        dealName: state.dealName,
      });
    }
    if (action === 'preview') {
      return response(200, {
        success: true,
        previewResult: calculateQuote(parameters.input, settings.pricingPolicy, settings.version),
      });
    }
    if (action === 'lock_live') {
      const locked = await lockLiveCalculation(
        client,
        dealId,
        state,
        parameters,
        accountId,
        settings,
      );
      return response(200, { success: true, ...locked });
    }
    if (action === 'calculate_and_save') {
      const saved = await calculateAndSaveOption(client, dealId, state, parameters, settings);
      return response(200, {
        success: true,
        optionSet: saved.document,
        option: saved.option,
        selectedOptionId: state.selectedOptionId,
        selectedOptionName: state.selectedOptionName,
        approvalStatus: state.approvalStatus,
      });
    }
    if (action === 'delete') {
      const deleted = await deleteOption(client, dealId, state, parameters);
      return response(200, {
        success: true,
        optionSet: deleted.document,
        selectedOptionId: deleted.selectedOptionId,
        selectedOptionName: deleted.selectedOptionName,
        approvalStatus: deleted.approvalStatus,
        lineItemSyncStatus: deleted.lineItemSyncStatus,
      });
    }
    if (action === 'select') {
      const selected = await chooseOption(client, dealId, state, parameters, settings);
      return response(200, {
        success: true,
        ...selected,
        optionSet: selected.document,
        document: undefined,
      });
    }
    if (action === 'sync_line_items') {
      const synced = await syncDealLineItems(client, dealId, state, settings);
      return response(200, {
        success: true,
        ...stateResponse({ ...state, lineItemSyncStatus: 'synced' }),
        lineItemCount: synced.count,
        lineItemsSyncedAt: synced.syncedAt,
      });
    }
    if (action === 'generate_quote') {
      const quote = await generateQuote(
        client,
        dealId,
        state,
        parameters,
        accountId,
        settings,
      );
      return response(200, {
        success: true,
        ...stateResponse({
          ...state,
          latestQuoteId: quote.quoteId,
          latestQuoteUrl: quote.quoteUrl,
        }),
        ...quote,
      });
    }
    return safeError('INVALID_OPTION');
  } catch (error) {
    if (error instanceof QuoteValidationError) {
      return safeError('INVALID_OPTION', 400, {
        field: error.field,
        validationCode: error.code,
      });
    }
    if (String(error?.message || '').startsWith('INVALID_SETTINGS:')) {
      return safeError('SETTINGS_INVALID', 400, {
        field: String(error.message).slice('INVALID_SETTINGS:'.length),
      });
    }
    if (SAFE_ERRORS[error?.message]) return safeError(error.message, 400, error.diagnostics);
    // Unrecognized errors still reach the user as a generic message, but they must leave a trace.
    // Logging the bare string left genuine bugs (e.g. a TypeError on a malformed payload)
    // completely invisible in the function logs.
    console.error(
      `Nylas pricing action failed: ${String(context?.parameters?.action || 'missing')} · ${
        error?.name || 'Error'
      }`,
      error?.stack || error?.message || error,
    );
    return safeError('WRITE_FAILED', 500);
  }
};

exports._test = Object.freeze({
  associatedIds,
  deleteOption,
  lockLiveCalculation,
  syncDealLineItems,
});
