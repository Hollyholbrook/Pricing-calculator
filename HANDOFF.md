# Nylas Pricing Calculator — handoff

**Written 2026-08-27, end of session. Read this first, then the linked project docs.**

Paste this whole file into a new chat, or point the new session at the project docs listed at the
bottom — they are all in the claude.ai project "Pricing calculator App - Hubspot".

---

## What this is

A HubSpot private app (portal **45023718**, account name `x`) that puts a pricing calculator on the
Deal record. A rep enters committed monthly volumes and terms; the app calculates the quote,
replaces the Deal's line items, writes ~30 `pricing_*` properties for the approval block, and
creates a draft Quote.

- Repo: `github.com/Hollyholbrook/Pricing-calculator`
- Working folder: `/Users/hollyholbrook/Downloads/Work Hubspot/nylas-pricing/nylas-pricing`
- Source of truth for pricing: the **One-Subscription Pricing Workbook** (xlsx), transcribed into
  `src/app/functions/pricingRules.js`

### Layout

| Path | What |
|---|---|
| `src/app/functions/pricingRules.js` | the frozen rate card and rules |
| `src/app/functions/calculator.js` | pure calculation, no HubSpot |
| `src/app/functions/lineItemModel.js` | builds Deal and Quote line items; `CATALOG` maps keys → HubSpot product ids |
| `src/app/functions/productLibrary.js` | read-only drift check against the HubSpot product library |
| `src/app/functions/QuoteOptionsFunction.js` | the serverless function; all HubSpot writes |
| `src/app/functions/QuoteOptionsFunction.bundle.js` | **what HubSpot actually runs** — must stay in sync |
| `src/app/cards/NylasPricingBuilder.tsx` | the CRM card |
| `scripts/check.sh` | tests + bundle parity + prettier + eslint + tsc |

---

## State at handoff

`main` = **`5fa1eb4`**, working tree clean, **92 tests green**.

**`origin/main` is at `a32b35f` — one commit behind. `5fa1eb4` is unpushed.**

**Deployed to the portal: build #163 = `30fd379`.** Everything after it is committed but NOT
deployed unless Holly uploaded since:

| Commit | Deployed? |
|---|---|
| `5fa1eb4` workbook parity tests | tests only, no runtime change |
| `a32b35f` Contract Summary label | **not confirmed** |
| `214075f` professional services $0 fix | **not confirmed — this is a live money bug fix** |
| `6268207` onboarding 5/10/15K | yes (confirmed by screenshot showing $15,000) |
| `30fd379` ACH requirement | yes, build #163 |

**First thing a new session should do: confirm what is actually live**, then:

```sh
cd "/Users/hollyholbrook/Downloads/Work Hubspot/nylas-pricing/nylas-pricing"
hs project upload --account=x --message="what changed"
git push
```

---

## Standing rules from Holly — do not violate these

1. **"We need to keep the structure of products alone."** Rates and products in `pricingRules.js`
   are frozen. Change one only on her explicit instruction.
2. **CHECK THE WORKBOOK BEFORE CHANGING ANY RATE.** A figure in HubSpot, a screenshot, or a Slack
   message is not permission. This was violated once today and cost most of an afternoon — see the
   post-mortem below.
3. **The product library owns what a product IS** — name, category, description. This app owns what
   was SOLD — quantities, rates, discounts, fees. Never send `name`, `description`,
   `product_category`. `hs_product_id` is enough.
4. **Do not touch the Payment Terms section** of the quote template. Holly handles it template-side.
   Never write `hs_terms`.
5. **`pricing_workbook_url` — ignore**, do not write it.
6. **Never guess a HubSpot property name.** A wrong name returns 400, and `syncDealLineItems`
   ARCHIVES the Deal's line items before it creates replacements — so one bad name empties the Deal
   and creates nothing. Guarded properties go through the drop-and-retry list.
7. **No storage of the configuration on the Deal.** Three JSON blobs are written as `''` to clear
   them. (Note: this was reverted with the rollback and may need reapplying — see Open work.)

---

## The traps that have actually bitten

These each cost real time. They are not hypothetical.

- **`syncDealLineItems` archives before it creates.** Any validation must happen BEFORE the first
  write, or a rejected lock leaves the Deal empty.
- **A stale bundle deploys old backend behind new card code.** Always verify parity:
  ```sh
  before=$(git hash-object src/app/functions/QuoteOptionsFunction.bundle.js)
  npm run build --prefix src/app/functions
  [ "$before" = "$(git hash-object src/app/functions/QuoteOptionsFunction.bundle.js)" ] && echo ok
  ```
- **The policy merge in `calculator.js` is an explicit allow-list, not a spread.** Adding a settings
  key is not enough — it is accepted, validated, normalized, then ignored until named in the merge.
- **There are TWO rate-adjustment implementations.** Ordinary products adjust inline in
  `calculateQuote`; Agent Email goes through `calculateAdjustedBandPricing`. Mutating one leaves the
  other untouched. A test that commits no email volume proves nothing about the graduated path.
- **Agent Email volumes are in THOUSANDS** locally (`1` = 1,000 emails) and in single emails in
  HubSpot. Comparing 50 against 50000 reports drift on a product that agrees.
- **HubSpot tier `end` is inclusive**; `pricingRules` uses an exclusive upper. `upper = end + 1`.
- **`hs_tier_prices[].index` points INTO `hs_tier_ranges`** — never zip the two arrays positionally.
- **`--account` does not fail loudly.** Passing a nonexistent account still uploaded and deployed by
  fallback. Read the `Uploaded ... to x (45023718)` line.
- **`check.sh` runs `npm ci` three times** and exceeds the 45s remote shell timeout. Claude verifies
  with `node --test src/app/functions/*.test.js` plus the parity check above.
- **`Stack` is undocumented in the HubSpot UI SDK and does not stack.** Use `Flex direction="column"`.
- **`reloadPage` is the ONLY action that refreshes a sibling card** — verified against the SDK's
  `CrmHostActions` type. There is no narrower option.

---

## Open work

### Needs Holly's decision

1. **Agent Email tier 2.** The workbook disagrees with itself: RATE CARD row 71 says **$0.70**,
   PRICING TABLES row 20 says **$0.75**. QUOTE BUILDER row 17 prints $0.76, which is 0.75 × 1.015 —
   so the sheet that actually quotes uses **$0.75**, which is what the code has. Confirm with Shane
   Tjin. `workbookQuoteBuilder.test.js` records the reasoning.
2. **Professional services line items.** The total is now correct, but the bundle is split across
   the selected services ($1,833.33 each for three), attributing a price to an individual service.
   Shane: *"any combination of PS would result in the below pricing... it's not specific to any one
   selection."* The workbook models it as ONE "Professional Services" line. Collapsing needs either
   a generic bundle product in HubSpot or a line with no `hs_product_id`.
3. **`recurringbillingfrequency` and `hs_recurring_billing_period`** duplicate the products'
   *Billing frequency* and *Term*. Asked twice, not answered. Still being sent.
4. **The product library as source of truth** (`claude/product-library-as-source-of-truth.md`).
   Blocked on running the drift check — see below.

### Ready but not done

- **Run the Product library check.** Deployed, at the bottom of the card. Its headline says whether
  `hs_tier_ranges` exists in this portal, which decides whether tiered rates can ever be sourced
  from HubSpot. Nothing else on item 4 can proceed without it.
- **Send per-tier prices on graduated line items.** Currently a discounted Agent Email line sends
  one blended `price`, flattening four tiers into one number — and HubSpot documents that `price`
  conflicts with tiered pricing. Needs the drift check first, and a coupled fallback: the three tier
  properties must drop TOGETHER and revert to the blended price, because a Revenue Hub rejection may
  not name the property and the generic guard would miss it.
- **Negative discounts for CS grandfathering.** Holly asked for this; it was lost in the rollback.
  `MIN_DISCOUNT` is not in the deployed calculator. On branch `wip/2026-08-27-email-tier-episode`.
- **The storage removal / single button label** — same rollback, same branch.

### Known drift between the workbook and the HubSpot products

Found in the 2026-08-27 product export. Not acted on:

| Product | Workbook | HubSpot |
|---|---|---|
| Connect Email + Cal | $1.70 | $1.60 |
| Calendar Only | $1.30 | $1.20 |
| Notetaker | $0.60 | $0.55 |
| Support Full / Premium | 10% cap $10K / 20% cap $20K | flat $5,000 / $10,000 |
| Professional services | ladder by count | $2,000 each |

Only Agent Email is `Graduated` in HubSpot; everything else is `Flat` with a single unit price. So
the product library **cannot** supply the graduated rate cards for Connect, Calendar or Notetaker.

---

## Post-mortem: the 2026-08-27 email-tier episode

Worth reading before touching a rate.

Holly reported the calculator's rates looked wrong. A HubSpot product screenshot showed Agent Email
tier 1 at **$0.00** and tier 2 at **$0.70**; the code said $1.00 / $0.75. Claude changed the code to
match the screenshot **without checking the workbook** — violating the rule its own project doc
states. That change also carried the onboarding correction and negative discounts in the same
commit.

The workbook then turned out to agree with the ORIGINAL code on tier 1. Holly corrected the HubSpot
product instead, and `main` was rolled back to the last known-good state — which also reverted the
onboarding fix and negative discounts, because they shared the commit. Onboarding had to be
rediscovered and reapplied hours later, during which every quote with onboarding undercharged by
$5,000.

**Three lessons, all now encoded in docs or tests:**

1. Check the workbook before changing a rate. Two sources disagreeing means one is wrong, and it is
   at least as likely to be the one that is not the workbook.
2. **Land unrelated changes in separate commits.** The rollback was only destructive because a rate
   change and two unrelated fixes shared one.
3. The real bug was elsewhere. The "List Rate" column was showing list **plus the payment premium**
   — $1.08 where the workbook says $1.00 — so nothing in that column matched either source. On
   Annual In Advance the premium is 0 and everything looked fine, which is why it hid for so long.

---

## Testing

`node --test src/app/functions/*.test.js` — 92 tests.

| File | What it guards |
|---|---|
| `workbookQuoteBuilder.test.js` | **the calculator against the workbook's OWN computed quote** — an independent oracle, not a transcription |
| `workbookRules.test.js` | `pricingRules` is a verbatim workbook transcription |
| `workbookParity.test.js` | per-product band crossings |
| `calculator.test.js` | golden fixture, approval tiers, dates, the ACH rule, the professional-services regression |
| `lineItemModel.test.js` | line item payloads, and that no product-owned field leaks |
| `productLibrary.test.js` | the drift check itself |
| `QuoteOptionsFunction.test.js` | HubSpot writes, guards, drop-and-retry |

**When adding a test for a bug, verify it FAILS without the fix.** Several tests in this repo were
found to be passing vacuously — a fixture that only tested something while a value was wrong, and a
parity test that missed an entire code path. Mutate the source and watch it go red.

---

## Restore points

| Ref | What |
|---|---|
| `working-email-tiers-2026-08-27` | last state before the episode |
| `wip/2026-08-27-email-tier-episode` | everything rolled back: negative discounts, storage removal, single button label. **On GitHub.** |
| `working-layout-2026-08-26`, `working-quotes-2026-08-26` | earlier good points |

```sh
git checkout wip/2026-08-27-email-tier-episode -- src/app/functions/calculator.js
```

---

## Project docs (claude.ai project: "Pricing calculator App - Hubspot")

| Doc | Read it when |
|---|---|
| `claude/deploy-loop.md` | deploying, or a push is rejected |
| `claude/pricing-rules-are-frozen.md` | **before touching any rate** |
| `claude/quote-text-ownership.md` | before adding any line item or quote property |
| `claude/rate-card-display.md` | the card shows a wrong-looking rate |
| `claude/product-library-as-source-of-truth.md` | the HubSpot-as-source-of-truth plan |
| `claude/hubspot-integration-notes.md` | HubSpot API specifics |
| `claude/line-items-and-quotes.md`, `claude/pricing-logic.md`, `claude/overview.md` | background (some predates today) |
| `claude/status-2026-08-25.md` | older status; several items now closed |

---

## How Holly works

- Terse, fast, iterating live in the portal. Screenshots are the primary bug report.
- She wants the deploy command with every change, ready to paste.
- She does not want long clarifying questionnaires mid-flow. Diagnose first, ask one pointed
  question with the evidence, and only when the answer genuinely changes what you do.
- Claude writes files into her repo folder over the device bridge, commits there, and gives her the
  upload command. She runs `hs project upload` and `git push` herself.
