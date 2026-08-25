import { Fragment, useEffect, useState } from "react";
import {
  Alert,
  AutoGrid,
  Box,
  Button,
  Card,
  Checkbox,
  DateInput,
  Divider,
  EmptyState,
  ExtensionPointApiActions,
  Flex,
  Link,
  LoadingButton,
  LoadingSpinner,
  Modal,
  ModalBody,
  MultiSelect,
  NumberInput,
  Select,
  Stack,
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
  reused?: boolean;
  previewResult?: QuoteResult;
  quoteTemplates?: { id: string; name: string }[];
  defaultQuoteTemplateId?: string;
}

interface QuoteContent {
  title: string;
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
    label: "Connect",
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

// One width for all four numeric columns keeps them equal; Product uses width="max" to take
// everything left over. Wide enough for a four-decimal rate ("$1.0260") beside the widest header
// ("Proposed Rate") without wrapping, which is what made the rate columns look cut off.
// width takes 'min' | 'max' | 'auto' | pixels — percentages are not expressible, so the requested
// 66 / 8 / 10 / 8 / 8 split is applied as a proportional pixel budget. Product uses "max" and
// absorbs whatever is left, which is the 66% share at a normal card width.
// Wide enough that no header wraps onto a second line — "Volume / mo." and "Proposed Rate" were
// both breaking, which is what made the header row look ragged against the values beneath it.
const VOLUME_COLUMN_WIDTH = 130;
const LIST_RATE_COLUMN_WIDTH = 130;
const DISCOUNT_COLUMN_WIDTH = 120;
const PROPOSED_RATE_COLUMN_WIDTH = 140;

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

const rateCurrency = (value?: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value || 0);

const percent = (value?: number) =>
  `${Math.round((value || 0) * 10_000) / 100}%`;

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

const dateAfterDays = (days: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

hubspot.extend<"crm.record.tab">(({ context, actions }: CrmExtensionProps) => (
  <NylasPricingBuilder context={context} actions={actions} />
));

const NylasPricingBuilder = ({ context, actions }: CrmExtensionProps) => {
  const dealId = String(context.crm.objectId);
  const [latestQuoteUrl, setLatestQuoteUrl] = useState<string | null>(null);
  const [quoteTemplates, setQuoteTemplates] = useState<
    { id: string; name: string }[]
  >([]);
  const [templateId, setTemplateId] = useState("");
  // The card exposes no controls for the rest of these, so they are constants rather than state
  // whose setter is never called.
  const quoteContent: QuoteContent = {
    title: "Nylas Enterprise Quote",
    // Empty means "use the QUOTE_TEMPLATE_ID secret", which is what happens when the portal
    // exposes no customizable templates to pick from.
    templateId,
    expirationDate: dateAfterDays(30),
    presentation: "itemized_products",
    includeUncommittedRateSchedule: true,
    includeRenewalTerms: true,
    includeSpecialTerms: true,
  };
  const [editing, setEditing] = useState<QuoteOption>({
    name: "Live calculator",
    status: "draft",
    input: emptyInput(),
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unsupportedDeal, setUnsupportedDeal] = useState(false);

  const updateFromBody = (body: ServerlessBody) => {
    if (body.latestQuoteUrl !== undefined)
      setLatestQuoteUrl(body.latestQuoteUrl || null);
    if (body.quoteTemplates) {
      setQuoteTemplates(body.quoteTemplates);
      // Preselect the configured default when it is one of the usable templates, so the picker
      // shows what would happen anyway rather than silently differing from it.
      const preferred = body.defaultQuoteTemplateId || "";
      setTemplateId((current) => {
        if (current) return current;
        return body.quoteTemplates?.some(({ id }) => id === preferred)
          ? preferred
          : body.quoteTemplates?.[0]?.id || "";
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
      });
      // generateQuote is idempotent on the quote content hash, so a repeat lock reuses the
      // existing Quote rather than creating one. Saying "created" either way misreports what
      // happened. Surface the URL too — lock_live returns it and the card used to drop it,
      // leaving the rep told to "review the draft Quote" with no way to reach it.
      setLatestQuoteUrl(body.quoteUrl || null);
      actions.addAlert({
        title: body.reused
          ? "Pricing locked in — existing draft Quote reused"
          : "Pricing locked in and draft Quote created",
        message: `${body.lineItemCount || 0} calculated line items replaced the Deal line items.${
          body.quoteUrl ? " The draft Quote link is on the card." : ""
        }`,
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
    <Stack distance="xs">
      {error && (
        <Alert title="Couldn’t complete the pricing action" variant="error">
          {error}
        </Alert>
      )}

      {latestQuoteUrl && (
        <Alert title="Draft Quote ready" variant="success">
          <Link href={latestQuoteUrl}>Open the draft Quote</Link>
        </Alert>
      )}

      <OptionEditor
        option={editing}
        saving={saving}
        quoteTemplates={quoteTemplates}
        templateId={templateId}
        onTemplateChange={setTemplateId}
        onInputChange={updateInput}
        onPreview={previewQuote}
        onLock={lockAndCreateQuote}
      />
    </Stack>
  );
};

const OptionEditor = ({
  option,
  saving,
  quoteTemplates,
  templateId,
  onTemplateChange,
  onInputChange,
  onPreview,
  onLock,
}: {
  option: QuoteOption;
  saving: boolean;
  quoteTemplates: { id: string; name: string }[];
  templateId: string;
  onTemplateChange: (value: string) => void;
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

  // The graduated schedule is available on demand rather than inline. Rendering four bands in the
  // cell made the Agent Email row several times taller than every other row; a Link with an
  // overlay keeps the row standard and puts the full schedule one click away.
  const tiersOverlay = (line: QuoteLine) => (
    <Modal
      id="agent-email-tiers"
      title="Agent Email graduated rates"
      width="sm"
    >
      <ModalBody>
        <Stack distance="sm">
          <Text variant="microcopy">
            Agent Email is priced in graduated tiers. Each band is charged at
            its own rate, and the rate shown in the table is the blended rate
            across all bands at the entered volume.
          </Text>
          <Table density="compact" flush>
            <TableHead>
              <TableRow>
                <TableHeader>Emails per month</TableHeader>
                <TableHeader align="right">List</TableHeader>
                <TableHeader align="right">Proposed</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {line.listBandRates.map((band, index) => (
                <TableRow key={bandRange(band.lower, band.upper)}>
                  <TableCell>{bandRange(band.lower, band.upper)}</TableCell>
                  <TableCell align="right">{rateCurrency(band.rate)}</TableCell>
                  <TableCell align="right">
                    {rateCurrency(line.proposedBandRates[index]?.rate)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Stack>
      </ModalBody>
    </Modal>
  );

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
      return (
        <Stack distance="flush">
          <Text>{rateCurrency(line.displayListUnitRate)}</Text>
          {/* Link requires an href, so the overlay trigger is a transparent Button — it
              renders as a link but needs no destination. */}
          <Button variant="transparent" size="xs" overlay={tiersOverlay(line)}>
            View tiers
          </Button>
        </Stack>
      );
    }
    return <Text>{rateCurrency(line.displayListUnitRate)}</Text>;
  };

  const proposedRatePreview = (line: QuoteLine | undefined) => {
    if (!line) return <Text variant="microcopy">—</Text>;
    return <Text>{rateCurrency(line.displayProposedUnitRate)}</Text>;
  };

  const productTable = (tableProducts: typeof products) => (
    <Table density="compact" flush>
      <TableHead>
        <TableRow>
          {/* width accepts 'min' | 'max' | 'auto' | number (pixels) — percentages are not
              expressible. Product takes max so it absorbs all remaining width, and the four
              numeric columns share one equal fixed width, right-aligned in both header and body. */}
          <TableHeader width="max">Product</TableHeader>
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
                  <Stack distance="flush">
                    <Text>{product.label}</Text>
                    <Text variant="microcopy">
                      {product.description} · {product.inputUnit}
                    </Text>
                  </Stack>
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
    <Stack distance="flush">
      {previewError && (
        <Alert title="Pricing is not up to date" variant="error">
          {previewError} The figures below are from your previous entry.
        </Alert>
      )}

      {/* Compact header: totals on the right of one row, approval as a full-width banner
          directly beneath. Previously each of these was its own stacked card, which is most of
          why the card read as a tall single column. */}
      {previewResult && (
        <Stack distance="flush">
          <Flex justify="between" align="center" gap="md" wrap>
            <Flex gap="xs" align="center">
              {previewLoading && (
                <LoadingSpinner size="xs" label="Updating pricing" />
              )}
              {previewLoading && (
                <Text variant="microcopy">Updating pricing…</Text>
              )}
            </Flex>
            <Flex gap="md" align="center" wrap>
              <Text format={{ fontWeight: "bold" }}>
                ARR {currency(previewResult.committedArr)}
              </Text>
              <Text format={{ fontWeight: "bold" }}>
                One-time {currency(previewResult.oneTime)}
              </Text>
              <Text format={{ fontWeight: "bold" }}>
                TCV {currency(previewResult.tcv)}
              </Text>
            </Flex>
          </Flex>
          <Alert title={approvalBannerTitle} variant={approvalBannerVariant}>
            {[
              ...previewResult.blockingReasons,
              ...previewResult.approvalReasons,
            ].join(" · ") || "This configuration can be locked in as priced."}
          </Alert>
        </Stack>
      )}

      {/* No Card wrapper: Card supplies fixed padding that cannot be reduced from here, and it
          was the widest source of horizontal inset. */}
      <Stack distance="xs">
        {
          <>
            {/* Text rather than Heading for section titles: Heading exposes no size prop, and
                its default is oversized for a section label inside a record tab. */}
            <Text format={{ fontWeight: "bold" }}>Contract Basics</Text>
            <AutoGrid columnWidth={170} flexible gap="sm">
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
            </AutoGrid>
          </>
        }

        {
          <>
            {/* A rule instead of whitespace: the gap above this section was the largest on the
                card and was doing the work a divider should do. */}
            <Divider />
            <Text format={{ fontWeight: "bold" }}>
              Monthly Product Commitments
            </Text>
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
            <Text format={{ fontWeight: "bold" }}>Services and Pricing</Text>
            <Text variant="microcopy">
              Choose support, onboarding, optional services, and any requested
              discount.
            </Text>
            <AutoGrid columnWidth={165} flexible gap="sm">
              <Select
                label="Support"
                name="support_level"
                value={option.input.supportLevel}
                options={supportOptions}
                onChange={(value) =>
                  onInputChange("supportLevel", String(value))
                }
              />
              <Select
                label="Onboarding"
                name="onboarding_package"
                value={option.input.onboardingPackage}
                options={onboardingOptions}
                onChange={(value) =>
                  onInputChange("onboardingPackage", String(value))
                }
              />
              <Stack distance="xs">
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
              </Stack>
              <Stack distance="xs">
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
              </Stack>
            </AutoGrid>
            <Card>
              <Stack distance="xs">
                <Text format={{ fontWeight: "bold" }}>
                  Add-ons and professional services
                </Text>
                <AutoGrid columnWidth={190} flexible gap="sm">
                  <MultiSelect
                    label="Subscription Add-ons"
                    name="add_ons"
                    value={option.input.addOns}
                    options={addOnOptions}
                    onChange={(value) =>
                      onInputChange("addOns", value.map(String))
                    }
                  />
                  {addOnOptions.map(({ value, label }) => (
                    <Stack key={value} distance="xs">
                      <NumberInput
                        label={`${label} Discount`}
                        name={`${value}_discount`}
                        value={
                          (option.input.addOnDiscounts?.[String(value)] || 0) *
                          100
                        }
                        min={0}
                        max={100}
                        precision={2}
                        formatStyle="percentage"
                        readOnly={!option.input.addOns.includes(String(value))}
                        onChange={(discount) =>
                          onInputChange("addOnDiscounts", {
                            ...(option.input.addOnDiscounts || {}),
                            [String(value)]: (discount || 0) / 100,
                          })
                        }
                      />
                      {option.input.addOns.includes(String(value)) &&
                        discountPreview(
                          previewResult?.selectedAddOns.find(
                            ({ key }) => key === value,
                          )?.listAnnualAmount,
                          option.input.addOnDiscounts?.[String(value)] || 0,
                          previewResult?.selectedAddOns.find(
                            ({ key }) => key === value,
                          )?.annualAmount,
                          "per year",
                        )}
                    </Stack>
                  ))}
                  <MultiSelect
                    label="Professional Services"
                    name="professional_services"
                    value={option.input.professionalServices}
                    options={professionalServiceOptions}
                    onChange={(value) =>
                      onInputChange("professionalServices", value.map(String))
                    }
                  />
                  <Stack distance="xs">
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
                  </Stack>
                </AutoGrid>
              </Stack>
            </Card>
          </>
        }

        {
          <>
            <Divider />
            <Box>
              <Text format={{ fontWeight: "bold" }}>
                Renewal and Contract Terms
              </Text>
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
      </Stack>
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
            previewResult.blockingReasons.length > 0
          }
        >
          Lock in &amp; create quote
        </LoadingButton>
      </Flex>
    </Stack>
  );
};
