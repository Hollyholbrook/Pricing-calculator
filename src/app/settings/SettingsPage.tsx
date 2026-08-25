import { useEffect, useState } from "react";
import {
  Accordion,
  Alert,
  AutoGrid,
  Box,
  Button,
  Card,
  Checkbox,
  Flex,
  Heading,
  Input,
  LoadingButton,
  LoadingSpinner,
  MultiSelect,
  NumberInput,
  Select,
  Stack,
  StatusTag,
  Text,
  hubspot,
} from "@hubspot/ui-extensions";

interface PricingPolicy {
  calculationMethod: "excel_compatible" | "rounded_unit_rate";
  minimumCommittedArr: number;
  redliningMinimumArr: number;
  salesDirectorDiscountMax: number;
  headSalesDiscountMax: number;
  termDiscounts: Record<string, number>;
  paymentPremiums: Record<string, number>;
  support: Record<string, { percent: number; cap: number }>;
  onboardingAmounts: Record<string, number>;
  professionalServicesAmounts: number[];
  addOnAnnualAmounts: Record<string, number>;
  productBandRates: Record<string, number[]>;
}

interface AppSettings {
  schemaVersion: string;
  version: number;
  allowNewBusiness: boolean;
  allowRenewals: boolean;
  newBusinessPipelineIds: string[];
  renewalPipelineIds: string[];
  dealBundleProduct: { id: string; name: string; category: string };
  pricingPolicy: PricingPolicy;
}

interface SettingsBody {
  success: boolean;
  error?: string;
  errorCode?: string;
  details?: { field?: string };
  settings?: AppSettings;
  configured?: boolean;
  canEdit?: boolean;
  pipelines?: { id: string; label: string }[];
}

interface SettingsResult {
  body: SettingsBody;
}

const productRateSettings = [
  {
    key: "connect_ca",
    label: "Connect — CA",
    bands: [
      "0–500",
      "500–1K",
      "1K–2K",
      "2K–5K",
      "5K–10K",
      "10K–20K",
      "20K–50K",
      "50K–100K",
      "100K–200K",
      "200K–500K",
      "500K–1.1M",
      "1.1M+",
    ],
  },
  {
    key: "calendar_ca",
    label: "Calendar Only — CA",
    bands: [
      "0–500",
      "500–1K",
      "1K–2K",
      "2K–5K",
      "5K–10K",
      "10K–20K",
      "20K–50K",
      "50K–100K",
      "100K–200K",
      "200K–500K",
      "500K–1.1M",
      "1.1M+",
    ],
  },
  {
    key: "notetaker_bot_hours",
    label: "Notetaker — Bot Hour",
    bands: ["0–1K", "1K–2K", "2K–5K", "5K–10K", "10K+"],
  },
  { key: "agent_accounts", label: "Agent Accounts", bands: ["All Volume"] },
  {
    key: "agent_email_thousands",
    label: "Agent Email — 1K Emails",
    bands: ["0–50K", "50K–100K", "100K–500K", "500K+"],
  },
  {
    key: "agent_storage_gb",
    label: "Agent Storage — GB",
    bands: ["All Volume"],
  },
  {
    key: "agent_bandwidth_gb",
    label: "Agent Bandwidth — GB",
    bands: ["All Volume"],
  },
];

hubspot.extend<"settings">(() => <SettingsPage />);

const SettingsPage = () => {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [configured, setConfigured] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [pipelines, setPipelines] = useState<{ id: string; label: string }[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const request = async (parameters: Record<string, unknown>) => {
    const result = await hubspot.serverless<SettingsResult>(
      "nylas_pricing_quote_options",
      {
        parameters: parameters as unknown as never,
      },
    );
    if (!result.body.success)
      throw new Error(result.body.error || "The settings request failed.");
    return result.body;
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const body = await request({ action: "get_settings" });
      setSettings(body.settings || null);
      setConfigured(body.configured === true);
      setCanEdit(body.canEdit === true);
      setPipelines(body.pipelines || []);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not load settings.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Loading is intentionally tied to mounting the account settings surface.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const body = await request({
        action: "update_settings",
        expectedVersion: settings.version,
        settings,
      });
      if (body.settings) setSettings(body.settings);
      setConfigured(true);
      setNotice(
        "Pricing settings saved. Existing quote options must be recalculated before use.",
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not save settings.",
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingSpinner label="Loading pricing settings" />;

  if (!settings) {
    return (
      <Alert title="Pricing settings unavailable" variant="danger">
        {error || "Try again."}
      </Alert>
    );
  }

  const policy = settings.pricingPolicy;
  const setPolicy = (pricingPolicy: PricingPolicy) =>
    setSettings({ ...settings, pricingPolicy });
  const setPolicyNumber = (field: keyof PricingPolicy, value: number) =>
    setPolicy({ ...policy, [field]: value });
  const setNestedNumber = (
    group:
      | "termDiscounts"
      | "paymentPremiums"
      | "onboardingAmounts"
      | "addOnAnnualAmounts",
    key: string,
    value: number,
  ) => setPolicy({ ...policy, [group]: { ...policy[group], [key]: value } });
  const pipelineOptions = pipelines.map(({ id, label }) => ({
    value: id,
    label,
  }));

  return (
    <Stack distance="sm">
      <Flex justify="between" align="center" wrap>
        <Box>
          <Flex gap="sm" align="center" wrap>
            <Heading>Nylas Pricing Settings</Heading>
            <StatusTag variant={configured ? "success" : "warning"}>
              {configured ? `Rules v${settings.version}` : "Setup required"}
            </StatusTag>
          </Flex>
          <Text variant="microcopy">
            Account-wide eligibility, pricing adjustments, fees, and approval
            rules.
          </Text>
        </Box>
        <Flex gap="sm" align="center">
          <Button onClick={() => void load()} disabled={saving}>
            Reload
          </Button>
          {configured && (
            <LoadingButton
              variant="primary"
              loading={saving}
              disabled={!canEdit}
              onClick={save}
            >
              Save Changes
            </LoadingButton>
          )}
        </Flex>
      </Flex>

      {error && (
        <Alert title="Could not update pricing settings" variant="danger">
          {error}
        </Alert>
      )}
      {notice && (
        <Alert title="Settings updated" variant="success">
          {notice}
        </Alert>
      )}
      {!canEdit && (
        <Alert title="Read-only access" variant="info">
          Only authorized pricing administrators can change these rules.
        </Alert>
      )}
      {!configured && (
        <Alert title="Settings storage unavailable" variant="danger">
          Contact the Nylas Pricing app administrator to restore its
          configuration store.
        </Alert>
      )}

      <Card>
        <Stack distance="sm">
          <Heading>Deal Eligibility</Heading>
          <Flex gap="lg" wrap>
            <Checkbox
              name="allow_new_business"
              checked={settings.allowNewBusiness}
              readOnly={!canEdit}
              onChange={(checked) =>
                setSettings({ ...settings, allowNewBusiness: checked })
              }
            >
              Allow New Business
            </Checkbox>
            <Checkbox
              name="allow_renewals"
              checked={settings.allowRenewals}
              readOnly={!canEdit}
              onChange={(checked) =>
                setSettings({ ...settings, allowRenewals: checked })
              }
            >
              Allow Renewals
            </Checkbox>
          </Flex>
          <AutoGrid columnWidth={230} flexible gap="sm">
            <MultiSelect
              label="New Business Pipelines"
              name="new_business_pipelines"
              value={settings.newBusinessPipelineIds}
              options={pipelineOptions}
              readOnly={!canEdit}
              onChange={(value) =>
                setSettings({
                  ...settings,
                  newBusinessPipelineIds: value.map(String),
                })
              }
            />
            <MultiSelect
              label="Renewal Pipelines"
              name="renewal_pipelines"
              value={settings.renewalPipelineIds}
              options={pipelineOptions}
              readOnly={!canEdit}
              onChange={(value) =>
                setSettings({
                  ...settings,
                  renewalPipelineIds: value.map(String),
                })
              }
            />
          </AutoGrid>
          {settings.allowRenewals &&
            settings.renewalPipelineIds.length === 0 && (
              <Text variant="microcopy">
                Renewal is enabled. Choose renewal pipelines or the Deal type
                must be Renewal.
              </Text>
            )}
        </Stack>
      </Card>

      <Accordion title="Deal Line Item Package" defaultOpen>
        <Stack distance="sm">
          <Text variant="microcopy">
            Choose the HubSpot product used for the bundled Deal line item.
            Copy the numeric product record ID from the HubSpot product URL.
          </Text>
          <AutoGrid columnWidth={220} flexible gap="sm">
            <Input
              label="HubSpot Product ID"
              name="deal_bundle_product_id"
              value={settings.dealBundleProduct.id}
              readOnly={!canEdit}
              onChange={(id) =>
                setSettings({
                  ...settings,
                  dealBundleProduct: { ...settings.dealBundleProduct, id },
                })
              }
            />
            <Input
              label="Line Item Name"
              name="deal_bundle_product_name"
              value={settings.dealBundleProduct.name}
              readOnly={!canEdit}
              onChange={(name) =>
                setSettings({
                  ...settings,
                  dealBundleProduct: { ...settings.dealBundleProduct, name },
                })
              }
            />
            <Input
              label="Product Category"
              name="deal_bundle_product_category"
              value={settings.dealBundleProduct.category}
              readOnly={!canEdit}
              onChange={(category) =>
                setSettings({
                  ...settings,
                  dealBundleProduct: { ...settings.dealBundleProduct, category },
                })
              }
            />
          </AutoGrid>
        </Stack>
      </Accordion>

      <Accordion title="Approval and Contract Guardrails" defaultOpen>
        <AutoGrid columnWidth={175} flexible gap="sm">
          <Money
            label="Enterprise Recurring Minimum"
            name="minimum_arr"
            value={policy.minimumCommittedArr}
            disabled={!canEdit}
            onChange={(value) => setPolicyNumber("minimumCommittedArr", value)}
          />
          <Money
            label="ARR to Allow Redlining"
            name="redlining_arr"
            value={policy.redliningMinimumArr}
            disabled={!canEdit}
            onChange={(value) => setPolicyNumber("redliningMinimumArr", value)}
          />
          <Percent
            label="Sales Director Max"
            name="director_max"
            value={policy.salesDirectorDiscountMax}
            disabled={!canEdit}
            onChange={(value) =>
              setPolicyNumber("salesDirectorDiscountMax", value)
            }
          />
          <Percent
            label="Head of Sales Max"
            name="head_sales_max"
            value={policy.headSalesDiscountMax}
            disabled={!canEdit}
            onChange={(value) => setPolicyNumber("headSalesDiscountMax", value)}
          />
        </AutoGrid>
      </Accordion>

      <Accordion title="Product Volume Rate Card">
        <Stack distance="sm">
          <Text variant="microcopy">
            Edit marginal monthly unit rates. Volume-band boundaries remain
            fixed to prevent overlapping or missing tiers.
          </Text>
          {productRateSettings.map((product) => (
            <Accordion key={product.key} title={product.label}>
              <AutoGrid columnWidth={115} flexible gap="sm">
                {product.bands.map((band, index) => (
                  <Rate
                    key={band}
                    label={band}
                    name={`${product.key}_${index}`}
                    value={policy.productBandRates[product.key]?.[index] || 0}
                    disabled={!canEdit}
                    onChange={(value) => {
                      const rates = [
                        ...(policy.productBandRates[product.key] || []),
                      ];
                      rates[index] = value;
                      setPolicy({
                        ...policy,
                        productBandRates: {
                          ...policy.productBandRates,
                          [product.key]: rates,
                        },
                      });
                    }}
                  />
                ))}
              </AutoGrid>
            </Accordion>
          ))}
        </Stack>
      </Accordion>

      <Accordion title="Term and Payment Adjustments">
        <Stack distance="sm">
          <Text variant="microcopy">
            Positive term values are discounts. Positive payment values are
            cost-of-money premiums.
          </Text>
          <Select
            label="Calculation Method"
            name="calculation_method"
            value={policy.calculationMethod}
            options={[
              {
                value: "excel_compatible",
                label: "Excel-Compatible — Preserve Precision",
              },
              {
                value: "rounded_unit_rate",
                label: "Rounded Unit Rate — Simplified",
              },
            ]}
            readOnly={!canEdit}
            onChange={(value) =>
              setPolicy({
                ...policy,
                calculationMethod: String(
                  value,
                ) as PricingPolicy["calculationMethod"],
              })
            }
          />
          <Text variant="microcopy">
            Excel-compatible preserves hidden precision for commitments and uses
            term discount plus payment premium additively. Displayed customer
            rates remain rounded to two decimals.
          </Text>
          <AutoGrid columnWidth={150} flexible gap="sm">
            {["12", "24", "36"].map((key) => (
              <Percent
                key={key}
                label={`${key}-Month Discount`}
                name={`term_${key}`}
                value={policy.termDiscounts[key]}
                disabled={!canEdit}
                onChange={(value) =>
                  setNestedNumber("termDiscounts", key, value)
                }
              />
            ))}
            <Percent
              label="Annual Premium"
              name="pay_annual"
              value={policy.paymentPremiums.annual_in_advance}
              disabled={!canEdit}
              onChange={(value) =>
                setNestedNumber("paymentPremiums", "annual_in_advance", value)
              }
            />
            <Percent
              label="Semi-Annual Premium"
              name="pay_semi"
              value={policy.paymentPremiums.semi_annual_in_advance}
              disabled={!canEdit}
              onChange={(value) =>
                setNestedNumber(
                  "paymentPremiums",
                  "semi_annual_in_advance",
                  value,
                )
              }
            />
            <Percent
              label="Quarterly Premium"
              name="pay_quarterly"
              value={policy.paymentPremiums.quarterly_in_advance}
              disabled={!canEdit}
              onChange={(value) =>
                setNestedNumber(
                  "paymentPremiums",
                  "quarterly_in_advance",
                  value,
                )
              }
            />
            <Percent
              label="Monthly Premium"
              name="pay_monthly"
              value={policy.paymentPremiums.monthly_in_advance}
              disabled={!canEdit}
              onChange={(value) =>
                setNestedNumber("paymentPremiums", "monthly_in_advance", value)
              }
            />
          </AutoGrid>
        </Stack>
      </Accordion>

      <Accordion title="Support and Fixed Fees">
        <Stack distance="sm">
          <AutoGrid columnWidth={160} flexible gap="sm">
            {(["full", "premium"] as const).map((key) => (
              <Percent
                key={`${key}_percent`}
                label={`${key === "full" ? "Full" : "Premium"} Support %`}
                name={`${key}_support_percent`}
                value={policy.support[key].percent}
                disabled={!canEdit}
                onChange={(value) =>
                  setPolicy({
                    ...policy,
                    support: {
                      ...policy.support,
                      [key]: { ...policy.support[key], percent: value },
                    },
                  })
                }
              />
            ))}
            {(["full", "premium"] as const).map((key) => (
              <Money
                key={`${key}_cap`}
                label={`${key === "full" ? "Full" : "Premium"} Support Cap`}
                name={`${key}_support_cap`}
                value={policy.support[key].cap}
                disabled={!canEdit}
                onChange={(value) =>
                  setPolicy({
                    ...policy,
                    support: {
                      ...policy.support,
                      [key]: { ...policy.support[key], cap: value },
                    },
                  })
                }
              />
            ))}
          </AutoGrid>
          <Heading>Onboarding and Add-ons</Heading>
          <AutoGrid columnWidth={155} flexible gap="sm">
            <Money
              label="Quick Launch"
              name="onboarding_quick"
              value={policy.onboardingAmounts.quick_launch}
              disabled={!canEdit}
              onChange={(value) =>
                setNestedNumber("onboardingAmounts", "quick_launch", value)
              }
            />
            <Money
              label="Quick Launch Plus"
              name="onboarding_plus"
              value={policy.onboardingAmounts.quick_launch_plus}
              disabled={!canEdit}
              onChange={(value) =>
                setNestedNumber("onboardingAmounts", "quick_launch_plus", value)
              }
            />
            <Money
              label="Strategic"
              name="onboarding_strategic"
              value={policy.onboardingAmounts.strategic}
              disabled={!canEdit}
              onChange={(value) =>
                setNestedNumber("onboardingAmounts", "strategic", value)
              }
            />
            <Money
              label="Enterprise Accelerator / Yr"
              name="addon_accelerator"
              value={policy.addOnAnnualAmounts.enterprise_accelerator}
              disabled={!canEdit}
              onChange={(value) =>
                setNestedNumber(
                  "addOnAnnualAmounts",
                  "enterprise_accelerator",
                  value,
                )
              }
            />
            <Money
              label="Privacy Filter / Yr"
              name="addon_privacy"
              value={policy.addOnAnnualAmounts.privacy_filter}
              disabled={!canEdit}
              onChange={(value) =>
                setNestedNumber("addOnAnnualAmounts", "privacy_filter", value)
              }
            />
            <Money
              label="Verified OAuth / Yr"
              name="addon_oauth"
              value={policy.addOnAnnualAmounts.verified_oauth}
              disabled={!canEdit}
              onChange={(value) =>
                setNestedNumber("addOnAnnualAmounts", "verified_oauth", value)
              }
            />
          </AutoGrid>
          <Heading>Professional Services Bundle Prices</Heading>
          <AutoGrid columnWidth={135} flexible gap="sm">
            {policy.professionalServicesAmounts
              .slice(1)
              .map((amount, offset) => {
                const count = offset + 1;
                return (
                  <Money
                    key={count}
                    label={`${count} Item${count === 1 ? "" : "s"}`}
                    name={`ps_${count}`}
                    value={amount}
                    disabled={!canEdit}
                    onChange={(value) => {
                      const amounts = [...policy.professionalServicesAmounts];
                      amounts[count] = value;
                      setPolicy({
                        ...policy,
                        professionalServicesAmounts: amounts,
                      });
                    }}
                  />
                );
              })}
          </AutoGrid>
        </Stack>
      </Accordion>

      <Alert title="Version-controlled calculations" variant="info">
        Saving any setting creates a new rules version. Existing quote options
        must be recalculated before selection, line-item sync, or quote
        generation.
      </Alert>
    </Stack>
  );
};

const Money = ({
  label,
  name,
  value,
  disabled,
  onChange,
}: {
  label: string;
  name: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) => (
  <NumberInput
    label={label}
    name={name}
    value={value}
    min={0}
    max={1_000_000_000}
    precision={2}
    readOnly={disabled}
    onChange={(next) => onChange(next || 0)}
  />
);

const Percent = ({
  label,
  name,
  value,
  disabled,
  onChange,
}: {
  label: string;
  name: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) => (
  <NumberInput
    label={label}
    name={name}
    value={value * 100}
    min={0}
    max={100}
    precision={2}
    formatStyle="percentage"
    readOnly={disabled}
    onChange={(next) => onChange((next || 0) / 100)}
  />
);

const Rate = ({
  label,
  name,
  value,
  disabled,
  onChange,
}: {
  label: string;
  name: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) => (
  <NumberInput
    label={label}
    name={name}
    value={value}
    min={0}
    max={1_000_000}
    precision={4}
    readOnly={disabled}
    onChange={(next) => onChange(next || 0)}
  />
);
