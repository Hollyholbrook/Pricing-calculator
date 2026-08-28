const crypto = require('node:crypto');
const hubspot = require('@hubspot/api-client');

const { QuoteValidationError, calculateQuote, normalizeStoredInput } = require('./calculator');
const { inspectProductLibrary } = require('./productLibrary');
const {
  accountIdFromContext,
  isDealAllowed,
  isSettingsAdmin,
  readDealPipelines,
  readSettings,
  saveSettings,
  userIdFromContext,
  dealCategory,
} = require('./appSettings');
const {
  buildDealLineItems,
  buildQuoteLineItems,
  contentHash,
  normalizeQuoteContent,
} = require('./lineItemModel');

const OPTION_PROPERTY = 'pricing_quote_options_payload';
const SELECTED_OPTION_ID_PROPERTY = 'pricing_selected_option_id';
const SELECTED_OPTION_NAME_PROPERTY = 'pricing_selected_option_name';
// The 1-Sub quote template. Held in code so the app defaults correctly even where the
// QUOTE_TEMPLATE_ID secret is unset or stale -- the previous fallback was "first template
// alphabetically", which silently generated quotes against whichever template happened to sort
// first, and is the likeliest reason a generated quote rendered a template nobody was editing.
//
// This id takes PRECEDENCE over the QUOTE_TEMPLATE_ID secret, which is the opposite of the usual
// config-beats-code order, and deliberately so.
//
// That secret is set to the "Sales Quote - New Customers" template -- see the wording of
// QUOTE_CONFIGURATION_REQUIRED below, which predates this app's use of a picker. While the secret
// won, it silently overrode the intended default on every card load: the card kept landing on
// Sales Quote - New Customers even though "(TESTING) 1 sub" sorts FIRST in the list, so not even
// the alphabetical fallback could be blamed.
//
// The secret is kept as a last resort so another portal can still point the app somewhere without
// a deploy. To hand control back to configuration, set the secret to the intended template and
// clear this constant.
const DEFAULT_QUOTE_TEMPLATE_ID = '567553820432';

const configuredQuoteTemplateId = () =>
  DEFAULT_QUOTE_TEMPLATE_ID || String(process.env.QUOTE_TEMPLATE_ID || '');

// The Deal property behind the quote template's "Payment method" token, and the portal's internal
// value for each of the card's two options.
//
// The two values below came from the portal as the option LABELS. HubSpot often uses the label as
// the internal value for a hand-created dropdown, but not always -- so the Deal update that
// carries this property retries without it if HubSpot rejects it (see updateDealProperties). A
// mismatch therefore costs a warning in the logs and an unset property, never a failed Lock in.
// If that warning appears, read the real internal values off the property in Settings and correct
// them here.
//
// payment_method, payment_frequency, auto_renewal__c and contract_term__months_ are the ONLY
// non-pricing_* Deal properties the app writes. Everything else it touches on a Deal is namespaced
// pricing_*; see claude/quote-text-ownership.md for why that mattered.
const DEAL_PAYMENT_METHOD = Object.freeze({
  property: 'payment_method',
  values: Object.freeze({
    credit_card: 'Credit Card',
    ach: 'ACH/Bank Transfer',
  }),
});

// Auto-renewal, as Yes/No. The __c suffix says this one is synced from Salesforce, so its values
// are that system's, not HubSpot's -- another reason not to infer them.
//
// The card's control is inverted ("Non-renewal" checked means autoRenewal false) and the input
// defaults to true, so an untouched configuration writes Yes.
const DEAL_AUTO_RENEWAL = Object.freeze({
  property: 'auto_renewal__c',
  values: Object.freeze({
    yes: 'Yes',
    no: 'No',
  }),
});

// The payment schedule the rep chose, mirrored onto the Deal. Unlike payment_method this needs no
// new control: the choice is already in the calculation input, so the Deal simply records it.
const DEAL_PAYMENT_FREQUENCY = Object.freeze({
  property: 'payment_frequency',
  values: Object.freeze({
    annual_in_advance: 'Annual In Advance',
    semi_annual_in_advance: 'Semi-Annual In Advance',
    quarterly_in_advance: 'Quarterly In Advance',
    monthly_in_advance: 'Monthly In Advance',
  }),
});

// The contract term in months, mirrored onto the Deal alongside pricing_term_months.
//
// The name is copied exactly, double underscore and trailing underscore included: HubSpot generates
// that shape from a label like "Contract Term (Months)", and "tidying" it to contract_term_months
// would simply miss.
const DEAL_CONTRACT_TERM_PROPERTY = 'contract_term__months_';

// Every Deal enumeration the app mirrors from the calculator. Listed once so the retry guard below
// covers all of them: these are the only properties here whose names and values came from outside
// the code, and any one of them can be wrong.
const DEAL_CHOICE_PROPERTIES = [
  DEAL_PAYMENT_METHOD,
  DEAL_PAYMENT_FREQUENCY,
  DEAL_AUTO_RENEWAL,
];

// Properties added from a pasted list of internal names rather than from a verified write. Any one
// of them could be misnamed, and they ride in the same update as everything else -- which on Lock
// in runs after the Deal's line items have already been replaced. So the guard below drops a
// rejected one and retries, exactly as it does for the two enumerations above.
const UNVERIFIED_DEAL_PROPERTIES = [
  DEAL_CONTRACT_TERM_PROPERTY,
  // Both of these mirror a property the app already writes under a different name --
  // pricing_approval_reasons and pricing_latest_quote_id -- because the portal's list shows these
  // names instead and the approval block reads one of each pair. Guarded, so the one the portal
  // lacks is dropped rather than failing the commit.
  'pricing_approval_notes',
  'pricing_quote_id',
  'pricing_contract_type',
  'pricing_multi_year_discount_pct',
  'pricing_multi_product_discount_pct',
  'pricing_discount_reason',
  'pricing_approval_timestamp',
];

// '' is a real answer meaning "not specified", and must clear the property rather than be ignored.
// An unrecognised choice is dropped instead: the card is the only caller, so that can only mean the
// card and this map have drifted, and a bad enumeration value fails the whole update.
const choiceProperty = ({ property, values }, choice) => {
  if (!property) return {};
  if (choice === '' || choice == null) return { [property]: '' };
  const value = values[String(choice)];
  return value ? { [property]: value } : {};
};

const paymentMethodProperties = (paymentMethod) =>
  choiceProperty(DEAL_PAYMENT_METHOD, paymentMethod);

const paymentFrequencyProperties = (paymentFrequency) =>
  choiceProperty(DEAL_PAYMENT_FREQUENCY, paymentFrequency);

// Always one or the other, never blank: autoRenewal is a boolean the card always has a value for,
// so there is no "not specified" case to clear.
const autoRenewalProperties = (autoRenewal) =>
  choiceProperty(DEAL_AUTO_RENEWAL, autoRenewal === true ? 'yes' : 'no');

const contractTermProperties = (termMonths) => {
  const months = Number(termMonths);
  // Only a real term. A blank or nonsense value would either fail the update or overwrite a good
  // number with junk, and the term is always present on a calculated option.
  if (!Number.isFinite(months) || months <= 0) return {};
  return { [DEAL_CONTRACT_TERM_PROPERTY]: String(months) };
};

// Free text the rep types when they discount. Trimmed and capped rather than validated: there is no
// right answer to check it against, and an over-long value would fail the whole update.
const DISCOUNT_REASON_MAX_LENGTH = 4_000;

const discountReasonProperties = (discountReason) => {
  if (typeof discountReason !== 'string') return {};
  return {
    pricing_discount_reason: discountReason.trim().slice(0, DISCOUNT_REASON_MAX_LENGTH),
  };
};

// The seller on the quote IS set, to the Deal owner. See generateQuote.
//
// This comment used to say the opposite: that a quote inherits the owner from its associated deal
// per HubSpot's Quotes guide, so writing it would override correct behaviour with something worse.
// That was a documented sentence taken on faith and never checked against this portal. Superseded
// 2026-08-28 -- hubspot_owner_id is now read from the Deal and written explicitly.
//
// Still NOT set: the hs_sender_* block, which is what the Seller section actually prints. If it
// does not follow the owner, populate hs_sender_firstname/_lastname/_email from the Owners API --
// but look at a generated quote first rather than sending six unverified properties.
//
// The card briefly sent context.user for this. That was removed rather than left dormant: it put
// the signed-in user's name and email into a request that had no use for them.

// "Accept without signature" on the quote. One of clickwrap | esignature | print_and_sign, per
// HubSpot's Quotes guide. Named rather than inlined because it is a business choice, not a
// mechanic: changing it changes what the customer is asked to do.
const QUOTE_ACCEPTANCE_METHOD = 'clickwrap';

const MAX_OPTIONS = 10;
const MAX_PAYLOAD_LENGTH = 60_000;

const SAFE_ERRORS = Object.freeze({
  CONFIGURATION_REQUIRED: 'The Nylas Pricing properties have not been provisioned yet.',
  CONFLICT: 'Another user changed these quote options. Reload the card and try again.',
  INVALID_DEAL: 'Nylas Pricing is available only on New Business Deals.',
  INVALID_OPTION: 'The quote option contains invalid or incomplete information.',
  INVALID_QUOTE_CONTENT: 'The quote display choices are invalid or incomplete.',
  LINE_ITEM_SYNC_FAILED: 'HubSpot could not replace the Deal line items. Review the Deal before trying again.',
  DISCOUNT_REASON_REQUIRED:
    'A discount reason is required when any discount is applied. Add one and try again.',
  QUOTE_CONTACT_REQUIRED:
    'A contact is required on the Quote. Choose one on the pricing card, or associate a contact ' +
    'with this Deal.',
  OPTION_BLOCKED: 'This option has blocking policy issues and cannot be selected.',
  PAYMENT_METHOD_REQUIRES_BANK_TRANSFER:
    'Credit card is not permitted on an invoice above the limit. Set Payment Method to ' +
    'Bank transfer / ACH before locking in.',
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

// payment_method is the one Deal property here whose name and values came from outside the code.
// Bundling it into the same update as the pricing_* properties keeps the write atomic, but it also
// means a rejection over that one property would fail everything alongside it -- including, on Lock
// in, the record of a calculation whose line items have already been replaced. So a rejection
// naming it drops it and retries once.
const updateDealProperties = async (client, dealId, properties) => {
  try {
    return await client.crm.deals.basicApi.update(dealId, { properties });
  } catch (error) {
    // Any rejection that NAMES one of the mirrored properties, not just an unknown-property one.
    // The likelier failure is a valid property with an invalid enumeration value, and HubSpot words
    // that differently -- "not a valid option", "propertyValue" -- so matching on /propert/i would
    // miss exactly the case this guard exists for.
    const message = String(
      error?.body?.message || error?.response?.body?.message || error?.message || '',
    );
    const guarded = [
      ...DEAL_CHOICE_PROPERTIES.map(({ property }) => property),
      ...UNVERIFIED_DEAL_PROPERTIES,
    ];
    const rejectedProperty = guarded.find(
      (property) =>
        property && properties[property] != null && message.includes(property),
    );
    if (!rejectedProperty) throw error;
    const { [rejectedProperty]: rejected, ...rest } = properties;
    console.warn(
      `Nylas pricing: HubSpot rejected ${rejectedProperty}="${rejected}". Saving without it. ` +
        'Check the internal name and option values on that Deal property.',
      safeProviderDiagnostics(error, `update_deal_${rejectedProperty}`),
    );
    // Recursive, so a portal where more than one of these is wrong still saves the rest.
    return updateDealProperties(client, dealId, rest);
  }
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
      'pricing_discount_reason',
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
      // Read back so the card can restore it. It used to be write-only -- sent on Lock in, stored
      // on the Deal, never returned -- which was harmless while the field was optional. It stopped
      // being harmless the moment a discount reason became REQUIRED: every reload emptied the box
      // and disabled Lock in until the rep retyped a reason the Deal already had.
      discountReason: deal.properties.pricing_discount_reason || '',
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
  // Through updateDealProperties, not the API directly: additionalProperties can now carry
  // payment_method, and that write must stay unable to fail the whole save.
  await updateDealProperties(client, dealId, {
    [OPTION_PROPERTY]: serializeDocument(document),
    ...additionalProperties,
  });
};

const calculateAndSaveOption = async (client, dealId, state, parameters, settings) => {
  console.log('Nylas pricing calculate: validation started.');
  assertRevision(state.document, parameters.expectedRevision);
  const incoming = parameters.option;
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    throw new Error('INVALID_OPTION');
  }

  const result = calculateQuote(
    incoming.input,
    settings.pricingPolicy,
    settings.version,
    dealCategory(settings, state.dealType, state.pipelineId),
  );
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
    // Raw fractions, matching pricing_blended_effective_discount_pct above: 0.025 for 2.5%, not
    // 2.5. HubSpot's percentage property type renders the multiplication.
    pricing_multi_year_discount_pct: String(roundForProperty(result.termDiscount)),
    // NOT a percentage, despite the property name -- this is the total discount in DOLLARS across
    // the full term, list TCV minus quoted TCV. Holly's instruction: "multi-product discount should
    // be the total discount amount for full term even if it's %". Left as-is rather than renamed so
    // the existing approval block keeps reading it; the name is the portal's, not a bug here.
    pricing_multi_product_discount_pct: String(
      Math.round((result.listTcv - result.tcv + Number.EPSILON) * 100) / 100,
    ),
    // Every quote this app builds is the drawdown model: one prepaid pool the metered products
    // draw against. 'flat' exists for a volume-commitment shape the calculator does not produce.
    pricing_contract_type: 'drawdown',
    pricing_has_100pct_line: String(result.largestDiscretionaryDiscount === 1),
    pricing_100pct_lines_summary:
      result.largestDiscretionaryDiscount === 1 ? 'One or more quote lines are discounted 100%' : '',
    pricing_approval_tier_required: result.approvalTierRequired,
    pricing_approval_status: approvalStatus,
    pricing_approval_reasons: result.approvalReasons.join('\n'),
    // Written to BOTH names on purpose. The app has always written
    // pricing_approval_reasons, but the portal's property list shows
    // "Pricing: Approval Notes" / pricing_approval_notes and no
    // pricing_approval_reasons -- and the approval block reads one of them. Rather than guess
    // which, both carry the same text; the guard drops whichever the portal does not have.
    pricing_approval_notes: result.approvalReasons.join('\n'),
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
  const result = calculateQuote(
    parameters.input,
    settings.pricingPolicy,
    settings.version,
    dealCategory(settings, state.dealType, state.pipelineId),
  );
  if (result.blockingReasons.length > 0) throw new Error('OPTION_BLOCKED');
  // Credit card is not permitted above the invoice limit -- ACH/Bank Transfer (wire) is required.
  //
  // Checked HERE, before anything is written, and deliberately not only in the card. The card also
  // enforces it, but a card can be running stale code or an older cached bundle, and this is the
  // one place that sees the real calculation and the submitted payment method together.
  //
  // Position matters as much as the check: syncDealLineItems ARCHIVES the Deal's line items before
  // it creates replacements, so a guard that ran later would refuse the lock only after emptying
  // the Deal. Everything below this line writes; nothing above it does.
  if (result.requiresBankTransfer && parameters.paymentMethod !== 'ach') {
    console.warn(
      'Nylas pricing: refused Lock in -- largest invoice ' +
        `${result.largestInvoiceAmount} exceeds the ${result.creditCardMaximumInvoice} ` +
        `credit card limit and payment method was "${parameters.paymentMethod || 'unset'}".`,
    );
    throw new Error('PAYMENT_METHOD_REQUIRES_BANK_TRANSFER');
  }
  // A discount without a stated reason cannot be locked in. Holly, 2026-08-28.
  //
  // The reason is what the approver reads and what the Deal keeps as the record of why a
  // concession was given -- an empty one makes the approval trail worthless, and it is the field
  // nobody fills in unless something stops them.
  //
  // largestDiscretionaryDiscount is the max across every discount surface -- products, add-ons,
  // support, onboarding and professional services -- so this catches a discount anywhere, not
  // just the deal-wide one. Verified against each surface individually.
  //
  // Same position rule as the guard above: this is still ABOVE every write. The card blocks the
  // button too, but the card is not the only way in.
  if (
    result.largestDiscretionaryDiscount > 0 &&
    String(parameters.discountReason || '').trim() === ''
  ) {
    console.warn(
      'Nylas pricing: refused Lock in -- a discount of ' +
        `${result.largestDiscretionaryDiscount} was entered with no discount reason.`,
    );
    throw new Error('DISCOUNT_REASON_REQUIRED');
  }
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
  // The live option IS the selection now that it is persisted. Blanking these left the Deal
  // claiming nothing was selected while its line items and Quote said otherwise, and gave the card
  // nothing to identify on reload.
  properties[SELECTED_OPTION_ID_PROPERTY] = liveOption.id;
  properties[SELECTED_OPTION_NAME_PROPERTY] = liveOption.name;
  Object.assign(properties, paymentMethodProperties(parameters.paymentMethod));
  // From the normalized input, not the raw parameters: that is the value the calculation actually
  // used, so the Deal cannot disagree with the pricing.
  Object.assign(properties, paymentFrequencyProperties(input.paymentFrequency));
  // The rep's own words, and when they committed. Neither is a pricing input -- they change no
  // number and normalizeStoredInput would strip them from option.input.
  Object.assign(properties, autoRenewalProperties(input.autoRenewal));
  Object.assign(properties, contractTermProperties(input.termMonths));
  Object.assign(properties, discountReasonProperties(parameters.discountReason));
  properties.pricing_approval_timestamp = String(Date.now());

  // Persist the configuration, not just its totals.
  //
  // Lock in used to write the pricing_* summary properties and the line items and then forget the
  // inputs that produced them, so a page reload left the rep with an empty calculator and no way
  // to reopen, adjust or regenerate. That is also what made refreshing the page after Lock in
  // destructive, and so blocked reloading the record to pick up the new line items and Quote.
  //
  // The document holds exactly one live option, replacing any previous one: this is a single live
  // calculation per Deal, not a history. Revision advances so the optimistic-concurrency check on
  // other actions still sees a change.
  const document = {
    schemaVersion: '1.0',
    revision: (state.document?.revision || 0) + 1,
    options: [liveOption],
  };
  await writeDocument(client, dealId, document, properties);

  const liveState = {
    ...state,
    document,
    selectedOptionId: liveOption.id,
    selectedOptionName: liveOption.name,
    selectedStateHash: result.stateHash,
  };
  const synced = await syncDealLineItems(client, dealId, liveState, settings);
  const quote = await generateQuote(
    client,
    dealId,
    liveState,
    {
      quoteContent: parameters.quoteContent || {},
      // Default FALSE: a Lock in creates a NEW quote and leaves the previous one alone. The rep
      // opts in to replacing it, per the checkbox beside Lock in. Holly, 2026-08-28.
      //
      // Strict === true so anything absent, malformed or truthy-but-not-boolean means "keep it".
      // The destructive reading must be the one that has to be asked for.
      replaceExistingQuote: parameters.replaceExistingQuote === true,
      // The contact the rep picked on the card. Required on a CPQ quote; see generateQuote.
      contactId: parameters.contactId,
    },
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
  // 'name' deliberately omitted, as a second guard behind lineItemModel not building it. The
  // product library owns the product's name; hs_product_id is all HubSpot needs to resolve it, and
  // anything sent here would overwrite the library's name on the line item. This is the reason
  // "Enterprise Drawdown Fee" kept reappearing after the product was renamed.
  'hs_product_id',
  'quantity',
  'price',
  'discount',
  'description',
  // 'product_category' deliberately omitted: it is not a HubSpot-defined Line Item property, so
  // in a portal that never had it created every create fails with a 400 and the sync collapses.
  // 'units' deliberately omitted. It exists in this portal but is an ENUMERATION -- /GB's,
  // /Emails, /Agent Accounts, /CA's, /Bot Hours -- so any value outside that list is rejected
  // with INVALID_OPTION, which emptied the Deal on 2026-08-28. See lineItemModel.js.
  // Tiered pricing, sent on the graduated Agent Email line only. HubSpot-defined and documented on
  // line items, but gated on a Revenue Hub subscription, so they are droppable below: a portal
  // without Revenue Hub must fall back to the product's own tiers, not fail the create.
  'hs_pricing_model',
  'hs_tier_ranges',
  'hs_tier_prices',
  // Custom, not HubSpot-defined: it carries the monthly committed volume for each metered product,
  // which used to be stated in prose in the description. A portal that never created it rejects
  // the whole create, so createLineItem retries without it rather than failing the sync.
  'committed_quantity',
  // The agreed (net) monthly rate on each metered line -- the "Proposed Rate" the Order Form's
  // rate column should print, rather than `price`, which is deliberately the list rate. Custom,
  // so it is dropped and retried like the others. It used to be named monthly_unit_price here,
  // which was never a property in this portal: it rode in the allow-list from the initial commit
  // and was never in the drop list, so any portal missing it would have failed every create --
  // and because the sync archives before it creates, emptied the Deal.
  'proposed_rate',
  // The Contract Summary's fee columns, carried on every line that holds money. Custom, like
  // committed_quantity, so they are dropped and retried if a portal does not have them.
  'one_time_fees',
  'recurring_fees',
  'total_fees_for_term',
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

// Line Item properties this portal may not accept -- either custom ones that were never created,
// or HubSpot-defined ones behind a subscription this portal does not have. In both cases naming the
// property returns 400 and -- because the sync archives first and creates second -- takes every
// line item on the Deal with it. Each is useful but none is worth that, so a create rejected over
// one of these drops it and retries. The retry is recursive, so a portal missing several of them
// still ends up with a line item rather than an empty Deal.
const OPTIONAL_CUSTOM_LINE_ITEM_PROPERTIES = [
  'committed_quantity',
  'proposed_rate',
  'one_time_fees',
  'recurring_fees',
  'total_fees_for_term',
  // Revenue Hub gated rather than custom. Dropping these degrades to the product's own tier table,
  // which is the behaviour before this change: visibly unadjusted, but a quote rather than nothing.
  'hs_pricing_model',
  'hs_tier_ranges',
  'hs_tier_prices',
];

const errorStatus = (error) =>
  Number(
    error?.code ??
      error?.status ??
      error?.statusCode ??
      error?.response?.status ??
      error?.body?.status,
  ) || 0;

// HubSpot being busy, not HubSpot refusing the data. A 429 or a 5xx says "try again", and the one
// thing that must never happen in response to it is dropping a field: the retry below then writes
// a permanently incomplete line item because of a hiccup that would have cleared on its own.
const isTransientRejection = (error) => {
  const status = errorStatus(error);
  return status === 429 || (status >= 500 && status < 600);
};

// Whether HubSpot is saying this portal HAS NO SUCH PROPERTY, as opposed to any other error that
// happens to mention it.
//
// This used to be `message.includes(property) && /propert/i.test(message)`, which matched almost
// any failure whose text listed the properties it was sent -- including a transient one. It fired
// on exactly one of five identical professional-services line items on the 2026-08-28 quote: that
// line was created without `one_time_fees` while the other four kept it, so the Order Form printed
// a dash in the One-Time Fees column for one row and the right number for the rest. The portal
// plainly HAS the property; four writes proved it in the same call.
//
// Now it needs a 400 (a missing property is a validation error, never a 429 or a 5xx) AND a phrase
// that actually means "unknown". Anything else falls through to the transient retry or is rethrown,
// so a real failure is loud instead of a quietly incomplete quote.
const isUnknownPropertyRejection = (error, property) => {
  const status = errorStatus(error);
  if (status && status !== 400) return false;
  const message = String(
    error?.body?.message || error?.response?.body?.message || error?.message || '',
  );
  if (!message.includes(property)) return false;
  return /does\s*n[o']?t\s+exist|doesn't exist|unknown|not\s+found|no\s+such|invalid\s+propert/i.test(
    message,
  );
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// `attempt` counts transient retries only, never property drops -- a portal missing several
// optional properties still recurses as far as it needs to.
const createLineItem = async (client, properties, associations, attempt = 0) => {
  try {
    return await client.crm.lineItems.basicApi.create({ properties, associations });
  } catch (error) {
    // Wait it out before considering anything a refusal. The quote's line items are created
    // concurrently -- a dozen at once -- which is exactly where a rate limit shows up, and where
    // one call failing among identical siblings is the tell that it was never about the data.
    if (isTransientRejection(error) && attempt < 3) {
      await delay(400 * 2 ** attempt);
      return createLineItem(client, properties, associations, attempt + 1);
    }
    const rejected = OPTIONAL_CUSTOM_LINE_ITEM_PROPERTIES.find(
      (property) =>
        properties[property] != null && isUnknownPropertyRejection(error, property),
    );
    if (rejected) {
      const { [rejected]: unused, ...withoutRejected } = properties;
      console.error(
        `Nylas pricing: HubSpot rejected ${rejected} as a Line Item property this portal does ` +
          'not have. Creating the line item WITHOUT it -- that field will be blank on the quote. ' +
          `Rejection: ${String(error?.body?.message || error?.message || error)}`,
      );
      return createLineItem(client, withoutRejected, associations, attempt);
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

// Check that the fee properties actually landed, and put back any that did not.
//
// Written because a single professional-services line came back missing `one_time_fees` while four
// identical siblings kept it, so the Order Form printed a dash and understated an $8,800 bundle by
// $1,760. Two attempts to find the cause by reasoning failed. This stops reasoning about it: the
// write is read back, and anything missing is patched.
//
// Only the fee properties, and only when the value we sent is non-empty. A property the portal
// genuinely does not have was already dropped deliberately by createLineItem, and re-sending it
// here would just fail again -- so a repair that fails is logged once and left alone.
//
// Never fails the lock. By the time this runs the line items exist and the money on the Deal is
// right; a missing display field is worth a warning, not a refused Lock in that empties the Deal.
const VERIFIED_LINE_ITEM_PROPERTIES = ['one_time_fees', 'recurring_fees', 'total_fees_for_term'];

const repairLineItemProperties = async (client, createdId, sentProperties) => {
  const expected = Object.fromEntries(
    VERIFIED_LINE_ITEM_PROPERTIES.filter((name) => sentProperties[name] != null).map((name) => [
      name,
      String(sentProperties[name]),
    ]),
  );
  if (Object.keys(expected).length === 0) return null;
  try {
    const stored = await client.crm.lineItems.basicApi.getById(
      String(createdId),
      Object.keys(expected),
    );
    const missing = Object.fromEntries(
      Object.entries(expected).filter(([name]) => {
        const value = stored?.properties?.[name];
        return value == null || value === '';
      }),
    );
    if (Object.keys(missing).length === 0) return null;
    console.error(
      `Nylas pricing: line item ${createdId} was created WITHOUT ` +
        `[${Object.keys(missing).join(', ')}] even though they were sent. Patching them back.`,
    );
    await client.crm.lineItems.basicApi.update(String(createdId), { properties: missing });
    return Object.keys(missing);
  } catch (error) {
    console.warn(
      `Nylas pricing: could not verify or repair line item ${createdId}. ` +
        `${String(error?.body?.message || error?.message || error)}`,
    );
    return null;
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
        const sent = hubSpotLineItemProperties(item.properties);
        const created = await createLineItem(client, sent, [createAssociation(dealId, 20)]);
        createdIds.push(String(created.id));
        // Read back and repair rather than trust the write. See repairLineItemProperties.
        await repairLineItemProperties(client, created.id, sent);
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
// The templates the card may offer, narrowed to the ones chosen in Settings.
//
// An EMPTY enabledQuoteTemplateIds means "all of them" -- the behaviour before this setting
// existed -- so an unconfigured portal is unchanged rather than shown an empty picker. A chosen id
// the portal no longer has simply drops out: Settings cannot conjure a template that is not there.
const offeredQuoteTemplates = (templates, settings) => {
  const enabled = settings?.enabledQuoteTemplateIds || [];
  if (enabled.length === 0) return templates;
  const allowed = new Set(enabled.map(String));
  const narrowed = templates.filter(({ id }) => allowed.has(String(id)));
  // Never hand back an empty picker because every chosen template has since been deleted -- that
  // reads as a broken card. Fall back to everything and say so.
  if (narrowed.length === 0) {
    console.warn(
      'Nylas pricing: none of the quote templates chosen in Settings still exist. ' +
        'Offering every usable template instead.',
    );
    return templates;
  }
  return narrowed;
};

// Settings first, then the QUOTE_TEMPLATE_ID secret, which is where the default lived before.
const defaultQuoteTemplateFor = (settings) =>
  settings?.defaultQuoteTemplateId || configuredQuoteTemplateId();

// The contacts a rep may put on the quote.
//
// HubSpot lists Contact as a REQUIRED association on a CPQ quote, and the old code associated
// whatever the Deal happened to have -- so a Deal with no contact produced a quote with none, which
// HubSpot rejects with a message that blames the template. Making the choice explicit is what stops
// that. Holly, 2026-08-28.
//
// Deal contacts first. When the Deal has none, fall back to the contacts on its COMPANY, so the rep
// can pick one rather than being told to go and associate it somewhere else first.
const quoteContactOptions = async (client, dealId) => {
  const readContacts = async (ids) => {
    if (ids.length === 0) return [];
    try {
      const read = await client.crm.contacts.batchApi.read({
        inputs: ids.map((id) => ({ id: String(id) })),
        properties: ['firstname', 'lastname', 'email'],
        idProperty: undefined,
      });
      return (read?.results || []).map((contact) => {
        const first = contact?.properties?.firstname || '';
        const last = contact?.properties?.lastname || '';
        const email = contact?.properties?.email || '';
        const name = `${first} ${last}`.trim();
        return {
          id: String(contact.id),
          // Never blank: a nameless option is unpickable. Email, then the id, as fallbacks.
          label: name && email ? `${name} (${email})` : name || email || `Contact ${contact.id}`,
        };
      });
    } catch (error) {
      console.warn(
        'Nylas pricing: could not read contact details.',
        safeProviderDiagnostics(error, 'read_quote_contacts'),
      );
      return ids.map((id) => ({ id: String(id), label: `Contact ${id}` }));
    }
  };

  try {
    const dealContactIds = await associatedIds(client, 'deals', dealId, 'contacts', 25);
    if (dealContactIds.length > 0) {
      return { contacts: await readContacts(dealContactIds), source: 'deal', dealContactIds };
    }
    const companyIds = await associatedIds(client, 'deals', dealId, 'companies', 1);
    if (!companyIds[0]) return { contacts: [], source: 'none', dealContactIds: [] };
    const companyContactIds = await associatedIds(
      client,
      'companies',
      companyIds[0],
      'contacts',
      50,
    );
    return {
      contacts: await readContacts(companyContactIds),
      source: 'company',
      dealContactIds: [],
    };
  } catch (error) {
    // The picker is a convenience over a requirement -- never let it stop the card loading.
    console.warn(
      'Nylas pricing: could not list quote contacts.',
      safeProviderDiagnostics(error, 'list_quote_contacts'),
    );
    return { contacts: [], source: 'none', dealContactIds: [] };
  }
};

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
    const name = template?.properties?.hs_name || '';
    console.log(
      `Nylas pricing: quote template ${templateId} ("${name}") has hs_type "${type}" ` +
        `(HubSpot has previously required "${REQUIRED_QUOTE_TEMPLATE_TYPE}").`,
    );
    return { type, name };
  } catch (error) {
    console.warn(
      'Nylas pricing: could not read the quote template.',
      safeProviderDiagnostics(error, 'read_quote_template'),
    );
    return { type: 'unknown', name: '' };
  }
};

// Archive the quote this Lock in supersedes.
//
// Quote generation is unconditional -- the hash-based reuse it replaced is what let a stale quote
// come back rendered with the old template -- so every Lock in minted another draft and a Deal
// quietly collected a stack of them. Holly, 2026-08-28.
//
// WHICH QUOTE. Only the one named by the Deal's pricing_latest_quote_id, which this function
// writes and nothing else does. The Deal's own quote associations are NOT scanned: a rep can
// attach a quote by hand and this action has no business deciding what that is.
//
// ONLY IF STILL DRAFT. A quote created through the API starts DRAFT and stays there until someone
// publishes it, so this cannot reach anything a customer has been sent or has opened. Any other
// status -- published, approved, expired, or one this code does not recognise -- is left alone and
// logged. The check is a positive test for DRAFT rather than a list of statuses to avoid, so a
// status HubSpot adds later fails safe.
//
// NEVER FAILS THE LOCK. By the time this runs the new quote exists and the Deal points at it. A
// leftover draft is untidy; a Lock in that reports failure over one is not.
// The Seller block on the printed quote.
//
// hubspot_owner_id sets the quote's OWNER. It is not what the customer reads: the Seller section
// renders from the hs_sender_* properties, and setting the owner alone left it blank. Confirmed by
// Holly on a real quote, 2026-08-28 -- which is why these are written now and were not written
// speculatively alongside the owner.
//
// Only the three fields the Owners API can actually answer for. hs_sender_jobtitle, _phone and the
// hs_sender_company_* block are real properties but an owner record has nothing to fill them with,
// and sending blanks would replace whatever the template already supplies with nothing.
//
// Never fails the quote. A missing or unreadable owner just leaves the Seller block to whatever
// HubSpot would have done anyway -- which is the behaviour before this change, not something worse.
const senderProperties = async (client, ownerId) => {
  if (!ownerId) return {};
  try {
    const owner = await client.crm.owners.ownersApi.getById(Number(ownerId));
    const firstName = owner?.firstName || '';
    const lastName = owner?.lastName || '';
    const email = owner?.email || '';
    if (!firstName && !lastName && !email) {
      console.warn(`Nylas pricing: owner ${ownerId} has no name or email; Seller left to HubSpot.`);
      return {};
    }
    return {
      ...(firstName ? { hs_sender_firstname: firstName } : {}),
      ...(lastName ? { hs_sender_lastname: lastName } : {}),
      ...(email ? { hs_sender_email: email } : {}),
    };
  } catch (error) {
    console.warn(
      `Nylas pricing: could not read owner ${ownerId} for the Seller block. ` +
        `${String(error?.body?.message || error?.message || error)}`,
    );
    return {};
  }
};

const archiveSupersededQuote = async (client, supersededQuoteId, newQuoteId) => {
  if (!supersededQuoteId || supersededQuoteId === String(newQuoteId)) return null;
  try {
    const superseded = await client.crm.quotes.basicApi.getById(supersededQuoteId, ['hs_status']);
    const status = superseded?.properties?.hs_status;
    if (status !== 'DRAFT') {
      console.warn(
        `Nylas pricing: superseded quote ${supersededQuoteId} left in place -- status is ` +
          `${status || 'unknown'}, not DRAFT.`,
      );
      return null;
    }
    await client.crm.quotes.basicApi.archive(supersededQuoteId);
    return supersededQuoteId;
  } catch (error) {
    console.warn(
      `Nylas pricing: could not archive superseded quote ${supersededQuoteId}. It is left in ` +
        `place. ${String(error?.body?.message || error?.message || error)}`,
    );
    return null;
  }
};

const generateQuote = async (client, dealId, state, parameters, portalId, settings) => {
  const option = selectedOptionForDraft(state);
  assertCurrentSettings(option, settings);
  const content = normalizeQuoteContent(
    parameters.quoteContent,
    `${state.dealName} – ${option.name}`,
  );
  // The rep's choice wins; the configured default covers anyone who does not pick.
  // Settings' default, then the secret. The card normally sends an explicit templateId, so this
  // matters when it sends none -- a configuration restored from before the picker existed.
  const templateId = content.templateId || defaultQuoteTemplateFor(settings);
  if (!/^\d+$/.test(templateId)) throw new Error('QUOTE_CONFIGURATION_REQUIRED');
  const { type: templateType, name: templateName } = await describeQuoteTemplate(
    client,
    templateId,
  );
  // A new Quote every time. There is deliberately no reuse branch.
  //
  // There used to be: an unchanged content hash returned the stored quote instead of creating one.
  // It was a real source of confusion. The hash covered only the template the CARD sent, so when
  // the card sent nothing and the configured default filled in, changing that default produced an
  // identical hash -- the stored quote came back, still rendered with the OLD template, and
  // nothing regenerated it. That is why the wrong template kept reappearing after the default was
  // fixed.
  //
  // Hashing the resolved template would have fixed that one case, but any value outside the hash
  // could do the same thing again. Generating unconditionally cannot go stale.
  //
  // The hash is still recorded on the Deal, as a record of what the latest quote was built from.
  //
  // Consequence: a Deal accumulates one Quote per Lock in. Superseded quotes are NOT archived --
  // they are customer-facing records and deleting them is not this action's call.
  const hash = contentHash(option, { ...content, templateId });

  // Read before anything is written, because updateDealProperties below overwrites it. Tolerant
  // of a portal without the property: this is cleanup, not part of producing a correct quote.
  // TWO SEPARATE READS, deliberately. They were one, and that was a mistake: pricing_latest_quote_id
  // is a custom property this portal may not have, and a single catch meant a failure reading it
  // silently produced an empty OWNER as well -- a blank Seller block with no error anywhere.
  // Unrelated lookups do not share a failure. 2026-08-28.
  let supersededQuoteId = '';
  try {
    const priorDeal = await client.crm.deals.basicApi.getById(String(dealId), [
      'pricing_latest_quote_id',
    ]);
    supersededQuoteId = priorDeal?.properties?.pricing_latest_quote_id || '';
  } catch (error) {
    console.warn(
      `Nylas pricing: could not read pricing_latest_quote_id on deal ${dealId}. ` +
        `${String(error?.body?.message || error?.message || error)}`,
    );
  }

  let dealOwnerId = '';
  try {
    const ownerRead = await client.crm.deals.basicApi.getById(String(dealId), [
      'hubspot_owner_id',
    ]);
    dealOwnerId = ownerRead?.properties?.hubspot_owner_id || '';
  } catch (error) {
    console.warn(
      `Nylas pricing: could not read hubspot_owner_id on deal ${dealId}. ` +
        `${String(error?.body?.message || error?.message || error)}`,
    );
  }
  // Said out loud, because three rounds went by with a blank Seller block and no way to tell WHICH
  // step produced nothing -- an ownerless Deal, an unreadable owner, or the right properties on the
  // wrong quote model. `hs project logs` now answers that in one line.
  if (!dealOwnerId) {
    console.warn(
      `Nylas pricing: deal ${dealId} has no hubspot_owner_id. The quote will carry no owner and ` +
        'no Seller contact.',
    );
  }

  // Resolved before the try for the same reason as the line items: a failure here must not leave a
  // half-made quote behind. senderProperties never throws, so this is belt and braces.
  const sender = await senderProperties(client, dealOwnerId);
  console.info(
    `Nylas pricing: quote seller resolved -- owner=${dealOwnerId || 'NONE'} ` +
      `fields=[${Object.keys(sender).join(', ') || 'NONE'}]`,
  );

  // Built before the try so PRODUCT_MAPPING_REQUIRED fails before a quote record exists.
  const lineItems = buildQuoteLineItems(option, content);
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
        // hs_comments and hs_terms are deliberately not sent.
        //
        // hs_terms is the property the quote template's "Payment Terms:" section renders. The app
        // was writing the renewal sentence into it, so a renewal term printed under a Payment
        // Terms heading -- duplicating the template's own [Auto Renewal Terms] token -- while
        // Billing schedule and Payment Method came up empty. The template owns this text; the
        // calculator has no business overwriting it.
        // Required, and previously not sent at all. Every quote template in the portal is a
        // cpq_template, and a quote must declare CPQ_QUOTE to be compatible with them. Without
        // it the quote defaults to the legacy model and HubSpot rejects the CPQ template it is
        // associated with.
        hs_template_type: 'CPQ_QUOTE',
        // The seller is the DEAL OWNER, explicitly, not whoever clicked Lock in and not whatever
        // the API defaults to. This used to be left unset on the reasoning that a quote inherits
        // the owner from its associated deal -- a sentence from HubSpot's Quotes guide that was
        // never checked against this portal. Holly, 2026-08-28: it has to be the deal owner, so
        // it is set rather than hoped for.
        //
        // Omitted when the Deal has no owner: an empty string is not "no owner" to HubSpot.
        ...(dealOwnerId ? { hubspot_owner_id: dealOwnerId } : {}),
        // The Seller block the customer reads. The owner above is the CRM record's owner; these
        // three are what the quote actually prints. Both are needed.
        ...sender,
        // Acceptance method. HubSpot's Quotes guide documents three values -- clickwrap,
        // esignature and print_and_sign -- and print_and_sign is THE DEFAULT. It is not inherited
        // from the quote template, which is why every generated quote came out "Print and sign"
        // while the saved template said otherwise.
        //
        // clickwrap is "accept without signature": it renders an accept button and, unlike the
        // other two, does not require a signer contact associated to the quote.
        hs_acceptance_method: QUOTE_ACCEPTANCE_METHOD,
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

    // The quote owns its line items, and they carry the same information as the Deal's.
    //
    // These were removed once, when every product appeared twice on generated quotes and the
    // second set looked like it had to be coming from here. It was not: the quote template
    // itself had products configured on it, which is now fixed portal-side. Removing these took
    // the calculator's own numbers off the quote along with the duplicates.
    //
    // buildQuoteLineItems and buildDealLineItems produce identical properties for the itemized
    // presentation the card always sends -- same products, prices, quantities,
    // committed_quantity and hs_position_on_quote ordering. A test asserts that, so the two
    // surfaces cannot silently drift apart again.
    //
    // Record each id as soon as it exists. Collecting them from Promise.all only records them
    // when every create succeeds, so the rollback below archived nothing in exactly the case it
    // was written for and leaked orphaned quote line items on every failed attempt.
    // Batched, not one Promise.all over every line. Thirteen simultaneous creates is what made a
    // rate limit likely in the first place, and the Deal sync has always batched -- this path was
    // the odd one out. inBatches keeps the same concurrency ceiling as everywhere else.
    await inBatches(
      lineItems,
      async (item) => {
        const sent = hubSpotLineItemProperties(item.properties);
        const created = await createLineItem(
          client,
          sent,
          // 68, not 67. Association type ids are directional: 67 is defined FROM the quote
          // (0-14) TO the line item, but this association is declared on the line item's own
          // create call, so the "from" side is the line item (0-8). HubSpot rejected it with
          // "invalid from object type 0-8 ... expected: 0-14. For definition 0-67". 68 is the
          // line-item-to-quote direction -- the same reason the Deal sync uses 20.
          [createAssociation(quote.id, 68)],
        );
        createdLineItemIds.push(String(created.id));
        // Read back and repair, exactly as the Deal sync does.
        //
        // THE QUOTE HAS ITS OWN LINE ITEMS -- separate records from the Deal's, created here. The
        // printed Order Form renders from THESE. When the verify-and-repair was added it went on
        // the Deal sync only, so the surface the customer actually reads was still unchecked and a
        // dropped `one_time_fees` still printed as a dash. 2026-08-28.
        await repairLineItemProperties(client, created.id, sent);
      },
    );

    const [dealContactIds, companyIds] = await Promise.all([
      associatedIds(client, 'deals', dealId, 'contacts', 10),
      associatedIds(client, 'deals', dealId, 'companies', 1),
    ]);
    // The rep's choice wins; the Deal's own contacts are the fallback for a configuration saved
    // before the picker existed. HubSpot lists Contact as REQUIRED on a CPQ quote, so a quote with
    // none is rejected -- with a message that blames the template, which is what made the
    // 2026-08-28 failure so hard to read.
    const chosenContactId = String(parameters.contactId || '');
    const contactIds = chosenContactId ? [chosenContactId] : dealContactIds;
    if (contactIds.length === 0) throw new Error('QUOTE_CONTACT_REQUIRED');

    // A contact picked from the COMPANY is not on the Deal yet. Put it there: "make sure there's a
    // contact on the deal" is the point of the picker, and a quote whose contact is absent from its
    // own Deal is the same missing association one step later. createDefault rather than a typed
    // id -- the default deal-to-contact association is exactly the standard one, and guessing a
    // type id is how the units incident started.
    if (chosenContactId && !dealContactIds.includes(chosenContactId)) {
      try {
        await client.crm.associations.v4.basicApi.createDefault(
          'deals',
          String(dealId),
          'contacts',
          chosenContactId,
        );
      } catch (error) {
        // Not fatal: the quote can still carry the contact. Say so rather than failing the lock.
        console.warn(
          `Nylas pricing: could not associate contact ${chosenContactId} to deal ${dealId}. ` +
            `${String(error?.body?.message || error?.message || error)}`,
        );
      }
    }

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
      ...Object.keys(sender),
    ]);
    const quoteUrl = finalized?.properties?.hs_quote_link || '';
    // The Seller block, checked rather than assumed.
    //
    // hs_sender_* was sent on the create above and the block still came out blank. Rather than
    // guess again at which field family a CPQ quote reads, the created quote is read back: if the
    // values are not on it, they are written a second time as an update. A create that silently
    // ignores a property and an update that accepts it is a real HubSpot pattern, and this costs
    // one call to find out instead of another round trip.
    const senderMissing = Object.entries(sender).filter(
      ([name]) => !finalized?.properties?.[name],
    );
    let senderRepaired = false;
    if (senderMissing.length > 0) {
      console.error(
        `Nylas pricing: quote ${quote.id} did not keep ` +
          `[${senderMissing.map(([name]) => name).join(', ')}] from the create. Setting them now.`,
      );
      try {
        await client.crm.quotes.basicApi.update(String(quote.id), {
          properties: Object.fromEntries(senderMissing),
        });
        // Read back AGAIN. Three attempts at the Seller block have each looked correct in the code
        // and come out blank on the quote, with no way to see which step produced nothing. This
        // reports what HubSpot actually kept, and the card prints it on the confirmation --
        // the same thing that ended the "which template did it use" guessing.
        const after = await client.crm.quotes.basicApi.getById(
          String(quote.id),
          Object.keys(sender),
        );
        senderRepaired = Object.keys(sender).every((name) => after?.properties?.[name]);
      } catch (error) {
        console.error(
          `Nylas pricing: the Seller block could not be set on quote ${quote.id}. ` +
            `${String(error?.body?.message || error?.message || error)}`,
        );
      }
    }
    const generatedAt = new Date().toISOString();
    // Through updateDealProperties, not the API directly: pricing_quote_id is a name from the
    // portal's property list rather than a verified write, and an unknown property here would
    // fail this update -- which the catch below treats as a failed generate, archiving the Quote
    // that was just created successfully.
    await updateDealProperties(client, dealId, {
      pricing_latest_quote_id: String(quote.id),
      pricing_quote_id: String(quote.id),
      pricing_latest_quote_url: quoteUrl,
      pricing_quote_content_hash: hash,
      pricing_quote_generation_status: 'draft_created',
      pricing_quote_generated_at: generatedAt,
    });
    // Only when the rep asked for it. Every Lock in creates a new quote; whether the one it
    // supersedes is archived is their call, made on the checkbox beside the button. Archiving by
    // default made a Deal look like it had one quote being edited in place, which is not what is
    // happening -- the old one was being thrown away.
    //
    // Last, so that any earlier failure rolls back the NEW quote and leaves the old one as the
    // Deal's current quote rather than archiving it out from under a failed generate.
    if (parameters.replaceExistingQuote === true) {
      await archiveSupersededQuote(client, supersededQuoteId, quote.id);
    }

    return {
      // What the Seller block actually resolved to, so a blank one is visible on the card rather
      // than only in logs nobody can reach mid-call.
      seller: {
        ownerId: dealOwnerId || '',
        sent: Object.keys(sender),
        keptOnCreate: Object.keys(sender).filter((name) => Boolean(finalized?.properties?.[name])),
        repaired: senderRepaired,
      },
      quoteId: String(quote.id),
      quoteUrl,
      generatedAt,
      templateId,
      templateName,
    };
  } catch (error) {
    // Archive the quote's own line items before the quote, so a failed attempt leaves nothing
    // orphaned. The Deal's line items are syncDealLineItems' to roll back, not this function's.
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
        // The FULL list, not the narrowed one: this is the screen where the narrowing is chosen,
        // so it has to show every template the portal has.
        quoteTemplates: await usableQuoteTemplates(getClient()),
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
        quoteTemplates: offeredQuoteTemplates(await usableQuoteTemplates(client), settings),
        defaultQuoteTemplateId: defaultQuoteTemplateFor(settings),
        ...(await quoteContactOptions(client, dealId)),
        // The card shows this as the Quote title placeholder, so a rep who leaves the field
        // blank can see the name the quote will actually get rather than being surprised by it.
        dealName: state.dealName,
      });
    }
    // Read-only diagnostic. Compares every catalogued product against pricingRules.js and reports
    // where HubSpot and the code disagree -- and, crucially, whether this portal exposes tiered
    // pricing over the API at all. Changes no pricing and writes nothing.
    if (action === 'inspect_products') {
      return response(200, {
        success: true,
        productLibrary: await inspectProductLibrary(client),
      });
    }
    if (action === 'preview') {
      return response(200, {
        success: true,
        previewResult: calculateQuote(
          parameters.input,
          settings.pricingPolicy,
          settings.version,
          dealCategory(settings, state.dealType, state.pipelineId),
        ),
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
  archiveSupersededQuote,
  repairLineItemProperties,
  senderProperties,
  associatedIds,
  createLineItem,
  isUnknownPropertyRejection,
  deleteOption,
  lockLiveCalculation,
  autoRenewalProperties,
  contractTermProperties,
  discountReasonProperties,
  paymentFrequencyProperties,
  paymentMethodProperties,
  syncDealLineItems,
  updateDealProperties,
});
