const crypto = require('node:crypto');
const hubspot = require('@hubspot/api-client');

const { QuoteValidationError, calculateQuote, normalizeStoredInput } = require('./calculator');
const { inspectProductLibrary } = require('./productLibrary');
// LABELS ONLY. Every number in the summary below comes from the calculated result, never from
// here -- reading a price out of the rate card while the result was computed from stored settings
// is how a summary would end up disagreeing with the quote beside it.
const rateCardLabels = require('./pricingRules');
const {
  accountIdFromContext,
  isDealAllowed,
  isSettingsAdmin,
  productRateDescriptors,
  readDealPipelines,
  readSettings,
  saveSettings,
  userIdFromContext,
  dealCategory,
  quoteKindsForCategory,
  quoteTemplateSettings,
  QUOTE_KINDS,
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
  // Added 2026-08-30 and NEVER verified against this portal. Guarded like the rest: if the
  // property does not exist, it is dropped and the update retried rather than failing a commit
  // that runs after the Deal's line items have already been archived. special_terms itself is not
  // in this list -- it has been written on every lock for days without a rejection, so the portal
  // demonstrably has it.
  'special_terms_included',
  // Added 2026-09-01 from the portal's property editor. Guarded for the usual reason and one more:
  // whether either is a multiple-checkboxes field or a single-select was read off a screenshot, and
  // a single-select rejects the semicolon-joined value. If that is what it turns out to be, the
  // warning in updateDealProperties names the property and the Lock in still completes.
  'professional_services_package',
  // CONFIRMED multiple-checkboxes by Holly, 2026-09-01, so the semicolon-joined value is right.
  // Still guarded, like everything else here whose name came from outside the code.
  'pricing_subscription_addons',
  'pricing_contract_summary',
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
// The quote's INTERNAL STATUS (hs_status, labelled "Internal quote status"). Values confirmed
// against portal 45023718 on 2026-08-30 by reading the property definition, not from docs:
// DRAFT, PENDING_APPROVAL, REJECTED, APPROVED, APPROVAL_NOT_NEEDED, ACCEPTED, VOID.
//
// The approval workflow enrols on hs_status changing to PENDING_APPROVAL, filtered to
// CPQ_QUOTE templates. So the calculator has to SAY a quote needs approval; deciding it and
// leaving the quote at DRAFT is what left the workflow with nothing to fire on.
const QUOTE_STATUS_PENDING_APPROVAL = 'PENDING_APPROVAL';
const QUOTE_STATUS_APPROVAL_NOT_NEEDED = 'APPROVAL_NOT_NEEDED';
const QUOTE_STATUS_DRAFT = 'DRAFT';

// Which superseded quotes "Replace the existing quote" may archive.
//
// Was DRAFT only, which was right while every quote the app made was DRAFT. Now that a locked
// quote carries a real status, DRAFT-only would have silently stopped archiving anything --
// the checkbox would look like it worked and do nothing. ACCEPTED and VOID are never touched:
// one is a live agreement, the other is already terminal.
const ARCHIVABLE_QUOTE_STATUSES = Object.freeze([
  'DRAFT',
  QUOTE_STATUS_PENDING_APPROVAL,
  QUOTE_STATUS_APPROVAL_NOT_NEEDED,
  'REJECTED',
]);

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
  QUOTE_TEMPLATE_NOT_CPQ:
    'That quote template is a legacy template and cannot be used. Choose a CPQ template on the ' +
    'card, or change which templates are offered in Settings > Quote Templates.',
  QUOTE_CONTRACT_REQUIRED:
    'Choose which contract this change or renewal is for before locking in.',
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

// The default Quote title: "<Company name> - <year>". Holly, 2026-08-30.
//
// It used to be "<deal name> - Live calculator", which put an internal label in front of a
// customer ("COVIS 2026 Manual Renewal - Live calculator"). The year is the CONTRACT START year,
// not today's -- a quote written in December for a January term belongs to the term it covers.
//
// Falls back to the deal name only when the company is unknown, and drops the year entirely if
// the start date is unreadable, rather than printing "Acme - NaN".
const defaultQuoteTitle = (companyName, startDate, dealName) => {
  const subject = String(companyName || dealName || '').trim();
  const year = String(startDate || '').slice(0, 4);
  if (!subject) return '';
  return /^\d{4}$/.test(year) ? `${subject} - ${year}` : subject;
};

const readDealState = async (client, dealId) => {
  try {
    if (!client?.crm?.deals?.basicApi) throw new Error('CONFIGURATION_REQUIRED');
    const deal = await client.crm.deals.basicApi.getById(dealId, [
      'dealtype',
      'pipeline',
      'hubspot_owner_id',
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
      dealOwnerId: deal.properties.hubspot_owner_id || '',
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
    await archiveLineItemsBatch(client, existingLineItemIds);
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

// The Deal's own Professional Services Package property, mirrored from the calculator's picks.
//
// READ THE VALUES, NOT THE LABELS. Two of this property's internal names are the strings "true"
// and "false" -- left over from when it was a yes/no field and someone added real options on top
// without renaming the originals. The portal's option list, read 2026-09-01:
//
//   "No"                                    -> No
//   "true"                                  -> Architecture Design & Workflow Review
//   "false"                                 -> Go-To-Market (GTM) Review
//   "Google Verification Review"            -> Google Verification Review
//   "Notification & Webhook Best Practices" -> Notification & Webhook Best Practices
//   "Provider OAuth App Creation"           -> Provider OAuth App Creation
//
// So this map cannot be derived from professionalServiceOptions' labels and has to be written out.
// Renaming "true"/"false" in HubSpot would be cleaner, but 6 and 1 Deals respectively already
// carry those values and renaming an internal name does not migrate them.
//
// Three further options -- "Strategic Onboarding", "QuickLaunch Onboarding", "QuickLaunch+
// Onboarding" -- are ARCHIVED. They are onboarding tiers that predate pricing_onboarding_tier and
// are deliberately not written here; onboarding has its own property.
const professionalServiceHubSpotValue = Object.freeze({
  google_verification_review: 'Google Verification Review',
  architecture_workflow_review: 'true',
  gtm_review: 'false',
  provider_oauth_app_creation: 'Provider OAuth App Creation',
  notification_webhook_best_practices: 'Notification & Webhook Best Practices',
});

// What the property holds when the rep picked nothing. Not an empty string: "No" is a real option
// carrying 119 Deals, and it is what the portal's own reporting counts as "no professional
// services". Clearing the property instead would make those Deals indistinguishable from ones
// nobody has quoted yet.
const PROFESSIONAL_SERVICES_NONE = 'No';

// The Deal's Subscription Add-ons property. Same shape, and one trap of its own: the portal's
// option is "Turnkey Verified OAuth Project", SINGULAR, while the card's label and the rate card
// both say "Projects". The value has to match the portal exactly or the write is rejected.
//
// enterprise_accelerator is deliberately absent. It is retired from the card but still a stored
// key on older configurations, and the portal has no option for it -- so a configuration that
// still carries it simply contributes nothing here rather than poisoning the whole write.
const addOnHubSpotValue = Object.freeze({
  shared_oauth_app: 'Shared Google OAuth App',
  privacy_filter: 'Privacy Filter Mode',
  verified_oauth: 'Turnkey Verified OAuth Project',
});

// Both properties are multi-select, so HubSpot wants the values semicolon-joined. Unrecognised
// keys are dropped rather than passed through: an unknown key is a value the portal does not have,
// and sending one is what "Property \"units\" was not one of the allowed options" looked like on
// 2026-08-28. Sorted so the same selection always produces the same string -- otherwise the Deal
// shows as modified on every Lock in that changed nothing.
const hubSpotChoiceList = (keys, table) =>
  [...new Set(Array.isArray(keys) ? keys : [])]
    .map((key) => table[key])
    .filter(Boolean)
    .sort()
    .join(';');

const productVolumeProperties = Object.freeze({
  connect_ca: 'pricing_connect_committed_monthly_volume',
  calendar_ca: 'pricing_calendar_committed_monthly_volume',
  notetaker_bot_hours: 'pricing_notetaker_committed_monthly_hours',
  agent_accounts: 'pricing_agent_accounts_committed_monthly_volume',
  agent_email_thousands: 'pricing_agent_email_committed_monthly_thousands',
  agent_storage_gb: 'pricing_agent_storage_committed_monthly_gb',
  agent_bandwidth_gb: 'pricing_agent_bandwidth_committed_monthly_gb',
});

// THE CONTRACT SUMMARY, in words, for pricing_contract_summary.
//
// Holly, 2026-09-01: "I created a multi line text field property called pricing_contract_summary
// and I want you to write in a readable format what the contract summary was."
//
// Everything here already exists on the Deal as separate properties, or inside
// pricing_quote_inputs_payload as JSON. Neither is readable: the properties are scattered across
// the record and the payload is a blob. This is the one field someone can look at and see what was
// sold, without opening the calculator.
//
// Numbers come from `result` only. Labels come from the rate card. That split matters -- the
// result may have been computed from stored settings that override the rate card's prices, so
// taking an amount from the rate card here would print a figure the quote does not charge.
const summaryMoney = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '$0.00';
  return `$${amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const summaryPercent = (fraction) => {
  const value = Number(fraction);
  if (!Number.isFinite(value) || value === 0) return null;
  // Two decimals only when they carry something: "2.5%", not "2.50%", and "12.75%" when it is.
  // Rounded to two BEFORE trailing zeros are dropped, so a blended discount prints "4.28%" rather
  // than the raw 4.2839% -- this is a summary, not the audit trail. The exact figures stay on
  // pricing_blended_effective_discount_pct and in pricing_calculation_payload.
  const percent = Math.round(value * 10000) / 100;
  return `${percent}%`;
};

const summaryNumber = (value) => Number(value || 0).toLocaleString('en-US');

// 2026-10-01 -> 1 Oct 2026. Unambiguous across US and EU readers, which "10/01/2026" is not.
const summaryDate = (iso) => {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return 'not set';
  const [year, month, day] = iso.split('-').map(Number);
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return `${day} ${months[month - 1]} ${year}`;
};

// The same names the card's banner uses. A raw key like "ccso" in a customer-adjacent summary
// reads as a bug; these are the words the approver is actually called.
const summaryApprovalTier = (tier) =>
  ({
    none: 'No approval needed',
    sales_director: 'Sales Director',
    head_sales: 'Head of Sales',
    cs_director: 'CS Director',
    ccso: 'CCSO',
    finance: 'Finance',
  })[tier || 'none'] || tier;

const summarySection = (heading, rows) =>
  rows.length === 0 ? [] : [heading, ...rows.map((row) => `  ${row}`), ''];

const contractSummaryText = (option) => {
  const { input, result } = option;
  const volumes = input.volumes || {};
  const dates = result.dates || {};
  const lines = Array.isArray(result.lines) ? result.lines : [];

  const paymentRule = rateCardLabels.paymentRules.find(
    ({ key }) => key === input.paymentFrequency,
  );
  const supportRule = rateCardLabels.supportRules.find(
    ({ key }) => key === input.supportLevel,
  );
  const onboardingRule = rateCardLabels.onboardingRules.find(
    ({ key }) => key === input.onboardingPackage,
  );

  const out = [];
  out.push(option.name ? `${option.name}` : 'Pricing summary');
  out.push('='.repeat(Math.max(12, (option.name || 'Pricing summary').length)));
  out.push('');

  // --- Term ---
  const termRows = [
    `Term            ${input.termMonths} months`,
    `Starts          ${summaryDate(dates.contractStartDate)}`,
    `Ends            ${summaryDate(dates.contractEndDate)}`,
    `Billing         ${paymentRule?.label || input.paymentFrequency}`,
  ];
  if (input.autoRenewal) {
    termRows.push(
      `Auto-renews     ${summaryDate(dates.renewalDate)} for ${input.renewalTermMonths} months`,
    );
    if (dates.nonRenewalNoticeDate) {
      termRows.push(`Notice by       ${summaryDate(dates.nonRenewalNoticeDate)}`);
    }
  } else {
    termRows.push('Auto-renews     No');
  }
  out.push(...summarySection('CONTRACT', termRows));

  // --- Products. Only what was actually quoted; a zero-volume product is not on the contract. ---
  const productRows = lines
    .filter((line) => Number(line.annualCommitment) > 0 || Number(line.volume) > 0)
    .map((line) => {
      const rate = line.displayProposedUnitRate ?? line.proposedUnitRate;
      const unit = line.unitOfMeasure ? ` ${line.unitOfMeasure}` : '';
      const discount = summaryPercent(line.discretionaryDiscount);
      return (
        `${line.productName || line.productKey}: ` +
        `${summaryNumber(line.volume)}${unit}/month at ${summaryMoney(rate)} ` +
        `= ${summaryMoney(line.annualCommitment)}/year` +
        (discount ? ` (${discount} off list)` : '')
      );
    });
  out.push(...summarySection('PRODUCTS', productRows));

  // --- Everything else that carries a price ---
  const extraRows = [];
  if (Number(result.supportAnnual) > 0 || supportRule) {
    extraRows.push(
      `Support: ${supportRule?.level || input.supportLevel} ` +
        `= ${summaryMoney(result.supportAnnual)}/year`,
    );
  }
  if (Number(result.onboardingAmount) > 0) {
    extraRows.push(
      `Onboarding: ${onboardingRule?.package || input.onboardingPackage} ` +
        `= ${summaryMoney(result.onboardingAmount)} one-time`,
    );
  } else {
    extraRows.push('Onboarding: None');
  }
  for (const addOn of result.selectedAddOns || []) {
    extraRows.push(`Add-on: ${addOn.label} = ${summaryMoney(addOn.annualAmount)}/year`);
  }
  const serviceLabels = (input.professionalServices || []).map((key) => {
    const offered = rateCardLabels.professionalServiceOptions.find(
      (service) => service.key === key,
    );
    return offered?.label || key;
  });
  if (serviceLabels.length > 0) {
    extraRows.push(
      `Professional services (${serviceLabels.length}): ${serviceLabels.join(', ')} ` +
        `= ${summaryMoney(result.professionalServicesAmount)} one-time`,
    );
  }
  out.push(...summarySection('INCLUDED', extraRows));

  // --- Discounts. Each one named, because "why is this cheaper than list" is the question this
  // summary gets opened to answer. ---
  // One column width for every label here, so the percentages line up however long the longest
  // label is. Hand-counted spaces drifted the moment "Largest line discount" was added.
  const DISCOUNT_LABEL_WIDTH = 22;
  const discountRows = [];
  const discountRow = (label, value) =>
    discountRows.push(`${label.padEnd(DISCOUNT_LABEL_WIDTH)}${value}`);
  const termDiscount = summaryPercent(result.termDiscount);
  if (termDiscount) discountRow('Multi-year term', termDiscount);
  const premium = summaryPercent(result.paymentPremium);
  if (premium) discountRow('Payment frequency', `+${premium}`);
  const largest = summaryPercent(result.largestDiscretionaryDiscount);
  if (largest) discountRow('Largest line discount', largest);
  const effective =
    Number(result.listTcv) > 0 ? 1 - Number(result.tcv) / Number(result.listTcv) : 0;
  const blended = summaryPercent(effective);
  if (blended) {
    discountRow(
      'Blended effective',
      `${blended} (${summaryMoney(Number(result.listTcv) - Number(result.tcv))} off list)`,
    );
  }
  out.push(...summarySection('DISCOUNTS', discountRows));

  // --- Totals ---
  out.push(
    ...summarySection('TOTALS', [
      `Annual commitment    ${summaryMoney(result.committedArr)}`,
      `Per ${(result.billingPeriod || 'period').toLowerCase().padEnd(16)} ${summaryMoney(result.recurringPerPeriod)}`,
      `One-time fees        ${summaryMoney(result.oneTime)}`,
      `Total contract value ${summaryMoney(result.tcv)}` +
        (Number(result.listTcv) > Number(result.tcv)
          ? ` (list ${summaryMoney(result.listTcv)})`
          : ''),
    ]),
  );

  // --- Approval. 'none' is a real answer and is stated, not omitted: a blank here would read as
  // "not checked" rather than "checked, nobody needs to sign off". ---
  const approvalRows = [
    `Required             ${summaryApprovalTier(result.approvalTierRequired)}`,
  ];
  for (const reason of result.approvalReasons || []) approvalRows.push(`- ${reason}`);
  out.push(...summarySection('APPROVAL', approvalRows));

  // Trailing blank lines from the last section, trimmed.
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};

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
    // The rep's professional-services and add-on picks, mirrored onto the Deal's own properties so
    // the portal's reporting and the order-form workflows can read them without parsing
    // pricing_quote_inputs_payload. Both are guarded in UNVERIFIED_DEAL_PROPERTIES.
    professional_services_package:
      hubSpotChoiceList(input.professionalServices, professionalServiceHubSpotValue) ||
      PROFESSIONAL_SERVICES_NONE,
    // No equivalent of "No" here -- the portal has no such option, so no add-ons clears it.
    pricing_subscription_addons: hubSpotChoiceList(input.addOns, addOnHubSpotValue),
    // The whole configuration in words. See contractSummaryText.
    pricing_contract_summary: contractSummaryText(option),
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
    // True only when there is text to show. normalizeInput already blanks specialTerms when the
    // box is unticked, so this follows the text rather than the checkbox: a quote template keyed
    // on it will not print an empty Special Terms block for a rep who ticked and typed nothing.
    special_terms_included: String((input.specialTerms || '').trim() !== ''),
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
  const category = dealCategory(settings, state.dealType, state.pipelineId);
  const result = calculateQuote(
    parameters.input,
    settings.pricingPolicy,
    settings.version,
    category,
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
  // A change or renewal quote must say which contract it is for. Holly, 2026-08-30.
  //
  // Same position rule as the two guards above: this is ABOVE every write. syncDealLineItems now
  // creates before it archives, so a late failure is survivable -- but a guard that refuses the
  // lock should still refuse it before anything has been written at all, not after.
  // From the TEMPLATE, not from a separate control. The card sends the template the rep picked;
  // Settings says which kind that template belongs to; the kind says whether a contract applies.
  const lockedQuoteKind = resolveQuoteKind(
    settings,
    category,
    parameters.quoteContent?.templateId,
    null,
  );
  const chosenContractId = await assertContractChosen(
    client,
    dealId,
    quoteKindForTemplate(settings, category, parameters.quoteContent?.templateId),
    parameters.contractId,
  );

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
    // Change or renewal -- which of the two documents a renewal Deal prints. Kept on the OPTION
    // and deliberately NOT on option.input, for the same reason dealCategory is an argument to
    // calculateQuote rather than an input field (see the comment above calculateQuote): the input
    // is hashed, so putting it there would make the identical configuration hash differently on a
    // change and a renewal and mark the line items stale over a choice that moves no number.
    //
    // No new Deal property either. The option document already rides in a property this portal is
    // known to have, and readDealState hands it back, so the choice survives a reload without
    // sending a property name nobody has verified.
    quoteKind: lockedQuoteKind,
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
      // Validated above, so this is an id that exists on the company or nothing at all.
      contractId: chosenContractId,
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
  // A PERCENTAGE, not the flat `discount` amount this used to send. Holly, 2026-08-31: discounts
  // are always expressed in %. `discount` is deliberately NOT in this list any more -- a line
  // carrying both fields would have HubSpot apply one and the reader believe the other. Managed
  // line items are recreated rather than updated on every sync, so no line survives with a stale
  // flat amount on it. hs_discount_percentage is HubSpot-defined on line items in every portal.
  'hs_discount_percentage',
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

// BATCHED LINE ITEM WRITES
//
// A HubSpot app function is KILLED AT 10 SECONDS of execution. A Lock in used to make roughly 120
// API calls: one create and one read-back per line item, on the Deal AND again on the quote, plus
// one archive per previous line item. A 15-line configuration spent the whole budget inside the
// Deal sync, and the function was killed before generateQuote could create the quote at all --
// Deal line items written, no quote, and NO exception, because nothing threw. No amount of error
// handling catches that. The fix is to stop making the calls.
//
// Batched, each surface costs four calls instead of about fifty.
const LINE_ITEM_BATCH_LIMIT = 100;

const chunked = (values, size) => {
  const groups = [];
  for (let index = 0; index < values.length; index += size) {
    groups.push(values.slice(index, index + size));
  }
  return groups;
};

// The batch response is joined back to what was sent BY POSITION, cross-checked on hs_product_id.
// Patching the wrong record would be worse than not patching at all, so a join that cannot be
// verified is abandoned rather than guessed at -- the caller then simply skips the repair, which
// is the behaviour that existed before the repair was written.
const joinCreatedLineItems = (sent, results) => {
  if (!Array.isArray(results) || results.length !== sent.length) return null;
  const pairs = [];
  for (let index = 0; index < sent.length; index += 1) {
    const created = results[index];
    if (!created?.id) return null;
    const sentProductId = sent[index].properties.hs_product_id;
    const storedProductId = created.properties?.hs_product_id;
    if (sentProductId && storedProductId && String(storedProductId) !== String(sentProductId)) {
      return null;
    }
    pairs.push({ id: String(created.id), sent: sent[index].properties });
  }
  return pairs;
};

// `createdIds` is the CALLER'S array and is appended to as soon as each id exists, exactly as the
// per-item loop did. A batch can come back MULTI_STATUS -- some created, some refused -- so the
// ids that did land have to be recorded before this throws, or the caller's rollback archives
// nothing and leaves them orphaned.
const createLineItemsBatch = async (client, items, createdIds = [], attempt = 0) => {
  if (items.length === 0) return [];
  try {
    const results = [];
    for (const group of chunked(items, LINE_ITEM_BATCH_LIMIT)) {
      const response = await client.crm.lineItems.batchApi.create({
        inputs: group.map(({ properties, associations }) => ({ properties, associations })),
      });
      const created = response?.results || [];
      for (const item of created) createdIds.push(String(item.id));
      results.push(...created);
      if (response?.errors?.length) {
        const failure = new Error('LINE_ITEM_BATCH_PARTIAL');
        failure.body = { message: JSON.stringify(response.errors).slice(0, 2_000) };
        failure.code = 400;
        throw failure;
      }
    }
    return results;
  } catch (error) {
    if (isTransientRejection(error) && attempt < 3) {
      await delay(400 * 2 ** attempt);
      return createLineItemsBatch(client, items, createdIds, attempt + 1);
    }
    // A batch fails as ONE unit, so a property this portal does not have must be dropped from
    // EVERY input rather than from the one line whose name appeared in the message.
    const rejected = OPTIONAL_CUSTOM_LINE_ITEM_PROPERTIES.find(
      (property) =>
        items.some(({ properties }) => properties[property] != null) &&
        isUnknownPropertyRejection(error, property),
    );
    if (rejected) {
      console.error(
        `Nylas pricing: HubSpot rejected ${rejected} as a Line Item property this portal does ` +
          'not have. Recreating every line item WITHOUT it -- that field will be blank. ' +
          `Rejection: ${String(error?.body?.message || error?.message || error)}`,
      );
      return createLineItemsBatch(
        client,
        items.map(({ properties, associations }) => {
          const { [rejected]: unused, ...rest } = properties;
          return { properties: rest, associations };
        }),
        createdIds,
        attempt,
      );
    }
    // Anything else: fall back to one create per line item. A batch refused for a reason we do
    // not recognise must not cost the whole quote, and per-item is where the bundle fallback and
    // the single-property drop still live. Slower, but only on the path that was already failing.
    console.error(
      'Nylas pricing: batch line item create failed; falling back to one create per line item. ' +
        `${String(error?.body?.message || error?.message || error)}`,
    );
    const created = new Array(items.length);
    const indexed = items.map((item, index) => ({ item, index }));
    await inBatches(indexed, async ({ item, index }) => {
      const record = await createLineItem(client, item.properties, item.associations);
      createdIds.push(String(record.id));
      created[index] = record;
    });
    return created;
  }
};

// One read and at most one update, instead of a getById per line item on both surfaces.
// Same guarantee as before: the fee properties are read back, and anything HubSpot silently
// dropped is written again. Failures here are logged and swallowed -- a quote that exists with a
// blank fee column is worth more than no quote.
const repairLineItemsBatch = async (client, pairs) => {
  const expected = pairs
    .map(({ id, sent }) => ({
      id,
      properties: Object.fromEntries(
        VERIFIED_LINE_ITEM_PROPERTIES.filter((name) => sent[name] != null).map((name) => [
          name,
          String(sent[name]),
        ]),
      ),
    }))
    .filter(({ properties }) => Object.keys(properties).length > 0);
  if (expected.length === 0) return [];
  try {
    const stored = await client.crm.lineItems.batchApi.read({
      properties: VERIFIED_LINE_ITEM_PROPERTIES,
      inputs: expected.map(({ id }) => ({ id })),
    });
    const storedById = new Map(
      (stored?.results || []).map((record) => [String(record.id), record.properties || {}]),
    );
    const updates = [];
    for (const { id, properties } of expected) {
      const have = storedById.get(id);
      if (!have) continue;
      const missing = Object.fromEntries(
        Object.entries(properties).filter(([name]) => {
          const value = have[name];
          return value == null || value === '';
        }),
      );
      if (Object.keys(missing).length > 0) updates.push({ id, properties: missing });
    }
    if (updates.length === 0) return [];
    console.error(
      `Nylas pricing: ${updates.length} line item(s) were created WITHOUT fee properties that ` +
        'were sent. Patching them back.',
    );
    await client.crm.lineItems.batchApi.update({ inputs: updates });
    return updates.map(({ id }) => id);
  } catch (error) {
    console.error(
      'Nylas pricing: could not verify or repair line item fee properties. ' +
        String(error?.body?.message || error?.message || error),
    );
    return [];
  }
};

const archiveLineItemsBatch = async (client, ids) => {
  if (ids.length === 0) return;
  for (const group of chunked(ids, LINE_ITEM_BATCH_LIMIT)) {
    await client.crm.lineItems.batchApi.archive({
      inputs: group.map((id) => ({ id: String(id) })),
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

const syncDealLineItems = async (client, dealId, state, settings) => {
  const option = selectedOptionForDraft(state);
  assertCurrentSettings(option, settings);
  const desired = buildDealLineItems(option);
  const createdIds = [];
  // How many of the OLD line items have gone, for the message below.
  let archivedCount = 0;
  // Whether archiving has BEGUN. It decides whether a failure can be rolled back: while this is
  // false the Deal still holds everything it started with, so the replacements can be removed.
  //
  // This used to be `archivedCount === 0`, counted one archive at a time. The archive is now a
  // single batch call, so a failure part-way through is not countable -- and the conservative
  // reading is the safe one. Once the archive has been ATTEMPTED we no longer know whether an
  // original survived, so the replacements are KEPT. That preserves the invariant that actually
  // matters (the Deal is never left empty) and costs only that a failed archive may leave
  // duplicates, which is the trade this ordering already accepts.
  let archiveStarted = false;
  try {
    const existingIds = await associatedIds(client, 'deals', dealId, 'line_items', 1_000);

    // CREATE FIRST, ARCHIVE AFTER. The order is the whole point.
    //
    // This used to archive the Deal's line items and then create the replacements, with no
    // restore. Any rejected create -- one bad property name, one invalid enumeration value, one
    // rate limit at the wrong moment -- left the Deal with NOTHING. That is what `units` did on
    // 2026-08-28, and it is the reason every "never guess a property name" rule exists: the rules
    // were guarding a sequence that could not survive being wrong.
    //
    // Creating first means a failed create is survivable. The replacements are rolled back and
    // the Deal is exactly as it was. The cost is that the Deal briefly holds both sets, roughly
    // 26 line items on a typical quote against a 1,000 association ceiling, which is not close.
    const sending = desired.map((item) => ({
      properties: hubSpotLineItemProperties(item.properties),
      associations: [createAssociation(dealId, 20)],
    }));
    const created = await createLineItemsBatch(client, sending, createdIds);
    // Read back and repair rather than trust the write. See repairLineItemsBatch.
    await repairLineItemsBatch(client, joinCreatedLineItems(sending, created) || []);

    archiveStarted = true;
    await archiveLineItemsBatch(client, existingIds);
    archivedCount = existingIds.length;

    const syncedAt = new Date().toISOString();
    await client.crm.deals.basicApi.update(dealId, {
      properties: {
        pricing_line_item_sync_status: 'synced',
        pricing_line_items_synced_at: syncedAt,
      },
    });
    return { count: desired.length, syncedAt };
  } catch (error) {
    // Roll the replacements back ONLY while no original has been archived. Once even one is gone,
    // removing the replacements too is what would empty the Deal -- the exact outcome this
    // ordering exists to prevent. So a failure during the archive phase deliberately leaves the
    // Deal holding both sets: duplicated line items are visible and fixable by hand, an empty
    // Deal is silent and is not.
    if (!archiveStarted) {
      await archiveLineItemsBatch(client, createdIds).catch(() => undefined);
    } else {
      console.error(
        `Nylas pricing: line item sync failed after archiving ${archivedCount} of the Deal's ` +
          `previous line items, with ${createdIds.length} replacements already created. The ` +
          'replacements were KEPT so the Deal is not left empty. It may now show duplicates ' +
          'that need removing by hand.',
      );
    }
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
// The only template model this app will build a quote from.
//
// A portal can still hold `customizable_quote_template` records -- this one has three ("Default
// Original", "Default Basic", "Default Modern"). They are the LEGACY model. A quote created with
// hs_template_type CPQ_QUOTE and then associated to one of them is a mismatch, and HubSpot
// reports it as "One or more associations are invalid" without naming the template.
//
// This constant used to name the legacy type as the required one, which is backwards and is why
// nothing was filtered. Holly, 2026-09-01: "make sure the only templates we are creating are CPQ
// and not legacy."
const REQUIRED_QUOTE_TEMPLATE_TYPE = 'cpq_template';

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
        ['hs_name', 'hs_type', 'hs_active'],
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
//
// Narrowed PER QUOTE KIND since 2026-08-30. The Deal's pipeline resolves the CATEGORY, which a
// rep never chooses; within a renewal category the rep chooses the KIND -- change or renewal --
// and that picks the list. So a new-business template can no longer be offered on a renewal Deal
// by mistake.
const offeredQuoteTemplates = (templates, settings, quoteKind) => {
  const { enabledIds } = quoteTemplateSettings(settings, quoteKind);
  if (enabledIds.length === 0) return templates;
  const allowed = new Set(enabledIds.map(String));
  const narrowed = templates.filter(({ id }) => allowed.has(String(id)));
  // Never hand back an empty picker because every chosen template has since been deleted -- that
  // reads as a broken card. Fall back to everything and say so.
  if (narrowed.length === 0) {
    console.warn(
      `Nylas pricing: none of the quote templates chosen in Settings for ${quoteKind} still ` +
        'exist. Offering every usable template instead.',
    );
    return templates;
  }
  return narrowed;
};

// This kind's default, then the QUOTE_TEMPLATE_ID secret, which is where the default lived before.
const defaultQuoteTemplateFor = (settings, quoteKind) =>
  quoteTemplateSettings(settings, quoteKind).defaultId || configuredQuoteTemplateId();

// THE TEMPLATE DECIDES THE KIND. Holly, 2026-08-30, after seeing the first deploy.
//
// There used to be a separate Quote Type control, and the card resolved kind -> template list.
// That inverted the real dependency and let the two disagree on screen: Quote Type said "Change"
// while the template picker sat on "(TESTING) New Business". The template is what actually prints,
// so it is the input, and the kind is derived from it.
//
// The mapping lives in Settings and nowhere else -- a template is a change template because an
// admin put it in the change kind's list, not because of anything in its name.
const quoteKindForTemplate = (settings, category, templateId) => {
  const id = String(templateId || '');
  if (!id) return null;
  // CHANGE AND RENEWAL FIRST, new_business last.
  //
  // Not QUOTE_KINDS order. Listing a template under new_business means "this pipeline may quote
  // from it"; listing it under change or renewal is a statement about what the DOCUMENT IS. So a
  // template put in both -- which is exactly how an upsell in the new business pipeline gets the
  // Change document -- keeps its own identity rather than being renamed by the pipeline that
  // borrowed it. Otherwise it would print the change document while the app called it new
  // business, and the contract picker would never appear.
  return (
    ['change', 'renewal', 'new_business'].find((kind) =>
      quoteTemplateSettings(settings, kind).enabledIds.map(String).includes(id),
    ) || null
  );
};

// Every template the Deal's category may offer, as ONE list, plus which kind claims each.
//
// The union across the category's kinds, de-duplicated, first kind winning a tie. A new-business
// Deal has one kind so this is just its list. Sending the claim map means the card can decide
// whether a contract applies the instant the rep changes template, with no round trip.
//
// A template no kind claims is normal, not an error: an empty enabledIds means "offer every
// template", which is what an unconfigured portal has. Those templates simply carry no kind, and
// no contract is asked for -- see the comment on contractApplies below.
const quoteTemplatesForCategory = (templates, settings, category) => {
  const kinds = quoteKindsForCategory(category);
  const seen = new Set();
  const merged = [];
  const templateKinds = {};
  for (const kind of kinds) {
    for (const template of offeredQuoteTemplates(templates, settings, kind)) {
      if (seen.has(String(template.id))) continue;
      seen.add(String(template.id));
      merged.push(template);
    }
    for (const id of quoteTemplateSettings(settings, kind).enabledIds) {
      if (!(String(id) in templateKinds)) templateKinds[String(id)] = kind;
    }
  }
  return {
    templates: merged,
    templateKinds,
    defaultTemplateId: defaultQuoteTemplateFor(settings, kinds[0]),
  };
};

// Whether a contract applies to this quote. ONLY when the chosen template is explicitly a change
// or renewal template in Settings.
//
// Deliberately NOT "this Deal is in a renewal pipeline". A renewal-pipeline Deal quoting from the
// new-business template is a new-business document and has no contract to point at. And on an
// unconfigured portal no template is claimed by any kind, so nothing is asked for -- the contract
// picker appears once an admin assigns the change and renewal templates, which is slice 3.
const contractApplies = (quoteKind) => quoteKind === 'change' || quoteKind === 'renewal';

// The kind to RECORD on a locked option. Derived from the template; falls back to what the option
// already carried, then to the category's first kind, so a stored option is never kindless.
const resolveQuoteKind = (settings, category, templateId, storedOption) =>
  quoteKindForTemplate(settings, category, templateId) ||
  (storedOption?.quoteKind &&
  quoteKindsForCategory(category).includes(String(storedOption.quoteKind))
    ? String(storedOption.quoteKind)
    : quoteKindsForCategory(category)[0]);

// CONTRACTS. Read-only, on a DATED path -- not /crm/v3 -- and gated on a scope this app may not
// have. HubSpot creates a contract when a quote is accepted; nothing here can create one, which is
// why a rep facing an empty list has no way to fix it themselves. That shapes every decision below.
// TRIED IN ORDER until one answers, because the right one is not knowable from the docs.
//
// On 2026-08-30 a company with three real contracts -- one ACTIVE, "COVIS 2026 Manual Renewal",
// $4,800 -- read back as ZERO, with no error. HubSpot returned an empty page rather than a 404,
// so a wrong object path and an empty portal were indistinguishable. Guessing which was wrong
// three times, so the code now tries the candidates and reports which one answered.
// NOTE, 2026-08-30: the path below is CORRECT and was still not the problem. Reading portal
// 45023718 through the HubSpot connector (a different set of credentials) returned 2,536
// contracts from this exact path, while this app's private-app token returned zero from it. An
// object read the token is not scoped for comes back 200-and-empty on this object rather than
// 403, which is what made a permissions problem look like a path problem for five builds.
// crm.objects.contracts.read is now a REQUIRED scope; optional was not enough.
//
// 0-721 is the contracts object's TYPE ID, confirmed against portal 45023718 on 2026-08-30:
// record URLs are /contacts/45023718/record/0-721/{id} and the portal holds 2,536 of them.
//
// The NAME does not work. '/crm/v3/objects/contracts' answers 200 with zero records -- not a 404
// -- which is why four rounds of guessing got nowhere: a wrong name and an empty portal look
// identical. Type ids for HubSpot-defined objects are constant across portals (0-1 contacts, 0-2
// companies, 0-3 deals, 0-14 quotes), so this is not portal-specific.
//
// The names are kept behind it in case a portal answers on one of them.
const CONTRACT_PATH_CANDIDATES = Object.freeze([
  '/crm/v3/objects/0-721',
  '/crm/v3/objects/contracts',
  '/crm/objects/2026-03/contracts',
]);
// Same failure mode on the association side: an unrecognised toObjectType comes back as an empty
// page rather than an error.
const CONTRACT_ASSOCIATION_TYPES = Object.freeze(['contracts', 'contract']);
// Individual retrieval is a DIFFERENT API from the list. HubSpot's own docs: "To retrieve a
// contract, make a GET request to /commerce/contracts/2026-09-beta/contracts/{contractId}... To
// batch retrieve or retrieve all contract records, use the Contracts object API." Tried for
// single reads only -- it has no /batch/read and is not a list endpoint.
const CONTRACT_SINGLE_PATHS = Object.freeze([
  '/commerce/contracts/2026-09-beta/contracts',
  ...CONTRACT_PATH_CANDIDATES,
]);
// hs_status is the contract's status field -- Holly, 2026-08-30, from the portal. It is NOT in
// HubSpot's published property list for this object (which documents only hs_name, the dates and
// the ids), so it is read with a fallback rather than trusted: a batch read naming a property the
// portal lacks fails with a 400 and would take the whole picker down with it. Same reasoning as
// createLineItem's retry.
const CONTRACT_STATUS_PROPERTY = 'hs_status';
// Confirmed against a real record on 2026-08-30, not taken from documentation. hs_start_date is
// read as well because it is what the UI labels "Contract start date" and it is populated where
// hs_contract_effective_date might not be.
const CONTRACT_PROPERTIES = [
  'hs_name',
  CONTRACT_STATUS_PROPERTY,
  'hs_contract_effective_date',
  'hs_start_date',
  'hs_createdate',
];

// The status values, confirmed from HubSpot's Contracts API beta documentation (Holly,
// 2026-08-30). UPPERCASE, and there are exactly four:
//
//   DRAFT       created in the UI but not finalised, OR created with a FUTURE effective date --
//               it becomes ACTIVE on that date
//   ACTIVE      currently in effect
//   COMPLETED   the billing period ended. Evergreen line items never reach this
//   TERMINATED  manually terminated
//
// Compared case-insensitively, and that is load-bearing rather than defensive: the documented
// enum is uppercase (ACTIVE) and this portal actually stores 'active'. Confirmed on a real record
// 2026-08-30. A case-sensitive match would have hidden every contract.
const QUOTABLE_CONTRACT_STATUSES = Object.freeze(['ACTIVE', 'DRAFT']);
const contractStatusRank = (status) =>
  QUOTABLE_CONTRACT_STATUSES.indexOf(String(status || '').trim().toUpperCase());
const isQuotableContract = (status) => contractStatusRank(status) >= 0;

// Why the failure is reported rather than swallowed: until the crm.objects.contracts.read scope is
// added and the app reinstalled, every one of these returns 403. A picker that is silently empty
// in that state is indistinguishable from a company with no contracts, and the two need completely
// different responses from whoever is looking at the card.
const contractUnavailableReason = (error) => {
  const status = error?.code ?? error?.statusCode ?? error?.response?.status;
  if (status === 403) return 'scope_missing';
  if (status === 400 || status === 404) return 'not_supported';
  return 'error';
};

// Tries EVERY candidate path, not just the one the probe liked.
//
// On 2026-08-30 the associations returned real contract ids and the batch read still came back
// empty: the ids were right and the path was not. A batch read on the wrong object answers 200
// with an empty results array rather than failing, so this cannot be left to one guess either.
const readContractDetails = async (client, ids, preferredPath) => {
  if (ids.length === 0) return { contracts: [], readPath: null };
  const paths = [
    preferredPath,
    ...CONTRACT_PATH_CANDIDATES.filter((path) => path !== preferredPath),
  ].filter(Boolean);
  let usedPath = null;
  let usedStrategy = null;
  // The HTTP reason the reads gave, kept rather than swallowed. Builds 4-7 caught per-id errors
  // one at a time and only warned, so a 403 -- the single fact that separates "not scoped" from
  // "not there" -- never reached the card. That is why five builds argued about paths.
  let lastReadReason = null;
  // TWO strategies, because batch/read does not work on this object.
  //
  // Observed 2026-08-30: the associations returned two real contract ids and the LIST endpoint
  // GET /crm/v3/objects/contracts answered with records -- while POST .../batch/read returned 200
  // with an empty array for those same ids. Not an error, just nothing. So batch is tried first
  // (one call when it works) and single-record GETs are the fallback, which is the most basic
  // endpoint there is and the one the working list implies.
  const readBatch = async (path, properties) => {
    const response = await client.apiRequest({
      method: 'POST',
      path: `${path}/batch/read`,
      body: { inputs: ids.map((id) => ({ id: String(id) })), properties },
    });
    return (await response.json())?.results || [];
  };
  // Capped: a company with fifty contracts must not turn one card load into fifty calls. The
  // picker shows the quotable ones and this is the fallback path, not the normal one.
  const readOneByOne = async (path, properties) => {
    const found = [];
    for (const id of ids.slice(0, 25)) {
      try {
        const response = await client.apiRequest({
          method: 'GET',
          path: `${path}/${encodeURIComponent(String(id))}?properties=${properties.join(',')}`,
        });
        const contract = await response.json();
        if (contract?.id) found.push(contract);
      } catch (error) {
        lastReadReason = contractUnavailableReason(error);
        console.warn(
          `Nylas pricing: contract ${id} could not be read from ${path} (${lastReadReason}).`,
          safeProviderDiagnostics(error, 'read_contract'),
        );
      }
    }
    return found;
  };
  // LIST EVERYTHING AND PICK. The endpoint of last resort, and on this portal the only one that
  // works: on 2026-08-30 the list answered with records while both batch/read and the per-id GET
  // returned nothing for ids the associations had just handed over.
  //
  // Paged, and it stops as soon as every wanted id is found -- the cap is there so a portal with
  // thousands of contracts cannot turn one card load into an unbounded walk.
  const readByListing = async (path, properties) => {
    const wanted = new Set(ids.map(String));
    const found = [];
    let after;
    for (let page = 0; page < 5 && wanted.size > 0; page += 1) {
      const query =
        `${path}?limit=100&properties=${properties.join(',')}` +
        (after ? `&after=${encodeURIComponent(after)}` : '');
      const response = await client.apiRequest({ method: 'GET', path: query });
      const body = await response.json();
      for (const contract of body?.results || []) {
        if (!wanted.has(String(contract?.id))) continue;
        wanted.delete(String(contract.id));
        found.push(contract);
      }
      after = body?.paging?.next?.after;
      if (!after) break;
    }
    return found;
  };
  const read = async (properties) => {
    let lastError = null;
    for (const [name, strategy, strategyPaths] of [
      ['batch', readBatch, paths],
      ['single', readOneByOne, CONTRACT_SINGLE_PATHS],
      ['listing', readByListing, paths],
    ]) {
      for (const path of strategyPaths) {
        try {
          const results = await strategy(path, properties);
          if (results.length > 0) {
            usedPath = path;
            usedStrategy = name;
            return results;
          }
        } catch (error) {
          lastError = error;
          lastReadReason = contractUnavailableReason(error);
        }
      }
    }
    // Everything either failed or answered with nothing. Surface a failure if there was one, so a
    // missing scope is never silently reported as "no contracts".
    if (lastError) throw lastError;
    return [];
  };
  let results;
  try {
    results = await read(CONTRACT_PROPERTIES);
  } catch (error) {
    // Only for hs_status, and only when HubSpot says that property does not exist. Anything else
    // is a real failure and belongs in the caller's honest "why is this empty" reporting.
    if (!isUnknownPropertyRejection(error, CONTRACT_STATUS_PROPERTY)) throw error;
    console.warn(
      `Nylas pricing: this portal has no ${CONTRACT_STATUS_PROPERTY} on contracts. Listing them ` +
        'without status rather than showing no contracts at all.',
    );
    results = await read(CONTRACT_PROPERTIES.filter((name) => name !== CONTRACT_STATUS_PROPERTY));
  }
  const contracts = results.map((contract) => {
    const name = contract?.properties?.hs_name || '';
    const status = contract?.properties?.[CONTRACT_STATUS_PROPERTY] || '';
    const effective = String(
      contract?.properties?.hs_contract_effective_date ||
        contract?.properties?.hs_start_date ||
        '',
    ).slice(0, 10);
    return {
      id: String(contract.id),
      // Never blank: a nameless option is unpickable. The status and effective date are what tell
      // two contracts for the same customer apart, so they are in the label, not a tooltip.
      label: [
        name || `Contract ${contract.id}`,
        status || '',
        effective ? `effective ${effective}` : '',
      ]
        .filter(Boolean)
        .join(' — '),
      status,
      effectiveDate: effective,
    };
  });
  return {
    contracts,
    readPath: usedPath,
    readStrategy: usedStrategy,
    readReason: lastReadReason,
  };
};

// The CONTRACTS OF THE DEAL'S COMPANY. Holly, 2026-08-30: a rep thinks in terms of the customer's
// contracts, not this Deal's -- and a renewal Deal usually has no contract of its own, because
// HubSpot associates a new contract to the deal whose quote was accepted, not to next year's.
// WHICH object path this portal answers on, and what it returned. Reported, never assumed --
// that is the whole point: an empty result and a wrong path look identical.
const probeContractPaths = async (client) => {
  const attempts = [];
  for (const path of CONTRACT_PATH_CANDIDATES) {
    try {
      const response = await client.apiRequest({ method: 'GET', path: `${path}?limit=1` });
      const count = ((await response.json())?.results || []).length;
      attempts.push({ path, ok: true, count });
      // A path returning RECORDS is proof it is the right one. A path returning 200-and-empty is
      // only evidence it is not broken -- kept as a fallback, never as proof.
      if (count > 0) return { path, attempts };
    } catch (error) {
      attempts.push({
        path,
        ok: false,
        reason: contractUnavailableReason(error),
        detail: String(error?.body?.message || error?.message || error).slice(0, 200),
      });
    }
  }
  return { path: null, attempts };
};

// What the probe lets us honestly say. The distinction that matters: a path that returned RECORDS
// proves contracts exist somewhere; a path that returned 200-and-empty proves only that the call
// worked. Those two were conflated on 2026-08-30 and the card confidently reported "no contracts
// exist in this portal" while three sat on the company.
// Bumped whenever the contract read changes. It is printed on the card so a probe line can be
// attributed to a BUILD -- twice now an identical line has been reported and there was no way to
// tell "the fix is not deployed" from "the fix did not work".
const CONTRACT_PROBE_BUILD = 8;

// The contracts object's TYPE ID, asked for rather than guessed.
//
// Observed 2026-08-30 on build 4: associations resolve 'contracts' and hand back a real id, while
// /crm/v3/objects/contracts answers 200 with ZERO records. A name that resolves for associations
// and not for the objects API means the objects API wants the numeric type id (0-XXX), and that
// id is portal-visible through the schema endpoints. So it is looked up instead of guessed at a
// fourth time.
//
// Only called when the normal paths have already come back empty, so it costs nothing on a
// portal where contracts read fine.
const discoverContractObjectType = async (client) => {
  for (const path of ['/crm/v3/schemas', '/crm-object-schemas/v3/schemas']) {
    try {
      const response = await client.apiRequest({ method: 'GET', path });
      const body = await response.json();
      const match = (body?.results || []).find((schema) =>
        [
          schema?.name,
          schema?.fullyQualifiedName,
          schema?.labels?.singular,
          schema?.labels?.plural,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes('contract')),
      );
      if (match?.objectTypeId) {
        return {
          objectTypeId: String(match.objectTypeId),
          name: String(match.fullyQualifiedName || match.name || ''),
          from: path,
        };
      }
    } catch (error) {
      console.warn(
        `Nylas pricing: could not read object schemas from ${path}.`,
        safeProviderDiagnostics(error, 'discover_contract_type'),
      );
    }
  }
  return null;
};

const readContractProbe = (probe) => ({
  // Best path to read properties from: one that returned records, else one that at least answered.
  path: probe.path || probe.attempts.find(({ ok }) => ok)?.path || null,
  sawRecords: probe.attempts.some(({ ok, count }) => ok && count > 0),
  // How many records the LIST actually returned. "A path answered" and "a path answered with
  // records" are different facts, and only the second one means the object is readable there.
  listed: probe.attempts.reduce((total, { count }) => total + (count || 0), 0),
  answered: probe.attempts.some(({ ok }) => ok),
  // Why nothing answered, when nothing did. A 403 here means the scope, and saying so is the
  // difference between an actionable message and a shrug.
  reason: probe.attempts.some(({ ok }) => ok)
    ? null
    : probe.attempts.find(({ reason }) => reason)?.reason || null,
});

// Contract ids associated to a record, trying each candidate association type until one answers.
// A rejected type is information, not a failure -- only if every candidate comes back empty or
// rejected does the caller report the read as unavailable.
const associatedContractIds = async (client, fromType, fromId) => {
  let rejections = 0;
  let lastReason = null;
  for (const toType of CONTRACT_ASSOCIATION_TYPES) {
    try {
      const ids = await associatedIds(client, fromType, fromId, toType, 50);
      if (ids.length > 0) return { ids, associationType: toType, failed: null };
    } catch (error) {
      rejections += 1;
      lastReason = contractUnavailableReason(error);
      console.warn(
        `Nylas pricing: ${fromType} -> ${toType} association rejected.`,
        safeProviderDiagnostics(error, 'associate_contracts'),
      );
    }
  }
  // EVERY candidate threw -- that is a real failure (a missing scope, most likely) and must not
  // be flattened into "no contracts". One candidate rejecting while another answers empty is
  // just the wrong name being tried, which is what the loop is for.
  return {
    ids: [],
    associationType: null,
    failed: rejections === CONTRACT_ASSOCIATION_TYPES.length ? lastReason : null,
  };
};

// The Deal's company name, for the default quote title. Never fatal: a missing name falls back
// to the deal name rather than failing the card load.
const dealCompanyName = async (client, dealId) => {
  try {
    const companyIds = await associatedIds(client, 'deals', dealId, 'companies', 1);
    if (!companyIds[0]) return '';
    const company = await client.crm.companies.basicApi.getById(companyIds[0], ['name']);
    return company?.properties?.name || '';
  } catch (error) {
    console.warn(
      'Nylas pricing: could not read the company name for the quote title.',
      safeProviderDiagnostics(error, 'read_company_name'),
    );
    return '';
  }
};

// Sorting, filtering and the never-empty fallback, in ONE place. Both the normal read and the
// type-id discovery below return through here, so they cannot drift apart.
const finishContractOptions = ({ contracts }, fromDeal, contractDiagnostics) => {
  // ACTIVE first, then DRAFT, then newest effective date within each.
  const sorted = [...contracts].sort(
    (a, b) =>
      (contractStatusRank(a.status) < 0 ? 99 : contractStatusRank(a.status)) -
        (contractStatusRank(b.status) < 0 ? 99 : contractStatusRank(b.status)) ||
      String(b.effectiveDate).localeCompare(String(a.effectiveDate)),
  );
  // COMPLETED and TERMINATED are over: a change or renewal cannot point at one, so they are
  // hidden. DRAFT is kept -- a DRAFT contract has a future effective date and becomes ACTIVE on
  // it -- and every option prints its status, so a rep sees which is which.
  const quotable = sorted.filter(({ status }) => isQuotableContract(status));
  // NEVER hand back an empty picker because every contract happens to be finished: that reads on
  // the card as "this company has no contracts", which is a different answer and a wrong one.
  // Also covers a portal with no hs_status, where nothing is quotable.
  return {
    contracts: quotable.length > 0 ? quotable : sorted,
    contractSource: fromDeal.ids.length > 0 ? 'deal' : 'company',
    contractsUnavailable: null,
    contractDiagnostics,
  };
};

const contractOptions = async (client, dealId) => {
  try {
    const companyIds = await associatedIds(client, 'deals', dealId, 'companies', 1);
    // BOTH the Deal's own contracts and the company's, unioned.
    //
    // The company alone was not enough. HubSpot creates a contract from an accepted quote, and
    // where it lands is not something to assume: a real contract ("COVIS 2026 Manual Renewal")
    // existed on 2026-08-30 while the company read returned nothing. Reading both costs one call
    // and removes a whole class of "it says there are none but there are".
    const [fromDeal, fromCompany] = await Promise.all([
      associatedContractIds(client, 'deals', dealId),
      companyIds[0]
        ? associatedContractIds(client, 'companies', companyIds[0])
        : Promise.resolve({ ids: [], associationType: null, failed: null }),
    ]);
    const contractIds = [...new Set([...fromDeal.ids, ...fromCompany.ids])];
    const probe = readContractProbe(await probeContractPaths(client));
    // Carried to the card AND the logs. Without it an empty picker cannot be told apart from a
    // wrong object type, which is exactly what went wrong on 2026-08-30.
    const contractDiagnostics = {
      build: CONTRACT_PROBE_BUILD,
      listed: probe.listed,
      sawRecords: probe.sawRecords,
      readPath: null,
      readStrategy: null,
      associatedCount: contractIds.length,
      objectPath: probe.path,
      dealAssociationType: fromDeal.associationType,
      companyAssociationType: fromCompany.associationType,
    };
    console.log('Nylas pricing contracts probe:', JSON.stringify(contractDiagnostics));
    // A read that FAILED outright outranks any of the "nothing here" answers below.
    const readFailure = fromDeal.failed || fromCompany.failed;
    if (contractIds.length === 0 && readFailure) {
      return {
        contracts: [],
        contractSource: 'none',
        contractsUnavailable: readFailure,
        contractDiagnostics,
      };
    }
    if (contractIds.length === 0 || !probe.path) {
      return {
        contracts: [],
        contractSource: 'none',
        // Three genuinely different answers, and saying the wrong one is what cost today:
        //   none_associated  contracts demonstrably exist -- none is linked here. The rep's to fix
        //   none_found       nothing linked and none listed. Either there are none, or the read is
        //                    not finding them, and a 200-and-empty cannot tell those apart
        //   not_supported    no candidate path answered at all
        contractsUnavailable: probe.sawRecords
          ? 'none_associated'
          : probe.answered
            ? 'none_found'
            : probe.reason || 'not_supported',
        contractDiagnostics,
      };
    }
    const { contracts, readPath, readStrategy, readReason } = await readContractDetails(
      client,
      contractIds,
      probe.path,
    );
    contractDiagnostics.readPath = readPath;
    contractDiagnostics.readStrategy = readStrategy;
    // 'scope_missing' here is proof, not a theory: it means HubSpot REFUSED rather than answered
    // empty. Anything else means it answered and had nothing to give.
    contractDiagnostics.readReason = readReason || (contracts.length === 0 ? 'answered_empty' : null);
    contractDiagnostics.associatedCount = contractIds.length;
    if (contracts.length === 0) {
      // LAST RESORT: ask the portal what the contracts object is actually called, then read it
      // by type id. Everything above uses names from documentation; this uses the portal's own
      // answer, which is the only thing that has not been guessed yet.
      // NOTE: /crm/v3/schemas lists CUSTOM objects only, so it never returns CONTRACT, which is
      // HubSpot-defined. That is why this found nothing on build 5. Kept for a portal where
      // contracts really are a custom object, but the type id above is what actually works.
      const discovered = await discoverContractObjectType(client);
      contractDiagnostics.discoveredType = discovered?.objectTypeId || null;
      contractDiagnostics.discoveredName = discovered?.name || null;
      if (discovered?.objectTypeId) {
        const byTypeId = await readContractDetails(
          client,
          contractIds,
          `/crm/v3/objects/${discovered.objectTypeId}`,
        );
        if (byTypeId.contracts.length > 0) {
          console.log(
            `Nylas pricing: contracts read by object type id ${discovered.objectTypeId} ` +
              `(${discovered.name}). Add that path to CONTRACT_PATH_CANDIDATES.`,
          );
          return finishContractOptions(byTypeId, fromDeal, {
            ...contractDiagnostics,
            readPath: byTypeId.readPath,
            readStrategy: byTypeId.readStrategy,
          });
        }
      }
      // Ids came back and none of them could be read. A different answer from "there are none",
      // and the one that actually happened on 2026-08-30.
      console.error(
        `Nylas pricing: ${contractIds.length} contract association(s) found, but none could be ` +
          `read from ${CONTRACT_PATH_CANDIDATES.join(' or ')}. Associations resolving while ` +
          'object reads return nothing is what a MISSING crm.objects.contracts.read scope looks ' +
          'like on this object -- it answers 200-and-empty rather than 403. Check the granted ' +
          'scopes on the app before suspecting the path.',
      );
      return {
        contracts: [],
        contractSource: 'none',
        contractsUnavailable: 'unreadable',
        contractDiagnostics,
      };
    }
    return finishContractOptions({ contracts }, fromDeal, contractDiagnostics);
  } catch (error) {
    const reason = contractUnavailableReason(error);
    console.warn(
      `Nylas pricing: could not list contracts (${reason}).`,
      safeProviderDiagnostics(error, 'list_contracts'),
    );
    return { contracts: [], contractSource: 'none', contractsUnavailable: reason };
  }
};

// A change or renewal quote must say which contract it is for. Holly, 2026-08-30 -- the same rule
// the Contact for Quote picker follows.
//
// NARROWED, deliberately, and this is a departure from "block exactly like the contact picker".
// A rep can always create a contact; a rep CANNOT create a contract -- HubSpot makes those when a
// quote is accepted, and editing them needs a Revenue Hub seat. So blocking whenever no contract
// is chosen would dead-end every change and renewal quote on a portal without the scope, or a
// company whose first contract does not exist yet, with nothing the rep could do about it.
//
// It therefore blocks only when there was a real choice to make: contracts were read successfully
// AND at least one came back AND none was picked. Every other case reports on the card and lets
// the lock proceed.
const assertContractChosen = async (client, dealId, quoteKind, contractId) => {
  if (!contractApplies(quoteKind)) return null;
  const { contracts, contractsUnavailable } = await contractOptions(client, dealId);
  if (contractsUnavailable) {
    console.warn(
      `Nylas pricing: locking a ${quoteKind} quote without a contract -- contracts could not be ` +
        `listed (${contractsUnavailable}). Not blocking: the rep has no way to resolve this.`,
    );
    return null;
  }
  if (contracts.length === 0) {
    console.warn(
      `Nylas pricing: locking a ${quoteKind} quote without a contract -- this company has none. ` +
        'Not blocking: a contract cannot be created from here.',
    );
    return null;
  }
  const chosen = String(contractId || '');
  if (!chosen || !contracts.some(({ id }) => id === chosen)) {
    throw new Error('QUOTE_CONTRACT_REQUIRED');
  }
  return chosen;
};

// The contacts a rep may put on the quote.
//
// HubSpot lists Contact as a REQUIRED association on a CPQ quote, and the old code associated
// whatever the Deal happened to have -- so a Deal with no contact produced a quote with none, which
// HubSpot rejects with a message that blames the template. Making the choice explicit is what stops
// that. Holly, 2026-08-28.
//
// Deal contacts first. When the Deal has none, fall back to the contacts on its COMPANY, so the rep
// can pick one rather than being told to go and associate it somewhere else first.
// What the Seller block on the LIVE quote actually contains.
//
// Read on every card load rather than reported once at lock time: the card calls reloadPage()
// straight after the confirmation alert, so a message printed there is gone before it can be read.
// Three rounds of "the seller contact isn't coming through" produced no usable evidence for
// exactly that reason. This survives the reload, because it re-reads the quote.
// TEMP DIAGNOSTIC -- REMOVE WHEN THE TEMPLATE CHOICE IS SETTLED.
//
// Which template the LIVE quote was actually built from, read back from HubSpot's own
// association rather than from what the card believes it sent. The whole point is that it is
// evidence, not an echo: if the card says one thing and the quote says another, this is what
// shows it.
//
// The name is resolved from the template list the picker already loaded, so this costs ONE
// association read per card load and no extra name lookup.
//
// To remove: delete this function, the `latestQuoteTemplate:` line in the list response, and the
// block on the card marked TEMP.
const latestQuoteTemplate = async (client, quoteId, templates) => {
  if (!quoteId) return null;
  try {
    const ids = await associatedIds(client, 'quotes', String(quoteId), 'quote_template', 1);
    const id = ids[0] ? String(ids[0]) : '';
    if (!id) return { quoteId: String(quoteId), id: '', name: '' };
    const match = (templates || []).find((template) => String(template.id) === id);
    return { quoteId: String(quoteId), id, name: match?.name || '' };
  } catch (error) {
    console.warn(
      `Nylas pricing: could not read the template on quote ${quoteId}. ` +
        `${String(error?.body?.message || error?.message || error)}`,
    );
    return null;
  }
};

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
  const excluded = [];
  let after;
  try {
    do {
      const page = await readQuoteTemplatePage(client, after);
      for (const template of page?.results || []) {
        // ACTIVE CPQ TEMPLATES ONLY.
        //
        // An earlier version marked every template "(not supported)", which was the opposite
        // error -- a cpq_template IS the current model. The fix was to drop that label, but the
        // filter went with it, so the picker started offering the portal's legacy
        // customizable_quote_template records and its archived ones too. Neither can back a
        // CPQ_QUOTE.
        const type = template?.properties?.hs_type || '';
        if (type !== REQUIRED_QUOTE_TEMPLATE_TYPE) {
          excluded.push(`${template?.id} (${type || 'no type'})`);
          continue;
        }
        if (String(template?.properties?.hs_active) === 'false') {
          excluded.push(`${template?.id} (archived)`);
          continue;
        }
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
  if (excluded.length > 0) {
    console.log(
      `Nylas pricing: ${excluded.length} quote template(s) not offered -- not an active ` +
        `${REQUIRED_QUOTE_TEMPLATE_TYPE}: ${excluded.join(', ')}.`,
    );
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
// The owner record, read twice if it has to be.
//
// hs_sender_email is not decoration: HubSpot REFUSES to move a CPQ quote to PENDING_APPROVAL
// without it ("Required property 'hs_sender_email' is empty or missing"). So a Seller block that
// silently comes back blank does not just print an empty line on the quote -- it stops the quote
// ever being published or routed for approval.
//
// The SDK read has been returning an owner object with no firstName, lastName or email for an
// owner that plainly has them, so a failure there falls through to the REST endpoint directly.
// Same token, same scopes -- if that also answers empty, the answer is a missing owners scope and
// the log says so in those words rather than leaving it as "no name or email could be read".
const readOwnerDirectly = async (ownerId) => {
  try {
    const response = await fetch(`https://api.hubapi.com/crm/v3/owners/${encodeURIComponent(ownerId)}`, {
      headers: { Authorization: `Bearer ${getAccessToken()}`, 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      console.warn(
        `Nylas pricing: owners REST read for ${ownerId} answered ${response.status}. ` +
          'If this is 403, the app is missing the owners read scope.',
      );
      return null;
    }
    return await response.json();
  } catch (error) {
    console.warn(
      `Nylas pricing: owners REST read for ${ownerId} failed. ${String(error?.message || error)}`,
    );
    return null;
  }
};

const senderProperties = async (client, ownerId) => {
  if (!ownerId) return {};
  try {
    let owner = await client.crm.owners.ownersApi.getById(Number(ownerId));
    if (!owner?.firstName && !owner?.lastName && !owner?.email) {
      console.warn(
        `Nylas pricing: the SDK returned owner ${ownerId} with no name or email. Reading the ` +
          'owners endpoint directly before giving up.',
      );
      owner = (await readOwnerDirectly(ownerId)) || owner;
    }
    const firstName = owner?.firstName || '';
    const lastName = owner?.lastName || '';
    const email = owner?.email || '';
    if (!email) {
      console.error(
        `Nylas pricing: owner ${ownerId} has NO EMAIL. hs_sender_email is required before a CPQ ` +
          'quote can be moved to PENDING_APPROVAL, so this quote will stay at DRAFT. Check the ' +
          "owner's email in HubSpot, and that the app has the owners read scope.",
      );
    }
    if (!firstName && !lastName && !email) {
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

// QUOTE EXPIRATION -- 90 days from creation, matching the portal.
//
// HubSpot's own setting (Settings > Objects > Quotes > "Set a default expiration period") is
// 90 days. That default only applies to a quote created WITHOUT an explicit expiration, and the
// API requires hs_expiration_date on a CPQ quote -- so whatever this app sends always wins and
// the portal default never gets a chance to apply. Sending the same 90 days keeps an app-built
// quote and a hand-built one consistent, which is what a rep comparing the two would expect.
//
// It used to be pinned to the ORDER START DATE, which produced quotes that were already expired:
// quote 42607873610 was created on 2026-08-31 and expired 2025-08-31, and an expired quote cannot
// be accepted. Counting from creation makes that impossible by construction rather than by a
// floor. hs_contract_effective_start_date still carries the real order start date, so nothing
// about the contract itself moves.
//
// If the portal's default changes, change this to match -- it is not readable from the API.
const QUOTE_EXPIRY_DAYS = 90;

const quoteExpirationDate = (contractStartDate, now = new Date()) => {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  today.setUTCDate(today.getUTCDate() + QUOTE_EXPIRY_DAYS);
  return today.toISOString().slice(0, 10);
};

const archiveSupersededQuote = async (client, supersededQuoteId, newQuoteId) => {
  if (!supersededQuoteId || supersededQuoteId === String(newQuoteId)) return null;
  try {
    const superseded = await client.crm.quotes.basicApi.getById(supersededQuoteId, ['hs_status']);
    const status = superseded?.properties?.hs_status;
    if (!ARCHIVABLE_QUOTE_STATUSES.includes(String(status))) {
      console.warn(
        `Nylas pricing: superseded quote ${supersededQuoteId} left in place -- status is ` +
          `${status || 'unknown'}, which is not one of ` +
          `${ARCHIVABLE_QUOTE_STATUSES.join(', ')}.`,
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

// The "Deal with primary quote" association label.
//
// Holly, 2026-08-31: the newest quote has to be the Deal's primary quote, and it has to be re-set
// on every refresh because regenerating the quote drops it.
//
// CONFIRMED AGAINST THE LIVE PORTAL, 2026-08-31: the label exists, associationTypeId 1392,
// category HUBSPOT_DEFINED. It is still DISCOVERED by name rather than hardcoded -- guessing an id
// is exactly how the contracts read burned four rounds on 2026-08-30 -- but the id above is what a
// working portal answered, so a lookup that finds nothing is a real signal and not a mystery.
//
// A DRAFT QUOTE CANNOT BE PRIMARY. HubSpot's own documentation: a primary quote is "the published
// or accepted quote associated with a deal that updates the deal amount and line items", and draft
// quotes are explicitly ineligible. The live API agrees -- setting the label on draft quote
// 42569430708 was refused with "Quote ... is not eligible to become primary for deal ...".
//
// This app creates DRAFT quotes, so the attempt below is EXPECTED to fail at Lock in time, and
// that is not an error worth alarming anyone about. It is attempted anyway rather than skipped,
// because a quote that IS already published (a re-lock on an approved quote) should get the flag,
// and because the eligibility rule is HubSpot's to change, not ours to hardcode. What matters is
// that the card says precisely which of the two happened.
//
// Read once per invocation and cached: the schema does not change inside a single Lock in.
let primaryQuoteLabelCache;

const primaryQuoteAssociationType = async (client) => {
  if (primaryQuoteLabelCache !== undefined) return primaryQuoteLabelCache;
  try {
    const schema = await client.crm.associations.v4.schema.definitionsApi.getAll('quotes', 'deals');
    const definitions = schema?.results || [];
    // Matched on the LABEL, not on a position in the list. "primary" is the load-bearing word;
    // the portal is free to call it "Primary quote" or "Deal with primary quote".
    const match = definitions.find((entry) => /primary/i.test(String(entry?.label || '')));
    if (!match) {
      console.warn(
        'Nylas pricing: no primary-quote association label exists on quotes -> deals. ' +
          `Labels available: [${definitions.map((e) => e?.label || e?.typeId).join(', ')}]. ` +
          'Create one in HubSpot association settings and the next Lock in will apply it.',
      );
      primaryQuoteLabelCache = null;
      return primaryQuoteLabelCache;
    }
    primaryQuoteLabelCache = {
      typeId: match.typeId,
      label: match.label,
      category: match.category || 'USER_DEFINED',
    };
    console.info(
      `Nylas pricing: primary-quote label resolved -- "${match.label}" ` +
        `typeId=${match.typeId} category=${primaryQuoteLabelCache.category}`,
    );
    return primaryQuoteLabelCache;
  } catch (error) {
    console.warn(
      'Nylas pricing: could not read the quotes -> deals association labels. ' +
        `${String(error?.body?.message || error?.message || error)}`,
    );
    primaryQuoteLabelCache = null;
    return primaryQuoteLabelCache;
  }
};

// NEVER FAILS THE LOCK. The quote exists and the pricing is right by the time this runs; a missing
// primary flag is untidy, and throwing away a lock the rep has already committed is not a fix.
const markAsPrimaryQuote = async (client, quoteId, dealId) => {
  const labelType = await primaryQuoteAssociationType(client);
  if (!labelType) return { applied: false, label: null, reason: 'no primary-quote label' };
  try {
    // The label is ADDED to the association that already exists (type 64 above). HubSpot keeps
    // the default association and the labelled one together on the same pair, so this does not
    // replace the plain deal link.
    await client.crm.associations.v4.basicApi.create('quotes', String(quoteId), 'deals', String(dealId), [
      { associationCategory: labelType.category, associationTypeId: labelType.typeId },
    ]);
    console.info(
      `Nylas pricing: quote ${quoteId} marked as the primary quote on deal ${dealId}.`,
    );
    return { applied: true, label: labelType.label, reason: null };
  } catch (error) {
    const detail = String(error?.body?.message || error?.message || error);
    // Told apart from a real failure. "Not eligible" is HubSpot enforcing its own rule on a draft,
    // which is the normal path at Lock in; anything else is a problem worth looking at.
    const ineligible = /not eligible to become primary/i.test(detail);
    if (ineligible) {
      console.info(
        `Nylas pricing: quote ${quoteId} is a draft, so HubSpot will not make it the primary ` +
          `quote on deal ${dealId} yet. It becomes eligible when the quote is published.`,
      );
    } else {
      console.warn(
        `Nylas pricing: could not mark quote ${quoteId} primary on deal ${dealId}. ${detail}`,
      );
    }
    return {
      applied: false,
      label: labelType.label,
      ineligible,
      reason: detail,
    };
  }
};

const generateQuote = async (client, dealId, state, parameters, portalId, settings) => {
  const option = selectedOptionForDraft(state);
  assertCurrentSettings(option, settings);
  const content = normalizeQuoteContent(
    parameters.quoteContent,
    defaultQuoteTitle(
      await dealCompanyName(client, dealId),
      option.input?.startDate,
      state.dealName,
    ) || `${state.dealName} – ${option.name}`,
  );
  // Does this quote need approval? The calculator already decided; this only reports the decision
  // onto the quote so HubSpot's approval workflow -- which enrols on hs_status becoming
  // PENDING_APPROVAL, filtered to CPQ_QUOTE templates -- has something to fire on. Deciding it and
  // leaving the quote at DRAFT is why that workflow never ran.
  //
  // approvalTierRequired is the single source: 'none' means nobody has to sign off. The tier itself
  // is already on the Deal as pricing_approval_tier_required, so this adds no judgement of its own.
  const needsApproval = String(option.result?.approvalTierRequired || 'none') !== 'none';
  // CREATE AS DRAFT, THEN UPDATE. HubSpot finally said it in words:
  //
  //   "CPQ Quotes cannot be published on create. Create as draft and then update to be published."
  //   "Required property 'hs_sender_email' is empty or missing quote with 'hs_status' of
  //    'PENDING_APPROVAL' and 'hs_template_type' of 'CPQ_QUOTE'."
  //   "Quotes with status 'PENDING_APPROVAL' and templateType 'CPQ_QUOTE' must have an
  //    associated 'QUOTE_TO_LINE_ITEM' object."
  //
  // So the status CANNOT go on the create -- not PENDING_APPROVAL either -- and the update that
  // follows has preconditions: a sender email, and line items already associated. The line items
  // are created before the read-back below, so that one is satisfied. The sender email is not
  // always available, which is exactly why the transition was failing silently.
  //
  // REVERTED to last night's behaviour at Holly's instruction, 2026-09-01.
  //
  // This was briefly gated on needsApproval, so a 'none'-tier Deal was created as DRAFT and the
  // transition below was skipped entirely. That is arguably the right behaviour and the reasoning
  // is in claude/quote-status-ignores-approval-tier.md -- but the instruction was to put quote
  // creation back exactly as it was on the night of 2026-08-31, and this is one of only two
  // places it differed.
  //
  // CONSEQUENCE, stated so it is not rediscovered: every Lock in now asks for PENDING_APPROVAL
  // whether or not the deal earned it. The transition is non-fatal, so when HubSpot refuses it
  // the quote silently keeps DRAFT -- which is why the same Deal produced PENDING_APPROVAL and
  // then DRAFT three minutes apart from identical inputs.
  const desiredQuoteStatus = QUOTE_STATUS_PENDING_APPROVAL;

  const category = dealCategory(settings, state.dealType, state.pipelineId);
  // The default is the category's first kind's default -- there is no separate Quote Type to read
  // a default from any more. The card normally sends an explicit templateId, so this only matters
  // for a configuration restored from before the picker existed.
  const requestedTemplateId =
    content.templateId || defaultQuoteTemplateFor(settings, quoteKindsForCategory(category)[0]);
  if (!/^\d+$/.test(requestedTemplateId)) throw new Error('QUOTE_CONFIGURATION_REQUIRED');

  // THE CATEGORY DECIDES THE TEMPLATE. Not the card.
  //
  // Landed 2026-09-01, removed twice, and the removals were measured both times:
  //
  //   17:20:28  guard in place  -> New Business Template   correct
  //   17:20:58  guard in place  -> New Business Template   correct
  //   17:22:17  guard in place  -> New Business Template   correct
  //   18:00:36  guard REMOVED   -> Change Quote Template on a NEW BUSINESS pipeline Deal
  //
  // Quote 42609049672 on Deal 64484705454. First Lock in without it, wrong template.
  //
  // ON ITS OWN COMMIT THIS TIME. It shipped once bundled with the removal of the quote's seller
  // block, that deploy failed every Lock in with "One or more associations are invalid", and the
  // revert took this guard down with it -- coupling an unrelated change to it cost the guard a
  // second time. The seller block is untouched here.
  //
  // Why the card-side guard is not enough alone: the card bundle is cached in the browser
  // independently of the serverless function, so a rep running yesterday's card sends yesterday's
  // template and nothing server-side questions it.
  //
  // SUBSTITUTED, NOT REFUSED. Throwing would discard a configuration the rep has already
  // committed, after the guards that exist precisely to fail BEFORE anything is written.
  //
  // Only when the category actually has templates assigned: an unconfigured portal has none, and
  // there "not in the list" means the list is empty, not that the choice is wrong.
  const allowedKinds = quoteKindsForCategory(category);
  const allowedTemplateIds = new Set(
    allowedKinds.flatMap((kind) =>
      quoteTemplateSettings(settings, kind).enabledIds.map(String),
    ),
  );
  let templateId = requestedTemplateId;
  if (allowedTemplateIds.size > 0 && !allowedTemplateIds.has(String(requestedTemplateId))) {
    const categoryDefault = defaultQuoteTemplateFor(settings, allowedKinds[0]);
    console.error(
      `Nylas pricing: template ${requestedTemplateId} is not assigned to a ${category} Deal ` +
        `(${allowedKinds.join('/')}: ${[...allowedTemplateIds].join(', ')}). ` +
        `Using ${categoryDefault} instead. The card most likely still held a template from ` +
        'before this Deal changed pipeline, or is a cached older bundle.',
    );
    if (/^\d+$/.test(String(categoryDefault))) templateId = String(categoryDefault);
  }

  // REVERTED to last night's behaviour at Holly's instruction, 2026-09-01.
  //
  // Between 10:56 and now this substituted the category's default whenever the card sent a
  // template not assigned to the Deal's category in Settings. That was added because a Deal that
  // changes pipeline while the card is open leaves the card holding a template the new pipeline
  // does not offer -- see claude/wrong-template-across-all-three-flows.md.
  //
  // The card-side guard for that is DELIBERATELY STILL IN PLACE: NylasPricingBuilder drops a
  // selection the Deal no longer offers. So the 1:1 still holds through the UI; what is gone is
  // the server refusing to be told otherwise.
  //
  // Warned about, never refused. The card only ever offers this flow's list, so a template from
  // outside it means the card and Settings have drifted -- and refusing the lock here would throw
  // away a configuration the rep has already committed, after the guards that exist precisely to
  // fail BEFORE anything is written. A wrong template is visible on the quote and recoverable; a
  // lost configuration is not.
  // Which kind this template belongs to, now that the template is the input rather than the
  // output. null means no kind claims it -- normal on an unconfigured portal.
  const quoteKind = quoteKindForTemplate(settings, category, templateId);
  if (!quoteKind) {
    console.warn(
      `Nylas pricing: quote template ${templateId} is not listed under any quote kind in ` +
        'Settings, so this quote carries no kind. Assign it under Settings > Quote Templates to ' +
        'make it a change or renewal document.',
    );
  }
  const { type: templateType, name: templateName } = await describeQuoteTemplate(
    client,
    templateId,
  );
  // Before anything is created. A legacy template produces a quote HubSpot then refuses to
  // associate, and the failure names the association rather than the template -- so it is caught
  // here, where the message can say which template and why. 'unknown' is allowed through: it means
  // the read failed, not that the template is legacy, and refusing on a failed read would block
  // every lock in a portal where the template object is not readable.
  if (templateType !== REQUIRED_QUOTE_TEMPLATE_TYPE && templateType !== 'unknown') {
    console.error(
      `Nylas pricing: refusing to build a quote from template ${templateId} ("${templateName}") ` +
        `-- hs_type is "${templateType}", not "${REQUIRED_QUOTE_TEMPLATE_TYPE}".`,
    );
    const failure = new Error('QUOTE_TEMPLATE_NOT_CPQ');
    failure.diagnostics = { quoteTemplateId: templateId, quoteTemplateType: templateType };
    throw failure;
  }
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
  //
  // THE SELLER IS THE DEAL OWNER. Always, with no fallback.
  //
  // A fallback to the rep who clicked Lock in was written on 2026-08-31 and removed the same day.
  // Holly: "It needs to use the actual deal owner, not just me. It should be whoever is the deal
  // owner." She is right, and the reasoning behind the fallback was wrong: a quote is a
  // customer-facing document, and printing the WRONG person as the seller is worse than printing
  // nobody. A blank Seller block is visibly broken and gets fixed; a plausible wrong name does not.
  //
  // So an ownerless Deal produces an ownerless quote, loudly. The fix for that is to give the Deal
  // an owner, which the card now says in as many words.
  if (!dealOwnerId) {
    console.warn(
      `Nylas pricing: deal ${dealId} has no hubspot_owner_id. The quote will carry no owner and ` +
        'no Seller contact. Set an owner on the Deal -- the seller is never substituted.',
    );
  }

  // Resolved before the try for the same reason as the line items: a failure here must not leave a
  // half-made quote behind. senderProperties never throws, so this is belt and braces.
  const sender = await senderProperties(client, dealOwnerId);
  console.info(
    `Nylas pricing: quote seller resolved -- deal owner=${dealOwnerId || 'NONE'} ` +
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
        // The contract start is the calculator's derived order start date, not the rep's raw
        // input, so the quote and the Deal's contract dates cannot disagree.
        //
        // The EXPIRATION is start + 5 days and never in the past -- see quoteExpirationDate.
        // It is always sent: hs_expiration_date is required at creation, and never send an empty
        // string for a date in HubSpot -- that is not "no date", it lands on the epoch and prints
        // as January 1, 1970.
        hs_expiration_date: quoteExpirationDate(option.result.dates.contractStartDate),
        ...(option.result.dates.contractStartDate
          ? { hs_contract_effective_start_date: option.result.dates.contractStartDate }
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
        ...(dealOwnerId
          ? {
              hubspot_owner_id: dealOwnerId,
              // hs_quote_owner_id is HubSpot's "Quote sender", a DIFFERENT property from
              // hubspot_owner_id ("Quote owner"). Untried until now, and the last documented
              // candidate: on 2026-08-28 quote 42562905272 was confirmed to carry
              // hubspot_owner_id 1512537839 while keeping NONE of hs_sender_firstname,
              // hs_sender_lastname or hs_sender_email -- HubSpot accepted those writes and
              // discarded them, so they are not what a CPQ quote reads.
              //
              // The theory this tests: a CPQ quote derives its Seller Contact from the SENDER,
              // and the hs_sender_* block is either derived from it or is legacy-only. The card's
              // Seller banner reports whether this sticks, so the next round is evidence rather
              // than another guess.
              hs_quote_owner_id: dealOwnerId,
            }
          : {}),
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
        // hs_status is NOT sent here. "CPQ Quotes cannot be published on create. Create as
        // draft and then update to be published." -- HubSpot, verbatim. The quote is created at
        // DRAFT and moved after its line items exist; see the transition below.
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
    // Applied on EVERY Lock in, not only the first. Regenerating the quote leaves the label on the
    // old one, so the Deal's primary quote silently goes stale -- Holly, 2026-08-31: "that got
    // deleted", "I need it to refresh again".
    const primaryQuote = await markAsPrimaryQuote(client, quote.id, dealId);
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
    const sendingQuoteLines = lineItems.map((item) => ({
      properties: hubSpotLineItemProperties(item.properties),
      // 68, not 67. Association type ids are directional: 67 is defined FROM the quote (0-14) TO
      // the line item, but this association is declared on the line item's own create, so the
      // "from" side is the line item (0-8). HubSpot rejected it with "invalid from object type
      // 0-8 ... expected: 0-14. For definition 0-67". 68 is the line-item-to-quote direction --
      // the same reason the Deal sync uses 20.
      associations: [createAssociation(quote.id, 68)],
    }));
    const createdQuoteLines = await createLineItemsBatch(
      client,
      sendingQuoteLines,
      createdLineItemIds,
    );
    // Read back and repair, exactly as the Deal sync does.
    //
    // THE QUOTE HAS ITS OWN LINE ITEMS -- separate records from the Deal's, created here. The
    // printed Order Form renders from THESE. When the verify-and-repair was added it went on the
    // Deal sync only, so the surface the customer actually reads was still unchecked and a
    // dropped `one_time_fees` still printed as a dash. 2026-08-28.
    await repairLineItemsBatch(
      client,
      joinCreatedLineItems(sendingQuoteLines, createdQuoteLines) || [],
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

    // The contract this change or renewal is for. Attached to the quote so HubSpot's change and
    // renewal templates accept and render -- association only, per REQUIREMENTS section 2. It is
    // NOT the basis for pricing and no number above depends on it.
    //
    // createDefault rather than a typed id: there is no documented quote-to-contract association
    // type id, and guessing one is how the units incident started. Whether this association can be
    // written AT ALL is genuinely unknown -- the contracts object is read-only, and section 3 lists
    // this as one of two things that can only be discovered by trying it.
    //
    // Never fatal. The quote already exists by this point, so throwing here would leave an orphan
    // quote behind a failed lock. The outcome is reported instead, and the card prints it.
    let contractAssociated = null;
    const contractId = String(parameters.contractId || '');
    if (contractId) {
      try {
        await client.crm.associations.v4.basicApi.createDefault(
          'quotes',
          String(quote.id),
          'contracts',
          contractId,
        );
        contractAssociated = true;
      } catch (error) {
        contractAssociated = false;
        console.error(
          `Nylas pricing: could not associate contract ${contractId} to quote ${quote.id}. The ` +
            'quote was created without it, so a change or renewal template may not render. ' +
            `${String(error?.body?.message || error?.message || error)}`,
          safeProviderDiagnostics(error, 'associate_quote_contract'),
        );
      }
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
    // Did the status stick? Same reasoning as the Seller block below: HubSpot silently ignoring a
    // property on create and accepting it on update is a real pattern here, and the whole point of
    // this field is that a workflow watches it. A quote that needed approval and came out DRAFT
    // would sit there with nobody asked to look at it.
    let quoteStatus = finalized?.properties?.hs_status || '';
    let quoteStatusRepaired = false;
    // WHY it was refused, carried back to the card.
    //
    // This has cost several rounds: the card said only "the Quote status is DRAFT, not
    // PENDING_APPROVAL", and HubSpot's actual reason -- which names the property or association
    // it wants -- sat in a serverless log nobody could reach mid-conversation. The rejection is
    // the whole diagnosis, so it goes where the person who just clicked Lock in can read it.
    let quoteStatusError = '';
    if (quoteStatus !== desiredQuoteStatus) {
      console.log(
        `Nylas pricing: quote ${quote.id} was created as "${quoteStatus || 'unset'}"; moving it ` +
          `to ${desiredQuoteStatus}. On an approvals-enabled portal this is the only legal way ` +
          'to reach it -- the create cannot carry a published status.',
      );
      try {
        await client.crm.quotes.basicApi.update(String(quote.id), {
          properties: { hs_status: desiredQuoteStatus },
        });
        const after = await client.crm.quotes.basicApi.getById(String(quote.id), ['hs_status']);
        quoteStatus = after?.properties?.hs_status || quoteStatus;
        quoteStatusRepaired = quoteStatus === desiredQuoteStatus;
      } catch (error) {
        // Never fatal. The quote exists and the pricing is right; what is lost is the workflow
        // trigger, and saying so beats throwing away a lock the rep has already committed.
        quoteStatusError = String(
          error?.body?.message || error?.message || error || '',
        ).slice(0, 600);
        console.error(
          `Nylas pricing: could not set hs_status on quote ${quote.id}. The approval workflow ` +
            `will not enrol it. ${quoteStatusError}`,
          safeProviderDiagnostics(error, 'set_quote_status'),
        );
      }
    }

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
      // Reported for the same reason as the Seller block: a primary flag that silently did not
      // apply is indistinguishable from one that did, and this is the third time a quietly-skipped
      // write has cost a round trip.
      primaryQuote,
      quoteId: String(quote.id),
      quoteUrl,
      generatedAt,
      templateId,
      templateName,
      // null when no contract applied, true when the association stuck, false when HubSpot
      // refused it. The card prints all three, because "the quote was made but the contract did
      // not attach" is exactly the silent half-success section 3 warns about.
      contractId: contractId || null,
      contractAssociated,
      // What the Internal quote status actually ended up as, and whether it took a second write.
      // The card prints it: this is the field the approval workflow watches, so a silent failure
      // here means an approval nobody is asked for.
      quoteStatus,
      quoteStatusExpected: desiredQuoteStatus,
      quoteStatusRepaired,
      quoteStatusError,
      needsApproval,
    };
  } catch (error) {
    // Archive the quote's own line items before the quote, so a failed attempt leaves nothing
    // orphaned. The Deal's line items are syncDealLineItems' to roll back, not this function's.
    await archiveLineItemsBatch(client, createdLineItemIds).catch(() => undefined);
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
        // The product rows and band labels, derived from pricingRules. The Settings screen used to
        // carry its own copy of all seven products and every band boundary as a literal string.
        productRates: productRateDescriptors(),
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
      const listCategory = dealCategory(settings, state.dealType, state.pipelineId);
      const allTemplates = await usableQuoteTemplates(client);
      const listTemplates = quoteTemplatesForCategory(allTemplates, settings, listCategory);
      return response(200, {
        success: true,
        ...stateResponse(state),
        // The resolved flow, so the card renders that flow's view rather than guessing from a
        // deal type it never sees.
        dealCategory: listCategory,
        quoteTemplates: listTemplates.templates,
        defaultQuoteTemplateId: listTemplates.defaultTemplateId,
        // Which kind claims each template. The card reads this to decide whether the contract
        // picker applies, the instant the rep changes template and without another round trip.
        templateKinds: listTemplates.templateKinds,
        ...(await quoteContactOptions(client, dealId)),
        // Only where a contract can apply. A new-business Deal has no change or renewal kind, so
        // asking its company for contracts is a wasted round trip on every card load.
        ...(Object.values(listTemplates.templateKinds).some(
          (kind) => kind === 'change' || kind === 'renewal',
        )
          ? await contractOptions(client, dealId)
          : {}),
        dealOwnerId: state.dealOwnerId,
        // TEMP DIAGNOSTIC -- see latestQuoteTemplate. Remove with it.
        latestQuoteTemplate: await latestQuoteTemplate(client, state.latestQuoteId, allTemplates),
        // The card shows this as the Quote title placeholder, so a rep who leaves the field
        // blank can see the name the quote will actually get rather than being surprised by it.
        dealName: state.dealName,
        companyName: await dealCompanyName(client, dealId),
      });
    }
    // Read-only diagnostic for the contracts object. Writes nothing.
    //
    // It exists because "active contract" has no property behind it yet: HubSpot documents
    // hs_name, hs_contract_effective_date and the timestamps, and nothing that says active. The
    // knowledge base refers to "the current status of the contract" without naming the field. So
    // rather than guess a name into a customer-facing picker -- the rule in section 9 -- this
    // reports what THIS portal actually exposes, and the filter gets written against the answer.
    if (action === 'inspect_contracts') {
      const attempt = async (label, run) => {
        try {
          return { [label]: await run() };
        } catch (error) {
          return {
            [label]: {
              failed: contractUnavailableReason(error),
              detail: String(error?.body?.message || error?.message || error).slice(0, 400),
            },
          };
        }
      };
      const properties = await attempt('properties', async () => {
        const read = await client.apiRequest({
          method: 'GET',
          path: '/crm/v3/properties/contracts',
        });
        const body = await read.json();
        return (body?.results || []).map(({ name, label, type, options }) => ({
          name,
          label,
          type,
          // The values matter as much as the name: a status field is only useful here if we know
          // which of its options means active in this portal.
          options: (options || []).map((option) => option?.value).filter(Boolean).slice(0, 25),
        }));
      });
      const sample = await attempt('sample', async () => {
        const read = await client.apiRequest({
          method: 'GET',
          path: `${CONTRACT_PATH_CANDIDATES[0]}?limit=3&properties=${CONTRACT_PROPERTIES.join(',')}`,
        });
        const body = await read.json();
        return (body?.results || []).map(({ id, properties: props }) => ({ id, ...props }));
      });
      return response(200, { success: true, contracts: { ...properties, ...sample } });
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
  quoteExpirationDate,
  assertContractChosen,
  contractOptions,
  contractUnavailableReason,
  defaultQuoteTitle,
  associatedContractIds,
  probeContractPaths,
  readContractProbe,
  isQuotableContract,
  offeredQuoteTemplates,
  usableQuoteTemplates,
  defaultQuoteTemplateFor,
  quoteTemplatesForCategory,
  quoteKindForTemplate,
  contractApplies,
  resolveQuoteKind,
  repairLineItemsBatch,
  createLineItemsBatch,
  archiveLineItemsBatch,
  joinCreatedLineItems,
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
  buildSelectedProperties,
  contractSummaryText,
  hubSpotChoiceList,
  professionalServiceHubSpotValue,
  addOnHubSpotValue,
  PROFESSIONAL_SERVICES_NONE,
});
