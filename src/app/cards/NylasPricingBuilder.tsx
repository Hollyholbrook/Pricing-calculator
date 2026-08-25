import { Fragment, useEffect, useMemo, useState } from "react";
import {
  Accordion,
  Alert,
  AutoGrid,
  Box,
  Button,
  Card,
  Checkbox,
  DateInput,
  DescriptionList,
  DescriptionListItem,
  Divider,
  EmptyState,
  ExtensionPointApiActions,
  Flex,
  Heading,
  Input,
  LoadingButton,
  LoadingSpinner,
  Link,
  MultiSelect,
  NumberInput,
  Select,
  Stack,
  StatusTag,
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
  details?: { field?: string; validationCode?: string };
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
}

interface QuoteContent {
  title: string;
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
}[] = [
  {
    key: "connect_ca",
    label: "Connect",
    description: "Monthly connected accounts",
  },
  {
    key: "calendar_ca",
    label: "Calendar Only",
    description: "Monthly calendar accounts",
  },
  {
    key: "notetaker_bot_hours",
    label: "Notetaker",
    description: "Monthly bot hours",
  },
  {
    key: "agent_accounts",
    label: "Agent Accounts",
    description: "Monthly accounts",
  },
  {
    key: "agent_email_thousands",
    label: "Agent Email",
    description: "Monthly email volume in thousands",
  },
  {
    key: "agent_storage_gb",
    label: "Agent Data Storage",
    description: "Monthly GB",
  },
  {
    key: "agent_bandwidth_gb",
    label: "Agent Bandwidth",
    description: "Monthly GB",
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

const emptyInput = (): QuoteInput => ({
  startDate: null,
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

const statusLabel = (value: string) =>
  ({
    draft: "Draft",
    calculated: "Calculated",
    selected: "Customer Choice",
    pending: "Awaiting Approval",
    approved: "Approved",
    pending_re_approval: "Re-approval Required",
  })[value] || value;

const statusVariant = (
  value: string,
): "success" | "warning" | "info" | "danger" | "default" => {
  if (value === "approved") return "success";
  if (value === "pending" || value === "pending_re_approval") return "warning";
  if (value === "selected") return "info";
  return "default";
};

const cloneInput = (input: QuoteInput): QuoteInput => {
  const cloned = JSON.parse(JSON.stringify(input)) as QuoteInput;
  const defaults = emptyInput();
  return {
    ...defaults,
    ...cloned,
    volumes: { ...defaults.volumes, ...(cloned.volumes || {}) },
    productDiscounts: {
      ...defaults.productDiscounts,
      ...(cloned.productDiscounts || {}),
    },
    addOnDiscounts: {
      ...defaults.addOnDiscounts,
      ...(cloned.addOnDiscounts || {}),
    },
  };
};

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
  const [optionSet, setOptionSet] = useState<OptionDocument>({
    schemaVersion: "1.0",
    revision: 0,
    options: [],
  });
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [approvalStatus, setApprovalStatus] = useState("draft");
  const [lineItemSyncStatus, setLineItemSyncStatus] = useState("not_started");
  const [latestQuoteId, setLatestQuoteId] = useState<string | null>(null);
  const [latestQuoteUrl, setLatestQuoteUrl] = useState<string | null>(null);
  const [quoteContent, setQuoteContent] = useState<QuoteContent>({
    title: "",
    expirationDate: dateAfterDays(30),
    presentation: "itemized_products",
    includeUncommittedRateSchedule: true,
    includeRenewalTerms: true,
    includeSpecialTerms: true,
  });
  const [editing, setEditing] = useState<QuoteOption | null>(null);
  const [view, setView] = useState<"list" | "edit" | "compare">("list");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unsupportedDeal, setUnsupportedDeal] = useState(false);

  const updateFromBody = (body: ServerlessBody) => {
    if (body.optionSet) setOptionSet(body.optionSet);
    if (body.selectedOptionId !== undefined)
      setSelectedOptionId(body.selectedOptionId || null);
    if (body.approvalStatus) setApprovalStatus(body.approvalStatus);
    if (body.lineItemSyncStatus) setLineItemSyncStatus(body.lineItemSyncStatus);
    if (body.latestQuoteId !== undefined)
      setLatestQuoteId(body.latestQuoteId || null);
    if (body.latestQuoteUrl !== undefined)
      setLatestQuoteUrl(body.latestQuoteUrl || null);
  };

  const runAction = async (parameters: Record<string, unknown>) => {
    const result = await hubspot.serverless<ServerlessResult>(
      "nylas_pricing_quote_options",
      {
        parameters: { dealId, ...parameters },
      },
    );
    if (!result.body.success) {
      const detail = result.body.details?.field
        ? ` (${result.body.details.field})`
        : "";
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

  const beginNew = () => {
    setEditing({
      name: `Option ${optionSet.options.length + 1}`,
      status: "draft",
      input: emptyInput(),
    });
    setView("edit");
  };

  const beginEdit = (option: QuoteOption) => {
    setEditing({ ...option, input: cloneInput(option.input) });
    setView("edit");
  };

  const beginDuplicate = (option: QuoteOption) => {
    setEditing({
      name: `${option.name} Copy`.slice(0, 80),
      status: "draft",
      input: cloneInput(option.input),
    });
    setView("edit");
  };

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

  const calculateAndSave = async () => {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      const body = await runAction({
        action: "calculate_and_save",
        expectedRevision: optionSet.revision,
        option: editing,
      });
      if (body.option) setEditing(body.option);
      actions.addAlert({
        title: "Option calculated",
        message: `${body.option?.name || editing.name} was saved without changing the official Deal totals.`,
        type: "success",
      });
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to calculate this option.",
      );
    } finally {
      setSaving(false);
    }
  };

  const previewQuote = async (input: QuoteInput) => {
    const body = await runAction({ action: "preview", input });
    if (!body.previewResult) {
      throw new PricingActionError("Unable to preview this pricing option.");
    }
    return body.previewResult;
  };

  const removeOption = async (option: QuoteOption) => {
    if (!option.id) return;
    setSaving(true);
    setError(null);
    try {
      await runAction({
        action: "delete",
        expectedRevision: optionSet.revision,
        optionId: option.id,
      });
      actions.addAlert({
        title: "Draft option removed",
        message: `${option.name} was removed.`,
        type: "success",
      });
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to remove this option.",
      );
    } finally {
      setSaving(false);
    }
  };

  const chooseOption = async (option: QuoteOption) => {
    if (!option.id) return;
    setSaving(true);
    setError(null);
    try {
      const body = await runAction({
        action: "select",
        expectedRevision: optionSet.revision,
        optionId: option.id,
      });
      actions.addAlert({
        title: "Customer choice and Deal line items updated",
        message: `${option.name} is selected and ${body.lineItemCount || 0} line items now drive the Deal's native totals. Approval is not requested until the HubSpot Quote is submitted.`,
        type: "success",
      });
      setView("list");
    } catch (selectError) {
      setError(
        selectError instanceof Error
          ? selectError.message
          : "Unable to select this option.",
      );
    } finally {
      setSaving(false);
    }
  };

  const syncLineItems = async () => {
    setSaving(true);
    setError(null);
    try {
      const body = await runAction({ action: "sync_line_items" });
      actions.addAlert({
        title: "Deal line items updated",
        message: `${body.lineItemCount || 0} selected pricing items are now on the Deal.`,
        type: "success",
      });
    } catch (syncError) {
      setError(
        syncError instanceof Error
          ? syncError.message
          : "Unable to update line items.",
      );
    } finally {
      setSaving(false);
    }
  };

  const generateQuote = async () => {
    setSaving(true);
    setError(null);
    try {
      const selected = optionSet.options.find(
        ({ id }) => id === selectedOptionId,
      );
      const body = await runAction({
        action: "generate_quote",
        quoteContent: {
          ...quoteContent,
          title:
            quoteContent.title ||
            `Nylas Enterprise – ${selected?.name || "Customer Choice"}`,
        },
      });
      actions.addAlert({
        title: body.reused
          ? "Existing draft Quote opened"
          : "Draft Quote created",
        message: body.reused
          ? "The same selected configuration already had a draft Quote."
          : "Review the HubSpot draft before publishing or sending it.",
        type: "success",
      });
    } catch (quoteError) {
      setError(
        quoteError instanceof Error
          ? quoteError.message
          : "Unable to create the Quote.",
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Flex justify="center" align="center">
        <LoadingSpinner label="Loading Nylas quote options" />
      </Flex>
    );
  }

  if (unsupportedDeal) {
    return (
      <EmptyState title="New Business quotes only" layout="vertical">
        <Text>
          This calculator is intentionally unavailable on Renewal and other Deal
          types. Open a New Business Deal to build pricing options.
        </Text>
      </EmptyState>
    );
  }

  return (
    <Stack distance="sm">
      <Flex justify="between" align="center" wrap>
        <Box>
          <Heading>Nylas Pricing Builder</Heading>
          <Text variant="microcopy">
            Calculate and compare options. Only the customer choice updates
            official Deal reporting.
          </Text>
        </Box>
        <Flex gap="sm" wrap>
          <Button
            onClick={beginNew}
            disabled={optionSet.options.length >= 10 || saving}
          >
            New Option
          </Button>
          <Button
            onClick={() => setView("compare")}
            disabled={
              optionSet.options.filter(({ result }) => result).length < 2 ||
              saving
            }
          >
            Compare Options
          </Button>
        </Flex>
      </Flex>

      {error && (
        <Alert title="Pricing action needs attention" variant="error">
          {error}
        </Alert>
      )}

      {selectedOptionId && (
        <Alert title="Current customer choice" variant="info">
          {optionSet.options.find(({ id }) => id === selectedOptionId)?.name ||
            "Selected option"}{" "}
          —{" "}
          {approvalStatus === "draft"
            ? "Approval not requested"
            : statusLabel(approvalStatus)}
        </Alert>
      )}

      {selectedOptionId && (
        <Card>
          <Stack distance="md">
            <Heading>Create Customer Quote</Heading>
            <Text variant="microcopy">
              All selected charges remain included. Choose how the subscription
              detail appears, then generate a draft for review.
            </Text>
            <AutoGrid columnWidth={240} flexible gap="md">
              <Input
                label="Quote Title"
                name="quote_title"
                value={quoteContent.title}
                placeholder="Nylas Enterprise – Customer Choice"
                onChange={(title) =>
                  setQuoteContent({ ...quoteContent, title })
                }
              />
              <DateInput
                label="Quote Expiration Date"
                name="quote_expiration_date"
                value={dateValue(quoteContent.expirationDate) || undefined}
                format="YYYY-MM-DD"
                onChange={(value) =>
                  setQuoteContent({
                    ...quoteContent,
                    expirationDate: formatDateInput(value),
                  })
                }
              />
              <Select
                label="Subscription Display"
                name="quote_presentation"
                value={quoteContent.presentation}
                options={[
                  {
                    value: "itemized_products",
                    label: "Show Each Committed Product",
                  },
                  {
                    value: "subscription_summary",
                    label: "Show One Subscription Drawdown",
                  },
                ]}
                onChange={(value) =>
                  setQuoteContent({
                    ...quoteContent,
                    presentation: String(value) as QuoteContent["presentation"],
                  })
                }
              />
            </AutoGrid>
            <Flex gap="md" wrap>
              <Checkbox
                name="include_rate_schedule"
                checked={quoteContent.includeUncommittedRateSchedule}
                onChange={(checked) =>
                  setQuoteContent({
                    ...quoteContent,
                    includeUncommittedRateSchedule: checked,
                  })
                }
              >
                Include Full Product Rate Schedule
              </Checkbox>
              <Checkbox
                name="include_renewal_terms"
                checked={quoteContent.includeRenewalTerms}
                onChange={(checked) =>
                  setQuoteContent({
                    ...quoteContent,
                    includeRenewalTerms: checked,
                  })
                }
              >
                Include Renewal Terms
              </Checkbox>
              <Checkbox
                name="include_special_terms"
                checked={quoteContent.includeSpecialTerms}
                onChange={(checked) =>
                  setQuoteContent({
                    ...quoteContent,
                    includeSpecialTerms: checked,
                  })
                }
              >
                Include Approved Special Terms
              </Checkbox>
            </Flex>
            <Flex gap="sm" wrap align="center">
              <LoadingButton loading={saving} onClick={syncLineItems}>
                {lineItemSyncStatus === "synced"
                  ? "Refresh Deal Line Items"
                  : "Add Deal Line Items"}
              </LoadingButton>
              <LoadingButton
                variant="primary"
                loading={saving}
                onClick={generateQuote}
              >
                Generate Draft Quote
              </LoadingButton>
              {latestQuoteId && latestQuoteUrl && (
                <Link href={latestQuoteUrl}>Open Latest Quote</Link>
              )}
            </Flex>
          </Stack>
        </Card>
      )}

      {view === "list" && (
        <OptionList
          optionSet={optionSet}
          selectedOptionId={selectedOptionId}
          saving={saving}
          onNew={beginNew}
          onEdit={beginEdit}
          onDuplicate={beginDuplicate}
          onDelete={removeOption}
          onChoose={chooseOption}
        />
      )}

      {view === "edit" && editing && (
        <OptionEditor
          option={editing}
          saving={saving}
          onOptionChange={setEditing}
          onInputChange={updateInput}
          onCalculate={calculateAndSave}
          onPreview={previewQuote}
          onBack={() => setView("list")}
          onChoose={chooseOption}
        />
      )}

      {view === "compare" && (
        <Comparison
          options={optionSet.options.filter(({ result }) => result)}
          selectedOptionId={selectedOptionId}
          saving={saving}
          onBack={() => setView("list")}
          onEdit={beginEdit}
          onChoose={chooseOption}
        />
      )}
    </Stack>
  );
};

const OptionList = ({
  optionSet,
  selectedOptionId,
  saving,
  onNew,
  onEdit,
  onDuplicate,
  onDelete,
  onChoose,
}: {
  optionSet: OptionDocument;
  selectedOptionId: string | null;
  saving: boolean;
  onNew: () => void;
  onEdit: (option: QuoteOption) => void;
  onDuplicate: (option: QuoteOption) => void;
  onDelete: (option: QuoteOption) => void;
  onChoose: (option: QuoteOption) => void;
}) => {
  if (optionSet.options.length === 0) {
    return (
      <EmptyState title="No quote options yet" layout="vertical">
        <Stack distance="sm">
          <Text>
            Create the first commercial option for this New Business Deal.
          </Text>
          <Button variant="primary" onClick={onNew}>
            Create First Option
          </Button>
        </Stack>
      </EmptyState>
    );
  }

  return (
    <Table density="condensed">
      <TableHead>
        <TableRow>
          <TableHeader>Option</TableHeader>
          <TableHeader>Status</TableHeader>
          <TableHeader align="right">Term</TableHeader>
          <TableHeader align="right">ARR</TableHeader>
          <TableHeader align="right">TCV</TableHeader>
          <TableHeader>Approval</TableHeader>
          <TableHeader>Actions</TableHeader>
        </TableRow>
      </TableHead>
      <TableBody>
        {optionSet.options.map((option) => {
          const isSelected = option.id === selectedOptionId;
          const isBlocked = (option.result?.blockingReasons.length || 0) > 0;
          return (
            <TableRow key={option.id || option.name}>
              <TableCell>
                <Text format={{ fontWeight: isSelected ? "bold" : "regular" }}>
                  {option.name}
                </Text>
              </TableCell>
              <TableCell>
                <StatusTag variant={statusVariant(option.status)}>
                  {statusLabel(option.status)}
                </StatusTag>
              </TableCell>
              <TableCell align="right">{option.input.termMonths} mo.</TableCell>
              <TableCell align="right">
                {currency(option.result?.committedArr)}
              </TableCell>
              <TableCell align="right">
                {currency(option.result?.tcv)}
              </TableCell>
              <TableCell>
                {approvalLabel(option.result?.approvalTierRequired)}
              </TableCell>
              <TableCell>
                <Flex gap="xs" wrap>
                  <Button
                    size="xs"
                    onClick={() => onEdit(option)}
                    disabled={saving}
                  >
                    Edit
                  </Button>
                  <Button
                    size="xs"
                    onClick={() => onDuplicate(option)}
                    disabled={saving}
                  >
                    Duplicate
                  </Button>
                  <Button
                    size="xs"
                    variant={isSelected ? "secondary" : "primary"}
                    onClick={() => onChoose(option)}
                    disabled={!option.result || isBlocked || saving}
                  >
                    {isSelected
                      ? "Customer Choice"
                      : "Select as Customer Choice"}
                  </Button>
                  {!isSelected && (
                    <Button
                      size="xs"
                      variant="destructive"
                      onClick={() => onDelete(option)}
                      disabled={saving}
                    >
                      Remove
                    </Button>
                  )}
                </Flex>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
};

const editorSteps = [
  "Contract",
  "Products",
  "Services",
  "Renewal & Terms",
  "Review",
];

const OptionEditor = ({
  option,
  saving,
  onOptionChange,
  onInputChange,
  onCalculate,
  onPreview,
  onBack,
  onChoose,
}: {
  option: QuoteOption;
  saving: boolean;
  onOptionChange: (option: QuoteOption) => void;
  onInputChange: <K extends keyof QuoteInput>(
    field: K,
    value: QuoteInput[K],
  ) => void;
  onCalculate: () => void;
  onPreview: (input: QuoteInput) => Promise<QuoteResult>;
  onBack: () => void;
  onChoose: (option: QuoteOption) => void;
}) => {
  const [step, setStep] = useState(0);
  const [previewResult, setPreviewResult] = useState<QuoteResult | undefined>(
    option.result,
  );
  const [previewLoading, setPreviewLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const loadingTimeout = setTimeout(() => {
      if (!cancelled) setPreviewLoading(true);
    }, 0);
    const timeout = setTimeout(() => {
      void onPreview(option.input)
        .then((result) => {
          if (!cancelled) setPreviewResult(result);
        })
        .catch(() => {
          if (!cancelled) setPreviewResult(undefined);
        })
        .finally(() => {
          if (!cancelled) setPreviewLoading(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(loadingTimeout);
      clearTimeout(timeout);
    };
  }, [onPreview, option.input]);
  const committedProductCount = products.filter(
    ({ key }) => option.input.volumes[key] > 0,
  ).length;
  const canContinue =
    step !== 0 || Boolean(option.name.trim() && option.input.startDate);
  const canReview = step !== 1 || committedProductCount > 0;
  const paymentLabel =
    paymentOptions.find(({ value }) => value === option.input.paymentFrequency)
      ?.label || "";
  const supportLabel =
    supportOptions.find(({ value }) => value === option.input.supportLevel)
      ?.label || "";
  const onboardingLabel =
    onboardingOptions.find(
      ({ value }) => value === option.input.onboardingPackage,
    )?.label || "";

  const discountPreview = (
    listAmount: number | undefined,
    discount: number,
    proposedAmount: number | undefined,
    unit: string,
  ) => {
    if (previewLoading) {
      return <Text variant="microcopy">Updating price…</Text>;
    }
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

  const productPricePreview = (
    line: QuoteLine | undefined,
    discount: number,
  ) => {
    if (previewLoading) {
      return <Text variant="microcopy">Updating price…</Text>;
    }
    if (!line) {
      return <Text variant="microcopy">Loading workbook base rate…</Text>;
    }
    if (line.volume === 0) {
      return (
        <Stack distance="flush">
          <Text>
            Base rate {rateCurrency(line.baseUnitRate)} / unit / month
          </Text>
          {line.productKey === "agent_email_thousands" && (
            <Text variant="microcopy">
              Email volume is entered in thousands. Tier rates adjust
              automatically as volume, term, payment schedule, or discount
              changes.
            </Text>
          )}
        </Stack>
      );
    }
    return (
      <Stack distance="flush">
        <Text variant="microcopy">
          List {rateCurrency(line.displayListUnitRate)} per unit per month •{" "}
          {percent(discount)} discount saves{" "}
          {rateCurrency(
            line.displayListUnitRate - line.displayProposedUnitRate,
          )}{" "}
          • Proposed {rateCurrency(line.displayProposedUnitRate)} per unit per
          month
        </Text>
        <Text variant="microcopy">
          List {currency(line.listTermCommitment)} Total Contract Value •{" "}
          {percent(discount)} discount saves{" "}
          {currency(line.listTermCommitment - line.termCommitment)} • Proposed{" "}
          {currency(line.termCommitment)} Total Contract Value
        </Text>
      </Stack>
    );
  };

  const productTable = (tableProducts: typeof products) => (
    <Table bordered density="condensed" flush>
      <TableHead>
        <TableRow>
          <TableHeader width={340}>Product</TableHeader>
          <TableHeader width={320}>Monthly commitment</TableHeader>
          <TableHeader width={280}>Discount</TableHeader>
          <TableHeader width="max">Live price preview</TableHeader>
        </TableRow>
      </TableHead>
      <TableBody>
        {tableProducts.map((product) => (
          <Fragment key={product.key}>
            <TableRow>
              <TableCell>
                <Stack distance="flush">
                  <Text>{product.label}</Text>
                  <Text variant="microcopy">{product.description}</Text>
                </Stack>
              </TableCell>
              <TableCell>
                <NumberInput
                  label="Monthly commitment"
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
              <TableCell>
                <NumberInput
                  label="Discount"
                  name={`${product.key}_discount`}
                  value={
                    (option.input.productDiscounts?.[product.key] || 0) * 100
                  }
                  min={0}
                  max={100}
                  precision={2}
                  formatStyle="percentage"
                  tooltip="Optional. Enter the approved discretionary discount for this product."
                  onChange={(value) =>
                    onInputChange("productDiscounts", {
                      ...(option.input.productDiscounts ||
                        emptyProductDiscounts()),
                      [product.key]: (value || 0) / 100,
                    })
                  }
                />
              </TableCell>
              <TableCell>
                {productPricePreview(
                  previewResult?.lines.find(
                    ({ productKey }) => productKey === product.key,
                  ),
                  option.input.productDiscounts?.[product.key] || 0,
                )}
              </TableCell>
            </TableRow>
          </Fragment>
        ))}
      </TableBody>
    </Table>
  );

  return (
    <Stack distance="md">
      <Flex justify="between" align="center" wrap>
        <Box>
          <Flex gap="sm" align="center" wrap>
            <Heading>{option.id ? option.name : "New Quote Option"}</Heading>
            <StatusTag variant="info">
              Step {step + 1} of {editorSteps.length}
            </StatusTag>
          </Flex>
          <Text variant="microcopy">{editorSteps[step]}</Text>
        </Box>
        <Button onClick={onBack} disabled={saving}>
          Save for Later / Exit
        </Button>
      </Flex>

      <Flex gap="xs" wrap>
        {editorSteps.map((label, index) => (
          <Button
            key={label}
            size="xs"
            variant={index === step ? "primary" : "secondary"}
            onClick={() => setStep(index)}
            disabled={saving}
          >
            {index + 1}. {label}
          </Button>
        ))}
      </Flex>

      <Card>
        <Stack distance="sm">
          {step === 0 && (
            <>
              <Box>
                <Heading>Contract Basics</Heading>
                <Text variant="microcopy">
                  Name the scenario and enter the customer’s proposed contract
                  terms.
                </Text>
              </Box>
              <AutoGrid columnWidth={155} flexible gap="sm">
                <Input
                  label="Option Name"
                  name="option_name"
                  value={option.name}
                  required
                  onChange={(name) => onOptionChange({ ...option, name })}
                />
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
                  onChange={(value) =>
                    onInputChange("termMonths", Number(value))
                  }
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
              </AutoGrid>
              {!canContinue && (
                <Alert title="Complete the required fields" variant="warning">
                  Add an option name and subscription start date to continue.
                </Alert>
              )}
            </>
          )}

          {step === 1 && (
            <>
              <Box>
                <Heading>Monthly Product Commitments</Heading>
                <Text variant="microcopy">
                  Enter committed monthly usage. Discounts are optional, entered
                  manually, and determine the required approval level.
                </Text>
              </Box>
              {productTable(products)}
              {committedProductCount === 0 && (
                <Alert title="Add at least one commitment" variant="warning">
                  A quote option needs committed usage for at least one product.
                </Alert>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <Box>
                <Heading>Services and Pricing</Heading>
                <Text variant="microcopy">
                  Choose support, onboarding, optional services, and any
                  requested discount.
                </Text>
              </Box>
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
              <Accordion title="Add-ons and professional services (optional)">
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
              </Accordion>
            </>
          )}

          {step === 3 && (
            <>
              <Box>
                <Heading>Renewal and Contract Terms</Heading>
                <Text variant="microcopy">
                  Standard terms automatically renew for 12 months. Non-renewal
                  notice must be provided at least 60 days before the
                  subscription end date.
                </Text>
              </Box>
              <Checkbox
                name="non_renewal"
                checked={!option.input.autoRenewal}
                onChange={(checked) => onInputChange("autoRenewal", !checked)}
              >
                Non-renewal
              </Checkbox>
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
          )}

          {step === 4 && (
            <>
              <Box>
                <Heading>Review and Calculate</Heading>
                <Text variant="microcopy">
                  Confirm the scenario below. Calculation applies the approved
                  rate card and approval rules.
                </Text>
              </Box>
              {option.result && (
                <Alert title="Pricing calculated" variant="success">
                  ARR {currency(option.result.committedArr)} · TCV{" "}
                  {currency(option.result.tcv)} · Approval{" "}
                  {approvalLabel(option.result.approvalTierRequired)}
                </Alert>
              )}
              <AutoGrid columnWidth={185} flexible gap="sm">
                <Text>Option: {option.name}</Text>
                <Text>Start Date: {option.input.startDate || "Missing"}</Text>
                <Text>Initial Term: {option.input.termMonths} months</Text>
                <Text>Payment: {paymentLabel}</Text>
                <Text>Support: {supportLabel}</Text>
                <Text>Onboarding: {onboardingLabel}</Text>
                <Text>Committed Products: {committedProductCount}</Text>
                <Text>
                  Renewal:{" "}
                  {option.input.autoRenewal
                    ? "12-month automatic renewal · 60-day notice"
                    : "Non-renewal · 60-day notice"}
                </Text>
              </AutoGrid>
              <LoadingButton
                variant="primary"
                loading={saving}
                onClick={onCalculate}
                disabled={!canContinue || committedProductCount === 0}
              >
                {option.id
                  ? "Recalculate and Save"
                  : "Calculate and Save Option"}
              </LoadingButton>
            </>
          )}
        </Stack>
      </Card>

      <Flex justify="between" align="center" wrap>
        <Button
          onClick={() => (step === 0 ? onBack() : setStep(step - 1))}
          disabled={saving}
        >
          {step === 0 ? "Cancel" : "Back"}
        </Button>
        {step < editorSteps.length - 1 && (
          <Button
            variant="primary"
            onClick={() => setStep(step + 1)}
            disabled={saving || !canContinue || !canReview}
          >
            Continue
          </Button>
        )}
        {step === editorSteps.length - 1 &&
          option.id &&
          option.result &&
          option.result.blockingReasons.length === 0 && (
            <Button onClick={() => onChoose(option)} disabled={saving}>
              Select as Customer Choice
            </Button>
          )}
      </Flex>

      {previewResult && (
        <ResultSummary
          result={previewResult}
          title="Live Pricing Summary"
          updating={previewLoading}
        />
      )}
    </Stack>
  );
};

const ResultSummary = ({
  result,
  title = "Quote Summary",
  updating = false,
}: {
  result: QuoteResult;
  title?: string;
  updating?: boolean;
}) => (
  <Stack distance="md">
    {result.blockingReasons.length > 0 && (
      <Alert title="This option cannot proceed" variant="error">
        {result.approvalReasons.join(" ")}
      </Alert>
    )}
    <Card>
      <Stack distance="md">
        <Flex justify="between" align="center" wrap>
          <Box>
            <Heading>{title}</Heading>
            <Text variant="microcopy">
              {updating
                ? "Updating prices…"
                : "Prices include the current term, payment schedule, and line discounts."}
            </Text>
          </Box>
          <Flex gap="xs" align="center">
            {updating && <LoadingSpinner label="Updating live prices" />}
            <StatusTag
              variant={result.blockingReasons.length ? "danger" : "info"}
            >
              {approvalLabel(result.approvalTierRequired)}
            </StatusTag>
          </Flex>
        </Flex>
        <DescriptionList direction="row">
          <DescriptionListItem label="Pre-Approved Term Discount">
            {percent(result.termDiscount)}
          </DescriptionListItem>
          <DescriptionListItem label="Payment Frequency Adjustment">
            {percent(result.paymentPremium)}
          </DescriptionListItem>
          <DescriptionListItem label="Annual Subscription Commitment">
            {currency(result.proposedPlatformArr)}
          </DescriptionListItem>
          <DescriptionListItem label="Recurring Amount per Billing Period">
            {currency(result.recurringPerPeriod)}
          </DescriptionListItem>
          <DescriptionListItem label="Annual Recurring Revenue">
            {currency(result.committedArr)}
          </DescriptionListItem>
          <DescriptionListItem label="One-Time Fees">
            {currency(result.oneTime)}
          </DescriptionListItem>
          <DescriptionListItem label="Total Contract Value">
            {currency(result.tcv)}
          </DescriptionListItem>
          <DescriptionListItem label="Highest Line Discount">
            {percent(result.largestDiscretionaryDiscount)}
          </DescriptionListItem>
          <DescriptionListItem label="Approval Required From">
            {approvalLabel(result.approvalTierRequired)}
          </DescriptionListItem>
        </DescriptionList>
      </Stack>
    </Card>

    <Accordion title="Product Rate Schedule">
      <Table density="condensed">
        <TableHead>
          <TableRow>
            <TableHeader>Product</TableHeader>
            <TableHeader>Unit</TableHeader>
            <TableHeader align="right">Volume / mo.</TableHeader>
            <TableHeader align="right">List Rate</TableHeader>
            <TableHeader align="right">Discount</TableHeader>
            <TableHeader align="right">Proposed Rate</TableHeader>
            <TableHeader align="right">Savings / Term</TableHeader>
            <TableHeader align="right">Fees / Term</TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          {result.lines.map((line) => (
            <TableRow key={line.productKey}>
              <TableCell>{line.productName}</TableCell>
              <TableCell>{line.unitOfMeasure}</TableCell>
              <TableCell align="right">
                {line.volume.toLocaleString()}
              </TableCell>
              <TableCell align="right">
                {rateCurrency(line.displayListUnitRate)}
              </TableCell>
              <TableCell align="right">
                {percent(line.discretionaryDiscount)}
              </TableCell>
              <TableCell align="right">
                {rateCurrency(line.displayProposedUnitRate)}
              </TableCell>
              <TableCell align="right">
                {currency(line.listTermCommitment - line.termCommitment)}
              </TableCell>
              <TableCell align="right">
                {currency(line.termCommitment)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Accordion>

    <Accordion title="Services, Add-ons, and One-Time Fees">
      <Table density="condensed">
        <TableHead>
          <TableRow>
            <TableHeader>Charge</TableHeader>
            <TableHeader>Frequency</TableHeader>
            <TableHeader align="right">List Price</TableHeader>
            <TableHeader align="right">Savings</TableHeader>
            <TableHeader align="right">Proposed Price</TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          <TableRow>
            <TableCell>Subscription Support</TableCell>
            <TableCell>Annual</TableCell>
            <TableCell align="right">
              {currency(result.listSupportAnnual)}
            </TableCell>
            <TableCell align="right">
              {currency(result.listSupportAnnual - result.supportAnnual)}
            </TableCell>
            <TableCell align="right">
              {currency(result.supportAnnual)}
            </TableCell>
          </TableRow>
          {result.selectedAddOns.map((addOn) => (
            <TableRow key={addOn.key}>
              <TableCell>{addOn.label}</TableCell>
              <TableCell>Annual</TableCell>
              <TableCell align="right">
                {currency(addOn.listAnnualAmount)}
              </TableCell>
              <TableCell align="right">
                {currency(addOn.listAnnualAmount - addOn.annualAmount)}
              </TableCell>
              <TableCell align="right">
                {currency(addOn.annualAmount)}
              </TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell>Onboarding</TableCell>
            <TableCell>One-time</TableCell>
            <TableCell align="right">
              {currency(result.listOnboardingAmount)}
            </TableCell>
            <TableCell align="right">
              {currency(result.listOnboardingAmount - result.onboardingAmount)}
            </TableCell>
            <TableCell align="right">
              {currency(result.onboardingAmount)}
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Professional Services</TableCell>
            <TableCell>One-time</TableCell>
            <TableCell align="right">
              {currency(result.listProfessionalServicesAmount)}
            </TableCell>
            <TableCell align="right">
              {currency(
                result.listProfessionalServicesAmount -
                  result.professionalServicesAmount,
              )}
            </TableCell>
            <TableCell align="right">
              {currency(result.professionalServicesAmount)}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Accordion>

    <Accordion title="Contract Summary">
      <Table density="condensed">
        <TableHead>
          <TableRow>
            <TableHeader>Measure</TableHeader>
            <TableHeader align="right">List</TableHeader>
            <TableHeader align="right">Savings</TableHeader>
            <TableHeader align="right">Proposed</TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          <TableRow>
            <TableCell>Subscription Drawdown / Year</TableCell>
            <TableCell align="right">
              {currency(result.listPlatformArr)}
            </TableCell>
            <TableCell align="right">
              {currency(result.listPlatformArr - result.proposedPlatformArr)}
            </TableCell>
            <TableCell align="right">
              {currency(result.proposedPlatformArr)}
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Total Recurring Fees / Year</TableCell>
            <TableCell align="right">
              {currency(result.listCommittedArr)}
            </TableCell>
            <TableCell align="right">
              {currency(result.listCommittedArr - result.committedArr)}
            </TableCell>
            <TableCell align="right">{currency(result.committedArr)}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>One-Time Fees</TableCell>
            <TableCell align="right">{currency(result.listOneTime)}</TableCell>
            <TableCell align="right">
              {currency(result.listOneTime - result.oneTime)}
            </TableCell>
            <TableCell align="right">{currency(result.oneTime)}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Total Contract Value</TableCell>
            <TableCell align="right">{currency(result.listTcv)}</TableCell>
            <TableCell align="right">
              {currency(result.listTcv - result.tcv)}
            </TableCell>
            <TableCell align="right">{currency(result.tcv)}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Accordion>

    <Accordion title="Contract and Renewal Dates">
      <DescriptionList direction="row">
        <DescriptionListItem label="Contract Start">
          {result.dates.contractStartDate || "Not set"}
        </DescriptionListItem>
        <DescriptionListItem label="Contract End">
          {result.dates.contractEndDate || "Not set"}
        </DescriptionListItem>
        <DescriptionListItem label="First Renewal Date">
          {result.dates.renewalDate || "Does not automatically renew"}
        </DescriptionListItem>
        <DescriptionListItem label="Non-Renewal Notice Deadline">
          {result.dates.nonRenewalNoticeDate || "Not applicable"}
        </DescriptionListItem>
      </DescriptionList>
    </Accordion>
  </Stack>
);

const Comparison = ({
  options,
  selectedOptionId,
  saving,
  onBack,
  onEdit,
  onChoose,
}: {
  options: QuoteOption[];
  selectedOptionId: string | null;
  saving: boolean;
  onBack: () => void;
  onEdit: (option: QuoteOption) => void;
  onChoose: (option: QuoteOption) => void;
}) => {
  const comparisonRows = useMemo(
    () => [
      {
        label: "Contract Term",
        value: (option: QuoteOption) => `${option.input.termMonths} months`,
      },
      {
        label: "Billing Frequency",
        value: (option: QuoteOption) =>
          paymentOptions.find(
            ({ value }) => value === option.input.paymentFrequency,
          )?.label || "",
      },
      {
        label: "Committed Products",
        value: (option: QuoteOption) =>
          String(option.result?.quotedProducts.length || 0),
      },
      {
        label: "Annual Drawdown",
        value: (option: QuoteOption) =>
          currency(option.result?.proposedPlatformArr),
      },
      {
        label: "ARR",
        value: (option: QuoteOption) => currency(option.result?.committedArr),
      },
      {
        label: "Per Billing Period",
        value: (option: QuoteOption) =>
          currency(option.result?.recurringPerPeriod),
      },
      {
        label: "One-Time Fees",
        value: (option: QuoteOption) => currency(option.result?.oneTime),
      },
      {
        label: "TCV",
        value: (option: QuoteOption) => currency(option.result?.tcv),
      },
      {
        label: "Highest Discount",
        value: (option: QuoteOption) =>
          percent(option.result?.largestDiscretionaryDiscount),
      },
      {
        label: "Approval",
        value: (option: QuoteOption) =>
          approvalLabel(option.result?.approvalTierRequired),
      },
    ],
    [],
  );

  return (
    <Stack distance="md">
      <Flex justify="between" align="center">
        <Heading>Compare Quote Options</Heading>
        <Button onClick={onBack}>Back to Options</Button>
      </Flex>
      <Table density="condensed">
        <TableHead>
          <TableRow>
            <TableHeader>Measure</TableHeader>
            {options.map((option) => (
              <TableHeader key={option.id || option.name}>
                {option.name}
              </TableHeader>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {comparisonRows.map((row) => (
            <TableRow key={row.label}>
              <TableCell>
                <Text format={{ fontWeight: "demibold" }}>{row.label}</Text>
              </TableCell>
              {options.map((option) => (
                <TableCell key={`${row.label}-${option.id}`}>
                  {row.value(option)}
                </TableCell>
              ))}
            </TableRow>
          ))}
          <TableRow>
            <TableCell>Actions</TableCell>
            {options.map((option) => (
              <TableCell key={`actions-${option.id}`}>
                <Stack distance="xs">
                  <Button
                    size="xs"
                    onClick={() => onEdit(option)}
                    disabled={saving}
                  >
                    Edit
                  </Button>
                  <Button
                    size="xs"
                    variant={
                      option.id === selectedOptionId ? "secondary" : "primary"
                    }
                    onClick={() => onChoose(option)}
                    disabled={
                      saving || (option.result?.blockingReasons.length || 0) > 0
                    }
                  >
                    {option.id === selectedOptionId
                      ? "Customer Choice"
                      : "Select This Option"}
                  </Button>
                </Stack>
              </TableCell>
            ))}
          </TableRow>
        </TableBody>
      </Table>
      <Divider />
      <Text variant="microcopy">
        Selecting an option updates the reportable quote fields on the Deal.
        Line items are not created until the selected option is approved.
      </Text>
    </Stack>
  );
};
