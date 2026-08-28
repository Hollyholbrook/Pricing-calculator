import { Fragment, useEffect, useRef, useState } from "react";
import {
  Alert,
  AutoGrid,
  Box,
  Card,
  Checkbox,
  DateInput,
  Divider,
  EmptyState,
  ExtensionPointApiActions,
  Flex,
  Heading,
  Input,
  LoadingButton,
  LoadingSpinner,
  MultiSelect,
  NumberInput,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
  TextArea,
  hubspot,
  CrmContext,
} from "@hubspot/ui-extensions";

type ProductKey =
  | "connect_ca"
  | "calendar_ca"
  | "notetaker_bot_hours"
  | "agent_accounts"
  | "agent_email_thousands"
  | "agent_storage_gb"
  | "agent_bandwidth_gb";

interface QuoteInput {
  startDate: string | null;
  termMonths: number;
  paymentFrequency: string;
  volumes: Record<ProductKey, number>;
  supportLevel: string;
  onboardingPackage: string;
  addOns: string[];
  professionalServices: string[];
  discretionaryDiscount: number;
  productDiscounts: Record<ProductKey, number>;
  addOnDiscounts: Record<string, number>;
  supportDiscount: number;
  onboardingDiscount: number;
  professionalServicesDiscount: number;
  autoRenewal: boolean;
  renewalTermMonths: number;
  nonRenewalNoticeDays: number;
  redliningRequested: boolean;
  nonStandardTerms: boolean;
  specialTerms: string;
}

interface QuoteLine {
  productKey: ProductKey;
  productName: string;
  unitOfMeasure: string;
  volume: number;
  committed: boolean;
  baseUnitRate: number;
  listUnitRate: number;
  displayListUnitRate: number;
  availableUnitRate: number;
  proposedUnitRate: number;
  displayProposedUnitRate: number;
  discretionaryDiscount: number;
  listMrr: number;
  proposedMrr: number;
  annualCommitment: number;
  listTermCommitment: number;
  termCommitment: number;
  baseBandRates: {
    lower: number;
    upper: number | null;
    rate: number;
  }[];
  listBandRates: {
    lower: number;
    upper: number | null;
    rate: number;
  }[];
  proposedBandRates: {
    lower: number;
    upper: number | null;
    rate: number;
  }[];
}

interface QuoteAddOn {
  key: string;
  label: string;
  listMonthlyAmount: number;
  proposedMonthlyAmount: number;
  listAnnualAmount: number;
  annualAmount: number;
}

interface QuoteResult {
  calculationVersion: string;
  calculatedAt: string;
  termDiscount: number;
  paymentPremium: number;
  paymentsPerYear: number;
  billingPeriod: string;
  lines: QuoteLine[];
  quotedProducts: ProductKey[];
  listPlatformArr: number;
  proposedPlatformArr: number;
  listSupportAnnual: number;
  supportAnnual: number;
  selectedAddOns: QuoteAddOn[];
  listAnnualAddOns: number;
  annualAddOns: number;
  listOnboardingAmount: number;
  onboardingAmount: number;
  listProfessionalServicesAmount: number;
  professionalServicesAmount: number;
  listCommittedArr: number;
  committedArr: number;
  recurringPerPeriod: number;
  firstInvoiceAmount: number;
  recurringInvoiceAmount: number;
  largestInvoiceAmount: number;
  requiresBankTransfer: boolean;
  creditCardMaximumInvoice: number;
  listOneTime: number;
  oneTime: number;
  listTcv: number;
  tcv: number;
  largestDiscretionaryDiscount: number;
  approvalTierRequired: string;
  approvalReasons: string[];
  blockingReasons: string[];
  calculationStatus: string;
  dates: {
    contractStartDate: string | null;
    contractEndDate: string | null;
    renewalDate: string | null;
    nonRenewalNoticeDate: string | null;
  };
}

interface QuoteOption {
  id?: string;
  name: string;
  status: string;
  input: QuoteInput;
  result?: QuoteResult;
  createdAt?: string;
  updatedAt?: string;
  // Card-only: marks that the saved configuration has already been restored, so a later
  // response cannot overwrite edits made since the load. Never sent to the server.
  restoredFromDeal?: boolean;
}

interface OptionDocument {
  schemaVersion: "1.0";
  revision: number;
  options: QuoteOption[];
}

interface ProductDisagreement {
  field: string;
  local: string | number | null;
  hubspot: string | number | null;
  detail: string;
}

interface ProductRow {
  key: string;
  productId: string;
  localName: string;
  hubspotName?: string | null;
  found: boolean;
  tiersAvailable?: boolean;
  hubspotPricingModel?: string;
  disagreements: ProductDisagreement[];
  notes: string[];
}

interface ProductLibraryReport {
  checkedAt: string;
  tieredPricingAvailable: boolean;
  productCount: number;
  missingCount: number;
  disagreementCount: number;
  reads: {
    source: string;
    ok: boolean;
    count: number;
    tierPropertyReturned: boolean;
    error: string | null;
  }[];
  rows: ProductRow[];
}

interface ServerlessBody {
  success: boolean;
  error?: string;
  errorCode?: string;
  details?: {
    field?: string;
    validationCode?: string;
    operation?: string;
    providerStatus?: string;
    providerCategory?: string;
    errorType?: string;
    providerMessage?: string;
    quoteTemplateId?: string;
    quoteTemplateType?: string;
  };
  optionSet?: OptionDocument;
  option?: QuoteOption;
  selectedOptionId?: string | null;
  selectedOptionName?: string | null;
  approvalStatus?: string;
  lineItemSyncStatus?: string;
  lineItemCount?: number;
  latestQuoteId?: string | null;
  latestQuoteUrl?: string | null;
  quoteId?: string;
  quoteUrl?: string;
  templateId?: string;
  templateName?: string;
  previewResult?: QuoteResult;
  productLibrary?: ProductLibraryReport;
  discountReason?: string;
  quoteTemplates?: { id: string; name: string }[];
  seller?: {
    ownerId?: string;
    sent?: string[];
    keptOnCreate?: string[];
    repaired?: boolean;
  };
  latestQuoteSeller?: {
    quoteId: string;
    ownerId: string;
    storedFields: string[];
    email: string;
  } | null;
  contacts?: { id: string; label: string }[];
  contactSource?: "deal" | "company" | "none";
  dealContactIds?: string[];
  defaultQuoteTemplateId?: string;
  dealName?: string;
}

interface QuoteContent {
  // Optional, not blank-able: normalizeQuoteContent falls back to "<deal name> – <option name>"
  // when the key is absent, but a present-and-empty title is a validation error. So an untouched
  // field must omit the key rather than send "".
  title?: string;
  templateId: string;
  expirationDate: string;
  presentation: "itemized_products" | "subscription_summary";
  includeUncommittedRateSchedule: boolean;
  includeRenewalTerms: boolean;
  includeSpecialTerms: boolean;
}

interface ServerlessResult {
  body: ServerlessBody;
}

class PricingActionError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "PricingActionError";
    this.code = code;
  }
}

interface CrmExtensionProps {
  context: CrmContext;
  actions: ExtensionPointApiActions<"crm.record.tab">;
}

const products: {
  key: ProductKey;
  label: string;
  description: string;
  inputUnit: string;
}[] = [
  {
    key: "connect_ca",
    // Matches the rate-schedule name in pricingRules: "Connect" alone does not distinguish this
    // from the Calendar-Only product, which is also a Connect SKU.
    label: "Email + Calendar",
    description: "Connected accounts",
    inputUnit: "CA/month",
  },
  {
    key: "calendar_ca",
    label: "Calendar Only",
    description: "Calendar-only accounts",
    inputUnit: "calendars/month",
  },
  {
    key: "notetaker_bot_hours",
    label: "Notetaker",
    description: "Bot hours",
    inputUnit: "bot hours/month",
  },
  {
    key: "agent_accounts",
    label: "Agent Accounts",
    description: "Agent accounts",
    inputUnit: "accounts/month",
  },
  {
    key: "agent_email_thousands",
    label: "Agent Email",
    description: "Emails in thousands",
    inputUnit: "1,000 emails",
  },
  {
    key: "agent_storage_gb",
    label: "Agent Data Storage",
    description: "Storage",
    inputUnit: "GB/month",
  },
  {
    key: "agent_bandwidth_gb",
    label: "Agent Bandwidth",
    description: "Bandwidth",
    inputUnit: "GB/month",
  },
];

const paymentOptions = [
  { value: "annual_in_advance", label: "Annual in Advance" },
  { value: "semi_annual_in_advance", label: "Semi-Annual in Advance" },
  { value: "quarterly_in_advance", label: "Quarterly in Advance" },
  { value: "monthly_in_advance", label: "Monthly in Advance" },
];

// The card's own stable keys, NOT HubSpot's. The Deal property's internal values are mapped
// server-side, so the picker does not have to know how the portal encodes them and a renamed
// option value needs no card change.
const CREDIT_CARD_OPTION = { value: "credit_card", label: "Credit card" };
const BANK_TRANSFER_METHOD = "ach";

const paymentMethodOptions = [
  CREDIT_CARD_OPTION,
  { value: BANK_TRANSFER_METHOD, label: "Bank transfer / ACH" },
  // Last, not first: it is the exception now that Credit card is the default, and a rep who picks
  // it is deliberately clearing the field rather than accepting a blank.
  { value: "", label: "Not specified" },
];

// Above the invoice limit, credit card is not offered at all rather than offered and rejected.
// A disabled-but-visible option invites the rep to try it and read an error; withholding it makes
// the only permitted answer the one on screen. "Not specified" goes too -- the requirement is that
// ACH/Bank Transfer IS selected, so leaving it blank does not satisfy it either.
const permittedPaymentMethodOptions = (requiresBankTransfer: boolean) =>
  requiresBankTransfer
    ? paymentMethodOptions.filter(({ value }) => value === BANK_TRANSFER_METHOD)
    : paymentMethodOptions;

const DEFAULT_PAYMENT_METHOD = "credit_card";

const supportOptions = [
  { value: "basic", label: "Basic" },
  { value: "full", label: "Full" },
  { value: "premium", label: "Premium" },
];

const onboardingOptions = [
  // Onboarding is optional; "None" produces no onboarding line item.
  { value: "none", label: "None" },
  { value: "quick_launch", label: "Quick Launch" },
  { value: "quick_launch_plus", label: "Quick Launch Plus" },
  { value: "strategic", label: "Strategic Onboarding" },
];

const addOnOptions = [
  { value: "enterprise_accelerator", label: "Enterprise Accelerator Package" },
  { value: "privacy_filter", label: "Privacy Filter Mode" },
  { value: "verified_oauth", label: "Turnkey Verified OAuth Projects" },
];

const professionalServiceOptions = [
  { value: "google_verification_review", label: "Google Verification Review" },
  {
    value: "architecture_workflow_review",
    label: "Architecture Design & Workflow Review",
  },
  { value: "gtm_review", label: "Go-to-Market Review" },
  {
    value: "provider_oauth_app_creation",
    label: "Provider OAuth App Creation",
  },
  {
    value: "notification_webhook_best_practices",
    label: "Notification & Webhook Best Practices",
  },
];

// Every column has an explicit pixel width and none of them is "max".
//
// "max" takes ALL the slack, so whichever column carries it becomes enormous and every other
// column collapses to its minimum content width. On Product that squeezed List Rate until the
// tier text wrapped character by character; moved to List Rate it starved Product until
// "Connected accounts" hyphenated across three lines. There is no column that should soak up the
// remainder -- the widths are simply stated, so the layout is the same whatever the card width.
//
// Volume has to hold a real committed figure, not a rate. At 120 it clipped "2,342,300" to
// "2,342,3" -- the input fills its cell, so the cell width is the field width, and a number the
// rep cannot read back is worse than any amount of whitespace elsewhere. The 60px it needed came
// out of List Rate rather than off the end of the table, so the total is unchanged at 1030 and no
// other column is starved.
const PRODUCT_COLUMN_WIDTH = 300;
const VOLUME_COLUMN_WIDTH = 180;
// List Rate holds "range  rate" per band; Proposed Rate holds the matching rate on the same row,
// so the two columns can be read across band by band. The widest band line is
// "100K–500K · $0.35", which fits 240 with room to spare -- the old 300 was sized for the
// four-decimal rates that no longer exist now that prices round to cents.
const LIST_RATE_COLUMN_WIDTH = 240;
const DISCOUNT_COLUMN_WIDTH = 110;
const PROPOSED_RATE_COLUMN_WIDTH = 200;

// The quote template to fall back on by NAME, when the configured default id is not among the
// portal's templates -- a wrong id, a template recreated, or a portal that never had it. The
// template is called "(TESTING) 1 sub" today, so this matches on the "1 sub" part alone and
// survives the (TESTING) prefix being dropped. Only a fallback: a matching id always wins.
const DEFAULT_TEMPLATE_NAME_MATCH = /1\s*sub/i;

// Mirrors the server-side limit in normalizeQuoteContent. Checked here too so an over-long title
// is caught in the field, rather than after Save and Lock as a generic INVALID_QUOTE_CONTENT.
const QUOTE_TITLE_MAX_LENGTH = 160;

// The server names an untitled quote "<deal name> – <option name>", so the placeholder can only
// show the rep what they will get if this name and the one on the option stay in step.
const LIVE_OPTION_NAME = "Live calculator";

const termOptions = [12, 24, 36].map((months) => ({
  value: months,
  label: `${months} months`,
}));

const emptyVolumes = (): Record<ProductKey, number> => ({
  connect_ca: 0,
  calendar_ca: 0,
  notetaker_bot_hours: 0,
  agent_accounts: 0,
  agent_email_thousands: 0,
  agent_storage_gb: 0,
  agent_bandwidth_gb: 0,
});

const emptyProductDiscounts = (): Record<ProductKey, number> => ({
  connect_ca: 0,
  calendar_ca: 0,
  notetaker_bot_hours: 0,
  agent_accounts: 0,
  agent_email_thousands: 0,
  agent_storage_gb: 0,
  agent_bandwidth_gb: 0,
});

const firstDayOfFollowingMonth = () => {
  const today = new Date();
  const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  return `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}-01`;
};

const todayIso = () => {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
    today.getDate(),
  ).padStart(2, "0")}`;
};

// A restored start date is kept only if it is still usable. A configuration locked weeks ago
// restores the date it was locked with, and nothing else would move it -- so the calculator would
// sit on a start date in the past and quote against it. Anything absent or already gone reverts to
// the standing default, the first of next month.
//
// ISO dates compare correctly as strings, so no parsing is needed.
// Key order is not guaranteed to match between a value parsed from the Deal and one rebuilt in the
// card, so compare canonically rather than by JSON.stringify alone.
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, inner) =>
    inner && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(
          Object.entries(inner as Record<string, unknown>).sort(
            ([left], [right]) => left.localeCompare(right),
          ),
        )
      : inner,
  );

const usableStartDate = (saved?: string | null) => {
  if (!saved || !/^\d{4}-\d{2}-\d{2}$/.test(saved))
    return firstDayOfFollowingMonth();
  return saved >= todayIso() ? saved : firstDayOfFollowingMonth();
};

const emptyInput = (): QuoteInput => ({
  startDate: firstDayOfFollowingMonth(),
  termMonths: 12,
  paymentFrequency: "annual_in_advance",
  volumes: emptyVolumes(),
  supportLevel: "basic",
  onboardingPackage: "quick_launch",
  addOns: [],
  professionalServices: [],
  discretionaryDiscount: 0,
  productDiscounts: emptyProductDiscounts(),
  addOnDiscounts: {
    enterprise_accelerator: 0,
    privacy_filter: 0,
    verified_oauth: 0,
  },
  supportDiscount: 0,
  onboardingDiscount: 0,
  professionalServicesDiscount: 0,
  autoRenewal: true,
  renewalTermMonths: 12,
  nonRenewalNoticeDays: 60,
  redliningRequested: false,
  nonStandardTerms: false,
  specialTerms: "",
});

const currency = (value?: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value || 0);

// Two decimals, matching the price the line item actually carries. Four decimals showed rates
// like $1.5484 that no line item could ever be priced at.
const rateCurrency = (value?: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value || 0);

const percent = (value?: number) =>
  `${Math.round((value || 0) * 10_000) / 100}%`;

// A zero in this table means "not part of this deal". The workbook prints a dash rather than
// $0 for those, which keeps the eye on the rows that carry money.
const summaryAmount = (value: number) => (value ? currency(value) : "—");

const summaryTable = (result: QuoteResult, termMonths: number) => {
  const years = termMonths / 12;
  const perPeriod = (annual: number) => annual / result.paymentsPerYear;
  const rows: { label: string; oneTime: number; annual: number }[] = [
    { label: "Onboarding", oneTime: result.onboardingAmount, annual: 0 },
    {
      label: "Professional Services",
      oneTime: result.professionalServicesAmount,
      annual: 0,
    },
    {
      // The name the product carries in HubSpot, and the name the workbook's own Contract Summary
      // uses (section VI, row 51). This row said "Subscription Drawdown", which matched neither --
      // the other four labels here were already verbatim from that table.
      label: "Enterprise Drawdown Commitment",
      oneTime: 0,
      annual: result.proposedPlatformArr,
    },
    { label: "Subscription Add-ons", oneTime: 0, annual: result.annualAddOns },
    { label: "Subscription Support", oneTime: 0, annual: result.supportAnnual },
  ];
  return (
    <Flex direction="column" gap="xs">
      <Table bordered={false} density="condensed">
        <TableHead>
          <TableRow>
            <TableHeader width={220}>{""}</TableHeader>
            <TableHeader width={140} align="right">
              One-time Fees
            </TableHeader>
            <TableHeader width={160} align="right">
              {`Recurring Fees Per ${result.billingPeriod}`}
            </TableHeader>
            <TableHeader width={170} align="right">
              Recurring Fees Per Year (ARR)
            </TableHeader>
            <TableHeader width={150} align="right">
              Total Fees for Term
            </TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map(({ label, oneTime, annual }) => (
            <TableRow key={label}>
              <TableCell width={220}>
                <Text>{label}</Text>
              </TableCell>
              <TableCell width={140} align="right">
                <Text>{summaryAmount(oneTime)}</Text>
              </TableCell>
              <TableCell width={160} align="right">
                <Text>{summaryAmount(perPeriod(annual))}</Text>
              </TableCell>
              <TableCell width={170} align="right">
                <Text>{summaryAmount(annual)}</Text>
              </TableCell>
              <TableCell width={150} align="right">
                <Text>{summaryAmount(oneTime + annual * years)}</Text>
              </TableCell>
            </TableRow>
          ))}
          {/* Totals come from the calculation, not from summing the rows above: the rows are a
              presentation of the same figures, and the calculation is the one source of truth
              for what the customer is being charged. They reconcile exactly. */}
          <TableRow>
            <TableCell width={220}>
              <Text format={{ fontWeight: "bold" }}>Totals</Text>
            </TableCell>
            <TableCell width={140} align="right">
              <Text format={{ fontWeight: "bold" }}>
                {summaryAmount(result.oneTime)}
              </Text>
            </TableCell>
            <TableCell width={160} align="right">
              <Text format={{ fontWeight: "bold" }}>
                {summaryAmount(result.recurringPerPeriod)}
              </Text>
            </TableCell>
            <TableCell width={170} align="right">
              <Text format={{ fontWeight: "bold" }}>
                {summaryAmount(result.committedArr)}
              </Text>
            </TableCell>
            <TableCell width={150} align="right">
              <Text format={{ fontWeight: "bold" }}>
                {summaryAmount(result.tcv)}
              </Text>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
      {/* Label and figure sit together on the left, not at opposite edges of the card.
          justify="between" put the number a full table-width from the words naming it, and this is
          the one pairing in the block that should read as a single phrase. The label is microcopy
          so the emphasis lands on the amount rather than on the caps. */}
      <Flex gap="xs" align="baseline">
        <Text variant="microcopy">TOTAL CONTRACT VALUE (TCV)</Text>
        <Text format={{ fontWeight: "bold" }}>{currency(result.tcv)}</Text>
      </Flex>
    </Flex>
  );
};

// Reads the Seller failure modes apart in one line, printed on the lock confirmation.
//
// Three rounds went into "the seller contact isn't coming through" with no way to see WHICH step
// produced nothing: a Deal with no owner, an owner whose record has no name or email, or HubSpot
// accepting the hs_sender_* fields and not keeping them. The confirmation now says which.
const sellerSummary = (seller?: {
  ownerId?: string;
  sent?: string[];
  keptOnCreate?: string[];
  repaired?: boolean;
}) => {
  if (!seller) return "not reported";
  if (!seller.ownerId)
    return "this Deal has no owner, so the quote has no seller";
  const sent = seller.sent || [];
  if (sent.length === 0)
    return `owner ${seller.ownerId}, but no name or email could be read`;
  const kept = seller.keptOnCreate || [];
  if (kept.length === sent.length)
    return `owner ${seller.ownerId}, set on create`;
  if (seller.repaired) return `owner ${seller.ownerId}, set on a second write`;
  return `owner ${seller.ownerId} — HubSpot did NOT keep ${sent.join(", ")}`;
};

const approvalLabel = (value?: string) =>
  ({
    none: "No approval",
    sales_director: "Sales Director",
    head_sales: "Head of Sales",
    // Renewals route discounts here instead of the size-based ladder. Configurable in Settings --
    // renewalApprovalTier -- so this map has to cover every tier the settings allow, or a banner
    // renders a raw key like "ccso" at a rep.
    // Renewal-side names for the same two rungs. Same thresholds, different approver.
    cs_director: "CS Director",
    ccso: "CCSO",
    finance: "Finance",
  })[value || "none"] ||
  value ||
  "Not calculated";

const dateValue = (value: string | null) => {
  if (!value) return null;
  const [year, month, date] = value.split("-").map(Number);
  return { year, month: month - 1, date };
};

const formatDateInput = ({
  year,
  month,
  date,
}: {
  year: number;
  month: number;
  date: number;
}) =>
  `${year}-${String(month + 1).padStart(2, "0")}-${String(date).padStart(2, "0")}`;

hubspot.extend<"crm.record.tab">(({ context, actions }: CrmExtensionProps) => (
  <NylasPricingBuilder context={context} actions={actions} />
));

const NylasPricingBuilder = ({ context, actions }: CrmExtensionProps) => {
  const dealId = String(context.crm.objectId);
  const [quoteTemplates, setQuoteTemplates] = useState<
    { id: string; name: string }[]
  >([]);
  const [templateId, setTemplateId] = useState("");
  const [quoteTitle, setQuoteTitle] = useState("");
  // Not part of the pricing input: it changes no number, and normalizeStoredInput would strip it
  // from option.input anyway. It travels as its own parameter and lands on the Deal.
  const [paymentMethod, setPaymentMethod] = useState(DEFAULT_PAYMENT_METHOD);
  // The configuration as it is stored on the Deal, for telling "this would update what is already
  // locked" from "this would produce something new". Empty when nothing has been locked yet.
  // The value is no longer read: it existed only to decide between "Update existing config" and
  // "Lock in & create quote" on the button, and that label is now constant. The setter stays so
  // restoring a saved configuration still records what was locked.
  const [, setLockedInput] = useState("");
  // Not a pricing input: it changes no number, and normalizeStoredInput would strip it from
  // option.input. It travels as its own parameter and lands on pricing_discount_reason.
  const [discountReason, setDiscountReason] = useState("");
  const [dealName, setDealName] = useState("");
  const trimmedQuoteTitle = quoteTitle.trim();
  const quoteTitleTooLong = trimmedQuoteTitle.length > QUOTE_TITLE_MAX_LENGTH;
  const fallbackQuoteTitle = dealName
    ? `${dealName} – ${LIVE_OPTION_NAME}`
    : "";
  // The card exposes no controls for the rest of these, so they are constants rather than state
  // whose setter is never called.
  const quoteContent: QuoteContent = {
    // Omitted when blank so the server names the quote "<deal name> – <option name>". Sending an
    // empty string instead would fail validation as INVALID_QUOTE_CONTENT.
    ...(trimmedQuoteTitle ? { title: trimmedQuoteTitle } : {}),
    // Empty means "use the QUOTE_TEMPLATE_ID secret", which is what happens when the portal
    // exposes no customizable templates to pick from.
    templateId,
    // Deliberately empty: these quotes do not expire.
    expirationDate: "",
    presentation: "itemized_products",
    includeUncommittedRateSchedule: true,
    includeRenewalTerms: true,
    includeSpecialTerms: true,
  };
  const [editing, setEditing] = useState<QuoteOption>({
    name: LIVE_OPTION_NAME,
    status: "draft",
    input: emptyInput(),
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // The product-library drift check is NOT on this card. It was added on 2026-08-27 (0c874c7) as
  // groundwork for sourcing the rate card from HubSpot, and it should never have been put on a
  // surface reps use: it is a developer diagnostic -- 22 product reads, raw property names and API
  // endpoint results -- rendered in the middle of a quoting tool. Removed 2026-08-28 at Holly's
  // instruction. The read-only inspect_products action still exists server-side and nothing calls
  // it; productLibrary.js and its tests are untouched, so the check can be run from somewhere
  // appropriate without rebuilding it.
  // Whether this Lock in replaces the quote it supersedes, or leaves it and adds a new one.
  // Defaults to FALSE: every lock creates a new quote, and throwing the previous one away is a
  // deliberate choice the rep makes, not a side effect of clicking the button.
  const [replaceExistingQuote, setReplaceExistingQuote] = useState(false);
  // The contact that goes on the Quote. HubSpot requires one on a CPQ quote, and a Deal without
  // one produced a quote HubSpot rejected with a message that blamed the template.
  const [contacts, setContacts] = useState<{ id: string; label: string }[]>([]);
  const [contactSource, setContactSource] = useState<
    "deal" | "company" | "none"
  >("none");
  const [contactId, setContactId] = useState("");
  const [latestQuoteSeller, setLatestQuoteSeller] = useState<{
    quoteId: string;
    ownerId: string;
    storedFields: string[];
    email: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unsupportedDeal, setUnsupportedDeal] = useState(false);

  const updateFromBody = (body: ServerlessBody) => {
    if (body.dealName) setDealName(body.dealName);
    if (body.latestQuoteSeller !== undefined) {
      setLatestQuoteSeller(body.latestQuoteSeller);
    }
    if (body.contacts) {
      setContacts(body.contacts);
      setContactSource(body.contactSource || "none");
      // Preselect the Deal's contact when there is exactly one -- the common case, and the rep
      // should not have to confirm what is already true. With several, or with company contacts
      // as the fallback, the choice is theirs.
      setContactId((current) => {
        if (current !== "") return current;
        const dealContacts = body.dealContactIds || [];
        return dealContacts.length === 1 ? String(dealContacts[0]) : "";
      });
    }
    // Restore the stored discount reason. Only when the box is still untouched, so a later
    // response cannot overwrite what the rep is in the middle of typing.
    //
    // This field was write-only until 2026-08-28 -- sent on Lock in, stored on the Deal, never
    // read back. Harmless while it was optional; the moment a reason became REQUIRED, every reload
    // emptied the box and disabled Lock in until the rep retyped a reason the Deal already had.
    if (body.discountReason) {
      setDiscountReason((current) =>
        current === "" ? body.discountReason || "" : current,
      );
    }
    // Restore the last locked configuration, once, on the initial load.
    //
    // Lock in persists the live option, so a reload can bring the rep back to what they had rather
    // than an empty calculator -- which is what makes reloading the record after Lock in safe, and
    // is the only reason the neighbouring Line items and Quotes cards can be refreshed at all.
    //
    // Guarded by a flag rather than by "is editing empty": a later response must never overwrite
    // edits the rep has made since the load.
    const saved = body.optionSet?.options?.[0];
    if (saved?.input) {
      // Snapshot what is STORED, before usableStartDate below possibly moves the start date. A
      // bumped date is a real change -- it moves the contract dates and produces a new quote --
      // so it must read as changed rather than as an update in place.
      setLockedInput(canonical(saved.input));
      setEditing((current) =>
        current.restoredFromDeal
          ? current
          : {
              ...saved,
              status: "draft",
              input: {
                ...saved.input,
                startDate: usableStartDate(saved.input.startDate),
              },
              // The stored result belongs to the stored input. Dropping it forces a fresh preview,
              // so the figures on screen cannot be stale relative to current pricing rules --
              // and the start date above may have moved, which changes the contract dates.
              result: undefined,
              restoredFromDeal: true,
            },
      );
    }
    if (body.quoteTemplates) {
      setQuoteTemplates(body.quoteTemplates);
      // Preselect the configured default when it is one of the usable templates, so the picker
      // shows what would happen anyway rather than silently differing from it.
      //
      // Falling straight through to templates[0] was too blunt: sorted by name, that is whichever
      // template happens to sort first, and the card would sit on it with no sign that the
      // configured default had not been found. So the id is tried first, then the name, and only
      // then the first in the list.
      const preferred = body.defaultQuoteTemplateId || "";
      const templates = body.quoteTemplates || [];
      setTemplateId((current) => {
        if (current) return current;
        if (templates.some(({ id }) => id === preferred)) return preferred;
        const byName = templates.find(({ name }) =>
          DEFAULT_TEMPLATE_NAME_MATCH.test(name),
        );
        return byName?.id || templates[0]?.id || "";
      });
    }
  };

  const runAction = async (parameters: Record<string, unknown>) => {
    const result = await hubspot.serverless<ServerlessResult>(
      "nylas_pricing_quote_options",
      {
        parameters: { dealId, ...parameters },
      },
    );
    if (!result.body.success) {
      // Show what HubSpot actually said. Without this the same generic sentence covers every
      // cause, and diagnosing a failure means going to the function logs.
      const d = result.body.details;
      const diagnostic = [
        d?.field,
        d?.validationCode,
        d?.providerStatus && d.providerStatus !== "unknown"
          ? `HTTP ${d.providerStatus}`
          : undefined,
        d?.providerCategory !== "unknown" ? d?.providerCategory : undefined,
        d?.quoteTemplateType
          ? `template ${d.quoteTemplateId} is ${d.quoteTemplateType}`
          : undefined,
        d?.providerMessage,
      ].filter(Boolean);
      const detail = diagnostic.length ? ` (${diagnostic.join(" · ")})` : "";
      throw new PricingActionError(
        `${result.body.error || "The pricing action failed."}${detail}`,
        result.body.errorCode,
      );
    }
    updateFromBody(result.body);
    return result.body;
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    setUnsupportedDeal(false);
    try {
      await runAction({ action: "list" });
    } catch (loadError) {
      if (
        loadError instanceof PricingActionError &&
        loadError.code === "INVALID_DEAL"
      ) {
        setUnsupportedDeal(true);
      } else {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load quote options.",
        );
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Loading is intentionally tied to the Deal record context.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  const updateInput = <K extends keyof QuoteInput>(
    field: K,
    value: QuoteInput[K],
  ) => {
    if (!editing) return;
    setEditing({
      ...editing,
      status: "draft",
      result: undefined,
      input: { ...editing.input, [field]: value },
    });
  };

  const previewQuote = async (input: QuoteInput) => {
    const body = await runAction({ action: "preview", input });
    if (!body.previewResult) {
      throw new PricingActionError("Unable to preview this pricing option.");
    }
    return body.previewResult;
  };

  const lockAndCreateQuote = async () => {
    setSaving(true);
    setError(null);
    try {
      const body = await runAction({
        action: "lock_live",
        input: editing.input,
        quoteContent,
        paymentMethod,
        discountReason,
        replaceExistingQuote,
        contactId,
      });
      // Every lock creates a NEW quote -- generation is unconditional, because the hash-based
      // reuse it replaced is what let a stale quote come back rendered with the old template.
      // Whether the previous one is archived is the rep's choice, sent above.
      // refreshObjectProperties is documented as "Refresh CRM record properties on the page" --
      // property values only. It updates the Deal's own fields but cannot touch the Line items and
      // Quotes cards beside this one, which is what actually needs to change after a lock. No SDK
      // action refreshes a sibling card; reloadPage is the only thing that does.
      //
      // Reloading is safe now only because Lock in persists the configuration and the card
      // restores it above. Before that, a reload left the rep with an empty calculator.
      actions.refreshObjectProperties();
      actions.addAlert({
        // Every lock creates a Quote now -- there is no reuse branch -- so there is one message.
        title: "Pricing locked in and draft Quote created",
        // The template is named here because four rounds went into "it is using the wrong
        // template" with no way to see which one had actually been used. Now the confirmation
        // says so every time.
        // The Seller line is here for the same reason the template is: three rounds went into
        // "the seller contact isn't coming through" with no way to see WHICH step produced
        // nothing -- an ownerless Deal, a failed owner lookup, or HubSpot ignoring the fields.
        // Now the confirmation says, every time.
        message:
          `${body.lineItemCount || 0} calculated line items replaced the Deal line items. ` +
          `Template: ${body.templateName || body.templateId || "unknown"}. ` +
          `Seller: ${sellerSummary(body.seller)}. ` +
          `The draft Quote is on the Deal's Quotes card.`,
        type: "success",
      });
      // After the alert, so the rep sees the confirmation before the page goes.
      actions.reloadPage();
    } catch (lockError) {
      setError(
        lockError instanceof Error
          ? lockError.message
          : "Unable to add the Deal line items and create the Quote.",
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Flex justify="center" align="center">
        <LoadingSpinner label="Loading pricing calculator" />
      </Flex>
    );
  }

  if (unsupportedDeal) {
    return (
      <EmptyState
        title="Pricing is not available for this deal"
        layout="vertical"
      >
        <Text>Open an eligible deal to use the live pricing calculator.</Text>
      </EmptyState>
    );
  }

  return (
    // No title here: HubSpot renders the card name from card-hsmeta.json above this content, so
    // a Heading of the same text was a second copy of it. The name there is now
    // "Nylas Pricing Calculator", which makes that chrome the single title.
    //
    // Flex, not Stack: Stack is undocumented and did not lay out vertically even with an
    // explicit direction. Flex needs no width prop -- it renders a block-level div, so it fills
    // its parent, which is what the AutoGrids inside it need in order to have room to spread.
    <Flex direction="column" gap="xs">
      {error && (
        <Alert title="Couldn’t complete the pricing action" variant="error">
          {error}
        </Alert>
      )}

      <OptionEditor
        option={editing}
        saving={saving}
        discountReason={discountReason}
        onDiscountReasonChange={setDiscountReason}
        quoteTemplates={quoteTemplates}
        templateId={templateId}
        onTemplateChange={setTemplateId}
        paymentMethod={paymentMethod}
        onPaymentMethodChange={setPaymentMethod}
        quoteTitle={quoteTitle}
        quoteTitlePlaceholder={fallbackQuoteTitle}
        quoteTitleTooLong={quoteTitleTooLong}
        onQuoteTitleChange={setQuoteTitle}
        onInputChange={updateInput}
        latestQuoteSeller={latestQuoteSeller}
        contacts={contacts}
        contactSource={contactSource}
        contactId={contactId}
        onContactChange={setContactId}
        replaceExistingQuote={replaceExistingQuote}
        onReplaceExistingQuoteChange={setReplaceExistingQuote}
        onPreview={previewQuote}
        onLock={lockAndCreateQuote}
      />
    </Flex>
  );
};

const OptionEditor = ({
  option,
  saving,
  discountReason,
  onDiscountReasonChange,
  quoteTemplates,
  templateId,
  onTemplateChange,
  paymentMethod,
  onPaymentMethodChange,
  quoteTitle,
  quoteTitlePlaceholder,
  quoteTitleTooLong,
  onQuoteTitleChange,
  onInputChange,
  latestQuoteSeller,
  contacts,
  contactSource,
  contactId,
  onContactChange,
  replaceExistingQuote,
  onReplaceExistingQuoteChange,
  onPreview,
  onLock,
}: {
  option: QuoteOption;
  saving: boolean;
  discountReason: string;
  onDiscountReasonChange: (value: string) => void;
  quoteTemplates: { id: string; name: string }[];
  templateId: string;
  onTemplateChange: (value: string) => void;
  paymentMethod: string;
  onPaymentMethodChange: (value: string) => void;
  quoteTitle: string;
  quoteTitlePlaceholder: string;
  quoteTitleTooLong: boolean;
  onQuoteTitleChange: (value: string) => void;
  onInputChange: <K extends keyof QuoteInput>(
    field: K,
    value: QuoteInput[K],
  ) => void;
  latestQuoteSeller: {
    quoteId: string;
    ownerId: string;
    storedFields: string[];
    email: string;
  } | null;
  contacts: { id: string; label: string }[];
  contactSource: "deal" | "company" | "none";
  contactId: string;
  onContactChange: (value: string) => void;
  replaceExistingQuote: boolean;
  onReplaceExistingQuoteChange: (checked: boolean) => void;
  onPreview: (input: QuoteInput) => Promise<QuoteResult>;
  onLock: () => void;
}) => {
  // Keep the result together with the input that produced it. Freshness is then a fact about
  // the data rather than a flag that has to be kept in sync — updateInput allocates a new input
  // object on every edit, so reference identity is an exact "these numbers describe what is on
  // screen" test. A bare previewResult could not distinguish current figures from the previous
  // entry's, which is what let a failed preview leave stale pricing on screen, silently, with
  // the Lock button still enabled over it.
  const [preview, setPreview] = useState<
    { input: QuoteInput; result: QuoteResult } | undefined
  >(option.result ? { input: option.input, result: option.result } : undefined);
  const [previewError, setPreviewError] = useState<string | undefined>();
  // onPreview is recreated on every render of the parent, so depending on it re-ran this effect
  // constantly -- each run cancelling the in-flight request and starting a fresh 350ms timer. With
  // the parent re-rendering while a preview was resolving, requests raced and whichever landed last
  // won, which is how a figure from a configuration two selections ago ended up on screen.
  //
  // Held in a ref so only the INPUT drives a request. The effect now runs when the rep changes
  // something, and not because the parent happened to re-render.
  const onPreviewRef = useRef(onPreview);
  // Assigned in an effect, not during render: mutating a ref while rendering is a lint error and
  // an actual hazard under concurrent rendering.
  useEffect(() => {
    onPreviewRef.current = onPreview;
  }, [onPreview]);
  useEffect(() => {
    let cancelled = false;
    const requestedInput = option.input;
    const timeout = setTimeout(() => {
      void onPreviewRef
        .current(requestedInput)
        .then((result) => {
          // Belt and braces alongside `cancelled`: only ever apply a result to the input that
          // asked for it.
          if (cancelled) return;
          setPreview({ input: requestedInput, result });
          setPreviewError(undefined);
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setPreviewError(
            error instanceof Error
              ? error.message
              : "Pricing could not be calculated. Check your inputs and try again.",
          );
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [option.input]);

  const previewResult = preview?.result;
  const pricingIsCurrent = preview?.input === option.input && !previewError;
  const previewLoading = !pricingIsCurrent && !previewError;
  const committedProductCount = products.filter(
    ({ key }) => option.input.volumes[key] > 0,
  ).length;
  // Any discount anywhere, from the rep's own entries rather than from the calculated result: the
  // reason box has to appear as soon as they discount something, before a preview has returned.
  const hasAnyDiscount =
    Object.values(option.input.productDiscounts || {}).some(
      (value) => value > 0,
    ) ||
    Object.values(option.input.addOnDiscounts || {}).some(
      (value) => value > 0,
    ) ||
    (option.input.supportDiscount || 0) > 0 ||
    (option.input.onboardingDiscount || 0) > 0 ||
    (option.input.professionalServicesDiscount || 0) > 0 ||
    (option.input.discretionaryDiscount || 0) > 0;
  // WHICH discounts, by name. hasAnyDiscount only says "somewhere", and "somewhere" sent a rep
  // hunting a long form for a field they were sure they had not touched. Naming them turns
  // "why is this required" into "because Notetaker is at 15%". Holly, 2026-08-28.
  //
  // A discount on a product with NO committed volume is flagged as such -- those fields became
  // editable earlier the same day, so a rate negotiated on a product nobody is buying yet is a
  // real entry sitting in an otherwise empty row, and it is the easiest one to lose track of.
  const asPercent = (value: number) => `${Math.round(value * 100)}%`;
  const discountedItems: string[] = [
    ...products
      .filter(({ key }) => (option.input.productDiscounts?.[key] || 0) > 0)
      .map(
        ({ key, label }) =>
          `${label} ${asPercent(option.input.productDiscounts?.[key] || 0)}` +
          ((option.input.volumes[key] || 0) > 0 ? "" : " (no volume)"),
      ),
    ...addOnOptions
      .filter(
        ({ value }) => (option.input.addOnDiscounts?.[String(value)] || 0) > 0,
      )
      .map(
        ({ value, label }) =>
          `${label} ${asPercent(option.input.addOnDiscounts?.[String(value)] || 0)}`,
      ),
    ...((option.input.supportDiscount || 0) > 0
      ? [`Support ${asPercent(option.input.supportDiscount || 0)}`]
      : []),
    ...((option.input.onboardingDiscount || 0) > 0
      ? [`Onboarding ${asPercent(option.input.onboardingDiscount || 0)}`]
      : []),
    ...((option.input.professionalServicesDiscount || 0) > 0
      ? [
          `Professional Services ${asPercent(
            option.input.professionalServicesDiscount || 0,
          )}`,
        ]
      : []),
    ...((option.input.discretionaryDiscount || 0) > 0
      ? [`Deal-wide ${asPercent(option.input.discretionaryDiscount || 0)}`]
      : []),
  ];
  const discountPreview = (
    listAmount: number | undefined,
    discount: number,
    proposedAmount: number | undefined,
    unit: string,
  ) => {
    if (listAmount == null || proposedAmount == null) {
      return (
        <Text variant="microcopy">
          Complete the pricing inputs to preview this amount.
        </Text>
      );
    }
    // A figure that belongs to a DIFFERENT configuration is worse than no figure.
    //
    // previewResult is whatever preview last returned, and it is rendered whether or not it
    // matches what is on screen now. Selecting Quick Launch Plus showed "$5,000" -- the amount for
    // Quick Launch, which had been selected a moment earlier -- and then "$15,000", from Strategic
    // before that. The correct $10,000 never appeared, and nothing on the line said the number was
    // stale. A rep reading that would quote the wrong onboarding fee.
    //
    // The Contract Summary already shows "Updating pricing..." while a preview is in flight, but it
    // sits at the top of the card, nowhere near these inline amounts.
    if (!pricingIsCurrent) {
      return <Text variant="microcopy">Updating…</Text>;
    }
    return (
      <Text variant="microcopy">
        List {currency(listAmount)} {unit} · {percent(discount)} discount saves{" "}
        {currency(listAmount - proposedAmount)} · Proposed{" "}
        {currency(proposedAmount)} {unit}
      </Text>
    );
  };

  // Band labels must match the ones printed on the customer-facing Quote (lineItemModel.js
  // formatBand), so a rep reading the card and a customer reading the quote see the same ranges.
  const bandRange = (lower: number, upper: number | null) => {
    const from = lower === 0 ? "0" : `${lower.toLocaleString()}K`;
    return upper == null ? `${from}+` : `${from}–${upper.toLocaleString()}K`;
  };

  // Read the adjusted list band rates the calculator published. Recomputing them here as
  // rate * (1 - termDiscount) * (1 + paymentPremium) used the multiplicative form, but the server
  // applies the adjustment additively and rounds to cents, so a UI-side reimplementation drifts
  // from the rates the quote is built from.
  const listRatePreview = (line: QuoteLine | undefined) => {
    if (!line) return <Text variant="microcopy">—</Text>;
    if (
      line.productKey === "agent_email_thousands" &&
      line.listBandRates.length
    ) {
      // One row per band, with the range labelled. proposedRatePreview renders the matching
      // proposed rate on the same rows, so the two columns line up band for band and the effect
      // of a discount can be read straight across. Both recalculate with every input change.
      //
      // Flex column rather than Stack: Stack's block children ignore the cell's right alignment,
      // so these lines sat left while every other row's rate sat right.
      // No blended headline above the bands. At zero volume the blended rate is just the entry
      // band, so it repeated "0-50K · $1.00" directly beneath it. Removed from this cell and the
      // proposed one together -- dropping it from only one would offset the rows and break the
      // band-for-band read across the two columns.
      return (
        <Flex direction="column" align="end" gap="flush">
          {line.listBandRates.map((band) => (
            <Text key={bandRange(band.lower, band.upper)} variant="microcopy">
              {bandRange(band.lower, band.upper)} · {rateCurrency(band.rate)}
            </Text>
          ))}
        </Flex>
      );
    }
    return <Text>{rateCurrency(line.displayListUnitRate)}</Text>;
  };

  const proposedRatePreview = (line: QuoteLine | undefined) => {
    if (!line) return <Text variant="microcopy">—</Text>;
    if (
      line.productKey === "agent_email_thousands" &&
      line.proposedBandRates.length
    ) {
      // Same number of rows as the List Rate cell, in the same band order, so the discounted
      // rate for each band sits directly beside the list rate it came from.
      return (
        <Flex direction="column" align="end" gap="flush">
          {line.proposedBandRates.map((band) => (
            <Text key={bandRange(band.lower, band.upper)} variant="microcopy">
              {rateCurrency(band.rate)}
            </Text>
          ))}
        </Flex>
      );
    }
    return <Text>{rateCurrency(line.displayProposedUnitRate)}</Text>;
  };

  const productTable = (tableProducts: typeof products) => (
    <Table density="compact" flush>
      <TableHead>
        <TableRow>
          {/* width accepts 'min' | 'max' | 'auto' | number (pixels) — percentages are not
              expressible. Product takes max so it absorbs all remaining width, and the four
              numeric columns share one equal fixed width, right-aligned in both header and body. */}
          <TableHeader width={PRODUCT_COLUMN_WIDTH}>Product</TableHeader>
          <TableHeader width={VOLUME_COLUMN_WIDTH} align="center">
            Volume / mo.
          </TableHeader>
          <TableHeader width={LIST_RATE_COLUMN_WIDTH} align="right">
            List Rate
          </TableHeader>
          <TableHeader width={DISCOUNT_COLUMN_WIDTH} align="center">
            Discount
          </TableHeader>
          <TableHeader width={PROPOSED_RATE_COLUMN_WIDTH} align="right">
            Proposed Rate
          </TableHeader>
        </TableRow>
      </TableHead>
      <TableBody>
        {tableProducts.map((product) => {
          const line = previewResult?.lines.find(
            ({ productKey }) => productKey === product.key,
          );
          return (
            <Fragment key={product.key}>
              <TableRow>
                <TableCell>
                  <Flex direction="column" gap="flush">
                    <Text>{product.label}</Text>
                    <Text variant="microcopy">
                      {product.description} · {product.inputUnit}
                    </Text>
                  </Flex>
                </TableCell>
                <TableCell align="center">
                  <NumberInput
                    // No visible label or tooltip in the cell. HubSpot renders the label in bold
                    // above the field and puts the tooltip's info icon beside it, and inside a
                    // table cell that icon wraps to its own line — two extra lines of chrome per
                    // input, on fourteen inputs, which is what made the rows so tall. The column
                    // header and the Product cell already name the field.
                    label=""
                    name={product.key}
                    value={option.input.volumes[product.key]}
                    min={0}
                    max={1_000_000_000}
                    precision={0}
                    onChange={(value) =>
                      onInputChange("volumes", {
                        ...option.input.volumes,
                        [product.key]: value || 0,
                      })
                    }
                  />
                </TableCell>
                <TableCell align="right">{listRatePreview(line)}</TableCell>
                <TableCell align="center">
                  <NumberInput
                    label=""
                    name={`${product.key}_discount`}
                    value={
                      (option.input.productDiscounts?.[product.key] || 0) * 100
                    }
                    min={0}
                    max={100}
                    precision={0}
                    formatStyle="percentage"
                    // Editable whether or not volume is committed. The old rule -- read-only
                    // until the product had volume -- was reasoned from totals: a discount on an
                    // uncommitted product moves no money, so accepting one looked like a silent
                    // no-op. That was wrong about what these lines are for. Every product in the
                    // bundle reaches the quote as a rate schedule, committed or not, and the rate
                    // it prints is the rate the customer draws down at if they ever use it. So a
                    // negotiated rate on a product with no committed volume is a real term of the
                    // deal, and the rep had no way to enter it.
                    //
                    // It is not cosmetic: at zero volume the calculator prices from the entry
                    // band, and the discount multiplies that -- so proposed_rate, and the rate
                    // printed on the Order Form, both move. Holly, 2026-08-27.
                    onChange={(value) =>
                      onInputChange("productDiscounts", {
                        ...(option.input.productDiscounts ||
                          emptyProductDiscounts()),
                        [product.key]: (value || 0) / 100,
                      })
                    }
                  />
                </TableCell>
                <TableCell align="right">{proposedRatePreview(line)}</TableCell>
              </TableRow>
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );

  const approvalBlocked = (previewResult?.blockingReasons.length || 0) > 0;
  // A missing discount reason blocks Lock in exactly as a policy reason does, so the banner has to
  // read the same way: red and titled "Blocked". It was amber "Finance approval required", which
  // said the wrong thing twice -- the colour implied "proceed with approval" and the title named a
  // step that is not what is stopping the button. Holly, 2026-08-28.
  //
  // Declared after discountReasonMissing below would be a temporal-dead-zone error, so it is
  // folded in at the point of use instead of into approvalBlocked itself.
  // Credit card is not permitted above the invoice limit -- ACH/Bank Transfer (wire) is required.
  // The rep must SELECT it: the option list below is narrowed to it and Lock in stays disabled
  // until it is chosen, rather than the card silently switching the method for them. A quietly
  // changed payment method is not something anyone would notice on a $250,000 order form.
  const requiresBankTransfer = previewResult?.requiresBankTransfer === true;
  // A discount without a stated reason cannot be locked in. Holly, 2026-08-28. The reason is what
  // the approver reads and what the Deal keeps as the record of why a concession was given, so an
  // empty one makes the approval trail worthless. Whitespace does not count.
  const discountReasonMissing = hasAnyDiscount && discountReason.trim() === "";
  // HubSpot requires a Contact on a CPQ quote. Refused server-side too, but blocked here so the
  // rep reads "choose a contact" rather than a 400 that blames the quote template.
  const contactMissing = contactId === "";

  const bankTransferNotSelected =
    requiresBankTransfer && paymentMethod !== BANK_TRANSFER_METHOD;

  // Selected FOR the rep, not left to them. Credit card is the default, so every large deal would
  // otherwise open in a blocked state and need a hand-click on the only option the dropdown still
  // offers -- friction on the deals that least deserve it.
  //
  // The switch is never silent: the notice below states that the method was set and why, and it
  // stays on screen for as long as the rule applies. Auto-selecting something quietly on a
  // $250,000 order form is exactly the kind of change nobody would catch.
  useEffect(() => {
    if (bankTransferNotSelected) onPaymentMethodChange(BANK_TRANSFER_METHOD);
  }, [bankTransferNotSelected, onPaymentMethodChange]);
  const lockBlocked =
    approvalBlocked || discountReasonMissing || contactMissing;
  const approvalBannerVariant = lockBlocked
    ? "error"
    : previewResult?.approvalTierRequired === "none"
      ? "success"
      : "warning";
  const approvalBannerTitle = lockBlocked
    ? "Blocked"
    : previewResult?.approvalTierRequired === "none"
      ? "No approval required"
      : `${approvalLabel(previewResult?.approvalTierRequired || "none")} approval required`;

  return (
    <Flex direction="column" gap="flush">
      {previewError && (
        <Alert title="Pricing is not up to date" variant="error">
          {previewError} The figures below are from your previous entry.
        </Alert>
      )}

      {/* A disabled Lock in button with no explanation reads as a broken card, so the reason is
          stated wherever it can be triggered. It names the actual invoice figure, because the
          limit is judged on the largest single INVOICE and not on ARR or TCV -- a rep looking at a
          $290,000 ARR would otherwise have no idea why a $24,000 monthly payment was fine. */}
      {requiresBankTransfer && (
        <Alert
          title={
            bankTransferNotSelected
              ? "Set Payment Method to Bank transfer / ACH"
              : "Payment Method set to Bank transfer / ACH"
          }
          variant={bankTransferNotSelected ? "error" : "warning"}
        >
          The largest invoice on this configuration is{" "}
          {currency(previewResult?.largestInvoiceAmount)}, above the{" "}
          {currency(previewResult?.creditCardMaximumInvoice)} credit card limit,
          so credit card is not permitted and has been removed as an option.
          {previewResult &&
          previewResult.firstInvoiceAmount >
            previewResult.recurringInvoiceAmount ? (
            <Text variant="microcopy">
              The recurring payment is{" "}
              {currency(previewResult.recurringInvoiceAmount)}; the first
              invoice is larger because it also carries{" "}
              {currency(
                previewResult.firstInvoiceAmount -
                  previewResult.recurringInvoiceAmount,
              )}{" "}
              of one-time charges.
            </Text>
          ) : null}
        </Alert>
      )}

      {/* No Card wrapper: Card supplies fixed padding that cannot be reduced from here, and it
          was the widest source of horizontal inset. */}
      <Flex direction="column" gap="xs">
        {
          <>
            {/* Heading, not Text, for every section title. Text has no size prop and both its
                variants are body-sized, so Heading's default is the only larger size available
                from the card. */}
            <Heading>Contract Basics:</Heading>
            <AutoGrid columnWidth={200} flexible gap="sm">
              <DateInput
                label="Start Date"
                name="start_date"
                value={dateValue(option.input.startDate) || undefined}
                format="YYYY-MM-DD"
                onChange={(value) =>
                  onInputChange("startDate", formatDateInput(value))
                }
              />
              <Select
                label="Initial Term"
                name="term_months"
                value={option.input.termMonths}
                options={termOptions}
                onChange={(value) => onInputChange("termMonths", Number(value))}
              />
              <Select
                label="Payment Schedule"
                name="payment_frequency"
                value={option.input.paymentFrequency}
                options={paymentOptions}
                onChange={(value) =>
                  onInputChange("paymentFrequency", String(value))
                }
              />
              {quoteTemplates.length > 0 && (
                <Select
                  label="Quote Template"
                  name="quote_template"
                  value={templateId}
                  options={quoteTemplates.map(({ id, name }) => ({
                    value: id,
                    label: name,
                  }))}
                  onChange={(value) => onTemplateChange(String(value))}
                />
              )}
              <Select
                label="Payment Method"
                name="payment_method"
                value={paymentMethod}
                options={permittedPaymentMethodOptions(requiresBankTransfer)}
                description={
                  requiresBankTransfer
                    ? `Required: invoices above ${currency(previewResult?.creditCardMaximumInvoice)} cannot be paid by credit card.`
                    : undefined
                }
                onChange={(value) => onPaymentMethodChange(String(value))}
              />
              {/* The Quote's contact. HubSpot lists Contact as a REQUIRED association on a CPQ
                  quote, and the app used to send whatever the Deal happened to have -- so a Deal
                  with none produced a quote HubSpot refused, with an error that named the template
                  instead. It belongs in Contract Basics with the other things that define the
                  agreement, not down by the button. Holly, 2026-08-28. */}
              <Flex direction="column" gap="flush">
                <Select
                  label="Contact for Quote"
                  name="quote_contact"
                  value={contactId}
                  options={[
                    { value: "", label: "Choose a contact…" },
                    ...contacts.map(({ id, label }) => ({ value: id, label })),
                  ]}
                  description={
                    contacts.length === 0
                      ? "No contacts on this Deal or its Company. Associate one in HubSpot, then reload."
                      : contactSource === "company"
                        ? "This Deal has no contact, so these are the Company's. The one you choose is added to the Deal on lock in."
                        : undefined
                  }
                  onChange={(value) => onContactChange(String(value ?? ""))}
                />
              </Flex>
              {/* onChange, not onInput: onInput fires per keystroke and would re-render the whole
                  card on every character. onChange commits on blur, which is what state wants. */}
              <Input
                label="Quote title"
                name="quote_title"
                type="text"
                value={quoteTitle}
                placeholder={quoteTitlePlaceholder || "Name shown on the quote"}
                description={
                  quoteTitlePlaceholder
                    ? `Leave blank to use “${quoteTitlePlaceholder}”.`
                    : "Leave blank to name the quote after the Deal."
                }
                error={quoteTitleTooLong}
                validationMessage={
                  quoteTitleTooLong
                    ? `Keep the title to ${QUOTE_TITLE_MAX_LENGTH} characters or fewer.`
                    : undefined
                }
                onChange={(value) => onQuoteTitleChange(String(value))}
              />
            </AutoGrid>
          </>
        }

        {
          <>
            {/* A rule instead of whitespace: the gap above this section was the largest on the
                card and was doing the work a divider should do. */}
            <Divider />
            <Heading>Monthly Product Commitments:</Heading>
            <Text variant="microcopy">
              Enter committed monthly usage. Discounts are optional, entered
              manually, and determine the required approval level.
            </Text>
            {productTable(products)}
            {committedProductCount === 0 && (
              <Alert title="Add at least one commitment" variant="warning">
                Add committed usage for at least one product.
              </Alert>
            )}
          </>
        }

        {
          <>
            <Divider />
            <Heading>Services and Pricing:</Heading>
            <Text variant="microcopy">
              Choose support, onboarding, optional services, and any requested
              discount.
            </Text>
            {/* An AutoGrid of self-contained columns, which is how this gets to be horizontal
                like Contract Basics without losing the hierarchy.

                AutoGrid fills row by row, so putting the four controls in it directly made the DOM
                order layout-dependent: correct at exactly two columns, wrong at one, and AutoGrid
                is responsive, so it silently switched between them as content changed width. That
                is what made the fields appear to rearrange themselves while being filled in.

                Each grid cell is now a Flex column holding one control, its own discount, and that
                discount's pricing summary. The cell is the unit that reflows, so a discount can
                never be separated from the thing it discounts, at any width.

                Use Flex, never Stack, inside these cells. Stack appears in the package's exports
                and type definitions but in none of HubSpot's component documentation, and
                converting these sections to Stack -- with and without an explicit direction --
                deployed twice and rendered horizontally both times. */}
            <AutoGrid columnWidth={280} flexible gap="md">
              <Flex direction="column" gap="sm">
                <Select
                  label="Support"
                  name="support_level"
                  value={option.input.supportLevel}
                  options={supportOptions}
                  onChange={(value) =>
                    onInputChange("supportLevel", String(value))
                  }
                />
                <NumberInput
                  label="Support Discount"
                  name="support_discount"
                  value={(option.input.supportDiscount || 0) * 100}
                  min={0}
                  max={100}
                  precision={2}
                  formatStyle="percentage"
                  onChange={(value) =>
                    onInputChange("supportDiscount", (value || 0) / 100)
                  }
                />
                {discountPreview(
                  previewResult?.listSupportAnnual,
                  option.input.supportDiscount,
                  previewResult?.supportAnnual,
                  "per year",
                )}
              </Flex>
              <Flex direction="column" gap="sm">
                <Select
                  label="Onboarding"
                  name="onboarding_package"
                  value={option.input.onboardingPackage}
                  options={onboardingOptions}
                  onChange={(value) =>
                    onInputChange("onboardingPackage", String(value))
                  }
                />
                <NumberInput
                  label="Onboarding Discount"
                  name="onboarding_discount"
                  value={(option.input.onboardingDiscount || 0) * 100}
                  min={0}
                  max={100}
                  precision={2}
                  formatStyle="percentage"
                  // Nothing to discount when no onboarding is being sold.
                  readOnly={option.input.onboardingPackage === "none"}
                  onChange={(value) =>
                    onInputChange("onboardingDiscount", (value || 0) / 100)
                  }
                />
                {discountPreview(
                  previewResult?.listOnboardingAmount,
                  option.input.onboardingDiscount,
                  previewResult?.onboardingAmount,
                  "one-time",
                )}
              </Flex>
            </AutoGrid>
            <Card>
              <Flex direction="column" gap="xs">
                <Heading>Add-ons and professional services:</Heading>
                <AutoGrid columnWidth={280} flexible gap="md">
                  <Flex direction="column" gap="sm">
                    <MultiSelect
                      label="Subscription Add-ons"
                      name="add_ons"
                      value={option.input.addOns}
                      options={addOnOptions}
                      onChange={(value) =>
                        onInputChange("addOns", value.map(String))
                      }
                    />
                    {/* Only the add-ons actually selected get a discount field. Rendering one per
                      option meant a column of read-only 0% inputs for things nobody is buying,
                      which is most of this section's height and reads as broken rather than
                      inactive. */}
                    {addOnOptions
                      .filter(({ value }) =>
                        option.input.addOns.includes(String(value)),
                      )
                      .map(({ value, label }) => (
                        <Flex key={value} direction="column" gap="xs">
                          <NumberInput
                            label={`${label} Discount`}
                            name={`${value}_discount`}
                            value={
                              (option.input.addOnDiscounts?.[String(value)] ||
                                0) * 100
                            }
                            min={0}
                            max={100}
                            precision={2}
                            formatStyle="percentage"
                            onChange={(discount) =>
                              onInputChange("addOnDiscounts", {
                                ...(option.input.addOnDiscounts || {}),
                                [String(value)]: (discount || 0) / 100,
                              })
                            }
                          />
                          {discountPreview(
                            previewResult?.selectedAddOns.find(
                              ({ key }) => key === value,
                            )?.listAnnualAmount,
                            option.input.addOnDiscounts?.[String(value)] || 0,
                            previewResult?.selectedAddOns.find(
                              ({ key }) => key === value,
                            )?.annualAmount,
                            "per year",
                          )}
                        </Flex>
                      ))}
                  </Flex>
                  <Flex direction="column" gap="sm">
                    <MultiSelect
                      label="Professional Services"
                      name="professional_services"
                      value={option.input.professionalServices}
                      options={professionalServiceOptions}
                      onChange={(value) =>
                        onInputChange("professionalServices", value.map(String))
                      }
                    />
                    <NumberInput
                      label="Professional Services Discount"
                      name="professional_services_discount"
                      value={
                        (option.input.professionalServicesDiscount || 0) * 100
                      }
                      min={0}
                      max={100}
                      precision={2}
                      formatStyle="percentage"
                      readOnly={option.input.professionalServices.length === 0}
                      onChange={(value) =>
                        onInputChange(
                          "professionalServicesDiscount",
                          (value || 0) / 100,
                        )
                      }
                    />
                    {option.input.professionalServices.length > 0 &&
                      discountPreview(
                        previewResult?.listProfessionalServicesAmount,
                        option.input.professionalServicesDiscount,
                        previewResult?.professionalServicesAmount,
                        "one-time",
                      )}
                  </Flex>
                </AutoGrid>
              </Flex>
            </Card>
          </>
        }

        {
          <>
            <Divider />
            <Box>
              <Heading>Renewal and Contract Terms:</Heading>
              <Text variant="microcopy">
                Standard terms automatically renew for 12 months. Non-renewal
                notice must be provided at least 60 days before the subscription
                end date.
              </Text>
            </Box>
            <Checkbox
              name="non_renewal"
              checked={!option.input.autoRenewal}
              onChange={(checked) => onInputChange("autoRenewal", !checked)}
            >
              Non-renewal
            </Checkbox>
            {/* The copy above promises a renewal term and a notice deadline. The dates the
                  calculator derives from them used to live in a summary panel that is no longer
                  rendered, so the rep was told a deadline existed and never shown it. */}
            {previewResult && (
              <AutoGrid columnWidth={175} flexible gap="sm">
                <Text variant="microcopy">
                  Ends {previewResult.dates.contractEndDate || "Not calculated"}
                </Text>
                <Text variant="microcopy">
                  Renews {previewResult.dates.renewalDate || "Not applicable"}
                </Text>
                <Text variant="microcopy">
                  Notice by{" "}
                  {previewResult.dates.nonRenewalNoticeDate || "Not applicable"}
                </Text>
              </AutoGrid>
            )}
            <Divider />
            <Checkbox
              name="redlining_requested"
              checked={option.input.redliningRequested}
              onChange={(checked) =>
                onInputChange("redliningRequested", checked)
              }
            >
              Customer requests redlines
            </Checkbox>
            {option.input.redliningRequested && (
              <TextArea
                label="Describe the Requested Terms"
                name="special_terms"
                value={option.input.specialTerms}
                rows={3}
                maxLength={4_000}
                onChange={(value) => onInputChange("specialTerms", value)}
              />
            )}
          </>
        }
      </Flex>
      {/* The Discount Reason sits here, immediately above the banner that demands it and the
          button it blocks, rather than up in the add-ons section where it used to live. A rep
          reading "a discount reason is required" should not have to scroll back up a long form to
          find the field. Holly, 2026-08-28. */}
      {hasAnyDiscount && (
        <Flex direction="column" gap="xs">
          <TextArea
            label="Discount Reason"
            name="discount_reason"
            value={discountReason}
            rows={2}
            maxLength={4_000}
            placeholder="Why is this discount being given?"
            onChange={(value) => onDiscountReasonChange(String(value))}
          />
          {/* Which discounts, by name, so "there are no discounts" can be checked rather than
              argued with. */}
          <Text variant="microcopy">
            Discounts applied: {discountedItems.join(" · ")}
          </Text>
          {discountReasonMissing ? (
            <Text variant="microcopy" format={{ fontWeight: "bold" }}>
              Required. A discount cannot be locked in without a reason — this
              is what the approver reads.
            </Text>
          ) : (
            <Text variant="microcopy">
              Recorded on the Deal for approval. Appears only because a discount
              has been entered.
            </Text>
          )}
        </Flex>
      )}
      {/* What the Seller block on the LIVE quote actually holds.
          Read from the quote on every card load, not printed once at lock time -- the card reloads
          straight after the confirmation alert, so a message there is gone before it can be read.
          Three rounds of "the seller contact isn't coming through" produced no evidence for
          exactly that reason. Remove this once the Seller block is confirmed working. */}
      {latestQuoteSeller && (
        <Alert
          title="Seller on the latest Quote"
          variant={
            latestQuoteSeller.storedFields.length === 3 ? "success" : "warning"
          }
        >
          {latestQuoteSeller.storedFields.length === 3
            ? `Set: ${latestQuoteSeller.email}. If the Seller section still prints blank, the template is not rendering these fields.`
            : latestQuoteSeller.ownerId === ""
              ? "The Quote has no owner. Set a Deal owner, then lock in again."
              : latestQuoteSeller.storedFields.length === 0
                ? `Quote ${latestQuoteSeller.quoteId} has owner ${latestQuoteSeller.ownerId} but HubSpot kept none of hs_sender_firstname, hs_sender_lastname, hs_sender_email — so those are the wrong fields for this quote model.`
                : `Quote ${latestQuoteSeller.quoteId} kept only ${latestQuoteSeller.storedFields.join(", ")}.`}
        </Alert>
      )}

      {/* The approval state sits with the action it gates, not up in the header: a blocking
          reason is only actionable next to the button it stops. */}
      {previewResult && (
        <Alert title={approvalBannerTitle} variant={approvalBannerVariant}>
          {[
            ...previewResult.blockingReasons,
            ...(discountReasonMissing
              ? ["A discount reason is required before this can be locked in."]
              : []),
            ...(contactMissing ? ["A contact is required on the Quote."] : []),
            ...previewResult.approvalReasons,
          ].join(" · ") || "This configuration can be locked in as priced."}
        </Alert>
      )}

      {/* Beside the button, not up in the form: it describes what THIS click is about to do to
          the Deal's existing quote, and it is only meaningful at the moment of clicking. */}
      <Flex justify="end" align="center" gap="md">
        <Checkbox
          name="replace_existing_quote"
          checked={replaceExistingQuote}
          onChange={(checked) => onReplaceExistingQuoteChange(checked)}
        >
          Replace the existing quote
        </Checkbox>
        <LoadingButton
          variant="primary"
          loading={saving}
          onClick={onLock}
          // pricingIsCurrent is the important guard: without it a failed or in-flight preview
          // left this button enabled over the previous input's numbers, so one click could push
          // pricing the rep was no longer looking at to the Deal and a customer-facing Quote.
          disabled={
            !option.input.startDate ||
            committedProductCount === 0 ||
            !pricingIsCurrent ||
            !previewResult ||
            previewResult.blockingReasons.length > 0 ||
            // Credit card above the invoice limit is refused server-side too, but only after the
            // Deal line items have been archived, so it is stopped here first.
            bankTransferNotSelected ||
            // The server rejects an over-long title with a generic INVALID_QUOTE_CONTENT, after
            // the Deal line items have already been replaced. Blocking here keeps the field's own
            // message as the only thing the rep has to read.
            quoteTitleTooLong ||
            // Refused server-side too, before any write. Stopped here as well so the rep gets the
            // field's own message rather than a generic failure.
            discountReasonMissing ||
            contactMissing
          }
        >
          {/* One label, always. It used to read "Update existing config" when the configuration
              matched the last lock, on the reasoning that generateQuote was idempotent on the
              content hash and an unchanged configuration would reuse the existing Quote.
              That stopped being true when quote generation went unconditional -- the hash-based
              reuse was what let a stale quote come back rendered with the old template. So the
              button said "update" while actually minting another draft, and a Deal quietly
              collected one draft Quote per click. Holly, 2026-08-28. */}
          Lock in & create quote
        </LoadingButton>
      </Flex>

      {/* Contract Summary sits BELOW the button now, not between the form and the action:
          it is what a rep checks after configuring, so it belongs at the end of the flow.
          Holly, 2026-08-28.

          Laid out like section VI of the pricing workbook: a row per charge
          type, and columns for one-time, per-billing-period, annual and whole-term.

          Every figure here is read from the calculation, never recomputed: the rows sum to
          result.oneTime, result.recurringPerPeriod, result.committedArr and result.tcv exactly.
          The term column is the one-time amount for one-time rows, and annual x years for
          recurring rows -- which is how the workbook's "Total Fees for Term" column works. */}
      {previewResult && (
        <Flex direction="column" gap="xs">
          <Flex justify="between" align="center" gap="md" wrap>
            <Heading>Contract Summary:</Heading>
            <Flex gap="xs" align="center">
              {previewLoading && (
                <LoadingSpinner size="xs" label="Updating pricing" />
              )}
              {previewLoading && (
                <Text variant="microcopy">Updating pricing…</Text>
              )}
            </Flex>
          </Flex>
          {summaryTable(previewResult, option.input.termMonths)}
        </Flex>
      )}
    </Flex>
  );
};
