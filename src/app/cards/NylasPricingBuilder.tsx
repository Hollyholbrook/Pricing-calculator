import { Fragment, useEffect, useState } from "react";
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
}

interface OptionDocument {
  schemaVersion: "1.0";
  revision: number;
  options: QuoteOption[];
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
  quoteTemplates?: { id: string; name: string }[];
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
const paymentMethodOptions = [
  { value: "credit_card", label: "Credit card" },
  { value: "ach", label: "Bank transfer / ACH" },
  // Last, not first: it is the exception now that Credit card is the default, and a rep who picks
  // it is deliberately clearing the field rather than accepting a blank.
  { value: "", label: "Not specified" },
];

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

// Discounts may be NEGATIVE: a negative discount is an uplift, which CS needs for grandfathering
// accounts whose existing rate is above current list. min={0} on the inputs was silently clamping
// those to zero. Mirrors MIN_DISCOUNT in the calculator, which rejects anything beyond -100%.
const MIN_DISCOUNT_PERCENT = -100;
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

// todayIso and usableStartDate went with the restore. They existed to stop a configuration locked
// weeks ago from restoring a start date already in the past. Nothing restores a date now -- the
// calculator opens on the first of next month every time -- so there is no stale date to guard
// against.
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
      label: "Subscription Drawdown",
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

const approvalLabel = (value?: string) =>
  ({
    none: "No approval",
    sales_director: "Sales Director",
    head_sales: "Head of Sales",
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
  const [error, setError] = useState<string | null>(null);
  const [unsupportedDeal, setUnsupportedDeal] = useState(false);

  const updateFromBody = (body: ServerlessBody) => {
    if (body.dealName) setDealName(body.dealName);
    // No restore from the Deal. The card starts empty and keeps whatever the rep types for as long
    // as they are on the page; nothing reaches back in and replaces it.
    //
    // There used to be a restore here, repopulating the calculator from the configuration Lock in
    // had stored on the Deal. Holly, 2026-08-27: "I don't like that it keeps clearing out." The
    // restore was the clearing -- it dropped the stored `result` to force a fresh preview, so
    // every load came back with the inputs filled and all the figures blank, needing a re-preview
    // before anything could be read. Removing the store (see lockLiveCalculation) removed the
    // reason for this block to exist.
    //
    // Anything a later response wants to feed back into `editing` belongs here, and must be
    // guarded so it cannot overwrite edits made since the load -- that was the original bug this
    // block's flag existed for.
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
      });
      // refreshObjectProperties is documented as "Refresh CRM record properties on the page" --
      // property values only, so the Deal's own approval and pricing fields update in place.
      //
      // reloadPage is NOT called any more, and that is the whole point. It was the only action
      // that refreshes the sibling Line items and Quotes cards, but it reloads the page, which
      // threw away everything in this card -- and the restore that softened the blow is gone with
      // the stored configuration. Reloading now would empty the calculator on every Lock in, which
      // is the "clearing out" Holly asked to stop.
      //
      // The cost is that the Line items and Quotes cards beside this one keep showing their
      // pre-lock contents until the rep refreshes the record themselves. The alert below says
      // where to look, so nothing is silently stale.
      actions.refreshObjectProperties();
      actions.addAlert({
        // Every lock creates a Quote now -- there is no reuse branch -- so there is one message.
        title: "Pricing locked in and draft Quote created",
        // The template is named here because four rounds went into "it is using the wrong
        // template" with no way to see which one had actually been used. Now the confirmation
        // says so every time.
        message:
          `${body.lineItemCount || 0} calculated line items replaced the Deal line items. ` +
          `Template: ${body.templateName || body.templateId || "unknown"}. ` +
          `The draft Quote is on the Deal's Quotes card -- refresh the record to see it.`,
        type: "success",
      });
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
  useEffect(() => {
    let cancelled = false;
    const requestedInput = option.input;
    const timeout = setTimeout(() => {
      void onPreview(requestedInput)
        .then((result) => {
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
  }, [onPreview, option.input]);

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

  // This column shows the LIST rate: the published price, exactly as it appears in the pricing
  // workbook and the HubSpot product library. It reads `baseBandRates` / `baseUnitRate`.
  //
  // It used to read `listBandRates` / `displayListUnitRate`, which are the list rates with the
  // TERM DISCOUNT and PAYMENT PREMIUM already folded in. On a Monthly In Advance deal that is
  // +8%, so a column headed "List Rate" showed $1.08 where the workbook says $1.00, $0.22 where
  // it says $0.20, and $0.54 where it says $0.50 -- every figure out by 8% and none of them
  // matching either source of truth. Switching the deal to Annual In Advance made them all look
  // correct again, which is a nasty way to discover it.
  //
  // The term and payment adjustments have not gone anywhere: they are in the Proposed Rate
  // column, which is what the customer actually pays, and they still drive every total. Nothing
  // about the money changed here -- only which of the two figures this column names.
  const listRatePreview = (line: QuoteLine | undefined) => {
    if (!line) return <Text variant="microcopy">—</Text>;
    if (
      line.productKey === "agent_email_thousands" &&
      line.baseBandRates.length
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
          {line.baseBandRates.map((band) => (
            <Text key={bandRange(band.lower, band.upper)} variant="microcopy">
              {bandRange(band.lower, band.upper)} · {rateCurrency(band.rate)}
            </Text>
          ))}
        </Flex>
      );
    }
    return <Text>{rateCurrency(line.baseUnitRate)}</Text>;
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
          const quoted = (option.input.volumes[product.key] || 0) > 0;
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
                    // A committed volume, not a discount: zero is the floor. The negative floor
                    // belongs only to the discount inputs.
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
                    min={MIN_DISCOUNT_PERCENT}
                    max={100}
                    precision={0}
                    formatStyle="percentage"
                    // A discount on a product with no committed volume changes no total, so it
                    // is disabled rather than silently accepted.
                    readOnly={!quoted}
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
  const approvalBannerVariant = approvalBlocked
    ? "error"
    : previewResult?.approvalTierRequired === "none"
      ? "success"
      : "warning";
  const approvalBannerTitle = approvalBlocked
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

      {/* Contract Summary, laid out like section VI of the pricing workbook: a row per charge
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
                options={paymentMethodOptions}
                onChange={(value) => onPaymentMethodChange(String(value))}
              />
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
            {/* Says out loud why Proposed Rate can sit above List Rate at 0% discount: the term
                discount and the payment-schedule premium land in the proposed rate, not the list
                one. Without this the row reads as though the Discount column is lying. The
                premiums themselves are deliberately not named here -- they live in
                pricingRules.js, and restating them in the card is the reimplementation that made
                the List Rate column wrong in the first place. */}
            <Text variant="microcopy">
              List Rate is the published price. Proposed Rate applies the
              contract term and payment schedule first, then any discount — so
              it can sit above list even at 0%.
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
                  min={MIN_DISCOUNT_PERCENT}
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
                  min={MIN_DISCOUNT_PERCENT}
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
                            min={MIN_DISCOUNT_PERCENT}
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
                      min={MIN_DISCOUNT_PERCENT}
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
                <Text variant="microcopy">
                  Recorded on the Deal for approval. Appears only because a
                  discount has been entered.
                </Text>
              </Flex>
            )}
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
      {/* The approval state sits with the action it gates, not up in the header: a blocking
          reason is only actionable next to the button it stops. */}
      {previewResult && (
        <Alert title={approvalBannerTitle} variant={approvalBannerVariant}>
          {[
            ...previewResult.blockingReasons,
            ...previewResult.approvalReasons,
          ].join(" · ") || "This configuration can be locked in as priced."}
        </Alert>
      )}

      <Flex justify="end">
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
            // The server rejects an over-long title with a generic INVALID_QUOTE_CONTENT, after
            // the Deal line items have already been replaced. Blocking here keeps the field's own
            // message as the only thing the rep has to read.
            quoteTitleTooLong
          }
        >
          {/* The same action either way -- line items are replaced and generateQuote is
              idempotent on the content hash, so an unchanged configuration reuses the existing
              Quote rather than making another. The label says which of those is about to
              happen, because "create quote" on a deal that already has one is a lie. */}
          {/* One label, always. It used to read "Update existing config" when the card matched
              the configuration stored on the Deal -- there is no stored configuration now, and
              every Lock in creates a new Quote regardless, so the old label described something
              that never happened. */}
          Lock in &amp; create quote
        </LoadingButton>
      </Flex>
    </Flex>
  );
};
