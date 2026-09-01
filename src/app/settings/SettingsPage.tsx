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

interface CatalogEntry {
  enabled: boolean;
  order: number;
  name: string;
  description: string;
  productId: string;
}

interface ProductCatalogEntry extends CatalogEntry {
  section: string;
  inputUnit: string;
}

interface CatalogConfiguration {
  products: Record<string, ProductCatalogEntry>;
  options: {
    support: Record<string, CatalogEntry>;
    onboarding: Record<string, CatalogEntry>;
    addOns: Record<string, CatalogEntry>;
    professionalServices: Record<string, CatalogEntry>;
  };
  contractTerms: Record<
    string,
    { enabled: boolean; order: number; label: string }
  >;
  paymentOptions: Record<
    string,
    { enabled: boolean; order: number; label: string }
  >;
  hubspotMappings: {
    products: Record<string, string>;
    dealProperties: Record<string, string>;
    lineItemProperties: Record<string, string>;
  };
}

interface PricingPolicy {
  calculationMethod: "excel_compatible" | "rounded_unit_rate";
  minimumCommittedArr: number;
  enforceMinimumCommittedArr: boolean;
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

// The three documents the app can print. Not the same axis as the deal category: a renewal
// pipeline resolves to the renewal CATEGORY, and the rep then chooses which of its two KINDS the
// quote is. Keyed by kind here because that is what picks a template.
type QuoteKind = "new_business" | "change" | "renewal";

const QUOTE_KINDS: { kind: QuoteKind; label: string; note: string }[] = [
  {
    kind: "new_business",
    label: "New Business",
    note: "Offered on Deals in a new business pipeline.",
  },
  {
    kind: "change",
    label: "Change",
    note: "Offered on renewal pipelines when the rep is quoting a change.",
  },
  {
    kind: "renewal",
    label: "Renewal",
    note: "Offered on renewal pipelines when the rep is quoting a renewal.",
  },
];

interface AppSettings {
  schemaVersion: string;
  version: number;
  allowNewBusiness: boolean;
  allowRenewals: boolean;
  newBusinessPipelineIds: string[];
  renewalPipelineIds: string[];
  quoteTemplatesByKind: Record<
    QuoteKind,
    { enabledIds: string[]; defaultId: string }
  >;
  // Derived server-side from the new business kind and never edited here. They exist so code
  // predating quoteTemplatesByKind still finds the flat shape it expects after a rollback.
  enabledQuoteTemplateIds: string[];
  defaultQuoteTemplateId: string;
  pricingPolicy: PricingPolicy;
  catalogConfiguration: CatalogConfiguration;
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
  quoteTemplates?: { id: string; name: string }[];
  productRates?: ProductRateDescriptor[];
}

interface SettingsResult {
  body: SettingsBody;
}

// The product rows come from the SERVER, derived from pricingRules -- see productRateDescriptors.
//
// This file used to carry its own copy: seven product keys, seven labels, and every band boundary
// spelled out ("0-500", "500-1K", ...). It happened to match, but nothing kept it matching, and a
// band moved in pricingRules would have left the screen labelling the wrong boundary over the
// right input. Holly, 2026-08-31: nothing hardcoded outside the settings and the product
// information itself.
interface ProductRateDescriptor {
  key: string;
  label: string;
  bands: string[];
}

hubspot.extend<"settings">(() => <SettingsPage />);

const SettingsPage = () => {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [configured, setConfigured] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [quoteTemplates, setQuoteTemplates] = useState<
    { id: string; name: string }[]
  >([]);
  const [pipelines, setPipelines] = useState<{ id: string; label: string }[]>(
    [],
  );
  const [productRates, setProductRates] = useState<ProductRateDescriptor[]>([]);
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
      setQuoteTemplates(body.quoteTemplates || []);
      setProductRates(body.productRates || []);
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
  const catalog = settings.catalogConfiguration;
  const setCatalog = (catalogConfiguration: CatalogConfiguration) =>
    setSettings({ ...settings, catalogConfiguration });
  const setProductCatalogEntry = (
    key: string,
    patch: Partial<ProductCatalogEntry>,
  ) =>
    setCatalog({
      ...catalog,
      products: {
        ...catalog.products,
        [key]: { ...catalog.products[key], ...patch },
      },
    });
  const setOptionCatalogEntry = (
    group: keyof CatalogConfiguration["options"],
    key: string,
    patch: Partial<CatalogEntry>,
  ) =>
    setCatalog({
      ...catalog,
      options: {
        ...catalog.options,
        [group]: {
          ...catalog.options[group],
          [key]: { ...catalog.options[group][key], ...patch },
        },
      },
    });
  const pipelineOptions = pipelines.map(({ id, label }) => ({
    value: id,
    label,
  }));
  const templateOptions = quoteTemplates.map(({ id, name }) => ({
    value: id,
    label: name,
  }));
  // An empty choice means "offer every template", so the default may legitimately be one that is
  // not in the chosen list. Once a narrowing exists, the default has to be inside it or the card
  // would preselect something the picker will not show. Per kind, since each kind narrows
  // separately.
  const forKind = (kind: QuoteKind) => settings.quoteTemplatesByKind[kind];
  const setKind = (
    kind: QuoteKind,
    patch: Partial<{ enabledIds: string[]; defaultId: string }>,
  ) =>
    setSettings({
      ...settings,
      quoteTemplatesByKind: {
        ...settings.quoteTemplatesByKind,
        [kind]: { ...settings.quoteTemplatesByKind[kind], ...patch },
      },
    });
  const offeredTemplateOptionsFor = (kind: QuoteKind) =>
    forKind(kind).enabledIds.length === 0
      ? templateOptions
      : templateOptions.filter(({ value }) =>
          forKind(kind).enabledIds.includes(value),
        );
  const defaultOutsideChoiceFor = (kind: QuoteKind) =>
    forKind(kind).defaultId !== "" &&
    forKind(kind).enabledIds.length > 0 &&
    !forKind(kind).enabledIds.includes(forKind(kind).defaultId);

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

      <Card>
        <Stack distance="sm">
          <Heading>Quote Templates</Heading>
          <Text variant="microcopy">
            Which templates the pricing card offers, and which one it
            preselects, for each kind of quote. Leave a list empty to offer
            every template in the portal for that kind.
          </Text>
          {QUOTE_KINDS.map(({ kind, label, note }) => (
            <Stack distance="sm" key={kind}>
              <Text format={{ fontWeight: "bold" }}>{label}</Text>
              <Text variant="microcopy">{note}</Text>
              <AutoGrid columnWidth={230} flexible gap="sm">
                <MultiSelect
                  label="Templates Reps Can Choose"
                  name={`enabled_quote_templates_${kind}`}
                  value={forKind(kind).enabledIds}
                  options={templateOptions}
                  readOnly={!canEdit}
                  onChange={(value) =>
                    setKind(kind, { enabledIds: value.map(String) })
                  }
                />
                <Select
                  label="Default Template"
                  name={`default_quote_template_${kind}`}
                  value={forKind(kind).defaultId}
                  options={[
                    { value: "", label: "Use the configured secret" },
                    ...offeredTemplateOptionsFor(kind),
                  ]}
                  readOnly={!canEdit}
                  onChange={(value) =>
                    setKind(kind, { defaultId: String(value ?? "") })
                  }
                />
              </AutoGrid>
              {defaultOutsideChoiceFor(kind) && (
                <Text variant="microcopy" format={{ fontWeight: "bold" }}>
                  The default {label.toLowerCase()} template is not one reps can
                  choose. Add it to the list above, or pick a different default.
                </Text>
              )}
            </Stack>
          ))}
          {quoteTemplates.length === 0 && (
            <Text variant="microcopy">
              No quote templates could be listed for this portal. The card will
              fall back to the configured QUOTE_TEMPLATE_ID secret.
            </Text>
          )}
          {!settings.allowRenewals && (
            <Text variant="microcopy">
              Renewals are turned off, so the Change and Renewal templates are
              not offered to anyone yet. They are kept here so they can be set
              up before renewals are switched on.
            </Text>
          )}
        </Stack>
      </Card>

      <Accordion title="Approval and Contract Guardrails" defaultOpen>
        <Stack>
          <Checkbox
            name="enforce_minimum_arr"
            checked={policy.enforceMinimumCommittedArr}
            readOnly={!canEdit}
            onChange={(checked) =>
              setPolicy({ ...policy, enforceMinimumCommittedArr: checked })
            }
          >
            Enforce the Enterprise Recurring Minimum
          </Checkbox>
          <Text variant="microcopy">
            {policy.enforceMinimumCommittedArr
              ? "A deal below the minimum escalates to Finance and cannot be locked in."
              : "Off. Committed ARR below the minimum neither escalates nor blocks Lock in. The ARR to Allow Special Terms threshold is separate and still applies."}
          </Text>
        </Stack>
        <AutoGrid columnWidth={175} flexible gap="sm">
          <Money
            label="Enterprise Recurring Minimum"
            name="minimum_arr"
            value={policy.minimumCommittedArr}
            // The threshold is kept even while the rule is off, so turning it back on does not
            // require remembering what the number was. Editable only when the rule is on, so the
            // page cannot show an amount that looks live but is not.
            disabled={!canEdit || !policy.enforceMinimumCommittedArr}
            onChange={(value) => setPolicyNumber("minimumCommittedArr", value)}
          />
          <Money
            label="ARR to Allow Special Terms"
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

      <Accordion title="Catalog, Display, and HubSpot Mappings">
        <Stack distance="sm">
          <Text variant="microcopy">
            Stable keys and pricing formulas remain protected in code. These
            controls determine what reps see and which existing HubSpot product
            and property records receive the result.
          </Text>
          <Heading>Products</Heading>
          {Object.entries(catalog.products)
            .sort(([, left], [, right]) => left.order - right.order)
            .map(([key, entry]) => (
              <Accordion key={key} title={`${entry.order}. ${entry.name}`}>
                <Stack distance="sm">
                  <Checkbox
                    name={`catalog_product_${key}_enabled`}
                    checked={entry.enabled}
                    readOnly={!canEdit}
                    onChange={(enabled) =>
                      setProductCatalogEntry(key, { enabled })
                    }
                  >
                    Show this product
                  </Checkbox>
                  <AutoGrid columnWidth={180} flexible gap="sm">
                    <CatalogText
                      label="Display Name"
                      name={`catalog_product_${key}_name`}
                      value={entry.name}
                      disabled={!canEdit}
                      onChange={(name) => setProductCatalogEntry(key, { name })}
                    />
                    <CatalogText
                      label="Section"
                      name={`catalog_product_${key}_section`}
                      value={entry.section}
                      disabled={!canEdit}
                      onChange={(section) =>
                        setProductCatalogEntry(key, { section })
                      }
                    />
                    <CatalogText
                      label="Input Unit"
                      name={`catalog_product_${key}_unit`}
                      value={entry.inputUnit}
                      disabled={!canEdit}
                      onChange={(inputUnit) =>
                        setProductCatalogEntry(key, { inputUnit })
                      }
                    />
                    <CatalogOrder
                      label="Order"
                      name={`catalog_product_${key}_order`}
                      value={entry.order}
                      disabled={!canEdit}
                      onChange={(order) =>
                        setProductCatalogEntry(key, { order })
                      }
                    />
                    <CatalogText
                      label="HubSpot Product ID"
                      name={`catalog_product_${key}_id`}
                      value={entry.productId}
                      disabled={!canEdit}
                      onChange={(productId) =>
                        setProductCatalogEntry(key, { productId })
                      }
                    />
                  </AutoGrid>
                  <CatalogText
                    label="Description"
                    name={`catalog_product_${key}_description`}
                    value={entry.description}
                    disabled={!canEdit}
                    onChange={(description) =>
                      setProductCatalogEntry(key, { description })
                    }
                  />
                </Stack>
              </Accordion>
            ))}

          <Heading>Services and Add-ons</Heading>
          {(
            [
              ["support", "Support"],
              ["onboarding", "Onboarding"],
              ["addOns", "Add-ons"],
              ["professionalServices", "Professional Services"],
            ] as const
          ).map(([group, label]) => (
            <Accordion key={group} title={label}>
              <Stack distance="sm">
                {Object.entries(catalog.options[group])
                  .sort(([, left], [, right]) => left.order - right.order)
                  .map(([key, entry]) => (
                    <Card key={key}>
                      <Stack distance="sm">
                        <Checkbox
                          name={`catalog_${group}_${key}_enabled`}
                          checked={entry.enabled}
                          readOnly={!canEdit}
                          onChange={(enabled) =>
                            setOptionCatalogEntry(group, key, { enabled })
                          }
                        >
                          Show {entry.name}
                        </Checkbox>
                        <AutoGrid columnWidth={180} flexible gap="sm">
                          <CatalogText
                            label="Display Name"
                            name={`catalog_${group}_${key}_name`}
                            value={entry.name}
                            disabled={!canEdit}
                            onChange={(name) =>
                              setOptionCatalogEntry(group, key, { name })
                            }
                          />
                          <CatalogOrder
                            label="Order"
                            name={`catalog_${group}_${key}_order`}
                            value={entry.order}
                            disabled={!canEdit}
                            onChange={(order) =>
                              setOptionCatalogEntry(group, key, { order })
                            }
                          />
                          <CatalogText
                            label="HubSpot Product ID"
                            name={`catalog_${group}_${key}_id`}
                            value={entry.productId}
                            disabled={!canEdit || key === "none"}
                            onChange={(productId) =>
                              setOptionCatalogEntry(group, key, { productId })
                            }
                          />
                        </AutoGrid>
                        <CatalogText
                          label="Description"
                          name={`catalog_${group}_${key}_description`}
                          value={entry.description}
                          disabled={!canEdit}
                          onChange={(description) =>
                            setOptionCatalogEntry(group, key, { description })
                          }
                        />
                      </Stack>
                    </Card>
                  ))}
              </Stack>
            </Accordion>
          ))}

          <Heading>Contract Terms and Payment Options</Heading>
          <AutoGrid columnWidth={220} flexible gap="sm">
            {Object.entries(catalog.contractTerms)
              .sort(([, left], [, right]) => left.order - right.order)
              .map(([key, entry]) => (
                <Card key={`term_${key}`}>
                  <Stack distance="sm">
                    <Checkbox
                      name={`catalog_term_${key}_enabled`}
                      checked={entry.enabled}
                      readOnly={!canEdit}
                      onChange={(enabled) =>
                        setCatalog({
                          ...catalog,
                          contractTerms: {
                            ...catalog.contractTerms,
                            [key]: { ...entry, enabled },
                          },
                        })
                      }
                    >
                      Offer {entry.label}
                    </Checkbox>
                    <CatalogText
                      label="Label"
                      name={`catalog_term_${key}_label`}
                      value={entry.label}
                      disabled={!canEdit}
                      onChange={(label) =>
                        setCatalog({
                          ...catalog,
                          contractTerms: {
                            ...catalog.contractTerms,
                            [key]: { ...entry, label },
                          },
                        })
                      }
                    />
                  </Stack>
                </Card>
              ))}
            {Object.entries(catalog.paymentOptions)
              .sort(([, left], [, right]) => left.order - right.order)
              .map(([key, entry]) => (
                <Card key={`payment_${key}`}>
                  <Stack distance="sm">
                    <Checkbox
                      name={`catalog_payment_${key}_enabled`}
                      checked={entry.enabled}
                      readOnly={!canEdit}
                      onChange={(enabled) =>
                        setCatalog({
                          ...catalog,
                          paymentOptions: {
                            ...catalog.paymentOptions,
                            [key]: { ...entry, enabled },
                          },
                        })
                      }
                    >
                      Offer {entry.label}
                    </Checkbox>
                    <CatalogText
                      label="Label"
                      name={`catalog_payment_${key}_label`}
                      value={entry.label}
                      disabled={!canEdit}
                      onChange={(label) =>
                        setCatalog({
                          ...catalog,
                          paymentOptions: {
                            ...catalog.paymentOptions,
                            [key]: { ...entry, label },
                          },
                        })
                      }
                    />
                  </Stack>
                </Card>
              ))}
          </AutoGrid>

          <Heading>HubSpot Property Mappings</Heading>
          <Text variant="microcopy">
            Use internal property names, not labels. Invalid names are rejected
            when settings are saved.
          </Text>
          <AutoGrid columnWidth={220} flexible gap="sm">
            <CatalogText
              label="Enterprise Product ID"
              name="mapping_enterprise_product"
              value={catalog.hubspotMappings.products.enterprise}
              disabled={!canEdit}
              onChange={(enterprise) =>
                setCatalog({
                  ...catalog,
                  hubspotMappings: {
                    ...catalog.hubspotMappings,
                    products: {
                      ...catalog.hubspotMappings.products,
                      enterprise,
                    },
                  },
                })
              }
            />
            {Object.entries(catalog.hubspotMappings.dealProperties).map(
              ([key, value]) => (
                <CatalogText
                  key={`deal_${key}`}
                  label={`Deal: ${key}`}
                  name={`mapping_deal_${key}`}
                  value={value}
                  disabled={!canEdit}
                  onChange={(next) =>
                    setCatalog({
                      ...catalog,
                      hubspotMappings: {
                        ...catalog.hubspotMappings,
                        dealProperties: {
                          ...catalog.hubspotMappings.dealProperties,
                          [key]: next,
                        },
                      },
                    })
                  }
                />
              ),
            )}
            {Object.entries(catalog.hubspotMappings.lineItemProperties).map(
              ([key, value]) => (
                <CatalogText
                  key={`line_${key}`}
                  label={`Line item: ${key}`}
                  name={`mapping_line_${key}`}
                  value={value}
                  disabled={!canEdit}
                  onChange={(next) =>
                    setCatalog({
                      ...catalog,
                      hubspotMappings: {
                        ...catalog.hubspotMappings,
                        lineItemProperties: {
                          ...catalog.hubspotMappings.lineItemProperties,
                          [key]: next,
                        },
                      },
                    })
                  }
                />
              ),
            )}
          </AutoGrid>
        </Stack>
      </Accordion>

      <Accordion title="Product Volume Rate Card">
        <Stack distance="sm">
          <Text variant="microcopy">
            Edit marginal monthly unit rates. Volume-band boundaries remain
            fixed to prevent overlapping or missing tiers.
          </Text>
          {productRates.map((product) => (
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
              label="Shared OAuth App / Yr"
              name="addon_shared_oauth"
              value={policy.addOnAnnualAmounts.shared_oauth_app}
              disabled={!canEdit}
              onChange={(value) =>
                setNestedNumber("addOnAnnualAmounts", "shared_oauth_app", value)
              }
            />
            <Money
              label="Accelerator (legacy) / Yr"
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

const CatalogText = ({
  label,
  name,
  value,
  disabled,
  onChange,
}: {
  label: string;
  name: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) => (
  <Input
    label={label}
    name={name}
    value={value}
    readOnly={disabled}
    onChange={(next) => onChange(String(next ?? ""))}
  />
);

const CatalogOrder = ({
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
    max={10_000}
    precision={0}
    readOnly={disabled}
    onChange={(next) => onChange(next || 0)}
  />
);
