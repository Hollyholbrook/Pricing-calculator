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

const assertDealAccess = (context, requestedDealId) => {
  const contextDealId = context?.crm?.objectId == null ? null : String(context.crm.objectId);
  // Every HubSpot call below uses the private-app token, so per-user object permissions are never
  // consulted. The CRM context is the only thing tying a caller to a Deal — without it any caller
  // who can invoke this function could read and mutate any Deal's pricing state.
  if (!contextDealId || !/^\d+$/.test(contextDealId)) throw new Error('INVALID_DEAL');
  const dealId = requestedDealId == null ? contextDealId : String(requestedDealId);
  if (!/^\d+$/.test(dealId)) throw new Error('INVALID_DEAL');
  if (dealId !== contextDealId) throw new Error('INVALID_DEAL');
  return dealId;
};

const getAccessToken = () => {
  const accessToken = process.env.PRIVATE_APP_ACCESS_TOKEN;
  if (!accessToken) throw new Error('CONFIGURATION_REQUIRED');
  return accessToken;
};

const getClient = () => new hubspot.Client({ accessToken: getAccessToken() });

const readDealState = async (client, dealId) => {
  try {
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

const syncDealLineItems = async (client, dealId, state, settings) => {
  const option = selectedOptionForDraft(state);
  assertCurrentSettings(option, settings);
  const desired = buildDealLineItems(option);
  const createdIds = [];
  try {
    const existingIds = await associatedIds(client, 'deals', dealId, 'line_items', 1_000);
    await inBatches(existingIds, (id) => client.crm.lineItems.basicApi.archive(id));
    await inBatches(desired, async (item) => {
        const created = await client.crm.lineItems.basicApi.create({
          properties: item.properties,
          associations: [createAssociation(dealId, 20)],
        });
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
    console.error('Nylas pricing line item sync failed.', error?.message || error);
    throw new Error(
      error?.message === 'TOO_MANY_LINE_ITEMS' ? 'TOO_MANY_LINE_ITEMS' : 'LINE_ITEM_SYNC_FAILED',
    );
  }
};

const quoteRecordUrl = (portalId, quoteId) =>
  portalId ? `https://app.hubspot.com/contacts/${portalId}/record/0-14/${quoteId}` : '';

const generateQuote = async (client, dealId, state, parameters, portalId, settings) => {
  const option = selectedOptionForDraft(state);
  assertCurrentSettings(option, settings);
  const templateId = String(process.env.QUOTE_TEMPLATE_ID || '');
  if (!/^\d+$/.test(templateId)) throw new Error('QUOTE_CONFIGURATION_REQUIRED');

  const content = normalizeQuoteContent(
    parameters.quoteContent,
    `${state.dealName} – ${option.name}`,
  );
  const hash = contentHash(option, content);
  if (state.quoteContentHash === hash && state.latestQuoteId) {
    return {
      quoteId: state.latestQuoteId,
      quoteUrl: state.latestQuoteUrl || quoteRecordUrl(portalId, state.latestQuoteId),
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
        hs_expiration_date: content.expirationDate,
        hs_contract_effective_start_date: option.input.startDate || '',
        hs_comments: quoteText.comments,
        hs_terms: quoteText.terms,
      },
      associations: [],
    });

    await client.crm.associations.v4.basicApi.createDefault(
      'quotes',
      String(quote.id),
      'deals',
      dealId,
    );
    await client.crm.associations.v4.basicApi.createDefault(
      'quotes',
      String(quote.id),
      'quote_template',
      templateId,
    );

    // Record each id as soon as it exists. Collecting them from Promise.all only records them
    // when every create succeeds, so the rollback below archived nothing in exactly the case it
    // was written for and leaked orphaned quote line items on every failed attempt.
    await Promise.all(lineItems.map(async (item) => {
      const created = await client.crm.lineItems.basicApi.create({
        properties: item.properties,
        associations: [createAssociation(quote.id, 68)],
      });
      createdLineItemIds.push(String(created.id));
    }));

    const [contactIds, companyIds] = await Promise.all([
      associatedIds(client, 'deals', dealId, 'contacts', 10),
      associatedIds(client, 'deals', dealId, 'companies', 1),
    ]);
    await Promise.all(
      contactIds.map((contactId) =>
        client.crm.associations.v4.basicApi.createDefault(
          'quotes',
          String(quote.id),
          'contacts',
          contactId,
        ),
      ),
    );
    if (companyIds[0]) {
      await client.crm.associations.v4.basicApi.createDefault(
        'quotes',
        String(quote.id),
        'companies',
        companyIds[0],
      );
    }

    const finalized = await client.crm.quotes.basicApi.update(quote.id, {
      properties: { hs_status: 'DRAFT' },
    });
    const quoteUrl =
      finalized.properties?.hs_quote_link || quoteRecordUrl(portalId, String(quote.id));
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
    console.error('Nylas pricing quote creation failed.', error?.message || error);
    throw new Error(
      error?.message === 'TOO_MANY_LINE_ITEMS' ? 'TOO_MANY_LINE_ITEMS' : 'QUOTE_CREATE_FAILED',
    );
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
    if (SAFE_ERRORS[error?.message]) return safeError(error.message);
    // Unrecognized errors still reach the user as a generic message, but they must leave a trace.
    // Logging the bare string left genuine bugs (e.g. a TypeError on a malformed payload)
    // completely invisible in the function logs.
    console.error('Nylas pricing action failed.', error?.stack || error?.message || error);
    return safeError('WRITE_FAILED', 500);
  }
};

exports._test = Object.freeze({
  associatedIds,
  deleteOption,
  lockLiveCalculation,
  syncDealLineItems,
});
