# Nylas Pricing Builder: Settings, Rules, and Calculations

Last reviewed from source: August 31, 2026

This document describes what the Nylas Pricing Builder does, which values an administrator can change, which values are defined in code, how every price is calculated, and how the result becomes HubSpot quote and deal line items.

It documents the application source in this repository. A stored HubSpot settings record can override many defaults, so the effective live configuration may differ from the code defaults listed here.

## 1. What the application does

The application adds a pricing builder to a HubSpot deal. A seller can:

- enter product usage volumes;
- select a contract term and payment frequency;
- apply product and service discounts;
- choose support, onboarding, professional services, and add-ons;
- enter renewal and special-term information;
- calculate list price, proposed price, ARR, TCV, invoice amounts, and approval requirements;
- save as many as 10 pricing options on the deal; and
- lock a selected option into HubSpot by creating deal line items, a quote, quote line items, and deal pricing properties.

The locked quote intentionally represents the commercial structure differently from the calculator:

- The Enterprise Drawdown Commitment line carries the committed recurring platform dollars.
- Metered product lines carry usage quantities and agreed rates, but their fee totals are zero so the quote does not double-count them.
- Support, add-ons, onboarding, and professional services carry their own applicable totals.
- All seven metered product lines are created, including products with zero volume.

This design explains why rates can be present on line items while only the drawdown line contributes the recurring platform total shown on the quote.

## 2. Configuration authority and precedence

At runtime, values are resolved in this order:

1. A valid stored HubSpot settings record.
2. Code defaults in `pricingRules.js` and `appSettings.js` for values not overridden.
3. A small number of integration constants that are always code-defined.

Stored settings therefore override a code change. Updating a default rate in source does not change the live result if the stored settings record still contains an older rate.

The settings record uses:

- logical key: `default`;
- custom object name: `nylas_pricing_configuration`;
- portal-specific object type: `p{portalId}_nylas_pricing_configuration`;
- optimistic versioning: every successful save increments the settings version; and
- audit fields: updating user ID and update timestamp.

If no settings record exists, the application returns code defaults and marks the configuration as not yet stored. If stored JSON is malformed, calculation is refused with a configuration-required error rather than silently using potentially incorrect pricing.

### Known configuration risk

The project handoff reported that a previously stored settings record contained stale overrides, including the old email tier-two rate, different add-on/onboarding amounts, and an effectively disabled minimum ARR. Because stored settings win, administrators should inspect the current settings page after deployment and save the intended policy explicitly.

## 3. General code defaults

| Setting | Default |
|---|---:|
| Schema version | 1.0 |
| Price list version | FY26 v1 |
| Effective date | July 1, 2026 |
| Currency | USD |
| Calculation method | `excel_compatible` |
| Maximum permitted volume | 1,000,000,000 |
| Allowed contract terms | 12, 24, or 36 months |
| Minimum committed ARR | $25,000 |
| Enforce minimum committed ARR | No |
| Redlining/special-terms minimum ARR | $50,000 |
| Maximum credit-card invoice | $25,000 |
| First approval threshold | More than 10% |
| Second approval threshold | More than 30% |
| Currency rounding | Half-up to the indicated precision |

The $25,000 minimum is present but is not blocking by default because enforcement is disabled. An administrator can enable enforcement in stored settings.

## 4. Editable settings

The settings page can control the following policy groups.

### Deal eligibility

- New business enabled: default `true`.
- Renewals enabled: default `false`.
- Up to 30 new-business pipeline IDs.
- Up to 30 renewal pipeline IDs.

A deal is classified in this order:

1. A pipeline listed as renewal makes the deal a renewal.
2. A pipeline listed as new business makes it new business.
3. Otherwise, the normalized deal-type property is used.
4. A blank deal type defaults to new business.
5. Any unsupported value is rejected.

At least one deal category must remain enabled.

### Quote templates

New business, change, and renewal each have:

- a list of enabled template IDs; and
- a default template ID.

An empty enabled list means all otherwise usable templates are allowed. A blank default uses the application fallback. Legacy single-list and single-default fields are maintained for rollback compatibility.

Template IDs must be 1–20 digits when present.

### Commercial policy

Administrators can override:

- calculation method;
- minimum ARR and whether it is enforced;
- redlining minimum ARR;
- credit-card invoice threshold;
- approval thresholds and approver mapping;
- whether a 100% discount always requires Finance;
- whether renewal quotes relax non-discount approval blocks;
- term discounts;
- payment premiums;
- support rates and caps;
- onboarding prices;
- professional-services bundle prices;
- add-on annual prices; and
- every product band rate.

Accepted calculation methods are `excel_compatible` and `rounded_unit_rate`.

Rate and amount validation fails closed. Percentages must be between 0 and 100%, monetary thresholds cannot exceed $1 billion, product unit rates cannot exceed $1 million, and a product cannot provide more rates than its defined band structure.

## 5. Product rates and usage bands

Except where stated otherwise, product bands use graduated marginal pricing. Each slice of volume is multiplied by the rate for that slice. The resulting monthly charge is divided by total volume to produce the blended base unit rate displayed and stored for the product.

### Connect: Email + Calendar Connected Accounts

| Monthly connected accounts | Rate per account/month |
|---:|---:|
| 0–499 | $1.70 |
| 500–999 | $1.60 |
| 1,000–1,999 | $1.50 |
| 2,000–4,999 | $1.30 |
| 5,000–9,999 | $1.10 |
| 10,000–19,999 | $1.00 |
| 20,000–49,999 | $0.90 |
| 50,000–99,999 | $0.80 |
| 100,000–199,999 | $0.70 |
| 200,000–499,999 | $0.60 |
| 500,000–1,099,999 | $0.50 |
| 1,100,000+ | $0.40 |

### Connect: Calendar-Only Connected Accounts

| Monthly connected accounts | Rate per account/month |
|---:|---:|
| 0–499 | $1.30 |
| 500–999 | $1.20 |
| 1,000–1,999 | $1.00 |
| 2,000–4,999 | $0.80 |
| 5,000–9,999 | $0.70 |
| 10,000–19,999 | $0.60 |
| 20,000–49,999 | $0.50 |
| 50,000–99,999 | $0.40 |
| 100,000–199,999 | $0.30 |
| 200,000–499,999 | $0.20 |
| 500,000–1,099,999 | $0.10 |
| 1,100,000+ | $0.05 |

### Notetaker: Bot Hours

| Monthly bot hours | Rate per hour/month |
|---:|---:|
| 0–999 | $0.60 |
| 1,000–1,999 | $0.50 |
| 2,000–4,999 | $0.40 |
| 5,000–9,999 | $0.35 |
| 10,000+ | $0.30 |

### Agent platform rates

| Usage metric | Pricing model | Default rate |
|---|---|---:|
| Number of agents | Flat | $0.20 per agent/month |
| Storage | Flat | $0.20 per GB/month |
| Bandwidth | Flat | $0.50 per GB/month |

### Agent Accounts: Per 1,000 Emails Sent

The application input and calculations use units of 1,000 emails. HubSpot tier boundaries are converted to individual emails when the line item is created.

| Monthly email volume | Calculator units | Rate per 1,000 emails |
|---:|---:|---:|
| 0–49,999 emails | 0–49 | $1.00 |
| 50,000–99,999 emails | 50–99 | $0.70 |
| 100,000–499,999 emails | 100–499 | $0.35 |
| 500,000+ emails | 500+ | $0.25 |

The email line is marked `graduated_adjusted_bands`. Term discount, payment premium, and discretionary discount are calculated and rounded independently for each tier before the tier charges are summed. The $0.70 second tier is the current code default; $0.75 is a known stale stored-setting value from an earlier configuration.

## 6. Term and payment rules

### Term discounts

| Contract term | Discount |
|---:|---:|
| 12 months | 0% |
| 24 months | 2.5% |
| 36 months | 5% |

### Payment frequency premiums

| Payment frequency | Premium | Payments per year | HubSpot value |
|---|---:|---:|---|
| Annual | 0% | 1 | `annual` |
| Semi-annual | 4% | 2 | `semi_annual` |
| Quarterly | 6% | 4 | `quarterly` |
| Monthly | 8% | 12 | `monthly` |

HubSpot deal labels are hardcoded as Annual, Semi-Annual, Quarterly, and Monthly In Advance.

## 7. Support, onboarding, professional services, and add-ons

### Support

| Level | Annual calculation | Annual cap |
|---|---:|---:|
| Basic | Included / $0 | $0 |
| Full | 10% of platform ARR | $10,000 |
| Premium | 20% of platform ARR | $20,000 |

Support has its own discretionary discount. Its list amount uses list platform ARR; its proposed amount uses proposed platform ARR before applying the support-specific discount.

### Onboarding

| Package | One-time list price |
|---|---:|
| None | $0 |
| Quick Launch | $5,000 |
| Quick Launch+ | $10,000 |
| Strategic | $15,000 |

### Professional services

Professional services are selected individually, deduplicated, then priced as a bundle based on the number selected.

| Selected services | One-time list price |
|---:|---:|
| 0 | $0 |
| 1 | $2,000 |
| 2 | $3,800 |
| 3 | $5,500 |
| 4 | $7,200 |
| 5 | $8,800 |

The five offered services are:

1. Google verification review.
2. Architecture/workflow review.
3. Go-to-market review.
4. Provider OAuth app creation.
5. Notification/webhook best practices.

An Ad-hoc Expert Consultation product exists in HubSpot but is not offered by the current builder. A sixth bundle amount is not defined; the settings validator requires exactly six entries representing counts zero through five.

### Add-ons

| Add-on | Annual list price | Status |
|---|---:|---|
| Shared Google OAuth App | $2,400 | Offered |
| Privacy Filter | $5,000 | Offered |
| Verified OAuth | $5,000 | Offered |
| Enterprise Accelerator | $2,400 | Legacy/deprecated |

Each selected add-on can have its own discount. The legacy accelerator remains supported for older saved payloads but should not be offered for new selections.

## 8. Input rules and normalization

Only allow-listed fields are accepted. Unknown input fields are ignored. Accepted fields cover start date, term, payment frequency, discounts, volumes, selected service/add-on values, renewal terms, redlining, and special terms.

- Dates must be valid `YYYY-MM-DD` calendar dates.
- Product volumes must be whole numbers from 0 through 1,000,000,000.
- Discounts must be from 0 through 1 inclusive, where `0.10` means 10%.
- Professional services are deduplicated and limited to the five supported selections.
- A legacy `psItemCount` field may be received but is ignored; count is derived from selections.
- Auto-renewal is strictly Boolean.
- Renewal term is forced to 12 months when auto-renewal is on and zero when off.
- Non-renewal notice is forced to 60 days.
- Special terms are limited to 4,000 characters and retained only when redlining is requested.
- `nonStandardTerms` is currently forced to `false` during normalization.

Invalid values fail calculation rather than being loosely coerced.

## 9. Calculation formulas

### Graduated base charge

For each product band:

```text
units in band = max(0, min(volume, band upper bound) - band lower bound)
band charge   = units in band × band rate
base monthly charge = sum(all band charges)
blended base rate   = base monthly charge ÷ volume
```

When volume is zero, the entry rate is used for rate display and all charges remain zero.

### Default `excel_compatible` method

For ordinary product lines:

```text
list unit rate exact = blended base rate × (1 - term discount + payment premium)
proposed unit rate exact = list unit rate exact × (1 - discretionary discount)
monthly recurring revenue = volume × proposed unit rate exact
annual recurring revenue  = monthly recurring revenue × 12
```

The term discount and payment premium are additive inside the same factor. For example, a 2.5% term discount plus a 4% payment premium produces a factor of `1 - 0.025 + 0.04 = 1.015`.

For the email product, the same adjustment is applied to each tier, but each adjusted tier rate is rounded to cents before calculating the tier charge:

```text
adjusted tier list rate = round(tier rate × (1 - term discount + payment premium), 2)
adjusted tier proposed rate = round(adjusted tier list rate × (1 - discount), 2)
email MRR = sum(units in tier × adjusted tier proposed rate)
```

### Alternate `rounded_unit_rate` method

```text
list unit rate = round(blended base rate × (1 - term discount) × (1 + payment premium), 2)
proposed unit rate = round(list unit rate × (1 - discretionary discount), 2)
MRR = volume × proposed unit rate
ARR = MRR × 12
```

This method compounds the term and payment factors and rounds before extending by quantity, so it can produce a different total from `excel_compatible`.

### Rounding precision

- Blended base rate: 3 decimals.
- Line-item list and proposed rates: 2 decimals.
- Display rates: 4 decimals.
- Internal billing rates: 9 decimals.
- Money totals: currency precision.

### Support

```text
list support annual = min(list platform ARR × support percent, support cap)
proposed support before discount = min(proposed platform ARR × support percent, support cap)
support annual = proposed support before discount × (1 - support discount)
```

### Add-ons

Under the default calculation method:

```text
list monthly = annual list price ÷ 12 × (1 - term discount + payment premium)
proposed monthly = list monthly × (1 - add-on discount)
proposed annual = proposed monthly × 12
```

### One-time services

```text
professional services = bundle amount for selected count × (1 - PS discount)
onboarding = selected package amount × (1 - onboarding discount)
one-time total = professional services + onboarding
```

### Contract totals

```text
committed ARR = proposed platform ARR + support annual + annual add-ons
list committed ARR = list platform ARR + list support annual + list annual add-ons

TCV = committed ARR × (term months ÷ 12) + one-time total
list TCV = list committed ARR × (term months ÷ 12) + list one-time total

recurring amount per invoice = committed ARR ÷ payments per year
first invoice = recurring amount per invoice + one-time total
later recurring invoice = recurring amount per invoice
largest invoice = max(first invoice, later recurring invoice)
```

A bank transfer is required when the largest invoice is strictly greater than $25,000, or the configured threshold. Exactly $25,000 does not trigger the rule.

## 10. Dates

- Contract start is the chosen start date.
- The contract boundary is the start date plus the selected number of months, preserving the day where possible and respecting month-end.
- Contract end is one calendar day before the boundary.
- If auto-renewal is enabled, the renewal date is the first day of the month after contract end.
- The non-renewal notice date is 60 days before contract end.

## 11. Approval and blocking rules

Approval evaluation considers only money-moving selections: products with positive volume, selected add-ons, paid support, paid onboarding, and paid professional services.

### Default approvers

| Deal category | First tier | Second tier |
|---|---|---|
| New business/change | Sales Director | Head of Sales |
| Renewal | CS Director | CCSO |

Finance is the highest approval tier.

### Discount approvals

- No discount: no discount approval.
- More than 0% through 10%: first-tier approver.
- More than 10% through 30%: second-tier approver.
- More than 30%: Finance.
- A 100% discount: Finance when the corresponding setting is enabled, which it is by default.

The largest applicable discretionary discount determines the tier.

### Additional approvals and blocks

- Special terms always add Legal review.
- Special terms below $50,000 committed ARR add Finance and block with `SPECIAL_TERMS_BELOW_THRESHOLD`.
- An enforced minimum ARR below $25,000 adds Finance and blocks with `BELOW_ENTERPRISE_MINIMUM`.
- Renewals skip those two non-discount blocks when `renewalRelaxesNonDiscountApprovals` is enabled.
- A discount above 30% on a multi-year quote adds the legacy guardrail `FINANCE_APPROVAL_MULTI_YEAR_DISCOUNT`.
- An enforced below-minimum quote adds the legacy guardrail `FINANCE_APPROVAL_BELOW_MINIMUM`.

Current limitation: the application records a Finance guardrail for a greater-than-30% multi-year discount, but it does not currently force the term back to 12 months or create a separate hard block. Also, a non-standard-terms Finance branch exists, but current input normalization always changes that flag to false.

## 12. Quote and line-item behavior

Locking an option creates a new quote each time. It does not reuse an existing quote. If replacement is requested, the application may archive a prior quote only when it is in one of these states:

- Draft;
- Pending Approval;
- Approval Not Needed; or
- Rejected.

Accepted and void quotes are never archived by this replacement behavior.

Quote status is `PENDING_APPROVAL` when approval is required and `APPROVAL_NOT_NEEDED` otherwise. Quote acceptance is hardcoded to clickwrap.

The application associates the quote with the deal, selected quote template, available contact/company records, and the newly created line items. It then reapplies the quote as the primary quote on the deal.

### Fee presentation

The custom quote template reads these line-item fields:

- `one_time_fees`;
- `recurring_fees`; and
- `total_fees_for_term`.

`recurring_fees` means the amount for one billing period, not annual recurring revenue.

Metered product lines intentionally receive zero fee totals. Their committed quantity and proposed rate are informational; the Enterprise Drawdown Commitment line carries the platform dollars. If the quote template expects each metered line to contribute totals, it will appear as though those products were not added even though the line items exist.

### Agent email tier conversion

For the HubSpot graduated line item:

- calculator tier boundaries are multiplied by 1,000;
- finite upper bounds become inclusive by subtracting one;
- tier prices remain rates per 1,000 emails; and
- HubSpot receives pricing-model, tier-range, and tier-price fields.

The quote template must render the tier fields sent on the line item. A separately hardcoded tier table in the template can display stale values even when HubSpot line-item tiers are correct.

## 13. HubSpot identifiers hardcoded in source

These IDs are integration constants, not secrets. Changing or replacing products/templates in HubSpot requires updating the applicable mapping or stored settings.

### Product library IDs

| Product | HubSpot product ID |
|---|---:|
| Enterprise Drawdown Commitment, standalone | 46037350773 |
| Enterprise Drawdown Commitment, bundle reference | 45820463617 |
| Email + Calendar Connected Accounts | 45820463620 |
| Calendar-Only Connected Accounts | 45887560099 |
| Notetaker Bot Hours | 45816248707 |
| Agent Accounts: number of agents | 45816248710 |
| Agent Accounts: per 1,000 emails | 45867076721 |
| Agent Accounts: storage | 45820463625 |
| Agent Accounts: bandwidth | 45820401689 |
| Shared Google OAuth App | 34548719650 |
| Enterprise Accelerator, legacy | 46102266003 |
| Privacy Filter | 46060960674 |
| Verified OAuth | 46047848295 |
| Basic Support | 40270989858 |
| Full Support | 41648477792 |
| Premium Support | 41732581464 |
| Quick Launch | 42724377715 |
| Quick Launch+ | 42724501576 |
| Strategic onboarding | 42724439648 |
| Google verification review | 42870472964 |
| Architecture/workflow review | 42870349120 |
| Go-to-market review | 42870410889 |
| Provider OAuth app creation | 42870596743 |
| Notification/webhook best practices | 42870410890 |
| Ad-hoc Expert Consultation, not offered | 47446779731 |

The bundle drawdown product cannot be hydrated as a normal product-library item, so the standalone drawdown product is used for line-item creation.

### Quote template fallback

The code-defined default template ID is `567553820432`. It takes precedence over the `QUOTE_TEMPLATE_ID` environment fallback. Per-kind template defaults should be managed in stored settings.

The project handoff also identifies these intended template IDs, which should be verified in the live settings record:

| Quote kind | Intended template ID |
|---|---:|
| New business | 567553820432 |
| Change | 583243623796 |
| Renewal | 583243745379 |

### Deal properties

Saved pricing options use:

- `pricing_quote_options_payload`;
- `pricing_selected_option_id`; and
- `pricing_selected_option_name`.

Other properties written when available include:

- `pricing_approval_notes`;
- `pricing_quote_id`;
- `pricing_contract_type`;
- `pricing_multi_year_discount_pct`;
- `pricing_multi_product_discount_pct`;
- `pricing_discount_reason`;
- `pricing_approval_timestamp`;
- `special_terms_included`;
- `payment_method`;
- `payment_frequency`;
- `auto_renewal__c`; and
- `contract_term__months_`.

Payment method values are mapped to `Credit Card` or `ACH/Bank Transfer`. Auto-renewal is mapped to `Yes` or `No`. Discount-reason text is limited to 4,000 characters.

Some optional custom properties may not exist in every portal. The integration can drop unsupported optional fields and retry rather than failing the entire quote operation.

## 14. Line-item property allow-list

The integration sends only the following supported fields as applicable:

- `hs_product_id`;
- `quantity`;
- `price`;
- `hs_discount_percentage`;
- `description`;
- `hs_pricing_model`;
- `hs_tier_ranges`;
- `hs_tier_prices`;
- `committed_quantity`;
- `proposed_rate`;
- `one_time_fees`;
- `recurring_fees`;
- `total_fees_for_term`;
- `recurringbillingfrequency`;
- `hs_recurring_billing_period`;
- `hs_recurring_billing_terms`;
- `hs_recurring_billing_number_of_payments`;
- `hs_recurring_billing_start_date`;
- `hs_billing_start_delay_type`; and
- `hs_position_on_quote`.

Internal fields such as local names, local discount values, product category, display units, and `nylas_*` bookkeeping are not sent as arbitrary HubSpot line-item properties. Product names come from the HubSpot product library.

Line-item order is hardcoded as Email + Calendar, Calendar-Only, Notetaker, Agent count, Storage, Bandwidth, then Email volume.

## 15. Reliability and security behavior

- Settings administration can be restricted by the `SETTINGS_ADMIN_USER_IDS` environment list.
- Admin identifiers are compared with timing-safe equality.
- Payloads are validated with allow-lists, types, ranges, and length limits.
- A maximum of 10 saved pricing options is allowed.
- The saved-options payload is limited to 60,000 characters.
- Calculation results include a SHA-256 state hash of normalized input, calculation version, and pricing policy to detect stale calculations.
- Calculation version includes price-list version, calculation method, and settings version.
- Transient HubSpot failures are retried up to three attempts with exponential delay.
- User-visible errors are generic; secrets, tokens, raw stack traces, and sensitive internal values must not be exposed.
- Accepted/void quotes are protected from automated archival.

## 16. Known limitations and intentionally unsupported behavior

- Stored settings can silently supersede newer code defaults; always verify the saved settings after a pricing update.
- Multi-product discount fields exist in the broader workflow, but no separate multi-product discount is calculated by the current calculator.
- The greater-than-30% multi-year rule records a Finance guardrail but does not force a 12-month term.
- `nonStandardTerms` is normalized to false, making its dedicated approval route unreachable.
- Static IP is retired and is not offered.
- Ad-hoc Expert Consultation exists as a product but is not offered or priced in the five-service bundle.
- All metered products are added even at zero volume.
- Metered-line totals are zero by design; the drawdown line prevents double-counting.
- Quote templates that contain their own rate tables can drift from the line-item rates.
- Creating a quote is not idempotent: every lock action creates a new quote.

## 17. Safe change procedure

When changing pricing or behavior:

1. Decide whether the value should be an administrator setting or a permanent integration constant.
2. Update code defaults and validation together when changing a setting's shape.
3. Update the live stored settings record; otherwise its old value will continue to win.
4. Keep calculator rates, email-tier line-item serialization, and quote-template rendering aligned.
5. Verify HubSpot product and template IDs in the target portal.
6. Run the unit and parity tests before deployment.
7. Test one quote without replacing any existing quote.
8. Compare calculator totals, deal line items, quote line items, and rendered quote output.
9. Only enable replacement/archive behavior after the new quote is confirmed.

## 18. Source map

The main implementation files are:

- `src/app/functions/pricingRules.js`: code-default commercial policy and rates.
- `src/app/functions/appSettings.js`: stored settings, validation, migration, permissions, and precedence.
- `src/app/functions/calculator.js`: input normalization, calculations, totals, dates, approvals, and state hash.
- `src/app/functions/lineItemModel.js`: product IDs, line-item construction, fee allocation, email tiers, and display order.
- `src/app/functions/QuoteOptionsFunction.js`: HubSpot reads/writes, quote creation, associations, deal properties, archival rules, and retries.
- `src/app/settings/SettingsPage.tsx`: administrator settings interface.
- `src/app/cards/NylasPricingBuilder.tsx`: seller pricing-builder interface.

Any behavioral change should be checked against tests in `src/app/functions/*.test.js` and the golden/parity fixtures before deployment.
