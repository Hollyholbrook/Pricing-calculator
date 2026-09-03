var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// pricingRules.js
var require_pricingRules = __commonJS({
  "pricingRules.js"(exports2, module2) {
    var termRules = Object.freeze([
      Object.freeze({ months: 12, discount: 0 }),
      Object.freeze({ months: 24, discount: 0.025 }),
      Object.freeze({ months: 36, discount: 0.05 })
    ]);
    module2.exports = Object.freeze({
      schemaVersion: "1.0",
      priceListVersion: "FY26 v1",
      calculationMethod: "excel_compatible",
      currency: "USD",
      effectiveDate: "2026-07-01",
      allowedTerms: termRules.map(({ months }) => months),
      maximumVolume: 1e9,
      minimumCommittedArr: 25e3,
      // DISABLED. Holly, 2026-08-31: "Just disable the arr minumum."
      //
      // The workbook states a $25,000 Enterprise recurring minimum, so the number stays above rather
      // than being deleted -- deleting it would lose the rate card's own statement of the rule and make
      // re-enabling it a guess. This flag is the switch, and Settings exposes it, so turning the
      // minimum back on is one checkbox and the threshold it uses is already correct.
      //
      // While false: committed ARR below the minimum neither escalates to Finance nor blocks Lock in.
      // The redlining/special-terms ARR threshold is SEPARATE and still enforced.
      enforceMinimumCommittedArr: false,
      redliningMinimumArr: 5e4,
      // Credit card is not accepted on an invoice above this amount -- ACH/Bank Transfer (wire) is
      // required. Holly, 2026-08-27, as a hard REQUIREMENT rather than an approval step.
      //
      // Compared against the LARGEST SINGLE INVOICE, not against ARR or TCV. The first invoice carries
      // the recurring payment plus every one-time charge (onboarding and professional services), so it
      // is the largest one and it is what decides this. A $240,000 ARR deal billed monthly invoices
      // $20,000 a period -- under the limit -- but $35,000 on the first invoice if $15,000 of
      // onboarding rides along with it, which is over. Testing ARR would have missed that.
      creditCardMaximumInvoice: 25e3,
      // The approval ladder's two thresholds. Here rather than only in appSettings so there is
      // exactly ONE place a rate or threshold lives -- calculator.js used to fall back to bare
      // 0.1 / 0.3 literals, a second copy nothing kept in step.
      salesDirectorDiscountMax: 0.1,
      headSalesDiscountMax: 0.3,
      products: [
        {
          key: "connect_ca",
          // "Connect" alone is ambiguous next to "Calendar Only" on a customer-facing quote -- both
          // are Connect products. Display only; every lookup is by `key`.
          name: "Email + Calendar",
          unitOfMeasure: "CA",
          bands: [
            [0, 500, 1.7],
            [500, 1e3, 1.6],
            [1e3, 2e3, 1.5],
            [2e3, 5e3, 1.3],
            [5e3, 1e4, 1.1],
            [1e4, 2e4, 1],
            [2e4, 5e4, 0.9],
            [5e4, 1e5, 0.8],
            [1e5, 2e5, 0.7],
            [2e5, 5e5, 0.6],
            [5e5, 11e5, 0.5],
            [11e5, null, 0.4]
          ]
        },
        {
          key: "calendar_ca",
          name: "Calendar Only",
          unitOfMeasure: "CA",
          bands: [
            [0, 500, 1.3],
            [500, 1e3, 1.2],
            [1e3, 2e3, 1],
            [2e3, 5e3, 0.8],
            [5e3, 1e4, 0.7],
            [1e4, 2e4, 0.6],
            [2e4, 5e4, 0.5],
            [5e4, 1e5, 0.4],
            [1e5, 2e5, 0.3],
            [2e5, 5e5, 0.2],
            [5e5, 11e5, 0.1],
            [11e5, null, 0.05]
          ]
        },
        {
          key: "notetaker_bot_hours",
          name: "Notetaker",
          unitOfMeasure: "bot-hour",
          bands: [
            [0, 1e3, 0.6],
            [1e3, 2e3, 0.5],
            [2e3, 5e3, 0.4],
            [5e3, 1e4, 0.35],
            [1e4, null, 0.3]
          ]
        },
        {
          key: "agent_accounts",
          name: "Agent Accounts",
          unitOfMeasure: "account",
          bands: [[0, null, 0.2]]
        },
        {
          key: "agent_email_thousands",
          name: "Agent Email",
          unitOfMeasure: "1,000 emails",
          pricingModel: "graduated_adjusted_bands",
          // Tier 2 is 0.70, not 0.75. Settled 2026-08-31 against the FY26 MRD, which states it twice
          // -- table 11 (Enterprise) and table 5 (Pro Annual) -- and states that Enterprise
          // deliberately holds at the Pro Annual rates for Agent Accounts. The OneSubscription
          // workbook says 0.75; on that reasoning the workbook is the typo. Holly confirmed.
          bands: [
            [0, 50, 1],
            [50, 100, 0.7],
            [100, 500, 0.35],
            [500, null, 0.25]
          ]
        },
        {
          key: "agent_storage_gb",
          name: "Agent Data Storage",
          unitOfMeasure: "GB",
          bands: [[0, null, 0.2]]
        },
        {
          key: "agent_bandwidth_gb",
          name: "Agent Bandwidth",
          unitOfMeasure: "GB",
          bands: [[0, null, 0.5]]
        }
      ],
      paymentRules: [
        {
          key: "annual_in_advance",
          label: "Annual In Advance",
          premium: 0,
          paymentsPerYear: 1,
          period: "Year",
          hubspotValue: "annual"
        },
        {
          key: "semi_annual_in_advance",
          label: "Semi-Annual In Advance",
          premium: 0.04,
          paymentsPerYear: 2,
          period: "Half-Year",
          hubspotValue: "semi_annual"
        },
        {
          key: "quarterly_in_advance",
          label: "Quarterly In Advance",
          premium: 0.06,
          paymentsPerYear: 4,
          period: "Quarter",
          hubspotValue: "quarterly"
        },
        {
          key: "monthly_in_advance",
          label: "Monthly In Advance",
          premium: 0.08,
          paymentsPerYear: 12,
          period: "Month",
          hubspotValue: "monthly"
        }
      ],
      termRules,
      supportRules: [
        {
          key: "basic",
          level: "Basic Support",
          percentOfPlatformArr: 0,
          annualCap: 0
        },
        {
          key: "full",
          level: "Full Support",
          percentOfPlatformArr: 0.1,
          annualCap: 1e4
        },
        {
          key: "premium",
          level: "Premium Support",
          percentOfPlatformArr: 0.2,
          annualCap: 2e4
        }
      ],
      // Corrected 2026-08-27, and this time corroborated by three independent sources that all agree:
      //   1. the updated pricing workbook, RATE CARD "ONBOARDING PACKAGES" -- 5,000 / 10,000 / 15,000
      //   2. the HubSpot product library export of the same day -- the same three figures
      //   3. Holly's explicit instruction
      // The old $0 / $5,000 / $10,000 ladder was one step low on every package, so every quote that
      // included onboarding under-charged by $5,000 while the line item billed the product's real
      // price -- the Deal's ARR and TCV disagreeing with the customer's own invoice.
      //
      // This was fixed once earlier in the day and then lost: it shared a commit with the Agent Email
      // tier change, so rolling that back took this with it even though the two are unrelated.
      onboardingRules: [
        { key: "none", package: "None", oneTimeAmount: 0 },
        { key: "quick_launch", package: "Quick Launch", oneTimeAmount: 5e3 },
        { key: "quick_launch_plus", package: "Quick Launch +", oneTimeAmount: 1e4 },
        { key: "strategic", package: "Strategic Onboarding", oneTimeAmount: 15e3 }
      ],
      professionalServicesRules: [
        { itemCount: 0, oneTimeAmount: 0 },
        { itemCount: 1, oneTimeAmount: 2e3 },
        { itemCount: 2, oneTimeAmount: 3800 },
        { itemCount: 3, oneTimeAmount: 5500 },
        { itemCount: 4, oneTimeAmount: 7200 },
        { itemCount: 5, oneTimeAmount: 8800 }
        // NO SIX-ITEM ROW YET, and that is why the sixth professional service is not offered.
        //
        // The MRD's bundle table lists the six-item price as TBD. Two things block adding it:
        // the price itself, and the fact that `professionalServicesAmounts` is a STORED settings
        // array whose length is validated at exactly 6 (indices 0..5) -- a seventh entry changes a
        // stored shape, which REQUIREMENTS section 9 says never to do in place. Both are one small
        // deliberate change once the number exists.
      ],
      professionalServiceOptions: [
        { key: "google_verification_review", label: "Google Verification Review" },
        { key: "architecture_workflow_review", label: "Architecture Design & Workflow Review" },
        { key: "gtm_review", label: "Go-to-Market Review" },
        { key: "provider_oauth_app_creation", label: "Provider OAuth App Creation" },
        {
          key: "notification_webhook_best_practices",
          label: "Notification & Webhook Best Practices"
        }
        // The FY26 MRD lists a sixth plan, Ad-hoc Expert Consultation. Its HubSpot product exists
        // (47446779731, $2,000) and lineItemModel's CATALOG can already bill it, but it is NOT
        // offered here until the six-item bundle price exists -- see professionalServicesRules.
      ],
      addOnRules: [
        {
          // What an Enterprise deal actually buys. The FY26 MRD is explicit: the Accelerator Package
          // is PRO ANNUAL ONLY, and on Enterprise the Hosted Auth Branding and custom domains it
          // bundles are already included in the contract -- the single paid Enterprise add-on is the
          // Shared OAuth App. Same 2,400 a year, correct SKU on the customer's quote.
          key: "shared_oauth_app",
          label: "Shared Google OAuth App",
          annualAmount: 2400
        },
        {
          // DEPRECATED 2026-08-31, superseded by shared_oauth_app. Kept because it is a STORED key --
          // it appears in saved quote configurations and in the addOnAnnualAmounts settings record,
          // and removing it would invalidate both. Not offered in the card any more; still prices.
          key: "enterprise_accelerator",
          label: "Enterprise Accelerator Package (legacy)",
          annualAmount: 2400,
          deprecated: true
        },
        {
          key: "privacy_filter",
          label: "Privacy Filter Mode",
          // 5,000, not 6,000. The FY26 MRD (add-ons table) and the HubSpot product PRIVACY
          // (46060960674) both say 5,000; the code was the only source saying 6,000, and every quote
          // carrying this add-on over-charged by 1,000 a year. Holly confirmed 2026-08-31.
          annualAmount: 5e3
        },
        {
          key: "verified_oauth",
          label: "Turnkey Verified OAuth Projects",
          annualAmount: 5e3
          // requiresProfessionalServices removed 2026-08-28, Holly: this add-on no longer depends on a
          // professional-services item, and a quote without one is no longer blocked. The enforcement
          // in calculator.js went with it. Recoverable from git if the dependency ever comes back.
        }
      ]
    });
  }
});

// calculator.js
var require_calculator = __commonJS({
  "calculator.js"(exports2, module2) {
    var crypto2 = require("node:crypto");
    var rules = require_pricingRules();
    var QuoteValidationError2 = class extends Error {
      constructor(code, field) {
        super(code);
        this.name = "QuoteValidationError";
        this.code = code;
        this.field = field;
      }
    };
    var round = (value, decimals = 2) => {
      const multiplier = 10 ** decimals;
      return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
    };
    var assertPlainObject = (value, field) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new QuoteValidationError2("INVALID_OBJECT", field);
      }
    };
    var requireAllowedString = (value, allowed, field) => {
      if (typeof value !== "string" || !allowed.includes(value)) {
        throw new QuoteValidationError2("UNSUPPORTED_VALUE", field);
      }
      return value;
    };
    var requireInteger = (value, min, max, field) => {
      if (!Number.isInteger(value) || value < min || value > max) {
        throw new QuoteValidationError2("INVALID_INTEGER", field);
      }
      return value;
    };
    var PERCENT_MIN = -1;
    var PERCENT_MAX = 1;
    var requirePercent = (value, field) => {
      if (typeof value !== "number" || !Number.isFinite(value) || value < PERCENT_MIN || value > PERCENT_MAX) {
        throw new QuoteValidationError2("INVALID_PERCENTAGE", field);
      }
      return value;
    };
    var findRule = (collection, value, fields, inputField) => {
      const match = collection.find((item) => fields.some((field) => item[field] === value));
      if (!match) throw new QuoteValidationError2("UNSUPPORTED_VALUE", inputField);
      return match;
    };
    var normalizeAddOns = (input) => {
      if (Array.isArray(input)) return input;
      if (!input || typeof input !== "object") return [];
      const legacyMap = {
        enterpriseAccelerator: "enterprise_accelerator",
        privacyFilter: "privacy_filter",
        verifiedOauth: "verified_oauth"
      };
      return Object.entries(input).filter(([, selected]) => selected === true).map(([key]) => legacyMap[key]).filter(Boolean);
    };
    var normalizeDiscountMap = (value, allowedKeys, field, fallback = 0) => {
      if (value == null) {
        return Object.fromEntries(allowedKeys.map((key) => [key, fallback]));
      }
      assertPlainObject(value, field);
      if (Object.keys(value).some((key) => !allowedKeys.includes(key))) {
        throw new QuoteValidationError2("UNSUPPORTED_FIELD", field);
      }
      return Object.fromEntries(
        allowedKeys.map((key) => [key, requirePercent(value[key] ?? fallback, `${field}.${key}`)])
      );
    };
    var normalizeListPriceOverrides = (raw, activeRules) => {
      if (raw == null) return {};
      assertPlainObject(raw, "listPriceOverrides");
      const allowed = /* @__PURE__ */ new Set(["support", "onboarding", "professionalServices", "addOns"]);
      if (Object.keys(raw).some((key) => !allowed.has(key))) {
        throw new QuoteValidationError2("UNSUPPORTED_FIELD", "listPriceOverrides");
      }
      const money = (value, field) => {
        if (value == null || value === "") return null;
        const amount = Number(value);
        if (!Number.isFinite(amount) || amount < 0) {
          throw new QuoteValidationError2("INVALID_AMOUNT", field);
        }
        return round(amount, 2);
      };
      const overrides = {};
      for (const field of ["support", "onboarding", "professionalServices"]) {
        const amount = money(raw[field], `listPriceOverrides.${field}`);
        if (amount != null) overrides[field] = amount;
      }
      if (raw.addOns != null) {
        assertPlainObject(raw.addOns, "listPriceOverrides.addOns");
        const known = new Set(activeRules.addOnRules.map(({ key }) => key));
        const addOns = {};
        for (const [key, value] of Object.entries(raw.addOns)) {
          if (!known.has(key)) {
            throw new QuoteValidationError2("UNSUPPORTED_VALUE", "listPriceOverrides.addOns");
          }
          const amount = money(value, `listPriceOverrides.addOns.${key}`);
          if (amount != null) addOns[key] = amount;
        }
        if (Object.keys(addOns).length > 0) overrides.addOns = addOns;
      }
      return overrides;
    };
    var impliedDeparture = (catalogueList, effectiveList) => {
      if (catalogueList === effectiveList) return 0;
      if (!(catalogueList > 0)) {
        return effectiveList > 0 ? PERCENT_MIN : 0;
      }
      const departure = 1 - effectiveList / catalogueList;
      return round(Math.min(PERCENT_MAX, Math.max(PERCENT_MIN, departure)), 6);
    };
    var normalizeInput = (input, activeRules = rules) => {
      assertPlainObject(input, "input");
      const allowedInputFields = /* @__PURE__ */ new Set([
        "startDate",
        "termMonths",
        "paymentFrequency",
        "discretionaryDiscount",
        "productDiscounts",
        "addOnDiscounts",
        "supportDiscount",
        "onboardingDiscount",
        "professionalServicesDiscount",
        "volumes",
        "supportLevel",
        "professionalServices",
        "psItemCount",
        "listPriceOverrides",
        "onboardingPackage",
        "addOns",
        "autoRenewal",
        "renewalTermMonths",
        "nonRenewalNoticeDays",
        "redliningRequested",
        "nonStandardTerms",
        "specialTerms"
      ]);
      if (Object.keys(input).some((field) => !allowedInputFields.has(field))) {
        throw new QuoteValidationError2("UNSUPPORTED_FIELD", "input");
      }
      const listPriceOverrides = normalizeListPriceOverrides(input.listPriceOverrides, activeRules);
      const allowedTerms = activeRules.allowedTerms;
      const termMonths = requireInteger(
        input.termMonths,
        Math.min(...allowedTerms),
        Math.max(...allowedTerms),
        "termMonths"
      );
      if (!allowedTerms.includes(termMonths)) {
        throw new QuoteValidationError2("UNSUPPORTED_TERM", "termMonths");
      }
      const payment = findRule(
        activeRules.paymentRules,
        input.paymentFrequency,
        ["key", "label", "hubspotValue"],
        "paymentFrequency"
      );
      const support = findRule(
        activeRules.supportRules,
        input.supportLevel,
        ["key", "level"],
        "supportLevel"
      );
      const onboarding = findRule(
        activeRules.onboardingRules,
        input.onboardingPackage,
        ["key", "package"],
        "onboardingPackage"
      );
      const discretionaryDiscount = requirePercent(
        input.discretionaryDiscount ?? 0,
        "discretionaryDiscount"
      );
      const sourceVolumes = input.volumes ?? {};
      assertPlainObject(sourceVolumes, "volumes");
      const productKeys = new Set(activeRules.products.map(({ key }) => key));
      if (Object.keys(sourceVolumes).some((key) => !productKeys.has(key))) {
        throw new QuoteValidationError2("UNSUPPORTED_FIELD", "volumes");
      }
      const volumes = {};
      for (const product of activeRules.products) {
        volumes[product.key] = requireInteger(
          sourceVolumes[product.key] ?? 0,
          0,
          activeRules.maximumVolume,
          `volumes.${product.key}`
        );
      }
      const productDiscounts = normalizeDiscountMap(
        input.productDiscounts,
        [...productKeys],
        "productDiscounts",
        discretionaryDiscount
      );
      const professionalServices = [
        ...new Set(Array.isArray(input.professionalServices) ? input.professionalServices : [])
      ];
      const allowedProfessionalServices = activeRules.professionalServiceOptions.map(({ key }) => key);
      for (const key of professionalServices) {
        requireAllowedString(key, allowedProfessionalServices, "professionalServices");
      }
      const psItemCount = requireInteger(
        professionalServices.length,
        0,
        5,
        "professionalServices"
      );
      const addOns = normalizeAddOns(input.addOns);
      const allowedAddOns = activeRules.addOnRules.map(({ key }) => key);
      for (const key of addOns) requireAllowedString(key, allowedAddOns, "addOns");
      const addOnDiscounts = normalizeDiscountMap(
        input.addOnDiscounts,
        allowedAddOns,
        "addOnDiscounts",
        0
      );
      const autoRenewal = input.autoRenewal === true;
      const renewalTermMonths = autoRenewal ? 12 : 0;
      const nonRenewalNoticeDays = 60;
      if (input.startDate != null) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate)) {
          throw new QuoteValidationError2("INVALID_DATE", "startDate");
        }
        const parsedDate = /* @__PURE__ */ new Date(`${input.startDate}T00:00:00.000Z`);
        if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== input.startDate) {
          throw new QuoteValidationError2("INVALID_DATE", "startDate");
        }
      }
      if (typeof input.specialTerms === "string" && input.specialTerms.length > 4e3) {
        throw new QuoteValidationError2("VALUE_TOO_LONG", "specialTerms");
      }
      return {
        startDate: input.startDate || null,
        termMonths,
        payment,
        support,
        onboarding,
        discretionaryDiscount,
        productDiscounts,
        addOnDiscounts,
        supportDiscount: requirePercent(input.supportDiscount ?? 0, "supportDiscount"),
        onboardingDiscount: requirePercent(input.onboardingDiscount ?? 0, "onboardingDiscount"),
        professionalServicesDiscount: requirePercent(
          input.professionalServicesDiscount ?? 0,
          "professionalServicesDiscount"
        ),
        volumes,
        professionalServices,
        psItemCount,
        // Spread, not a plain key: an empty map must not appear on the normalized input at all, or
        // JSON.stringify(input) changes and every stored option in the portal goes stale on deploy.
        ...Object.keys(listPriceOverrides).length > 0 ? { listPriceOverrides } : {},
        addOns: [...new Set(addOns)],
        autoRenewal,
        renewalTermMonths,
        nonRenewalNoticeDays,
        redliningRequested: input.redliningRequested === true,
        nonStandardTerms: false,
        specialTerms: input.redliningRequested === true && typeof input.specialTerms === "string" ? input.specialTerms.trim() : ""
      };
    };
    var calculateBandCharge = (volume, bands) => bands.reduce((total, [from, to, marginalRate]) => {
      const upperBound = to == null ? volume : Math.min(volume, to);
      const unitsInBand = Math.max(upperBound - from, 0);
      return total + unitsInBand * marginalRate;
    }, 0);
    var calculateAdjustedBandPricing = (volume, bands, termDiscount, paymentPremium, discretionaryDiscount) => {
      const bandRates = bands.map(([lower, upper, rate]) => {
        const upperBound = upper == null ? volume : Math.min(volume, upper);
        const units = Math.max(upperBound - lower, 0);
        const adjustedRate = rate * (1 - termDiscount + paymentPremium);
        const listRate = round(adjustedRate, 2);
        const proposedRate = round(adjustedRate * (1 - discretionaryDiscount), 2);
        return { lower, upper, units, listRate, proposedRate };
      });
      return {
        bandRates,
        exactListMrr: bandRates.reduce((sum, band) => sum + band.units * band.listRate, 0),
        exactProposedMrr: bandRates.reduce(
          (sum, band) => sum + band.units * band.proposedRate,
          0
        )
      };
    };
    var addMonthsUtc = (dateString, months) => {
      const [year, month, day] = dateString.split("-").map(Number);
      const target = new Date(Date.UTC(year, month - 1 + months, 1));
      const finalDay = Math.min(day, new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate());
      target.setUTCDate(finalDay);
      return target;
    };
    var formatDate = (date) => date.toISOString().slice(0, 10);
    var calculateDates = (input) => {
      if (!input.startDate) {
        return {
          contractStartDate: null,
          contractEndDate: null,
          renewalDate: null,
          nonRenewalNoticeDate: null
        };
      }
      const contractBoundary = addMonthsUtc(input.startDate, input.termMonths);
      const endDate = new Date(contractBoundary.getTime());
      endDate.setUTCDate(endDate.getUTCDate() - 1);
      const renewalDate = new Date(
        Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth() + 1, 1)
      );
      const noticeDate = new Date(endDate.getTime());
      noticeDate.setUTCDate(noticeDate.getUTCDate() - input.nonRenewalNoticeDays);
      return {
        contractStartDate: input.startDate,
        contractEndDate: formatDate(endDate),
        renewalDate: input.autoRenewal ? formatDate(renewalDate) : null,
        nonRenewalNoticeDate: formatDate(noticeDate)
      };
    };
    var buildApproval = (input, largestDiscretionaryDiscount, committedArr, activeRules = rules, dealCategory2 = "new_business", largestDiscretionaryUplift = 0) => {
      const reasons = [];
      const blockingReasons = [];
      let tier = "none";
      const percentLabel = (value) => `${round(value * 100, 2)}%`;
      const currencyLabel = (value) => `$${round(value, 2).toLocaleString("en-US")}`;
      const isRenewal = dealCategory2 === "renewal";
      const firstTier = isRenewal ? activeRules.renewalFirstApprovalTier : activeRules.newBusinessFirstApprovalTier;
      const secondTier = isRenewal ? activeRules.renewalSecondApprovalTier : activeRules.newBusinessSecondApprovalTier;
      const largestRateDeparture = Math.max(
        largestDiscretionaryDiscount,
        largestDiscretionaryUplift
      );
      const departureLabel = largestDiscretionaryUplift > largestDiscretionaryDiscount ? "Discretionary uplift" : "Discretionary discount";
      if (largestRateDeparture > 0 && largestRateDeparture <= activeRules.salesDirectorDiscountMax) {
        tier = firstTier;
        reasons.push(
          `${departureLabel} is greater than 0% and no more than ${percentLabel(activeRules.salesDirectorDiscountMax)}.`
        );
      } else if (largestRateDeparture > activeRules.salesDirectorDiscountMax && largestRateDeparture <= activeRules.headSalesDiscountMax) {
        tier = secondTier;
        reasons.push(
          `${departureLabel} is greater than ${percentLabel(activeRules.salesDirectorDiscountMax)} and no more than ${percentLabel(activeRules.headSalesDiscountMax)}.`
        );
      } else if (largestRateDeparture > activeRules.headSalesDiscountMax) {
        tier = "finance";
        reasons.push(
          `${departureLabel} is greater than ${percentLabel(activeRules.headSalesDiscountMax)}.`
        );
      }
      if (activeRules.financeApprovesFullDiscount && largestDiscretionaryDiscount >= 1) {
        tier = "finance";
        reasons.push("A line is discounted 100%.");
      }
      if (input.nonStandardTerms) {
        tier = "finance";
        reasons.push("Contract includes non-standard terms.");
      }
      const relaxed = isRenewal && activeRules.renewalRelaxesNonDiscountApprovals;
      const minimumArrApplies = activeRules.enforceMinimumCommittedArr === true;
      if (minimumArrApplies && !relaxed && committedArr < activeRules.minimumCommittedArr) {
        tier = "finance";
        reasons.push(
          `Committed ARR is below the ${currencyLabel(activeRules.minimumCommittedArr)} Enterprise minimum.`
        );
        blockingReasons.push(
          `Committed ARR must reach ${currencyLabel(activeRules.minimumCommittedArr)} before this can be locked in. Raise the commitment or the term, or ask Finance for an exception.`
        );
      }
      if (!relaxed && input.redliningRequested && committedArr < activeRules.redliningMinimumArr) {
        tier = "finance";
        reasons.push(
          `Special terms were requested below the ${currencyLabel(activeRules.redliningMinimumArr)} ARR threshold.`
        );
        blockingReasons.push(
          `Special terms require ${currencyLabel(activeRules.redliningMinimumArr)} committed ARR. Raise the commitment, or remove the special-terms request.`
        );
      }
      if (input.redliningRequested) {
        reasons.push("Customer-requested special terms require Legal approval.");
      }
      if (input.addOns.includes("verified_oauth") && input.professionalServices.length === 0) {
        blockingReasons.push(
          "Turnkey Verified OAuth Projects requires a Professional Services item. Add one under Professional Services, or remove the add-on."
        );
      }
      return { tier, reasons, blockingReasons };
    };
    var buildActiveRules = (pricingPolicy = {}) => ({
      ...rules,
      calculationMethod: pricingPolicy.calculationMethod ?? rules.calculationMethod,
      products: rules.products.map((product) => ({
        ...product,
        bands: product.bands.map((band, index) => [
          band[0],
          band[1],
          pricingPolicy.productBandRates?.[product.key]?.[index] ?? band[2]
        ])
      })),
      minimumCommittedArr: pricingPolicy.minimumCommittedArr ?? rules.minimumCommittedArr,
      enforceMinimumCommittedArr: pricingPolicy.enforceMinimumCommittedArr ?? rules.enforceMinimumCommittedArr,
      redliningMinimumArr: pricingPolicy.redliningMinimumArr ?? rules.redliningMinimumArr,
      // This merge is an explicit allow-list, not a spread, so a new policy key silently falls back to
      // the frozen rules until it is named here. Adding the settings entry alone was not enough: the
      // override was accepted, validated, normalized -- and then ignored, which a test that only
      // passed an override would have reported as the rule working correctly.
      creditCardMaximumInvoice: pricingPolicy.creditCardMaximumInvoice ?? rules.creditCardMaximumInvoice,
      salesDirectorDiscountMax: pricingPolicy.salesDirectorDiscountMax ?? rules.salesDirectorDiscountMax,
      headSalesDiscountMax: pricingPolicy.headSalesDiscountMax ?? rules.headSalesDiscountMax,
      // The approval matrix, configurable in Settings. The merge here is an explicit allow-list, not
      // a spread: a key not named here is accepted, validated, normalized -- and then ignored.
      newBusinessFirstApprovalTier: pricingPolicy.newBusinessFirstApprovalTier ?? "sales_director",
      newBusinessSecondApprovalTier: pricingPolicy.newBusinessSecondApprovalTier ?? "head_sales",
      renewalFirstApprovalTier: pricingPolicy.renewalFirstApprovalTier ?? "cs_director",
      renewalSecondApprovalTier: pricingPolicy.renewalSecondApprovalTier ?? "ccso",
      financeApprovesFullDiscount: pricingPolicy.financeApprovesFullDiscount ?? true,
      renewalRelaxesNonDiscountApprovals: pricingPolicy.renewalRelaxesNonDiscountApprovals ?? true,
      termRules: rules.termRules.map((rule) => ({
        ...rule,
        discount: pricingPolicy.termDiscounts?.[String(rule.months)] ?? rule.discount
      })),
      paymentRules: rules.paymentRules.map((rule) => ({
        ...rule,
        premium: pricingPolicy.paymentPremiums?.[rule.key] ?? rule.premium
      })),
      supportRules: rules.supportRules.map((rule) => ({
        ...rule,
        percentOfPlatformArr: pricingPolicy.support?.[rule.key]?.percent ?? rule.percentOfPlatformArr,
        annualCap: pricingPolicy.support?.[rule.key]?.cap ?? rule.annualCap
      })),
      onboardingRules: rules.onboardingRules.map((rule) => ({
        ...rule,
        oneTimeAmount: pricingPolicy.onboardingAmounts?.[rule.key] ?? rule.oneTimeAmount
      })),
      professionalServicesRules: rules.professionalServicesRules.map((rule) => ({
        ...rule,
        oneTimeAmount: pricingPolicy.professionalServicesAmounts?.[rule.itemCount] ?? rule.oneTimeAmount
      })),
      addOnRules: rules.addOnRules.map((rule) => ({
        ...rule,
        annualAmount: pricingPolicy.addOnAnnualAmounts?.[rule.key] ?? rule.annualAmount
      }))
    });
    var calculateQuote2 = (rawInput, pricingPolicy = {}, settingsVersion = 0, dealCategory2 = "new_business") => {
      const activeRules = buildActiveRules(pricingPolicy);
      const input = normalizeInput(rawInput, activeRules);
      const termRule = activeRules.termRules.find(({ months }) => months === input.termMonths);
      const lines = activeRules.products.map((product) => {
        const volume = input.volumes[product.key];
        const entryRate = product.bands[0][2];
        const bandCharge = calculateBandCharge(volume, product.bands);
        const baseBlendedRate = volume === 0 ? 0 : round(bandCharge / volume, 3);
        const baseForCustomerRate = volume === 0 ? entryRate : baseBlendedRate;
        const excelCompatible = activeRules.calculationMethod === "excel_compatible";
        let exactListUnitRate = excelCompatible ? baseForCustomerRate * (1 - termRule.discount + input.payment.premium) : round(baseForCustomerRate * (1 - termRule.discount) * (1 + input.payment.premium), 2);
        const discretionaryDiscount = input.productDiscounts[product.key];
        let exactProposedUnitRate = excelCompatible ? exactListUnitRate * (1 - discretionaryDiscount) : round(round(exactListUnitRate, 2) * (1 - discretionaryDiscount), 2);
        let exactListMrr = volume * exactListUnitRate;
        let exactProposedMrr = volume * exactProposedUnitRate;
        let proposedBandRates = [];
        let listBandRates = [];
        if (product.pricingModel === "graduated_adjusted_bands") {
          const adjusted = calculateAdjustedBandPricing(
            volume,
            product.bands,
            termRule.discount,
            input.payment.premium,
            discretionaryDiscount
          );
          exactListMrr = adjusted.exactListMrr;
          exactProposedMrr = adjusted.exactProposedMrr;
          exactListUnitRate = volume === 0 ? adjusted.bandRates[0].listRate : exactListMrr / volume;
          exactProposedUnitRate = volume === 0 ? adjusted.bandRates[0].proposedRate : exactProposedMrr / volume;
          proposedBandRates = adjusted.bandRates.map(({ lower, upper, proposedRate }) => ({
            lower,
            upper,
            rate: proposedRate
          }));
          listBandRates = adjusted.bandRates.map(({ lower, upper, listRate }) => ({
            lower,
            upper,
            rate: listRate
          }));
        }
        const listUnitRate = round(exactListUnitRate, 2);
        const displayListUnitRate = round(exactListUnitRate, 4);
        const proposedUnitRate = round(exactProposedUnitRate, 2);
        const displayProposedUnitRate = round(exactProposedUnitRate, 4);
        const billingUnitRate = round(exactProposedUnitRate, 9);
        const listMrr = round(exactListMrr, 2);
        const proposedMrr = round(exactProposedMrr, 2);
        return {
          productKey: product.key,
          productName: product.name,
          unitOfMeasure: product.unitOfMeasure,
          volume,
          committed: volume > 0,
          baseUnitRate: entryRate,
          baseBlendedRate,
          listUnitRate: volume === 0 ? 0 : listUnitRate,
          displayListUnitRate,
          proposedUnitRate: volume === 0 ? 0 : proposedUnitRate,
          displayProposedUnitRate,
          billingUnitRate,
          baseBandRates: product.bands.map(([lower, upper, rate]) => ({ lower, upper, rate })),
          listBandRates,
          proposedBandRates,
          availableUnitRate: proposedUnitRate,
          discretionaryDiscount,
          listMrr,
          proposedMrr,
          annualCommitment: round(exactProposedMrr * 12, 2),
          listTermCommitment: round(exactListMrr * input.termMonths, 2),
          termCommitment: round(exactProposedMrr * input.termMonths, 2),
          exactListMrr,
          exactProposedMrr
        };
      });
      const listPlatformArr = round(lines.reduce((sum, line) => sum + line.exactListMrr, 0) * 12, 2);
      const proposedPlatformArr = round(
        lines.reduce((sum, line) => sum + line.exactProposedMrr, 0) * 12,
        2
      );
      const listSupportAnnual = round(
        Math.min(
          listPlatformArr * input.support.percentOfPlatformArr,
          input.support.annualCap
        ),
        2
      );
      const proposedSupportBeforeDiscount = round(
        Math.min(
          proposedPlatformArr * input.support.percentOfPlatformArr,
          input.support.annualCap
        ),
        2
      );
      const overrides = input.listPriceOverrides || {};
      const catalogueSupportList = proposedSupportBeforeDiscount;
      const effectiveSupportList = overrides.support != null ? overrides.support : catalogueSupportList;
      const supportOverrideDeparture = impliedDeparture(catalogueSupportList, effectiveSupportList);
      const supportAnnual = round(effectiveSupportList * (1 - input.supportDiscount), 2);
      const selectedAddOns = activeRules.addOnRules.filter(({ key }) => input.addOns.includes(key)).map(({ key, label, annualAmount }) => {
        const catalogueAnnualAmount = annualAmount;
        const effectiveAnnualAmount = overrides.addOns?.[key] != null ? overrides.addOns[key] : catalogueAnnualAmount;
        const overrideDeparture = impliedDeparture(catalogueAnnualAmount, effectiveAnnualAmount);
        const exactListMonthlyAmount = activeRules.calculationMethod === "excel_compatible" ? effectiveAnnualAmount / 12 * (1 - termRule.discount + input.payment.premium) : round(effectiveAnnualAmount / 12 * (1 - termRule.discount) * (1 + input.payment.premium), 2);
        const listMonthlyAmount = round(exactListMonthlyAmount, 2);
        const discretionaryDiscount = input.addOnDiscounts[key];
        const exactProposedMonthlyAmount = activeRules.calculationMethod === "excel_compatible" ? exactListMonthlyAmount * (1 - discretionaryDiscount) : round(listMonthlyAmount * (1 - discretionaryDiscount), 2);
        const proposedMonthlyAmount = round(exactProposedMonthlyAmount, 2);
        return {
          key,
          label,
          rateCardAnnualAmount: catalogueAnnualAmount,
          // Both figures, so the quote's history stays auditable -- Holly, 2026-09-03.
          catalogueAnnualAmount,
          effectiveAnnualAmount,
          overrideDeparture,
          listMonthlyAmount,
          proposedMonthlyAmount,
          billingMonthlyAmount: round(exactProposedMonthlyAmount, 9),
          listAnnualAmount: round(exactListMonthlyAmount * 12, 2),
          annualAmount: round(exactProposedMonthlyAmount * 12, 2),
          discretionaryDiscount
        };
      });
      const annualAddOns = selectedAddOns.reduce((sum, item) => sum + item.annualAmount, 0);
      const listAnnualAddOns = selectedAddOns.reduce((sum, item) => sum + item.listAnnualAmount, 0);
      const professionalServicesBundle = activeRules.professionalServicesRules.find(
        ({ itemCount }) => itemCount === input.psItemCount
      );
      if (!professionalServicesBundle || professionalServicesBundle.oneTimeAmount == null) {
        throw new QuoteValidationError2(
          "PROFESSIONAL_SERVICES_BUNDLE_PRICE_REQUIRED",
          "professionalServices"
        );
      }
      const catalogueProfessionalServicesList = professionalServicesBundle.oneTimeAmount;
      const listProfessionalServicesAmount = catalogueProfessionalServicesList;
      const effectiveProfessionalServicesList = overrides.professionalServices != null ? overrides.professionalServices : catalogueProfessionalServicesList;
      const professionalServicesOverrideDeparture = impliedDeparture(
        catalogueProfessionalServicesList,
        effectiveProfessionalServicesList
      );
      const professionalServicesAmount = round(
        effectiveProfessionalServicesList * (1 - input.professionalServicesDiscount),
        2
      );
      const catalogueOnboardingList = input.onboarding.oneTimeAmount;
      const listOnboardingAmount = catalogueOnboardingList;
      const effectiveOnboardingList = overrides.onboarding != null ? overrides.onboarding : catalogueOnboardingList;
      const onboardingOverrideDeparture = impliedDeparture(
        catalogueOnboardingList,
        effectiveOnboardingList
      );
      const onboardingAmount = round(
        effectiveOnboardingList * (1 - input.onboardingDiscount),
        2
      );
      const oneTime = onboardingAmount + professionalServicesAmount;
      const listOneTime = listOnboardingAmount + listProfessionalServicesAmount;
      const committedArr = round(proposedPlatformArr + supportAnnual + annualAddOns, 2);
      const listCommittedArr = round(listPlatformArr + listSupportAnnual + listAnnualAddOns, 2);
      const tcv = round(committedArr * (input.termMonths / 12) + oneTime, 2);
      const listTcv = round(listCommittedArr * (input.termMonths / 12) + listOneTime, 2);
      const recurringPerPeriod = round(committedArr / input.payment.paymentsPerYear, 2);
      const firstInvoiceAmount = round(recurringPerPeriod + oneTime, 2);
      const recurringInvoiceAmount = recurringPerPeriod;
      const largestInvoiceAmount = Math.max(firstInvoiceAmount, recurringInvoiceAmount);
      const requiresBankTransfer = activeRules.creditCardMaximumInvoice != null && largestInvoiceAmount > activeRules.creditCardMaximumInvoice;
      const effectiveDiscounts = [
        ...Object.entries(input.productDiscounts).filter(([key]) => input.volumes[key] > 0).map(([, discount]) => discount),
        ...Object.entries(input.addOnDiscounts).filter(([key]) => input.addOns.includes(key)).map(([, discount]) => discount),
        ...listSupportAnnual > 0 ? [input.supportDiscount] : [],
        ...listOnboardingAmount > 0 ? [input.onboardingDiscount] : [],
        ...listProfessionalServicesAmount > 0 ? [input.professionalServicesDiscount] : [],
        // AN OVERRIDDEN PRICE ROUTES LIKE A DISCOUNT OR AN UPLIFT. Holly, 2026-09-03.
        //
        // This single line is what makes the whole feature safe: by expressing an override as the same
        // signed percentage a typed discount uses, it inherits the approval ladder, the blocking rules
        // AND the "anything that routes to an approver carries a reason" guard from 2026-09-02. No new
        // approval path, no second ladder to keep in step, and nothing can be repriced without a trail.
        //
        // Zeros are harmless: with no overrides every departure is 0, Math.max is unchanged, and the
        // workbook parity fixtures still pass -- verified across all 61 parity tests.
        supportOverrideDeparture,
        onboardingOverrideDeparture,
        professionalServicesOverrideDeparture,
        ...selectedAddOns.map(({ overrideDeparture }) => overrideDeparture)
      ];
      const largestDiscretionaryDiscount = Math.max(0, ...effectiveDiscounts);
      const largestDiscretionaryUplift = Math.max(
        0,
        ...effectiveDiscounts.map((discount) => -discount)
      );
      const approval = buildApproval(
        input,
        largestDiscretionaryDiscount,
        committedArr,
        activeRules,
        dealCategory2,
        largestDiscretionaryUplift
      );
      const overrideBlockingReasons = [];
      if (overrides.support != null && overrides.support > input.support.annualCap) {
        overrideBlockingReasons.push(
          `A support price of $${round(overrides.support, 2).toLocaleString("en-US")} exceeds the $${round(input.support.annualCap, 2).toLocaleString("en-US")} cap for ${input.support.level}. Lower the price, or change the support level.`
        );
      }
      const blockingReasons = [...approval.blockingReasons, ...overrideBlockingReasons];
      const legacyGuardrails = [];
      if (largestDiscretionaryDiscount > activeRules.headSalesDiscountMax && input.termMonths > 12) {
        legacyGuardrails.push("FINANCE_APPROVAL_MULTI_YEAR_DISCOUNT");
      }
      if (activeRules.enforceMinimumCommittedArr === true && committedArr < activeRules.minimumCommittedArr) {
        legacyGuardrails.push("FINANCE_APPROVAL_BELOW_MINIMUM");
      }
      const dates = calculateDates(input);
      const result = {
        schemaVersion: rules.schemaVersion,
        calculationVersion: `${rules.priceListVersion} / ${activeRules.calculationMethod} / settings ${settingsVersion}`,
        calculationMethod: activeRules.calculationMethod,
        settingsVersion,
        currency: rules.currency,
        calculatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        termDiscount: termRule.discount,
        paymentPremium: input.payment.premium,
        paymentFrequencyHubSpotValue: input.payment.hubspotValue,
        paymentsPerYear: input.payment.paymentsPerYear,
        billingPeriod: input.payment.period,
        lines,
        quotedProducts: lines.filter(({ committed }) => committed).map(({ productKey }) => productKey),
        listPlatformArr,
        proposedPlatformArr,
        listSupportAnnual,
        supportAnnual,
        // BOTH FIGURES, for audit: what the rate card said and what the rep entered. Holly, 2026-09-03:
        // "Store both the default catalog price and the user-entered price so the quote calculation
        // history remains auditable."
        catalogueSupportList,
        effectiveSupportList,
        supportOverrideDeparture,
        catalogueOnboardingList,
        effectiveOnboardingList,
        onboardingOverrideDeparture,
        catalogueProfessionalServicesList,
        effectiveProfessionalServicesList,
        professionalServicesOverrideDeparture,
        listPriceOverrides: overrides,
        selectedAddOns,
        annualAddOns,
        listAnnualAddOns,
        listProfessionalServicesAmount,
        professionalServicesAmount,
        listOnboardingAmount,
        onboardingAmount,
        listCommittedArr,
        committedArr,
        recurringPerPeriod,
        firstInvoiceAmount,
        recurringInvoiceAmount,
        largestInvoiceAmount,
        requiresBankTransfer,
        creditCardMaximumInvoice: activeRules.creditCardMaximumInvoice,
        listOneTime,
        oneTime,
        listTcv,
        tcv,
        largestDiscretionaryDiscount,
        largestDiscretionaryUplift,
        approvalTierRequired: approval.tier,
        approvalReasons: approval.reasons,
        blockingReasons,
        calculationStatus: blockingReasons.length > 0 ? "blocked" : approval.tier === "none" ? "ready" : "approval_required",
        approvalStatus: legacyGuardrails.length === 0 ? "WITHIN_GUARDRAILS" : legacyGuardrails.join("; "),
        dates
      };
      result.stateHash = crypto2.createHash("sha256").update(
        JSON.stringify({
          input,
          calculationVersion: result.calculationVersion,
          pricingPolicy
        })
      ).digest("hex");
      return result;
    };
    var normalizeStoredInput2 = (rawInput, pricingPolicy = {}) => {
      const input = normalizeInput(rawInput, buildActiveRules(pricingPolicy));
      return {
        startDate: input.startDate,
        termMonths: input.termMonths,
        paymentFrequency: input.payment.key,
        supportLevel: input.support.key,
        onboardingPackage: input.onboarding.key,
        discretionaryDiscount: input.discretionaryDiscount,
        productDiscounts: input.productDiscounts,
        addOnDiscounts: input.addOnDiscounts,
        supportDiscount: input.supportDiscount,
        onboardingDiscount: input.onboardingDiscount,
        professionalServicesDiscount: input.professionalServicesDiscount,
        volumes: input.volumes,
        professionalServices: input.professionalServices,
        // Same conditional as normalizeInput: absent when empty, so a Deal with no overrides hashes
        // exactly as it did before this field existed.
        ...input.listPriceOverrides && Object.keys(input.listPriceOverrides).length > 0 ? { listPriceOverrides: input.listPriceOverrides } : {},
        // psItemCount is deliberately NOT stored. It is derived from professionalServices on every
        // calculation, and persisting it is what let a stale count outlive the selection it came from.
        addOns: input.addOns,
        autoRenewal: input.autoRenewal,
        renewalTermMonths: input.renewalTermMonths,
        nonRenewalNoticeDays: input.nonRenewalNoticeDays,
        redliningRequested: input.redliningRequested,
        nonStandardTerms: input.nonStandardTerms,
        specialTerms: input.specialTerms
      };
    };
    module2.exports = {
      QuoteValidationError: QuoteValidationError2,
      calculateQuote: calculateQuote2,
      buildActiveRules,
      normalizeInput,
      normalizeStoredInput: normalizeStoredInput2,
      round,
      rules
    };
  }
});

// lineItemModel.js
var require_lineItemModel = __commonJS({
  "lineItemModel.js"(exports2, module2) {
    var crypto2 = require("node:crypto");
    var CATALOG = Object.freeze({
      // 'Platform Subscription - Enterprise' (45820463617) is classified as a Bundle in the product
      // library, and HubSpot will not hydrate a line item from a bundle. 46037350773 'Enterprise' is
      // the standalone Platform product inside that bundle (SKU ENT-FY26), so it is what the
      // subscription line is built from. The previous id, 47269087321, is not in the library export
      // at all and HubSpot rejected it as a bundle.
      enterprise: {
        id: "46037350773",
        // Local label only -- nothing sends it. Corrected from 'Enterprise Drawdown Fee' against the
        // 2026-08-27 product export, which is also where the SKU ENT-FY26 below comes from.
        name: "Enterprise Drawdown Commitment",
        category: "Platform"
      },
      connect_ca: {
        id: "45820463620",
        name: "Connect - Email + Calendar Connected Accounts (CA)",
        category: "Platform"
      },
      calendar_ca: {
        id: "45887560099",
        name: "Connect - Calendar-Only Connected Accounts (CA)",
        category: "Calendar"
      },
      notetaker_bot_hours: {
        id: "45816248707",
        name: "Notetaker - Bot Hours",
        category: "Notetaker"
      },
      agent_accounts: {
        id: "45816248710",
        name: "Agent Accounts - # of Agents",
        category: "Platform"
      },
      agent_email_thousands: {
        id: "45867076721",
        name: "Agent Accounts - Per 1,000 Emails Sent",
        category: "Platform"
      },
      agent_storage_gb: {
        id: "45820463625",
        name: "Agent Accounts - GB / Storage",
        category: "Platform"
      },
      agent_bandwidth_gb: {
        id: "45820401689",
        name: "Agent Accounts - GB / Bandwidth",
        category: "Platform"
      },
      // The Enterprise add-on. 'Accelerator Package' (46102266003) is the PRO ANNUAL product and is
      // not what an Enterprise contract buys -- see pricingRules.addOnRules.
      shared_oauth_app: {
        id: "34548719650",
        name: "Add-On: Shared Google OAuth App",
        category: "Add-Ons"
      },
      // Deprecated, kept so a stored quote that still carries this key can be priced and re-billed.
      enterprise_accelerator: {
        id: "46102266003",
        name: "Accelerator Package",
        category: "Add-Ons"
      },
      privacy_filter: { id: "46060960674", name: "Privacy Filter Mode", category: "Add-Ons" },
      verified_oauth: {
        id: "46047848295",
        name: "Turnkey Verified OAuth Project",
        category: "Professional Services"
      },
      basic: { id: "40270989858", name: "Support Services: Basic", category: "Support" },
      full: { id: "41648477792", name: "Support Services: Full", category: "Support" },
      premium: { id: "41732581464", name: "Support Services: Premium", category: "Support" },
      // Each onboarding key was previously mapped to the NEXT package's product: Quick Launch+ held
      // "QuickLaunch Onboarding" and Strategic held "QuickLaunch+ Onboarding", so every onboarding
      // line item named and billed the wrong package. Quick Launch had no entry at all, which made
      // pricing it above $0 fail with PRODUCT_MAPPING_REQUIRED after the Deal had already been
      // rewritten.
      quick_launch: {
        id: "42724377715",
        name: "QuickLaunch Onboarding",
        category: "Professional Services"
      },
      quick_launch_plus: {
        id: "42724501576",
        name: "QuickLaunch+ Onboarding",
        category: "Professional Services"
      },
      strategic: {
        id: "42724439648",
        name: "Strategic Onboarding",
        category: "Professional Services"
      },
      google_verification_review: {
        id: "42870472964",
        name: "Google Verification Review",
        category: "Professional Services"
      },
      architecture_workflow_review: {
        id: "42870349120",
        name: "Architecture Design & Workflow Review",
        category: "Professional Services"
      },
      gtm_review: {
        id: "42870410889",
        name: "Go-To-Market (GTM) Review",
        category: "Professional Services"
      },
      provider_oauth_app_creation: {
        id: "42870596743",
        name: "Provider OAuth App Creation",
        category: "Professional Services"
      },
      notification_webhook_best_practices: {
        // Confirmed against the full product export: Standalone, Professional Services, $2,000.
        // It was absent from the bundles export only because it belongs to no bundle.
        id: "42870410890",
        name: "Notification & Webhook Best Practices",
        category: "Professional Services"
      }
      // The MRD's sixth professional service, Ad-hoc Expert Consultation, has a HubSpot product --
      // 47446779731, Professional Services, $2,000, created 2026-08-31 -- but no entry here yet.
      // Everything in CATALOG must have a local price to compare against, and the six-item bundle
      // price is still TBD. Add this entry and the rate-card rows together, not separately.
    });
    var PRESENTATIONS = Object.freeze(["itemized_products", "subscription_summary"]);
    var PRODUCT_LINE_ORDER = Object.freeze([
      "connect_ca",
      "calendar_ca",
      "notetaker_bot_hours",
      "agent_accounts",
      "agent_storage_gb",
      "agent_bandwidth_gb",
      "agent_email_thousands"
    ]);
    var productOrderIndex = (productKey) => {
      const index = PRODUCT_LINE_ORDER.indexOf(productKey);
      return index === -1 ? PRODUCT_LINE_ORDER.length : index;
    };
    var withPositions = (items) => items.map((item, index) => ({
      ...item,
      properties: { ...item.properties, hs_position_on_quote: String(index) }
    }));
    var FEE_TOTAL_PROPERTIES = Object.freeze({
      oneTime: "one_time_fees",
      // The per-BILLING-PERIOD amount, not the annualised one: it sits on a record that already
      // carries recurringbillingfrequency, so "recurring fees" on that line reads as what is billed
      // each cycle. There is no separate ARR property in the portal. If this should be the annual
      // figure instead, change this one mapping to recurringPerYear -- both are computed.
      recurringPerPeriod: "recurring_fees",
      totalForTerm: "total_fees_for_term"
    });
    var carriesFees = (key) => !String(key).startsWith("metered:");
    var feeTotals = (item, option) => {
      const net = netPrice(item.properties);
      if (net == null) return null;
      const amount = net * Number(item.properties.quantity || 0);
      const recurring = Boolean(item.properties.recurringbillingfrequency);
      const perPeriod = recurring ? amount : 0;
      const perYear = perPeriod * option.result.paymentsPerYear;
      return {
        oneTime: recurring ? 0 : amount,
        recurringPerPeriod: perPeriod,
        recurringPerYear: perYear,
        totalForTerm: recurring ? perYear * (option.input.termMonths / 12) : amount
      };
    };
    var withFeeTotals = (items, option) => items.map((item) => {
      if (!carriesFees(item.key)) return item;
      const values = feeTotals(item, option);
      if (!values) return item;
      const properties = { ...item.properties };
      for (const [slot, name] of Object.entries(FEE_TOTAL_PROPERTIES)) {
        if (name) properties[name] = String(round(values[slot], 2));
      }
      return { ...item, properties };
    });
    var round = (value, decimals = 2) => {
      const multiplier = 10 ** decimals;
      return Math.round((Number(value) + Number.EPSILON) * multiplier) / multiplier;
    };
    var paymentFrequency = (paymentsPerYear) => {
      const value = {
        1: "annually",
        2: "per_six_months",
        4: "quarterly",
        12: "monthly"
      }[paymentsPerYear];
      if (!value) throw new Error("INVALID_QUOTE_CONTENT");
      return value;
    };
    var normalizeDate = (value, fallback) => {
      const candidate = value || fallback;
      if (typeof candidate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
        throw new Error("INVALID_QUOTE_CONTENT");
      }
      const parsed = /* @__PURE__ */ new Date(`${candidate}T00:00:00.000Z`);
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== candidate) {
        throw new Error("INVALID_QUOTE_CONTENT");
      }
      return candidate;
    };
    var normalizeOptionalDate = (value) => {
      if (value == null || value === "") return "";
      return normalizeDate(value);
    };
    var normalizeQuoteContent2 = (raw = {}, fallbackTitle = "Nylas Enterprise Quote") => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error("INVALID_QUOTE_CONTENT");
      }
      const allowed = /* @__PURE__ */ new Set([
        "title",
        "expirationDate",
        "presentation",
        // These three no longer change anything the app sends. They used to select what went into the
        // quote's hs_comments and hs_terms; the app no longer writes either, because hs_terms is what
        // the template's "Payment Terms:" section renders and the template owns that text. They stay
        // accepted so the card's existing payload still validates, and they stay in the content hash.
        // Do not build new behaviour on them without deciding what owns the quote's prose.
        "includeUncommittedRateSchedule",
        "includeRenewalTerms",
        "includeSpecialTerms",
        // Part of the content, not a side channel: the template changes what the customer sees, so
        // it belongs in the hash. Switching template on an already-generated quote must produce a new
        // quote rather than silently reusing the old one.
        "templateId"
      ]);
      for (const key of Object.keys(raw)) {
        if (!allowed.has(key)) throw new Error("INVALID_QUOTE_CONTENT");
      }
      const title = typeof raw.title === "string" ? raw.title.trim() : fallbackTitle;
      if (!title || title.length > 160) throw new Error("INVALID_QUOTE_CONTENT");
      const presentation = raw.presentation || "itemized_products";
      if (!PRESENTATIONS.includes(presentation)) throw new Error("INVALID_QUOTE_CONTENT");
      const templateId = raw.templateId == null ? "" : String(raw.templateId);
      if (templateId && !/^\d{1,20}$/.test(templateId)) throw new Error("INVALID_QUOTE_CONTENT");
      return {
        title,
        templateId,
        expirationDate: normalizeOptionalDate(raw.expirationDate),
        presentation,
        includeUncommittedRateSchedule: raw.includeUncommittedRateSchedule === true,
        includeRenewalTerms: raw.includeRenewalTerms !== false,
        includeSpecialTerms: raw.includeSpecialTerms !== false
      };
    };
    var baseManagedProperties = ({ option, key, component, product, source }) => ({
      hs_product_id: product.id,
      product_category: product.category,
      nylas_pricing_managed: "true",
      nylas_line_item_key: key,
      nylas_pricing_component: component,
      nylas_quote_option_id: option.id,
      nylas_pricing_state_hash: option.result.stateHash,
      nylas_line_item_source: source
    });
    var DISCOUNT_PRECISIONS = [2, 4, 6, 8, 10];
    var discountPercentageFor = (list, net) => {
      if (!(list > 0)) return null;
      const exact = (list - net) / list * 100;
      for (const decimals of DISCOUNT_PRECISIONS) {
        const candidate = round(exact, decimals);
        if (round(list * (1 - candidate / 100), 2) === round(net, 2)) return candidate;
      }
      return round(exact, DISCOUNT_PRECISIONS[DISCOUNT_PRECISIONS.length - 1]);
    };
    var netPrice = (properties = {}) => {
      const price = Number(properties.price);
      if (!Number.isFinite(price)) return null;
      const percentage = Number(properties.hs_discount_percentage);
      if (Number.isFinite(percentage) && percentage !== 0) {
        return round(price * (1 - percentage / 100), 2);
      }
      return round(price - Number(properties.discount || 0), 2);
    };
    var priceProperties = (price, listPrice) => {
      if (price == null) return {};
      const net = round(price, 2);
      if (listPrice == null) return { price: String(net), proposed_rate: String(net) };
      const list = round(listPrice, 2);
      if (list - net < 0.01) return { price: String(net), proposed_rate: String(net) };
      const percentage = discountPercentageFor(list, net);
      if (percentage == null) return { price: String(net), proposed_rate: String(net) };
      return {
        price: String(list),
        hs_discount_percentage: String(percentage),
        proposed_rate: String(net)
      };
    };
    var recurringProperties = ({
      option,
      key,
      component,
      product,
      price,
      listPrice,
      quantity,
      description,
      source,
      billingPeriodsPerYear
    }) => {
      const paymentsPerYear = billingPeriodsPerYear || option.result.paymentsPerYear;
      return {
        ...baseManagedProperties({ option, key, component, product, source }),
        quantity: String(quantity),
        // An omitted price means "use the product's default", and must stay omitted: round(undefined)
        // is NaN, and String(NaN) is the literal "NaN", which HubSpot would take as the price.
        ...priceProperties(price, listPrice),
        // Omitted when blank so HubSpot falls back to the product library's own description.
        // Sending '' would overwrite that with nothing.
        ...description ? { description: String(description).slice(0, 5e3) } : {},
        recurringbillingfrequency: paymentFrequency(paymentsPerYear),
        hs_recurring_billing_period: `P${option.input.termMonths}M`,
        // Follows the line's own frequency, not the deal's: a monthly line over a 24-month term has
        // 24 payments, not the 8 a quarterly schedule would give.
        hs_recurring_billing_number_of_payments: String(
          option.input.termMonths / 12 * paymentsPerYear
        ),
        // The derived contract start, so a line item's billing start cannot disagree with the
        // quote's effective start date or the Deal's contract dates.
        ...option.result.dates?.contractStartDate ? { hs_recurring_billing_start_date: option.result.dates.contractStartDate } : {}
      };
    };
    var oneTimeProperties = ({ option, key, component, product, price, listPrice, description, source }) => ({
      ...baseManagedProperties({ option, key, component, product, source }),
      quantity: "1",
      ...priceProperties(price, listPrice),
      ...description ? { description: String(description).slice(0, 5e3) } : {}
    });
    var EMAILS_PER_BAND_UNIT = 1e3;
    var graduatedTierProperties = (line) => {
      const tiers = line.proposedBandRates;
      if (!tiers || tiers.length === 0) return {};
      return {
        hs_pricing_model: "graduated",
        hs_tier_ranges: JSON.stringify(
          tiers.map(
            ({ lower, upper }) => upper == null ? { start: lower * EMAILS_PER_BAND_UNIT } : { start: lower * EMAILS_PER_BAND_UNIT, end: upper * EMAILS_PER_BAND_UNIT - 1 }
          )
        ),
        hs_tier_prices: JSON.stringify(
          tiers.map(({ rate }, index) => ({ index, price: round(rate, 2) }))
        )
        // `units` is NOT sent. It was, briefly, to label the tier bounds -- "0 - 50" reads better as
        // "0 - 50 /1,000 Emails". In this portal `units` is an ENUMERATION, and its options are
        // /GB's, /Emails, /Agent Accounts, /CA's, /Bot Hours. Sending "1,000 emails" returned
        // INVALID_OPTION, and because syncDealLineItems archives before it creates, that emptied the
        // Deal on 2026-08-28.
        //
        // /Emails is NOT a substitute: these bounds are in thousands, so labelling them /Emails would
        // state a range 1000x too small on a customer's contract. Better no unit than a wrong one --
        // the product's own name already says "Per 1,000 Emails Sent".
        //
        // To get the label back, add an option like "/1,000 Emails" to the Line item `units` property
        // in HubSpot, then send that exact string. Do not reintroduce this from the product's
        // unitOfMeasure, which is free text and will not match the enumeration.
      };
    };
    var buildMeteredLines = (option, source) => {
      const items = option.result.lines.slice().sort(
        (left, right) => productOrderIndex(left.productKey) - productOrderIndex(right.productKey)
      ).map((line) => {
        const product = CATALOG[line.productKey];
        if (!product) throw new Error("PRODUCT_MAPPING_REQUIRED");
        const isGraduated = line.listBandRates.length > 0;
        return {
          key: `metered:${line.productKey}`,
          properties: {
            ...recurringProperties({
              option,
              key: `metered:${line.productKey}`,
              component: "subscription_product",
              product,
              // Quantity 0: the Enterprise Drawdown Fee carries the money and usage comes out of
              // that pool, so these lines are the rate schedule and add nothing to the total.
              quantity: 0,
              // Monthly, whatever the payment schedule. These rates are per month, and the drawdown
              // fee is the only charge in the package that follows the deal's billing cadence.
              billingPeriodsPerYear: 12,
              // ALWAYS send this deal's rate. Never leave it to the product's default.
              //
              // The price used to be omitted unless the rep had discounted the product, on the
              // reasoning that HubSpot would then hydrate "the number the product library already
              // holds and the one the customer should see". That was wrong, and Shane Tjin caught it
              // on a live quote: the library holds ONE FLAT LIST PRICE per product, which is not
              // this deal's rate. Our rates are blended across the volume bands and adjusted for the
              // contract term and payment schedule, so they differ from the flat price on every
              // single line. On his quote Calendar-Only printed $1.20 where the agreed rate was
              // $0.96 -- 25% over -- and Email + Calendar printed $1.60 where it was $1.76.
              //
              // This is the same ownership rule the rest of the file follows, applied correctly: the
              // product library owns what a product IS (its name, its description), and this app
              // owns what was SOLD -- and the rate is what was sold.
              //
              // The original complaint behind the omission was real but separate: the code used to
              // send the monthly rate multiplied up to the billing period, so a $1.30/month product
              // showed $15.60. billingUnitRate is the MONTHLY rate, which is the basis the product
              // is priced on, so that does not recur here.
              //
              // Undiscounted, list and net are the same number and `discount` is omitted. Discounted,
              // `price` carries the list rate and `discount` the concession -- Holly's model: "The
              // unit price should always be the same, then we can add a unit discount, and then I
              // will show the net price."
              //
              // EXCEPT for a graduated product, where a single price is the wrong shape entirely.
              //
              // Agent Email is priced across four tiers, and the product carries those tiers in
              // HubSpot -- the quote renders them as "View tiered rates". Sending one blended figure
              // would collapse all four into a flat rate and throw that away, which is a worse
              // misrepresentation than the flat-price bug this block fixes. So a graduated line
              // still leaves the price alone and lets the product's own tiers show.
              //
              // That leaves a known gap, tracked separately: a DISCOUNTED graduated line cannot
              // express its concession this way, because the discounted per-tier rates need
              // hs_tier_prices, which is Revenue-Hub gated and not yet confirmed in this portal.
              // Until then a discounted Agent Email line shows list tiers rather than agreed ones.
              //
              // Zero is not sent either: a rate that blends to $0.00 would replace a real price
              // with a flat "$0.00".
              ...!isGraduated && line.billingUnitRate > 0 ? {
                price: line.billingUnitRate,
                listPrice: line.discretionaryDiscount !== 0 ? line.billingUnitRate / (1 - line.discretionaryDiscount) : void 0
              } : {},
              source
            }),
            // The adjusted tier table, on graduated lines only. Empty on every flat line, which
            // carries price/discount instead.
            ...isGraduated ? graduatedTierProperties(line) : {},
            // The AGREED (net) monthly rate, as its own field. `price` carries the LIST rate and
            // `discount` the concession, so the net is already derivable as price - discount --
            // but the standard quote template cannot do arithmetic across two columns, so the
            // Order Form needs the answer stored rather than computed. Custom property, created in
            // the portal 2026-08-27 as "Proposed Rate"; HubSpot fixed the internal name at
            // `proposed_rate`, so that is the name here.
            //
            // NOT a per-tier rate on Agent Email: that line is graduated, so this is a blended
            // figure across four tiers and the Order Form's tier table still needs hs_tier_prices.
            proposed_rate: String(line.billingUnitRate),
            // The monthly committed average, as data rather than the prose it used to sit in.
            // quantity stays 0 so these lines still contribute nothing to the Deal total -- the
            // committed money is carried by the drawdown fee, not by these rate-schedule lines.
            committed_quantity: String(line.volume)
          }
        };
      });
      return items;
    };
    var buildSubscriptionSummaryLine = (option, source) => ({
      key: "subscription:drawdown",
      properties: recurringProperties({
        option,
        key: "subscription:drawdown",
        component: "subscription_drawdown",
        product: CATALOG.enterprise,
        quantity: 1,
        price: option.result.proposedPlatformArr / option.result.paymentsPerYear,
        listPrice: option.result.listPlatformArr / option.result.paymentsPerYear,
        source
      })
    });
    var buildDealBundleLine = (option) => ({
      key: "subscription:nylas_enterprise",
      properties: recurringProperties({
        option,
        key: "subscription:nylas_enterprise",
        component: "subscription_drawdown",
        product: CATALOG.enterprise,
        quantity: 1,
        price: option.result.proposedPlatformArr / option.result.paymentsPerYear,
        listPrice: option.result.listPlatformArr / option.result.paymentsPerYear,
        source: "deal"
      })
    });
    var buildSupportLine = (option, source) => {
      const product = CATALOG[option.input.supportLevel] || CATALOG.basic;
      return [
        {
          key: `support:${option.input.supportLevel}`,
          properties: recurringProperties({
            option,
            key: `support:${option.input.supportLevel}`,
            component: "support",
            product,
            quantity: 1,
            price: option.result.supportAnnual / option.result.paymentsPerYear,
            listPrice: option.result.listSupportAnnual / option.result.paymentsPerYear,
            source
          })
        }
      ];
    };
    var buildAddOnLines = (option, source) => option.result.selectedAddOns.map((addOn) => {
      const product = CATALOG[addOn.key];
      if (!product) throw new Error("PRODUCT_MAPPING_REQUIRED");
      return {
        key: `addon:${addOn.key}`,
        properties: recurringProperties({
          option,
          key: `addon:${addOn.key}`,
          component: "subscription_add_on",
          product,
          quantity: 1,
          price: addOn.annualAmount / option.result.paymentsPerYear,
          listPrice: addOn.listAnnualAmount / option.result.paymentsPerYear,
          source
        })
      };
    });
    var buildOnboardingLines = (option, source) => {
      if (option.input.onboardingPackage === "none") return [];
      const product = CATALOG[option.input.onboardingPackage];
      if (!product) throw new Error("PRODUCT_MAPPING_REQUIRED");
      return [
        {
          key: `onboarding:${option.input.onboardingPackage}`,
          properties: oneTimeProperties({
            option,
            key: `onboarding:${option.input.onboardingPackage}`,
            component: "onboarding",
            product,
            price: option.result.onboardingAmount,
            // THE EFFECTIVE LIST, NOT THE CATALOGUE LIST.
            //
            // When a rep enters a price, that price IS the list price on the document -- so the line
            // prints one flat figure with no discount beside it. Passing the catalogue figure here
            // instead made the line read "5,000, 30% off", which is precisely the leak the flat
            // override exists to close: a visibly derived price invites the customer to shrink the
            // contract to shrink it (claude/post-release-followups-2026-09-02.md).
            //
            // result.listOnboardingAmount keeps the CATALOGUE figure and is still what listTcv and
            // pricing_list_price_tcv are built from -- the audit trail must show the departure from
            // the rate card even though the customer-facing document does not.
            listPrice: option.result.effectiveOnboardingList ?? option.result.listOnboardingAmount,
            source
          })
        }
      ];
    };
    var allocateBundle = (total, count) => {
      if (!count) return [];
      const share = round(total / count);
      const values = Array.from({ length: count }, () => share);
      values[count - 1] = round(total - share * (count - 1));
      return values;
    };
    var buildProfessionalServiceLines = (option, source) => {
      const selected = option.input.professionalServices || [];
      const prices = allocateBundle(option.result.professionalServicesAmount, selected.length);
      const listPrices = allocateBundle(
        option.result.effectiveProfessionalServicesList ?? option.result.listProfessionalServicesAmount,
        selected.length
      );
      return selected.map((key, index) => {
        const product = CATALOG[key];
        if (!product) throw new Error("PRODUCT_MAPPING_REQUIRED");
        return {
          key: `professional_service:${key}`,
          properties: oneTimeProperties({
            option,
            key: `professional_service:${key}`,
            component: "professional_services",
            product,
            price: prices[index],
            listPrice: listPrices[index],
            source
          })
        };
      });
    };
    var buildLineItems = (option, { source, presentation = "itemized_products" }) => {
      if (!option?.id || !option?.input || !option?.result?.stateHash) {
        throw new Error("OPTION_REQUIRED");
      }
      const subscriptionLines = [
        buildSubscriptionSummaryLine(option, source),
        ...presentation === "subscription_summary" ? [] : buildMeteredLines(option, source)
      ];
      return withFeeTotals(
        withPositions([
          ...subscriptionLines,
          ...buildSupportLine(option, source),
          ...buildAddOnLines(option, source),
          ...buildOnboardingLines(option, source),
          ...buildProfessionalServiceLines(option, source)
        ]),
        option
      );
    };
    var buildDealLineItems2 = (option) => withFeeTotals(
      withPositions([
        buildDealBundleLine(option),
        ...buildMeteredLines(option, "deal"),
        ...buildSupportLine(option, "deal"),
        ...buildAddOnLines(option, "deal"),
        ...buildOnboardingLines(option, "deal"),
        ...buildProfessionalServiceLines(option, "deal")
      ]),
      option
    );
    var buildQuoteLineItems2 = (option, content) => buildLineItems(option, {
      source: "quote",
      presentation: content.presentation
    });
    var contentHash2 = (option, content) => crypto2.createHash("sha256").update(JSON.stringify({ optionId: option.id, stateHash: option.result.stateHash, content })).digest("hex");
    module2.exports = {
      CATALOG,
      // Same reasoning as APPROVAL_TIERS in appSettings: no importer today, kept because it names the
      // fee slots any consumer of these line items has to understand.
      FEE_TOTAL_PROPERTIES,
      _test: { discountPercentageFor },
      buildDealLineItems: buildDealLineItems2,
      buildQuoteLineItems: buildQuoteLineItems2,
      contentHash: contentHash2,
      netPrice,
      normalizeQuoteContent: normalizeQuoteContent2
    };
  }
});

// productLibrary.js
var require_productLibrary = __commonJS({
  "productLibrary.js"(exports2, module2) {
    var rules = require_pricingRules();
    var { CATALOG } = require_lineItemModel();
    var TIER_PROPERTIES = ["hs_pricing_model", "hs_tier_ranges", "hs_tier_prices"];
    var PRODUCT_PROPERTIES = ["name", "price", "hs_sku", "recurringbillingfrequency", ...TIER_PROPERTIES];
    var sameMoney = (left, right) => {
      if (left == null || right == null) return left == null && right == null;
      return Math.abs(Number(left) - Number(right)) <= 5e-3;
    };
    var parseJsonProperty = (raw, label) => {
      if (raw == null || raw === "") return { value: null, error: null };
      try {
        const value = JSON.parse(raw);
        if (!Array.isArray(value)) {
          return { value: null, error: `${label} is not a JSON array` };
        }
        return { value, error: null };
      } catch {
        return { value: null, error: `${label} is not valid JSON` };
      }
    };
    var bandsFromTiers = (ranges, prices) => {
      const priceByIndex = /* @__PURE__ */ new Map();
      for (const entry of prices) {
        if (entry?.currency && entry.currency !== rules.currency) continue;
        if (Number.isInteger(entry?.index)) priceByIndex.set(entry.index, Number(entry.price));
      }
      return ranges.map((range, index) => [
        Number(range?.start ?? 0),
        range?.end == null ? null : Number(range.end) + 1,
        priceByIndex.has(index) ? priceByIndex.get(index) : null
      ]);
    };
    var UNIT_DIVISOR = { agent_email_thousands: 1e3 };
    var scaleBands = (bands, key) => {
      const divisor = UNIT_DIVISOR[key];
      if (!divisor) return bands;
      return bands.map(([lower, upper, rate]) => [
        lower / divisor,
        upper == null ? null : upper / divisor,
        rate
      ]);
    };
    var localExpectation = (key) => {
      const product = rules.products.find((entry) => entry.key === key);
      if (product) {
        return {
          kind: "metered",
          bands: product.bands.map(([lower, upper, rate]) => [lower, upper, rate]),
          pricingModel: product.pricingModel === "graduated_adjusted_bands" ? "graduated" : "flat",
          unitOfMeasure: product.unitOfMeasure
        };
      }
      const onboarding = rules.onboardingRules.find((entry) => entry.key === key);
      if (onboarding) return { kind: "one_time", amount: onboarding.oneTimeAmount };
      const addOn = rules.addOnRules.find((entry) => entry.key === key);
      if (addOn) return { kind: "recurring_annual", amount: addOn.annualAmount };
      if (key === "enterprise") {
        return { kind: "formula", note: "platform ARR divided across the payments in a year" };
      }
      if (rules.supportRules.some((entry) => entry.key === key)) {
        return { kind: "formula", note: "percentage of platform ARR with an annual cap" };
      }
      if (rules.professionalServiceOptions.some((entry) => entry.key === key)) {
        return { kind: "formula", note: "priced by how many services were selected, not per item" };
      }
      return { kind: "unpriced" };
    };
    var compareProduct = (key, catalogEntry, hubspot2) => {
      const row = {
        key,
        productId: catalogEntry.id,
        localName: catalogEntry.name,
        found: Boolean(hubspot2),
        disagreements: [],
        notes: []
      };
      if (!hubspot2) {
        row.disagreements.push({
          field: "product",
          local: catalogEntry.id,
          hubspot: null,
          detail: "no product with this id \u2014 line items built from it will fail"
        });
        return row;
      }
      const properties = hubspot2.properties || {};
      row.hubspotName = properties.name ?? null;
      row.hubspotPrice = properties.price == null ? null : Number(properties.price);
      row.sku = properties.hs_sku ?? null;
      row.hubspotPricingModel = properties.hs_pricing_model || "flat";
      row.tiersAvailable = Object.prototype.hasOwnProperty.call(properties, "hs_tier_ranges");
      if (row.hubspotName && row.hubspotName !== catalogEntry.name) {
        row.disagreements.push({
          field: "name",
          local: catalogEntry.name,
          hubspot: row.hubspotName,
          detail: "local label is stale; HubSpot owns the name"
        });
      }
      const expectation = localExpectation(key);
      row.localKind = expectation.kind;
      if (expectation.kind === "formula") {
        row.notes.push(`priced by rule, not by unit price: ${expectation.note}`);
        return row;
      }
      if (expectation.kind === "one_time" || expectation.kind === "recurring_annual") {
        if (!sameMoney(expectation.amount, row.hubspotPrice)) {
          row.disagreements.push({
            field: "price",
            local: expectation.amount,
            hubspot: row.hubspotPrice,
            detail: "fixed amount differs"
          });
        }
        return row;
      }
      if (expectation.kind !== "metered") return row;
      row.localPricingModel = expectation.pricingModel;
      if (row.hubspotPricingModel !== expectation.pricingModel) {
        row.disagreements.push({
          field: "hs_pricing_model",
          local: expectation.pricingModel,
          hubspot: row.hubspotPricingModel,
          detail: "graduated bills each tier separately; volume bills every unit at the landed tier"
        });
      }
      if (!row.tiersAvailable) {
        row.notes.push(
          "hs_tier_ranges absent \u2014 either this portal has no tiered pricing (Revenue Hub) or the property was not requested"
        );
        if (expectation.pricingModel === "graduated") {
          if (row.hubspotPrice != null && row.hubspotPrice !== 0) {
            row.disagreements.push({
              field: "price",
              local: null,
              hubspot: row.hubspotPrice,
              detail: "graduated product must not carry a flat unit price"
            });
          }
          return row;
        }
        const entryRate = expectation.bands[0][2];
        if (!sameMoney(entryRate, row.hubspotPrice)) {
          row.disagreements.push({
            field: "price",
            local: entryRate,
            hubspot: row.hubspotPrice,
            detail: expectation.bands.length === 1 ? "single-rate product, unit price differs" : `banded product, unit price must be the entry rate (band 1 of ${expectation.bands.length})`
          });
        }
        return row;
      }
      const ranges = parseJsonProperty(properties.hs_tier_ranges, "hs_tier_ranges");
      const prices = parseJsonProperty(properties.hs_tier_prices, "hs_tier_prices");
      if (ranges.error) row.notes.push(ranges.error);
      if (prices.error) row.notes.push(prices.error);
      if (!ranges.value || !prices.value) return row;
      const hubspotBands = scaleBands(bandsFromTiers(ranges.value, prices.value), key);
      row.hubspotBands = hubspotBands;
      row.localBands = expectation.bands;
      if (hubspotBands.length !== expectation.bands.length) {
        row.disagreements.push({
          field: "tier count",
          local: expectation.bands.length,
          hubspot: hubspotBands.length,
          detail: "different number of tiers \u2014 compare the tables directly"
        });
        return row;
      }
      expectation.bands.forEach(([lower, upper, rate], index) => {
        const [hsLower, hsUpper, hsRate] = hubspotBands[index];
        if (lower !== hsLower || upper !== hsUpper) {
          row.disagreements.push({
            field: `tier ${index + 1} range`,
            local: `${lower}\u2013${upper == null ? "\u221E" : upper}`,
            hubspot: `${hsLower}\u2013${hsUpper == null ? "\u221E" : hsUpper}`,
            detail: "boundaries differ (HubSpot end is inclusive; these are exclusive uppers)"
          });
        }
        if (!sameMoney(rate, hsRate)) {
          row.disagreements.push({
            field: `tier ${index + 1} rate`,
            local: rate,
            hubspot: hsRate,
            detail: "rate differs"
          });
        }
      });
      return row;
    };
    var readProducts = async (client, ids) => {
      const inputs = ids.map((id) => ({ id }));
      const attempts = [];
      const record = (source, results2, error) => {
        attempts.push({
          source,
          ok: !error,
          count: results2 ? results2.length : 0,
          tierPropertyReturned: Boolean(
            results2?.some(
              (entry) => Object.prototype.hasOwnProperty.call(entry.properties || {}, "hs_tier_ranges")
            )
          ),
          error: error ? String(error?.message || error) : null
        });
      };
      let results = null;
      try {
        const response2 = await client.crm.products.batchApi.read({
          inputs,
          properties: PRODUCT_PROPERTIES,
          propertiesWithHistory: []
        });
        results = response2?.results || [];
        record("crm/v3 batch read", results, null);
      } catch (error) {
        record("crm/v3 batch read", null, error);
      }
      if (!results?.length || !attempts[0].tierPropertyReturned) {
        try {
          const response2 = await client.apiRequest({
            method: "POST",
            path: "/crm/objects/2026-03/products/batch/read",
            body: { inputs, properties: PRODUCT_PROPERTIES, propertiesWithHistory: [] }
          });
          const body = typeof response2?.json === "function" ? await response2.json() : response2?.body;
          const dated = body?.results || [];
          record("crm/objects/2026-03 batch read", dated, null);
          if (dated.length && (!results?.length || attempts[1].tierPropertyReturned)) {
            results = dated;
          }
        } catch (error) {
          record("crm/objects/2026-03 batch read", null, error);
        }
      }
      return { results: results || [], attempts };
    };
    var inspectProductLibrary2 = async (client) => {
      const entries = Object.entries(CATALOG);
      const { results, attempts } = await readProducts(
        client,
        entries.map(([, entry]) => entry.id)
      );
      const byId = new Map(results.map((entry) => [String(entry.id), entry]));
      const rows = entries.map(([key, entry]) => compareProduct(key, entry, byId.get(String(entry.id))));
      const disagreeing = rows.filter((row) => row.disagreements.length > 0);
      return {
        checkedAt: (/* @__PURE__ */ new Date()).toISOString(),
        priceListVersion: rules.priceListVersion,
        reads: attempts,
        // The headline: whether this portal can express tiered pricing over the API at all. Sourcing
        // the rate card from HubSpot is impossible for graduated products if this is false.
        tieredPricingAvailable: rows.some((row) => row.tiersAvailable),
        productCount: rows.length,
        missingCount: rows.filter((row) => !row.found).length,
        disagreementCount: disagreeing.reduce((sum, row) => sum + row.disagreements.length, 0),
        rows
      };
    };
    module2.exports = {
      inspectProductLibrary: inspectProductLibrary2,
      _test: {
        bandsFromTiers,
        scaleBands,
        compareProduct,
        localExpectation,
        PRODUCT_PROPERTIES
      }
    };
  }
});

// catalog.js
var require_catalog = __commonJS({
  "catalog.js"(exports2, module2) {
    var pricingRules = require_pricingRules();
    var { buildActiveRules } = require_calculator();
    var PRODUCT_PRESENTATION = Object.freeze({
      connect_ca: { description: "Connected accounts", unit: "CA/month", sort: 10 },
      calendar_ca: { description: "Calendar-only accounts", unit: "calendars/month", sort: 20 },
      notetaker_bot_hours: { description: "Bot hours", unit: "bot hours/month", sort: 30 },
      agent_accounts: { description: "Agent accounts", unit: "accounts/month", sort: 40 },
      agent_email_thousands: { description: "Emails in thousands", unit: "1,000 emails", sort: 50 },
      agent_storage_gb: { description: "Storage", unit: "GB/month", sort: 60 },
      agent_bandwidth_gb: { description: "Bandwidth", unit: "GB/month", sort: 70 }
    });
    var LABEL_OVERRIDES = Object.freeze({
      support: { basic: "Basic", full: "Full", premium: "Premium" },
      onboarding: { quick_launch_plus: "Quick Launch Plus" },
      addOn: {
        // "(requires Professional Services)" is a real rule, not decoration: selecting this add-on
        // without a Professional Services item blocks Lock in. Saying so on the checkbox is cheaper
        // than letting the rep discover it from a red banner after building the quote.
        verified_oauth: "Turnkey Verified OAuth Projects (requires Professional Services)"
      },
      payment: {
        annual_in_advance: "Annual in Advance",
        semi_annual_in_advance: "Semi-Annual in Advance",
        quarterly_in_advance: "Quarterly in Advance",
        monthly_in_advance: "Monthly in Advance"
      }
    });
    var RETIRED_ADD_ONS = Object.freeze(["enterprise_accelerator"]);
    var override = (group, key, fallback) => LABEL_OVERRIDES[group]?.[key] ?? fallback;
    var presentationMismatch = (ruleKeys, presentationKeys) => {
      const missing = ruleKeys.filter((key) => !presentationKeys.includes(key));
      const extra = presentationKeys.filter((key) => !ruleKeys.includes(key));
      if (missing.length === 0 && extra.length === 0) return "";
      return `CATALOG_PRESENTATION_MISMATCH:${missing.length > 0 ? ` missing ${missing.join(",")}` : ""}${extra.length > 0 ? ` extra ${extra.join(",")}` : ""}`;
    };
    var assertPresentationCoverage = () => {
      const problem = presentationMismatch(
        pricingRules.products.map(({ key }) => key),
        Object.keys(PRODUCT_PRESENTATION)
      );
      if (problem) throw new Error(problem);
    };
    var buildCatalog2 = (pricingPolicy = {}) => {
      assertPresentationCoverage();
      const active = buildActiveRules(pricingPolicy);
      return {
        products: pricingRules.products.map(({ key, name }) => ({
          key,
          label: name,
          description: PRODUCT_PRESENTATION[key].description,
          unit: PRODUCT_PRESENTATION[key].unit,
          role: "metered",
          sort: PRODUCT_PRESENTATION[key].sort,
          // Band-priced per unit, so there is no single list price -- the bands are the price, and
          // they are already sent as productRates for the Settings screen.
          billingUnit: "per month",
          listPrice: null,
          deprecated: false
        })).sort((left, right) => left.sort - right.sort),
        // SUPPORT HAS NO FIXED LIST PRICE. It is percentOfPlatformArr of the proposed platform ARR,
        // capped at annualCap -- so its figure depends on the deal and is computed, never looked up.
        // listPrice is null on purpose: the card must compute it, not display a constant. The percent
        // and cap are sent so it can, and so an override can be checked against the cap.
        support: active.supportRules.map(({ key, level, percentOfPlatformArr, annualCap }) => ({
          key,
          label: override("support", key, level),
          role: "support",
          billingUnit: "per year",
          listPrice: null,
          percentOfPlatformArr,
          annualCap,
          deprecated: false
        })),
        onboarding: active.onboardingRules.map(({ key, package: name, oneTimeAmount }) => ({
          key,
          label: override("onboarding", key, name),
          role: "onboarding",
          billingUnit: "one-time",
          listPrice: oneTimeAmount,
          deprecated: false
        })),
        addOns: active.addOnRules.map(({ key, label, deprecated, annualAmount }) => ({
          key,
          label: override("addOn", key, label),
          role: "add_on",
          billingUnit: "per year",
          listPrice: annualAmount,
          // Either flag retires it: the rate card's own `deprecated`, or this module's list.
          deprecated: Boolean(deprecated) || RETIRED_ADD_ONS.includes(key)
        })),
        // PROFESSIONAL SERVICES ARE PRICED BY BUNDLE COUNT, NOT PER SERVICE.
        //
        // 1 -> 2,000 | 2 -> 3,800 | 3 -> 5,500 | 4 -> 7,200 | 5 -> 8,800. Note the break at 2: 3,800,
        // not 4,000. There is no per-service price and inventing one would not sum to the ladder, so
        // listPrice is null on every service and the ladder is sent separately. Holly, 2026-09-03:
        // one row carrying the ladder price, with the chosen services named beneath it.
        professionalServices: pricingRules.professionalServiceOptions.map(({ key, label }) => ({
          key,
          label,
          role: "professional_service",
          billingUnit: "one-time",
          listPrice: null,
          deprecated: false
        })),
        professionalServicesLadder: active.professionalServicesRules.map(
          ({ itemCount, oneTimeAmount }) => ({ itemCount, listPrice: oneTimeAmount })
        ),
        // The card used to restate 12/24/36 as literals beside allowedTerms. One source now.
        terms: pricingRules.allowedTerms.map((months) => ({
          key: months,
          label: `${months} months`
        })),
        payments: pricingRules.paymentRules.map(({ key, label }) => ({
          key,
          label: override("payment", key, label)
        }))
      };
    };
    var emptyProductMap = () => Object.fromEntries(pricingRules.products.map(({ key }) => [key, 0]));
    module2.exports = {
      buildCatalog: buildCatalog2,
      emptyProductMap,
      RETIRED_ADD_ONS,
      PRODUCT_PRESENTATION,
      _test: { assertPresentationCoverage, presentationMismatch, LABEL_OVERRIDES }
    };
  }
});

// appSettings.js
var require_appSettings = __commonJS({
  "appSettings.js"(exports2, module2) {
    var crypto2 = require("node:crypto");
    var pricingRules = require_pricingRules();
    var CONFIGURATION_KEY = "default";
    var OBJECT_NAME = "nylas_pricing_configuration";
    var MAX_PIPELINES = 30;
    var CALCULATION_METHODS = Object.freeze(["excel_compatible", "rounded_unit_rate"]);
    var LEGACY_PRODUCT_BAND_RATES = Object.freeze({
      agent_email_thousands: [0.5]
    });
    var defaultPricingPolicy = () => ({
      calculationMethod: "excel_compatible",
      minimumCommittedArr: pricingRules.minimumCommittedArr,
      // Off, from the rate card, which is where the decision is written down. Holly, 2026-08-31.
      enforceMinimumCommittedArr: pricingRules.enforceMinimumCommittedArr,
      redliningMinimumArr: pricingRules.redliningMinimumArr,
      // Credit card is refused on an invoice above this. Configurable like the other thresholds,
      // because it is a finance policy rather than a rate -- and because a hard-coded limit could not
      // be tested at its own boundary without contriving a deal that lands exactly on $25,000.
      creditCardMaximumInvoice: pricingRules.creditCardMaximumInvoice,
      salesDirectorDiscountMax: pricingRules.salesDirectorDiscountMax,
      headSalesDiscountMax: pricingRules.headSalesDiscountMax,
      // APPROVAL MATRIX (Holly, 2026-08-28). The THRESHOLDS are shared by both deal types -- only
      // who signs off changes:
      //
      //   no approval      0% deviation                                      all
      //   first tier       up to salesDirectorDiscountMax (10%)              Sales Director / CS Director
      //   second tier      that up to headSalesDiscountMax (30%)             Head of Sales / CCSO
      //   finance          above 30%, any 100%-off line, non-standard terms  all
      //
      // Term and payment-frequency adjustments are pre-approved and never counted: the ladder reads
      // largestDiscretionaryDiscount, which is only what a rep typed.
      //
      // Configurable because the approver for a concession is policy. An earlier build routed ALL
      // renewal discounts to the CCSO with no ladder; this table replaced it.
      newBusinessFirstApprovalTier: "sales_director",
      newBusinessSecondApprovalTier: "head_sales",
      renewalFirstApprovalTier: "cs_director",
      renewalSecondApprovalTier: "ccso",
      // A line given away entirely goes to Finance whatever the thresholds say. Redundant while
      // headSalesDiscountMax is 30% -- 100% already exceeds it -- but it stops a raised threshold from
      // quietly letting a free line through at a lower tier.
      financeApprovesFullDiscount: true,
      // Renewals still skip the non-discount BLOCKS: the Enterprise ARR minimum and the redlining ARR
      // threshold. Holly's call, and untouched by the table above, which is about approval rather than
      // about refusing a lock -- a renewal is expected to land under the new-business minimum, and
      // that rule blocks rather than escalates.
      renewalRelaxesNonDiscountApprovals: true,
      // DERIVED FROM pricingRules, every one of them. Do not hand-copy a rate into this file.
      //
      // These used to be typed out here, duplicating the rate card, while productBandRates below was
      // derived. Onboarding drifted: pricingRules said 5/10/15K -- confirmed by Holly, the workbook
      // RATE CARD, QUOTE BUILDER row 38 and the HubSpot product export on 2026-08-27 -- and this file
      // still said 0/5/10K. Because buildActiveRules reads the POLICY first
      // (`pricingPolicy.onboardingAmounts?.[key] ?? rule.oneTimeAmount`), the stale copy won and every
      // onboarding package was quoted $5,000 short. The tests did not catch it because they pass `{}`
      // as the policy, which falls through to pricingRules and never sees this table.
      //
      // Deriving makes that class of drift impossible. A rate change now happens in pricingRules.js
      // alone, and a test below asserts these stay equal to it.
      termDiscounts: Object.fromEntries(
        pricingRules.termRules.map(({ months, discount }) => [String(months), discount])
      ),
      paymentPremiums: Object.fromEntries(
        pricingRules.paymentRules.map(({ key, premium }) => [key, premium])
      ),
      support: Object.fromEntries(
        pricingRules.supportRules.map(({ key, percentOfPlatformArr, annualCap }) => [
          key,
          { percent: percentOfPlatformArr, cap: annualCap }
        ])
      ),
      onboardingAmounts: Object.fromEntries(
        pricingRules.onboardingRules.map(({ key, oneTimeAmount }) => [key, oneTimeAmount])
      ),
      // Indexed by the NUMBER of professional-services items, so it stays a dense array 0..5 rather
      // than a keyed object -- professionalServicesAmounts[3] is the three-item bundle.
      professionalServicesAmounts: pricingRules.professionalServicesRules.map(
        ({ oneTimeAmount }) => oneTimeAmount
      ),
      addOnAnnualAmounts: Object.fromEntries(
        pricingRules.addOnRules.map(({ key, annualAmount }) => [key, annualAmount])
      ),
      productBandRates: Object.fromEntries(
        pricingRules.products.map(({ key, bands }) => [key, bands.map((band) => band[2])])
      )
    });
    var defaultSettings = () => ({
      schemaVersion: "1.0",
      version: 0,
      allowNewBusiness: true,
      allowRenewals: false,
      newBusinessPipelineIds: [],
      renewalPipelineIds: [],
      // WHICH quote templates the card offers, and which one it preselects. Holly, 2026-08-28.
      //
      // An EMPTY list means "every usable template", which is what the card did before this existed --
      // so an unconfigured portal behaves exactly as it always has rather than showing an empty picker.
      // Choosing templates here narrows it; it never adds one the portal does not have.
      //
      // Everything else in Settings stays shared: one rate card, one set of thresholds. Only the
      // templates differ, so only the templates are nested.
      // ONE LIST. There is no longer a per-kind split.
      //
      // Quote kinds existed because the app printed three documents -- new business, change and
      // renewal -- and had to know which templates belonged to which. It cannot print the other two
      // any more: HubSpot refuses to create a change or renewal quote through the public API
      // ("'hs_type' must be set to 'INITIAL'"), so those are made in HubSpot, from the Deal. What is
      // left is one document and therefore one template list. Holly, 2026-09-01.
      //
      // These are the flat keys the app used before 2026-08-30, promoted back to being the real ones
      // rather than derived mirrors. Empty still means "offer every usable template", and an empty
      // default still falls back to the QUOTE_TEMPLATE_ID secret, exactly as before.
      enabledQuoteTemplateIds: [],
      defaultQuoteTemplateId: "",
      // EXTRA templates a renewal-pipeline Deal may also choose from. Added 2026-09-01.
      //
      // A change is now sent as an ORDINARY quote -- hs_type INITIAL, created by this app like any
      // other -- carrying the Change template so the document reads correctly. A HubSpot workflow
      // terminates the prior contract when the customer accepts, and the accepted quote's own contract
      // becomes the live one. Holly's design; it sidesteps the fact that the public API will not create
      // a CHANGE or RENEWAL quote at all.
      //
      // A SECOND LIST rather than more entries in enabledQuoteTemplateIds, and that is the whole point:
      // a new-business Deal must keep offering exactly what it offers today. Holly, 2026-09-01: "Don't
      // touch ANYTHING with new business." Putting the Change template in the shared list would have
      // put it in the new-business picker too.
      //
      // EMPTY IS THE DEFAULT and means "renewal Deals see the same list as everyone else", so a portal
      // that never sets this behaves exactly as it did before the key existed.
      renewalQuoteTemplateIds: [],
      // The CHANGE templates, kept in their OWN list rather than folded in with renewal.
      //
      // Behaviourally the two are identical today -- both are offered on a renewal-pipeline Deal, both
      // produce an ordinary INITIAL quote. The split exists so the app can still say WHICH of the three
      // documents a quote was meant to be, and record it. Holly, 2026-09-02: "I want to make sure
      // there's all three because I feel like the API will become available to do what we need to do.
      // But for the time being I need to keep all of the data I can."
      //
      // READ ONLY FOR RECORDING. Nothing may branch on the kind. That coupling -- kind deciding
      // templates, contracts and hs_type -- is what was removed on 2026-09-01, and it broke all three
      // flows on the way out.
      changeQuoteTemplateIds: [],
      // The default on a renewal-pipeline Deal. Falls back to defaultQuoteTemplateId when unset, which
      // is what every portal had before this key existed.
      //
      // Without it a renewal Deal opened on the NEW BUSINESS template and the rep had to notice and
      // change it -- a manual step, and a forgettable one.
      renewalDefaultQuoteTemplateId: "",
      // DERIVED MIRROR, the inverse of what this key used to be. Never edited; written on every save.
      //
      // It IS still read, in one place and for one reason: a record written before the kinds were
      // removed carries only this key, so quoteTemplateSettings and normalizeSettings fall back to its
      // new_business entry. That is the migration. Once a portal saves from the current Settings screen
      // the flat keys win and this becomes write-only.
      //
      // It exists so a ROLLBACK is survivable, the same reason the flat keys used to exist. Code that
      // predates this change reads quoteTemplatesByKind and would find nothing; every kind therefore
      // mirrors the one list, which is what a single list meant before kinds existed. Without it, a
      // record saved by this Settings screen makes the older normalizeSettings throw INVALID_SETTINGS,
      // which readSettings turns into SETTINGS_CONFIGURATION_REQUIRED -- taking the whole card down,
      // not just Settings, for anyone who rolls back after a save.
      quoteTemplatesByKind: {
        new_business: { enabledIds: [], defaultId: "" },
        change: { enabledIds: [], defaultId: "" },
        renewal: { enabledIds: [], defaultId: "" }
      },
      pricingPolicy: defaultPricingPolicy()
    });
    var compactVolume = (value) => {
      const n = Number(value);
      if (!Number.isFinite(n)) return String(value);
      if (n === 0) return "0";
      if (n % 1e6 === 0) return `${n / 1e6}M`;
      if (n >= 1e6) return `${Number((n / 1e6).toFixed(1))}M`;
      if (n % 1e3 === 0) return `${n / 1e3}K`;
      if (n >= 1e3) return `${Number((n / 1e3).toFixed(1))}K`;
      return String(n);
    };
    var bandLabel = ([from, to]) => to == null ? `${compactVolume(from)}+` : `${compactVolume(from)}\u2013${compactVolume(to)}`;
    var productRateDescriptors2 = () => pricingRules.products.map(({ key, name, unitOfMeasure, bands }) => ({
      key,
      label: unitOfMeasure ? `${name} \u2014 ${unitOfMeasure}` : name,
      bands: bands.map(bandLabel)
    }));
    var APPROVAL_TIERS = Object.freeze([
      "none",
      "sales_director",
      "cs_director",
      "head_sales",
      "ccso",
      "finance"
    ]);
    var normalizeTemplateId = (value, field) => {
      if (value == null || value === "") return "";
      const id = String(value);
      if (!/^\d{1,20}$/.test(id)) throw new Error(`INVALID_SETTINGS:${field}`);
      return id;
    };
    var quoteTemplateSettings2 = (settings, category) => {
      const flatEnabled = settings?.enabledQuoteTemplateIds;
      const flatDefault = settings?.defaultQuoteTemplateId;
      const legacy = settings?.quoteTemplatesByKind?.new_business;
      const shared = (Array.isArray(flatEnabled) && flatEnabled.length > 0 ? flatEnabled : legacy?.enabledIds) || [];
      const renewalExtras = category === "renewal" ? [
        ...Array.isArray(settings?.renewalQuoteTemplateIds) ? settings.renewalQuoteTemplateIds : [],
        ...Array.isArray(settings?.changeQuoteTemplateIds) ? settings.changeQuoteTemplateIds : []
      ] : [];
      const renewalOnly = category === "renewal" && renewalExtras.length > 0;
      return {
        // De-duplicated, shared list first, so the order the picker renders is stable.
        enabledIds: [
          ...new Set((renewalOnly ? renewalExtras : [...shared, ...renewalExtras]).map(String))
        ],
        // A renewal Deal opens on the renewal default when one is set. Everything else, and a renewal
        // portal that has not set one, opens on the shared default exactly as before.
        defaultId: category === "renewal" && settings?.renewalDefaultQuoteTemplateId || flatDefault || legacy?.defaultId || ""
      };
    };
    var quoteKindForTemplate2 = (settings, templateId) => {
      const id = String(templateId || "");
      if (!id) return null;
      const lists = [
        ["change", settings?.changeQuoteTemplateIds],
        ["renewal", settings?.renewalQuoteTemplateIds],
        ["new_business", settings?.enabledQuoteTemplateIds]
      ];
      const match = lists.find(
        ([, ids]) => Array.isArray(ids) && ids.map(String).includes(id)
      );
      return match ? match[0] : null;
    };
    var requireApprovalTier = (value, field) => {
      if (!APPROVAL_TIERS.includes(value)) throw new Error(`INVALID_SETTINGS:${field}`);
      return value;
    };
    var requireNumber = (value, min, max, field) => {
      if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
        throw new Error(`INVALID_SETTINGS:${field}`);
      }
      return Math.round((value + Number.EPSILON) * 1e6) / 1e6;
    };
    var normalizePricingPolicy = (incoming) => {
      const defaults = defaultPricingPolicy();
      const value = incoming && typeof incoming === "object" && !Array.isArray(incoming) ? incoming : defaults;
      if (value.calculationMethod != null && !CALCULATION_METHODS.includes(value.calculationMethod)) {
        throw new Error("INVALID_SETTINGS:calculationMethod");
      }
      const policy = {
        calculationMethod: CALCULATION_METHODS.includes(value.calculationMethod) ? value.calculationMethod : defaults.calculationMethod,
        minimumCommittedArr: requireNumber(
          value.minimumCommittedArr ?? defaults.minimumCommittedArr,
          0,
          1e9,
          "minimumCommittedArr"
        ),
        enforceMinimumCommittedArr: typeof value.enforceMinimumCommittedArr === "boolean" ? value.enforceMinimumCommittedArr : defaults.enforceMinimumCommittedArr,
        redliningMinimumArr: requireNumber(
          value.redliningMinimumArr ?? defaults.redliningMinimumArr,
          0,
          1e9,
          "redliningMinimumArr"
        ),
        creditCardMaximumInvoice: requireNumber(
          value.creditCardMaximumInvoice ?? defaults.creditCardMaximumInvoice,
          0,
          1e9,
          "creditCardMaximumInvoice"
        ),
        salesDirectorDiscountMax: requireNumber(
          value.salesDirectorDiscountMax ?? defaults.salesDirectorDiscountMax,
          0,
          1,
          "salesDirectorDiscountMax"
        ),
        newBusinessFirstApprovalTier: requireApprovalTier(
          value.newBusinessFirstApprovalTier ?? defaults.newBusinessFirstApprovalTier,
          "newBusinessFirstApprovalTier"
        ),
        newBusinessSecondApprovalTier: requireApprovalTier(
          value.newBusinessSecondApprovalTier ?? defaults.newBusinessSecondApprovalTier,
          "newBusinessSecondApprovalTier"
        ),
        renewalFirstApprovalTier: requireApprovalTier(
          value.renewalFirstApprovalTier ?? defaults.renewalFirstApprovalTier,
          "renewalFirstApprovalTier"
        ),
        renewalSecondApprovalTier: requireApprovalTier(
          value.renewalSecondApprovalTier ?? defaults.renewalSecondApprovalTier,
          "renewalSecondApprovalTier"
        ),
        financeApprovesFullDiscount: typeof value.financeApprovesFullDiscount === "boolean" ? value.financeApprovesFullDiscount : defaults.financeApprovesFullDiscount,
        renewalRelaxesNonDiscountApprovals: typeof value.renewalRelaxesNonDiscountApprovals === "boolean" ? value.renewalRelaxesNonDiscountApprovals : defaults.renewalRelaxesNonDiscountApprovals,
        headSalesDiscountMax: requireNumber(
          value.headSalesDiscountMax ?? defaults.headSalesDiscountMax,
          0,
          1,
          "headSalesDiscountMax"
        ),
        termDiscounts: {},
        paymentPremiums: {},
        support: {},
        onboardingAmounts: {},
        professionalServicesAmounts: [],
        addOnAnnualAmounts: {},
        productBandRates: {}
      };
      if (policy.salesDirectorDiscountMax > policy.headSalesDiscountMax) {
        throw new Error("INVALID_SETTINGS:discountThresholds");
      }
      for (const key of ["12", "24", "36"]) {
        policy.termDiscounts[key] = requireNumber(
          value.termDiscounts?.[key] ?? defaults.termDiscounts[key],
          0,
          1,
          `termDiscounts.${key}`
        );
      }
      for (const key of Object.keys(defaults.paymentPremiums)) {
        policy.paymentPremiums[key] = requireNumber(
          value.paymentPremiums?.[key] ?? defaults.paymentPremiums[key],
          0,
          1,
          `paymentPremiums.${key}`
        );
      }
      for (const key of Object.keys(defaults.support)) {
        policy.support[key] = {
          percent: requireNumber(
            value.support?.[key]?.percent ?? defaults.support[key].percent,
            0,
            1,
            `support.${key}.percent`
          ),
          cap: requireNumber(
            value.support?.[key]?.cap ?? defaults.support[key].cap,
            0,
            1e9,
            `support.${key}.cap`
          )
        };
      }
      for (const key of Object.keys(defaults.onboardingAmounts)) {
        policy.onboardingAmounts[key] = requireNumber(
          value.onboardingAmounts?.[key] ?? defaults.onboardingAmounts[key],
          0,
          1e9,
          `onboardingAmounts.${key}`
        );
      }
      if (value.professionalServicesAmounts != null && (!Array.isArray(value.professionalServicesAmounts) || value.professionalServicesAmounts.length !== 6)) {
        throw new Error("INVALID_SETTINGS:professionalServicesAmounts");
      }
      policy.professionalServicesAmounts = defaults.professionalServicesAmounts.map(
        (amount, index) => requireNumber(
          value.professionalServicesAmounts?.[index] ?? amount,
          0,
          1e9,
          `professionalServicesAmounts.${index}`
        )
      );
      for (const key of Object.keys(defaults.addOnAnnualAmounts)) {
        policy.addOnAnnualAmounts[key] = requireNumber(
          value.addOnAnnualAmounts?.[key] ?? defaults.addOnAnnualAmounts[key],
          0,
          1e9,
          `addOnAnnualAmounts.${key}`
        );
      }
      for (const product of pricingRules.products) {
        const incomingRates = value.productBandRates?.[product.key];
        const defaultRates = defaults.productBandRates[product.key];
        if (incomingRates != null && (!Array.isArray(incomingRates) || incomingRates.length > product.bands.length)) {
          throw new Error(`INVALID_SETTINGS:productBandRates.${product.key}`);
        }
        const legacyDefaults = LEGACY_PRODUCT_BAND_RATES[product.key];
        const isUnmodifiedLegacyDefault = Array.isArray(incomingRates) && Array.isArray(legacyDefaults) && incomingRates.length === legacyDefaults.length && incomingRates.every((rate, index) => rate === legacyDefaults[index]);
        policy.productBandRates[product.key] = defaultRates.map(
          (rate, index) => requireNumber(
            isUnmodifiedLegacyDefault ? rate : incomingRates?.[index] ?? rate,
            0,
            1e6,
            `productBandRates.${product.key}.${index}`
          )
        );
      }
      return policy;
    };
    var accountIdFromContext2 = (context) => String(
      context?.accountId || context?.portal?.id || context?.portalId || context?.hubId || context?.hubspot?.portalId || ""
    );
    var userIdFromContext2 = (context) => String(context?.userId || context?.user?.id || context?.user?.userId || "");
    var objectTypeForAccount = (accountId) => {
      if (!/^\d{1,20}$/.test(accountId)) throw new Error("SETTINGS_CONFIGURATION_REQUIRED");
      return `p${accountId}_${OBJECT_NAME}`;
    };
    var normalizePipelineIds = (value, field) => {
      if (!Array.isArray(value) || value.length > MAX_PIPELINES) {
        throw new Error(`INVALID_SETTINGS:${field}`);
      }
      return [...new Set(value.map(String))].map((id) => {
        if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error(`INVALID_SETTINGS:${field}`);
        return id;
      });
    };
    var normalizeSettings = (value, currentVersion = 0) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("INVALID_SETTINGS:settings");
      }
      if (typeof value.allowNewBusiness !== "boolean" || typeof value.allowRenewals !== "boolean") {
        throw new Error("INVALID_SETTINGS:allowedDealTypes");
      }
      if (!value.allowNewBusiness && !value.allowRenewals) {
        throw new Error("INVALID_SETTINGS:allowedDealTypes");
      }
      const legacyNewBusiness = value.quoteTemplatesByKind?.new_business;
      const enabledQuoteTemplateIds = normalizePipelineIds(
        (Array.isArray(value.enabledQuoteTemplateIds) && value.enabledQuoteTemplateIds.length > 0 ? value.enabledQuoteTemplateIds : legacyNewBusiness?.enabledIds) || [],
        "enabledQuoteTemplateIds"
      );
      const defaultQuoteTemplateId = normalizeTemplateId(
        value.defaultQuoteTemplateId || legacyNewBusiness?.defaultId || "",
        "defaultQuoteTemplateId"
      );
      const mirrored = { enabledIds: enabledQuoteTemplateIds, defaultId: defaultQuoteTemplateId };
      return {
        schemaVersion: "1.0",
        version: currentVersion,
        allowNewBusiness: value.allowNewBusiness,
        allowRenewals: value.allowRenewals,
        newBusinessPipelineIds: normalizePipelineIds(
          value.newBusinessPipelineIds || [],
          "newBusinessPipelineIds"
        ),
        enabledQuoteTemplateIds,
        defaultQuoteTemplateId,
        // Derived, every save. See defaultSettings for why this is still written.
        quoteTemplatesByKind: {
          new_business: mirrored,
          change: mirrored,
          renewal: mirrored
        },
        renewalPipelineIds: normalizePipelineIds(
          value.renewalPipelineIds || [],
          "renewalPipelineIds"
        ),
        renewalQuoteTemplateIds: normalizePipelineIds(
          value.renewalQuoteTemplateIds || [],
          "renewalQuoteTemplateIds"
        ),
        changeQuoteTemplateIds: normalizePipelineIds(
          value.changeQuoteTemplateIds || [],
          "changeQuoteTemplateIds"
        ),
        renewalDefaultQuoteTemplateId: normalizeTemplateId(
          value.renewalDefaultQuoteTemplateId || "",
          "renewalDefaultQuoteTemplateId"
        ),
        pricingPolicy: normalizePricingPolicy(value.pricingPolicy)
      };
    };
    var request = async (accessToken, path, options = {}) => {
      if (typeof accessToken !== "string" || accessToken.length < 20) {
        throw new Error("SETTINGS_CONFIGURATION_REQUIRED");
      }
      const response2 = await fetch(`https://api.hubapi.com${path}`, {
        method: options.method || "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...options.body ? { "Content-Type": "application/json" } : {}
        },
        ...options.body ? { body: JSON.stringify(options.body) } : {}
      });
      const text = await response2.text();
      let body = {};
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = {};
        }
      }
      if (!response2.ok) {
        const error = new Error(`HUBSPOT_SETTINGS_API:${response2.status}`);
        error.statusCode = response2.status;
        throw error;
      }
      return body;
    };
    var readSettings2 = async (accessToken, accountId) => {
      const objectType = objectTypeForAccount(accountId);
      let result;
      try {
        result = await request(accessToken, `/crm/v3/objects/${encodeURIComponent(objectType)}/search`, {
          method: "POST",
          body: {
            filterGroups: [
              { filters: [{ propertyName: "configuration_key", operator: "EQ", value: CONFIGURATION_KEY }] }
            ],
            properties: ["configuration_key", "configuration_json"],
            limit: 1
          }
        });
      } catch (error) {
        if (error.statusCode === 400 || error.statusCode === 404) {
          return { recordId: null, settings: defaultSettings(), configured: false };
        }
        throw error;
      }
      const record = result.results?.[0];
      if (!record) return { recordId: null, settings: defaultSettings(), configured: true };
      try {
        const parsed = JSON.parse(record.properties?.configuration_json || "{}");
        const version = Number.isInteger(parsed.version) && parsed.version >= 0 ? parsed.version : 0;
        return {
          recordId: String(record.id),
          settings: normalizeSettings(parsed, version),
          configured: true
        };
      } catch {
        throw new Error("SETTINGS_CONFIGURATION_REQUIRED");
      }
    };
    var saveSettings2 = async (accessToken, accountId, userId, incoming, expectedVersion) => {
      const current = await readSettings2(accessToken, accountId);
      if (!current.configured) throw new Error("SETTINGS_CONFIGURATION_REQUIRED");
      if (!Number.isInteger(expectedVersion) || expectedVersion !== current.settings.version) {
        throw new Error("SETTINGS_CONFLICT");
      }
      const settings = normalizeSettings(incoming, current.settings.version + 1);
      const properties = {
        configuration_key: CONFIGURATION_KEY,
        configuration_json: JSON.stringify(settings),
        updated_by_user_id: String(userId).slice(0, 30),
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      };
      const objectType = objectTypeForAccount(accountId);
      if (current.recordId) {
        await request(
          accessToken,
          `/crm/v3/objects/${encodeURIComponent(objectType)}/${encodeURIComponent(current.recordId)}`,
          { method: "PATCH", body: { properties } }
        );
      } else {
        await request(accessToken, `/crm/v3/objects/${encodeURIComponent(objectType)}`, {
          method: "POST",
          body: { properties }
        });
      }
      return settings;
    };
    var readDealPipelines2 = async (accessToken) => {
      const result = await request(accessToken, "/crm/v3/pipelines/deals");
      return (result.results || []).filter(({ id, label }) => id && label).slice(0, MAX_PIPELINES).map(({ id, label }) => ({ id: String(id), label: String(label).slice(0, 120) }));
    };
    var isSettingsAdmin2 = (context) => {
      const actual = userIdFromContext2(context);
      const allowed = String(process.env.SETTINGS_ADMIN_USER_IDS || "").split(",").map((value) => value.trim()).filter(Boolean);
      return Boolean(actual) && allowed.some((expected) => {
        if (expected.length !== actual.length) return false;
        return crypto2.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
      });
    };
    var dealCategory2 = (settings, dealType, pipelineId) => {
      if (settings.renewalPipelineIds.includes(pipelineId)) return "renewal";
      if (settings.newBusinessPipelineIds.includes(pipelineId)) return "new_business";
      const normalized = String(dealType || "").toLowerCase().replace(/[^a-z]/g, "");
      if (!normalized) return "new_business";
      if (normalized === "newbusiness") return "new_business";
      if (normalized === "renewal") return "renewal";
      return "unsupported";
    };
    var isDealAllowed2 = (settings, dealType, pipelineId) => {
      const category = dealCategory2(settings, dealType, pipelineId);
      return category === "new_business" && settings.allowNewBusiness || category === "renewal" && settings.allowRenewals;
    };
    module2.exports = {
      // Exported with no importer today, and kept on purpose: it is the list of tiers the card would
      // need to label an approval, and validation reads it. A named constant describing the module's
      // contract is not dead code just because nothing imports it yet.
      APPROVAL_TIERS,
      accountIdFromContext: accountIdFromContext2,
      productRateDescriptors: productRateDescriptors2,
      dealCategory: dealCategory2,
      defaultPricingPolicy,
      defaultSettings,
      isDealAllowed: isDealAllowed2,
      isSettingsAdmin: isSettingsAdmin2,
      normalizeSettings,
      quoteTemplateSettings: quoteTemplateSettings2,
      quoteKindForTemplate: quoteKindForTemplate2,
      readDealPipelines: readDealPipelines2,
      readSettings: readSettings2,
      saveSettings: saveSettings2,
      userIdFromContext: userIdFromContext2
    };
  }
});

// QuoteOptionsFunction.js
var crypto = require("node:crypto");
var hubspot = require("@hubspot/api-client");
var { QuoteValidationError, calculateQuote, normalizeStoredInput } = require_calculator();
var { inspectProductLibrary } = require_productLibrary();
var { buildCatalog } = require_catalog();
var rateCardLabels = require_pricingRules();
var {
  accountIdFromContext,
  isDealAllowed,
  isSettingsAdmin,
  productRateDescriptors,
  readDealPipelines,
  readSettings,
  saveSettings,
  userIdFromContext,
  dealCategory,
  quoteTemplateSettings,
  quoteKindForTemplate
} = require_appSettings();
var {
  buildDealLineItems,
  buildQuoteLineItems,
  contentHash,
  normalizeQuoteContent
} = require_lineItemModel();
var OPTION_PROPERTY = "pricing_quote_options_payload";
var SELECTED_OPTION_ID_PROPERTY = "pricing_selected_option_id";
var SELECTED_OPTION_NAME_PROPERTY = "pricing_selected_option_name";
var DEFAULT_QUOTE_TEMPLATE_ID = "567553820432";
var configuredQuoteTemplateId = () => DEFAULT_QUOTE_TEMPLATE_ID || String(process.env.QUOTE_TEMPLATE_ID || "");
var DEAL_PAYMENT_METHOD = Object.freeze({
  property: "payment_method",
  values: Object.freeze({
    credit_card: "Credit Card",
    ach: "ACH/Bank Transfer"
  })
});
var DEAL_AUTO_RENEWAL = Object.freeze({
  property: "auto_renewal__c",
  values: Object.freeze({
    yes: "Yes",
    no: "No"
  })
});
var DEAL_PAYMENT_FREQUENCY = Object.freeze({
  property: "payment_frequency",
  values: Object.freeze({
    annual_in_advance: "Annual In Advance",
    semi_annual_in_advance: "Semi-Annual In Advance",
    quarterly_in_advance: "Quarterly In Advance",
    monthly_in_advance: "Monthly In Advance"
  })
});
var DEAL_CONTRACT_TERM_PROPERTY = "contract_term__months_";
var DEAL_CHOICE_PROPERTIES = [
  DEAL_PAYMENT_METHOD,
  DEAL_PAYMENT_FREQUENCY,
  DEAL_AUTO_RENEWAL
];
var CALCULATOR_DETAILS_PROPERTY = "calculator_details";
var UNVERIFIED_DEAL_PROPERTIES = [
  DEAL_CONTRACT_TERM_PROPERTY,
  // Created by Holly 2026-09-02 to hold what the calculator knows and HubSpot cannot yet act on.
  // Guarded like the rest: if the internal name is not what the portal actually has, the write is
  // dropped with a warning rather than failing the lock.
  CALCULATOR_DETAILS_PROPERTY,
  // Both of these mirror a property the app already writes under a different name --
  // pricing_approval_reasons and pricing_latest_quote_id -- because the portal's list shows these
  // names instead and the approval block reads one of each pair. Guarded, so the one the portal
  // lacks is dropped rather than failing the commit.
  "pricing_approval_notes",
  "pricing_quote_id",
  "pricing_contract_type",
  "pricing_multi_year_discount_pct",
  "pricing_multi_product_discount_pct",
  "pricing_discount_reason",
  "pricing_approval_timestamp",
  // Added 2026-08-30 and NEVER verified against this portal. Guarded like the rest: if the
  // property does not exist, it is dropped and the update retried rather than failing a commit
  // that runs after the Deal's line items have already been archived. special_terms itself is not
  // in this list -- it has been written on every lock for days without a rejection, so the portal
  // demonstrably has it.
  "special_terms_included",
  // Added 2026-09-01 from the portal's property editor. Guarded for the usual reason and one more:
  // whether either is a multiple-checkboxes field or a single-select was read off a screenshot, and
  // a single-select rejects the semicolon-joined value. If that is what it turns out to be, the
  // warning in updateDealProperties names the property and the Lock in still completes.
  "professional_services_package",
  // CONFIRMED multiple-checkboxes by Holly, 2026-09-01, so the semicolon-joined value is right.
  // Still guarded, like everything else here whose name came from outside the code.
  "pricing_subscription_addons",
  "pricing_contract_summary",
  // Added 2026-09-02 at Holly's request, to split recurring revenue three ways on the Deal. All
  // three were confirmed to exist as `number` properties in portal 45023718 before the first
  // write, so the guard is belt and braces rather than a guess -- but a property that exists today
  // can be renamed, and this update runs after the Deal's line items are already archived.
  "enterprise_drawdown_commitment_arr",
  "subscription_add_ons_arr",
  "subscription_support_arr",
  // The full-term fee breakdown, added the same day and confirmed the same way. `amount` is
  // deliberately NOT here: it is a HubSpot-defined Deal property present in every portal, so a
  // rejection naming it would mean something is wrong that dropping it would hide.
  "product_licensing_fees",
  "add_on_fees",
  "support_fees",
  "onboarding_fees",
  "professional_services_fees"
];
var choiceProperty = ({ property, values }, choice) => {
  if (!property) return {};
  if (choice === "" || choice == null) return { [property]: "" };
  const value = values[String(choice)];
  return value ? { [property]: value } : {};
};
var paymentMethodProperties = (paymentMethod) => choiceProperty(DEAL_PAYMENT_METHOD, paymentMethod);
var paymentFrequencyProperties = (paymentFrequency) => choiceProperty(DEAL_PAYMENT_FREQUENCY, paymentFrequency);
var autoRenewalProperties = (autoRenewal) => choiceProperty(DEAL_AUTO_RENEWAL, autoRenewal === true ? "yes" : "no");
var contractTermProperties = (termMonths) => {
  const months = Number(termMonths);
  if (!Number.isFinite(months) || months <= 0) return {};
  return { [DEAL_CONTRACT_TERM_PROPERTY]: String(months) };
};
var DISCOUNT_REASON_MAX_LENGTH = 4e3;
var discountReasonProperties = (discountReason) => {
  if (typeof discountReason !== "string") return {};
  return {
    pricing_discount_reason: discountReason.trim().slice(0, DISCOUNT_REASON_MAX_LENGTH)
  };
};
var QUOTE_STATUS_PENDING_APPROVAL = "PENDING_APPROVAL";
var QUOTE_STATUS_APPROVAL_NOT_NEEDED = "APPROVAL_NOT_NEEDED";
var QUOTE_STATUS_DRAFT = "DRAFT";
var ARCHIVABLE_QUOTE_STATUSES = Object.freeze([
  "DRAFT",
  QUOTE_STATUS_PENDING_APPROVAL,
  QUOTE_STATUS_APPROVAL_NOT_NEEDED,
  "REJECTED"
]);
var QUOTE_ACCEPTANCE_METHOD = "clickwrap";
var MAX_OPTIONS = 10;
var MAX_PAYLOAD_LENGTH = 6e4;
var SAFE_ERRORS = Object.freeze({
  CONFIGURATION_REQUIRED: "The Nylas Pricing properties have not been provisioned yet.",
  CONFLICT: "Another user changed these quote options. Reload the card and try again.",
  INVALID_DEAL: "Nylas Pricing is not available on this Deal. Its pipeline is not one of the pipelines enabled in Settings > Deal Eligibility.",
  INVALID_OPTION: "The quote option contains invalid or incomplete information.",
  INVALID_QUOTE_CONTENT: "The quote display choices are invalid or incomplete.",
  LINE_ITEM_SYNC_FAILED: "HubSpot could not replace the Deal line items. Review the Deal before trying again.",
  DISCOUNT_REASON_REQUIRED: "A reason is required when a rate departs from the rate card, in either direction. Add one and try again.",
  QUOTE_CONTRACT_REQUIRED: "Choose which contract this renewal is for, then Lock in again.",
  QUOTE_CONTACT_REQUIRED: "A contact is required on the Quote. Choose one on the pricing card, or associate a contact with this Deal.",
  QUOTE_TEMPLATE_NOT_CPQ: "That quote template is a legacy template and cannot be used. Choose a CPQ template on the card, or change which templates are offered in Settings > Quote Templates.",
  QUOTE_NOT_ADOPTABLE: "That quote can no longer be priced. It has to be a draft Change or Renewal quote on this Deal. Reload the card to see the current list.",
  OPTION_BLOCKED: "This option has blocking policy issues and cannot be selected.",
  PAYMENT_METHOD_REQUIRES_BANK_TRANSFER: "Credit card is not permitted on an invoice above the limit. Set Payment Method to Bank transfer / ACH before locking in.",
  OPTION_NOT_FOUND: "The selected quote option could not be found.",
  OPTION_REQUIRED: "Select or calculate a quote option first.",
  OPTION_RECALCULATION_REQUIRED: "Pricing rules changed after this option was calculated. Recalculate it before continuing.",
  TOO_MANY_OPTIONS: `A Deal can contain no more than ${MAX_OPTIONS} active quote options.`,
  TOO_MANY_LINE_ITEMS: "This Deal has more line items than the pricing app can manage. Reduce them and try again.",
  PAYLOAD_TOO_LARGE: "The saved quote options exceed the allowed storage size.",
  PRODUCT_MAPPING_REQUIRED: "A selected item is not mapped to the HubSpot product library.",
  QUOTE_CONFIGURATION_REQUIRED: "The New Customer quote template has not been configured for the app.",
  QUOTE_CREATE_FAILED: "HubSpot could not create the Quote. No partial Quote was retained.",
  SETTINGS_CONFIGURATION_REQUIRED: "Pricing settings have not been initialized yet.",
  SETTINGS_CONFLICT: "Another administrator changed the pricing settings. Reload and try again.",
  SETTINGS_INVALID: "One or more pricing settings are invalid.",
  SETTINGS_UNAUTHORIZED: "Only an authorized pricing administrator can change these settings.",
  WRITE_FAILED: "HubSpot could not save the quote option. Try again or contact an administrator."
});
var response = (statusCode, body) => ({ statusCode, body });
var safeError = (code, statusCode = 400, details) => response(statusCode, {
  success: false,
  errorCode: code,
  error: SAFE_ERRORS[code] || SAFE_ERRORS.WRITE_FAILED,
  ...details ? { details } : {}
});
var emptyDocument = () => ({ schemaVersion: "1.0", revision: 0, options: [] });
var parseDocument = (raw) => {
  if (!raw) return emptyDocument();
  try {
    const document = JSON.parse(raw);
    if (document?.schemaVersion !== "1.0" || !Number.isInteger(document.revision) || !Array.isArray(document.options)) {
      return emptyDocument();
    }
    return document;
  } catch {
    return emptyDocument();
  }
};
var normalizeOptionName = (value, fallback) => {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, 80);
};
var providerMessage = (error) => {
  const text = error?.body?.message || error?.response?.body?.message || error?.message;
  if (text) return String(text);
  return typeof error === "object" && error !== null ? "" : String(error ?? "");
};
var safeProviderDiagnostics = (error, operation) => {
  const rawStatus = error?.statusCode || error?.status || error?.code || error?.response?.statusCode;
  const rawCategory = error?.body?.category || error?.response?.body?.category;
  const rawMessage = error?.body?.message || error?.response?.body?.message || error?.message;
  const errorType = String(error?.name || "Error");
  return {
    operation: String(operation || "unknown").slice(0, 60),
    providerStatus: /^\d{3}$/.test(String(rawStatus || "")) ? String(rawStatus) : "unknown",
    providerCategory: /^[A-Z0-9_]{1,80}$/.test(String(rawCategory || "")) ? String(rawCategory) : "unknown",
    errorType: /^[A-Za-z][A-Za-z0-9]{0,79}$/.test(errorType) ? errorType : "Error",
    // HubSpot's validation messages lead with portal and object ids and only name the actual
    // problem at the very end, so a short cap truncates away the only useful part. 160 characters
    // cut "... : Quote Template should ha" mid-sentence.
    providerMessage: String(rawMessage || "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 400)
  };
};
var updateDealProperties = async (client, dealId, properties) => {
  try {
    return await client.crm.deals.basicApi.update(dealId, { properties });
  } catch (error) {
    const message = String(
      error?.body?.message || error?.response?.body?.message || error?.message || ""
    );
    const guarded = [
      ...DEAL_CHOICE_PROPERTIES.map(({ property }) => property),
      ...UNVERIFIED_DEAL_PROPERTIES
    ];
    const rejectedProperty = guarded.find(
      (property) => property && properties[property] != null && message.includes(property)
    );
    if (!rejectedProperty) throw error;
    const { [rejectedProperty]: rejected, ...rest } = properties;
    console.warn(
      `Nylas pricing: HubSpot rejected ${rejectedProperty}="${rejected}". Saving without it. Check the internal name and option values on that Deal property.`,
      safeProviderDiagnostics(error, `update_deal_${rejectedProperty}`)
    );
    return updateDealProperties(client, dealId, rest);
  }
};
var assertDealAccess = (context, requestedDealId) => {
  const contextDealId = context?.crm?.objectId == null ? null : String(context.crm.objectId);
  const dealId = requestedDealId == null ? contextDealId : String(requestedDealId);
  if (!dealId || !/^\d+$/.test(dealId)) throw new Error("INVALID_DEAL");
  if (contextDealId && dealId !== contextDealId) throw new Error("INVALID_DEAL");
  return dealId;
};
var getAccessToken = () => {
  const accessToken = process.env.PRIVATE_APP_ACCESS_TOKEN;
  if (!accessToken) throw new Error("CONFIGURATION_REQUIRED");
  return accessToken;
};
var getClient = () => {
  if (!hubspot?.Client) throw new Error("CONFIGURATION_REQUIRED");
  return new hubspot.Client({ accessToken: getAccessToken() });
};
var defaultQuoteTitle = (companyName, startDate, dealName) => {
  const subject = String(companyName || dealName || "").trim();
  const year = String(startDate || "").slice(0, 4);
  if (!subject) return "";
  return /^\d{4}$/.test(year) ? `${subject} - ${year}` : subject;
};
var readDealState = async (client, dealId) => {
  try {
    if (!client?.crm?.deals?.basicApi) throw new Error("CONFIGURATION_REQUIRED");
    const deal = await client.crm.deals.basicApi.getById(dealId, [
      "dealtype",
      "pipeline",
      "hubspot_owner_id",
      OPTION_PROPERTY,
      SELECTED_OPTION_ID_PROPERTY,
      SELECTED_OPTION_NAME_PROPERTY,
      "pricing_approval_status",
      "pricing_input_state_hash",
      "pricing_latest_quote_id",
      "pricing_latest_quote_url",
      "pricing_quote_content_hash",
      "pricing_line_item_sync_status",
      "pricing_discount_reason",
      "dealname"
    ]);
    if (!deal?.properties) throw new Error("CONFIGURATION_REQUIRED");
    return {
      dealType: deal.properties.dealtype || "",
      pipelineId: deal.properties.pipeline || "",
      dealOwnerId: deal.properties.hubspot_owner_id || "",
      document: parseDocument(deal.properties[OPTION_PROPERTY]),
      selectedOptionId: deal.properties[SELECTED_OPTION_ID_PROPERTY] || null,
      selectedOptionName: deal.properties[SELECTED_OPTION_NAME_PROPERTY] || null,
      approvalStatus: deal.properties.pricing_approval_status || "draft",
      selectedStateHash: deal.properties.pricing_input_state_hash || null,
      latestQuoteId: deal.properties.pricing_latest_quote_id || null,
      latestQuoteUrl: deal.properties.pricing_latest_quote_url || null,
      quoteContentHash: deal.properties.pricing_quote_content_hash || null,
      // Read back so the card can restore it. It used to be write-only -- sent on Lock in, stored
      // on the Deal, never returned -- which was harmless while the field was optional. It stopped
      // being harmless the moment a discount reason became REQUIRED: every reload emptied the box
      // and disabled Lock in until the rep retyped a reason the Deal already had.
      discountReason: deal.properties.pricing_discount_reason || "",
      lineItemSyncStatus: deal.properties.pricing_line_item_sync_status || "not_started",
      dealName: deal.properties.dealname || "Nylas Enterprise"
    };
  } catch (error) {
    if (error?.code === 404 || error?.statusCode === 404) throw new Error("INVALID_DEAL");
    if (error?.code === 400 || error?.statusCode === 400) {
      throw new Error("CONFIGURATION_REQUIRED");
    }
    throw error;
  }
};
var serializeDocument = (document) => {
  const serialized = JSON.stringify(document);
  if (serialized.length > MAX_PAYLOAD_LENGTH) throw new Error("PAYLOAD_TOO_LARGE");
  return serialized;
};
var assertRevision = (document, expectedRevision) => {
  if (expectedRevision == null) return;
  if (!Number.isInteger(expectedRevision) || expectedRevision !== document.revision) {
    throw new Error("CONFLICT");
  }
};
var writeDocument = async (client, dealId, document, additionalProperties = {}) => {
  await updateDealProperties(client, dealId, {
    [OPTION_PROPERTY]: serializeDocument(document),
    ...additionalProperties
  });
};
var calculateAndSaveOption = async (client, dealId, state, parameters, settings) => {
  console.info("Nylas pricing calculate: validation started.");
  assertRevision(state.document, parameters.expectedRevision);
  const incoming = parameters.option;
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    throw new Error("INVALID_OPTION");
  }
  const result = calculateQuote(
    incoming.input,
    settings.pricingPolicy,
    settings.version,
    dealCategory(settings, state.dealType, state.pipelineId)
  );
  console.info("Nylas pricing calculate: calculation completed.");
  const existingIndex = incoming.id ? state.document.options.findIndex(({ id }) => id === incoming.id) : -1;
  if (existingIndex === -1 && state.document.options.length >= MAX_OPTIONS) {
    throw new Error("TOO_MANY_OPTIONS");
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const previous = existingIndex >= 0 ? state.document.options[existingIndex] : null;
  const savedOption = {
    id: previous?.id || crypto.randomUUID(),
    name: normalizeOptionName(incoming.name, `Option ${state.document.options.length + 1}`),
    status: previous?.status === "approved" ? "pending_re_approval" : "calculated",
    input: normalizeStoredInput(incoming.input, settings.pricingPolicy),
    result,
    createdAt: previous?.createdAt || now,
    updatedAt: now
  };
  const options = [...state.document.options];
  if (existingIndex >= 0) options[existingIndex] = savedOption;
  else options.push(savedOption);
  const document = {
    ...state.document,
    revision: state.document.revision + 1,
    options
  };
  console.info("Nylas pricing calculate: save started.");
  await writeDocument(client, dealId, document);
  console.info("Nylas pricing calculate: save completed.");
  return { document, option: savedOption };
};
var deleteOption = async (client, dealId, state, parameters) => {
  assertRevision(state.document, parameters.expectedRevision);
  if (!parameters.optionId) throw new Error("INVALID_OPTION");
  const deletingSelected = parameters.optionId === state.selectedOptionId;
  const options = state.document.options.filter(({ id }) => id !== parameters.optionId);
  if (options.length === state.document.options.length) throw new Error("OPTION_NOT_FOUND");
  const document = {
    ...state.document,
    revision: state.document.revision + 1,
    options
  };
  if (deletingSelected) {
    const existingLineItemIds = await associatedIds(
      client,
      "deals",
      dealId,
      "line_items",
      1e3
    );
    await archiveLineItemsBatch(client, existingLineItemIds);
    await client.crm.deals.basicApi.update(dealId, {
      properties: {
        pricing_selected_option_id: "",
        pricing_selected_option_name: "",
        pricing_quote_inputs_payload: "",
        pricing_calculation_payload: "",
        pricing_calculation_status: "",
        pricing_arr: "",
        pricing_tcv: "",
        pricing_list_price_tcv: "",
        pricing_approval_tier_required: "",
        pricing_approval_status: "draft",
        pricing_approval_reasons: "",
        pricing_line_item_sync_status: "not_started",
        pricing_line_items_synced_at: ""
      }
    });
  }
  await writeDocument(client, dealId, document);
  return {
    document,
    selectedOptionId: deletingSelected ? null : state.selectedOptionId,
    selectedOptionName: deletingSelected ? null : state.selectedOptionName,
    approvalStatus: deletingSelected ? "draft" : state.approvalStatus,
    lineItemSyncStatus: deletingSelected ? "not_started" : state.lineItemSyncStatus
  };
};
var toHubSpotDate = (date) => date ? String(Date.parse(`${date}T00:00:00.000Z`)) : "";
var onboardingHubSpotValue = Object.freeze({
  quick_launch: "quicklaunch",
  quick_launch_plus: "quicklaunch_plus",
  strategic: "strategic"
});
var professionalServiceHubSpotValue = Object.freeze({
  google_verification_review: "Google Verification Review",
  architecture_workflow_review: "true",
  gtm_review: "false",
  provider_oauth_app_creation: "Provider OAuth App Creation",
  notification_webhook_best_practices: "Notification & Webhook Best Practices"
});
var PROFESSIONAL_SERVICES_NONE = "No";
var addOnHubSpotValue = Object.freeze({
  shared_oauth_app: "Shared Google OAuth App",
  privacy_filter: "Privacy Filter Mode",
  verified_oauth: "Turnkey Verified OAuth Project"
});
var hubSpotChoiceList = (keys, table) => [...new Set(Array.isArray(keys) ? keys : [])].map((key) => table[key]).filter(Boolean).sort().join(";");
var productVolumeProperties = Object.freeze({
  connect_ca: "pricing_connect_committed_monthly_volume",
  calendar_ca: "pricing_calendar_committed_monthly_volume",
  notetaker_bot_hours: "pricing_notetaker_committed_monthly_hours",
  agent_accounts: "pricing_agent_accounts_committed_monthly_volume",
  agent_email_thousands: "pricing_agent_email_committed_monthly_thousands",
  agent_storage_gb: "pricing_agent_storage_committed_monthly_gb",
  agent_bandwidth_gb: "pricing_agent_bandwidth_committed_monthly_gb"
});
var summaryMoney = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "$0.00";
  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
};
var summaryPercent = (fraction) => {
  const value = Number(fraction);
  if (!Number.isFinite(value) || value === 0) return null;
  const percent = Math.round(value * 1e4) / 100;
  return `${percent}%`;
};
var discountLabel = (fraction) => {
  const percent = summaryPercent(Math.abs(Number(fraction) || 0));
  if (!percent) return null;
  return Number(fraction) < 0 ? `${percent} above list` : `${percent} off list`;
};
var summaryNumber = (value) => Number(value || 0).toLocaleString("en-US");
var summaryDate = (iso) => {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "not set";
  const [year, month, day] = iso.split("-").map(Number);
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec"
  ];
  return `${day} ${months[month - 1]} ${year}`;
};
var summaryApprovalTier = (tier) => ({
  none: "No approval needed",
  sales_director: "Sales Director",
  head_sales: "Head of Sales",
  cs_director: "CS Director",
  ccso: "CCSO",
  finance: "Finance"
})[tier || "none"] || tier;
var summarySection = (heading, rows) => rows.length === 0 ? [] : [heading, ...rows.map((row) => `  ${row}`), ""];
var contractSummaryText = (option) => {
  const { input, result } = option;
  const volumes = input.volumes || {};
  const dates = result.dates || {};
  const lines = Array.isArray(result.lines) ? result.lines : [];
  const paymentRule = rateCardLabels.paymentRules.find(
    ({ key }) => key === input.paymentFrequency
  );
  const supportRule = rateCardLabels.supportRules.find(
    ({ key }) => key === input.supportLevel
  );
  const onboardingRule = rateCardLabels.onboardingRules.find(
    ({ key }) => key === input.onboardingPackage
  );
  const out = [];
  out.push(option.name ? `${option.name}` : "Pricing summary");
  out.push("=".repeat(Math.max(12, (option.name || "Pricing summary").length)));
  out.push("");
  const termRows = [
    `Term            ${input.termMonths} months`,
    `Starts          ${summaryDate(dates.contractStartDate)}`,
    `Ends            ${summaryDate(dates.contractEndDate)}`,
    `Billing         ${paymentRule?.label || input.paymentFrequency}`
  ];
  if (input.autoRenewal) {
    termRows.push(
      `Auto-renews     ${summaryDate(dates.renewalDate)} for ${input.renewalTermMonths} months`
    );
    if (dates.nonRenewalNoticeDate) {
      termRows.push(`Notice by       ${summaryDate(dates.nonRenewalNoticeDate)}`);
    }
  } else {
    termRows.push("Auto-renews     No");
  }
  out.push(...summarySection("CONTRACT", termRows));
  const productRows = lines.filter((line) => Number(line.annualCommitment) > 0 || Number(line.volume) > 0).map((line) => {
    const rate = line.displayProposedUnitRate ?? line.proposedUnitRate;
    const unit = line.unitOfMeasure ? ` ${line.unitOfMeasure}` : "";
    const discount = summaryPercent(line.discretionaryDiscount);
    return `${line.productName || line.productKey}: ${summaryNumber(line.volume)}${unit}/month at ${summaryMoney(rate)} = ${summaryMoney(line.annualCommitment)}/year` + (discount ? ` (${discountLabel(line.discretionaryDiscount)})` : "");
  });
  out.push(...summarySection("PRODUCTS", productRows));
  const extraRows = [];
  if (Number(result.supportAnnual) > 0 || supportRule) {
    extraRows.push(
      `Support: ${supportRule?.level || input.supportLevel} = ${summaryMoney(result.supportAnnual)}/year`
    );
  }
  if (Number(result.onboardingAmount) > 0) {
    extraRows.push(
      `Onboarding: ${onboardingRule?.package || input.onboardingPackage} = ${summaryMoney(result.onboardingAmount)} one-time`
    );
  } else {
    extraRows.push("Onboarding: None");
  }
  for (const addOn of result.selectedAddOns || []) {
    extraRows.push(`Add-on: ${addOn.label} = ${summaryMoney(addOn.annualAmount)}/year`);
  }
  const serviceLabels = (input.professionalServices || []).map((key) => {
    const offered = rateCardLabels.professionalServiceOptions.find(
      (service) => service.key === key
    );
    return offered?.label || key;
  });
  if (serviceLabels.length > 0) {
    extraRows.push(
      `Professional services (${serviceLabels.length}): ${serviceLabels.join(", ")} = ${summaryMoney(result.professionalServicesAmount)} one-time`
    );
  }
  out.push(...summarySection("INCLUDED", extraRows));
  const DISCOUNT_LABEL_WIDTH = 22;
  const discountRows = [];
  const discountRow = (label, value) => discountRows.push(`${label.padEnd(DISCOUNT_LABEL_WIDTH)}${value}`);
  const termDiscount = summaryPercent(result.termDiscount);
  if (termDiscount) discountRow("Multi-year term", termDiscount);
  const premium = summaryPercent(result.paymentPremium);
  if (premium) discountRow("Payment frequency", `+${premium}`);
  const largest = summaryPercent(result.largestDiscretionaryDiscount);
  if (largest) discountRow("Largest line discount", largest);
  const largestUplift = summaryPercent(result.largestDiscretionaryUplift);
  if (largestUplift) discountRow("Largest line uplift", largestUplift);
  const effective = Number(result.listTcv) > 0 ? 1 - Number(result.tcv) / Number(result.listTcv) : 0;
  const blended = summaryPercent(effective);
  if (blended) {
    const gap = Number(result.listTcv) - Number(result.tcv);
    discountRow(
      "Blended effective",
      `${blended} (${summaryMoney(Math.abs(gap))} ${gap < 0 ? "above" : "off"} list)`
    );
  }
  out.push(...summarySection("DISCOUNTS", discountRows));
  out.push(
    ...summarySection("TOTALS", [
      `Annual commitment    ${summaryMoney(result.committedArr)}`,
      `Per ${(result.billingPeriod || "period").toLowerCase().padEnd(16)} ${summaryMoney(result.recurringPerPeriod)}`,
      `One-time fees        ${summaryMoney(result.oneTime)}`,
      `Total contract value ${summaryMoney(result.tcv)}` + (Number(result.listTcv) > Number(result.tcv) ? ` (list ${summaryMoney(result.listTcv)})` : "")
    ])
  );
  const approvalRows = [
    `Required             ${summaryApprovalTier(result.approvalTierRequired)}`
  ];
  for (const reason of result.approvalReasons || []) approvalRows.push(`- ${reason}`);
  out.push(...summarySection("APPROVAL", approvalRows));
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
};
var buildSelectedProperties = (option, approvalStatus) => {
  const { input, result } = option;
  const volumes = input.volumes || {};
  const selectedProducts = result.quotedProducts.join(";");
  const effectiveDiscount = result.listTcv > 0 ? 1 - result.tcv / result.listTcv : 0;
  const properties = {
    [SELECTED_OPTION_ID_PROPERTY]: option.id,
    [SELECTED_OPTION_NAME_PROPERTY]: option.name,
    pricing_quote_inputs_payload: JSON.stringify(input),
    pricing_calculation_status: result.calculationStatus,
    pricing_drawdown_annual: String(result.proposedPlatformArr),
    pricing_recurring_per_period: String(result.recurringPerPeriod),
    pricing_one_time_fees: String(result.oneTime),
    pricing_largest_discretionary_discount_pct: String(
      result.largestDiscretionaryDiscount
    ),
    pricing_calculation_payload: JSON.stringify(result),
    pricing_calculated_at: String(Date.parse(result.calculatedAt)),
    pricing_input_state_hash: result.stateHash,
    pricing_line_item_sync_status: "stale",
    pricing_quoted_products: selectedProducts,
    pricing_product_count: String(result.quotedProducts.length),
    pricing_term_months: String(input.termMonths),
    pricing_payment_frequency: result.paymentFrequencyHubSpotValue || "",
    pricing_support_tier: input.supportLevel,
    pricing_onboarding_tier: onboardingHubSpotValue[input.onboardingPackage] || input.onboardingPackage,
    // The rep's professional-services and add-on picks, mirrored onto the Deal's own properties so
    // the portal's reporting and the order-form workflows can read them without parsing
    // pricing_quote_inputs_payload. Both are guarded in UNVERIFIED_DEAL_PROPERTIES.
    professional_services_package: hubSpotChoiceList(input.professionalServices, professionalServiceHubSpotValue) || PROFESSIONAL_SERVICES_NONE,
    // No equivalent of "No" here -- the portal has no such option, so no add-ons clears it.
    pricing_subscription_addons: hubSpotChoiceList(input.addOns, addOnHubSpotValue),
    // The whole configuration in words. See contractSummaryText.
    pricing_contract_summary: contractSummaryText(option),
    // THE CONTRACT SUMMARY'S THREE ARR LINES, each on its own Deal property so reporting can split
    // recurring revenue by what it was sold as without parsing pricing_calculation_payload. These
    // are the workbook's own rows -- QUOTE BUILDER rows 51, 52 and 53, the three that sum to the
    // "Recurring Fees Per Year (ARR)" total in row 54 -- so a figure here and the same figure on
    // the Order Form come from one calculation, not two.
    //
    // Verified as `number` properties in portal 45023718 on 2026-09-02 before being written.
    // Guarded in UNVERIFIED_DEAL_PROPERTIES anyway: this list is the one place a property name
    // arriving from outside the code can empty a Deal, because the update runs after the line
    // items have been archived.
    //
    // They must keep summing to pricing_arr. A test asserts it.
    enterprise_drawdown_commitment_arr: String(result.proposedPlatformArr),
    subscription_add_ons_arr: String(result.annualAddOns),
    subscription_support_arr: String(result.supportAnnual),
    // THE SAME MONEY, OVER THE FULL TERM. The three ARR properties above are per year; these five
    // are what the contract is worth in total, and they are what the portal's own descriptions ask
    // for -- "the sum of the total fees over the full license term", "the full fees for the
    // entirety of the two year term".
    //
    // The recurring three are multiplied by the term in years. Onboarding and professional
    // services are one-time and are NOT: onboarding is "invoiced in advance at the contract start
    // date in its entirety", and multiplying either by the term would double-count a fee charged
    // once. The workbook agrees -- Contract Summary L49 and L50 are `=I49` and `=I50`, the
    // one-time column copied across, while L51 to L53 are `K x D70`.
    //
    // All five sum to `amount` by construction, and a test asserts it.
    product_licensing_fees: String(feesForTerm(result.proposedPlatformArr, input.termMonths)),
    add_on_fees: String(feesForTerm(result.annualAddOns, input.termMonths)),
    support_fees: String(feesForTerm(result.supportAnnual, input.termMonths)),
    onboarding_fees: String(result.onboardingAmount),
    professional_services_fees: String(result.professionalServicesAmount),
    // HubSpot's own Deal Amount, deliberately. Confirmed on 2026-09-02 that this portal does NOT
    // calculate it from line items: deal 60785797504 has the app's line items on it and an EMPTY
    // amount, and deal 41084207764 carries 357,800 against a pricing_tcv of 412,400. So nothing
    // was maintaining it and it had already drifted.
    //
    // Written AFTER the properties but BEFORE syncDealLineItems, which is the order that matters
    // if that portal setting is ever turned on -- a rollup would then land last and win. If Amount
    // starts disagreeing with pricing_tcv again, that setting is the first thing to check.
    amount: String(result.tcv),
    pricing_arr: String(result.committedArr),
    pricing_tcv: String(result.tcv),
    pricing_list_price_tcv: String(result.listTcv),
    pricing_blended_effective_discount_pct: String(roundForProperty(effectiveDiscount)),
    // Raw fractions, matching pricing_blended_effective_discount_pct above: 0.025 for 2.5%, not
    // 2.5. HubSpot's percentage property type renders the multiplication.
    pricing_multi_year_discount_pct: String(roundForProperty(result.termDiscount)),
    // NOT a percentage, despite the property name -- this is the total discount in DOLLARS across
    // the full term, list TCV minus quoted TCV. Holly's instruction: "multi-product discount should
    // be the total discount amount for full term even if it's %". Left as-is rather than renamed so
    // the existing approval block keeps reading it; the name is the portal's, not a bug here.
    pricing_multi_product_discount_pct: String(
      Math.round((result.listTcv - result.tcv + Number.EPSILON) * 100) / 100
    ),
    // Every quote this app builds is the drawdown model: one prepaid pool the metered products
    // draw against. 'flat' exists for a volume-commitment shape the calculator does not produce.
    pricing_contract_type: "drawdown",
    pricing_has_100pct_line: String(result.largestDiscretionaryDiscount === 1),
    pricing_100pct_lines_summary: result.largestDiscretionaryDiscount === 1 ? "One or more quote lines are discounted 100%" : "",
    pricing_approval_tier_required: result.approvalTierRequired,
    pricing_approval_status: approvalStatus,
    pricing_approval_reasons: result.approvalReasons.join("\n"),
    // Written to BOTH names on purpose. The app has always written
    // pricing_approval_reasons, but the portal's property list shows
    // "Pricing: Approval Notes" / pricing_approval_notes and no
    // pricing_approval_reasons -- and the approval block reads one of them. Rather than guess
    // which, both carry the same text; the guard drops whichever the portal does not have.
    pricing_approval_notes: result.approvalReasons.join("\n"),
    pricing_primary_product: "multi",
    pricing_ca_count: String(volumes.connect_ca || 0),
    contract_start_date: toHubSpotDate(input.startDate),
    pricing_contract_end_date: toHubSpotDate(result.dates.contractEndDate),
    pricing_auto_renewal: String(input.autoRenewal === true),
    pricing_renewal_term_months: input.autoRenewal ? String(input.renewalTermMonths) : "",
    pricing_renewal_date: toHubSpotDate(result.dates.renewalDate),
    pricing_non_renewal_notice_days: String(input.nonRenewalNoticeDays || 0),
    pricing_non_renewal_notice_date: toHubSpotDate(result.dates.nonRenewalNoticeDate),
    pricing_non_standard_terms: String(input.nonStandardTerms === true),
    special_terms: input.specialTerms || "",
    // True only when there is text to show. normalizeInput already blanks specialTerms when the
    // box is unticked, so this follows the text rather than the checkbox: a quote template keyed
    // on it will not print an empty Special Terms block for a rep who ticked and typed nothing.
    special_terms_included: String((input.specialTerms || "").trim() !== "")
  };
  if (approvalStatus === "approved") {
    properties.pricing_last_approved_state_hash = result.stateHash;
    properties.pricing_line_item_sync_status = "ready";
  }
  for (const [productKey, propertyName] of Object.entries(productVolumeProperties)) {
    properties[propertyName] = String(volumes[productKey] || 0);
  }
  return properties;
};
var feesForTerm = (annualAmount, termMonths) => Math.round(Number(annualAmount) * (Number(termMonths) / 12) * 100) / 100;
var roundForProperty = (value) => Math.round((value + Number.EPSILON) * 1e4) / 1e4;
var assertCurrentSettings = (option, settings) => {
  if (option?.result?.settingsVersion !== settings.version) {
    throw new Error("OPTION_RECALCULATION_REQUIRED");
  }
};
var chooseOption = async (client, dealId, state, parameters, settings) => {
  assertRevision(state.document, parameters.expectedRevision);
  const option = state.document.options.find(({ id }) => id === parameters.optionId);
  if (!option?.result) throw new Error("OPTION_NOT_FOUND");
  assertCurrentSettings(option, settings);
  if (option.result.blockingReasons.length > 0) throw new Error("OPTION_BLOCKED");
  const approvalStatus = "draft";
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const options = state.document.options.map((item) => ({
    ...item,
    status: item.id === option.id ? "selected" : item.status === "selected" ? "calculated" : item.status,
    updatedAt: item.id === option.id ? now : item.updatedAt
  }));
  const document = {
    ...state.document,
    revision: state.document.revision + 1,
    options
  };
  await writeDocument(
    client,
    dealId,
    document,
    buildSelectedProperties({ ...option, status: approvalStatus }, approvalStatus)
  );
  const synced = await syncDealLineItems(
    client,
    dealId,
    {
      ...state,
      document,
      selectedOptionId: option.id,
      selectedOptionName: option.name,
      selectedStateHash: option.result.stateHash
    },
    settings
  );
  return {
    document,
    selectedOptionId: option.id,
    selectedOptionName: option.name,
    approvalStatus,
    lineItemSyncStatus: "synced",
    lineItemCount: synced.count,
    lineItemsSyncedAt: synced.syncedAt
  };
};
var lockLiveCalculation = async (client, dealId, state, parameters, portalId, settings) => {
  const category = dealCategory(settings, state.dealType, state.pipelineId);
  const result = calculateQuote(
    parameters.input,
    settings.pricingPolicy,
    settings.version,
    category
  );
  if (result.blockingReasons.length > 0) throw new Error("OPTION_BLOCKED");
  if (result.requiresBankTransfer && parameters.paymentMethod !== "ach") {
    console.warn(
      `Nylas pricing: refused Lock in -- largest invoice ${result.largestInvoiceAmount} exceeds the ${result.creditCardMaximumInvoice} credit card limit and payment method was "${parameters.paymentMethod || "unset"}".`
    );
    throw new Error("PAYMENT_METHOD_REQUIRES_BANK_TRANSFER");
  }
  const largestRateDeparture = Math.max(
    Number(result.largestDiscretionaryDiscount) || 0,
    Number(result.largestDiscretionaryUplift) || 0
  );
  if (largestRateDeparture > 0 && String(parameters.discountReason || "").trim() === "") {
    console.warn(
      `Nylas pricing: refused Lock in -- a rate departure of ${largestRateDeparture} (discount ${result.largestDiscretionaryDiscount}, uplift ${result.largestDiscretionaryUplift}) was entered with no reason.`
    );
    throw new Error("DISCOUNT_REASON_REQUIRED");
  }
  let chosenContractId = "";
  if (category === "renewal") {
    const { contracts, contractsRead } = await quoteContractOptions(client, dealId);
    if (contractsRead && contracts.length > 0) {
      const requested = String(parameters.contractId || "");
      if (!requested || !contracts.some(({ id }) => id === requested)) {
        console.warn(
          `Nylas pricing: refused Lock in -- renewal deal ${dealId} offers ${contracts.length} contract(s) and the request named "${requested || "none"}".`
        );
        throw new Error("QUOTE_CONTRACT_REQUIRED");
      }
      chosenContractId = requested;
    }
  }
  const input = normalizeStoredInput(parameters.input, settings.pricingPolicy);
  const liveOption = {
    id: `live-${result.stateHash.slice(0, 16)}`,
    name: "Live calculation",
    status: "draft",
    input,
    result
  };
  const properties = buildSelectedProperties(liveOption, "draft");
  properties[SELECTED_OPTION_ID_PROPERTY] = liveOption.id;
  properties[SELECTED_OPTION_NAME_PROPERTY] = liveOption.name;
  Object.assign(properties, paymentMethodProperties(parameters.paymentMethod));
  Object.assign(properties, paymentFrequencyProperties(input.paymentFrequency));
  Object.assign(properties, autoRenewalProperties(input.autoRenewal));
  Object.assign(properties, contractTermProperties(input.termMonths));
  Object.assign(properties, discountReasonProperties(parameters.discountReason));
  properties.pricing_approval_timestamp = String(Date.now());
  const document = {
    schemaVersion: "1.0",
    revision: (state.document?.revision || 0) + 1,
    options: [liveOption]
  };
  await writeDocument(client, dealId, document, properties);
  if (chosenContractId) {
    try {
      await client.crm.associations.v4.basicApi.createDefault(
        "deals",
        String(dealId),
        CONTRACT_OBJECT_TYPE,
        chosenContractId
      );
      console.info(`Nylas pricing: associated contract ${chosenContractId} to deal ${dealId}.`);
    } catch (error) {
      console.warn(
        `Nylas pricing: could not associate contract ${chosenContractId} to deal ${dealId}. ${providerMessage(error)}`
      );
    }
  }
  const liveState = {
    ...state,
    document,
    selectedOptionId: liveOption.id,
    selectedOptionName: liveOption.name,
    selectedStateHash: result.stateHash
  };
  const synced = await syncDealLineItems(client, dealId, liveState, settings);
  if (parameters.applyToQuoteId) {
    const priced = await priceExistingQuote(
      client,
      dealId,
      liveState,
      {
        quoteContent: parameters.quoteContent || {},
        applyToQuoteId: parameters.applyToQuoteId
      },
      settings
    );
    return { result, lineItemCount: synced.count, ...priced };
  }
  const quote = await generateQuote(
    client,
    dealId,
    liveState,
    {
      quoteContent: parameters.quoteContent || {},
      // Default FALSE: a Lock in creates a NEW quote and leaves the previous one alone. The rep
      // opts in to replacing it, per the checkbox beside Lock in. Holly, 2026-08-28.
      //
      // Strict === true so anything absent, malformed or truthy-but-not-boolean means "keep it".
      // The destructive reading must be the one that has to be asked for.
      replaceExistingQuote: parameters.replaceExistingQuote === true,
      // The contact the rep picked on the card. Required on a CPQ quote; see generateQuote.
      contactId: parameters.contactId
    },
    portalId,
    settings
  );
  return { result, lineItemCount: synced.count, ...quote };
};
var selectedOptionForDraft = (state) => {
  const option = state.document.options.find(({ id }) => id === state.selectedOptionId);
  if (!option?.result || option.result.blockingReasons.length > 0) {
    throw new Error("OPTION_REQUIRED");
  }
  if (!state.selectedStateHash || state.selectedStateHash !== option.result.stateHash) {
    throw new Error("OPTION_RECALCULATION_REQUIRED");
  }
  return option;
};
var createAssociation = (toId, associationTypeId) => ({
  to: { id: String(toId) },
  types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId }]
});
var associatedIds = async (client, fromType, fromId, toType, limit = 100) => {
  const ids = [];
  let after;
  do {
    const page = await client.crm.associations.v4.basicApi.getPage(
      fromType,
      String(fromId),
      toType,
      after,
      Math.min(limit - ids.length, 500)
    );
    ids.push(...(page.results || []).map(({ toObjectId }) => String(toObjectId)));
    after = page.paging?.next?.after;
    if (ids.length >= limit && after != null && toType === "line_items") {
      throw new Error("TOO_MANY_LINE_ITEMS");
    }
  } while (after != null && ids.length < limit);
  return ids;
};
var inBatches = async (values, action, batchSize = 10) => {
  for (let index = 0; index < values.length; index += batchSize) {
    await Promise.all(values.slice(index, index + batchSize).map(action));
  }
};
var HUBSPOT_LINE_ITEM_PROPERTIES = /* @__PURE__ */ new Set([
  // 'name' deliberately omitted, as a second guard behind lineItemModel not building it. The
  // product library owns the product's name; hs_product_id is all HubSpot needs to resolve it, and
  // anything sent here would overwrite the library's name on the line item. This is the reason
  // "Enterprise Drawdown Fee" kept reappearing after the product was renamed.
  "hs_product_id",
  "quantity",
  "price",
  // A PERCENTAGE, not the flat `discount` amount this used to send. Holly, 2026-08-31: discounts
  // are always expressed in %. `discount` is deliberately NOT in this list any more -- a line
  // carrying both fields would have HubSpot apply one and the reader believe the other. Managed
  // line items are recreated rather than updated on every sync, so no line survives with a stale
  // flat amount on it. hs_discount_percentage is HubSpot-defined on line items in every portal.
  "hs_discount_percentage",
  "description",
  // 'product_category' deliberately omitted: it is not a HubSpot-defined Line Item property, so
  // in a portal that never had it created every create fails with a 400 and the sync collapses.
  // 'units' deliberately omitted. It exists in this portal but is an ENUMERATION -- /GB's,
  // /Emails, /Agent Accounts, /CA's, /Bot Hours -- so any value outside that list is rejected
  // with INVALID_OPTION, which emptied the Deal on 2026-08-28. See lineItemModel.js.
  // Tiered pricing, sent on the graduated Agent Email line only. HubSpot-defined and documented on
  // line items, but gated on a Revenue Hub subscription, so they are droppable below: a portal
  // without Revenue Hub must fall back to the product's own tiers, not fail the create.
  "hs_pricing_model",
  "hs_tier_ranges",
  "hs_tier_prices",
  // Custom, not HubSpot-defined: it carries the monthly committed volume for each metered product,
  // which used to be stated in prose in the description. A portal that never created it rejects
  // the whole create, so createLineItem retries without it rather than failing the sync.
  "committed_quantity",
  // The agreed (net) monthly rate on each metered line -- the "Proposed Rate" the Order Form's
  // rate column should print, rather than `price`, which is deliberately the list rate. Custom,
  // so it is dropped and retried like the others. It used to be named monthly_unit_price here,
  // which was never a property in this portal: it rode in the allow-list from the initial commit
  // and was never in the drop list, so any portal missing it would have failed every create --
  // and because the sync archives before it creates, emptied the Deal.
  "proposed_rate",
  // The Contract Summary's fee columns, carried on every line that holds money. Custom, like
  // committed_quantity, so they are dropped and retried if a portal does not have them.
  "one_time_fees",
  "recurring_fees",
  "total_fees_for_term",
  "recurringbillingfrequency",
  "hs_recurring_billing_period",
  "hs_recurring_billing_terms",
  "hs_recurring_billing_number_of_payments",
  "hs_recurring_billing_start_date",
  "hs_billing_start_delay_type",
  // Drives display order on the Deal and the Quote.
  "hs_position_on_quote"
]);
var hubSpotLineItemProperties = (properties) => Object.fromEntries(
  Object.entries(properties).filter(
    ([key, value]) => HUBSPOT_LINE_ITEM_PROPERTIES.has(key) && value != null
  )
);
var isProductBundleRejection = (error) => {
  const message = String(
    error?.body?.message || error?.response?.body?.message || error?.message || ""
  );
  return /product bundle/i.test(message) || /could not hydrate/i.test(message);
};
var OPTIONAL_CUSTOM_LINE_ITEM_PROPERTIES = [
  "committed_quantity",
  "proposed_rate",
  "one_time_fees",
  "recurring_fees",
  "total_fees_for_term",
  // Revenue Hub gated rather than custom. Dropping these degrades to the product's own tier table,
  // which is the behaviour before this change: visibly unadjusted, but a quote rather than nothing.
  "hs_pricing_model",
  "hs_tier_ranges",
  "hs_tier_prices"
];
var errorStatus = (error) => Number(
  error?.code ?? error?.status ?? error?.statusCode ?? error?.response?.status ?? error?.body?.status
) || 0;
var isTransientRejection = (error) => {
  const status = errorStatus(error);
  return status === 429 || status >= 500 && status < 600;
};
var isUnknownPropertyRejection = (error, property) => {
  const status = errorStatus(error);
  if (status && status !== 400) return false;
  const message = String(
    error?.body?.message || error?.response?.body?.message || error?.message || ""
  );
  if (!message.includes(property)) return false;
  return /does\s*n[o']?t\s+exist|doesn't exist|unknown|not\s+found|no\s+such|invalid\s+propert/i.test(
    message
  );
};
var delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
var createLineItem = async (client, properties, associations, attempt = 0) => {
  try {
    return await client.crm.lineItems.basicApi.create({ properties, associations });
  } catch (error) {
    if (isTransientRejection(error) && attempt < 3) {
      await delay(400 * 2 ** attempt);
      return createLineItem(client, properties, associations, attempt + 1);
    }
    const rejected = OPTIONAL_CUSTOM_LINE_ITEM_PROPERTIES.find(
      (property) => properties[property] != null && isUnknownPropertyRejection(error, property)
    );
    if (rejected) {
      const { [rejected]: unused, ...withoutRejected } = properties;
      console.error(
        `Nylas pricing: HubSpot rejected ${rejected} as a Line Item property this portal does not have. Creating the line item WITHOUT it -- that field will be blank on the quote. Rejection: ${providerMessage(error)}`
      );
      return createLineItem(client, withoutRejected, associations, attempt);
    }
    if (!properties.hs_product_id || !isProductBundleRejection(error)) throw error;
    const { hs_product_id: bundledProductId, ...withoutProduct } = properties;
    console.warn(
      `Nylas pricing: product ${bundledProductId} cannot back a line item (bundle). Creating the line item without a product link.`
    );
    return client.crm.lineItems.basicApi.create({
      properties: withoutProduct,
      associations
    });
  }
};
var LINE_ITEM_BATCH_LIMIT = 100;
var chunked = (values, size) => {
  const groups = [];
  for (let index = 0; index < values.length; index += size) {
    groups.push(values.slice(index, index + size));
  }
  return groups;
};
var joinCreatedLineItems = (sent, results) => {
  if (!Array.isArray(results) || results.length !== sent.length) return null;
  const pairs = [];
  for (let index = 0; index < sent.length; index += 1) {
    const created = results[index];
    if (!created?.id) return null;
    const sentProductId = sent[index].properties.hs_product_id;
    const storedProductId = created.properties?.hs_product_id;
    if (sentProductId && storedProductId && String(storedProductId) !== String(sentProductId)) {
      return null;
    }
    pairs.push({ id: String(created.id), sent: sent[index].properties });
  }
  return pairs;
};
var createLineItemsBatch = async (client, items, createdIds = [], attempt = 0) => {
  if (items.length === 0) return [];
  const thisAttemptIds = [];
  try {
    const results = [];
    for (const group of chunked(items, LINE_ITEM_BATCH_LIMIT)) {
      const response2 = await client.crm.lineItems.batchApi.create({
        inputs: group.map(({ properties, associations }) => ({ properties, associations }))
      });
      const created = response2?.results || [];
      for (const item of created) {
        createdIds.push(String(item.id));
        thisAttemptIds.push(String(item.id));
      }
      results.push(...created);
      if (response2?.errors?.length) {
        const failure = new Error("LINE_ITEM_BATCH_PARTIAL");
        failure.body = { message: JSON.stringify(response2.errors).slice(0, 2e3) };
        failure.code = 400;
        throw failure;
      }
    }
    return results;
  } catch (error) {
    if (thisAttemptIds.length > 0) {
      console.warn(
        `Nylas pricing: a line item batch failed after creating ${thisAttemptIds.length} of ${items.length}. Removing those before retrying, so the retry cannot duplicate them.`
      );
      await archiveLineItemsBatch(client, thisAttemptIds).catch((archiveError) => {
        console.error(
          `Nylas pricing: could not remove the line items a partial batch created. The retry below may duplicate them -- ids ${thisAttemptIds.join(", ")}. ${providerMessage(archiveError)}`,
          safeProviderDiagnostics(archiveError, "archive_partial_line_item_batch")
        );
      });
      for (const id of thisAttemptIds) {
        const at = createdIds.indexOf(id);
        if (at >= 0) createdIds.splice(at, 1);
      }
    }
    if (isTransientRejection(error) && attempt < 3) {
      await delay(400 * 2 ** attempt);
      return createLineItemsBatch(client, items, createdIds, attempt + 1);
    }
    const rejected = OPTIONAL_CUSTOM_LINE_ITEM_PROPERTIES.find(
      (property) => items.some(({ properties }) => properties[property] != null) && isUnknownPropertyRejection(error, property)
    );
    if (rejected) {
      console.error(
        `Nylas pricing: HubSpot rejected ${rejected} as a Line Item property this portal does not have. Recreating every line item WITHOUT it -- that field will be blank. Rejection: ${providerMessage(error)}`
      );
      return createLineItemsBatch(
        client,
        items.map(({ properties, associations }) => {
          const { [rejected]: unused, ...rest } = properties;
          return { properties: rest, associations };
        }),
        createdIds,
        attempt
      );
    }
    console.error(
      `Nylas pricing: batch line item create failed; falling back to one create per line item. ${providerMessage(error)}`
    );
    const created = new Array(items.length);
    const indexed = items.map((item, index) => ({ item, index }));
    await inBatches(indexed, async ({ item, index }) => {
      const record = await createLineItem(client, item.properties, item.associations);
      createdIds.push(String(record.id));
      created[index] = record;
    });
    return created;
  }
};
var repairLineItemsBatch = async (client, pairs) => {
  const expected = pairs.map(({ id, sent }) => ({
    id,
    properties: Object.fromEntries(
      VERIFIED_LINE_ITEM_PROPERTIES.filter((name) => sent[name] != null).map((name) => [
        name,
        String(sent[name])
      ])
    )
  })).filter(({ properties }) => Object.keys(properties).length > 0);
  if (expected.length === 0) return [];
  try {
    const stored = await client.crm.lineItems.batchApi.read({
      properties: VERIFIED_LINE_ITEM_PROPERTIES,
      inputs: expected.map(({ id }) => ({ id }))
    });
    const storedById = new Map(
      (stored?.results || []).map((record) => [String(record.id), record.properties || {}])
    );
    const updates = [];
    for (const { id, properties } of expected) {
      const have = storedById.get(id);
      if (!have) continue;
      const missing = Object.fromEntries(
        Object.entries(properties).filter(([name]) => {
          const value = have[name];
          return value == null || value === "";
        })
      );
      if (Object.keys(missing).length > 0) updates.push({ id, properties: missing });
    }
    if (updates.length === 0) return [];
    console.error(
      `Nylas pricing: ${updates.length} line item(s) were created WITHOUT fee properties that were sent. Patching them back.`
    );
    await client.crm.lineItems.batchApi.update({ inputs: updates });
    return updates.map(({ id }) => id);
  } catch (error) {
    console.error(
      "Nylas pricing: could not verify or repair line item fee properties. " + providerMessage(error)
    );
    return [];
  }
};
var archiveLineItemsBatch = async (client, ids) => {
  if (ids.length === 0) return;
  for (const group of chunked(ids, LINE_ITEM_BATCH_LIMIT)) {
    await client.crm.lineItems.batchApi.archive({
      inputs: group.map((id) => ({ id: String(id) }))
    });
  }
};
var VERIFIED_LINE_ITEM_PROPERTIES = ["one_time_fees", "recurring_fees", "total_fees_for_term"];
var syncDealLineItems = async (client, dealId, state, settings) => {
  const option = selectedOptionForDraft(state);
  assertCurrentSettings(option, settings);
  const desired = buildDealLineItems(option);
  const createdIds = [];
  let archivedCount = 0;
  let archiveStarted = false;
  try {
    const existingIds = await associatedIds(client, "deals", dealId, "line_items", 1e3);
    const sending = desired.map((item) => ({
      properties: hubSpotLineItemProperties(item.properties),
      associations: [createAssociation(dealId, 20)]
    }));
    const created = await createLineItemsBatch(client, sending, createdIds);
    await repairLineItemsBatch(client, joinCreatedLineItems(sending, created) || []);
    archiveStarted = true;
    await archiveLineItemsBatch(client, existingIds);
    archivedCount = existingIds.length;
    const syncedAt = (/* @__PURE__ */ new Date()).toISOString();
    await client.crm.deals.basicApi.update(dealId, {
      properties: {
        pricing_line_item_sync_status: "synced",
        pricing_line_items_synced_at: syncedAt
      }
    });
    return { count: desired.length, syncedAt };
  } catch (error) {
    if (!archiveStarted) {
      await archiveLineItemsBatch(client, createdIds).catch(() => void 0);
    } else {
      console.error(
        `Nylas pricing: line item sync failed after archiving ${archivedCount} of the Deal's previous line items, with ${createdIds.length} replacements already created. The replacements were KEPT so the Deal is not left empty. It may now show duplicates that need removing by hand.`
      );
    }
    await client.crm.deals.basicApi.update(dealId, { properties: { pricing_line_item_sync_status: "failed" } }).catch(() => void 0);
    const diagnostics = safeProviderDiagnostics(error, "sync_line_items");
    console.error("Nylas pricing line item sync failed.", diagnostics, error?.stack || error);
    if (error?.message === "TOO_MANY_LINE_ITEMS") throw new Error("TOO_MANY_LINE_ITEMS");
    const failure = new Error("LINE_ITEM_SYNC_FAILED");
    failure.diagnostics = diagnostics;
    throw failure;
  }
};
var REQUIRED_QUOTE_TEMPLATE_TYPE = "cpq_template";
var QUOTE_TEMPLATE_OBJECT_TYPES = ["quote_template", "quote_templates"];
var readQuoteTemplatePage = async (client, after) => {
  let lastError;
  for (const objectType of QUOTE_TEMPLATE_OBJECT_TYPES) {
    try {
      return await client.crm.objects.basicApi.getPage(
        objectType,
        100,
        after,
        ["hs_name", "hs_type", "hs_active"],
        void 0,
        void 0,
        false
      );
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
};
var offeredQuoteTemplates = (templates, settings, category) => {
  const { enabledIds } = quoteTemplateSettings(settings, category);
  if (enabledIds.length === 0) return templates;
  const allowed = new Set(enabledIds.map(String));
  const narrowed = templates.filter(({ id }) => allowed.has(String(id)));
  if (narrowed.length === 0) {
    console.warn(
      "Nylas pricing: none of the quote templates chosen in Settings still exist. Offering every usable template instead."
    );
    return templates;
  }
  return narrowed;
};
var defaultQuoteTemplate = (settings, category) => quoteTemplateSettings(settings, category).defaultId || configuredQuoteTemplateId();
var dealCompanyName = async (client, dealId) => {
  try {
    const companyIds = await associatedIds(client, "deals", dealId, "companies", 1);
    if (!companyIds[0]) return "";
    const company = await client.crm.companies.basicApi.getById(companyIds[0], ["name"]);
    return company?.properties?.name || "";
  } catch (error) {
    console.warn(
      "Nylas pricing: could not read the company name for the quote title.",
      safeProviderDiagnostics(error, "read_company_name")
    );
    return "";
  }
};
var latestQuoteTemplate = async (client, quoteId, templates) => {
  if (!quoteId) return null;
  try {
    const ids = await associatedIds(client, "quotes", String(quoteId), "quote_template", 1);
    const id = ids[0] ? String(ids[0]) : "";
    if (!id) return { quoteId: String(quoteId), id: "", name: "" };
    const match = (templates || []).find((template) => String(template.id) === id);
    return { quoteId: String(quoteId), id, name: match?.name || "" };
  } catch (error) {
    console.warn(
      `Nylas pricing: could not read the template on quote ${quoteId}. ${providerMessage(error)}`
    );
    return null;
  }
};
var CONTRACT_OBJECT_TYPE = "contracts";
var CONTRACT_PROPERTIES = [
  "hs_name",
  "hs_status",
  "hs_contract_effective_date",
  "hs_end_date",
  "hs_total_contract_value"
];
var CONTRACT_STATUS_RANK = Object.freeze({
  active: 0,
  // Future-dated and will activate itself. As renewable as an active one, and listed right after.
  scheduled_activation: 1,
  draft: 2,
  // Temporarily stopped, not finished. Still renewable, so offered -- last of the good ones.
  paused: 3
});
var CONTRACT_STATUS_NOT_OFFERABLE = Object.freeze(["completed", "terminated", "error"]);
var contractStatusRank = (status) => {
  const key = String(status || "").trim().toLowerCase();
  if (key in CONTRACT_STATUS_RANK) return CONTRACT_STATUS_RANK[key];
  if (CONTRACT_STATUS_NOT_OFFERABLE.includes(key)) return 90;
  return 50;
};
var contractIsOfferable = (status) => !CONTRACT_STATUS_NOT_OFFERABLE.includes(String(status || "").trim().toLowerCase());
var contractOptionLabel = (record) => {
  const props = record?.properties || {};
  const name = String(props.hs_name || "").trim() || `Contract ${record?.id}`;
  const status = String(props.hs_status || "").trim();
  const ends = String(props.hs_end_date || "").trim();
  const parts = [name];
  if (status) parts.push(status.toUpperCase());
  if (ends) parts.push(`ends ${ends}`);
  return parts.join(" \u2014 ");
};
var readContractById = async (client, contractId, properties = CONTRACT_PROPERTIES) => {
  try {
    return await client.crm.objects.basicApi.getById(
      CONTRACT_OBJECT_TYPE,
      String(contractId),
      properties
    );
  } catch (error) {
    const kept = properties.filter((name) => !isUnknownPropertyRejection(error, name));
    if (kept.length > 0 && kept.length < properties.length) {
      return readContractById(client, contractId, kept);
    }
    throw error;
  }
};
var quoteContractOptions = async (client, dealId) => {
  try {
    const companyIds = await associatedIds(client, "deals", dealId, "companies", 1);
    if (!companyIds[0]) {
      return { contracts: [], contractSource: "no_company", contractsRead: true };
    }
    const contractIds = await associatedIds(
      client,
      "companies",
      companyIds[0],
      CONTRACT_OBJECT_TYPE,
      50
    );
    if (contractIds.length === 0) {
      return { contracts: [], contractSource: "company_has_none", contractsRead: true };
    }
    const records = [];
    await inBatches(contractIds, async (contractId) => {
      try {
        records.push(await readContractById(client, contractId));
      } catch (error) {
        console.warn(
          `Nylas pricing: could not read contract ${contractId}.`,
          safeProviderDiagnostics(error, "read_contract")
        );
        records.push({ id: String(contractId), properties: {} });
      }
    });
    const all = records.map((record) => ({
      id: String(record.id),
      label: contractOptionLabel(record),
      status: String(record?.properties?.hs_status || ""),
      endDate: String(record?.properties?.hs_end_date || "")
    })).sort(
      (left, right) => contractStatusRank(left.status) - contractStatusRank(right.status) || String(right.endDate).localeCompare(String(left.endDate)) || left.label.localeCompare(right.label)
    );
    const quotable = all.filter(({ status }) => contractIsOfferable(status));
    return {
      contracts: quotable.length > 0 ? quotable : all,
      contractSource: quotable.length > 0 ? "company" : "company_none_quotable",
      contractsRead: true
    };
  } catch (error) {
    console.warn(
      "Nylas pricing: could not list contracts for the deal company.",
      safeProviderDiagnostics(error, "list_contracts")
    );
    return { contracts: [], contractSource: "read_failed", contractsRead: false };
  }
};
var quoteContactOptions = async (client, dealId) => {
  const readContacts = async (ids) => {
    if (ids.length === 0) return [];
    try {
      const read = await client.crm.contacts.batchApi.read({
        inputs: ids.map((id) => ({ id: String(id) })),
        properties: ["firstname", "lastname", "email"],
        idProperty: void 0
      });
      return (read?.results || []).map((contact) => {
        const first = contact?.properties?.firstname || "";
        const last = contact?.properties?.lastname || "";
        const email = contact?.properties?.email || "";
        const name = `${first} ${last}`.trim();
        return {
          id: String(contact.id),
          // Never blank: a nameless option is unpickable. Email, then the id, as fallbacks.
          label: name && email ? `${name} (${email})` : name || email || `Contact ${contact.id}`
        };
      });
    } catch (error) {
      console.warn(
        "Nylas pricing: could not read contact details.",
        safeProviderDiagnostics(error, "read_quote_contacts")
      );
      return ids.map((id) => ({ id: String(id), label: `Contact ${id}` }));
    }
  };
  try {
    const dealContactIds = await associatedIds(client, "deals", dealId, "contacts", 25);
    if (dealContactIds.length > 0) {
      return { contacts: await readContacts(dealContactIds), source: "deal", dealContactIds };
    }
    const companyIds = await associatedIds(client, "deals", dealId, "companies", 1);
    if (!companyIds[0]) return { contacts: [], source: "none", dealContactIds: [] };
    const companyContactIds = await associatedIds(
      client,
      "companies",
      companyIds[0],
      "contacts",
      50
    );
    return {
      contacts: await readContacts(companyContactIds),
      source: "company",
      dealContactIds: []
    };
  } catch (error) {
    console.warn(
      "Nylas pricing: could not list quote contacts.",
      safeProviderDiagnostics(error, "list_quote_contacts")
    );
    return { contacts: [], source: "none", dealContactIds: [] };
  }
};
var usableQuoteTemplates = async (client) => {
  const templates = [];
  const excluded = [];
  let after;
  try {
    do {
      const page = await readQuoteTemplatePage(client, after);
      for (const template of page?.results || []) {
        const type = template?.properties?.hs_type || "";
        if (type !== REQUIRED_QUOTE_TEMPLATE_TYPE) {
          excluded.push(`${template?.id} (${type || "no type"})`);
          continue;
        }
        if (String(template?.properties?.hs_active) === "false") {
          excluded.push(`${template?.id} (archived)`);
          continue;
        }
        templates.push({
          id: String(template.id),
          name: String(
            template?.properties?.hs_name || `Quote template ${template?.id}`
          ).slice(0, 140)
        });
      }
      after = page?.paging?.next?.after;
    } while (after != null && templates.length < 200);
  } catch (error) {
    console.warn(
      "Nylas pricing: could not list quote templates.",
      safeProviderDiagnostics(error, "list_quote_templates")
    );
    return [];
  }
  if (excluded.length > 0) {
    console.info(
      `Nylas pricing: ${excluded.length} quote template(s) not offered -- not an active ${REQUIRED_QUOTE_TEMPLATE_TYPE}: ${excluded.join(", ")}.`
    );
  }
  return templates.sort((left, right) => left.name.localeCompare(right.name));
};
var describeQuoteTemplate = async (client, templateId) => {
  try {
    const template = await client.crm.objects.basicApi.getById("quote_template", templateId, [
      "hs_name",
      "hs_type"
    ]);
    const type = template?.properties?.hs_type || "unknown";
    const name = template?.properties?.hs_name || "";
    console.info(
      `Nylas pricing: quote template ${templateId} ("${name}") has hs_type "${type}" (HubSpot has previously required "${REQUIRED_QUOTE_TEMPLATE_TYPE}").`
    );
    return { type, name };
  } catch (error) {
    console.warn(
      "Nylas pricing: could not read the quote template.",
      safeProviderDiagnostics(error, "read_quote_template")
    );
    return { type: "unknown", name: "" };
  }
};
var readOwnerDirectly = async (ownerId) => {
  try {
    const response2 = await fetch(`https://api.hubapi.com/crm/v3/owners/${encodeURIComponent(ownerId)}`, {
      headers: { Authorization: `Bearer ${getAccessToken()}`, "Content-Type": "application/json" }
    });
    if (!response2.ok) {
      console.warn(
        `Nylas pricing: owners REST read for ${ownerId} answered ${response2.status}. If this is 403, the app is missing the owners read scope.`
      );
      return null;
    }
    return await response2.json();
  } catch (error) {
    console.warn(
      `Nylas pricing: owners REST read for ${ownerId} failed. ${String(error?.message || error)}`
    );
    return null;
  }
};
var dealOwnerIdFor = async (client, dealId) => {
  try {
    const ownerRead = await client.crm.deals.basicApi.getById(String(dealId), [
      "hubspot_owner_id"
    ]);
    return ownerRead?.properties?.hubspot_owner_id || "";
  } catch (error) {
    console.warn(
      `Nylas pricing: could not read hubspot_owner_id on deal ${dealId}. ${providerMessage(error)}`
    );
    return "";
  }
};
var senderProperties = async (client, ownerId) => {
  if (!ownerId) return {};
  try {
    let owner = await client.crm.owners.ownersApi.getById(Number(ownerId));
    if (!owner?.firstName && !owner?.lastName && !owner?.email) {
      console.warn(
        `Nylas pricing: the SDK returned owner ${ownerId} with no name or email. Reading the owners endpoint directly before giving up.`
      );
      owner = await readOwnerDirectly(ownerId) || owner;
    }
    const firstName = owner?.firstName || "";
    const lastName = owner?.lastName || "";
    const email = owner?.email || "";
    if (!email) {
      console.error(
        `Nylas pricing: owner ${ownerId} has NO EMAIL. hs_sender_email is required before a CPQ quote can be moved to PENDING_APPROVAL, so this quote will stay at DRAFT. Check the owner's email in HubSpot, and that the app has the owners read scope.`
      );
    }
    if (!firstName && !lastName && !email) {
      return {};
    }
    return {
      ...firstName ? { hs_sender_firstname: firstName } : {},
      ...lastName ? { hs_sender_lastname: lastName } : {},
      ...email ? { hs_sender_email: email } : {}
    };
  } catch (error) {
    console.warn(
      `Nylas pricing: could not read owner ${ownerId} for the Seller block. ${providerMessage(error)}`
    );
    return {};
  }
};
var QUOTE_EXPIRY_DAYS = 90;
var quoteExpirationDate = (contractStartDate, now = /* @__PURE__ */ new Date()) => {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  today.setUTCDate(today.getUTCDate() + QUOTE_EXPIRY_DAYS);
  return today.toISOString().slice(0, 10);
};
var archiveSupersededQuote = async (client, supersededQuoteId, newQuoteId) => {
  if (!supersededQuoteId || supersededQuoteId === String(newQuoteId)) return null;
  try {
    const superseded = await client.crm.quotes.basicApi.getById(supersededQuoteId, ["hs_status"]);
    const status = superseded?.properties?.hs_status;
    if (!ARCHIVABLE_QUOTE_STATUSES.includes(String(status))) {
      console.warn(
        `Nylas pricing: superseded quote ${supersededQuoteId} left in place -- status is ${status || "unknown"}, which is not one of ${ARCHIVABLE_QUOTE_STATUSES.join(", ")}.`
      );
      return null;
    }
    await client.crm.quotes.basicApi.archive(supersededQuoteId);
    return supersededQuoteId;
  } catch (error) {
    console.warn(
      `Nylas pricing: could not archive superseded quote ${supersededQuoteId}. It is left in place. ${providerMessage(error)}`
    );
    return null;
  }
};
var primaryQuoteLabelCache;
var primaryQuoteAssociationType = async (client) => {
  if (primaryQuoteLabelCache !== void 0) return primaryQuoteLabelCache;
  try {
    const schema = await client.crm.associations.v4.schema.definitionsApi.getAll("quotes", "deals");
    const definitions = schema?.results || [];
    const match = definitions.find((entry) => /primary/i.test(String(entry?.label || "")));
    if (!match) {
      console.warn(
        `Nylas pricing: no primary-quote association label exists on quotes -> deals. Labels available: [${definitions.map((e) => e?.label || e?.typeId).join(", ")}]. Create one in HubSpot association settings and the next Lock in will apply it.`
      );
      primaryQuoteLabelCache = null;
      return primaryQuoteLabelCache;
    }
    primaryQuoteLabelCache = {
      typeId: match.typeId,
      label: match.label,
      category: match.category || "USER_DEFINED"
    };
    console.info(
      `Nylas pricing: primary-quote label resolved -- "${match.label}" typeId=${match.typeId} category=${primaryQuoteLabelCache.category}`
    );
    return primaryQuoteLabelCache;
  } catch (error) {
    console.warn(
      `Nylas pricing: could not read the quotes -> deals association labels. ${providerMessage(error)}`
    );
    primaryQuoteLabelCache = null;
    return primaryQuoteLabelCache;
  }
};
var markAsPrimaryQuote = async (client, quoteId, dealId) => {
  const labelType = await primaryQuoteAssociationType(client);
  if (!labelType) return { applied: false, label: null, reason: "no primary-quote label" };
  try {
    await client.crm.associations.v4.basicApi.create("quotes", String(quoteId), "deals", String(dealId), [
      { associationCategory: labelType.category, associationTypeId: labelType.typeId }
    ]);
    console.info(
      `Nylas pricing: quote ${quoteId} marked as the primary quote on deal ${dealId}.`
    );
    return { applied: true, label: labelType.label, reason: null };
  } catch (error) {
    const detail = providerMessage(error);
    const ineligible = /not eligible to become primary/i.test(detail);
    if (ineligible) {
      console.info(
        `Nylas pricing: quote ${quoteId} is a draft, so HubSpot will not make it the primary quote on deal ${dealId} yet. It becomes eligible when the quote is published.`
      );
    } else {
      console.warn(
        `Nylas pricing: could not mark quote ${quoteId} primary on deal ${dealId}. ${detail}`
      );
    }
    return {
      applied: false,
      label: labelType.label,
      ineligible,
      reason: detail
    };
  }
};
var CPQ_QUOTE_TYPE_INITIAL = "INITIAL";
var reportTemplateApplied = (quoteId, templateId, templateName, finalized) => {
  const applied = Boolean(
    finalized?.properties?.hs_terms || finalized?.properties?.hs_net_payment_terms
  );
  if (applied) {
    console.info(
      `Nylas pricing: quote ${quoteId} initialized from template ${templateId} ("${templateName}") -- hs_type=${finalized?.properties?.hs_type || "unset"}, net terms ${finalized?.properties?.hs_net_payment_terms || "0"}, terms block ${finalized?.properties?.hs_terms ? "present" : "absent"}.`
    );
    return applied;
  }
  console.error(
    `Nylas pricing: quote ${quoteId} carries template ${templateId} ("${templateName}") but was NOT initialized from it -- no terms block and no net payment terms came across. The document will render from HubSpot's default, not this template. The template association is on the create request, so if this fires the create was rejected or reordered; read the create response before changing anything else.`
  );
  return applied;
};
var clearClonedLineItems = async (client, quoteId, dealId) => {
  try {
    const clonedLineItemIds = await associatedIds(client, "quotes", String(quoteId), "line_items", 200);
    if (clonedLineItemIds.length === 0) return;
    console.info(
      `Nylas pricing: clearing ${clonedLineItemIds.length} line item(s) HubSpot cloned from deal ${dealId} onto quote ${quoteId}; the calculator's own lines follow.`
    );
    await inBatches(
      clonedLineItemIds,
      (id) => client.crm.lineItems.basicApi.archive(String(id)).catch((error) => {
        console.warn(
          `Nylas pricing: could not archive cloned line item ${id} on quote ${quoteId}. ${providerMessage(error)}`
        );
      })
    );
  } catch (error) {
    console.warn(
      `Nylas pricing: could not read the line items HubSpot cloned onto quote ${quoteId}. Duplicate lines may appear. ${providerMessage(error)}`
    );
  }
};
var resolveQuoteTemplate = async (client, content, state, settings) => {
  const templateCategoryEarly = dealCategory(settings, state.dealType, state.pipelineId);
  const requestedTemplateId = content.templateId || defaultQuoteTemplate(settings, templateCategoryEarly);
  if (!/^\d+$/.test(requestedTemplateId)) throw new Error("QUOTE_CONFIGURATION_REQUIRED");
  const templateCategory = dealCategory(settings, state.dealType, state.pipelineId);
  const allowedTemplateIds = new Set(
    quoteTemplateSettings(settings, templateCategory).enabledIds.map(String)
  );
  let templateId = requestedTemplateId;
  if (allowedTemplateIds.size > 0 && !allowedTemplateIds.has(String(requestedTemplateId))) {
    const configuredDefault = defaultQuoteTemplate(settings, templateCategory);
    console.error(
      `Nylas pricing: template ${requestedTemplateId} is not one of the templates chosen in Settings (${[...allowedTemplateIds].join(", ")}). Using ${configuredDefault} instead. The card is most likely a cached older bundle, or Settings changed while it was open.`
    );
    if (/^\d+$/.test(String(configuredDefault))) templateId = String(configuredDefault);
  }
  const { type: templateType, name: templateName } = await describeQuoteTemplate(
    client,
    templateId
  );
  if (templateType !== REQUIRED_QUOTE_TEMPLATE_TYPE && templateType !== "unknown") {
    console.error(
      `Nylas pricing: refusing to build a quote from template ${templateId} ("${templateName}") -- hs_type is "${templateType}", not "${REQUIRED_QUOTE_TEMPLATE_TYPE}".`
    );
    const failure = new Error("QUOTE_TEMPLATE_NOT_CPQ");
    failure.diagnostics = { quoteTemplateId: templateId, quoteTemplateType: templateType };
    throw failure;
  }
  return { templateId, templateName, templateType };
};
var generateQuote = async (client, dealId, state, parameters, portalId, settings) => {
  const option = selectedOptionForDraft(state);
  assertCurrentSettings(option, settings);
  const content = normalizeQuoteContent(
    parameters.quoteContent,
    defaultQuoteTitle(
      await dealCompanyName(client, dealId),
      option.input?.startDate,
      state.dealName
    ) || `${state.dealName} \u2013 ${option.name}`
  );
  const needsApproval = String(option.result?.approvalTierRequired || "none") !== "none";
  const desiredQuoteStatus = needsApproval ? QUOTE_STATUS_PENDING_APPROVAL : QUOTE_STATUS_DRAFT;
  const { templateId, templateName, templateType } = await resolveQuoteTemplate(
    client,
    content,
    state,
    settings
  );
  const hash = contentHash(option, { ...content, templateId });
  let supersededQuoteId = "";
  try {
    const priorDeal = await client.crm.deals.basicApi.getById(String(dealId), [
      "pricing_latest_quote_id"
    ]);
    supersededQuoteId = priorDeal?.properties?.pricing_latest_quote_id || "";
  } catch (error) {
    console.warn(
      `Nylas pricing: could not read pricing_latest_quote_id on deal ${dealId}. ${providerMessage(error)}`
    );
  }
  const dealOwnerId = await dealOwnerIdFor(client, dealId);
  if (!dealOwnerId) {
    console.warn(
      `Nylas pricing: deal ${dealId} has no hubspot_owner_id. The quote will carry no owner and no Seller contact. Set an owner on the Deal -- the seller is never substituted.`
    );
  }
  const sender = await senderProperties(client, dealOwnerId);
  console.info(
    `Nylas pricing: quote seller resolved -- deal owner=${dealOwnerId || "NONE"} fields=[${Object.keys(sender).join(", ") || "NONE"}]`
  );
  const lineItems = buildQuoteLineItems(option, content);
  const quoteCreateAssociations = [
    // 286, quote template. The one this whole block exists for.
    createAssociation(templateId, 286),
    // 64, deal. Also moved onto the create: both paths that produce a correctly initialized quote
    // -- the Quotes tool and an API create -- have it there.
    createAssociation(dealId, 64)
  ];
  let quote;
  const createdLineItemIds = [];
  try {
    quote = await client.crm.quotes.basicApi.create({
      properties: {
        hs_title: content.title,
        // The contract start is the calculator's derived order start date, not the rep's raw
        // input, so the quote and the Deal's contract dates cannot disagree.
        //
        // The EXPIRATION is start + 5 days and never in the past -- see quoteExpirationDate.
        // It is always sent: hs_expiration_date is required at creation, and never send an empty
        // string for a date in HubSpot -- that is not "no date", it lands on the epoch and prints
        // as January 1, 1970.
        hs_expiration_date: quoteExpirationDate(option.result.dates.contractStartDate),
        ...option.result.dates.contractStartDate ? {
          hs_contract_effective_start_date: option.result.dates.contractStartDate,
          // CUSTOM, sent explicitly alongside the date. Holly, 2026-09-01: "the effective
          // date needs to be the first of the next month."
          //
          // All three quote templates carry hs_contract_effective_start_date_type =
          // ON_AGREEMENT, which means "effective when the customer accepts" -- HubSpot then
          // resolves the effective date to the acceptance date. Quote 42608004129 (20:39, made
          // through the contract UI) came out effective 2026-09-01 rather than the 2026-10-01
          // order start. Pinning the type is what makes the date the app sends survive; sending
          // the date alone is not enough, because the type is what HubSpot reads to decide
          // whether to keep it.
          //
          // NOT because line items must match this date. A line item billing start AFTER the
          // effective date is a SUPPORTED configuration -- HubSpot files it under Future
          // payments. An earlier version of this comment claimed the 2026-10-01 lines against
          // a 2026-09-01 effective date were the defect; they were not. The real rules are:
          // billing end must not precede billing start; frequency, term and number of payments
          // must agree; and a custom effective date must be in the future when BILLING IS
          // ENABLED. Billing is disabled on this portal (hs_billing_enabled: false) and the
          // date is the first of next month, so it satisfies that rule either way.
          hs_contract_effective_start_date_type: "CUSTOM"
        } : {},
        // hs_comments and hs_terms are deliberately not sent.
        //
        // hs_terms is the property the quote template's "Payment Terms:" section renders. The app
        // was writing the renewal sentence into it, so a renewal term printed under a Payment
        // Terms heading -- duplicating the template's own [Auto Renewal Terms] token -- while
        // Billing schedule and Payment Method came up empty. The template owns this text; the
        // calculator has no business overwriting it.
        // Required, and previously not sent at all. Every quote template in the portal is a
        // cpq_template, and a quote must declare CPQ_QUOTE to be compatible with them. Without
        // it the quote defaults to the legacy model and HubSpot rejects the CPQ template it is
        // associated with.
        hs_template_type: "CPQ_QUOTE",
        // Always INITIAL. The public API refuses every other value at the create -- see
        // CPQ_QUOTE_TYPE_INITIAL above for HubSpot's exact refusal. The TEMPLATE is what the rep
        // chooses and what the customer reads; it has no bearing on the CPQ type sent here.
        hs_type: CPQ_QUOTE_TYPE_INITIAL,
        // The seller is the DEAL OWNER, explicitly, not whoever clicked Lock in and not whatever
        // the API defaults to. This used to be left unset on the reasoning that a quote inherits
        // the owner from its associated deal -- a sentence from HubSpot's Quotes guide that was
        // never checked against this portal. Holly, 2026-08-28: it has to be the deal owner, so
        // it is set rather than hoped for.
        //
        // Omitted when the Deal has no owner: an empty string is not "no owner" to HubSpot.
        ...dealOwnerId ? {
          hubspot_owner_id: dealOwnerId,
          // hs_quote_owner_id is HubSpot's "Quote sender", a DIFFERENT property from
          // hubspot_owner_id ("Quote owner"). Untried until now, and the last documented
          // candidate: on 2026-08-28 quote 42562905272 was confirmed to carry
          // hubspot_owner_id 1512537839 while keeping NONE of hs_sender_firstname,
          // hs_sender_lastname or hs_sender_email -- HubSpot accepted those writes and
          // discarded them, so they are not what a CPQ quote reads.
          //
          // The theory this tests: a CPQ quote derives its Seller Contact from the SENDER,
          // and the hs_sender_* block is either derived from it or is legacy-only. The card's
          // Seller banner reports whether this sticks, so the next round is evidence rather
          // than another guess.
          hs_quote_owner_id: dealOwnerId
        } : {},
        // The Seller block the customer reads. The owner above is the CRM record's owner; these
        // three are what the quote actually prints. Both are needed.
        ...sender,
        // ACCEPTANCE METHOD IS SENT, AND HAS TO BE. Removed 2026-09-01 on the instruction that the
        // app should not set it; put back 14 minutes later, measured:
        //
        //   20:04:45  app sends clickwrap  -> clickwrap,      signature box OFF
        //   20:14:58  app sends nothing    -> print_and_sign, signature box ON
        //   20:15:34  app sends nothing    -> print_and_sign, signature box ON
        //   20:18:04  app sends nothing    -> print_and_sign, signature box ON
        //
        // All three templates are set to clickwrap. HubSpot does NOT inherit it: print_and_sign is
        // the API default for a quote created through the API, and it wins over the template. So
        // "don't send it" means every generated quote asks the customer for a signature, which is
        // the opposite of what Nylas wants -- Holly: "all are accept without signature".
        //
        // This is the second time this property has been removed and restored on the same
        // evidence. Do not remove it again without first changing the portal or template default
        // AND confirming a generated quote comes out clickwrap.
        hs_acceptance_method: QUOTE_ACCEPTANCE_METHOD
        // hs_esign_enabled, hs_cover_letter and hs_executive_summary stay unsent. The app has
        // never sent any of them and must not start: a hand-made quote carries cover letter and
        // executive summary because HubSpot's Quotes tool writes that prose, and the app is not
        // its owner.
        // hs_status is NOT sent here. "CPQ Quotes cannot be published on create. Create as
        // draft and then update to be published." -- HubSpot, verbatim. The quote is created at
        // DRAFT and moved after its line items exist; see the transition below.
      },
      // The template, the deal and (for change and renewal) the contract. Built above, sent here,
      // because HubSpot reads a quote's associations while it initializes it and never again.
      associations: quoteCreateAssociations
    });
    await clearClonedLineItems(client, quote.id, dealId);
    const primaryQuote = await markAsPrimaryQuote(client, quote.id, dealId);
    const sendingQuoteLines = lineItems.map((item) => ({
      properties: hubSpotLineItemProperties(item.properties),
      // 68, not 67. Association type ids are directional: 67 is defined FROM the quote (0-14) TO
      // the line item, but this association is declared on the line item's own create, so the
      // "from" side is the line item (0-8). HubSpot rejected it with "invalid from object type
      // 0-8 ... expected: 0-14. For definition 0-67". 68 is the line-item-to-quote direction --
      // the same reason the Deal sync uses 20.
      associations: [createAssociation(quote.id, 68)]
    }));
    const createdQuoteLines = await createLineItemsBatch(
      client,
      sendingQuoteLines,
      createdLineItemIds
    );
    await repairLineItemsBatch(
      client,
      joinCreatedLineItems(sendingQuoteLines, createdQuoteLines) || []
    );
    const [dealContactIds, companyIds] = await Promise.all([
      associatedIds(client, "deals", dealId, "contacts", 10),
      associatedIds(client, "deals", dealId, "companies", 1)
    ]);
    const chosenContactId = String(parameters.contactId || "");
    const contactIds = chosenContactId ? [chosenContactId] : dealContactIds;
    if (contactIds.length === 0) throw new Error("QUOTE_CONTACT_REQUIRED");
    if (chosenContactId && !dealContactIds.includes(chosenContactId)) {
      try {
        await client.crm.associations.v4.basicApi.createDefault(
          "deals",
          String(dealId),
          "contacts",
          chosenContactId
        );
      } catch (error) {
        console.warn(
          `Nylas pricing: could not associate contact ${chosenContactId} to deal ${dealId}. ${providerMessage(error)}`
        );
      }
    }
    await Promise.all(
      contactIds.map(
        (contactId) => client.crm.associations.v4.basicApi.create(
          "quotes",
          String(quote.id),
          "contacts",
          contactId,
          [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 69 }]
        )
      )
    );
    if (companyIds[0]) {
      await client.crm.associations.v4.basicApi.create(
        "quotes",
        String(quote.id),
        "companies",
        companyIds[0],
        [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 71 }]
      );
    }
    if (parameters.contractId) {
      try {
        await client.crm.associations.v4.basicApi.createDefault(
          "quotes",
          String(quote.id),
          CONTRACT_OBJECT_TYPE,
          String(parameters.contractId)
        );
        console.info(
          `Nylas pricing: associated contract ${parameters.contractId} to quote ${quote.id}.`
        );
      } catch (error) {
        console.warn(
          `Nylas pricing: could not associate contract ${parameters.contractId} to quote ${quote.id}. ${providerMessage(error)}`
        );
      }
    }
    const finalized = await client.crm.quotes.basicApi.getById(String(quote.id), [
      "hs_quote_link",
      "hs_status",
      // Read back so the log can say whether CPQ initialization actually took, instead of the
      // next person diffing two quote records by hand for a day. See below.
      "hs_type",
      "hs_net_payment_terms",
      "hs_terms",
      ...Object.keys(sender)
    ]);
    const quoteUrl = finalized?.properties?.hs_quote_link || "";
    reportTemplateApplied(quote.id, templateId, templateName, finalized);
    let quoteStatus = finalized?.properties?.hs_status || "";
    let quoteStatusRepaired = false;
    let quoteStatusError = "";
    if (quoteStatus !== desiredQuoteStatus) {
      console.info(
        `Nylas pricing: quote ${quote.id} was created as "${quoteStatus || "unset"}"; moving it to ${desiredQuoteStatus}. On an approvals-enabled portal this is the only legal way to reach it -- the create cannot carry a published status.`
      );
      try {
        await client.crm.quotes.basicApi.update(String(quote.id), {
          properties: { hs_status: desiredQuoteStatus }
        });
        const after = await client.crm.quotes.basicApi.getById(String(quote.id), ["hs_status"]);
        quoteStatus = after?.properties?.hs_status || quoteStatus;
        quoteStatusRepaired = quoteStatus === desiredQuoteStatus;
      } catch (error) {
        quoteStatusError = providerMessage(error).slice(0, 600);
        console.error(
          `Nylas pricing: could not set hs_status on quote ${quote.id}. The approval workflow will not enrol it. ${quoteStatusError}`,
          safeProviderDiagnostics(error, "set_quote_status")
        );
      }
    }
    const senderMissing = Object.entries(sender).filter(
      ([name]) => !finalized?.properties?.[name]
    );
    let senderRepaired = false;
    if (senderMissing.length > 0) {
      console.error(
        `Nylas pricing: quote ${quote.id} did not keep [${senderMissing.map(([name]) => name).join(", ")}] from the create. Setting them now.`
      );
      try {
        await client.crm.quotes.basicApi.update(String(quote.id), {
          properties: Object.fromEntries(senderMissing)
        });
        const after = await client.crm.quotes.basicApi.getById(
          String(quote.id),
          Object.keys(sender)
        );
        senderRepaired = Object.keys(sender).every((name) => after?.properties?.[name]);
      } catch (error) {
        console.error(
          `Nylas pricing: the Seller block could not be set on quote ${quote.id}. ${providerMessage(error)}`
        );
      }
    }
    const generatedAt = (/* @__PURE__ */ new Date()).toISOString();
    await updateDealProperties(client, dealId, {
      pricing_latest_quote_id: String(quote.id),
      pricing_quote_id: String(quote.id),
      pricing_latest_quote_url: quoteUrl,
      pricing_quote_content_hash: hash,
      pricing_quote_generation_status: "draft_created",
      pricing_quote_generated_at: generatedAt,
      // Everything the calculator knew and the quote record cannot carry. Guarded in
      // UNVERIFIED_DEAL_PROPERTIES, so a portal without the property drops this and keeps the rest.
      [CALCULATOR_DETAILS_PROPERTY]: calculatorDetails({
        generatedAt,
        quoteId: String(quote.id),
        quoteType: finalized?.properties?.hs_type,
        intendedKind: quoteKindForTemplate(settings, templateId),
        contract: parameters.contractId ? String(parameters.contractId) : "",
        templateId,
        templateName,
        category: dealCategory(settings, state.dealType, state.pipelineId),
        pipelineId: state.pipelineId,
        option,
        lineItemCount: createdLineItemIds.length,
        status: quoteStatus,
        outcome: "Quote created by the app"
      })
    });
    if (parameters.replaceExistingQuote === true) {
      await archiveSupersededQuote(client, supersededQuoteId, quote.id);
    }
    return {
      // What the Seller block actually resolved to, so a blank one is visible on the card rather
      // than only in logs nobody can reach mid-call.
      seller: {
        ownerId: dealOwnerId || "",
        sent: Object.keys(sender),
        keptOnCreate: Object.keys(sender).filter((name) => Boolean(finalized?.properties?.[name])),
        repaired: senderRepaired
      },
      // Reported for the same reason as the Seller block: a primary flag that silently did not
      // apply is indistinguishable from one that did, and this is the third time a quietly-skipped
      // write has cost a round trip.
      primaryQuote,
      quoteId: String(quote.id),
      quoteUrl,
      generatedAt,
      templateId,
      templateName,
      // What the Internal quote status actually ended up as, and whether it took a second write.
      // The card prints it: this is the field the approval workflow watches, so a silent failure
      // here means an approval nobody is asked for.
      quoteStatus,
      quoteStatusExpected: desiredQuoteStatus,
      quoteStatusRepaired,
      quoteStatusError,
      needsApproval
    };
  } catch (error) {
    await archiveLineItemsBatch(client, createdLineItemIds).catch(() => void 0);
    if (quote?.id) await client.crm.quotes.basicApi.archive(quote.id).catch(() => void 0);
    await client.crm.deals.basicApi.update(dealId, { properties: { pricing_quote_generation_status: "failed" } }).catch(() => void 0);
    const diagnostics = {
      ...safeProviderDiagnostics(error, "generate_quote"),
      // Which template was used, and what HubSpot says it is. Without this the rep sees a
      // template complaint with no way to tell which template caused it.
      quoteTemplateId: templateId,
      quoteTemplateType: templateType
    };
    console.error("Nylas pricing quote creation failed.", diagnostics, error?.stack || error);
    if (error?.message === "TOO_MANY_LINE_ITEMS") throw new Error("TOO_MANY_LINE_ITEMS");
    const failure = new Error("QUOTE_CREATE_FAILED");
    failure.diagnostics = diagnostics;
    throw failure;
  }
};
var ADOPTABLE_QUOTE_TYPES = Object.freeze(["CHANGE", "RENEWAL"]);
var adoptableQuotes = async (client, dealId) => {
  try {
    const ids = await associatedIds(client, "deals", String(dealId), "quotes", 50);
    if (ids.length === 0) return [];
    const read = await client.crm.quotes.batchApi.read({
      inputs: ids.map((id) => ({ id: String(id) })),
      properties: ["hs_title", "hs_type", "hs_status", "hs_createdate"]
    });
    return (read.results || []).filter(
      ({ properties }) => ADOPTABLE_QUOTE_TYPES.includes(String(properties?.hs_type || "")) && String(properties?.hs_status || "") === QUOTE_STATUS_DRAFT
    ).sort(
      (a, b) => String(b.properties?.hs_createdate || "").localeCompare(
        String(a.properties?.hs_createdate || "")
      )
    ).map(({ id, properties }) => ({
      id: String(id),
      title: properties?.hs_title || `Quote ${id}`,
      type: String(properties?.hs_type || "")
    }));
  } catch (error) {
    console.warn(
      `Nylas pricing: could not list the change and renewal quotes on deal ${dealId}.`,
      safeProviderDiagnostics(error, "list_adoptable_quotes")
    );
    return [];
  }
};
var priceExistingQuote = async (client, dealId, state, parameters, settings) => {
  const option = selectedOptionForDraft(state);
  assertCurrentSettings(option, settings);
  const quoteId = String(parameters.applyToQuoteId || "");
  if (!/^\d+$/.test(quoteId)) throw new Error("QUOTE_NOT_ADOPTABLE");
  const eligible = await adoptableQuotes(client, dealId);
  if (!eligible.some(({ id }) => id === quoteId)) throw new Error("QUOTE_NOT_ADOPTABLE");
  const lineItems = buildQuoteLineItems(
    option,
    normalizeQuoteContent(parameters.quoteContent, state.dealName || "Quote")
  );
  const dealOwnerId = await dealOwnerIdFor(client, dealId);
  const sender = await senderProperties(client, dealOwnerId);
  const existingLineItemIds = await associatedIds(client, "quotes", quoteId, "line_items", 200);
  const createdLineItemIds = [];
  try {
    const sending = lineItems.map((item) => ({
      properties: hubSpotLineItemProperties(item.properties),
      // 68, the line-item-to-quote direction, because the association is declared on the line
      // item's own create. See generateQuote.
      associations: [createAssociation(quoteId, 68)]
    }));
    const created = await createLineItemsBatch(client, sending, createdLineItemIds);
    await repairLineItemsBatch(client, joinCreatedLineItems(sending, created) || []);
  } catch (error) {
    await archiveLineItemsBatch(client, createdLineItemIds).catch(() => void 0);
    throw error;
  }
  if (existingLineItemIds.length > 0) {
    console.info(
      `Nylas pricing: replacing ${existingLineItemIds.length} line item(s) on quote ${quoteId} with the calculator's.`
    );
    await archiveLineItemsBatch(client, existingLineItemIds).catch((error) => {
      console.warn(
        `Nylas pricing: could not archive the previous line items on quote ${quoteId}. It may now show both sets. ${providerMessage(error)}`
      );
    });
  }
  const properties = {
    hs_expiration_date: quoteExpirationDate(option.result.dates.contractStartDate),
    ...option.result.dates.contractStartDate ? {
      hs_contract_effective_start_date: option.result.dates.contractStartDate,
      hs_contract_effective_start_date_type: "CUSTOM"
    } : {},
    hs_acceptance_method: QUOTE_ACCEPTANCE_METHOD,
    ...dealOwnerId ? { hubspot_owner_id: dealOwnerId, hs_quote_owner_id: dealOwnerId } : {},
    ...sender
  };
  try {
    await client.crm.quotes.basicApi.update(quoteId, { properties });
  } catch (error) {
    console.error(
      `Nylas pricing: the line items were applied to quote ${quoteId} but its properties were not. ${providerMessage(error)}`,
      safeProviderDiagnostics(error, "price_existing_quote_properties")
    );
  }
  const needsApproval = String(option.result?.approvalTierRequired || "none") !== "none";
  let quoteStatus = QUOTE_STATUS_DRAFT;
  let quoteStatusError = "";
  if (needsApproval) {
    try {
      await client.crm.quotes.basicApi.update(quoteId, {
        properties: { hs_status: QUOTE_STATUS_PENDING_APPROVAL }
      });
      const after = await client.crm.quotes.basicApi.getById(quoteId, ["hs_status"]);
      quoteStatus = after?.properties?.hs_status || quoteStatus;
    } catch (error) {
      quoteStatusError = providerMessage(error).slice(0, 600);
      console.error(
        `Nylas pricing: could not move quote ${quoteId} to PENDING_APPROVAL. The approval workflow will not enrol it. ${quoteStatusError}`,
        safeProviderDiagnostics(error, "price_existing_quote_status")
      );
    }
  }
  const finalized = await client.crm.quotes.basicApi.getById(quoteId, ["hs_quote_link", "hs_title", "hs_type"]).catch(() => null);
  const quoteUrl = finalized?.properties?.hs_quote_link || "";
  const generatedAt = (/* @__PURE__ */ new Date()).toISOString();
  await updateDealProperties(client, dealId, {
    pricing_latest_quote_id: quoteId,
    pricing_quote_id: quoteId,
    pricing_latest_quote_url: quoteUrl,
    pricing_quote_generation_status: "draft_created",
    pricing_quote_generated_at: generatedAt,
    // The quote HubSpot made carries its own real hs_type, so this record is the more interesting
    // half: it says what the app priced onto it and with which numbers.
    [CALCULATOR_DETAILS_PROPERTY]: calculatorDetails({
      generatedAt,
      quoteId,
      quoteType: finalized?.properties?.hs_type,
      intendedKind: quoteKindForTemplate(settings, ""),
      templateId: "(HubSpot chose it)",
      templateName: finalized?.properties?.hs_title,
      category: dealCategory(settings, state.dealType, state.pipelineId),
      pipelineId: state.pipelineId,
      option,
      lineItemCount: lineItems.length,
      status: quoteStatus,
      outcome: "Pricing applied to a quote HubSpot created"
    })
  });
  console.info(
    `Nylas pricing: priced HubSpot-created quote ${quoteId} (hs_type=${finalized?.properties?.hs_type || "unknown"}) with ${lineItems.length} line item(s) from deal ${dealId}.`
  );
  return {
    quoteId,
    quoteUrl,
    generatedAt,
    adopted: true,
    quoteTitle: finalized?.properties?.hs_title || "",
    quoteType: finalized?.properties?.hs_type || "",
    lineItemCount: lineItems.length,
    quoteStatus,
    quoteStatusExpected: needsApproval ? QUOTE_STATUS_PENDING_APPROVAL : QUOTE_STATUS_DRAFT,
    quoteStatusError,
    needsApproval,
    seller: { ownerId: dealOwnerId || "", sent: Object.keys(sender) }
  };
};
var departureNote = (result) => {
  const parts = [];
  const pct = (value) => `${Math.round(Number(value) * 1e3) / 10}%`;
  if (result.largestDiscretionaryDiscount) {
    parts.push(`largest discount ${pct(result.largestDiscretionaryDiscount)}`);
  }
  if (result.largestDiscretionaryUplift) {
    parts.push(`largest uplift ${pct(result.largestDiscretionaryUplift)}`);
  }
  return parts.length ? `  (${parts.join(", ")})` : "";
};
var calculatorDetails = ({
  generatedAt,
  quoteId,
  quoteType,
  intendedKind,
  templateId,
  templateName,
  category,
  pipelineId,
  option,
  lineItemCount,
  status,
  outcome,
  contract
}) => {
  const result = option?.result || {};
  const money = (value) => value == null ? "-" : `$${Number(value).toLocaleString("en-US")}`;
  const row = (label, value) => `${String(label).padEnd(16)}${value}`;
  return [
    `${generatedAt}  Lock in`,
    row("Outcome", outcome),
    row("Quote", quoteId ? `${quoteId}  (${quoteType || "INITIAL"}, ${status || "-"})` : "none"),
    // The whole point of the field: what this WOULD be if HubSpot allowed it.
    // "unknown", not "new_business": a template no list claims is unconfigured, and guessing a
    // kind here would put a wrong answer in the one field that exists to hold the right one.
    row("Intended kind", intendedKind || "unknown (template not listed in Settings)"),
    row("Template", `${templateId}  "${templateName || "-"}"`),
    row("Deal category", `${category}  (pipeline ${pipelineId || "-"})`),
    // Term is on the INPUT, not the result -- the result carries the derived billing period only.
    row(
      "Term / payment",
      `${option?.input?.termMonths || "-"} months, ${result.billingPeriod || "-"}`
    ),
    // Both directions, because the ladder routes on whichever is larger. A tier with no figure
    // beside it is the thing that makes an approval unreadable six months later.
    row(
      "Approval",
      `${result.approvalTierRequired || "none"}${departureNote(result)}`
    ),
    row("Committed ARR", money(result.committedArr)),
    row("TCV", money(result.tcv)),
    row("Line items", lineItemCount == null ? "-" : String(lineItemCount)),
    // Only on renewals, and only when one was chosen -- an empty "Contract" row on every
    // new-business lock would read as a missing value rather than an inapplicable one.
    ...contract ? [row("Contract", contract)] : [],
    ...result.blockingReasons?.length ? [row("Blocked by", result.blockingReasons.join(" | "))] : []
  ].join("\n");
};
var stateResponse = (state) => ({
  optionSet: state.document,
  selectedOptionId: state.selectedOptionId,
  selectedOptionName: state.selectedOptionName,
  approvalStatus: state.approvalStatus,
  lineItemSyncStatus: state.lineItemSyncStatus,
  latestQuoteId: state.latestQuoteId,
  latestQuoteUrl: state.latestQuoteUrl
});
exports.main = async (context) => {
  try {
    const parameters = context?.parameters || {};
    const action = parameters.action;
    console.info(`Nylas pricing action started: ${String(action || "missing")}.`);
    const accessToken = getAccessToken();
    const accountId = accountIdFromContext(context);
    const userId = userIdFromContext(context);
    if (action === "get_settings") {
      const [settingsState2, pipelines] = await Promise.all([
        readSettings(accessToken, accountId),
        readDealPipelines(accessToken)
      ]);
      return response(200, {
        success: true,
        settings: settingsState2.settings,
        configured: settingsState2.configured,
        canEdit: isSettingsAdmin(context),
        pipelines,
        // The FULL list, not the narrowed one: this is the screen where the narrowing is chosen,
        // so it has to show every template the portal has.
        quoteTemplates: await usableQuoteTemplates(getClient()),
        // The product rows and band labels, derived from pricingRules. The Settings screen used to
        // carry its own copy of all seven products and every band boundary as a literal string.
        productRates: productRateDescriptors(),
        // ONE list instead of four. Phase 1 of the configurable-calculator proposal: the card used
        // to restate every product, option, term and cadence as literals, and nothing enforced
        // agreement with the rate card. Built server-side from pricingRules, so the catalogue can
        // never offer something the calculator cannot price. See catalog.js.
        catalog: buildCatalog()
      });
    }
    if (action === "update_settings") {
      if (!isSettingsAdmin(context)) throw new Error("SETTINGS_UNAUTHORIZED");
      const settings2 = await saveSettings(
        accessToken,
        accountId,
        userId,
        parameters.settings,
        parameters.expectedVersion
      );
      return response(200, { success: true, settings: settings2, configured: true, canEdit: true });
    }
    const dealId = assertDealAccess(context, parameters.dealId);
    const client = getClient();
    const [state, settingsState] = await Promise.all([
      readDealState(client, dealId),
      readSettings(accessToken, accountId)
    ]);
    console.info("Nylas pricing action: deal state and settings loaded.");
    if (!settingsState.configured) throw new Error("SETTINGS_CONFIGURATION_REQUIRED");
    const settings = settingsState.settings;
    if (!isDealAllowed(settings, state.dealType, state.pipelineId)) throw new Error("INVALID_DEAL");
    if (action === "list") {
      const allTemplates = await usableQuoteTemplates(client);
      const listTemplates = offeredQuoteTemplates(
        allTemplates,
        settings,
        dealCategory(settings, state.dealType, state.pipelineId)
      );
      return response(200, {
        success: true,
        ...stateResponse(state),
        quoteTemplates: listTemplates,
        defaultQuoteTemplateId: defaultQuoteTemplate(
          settings,
          dealCategory(settings, state.dealType, state.pipelineId)
        ),
        ...await quoteContactOptions(client, dealId),
        // Contracts only on a renewal-category Deal. A new-business Deal never sees the picker and
        // never spends the round trip -- and the category is resolved SERVER-SIDE from the Deal,
        // never taken from the card, because a stale cached card bundle must not be able to widen
        // its own behaviour. Same reasoning as the old category guard.
        ...dealCategory(settings, state.dealType, state.pipelineId) === "renewal" ? await quoteContractOptions(client, dealId) : { contracts: [], contractSource: "not_renewal", contractsRead: true },
        // The same catalogue the Settings screen gets. The card renders what it is given.
        catalog: buildCatalog(),
        // The Deal's draft Change and Renewal quotes. HubSpot has to create those; the card offers
        // them so the rep can send this Deal's pricing to one instead of making a new quote.
        adoptableQuotes: await adoptableQuotes(client, dealId),
        dealOwnerId: state.dealOwnerId,
        // What the Deal's last quote was really built from, for the card's preselect.
        latestQuoteTemplate: await latestQuoteTemplate(client, state.latestQuoteId, allTemplates),
        // The card shows this as the Quote title placeholder, so a rep who leaves the field
        // blank can see the name the quote will actually get rather than being surprised by it.
        dealName: state.dealName,
        companyName: await dealCompanyName(client, dealId)
      });
    }
    if (action === "inspect_products") {
      return response(200, {
        success: true,
        productLibrary: await inspectProductLibrary(client)
      });
    }
    if (action === "preview") {
      return response(200, {
        success: true,
        previewResult: calculateQuote(
          parameters.input,
          settings.pricingPolicy,
          settings.version,
          dealCategory(settings, state.dealType, state.pipelineId)
        )
      });
    }
    if (action === "lock_live") {
      const locked = await lockLiveCalculation(
        client,
        dealId,
        state,
        parameters,
        accountId,
        settings
      );
      return response(200, { success: true, ...locked });
    }
    if (action === "calculate_and_save") {
      const saved = await calculateAndSaveOption(client, dealId, state, parameters, settings);
      return response(200, {
        success: true,
        optionSet: saved.document,
        option: saved.option,
        selectedOptionId: state.selectedOptionId,
        selectedOptionName: state.selectedOptionName,
        approvalStatus: state.approvalStatus
      });
    }
    if (action === "delete") {
      const deleted = await deleteOption(client, dealId, state, parameters);
      return response(200, {
        success: true,
        optionSet: deleted.document,
        selectedOptionId: deleted.selectedOptionId,
        selectedOptionName: deleted.selectedOptionName,
        approvalStatus: deleted.approvalStatus,
        lineItemSyncStatus: deleted.lineItemSyncStatus
      });
    }
    if (action === "select") {
      const selected = await chooseOption(client, dealId, state, parameters, settings);
      return response(200, {
        success: true,
        ...selected,
        optionSet: selected.document,
        document: void 0
      });
    }
    if (action === "sync_line_items") {
      const synced = await syncDealLineItems(client, dealId, state, settings);
      return response(200, {
        success: true,
        ...stateResponse({ ...state, lineItemSyncStatus: "synced" }),
        lineItemCount: synced.count,
        lineItemsSyncedAt: synced.syncedAt
      });
    }
    if (action === "generate_quote") {
      const quote = await generateQuote(
        client,
        dealId,
        state,
        parameters,
        accountId,
        settings
      );
      return response(200, {
        success: true,
        ...stateResponse({
          ...state,
          latestQuoteId: quote.quoteId,
          latestQuoteUrl: quote.quoteUrl
        }),
        ...quote
      });
    }
    return safeError("INVALID_OPTION");
  } catch (error) {
    if (error instanceof QuoteValidationError) {
      return safeError("INVALID_OPTION", 400, {
        field: error.field,
        validationCode: error.code
      });
    }
    if (String(error?.message || "").startsWith("INVALID_SETTINGS:")) {
      return safeError("SETTINGS_INVALID", 400, {
        field: String(error.message).slice("INVALID_SETTINGS:".length)
      });
    }
    if (SAFE_ERRORS[error?.message]) return safeError(error.message, 400, error.diagnostics);
    console.error(
      `Nylas pricing action failed: ${String(context?.parameters?.action || "missing")} \xB7 ${error?.name || "Error"}`,
      error?.stack || error?.message || error
    );
    return safeError("WRITE_FAILED", 500);
  }
};
exports._test = Object.freeze({
  archiveSupersededQuote,
  quoteExpirationDate,
  defaultQuoteTitle,
  offeredQuoteTemplates,
  usableQuoteTemplates,
  defaultQuoteTemplate,
  providerMessage,
  adoptableQuotes,
  priceExistingQuote,
  generateQuote,
  calculatorDetails,
  repairLineItemsBatch,
  createLineItemsBatch,
  archiveLineItemsBatch,
  joinCreatedLineItems,
  senderProperties,
  associatedIds,
  createLineItem,
  quoteContractOptions,
  contractStatusRank,
  contractIsOfferable,
  contractOptionLabel,
  readContractById,
  isUnknownPropertyRejection,
  deleteOption,
  lockLiveCalculation,
  autoRenewalProperties,
  contractTermProperties,
  paymentFrequencyProperties,
  paymentMethodProperties,
  syncDealLineItems,
  updateDealProperties,
  buildSelectedProperties,
  contractSummaryText,
  hubSpotChoiceList,
  professionalServiceHubSpotValue,
  addOnHubSpotValue,
  PROFESSIONAL_SERVICES_NONE
});
