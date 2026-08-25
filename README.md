# Nylas Pricing

This HubSpot project owns one pricing workflow:

1. Calculate and save a pricing option.
2. Select the customer calculation.
3. Replace the Deal line items with that calculation.
4. Generate a draft Quote from the selected calculation.

The calculator is implemented in `src/app/functions/calculator.js`. Rate-card defaults live in
`src/app/functions/pricingRules.js`; account-level editable overrides are validated by
`src/app/functions/appSettings.js`. UI code must not duplicate pricing calculations.

Agent Email quantities are entered in thousands. For example, `120` means 120,000 emails per
month. Its graduated rates and rounding follow the workbook snapshot in
`src/app/functions/fixtures/workbook_parity_v2.json`.

## Verify a change

Run the same command used by GitHub Actions:

```sh
./scripts/check.sh
```

The check installs locked dependencies, runs calculator and workflow tests, rebuilds the
serverless bundle, verifies that the committed bundle matches its source, and checks formatting,
lint, and TypeScript for both HubSpot UI components.

Do not deploy a working tree with uncommitted changes. Commit and push a branch, wait for the
`Pricing integrity` check to pass, then deploy that exact commit with the HubSpot CLI. Codex is not
required to run or deploy the application.
