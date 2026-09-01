# Quote Builder Configurability Implementation

Implemented: August 31, 2026

## Outcome

The existing HubSpot Quote Builder now uses the existing `nylas_pricing_configuration` record for both commercial policy and catalog/integration configuration. No replacement builder, object, or parallel pricing system was introduced.

Existing stored records are migrated in memory from schema 1.0 to 1.1. All new settings default to the previous code-defined behavior, so deployment alone does not intentionally change pricing, approvals, line items, or quote generation.

## Audit: before this change

| Area | Prior state |
|---|---|
| Deal eligibility and pipeline routing | Configurable |
| Quote templates by new business/change/renewal | Configurable |
| Product rates | Configurable |
| Support rates/caps | Configurable |
| Onboarding and add-on amounts | Configurable |
| Professional-service bundle amounts | Configurable |
| Term discounts and payment premiums | Configurable |
| Approval thresholds and approvers | Configurable |
| Product visibility/order/sections/text | Hardcoded in the CRM card |
| Service and add-on availability/text | Hardcoded in the CRM card |
| Available terms and payment schedules | Hardcoded in the CRM card |
| HubSpot product IDs | Hardcoded in the line-item model |
| HubSpot custom line-item property names | Hardcoded in the line-item model/integration |
| Selected non-pricing Deal mirror property names | Hardcoded in the integration |
| Calculation formulas and stable option keys | Hardcoded intentionally |

## What is configurable now

The Settings page has a new **Catalog, Display, and HubSpot Mappings** section.

### Products

For each existing stable product key, an admin can set:

- whether the product is offered;
- its display order;
- its display section;
- its seller-facing name;
- its seller-facing description;
- its input-unit label; and
- its existing HubSpot product ID.

Disabling a product removes it from a new calculator configuration. The server also rejects a disabled product carrying volume or a discount, so visibility is enforced at the API boundary rather than only in the browser.

### Support, onboarding, add-ons, and professional services

For each existing stable option key, an admin can set:

- whether it is offered;
- its order;
- its display name;
- its description; and
- its existing HubSpot product ID where the option creates a line item.

The retired Enterprise Accelerator remains disabled by default. The `none` onboarding option has no HubSpot product ID because it creates no line item.

### Contract and payment choices

For each calculation-supported term and payment frequency, an admin can set:

- whether it is offered;
- its display order; and
- its label.

The term lengths, payments-per-year values, HubSpot enumeration values, and pricing formulas remain protected in code. This prevents an admin label edit from changing contract math.

### HubSpot mappings

Admins can map:

- the Enterprise Drawdown product ID;
- every product/service/add-on product ID;
- payment method, payment frequency, auto-renewal, and contract-term Deal mirror properties; and
- committed quantity, proposed rate, one-time fees, recurring fees, and total-fees-for-term line-item properties.

Core application state properties remain code-owned. In particular, the saved option document and selected-option fields are needed to load settings and restore deal state safely; making those bootstrap fields mutable would require a more invasive migration mechanism and was deliberately excluded from this smallest safe phase.

## What remains code-owned

The following are stable technical or calculation rules and are intentionally not editable as free-form HubSpot settings:

- product, support, onboarding, add-on, and professional-service keys;
- volume-band boundaries and pricing-model types;
- graduated/blended pricing algorithms and rounding behavior;
- ARR, TCV, support, add-on, one-time fee, and invoice formulas;
- approval evaluation and blocking mechanics;
- contract and renewal date calculations;
- payments-per-year and HubSpot enumeration values;
- the Enterprise Drawdown allocation model;
- quote and deal line-item construction behavior;
- accepted quote protection and replacement behavior;
- input allow-lists, validation bounds, retry logic, and authorization;
- core Deal state property names; and
- HubSpot association types and API object types.

These remain in code because changing them can alter money, invalidate saved inputs, break object hydration, or prevent the application from reading its own configuration.

## Compatibility and safety rules

- Missing `catalogConfiguration` data is filled from current code defaults.
- Unknown catalog keys are not accepted as new products; admins configure existing stable keys only.
- At least one product, support option, onboarding option, term, and payment option must remain enabled.
- Product IDs must be 1–20 digits, except the no-onboarding option which is blank by design.
- Property mappings must be valid HubSpot-style internal names.
- Names, descriptions, sections, and units have strict length limits.
- Old saved selections remain renderable in the card while present, even after an option is hidden.
- A recalculation using a now-disabled selection is rejected, requiring the seller to choose an enabled option.
- Settings version changes continue to invalidate stale calculations before lock-in.

## Implementation phases completed

1. Added schema 1.1 defaults, normalization, migration, and validation.
2. Extended the existing HubSpot Settings page.
3. Sent the resolved catalog configuration through the existing `list` action.
4. Made the existing CRM card render configured products, sections, order, names, descriptions, terms, and service choices.
5. Enforced enabled choices server-side.
6. Applied configured product IDs, metered-product order, Deal mirror mappings, and line-item property mappings during the existing line-item/quote flow.
7. Rebuilt the existing serverless bundle.

## Verification

- Settings UI lint: passed.
- Settings UI format check: passed.
- CRM card lint: passed.
- CRM card format check: passed.
- Backend syntax checks: passed.
- Backend tests: 198 passed, 0 failed.
- Serverless bundle build: passed.

No HubSpot deployment was performed as part of this implementation.

