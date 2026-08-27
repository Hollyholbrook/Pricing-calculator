var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// pricingRules.js
var require_pricingRules = __commonJS({
  "pricingRules.js"(exports2, module2) {
    module2.exports = Object.freeze({
      schemaVersion: "1.0",
      priceListVersion: "FY26 v1",
      calculationMethod: "excel_compatible",
      currency: "USD",
      effectiveDate: "2026-07-01",
      allowedTerms: [12, 24, 36],
      maximumVolume: 1e9,
      minimumCommittedArr: 25e3,
      redliningMinimumArr: 5e4,
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
          bands: [
            [0, 50, 1],
            [50, 100, 0.75],
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
      termRules: [
        { months: 12, discount: 0 },
        { months: 24, discount: 0.025 },
        { months: 36, discount: 0.05 }
      ],
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
      onboardingRules: [
        { key: "none", package: "None", oneTimeAmount: 0 },
        { key: "quick_launch", package: "Quick Launch", oneTimeAmount: 0 },
        { key: "quick_launch_plus", package: "Quick Launch +", oneTimeAmount: 5e3 },
        { key: "strategic", package: "Strategic Onboarding", oneTimeAmount: 1e4 }
      ],
      professionalServicesRules: [
        { itemCount: 0, oneTimeAmount: 0 },
        { itemCount: 1, oneTimeAmount: 2e3 },
        { itemCount: 2, oneTimeAmount: 3800 },
        { itemCount: 3, oneTimeAmount: 5500 },
        { itemCount: 4, oneTimeAmount: 7200 },
        { itemCount: 5, oneTimeAmount: 8800 }
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
      ],
      addOnRules: [
        {
          key: "enterprise_accelerator",
          label: "Enterprise Accelerator Package",
          annualAmount: 2400
        },
        {
          key: "privacy_filter",
          label: "Privacy Filter Mode",
          annualAmount: 6e3
        },
        {
          key: "verified_oauth",
          label: "Turnkey Verified OAuth Projects",
          annualAmount: 5e3,
          requiresProfessionalServices: true
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
    var requirePercent = (value, field) => {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
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
      const termMonths = requireInteger(input.termMonths, 12, 36, "termMonths");
      if (!activeRules.allowedTerms.includes(termMonths)) {
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
        input.psItemCount ?? professionalServices.length,
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
    var buildApproval = (input, largestDiscretionaryDiscount, committedArr, hasOauthDependencyFailure, activeRules = rules) => {
      const reasons = [];
      const blockingReasons = [];
      let tier = "none";
      const percentLabel = (value) => `${round(value * 100, 2)}%`;
      const currencyLabel = (value) => `$${round(value, 2).toLocaleString("en-US")}`;
      if (largestDiscretionaryDiscount > 0 && largestDiscretionaryDiscount <= activeRules.salesDirectorDiscountMax) {
        tier = "sales_director";
        reasons.push(
          `Discretionary discount is greater than 0% and no more than ${percentLabel(activeRules.salesDirectorDiscountMax)}.`
        );
      } else if (largestDiscretionaryDiscount > activeRules.salesDirectorDiscountMax && largestDiscretionaryDiscount <= activeRules.headSalesDiscountMax) {
        tier = "head_sales";
        reasons.push(
          `Discretionary discount is greater than ${percentLabel(activeRules.salesDirectorDiscountMax)} and no more than ${percentLabel(activeRules.headSalesDiscountMax)}.`
        );
      } else if (largestDiscretionaryDiscount > activeRules.headSalesDiscountMax) {
        tier = "finance";
        reasons.push(
          `Discretionary discount is greater than ${percentLabel(activeRules.headSalesDiscountMax)}.`
        );
      }
      if (input.nonStandardTerms) {
        tier = "finance";
        reasons.push("Contract includes non-standard terms.");
      }
      if (committedArr < activeRules.minimumCommittedArr) {
        tier = "finance";
        reasons.push(
          `Committed ARR is below the ${currencyLabel(activeRules.minimumCommittedArr)} Enterprise minimum.`
        );
        blockingReasons.push("BELOW_ENTERPRISE_MINIMUM");
      }
      if (input.redliningRequested && committedArr < activeRules.redliningMinimumArr) {
        tier = "finance";
        reasons.push(
          `Redlining was requested below the ${currencyLabel(activeRules.redliningMinimumArr)} ARR threshold.`
        );
        blockingReasons.push("REDLINING_BELOW_THRESHOLD");
      }
      if (input.redliningRequested) {
        reasons.push("Customer-requested redlines require Legal approval.");
      }
      if (hasOauthDependencyFailure) {
        blockingReasons.push("OAUTH_REQUIRES_PROFESSIONAL_SERVICES");
        reasons.push("Turnkey Verified OAuth requires at least one professional-services item.");
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
      redliningMinimumArr: pricingPolicy.redliningMinimumArr ?? rules.redliningMinimumArr,
      salesDirectorDiscountMax: pricingPolicy.salesDirectorDiscountMax ?? 0.1,
      headSalesDiscountMax: pricingPolicy.headSalesDiscountMax ?? 0.3,
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
    var calculateQuote2 = (rawInput, pricingPolicy = {}, settingsVersion = 0) => {
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
      const supportAnnual = round(proposedSupportBeforeDiscount * (1 - input.supportDiscount), 2);
      const selectedAddOns = activeRules.addOnRules.filter(({ key }) => input.addOns.includes(key)).map(({ key, label, annualAmount }) => {
        const exactListMonthlyAmount = activeRules.calculationMethod === "excel_compatible" ? annualAmount / 12 * (1 - termRule.discount + input.payment.premium) : round(annualAmount / 12 * (1 - termRule.discount) * (1 + input.payment.premium), 2);
        const listMonthlyAmount = round(exactListMonthlyAmount, 2);
        const discretionaryDiscount = input.addOnDiscounts[key];
        const exactProposedMonthlyAmount = activeRules.calculationMethod === "excel_compatible" ? exactListMonthlyAmount * (1 - discretionaryDiscount) : round(listMonthlyAmount * (1 - discretionaryDiscount), 2);
        const proposedMonthlyAmount = round(exactProposedMonthlyAmount, 2);
        return {
          key,
          label,
          rateCardAnnualAmount: annualAmount,
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
      const listProfessionalServicesAmount = activeRules.professionalServicesRules.find(
        ({ itemCount }) => itemCount === input.psItemCount
      ).oneTimeAmount;
      const professionalServicesAmount = round(
        listProfessionalServicesAmount * (1 - input.professionalServicesDiscount),
        2
      );
      const listOnboardingAmount = input.onboarding.oneTimeAmount;
      const onboardingAmount = round(
        listOnboardingAmount * (1 - input.onboardingDiscount),
        2
      );
      const oneTime = onboardingAmount + professionalServicesAmount;
      const listOneTime = listOnboardingAmount + listProfessionalServicesAmount;
      const committedArr = round(proposedPlatformArr + supportAnnual + annualAddOns, 2);
      const listCommittedArr = round(listPlatformArr + listSupportAnnual + listAnnualAddOns, 2);
      const tcv = round(committedArr * (input.termMonths / 12) + oneTime, 2);
      const listTcv = round(listCommittedArr * (input.termMonths / 12) + listOneTime, 2);
      const recurringPerPeriod = round(committedArr / input.payment.paymentsPerYear, 2);
      const hasOauthDependencyFailure = input.addOns.includes("verified_oauth") && input.psItemCount === 0;
      const effectiveDiscounts = [
        ...Object.entries(input.productDiscounts).filter(([key]) => input.volumes[key] > 0).map(([, discount]) => discount),
        ...Object.entries(input.addOnDiscounts).filter(([key]) => input.addOns.includes(key)).map(([, discount]) => discount),
        ...listSupportAnnual > 0 ? [input.supportDiscount] : [],
        ...listOnboardingAmount > 0 ? [input.onboardingDiscount] : [],
        ...listProfessionalServicesAmount > 0 ? [input.professionalServicesDiscount] : []
      ];
      const largestDiscretionaryDiscount = Math.max(0, ...effectiveDiscounts);
      const approval = buildApproval(
        input,
        largestDiscretionaryDiscount,
        committedArr,
        hasOauthDependencyFailure,
        activeRules
      );
      const legacyGuardrails = [];
      if (largestDiscretionaryDiscount > activeRules.headSalesDiscountMax && input.termMonths > 12) {
        legacyGuardrails.push("FINANCE_APPROVAL_MULTI_YEAR_DISCOUNT");
      }
      if (committedArr < activeRules.minimumCommittedArr) {
        legacyGuardrails.push("FINANCE_APPROVAL_BELOW_MINIMUM");
      }
      if (hasOauthDependencyFailure) legacyGuardrails.push("BLOCKED_OAUTH_REQUIRES_PS");
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
        listOneTime,
        oneTime,
        listTcv,
        tcv,
        largestDiscretionaryDiscount,
        approvalTierRequired: approval.tier,
        approvalReasons: approval.reasons,
        blockingReasons: approval.blockingReasons,
        calculationStatus: approval.blockingReasons.length > 0 ? "blocked" : approval.tier === "none" ? "ready" : "approval_required",
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
        psItemCount: input.psItemCount,
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
      minimumCommittedArr: 25e3,
      redliningMinimumArr: 5e4,
      salesDirectorDiscountMax: 0.1,
      headSalesDiscountMax: 0.3,
      termDiscounts: { "12": 0, "24": 0.025, "36": 0.05 },
      paymentPremiums: {
        annual_in_advance: 0,
        semi_annual_in_advance: 0.04,
        quarterly_in_advance: 0.06,
        monthly_in_advance: 0.08
      },
      support: {
        basic: { percent: 0, cap: 0 },
        full: { percent: 0.1, cap: 1e4 },
        premium: { percent: 0.2, cap: 2e4 }
      },
      onboardingAmounts: {
        quick_launch: 0,
        quick_launch_plus: 5e3,
        strategic: 1e4
      },
      professionalServicesAmounts: [0, 2e3, 3800, 5500, 7200, 8800],
      addOnAnnualAmounts: {
        enterprise_accelerator: 2400,
        privacy_filter: 6e3,
        verified_oauth: 5e3
      },
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
      pricingPolicy: defaultPricingPolicy()
    });
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
        redliningMinimumArr: requireNumber(
          value.redliningMinimumArr ?? defaults.redliningMinimumArr,
          0,
          1e9,
          "redliningMinimumArr"
        ),
        salesDirectorDiscountMax: requireNumber(
          value.salesDirectorDiscountMax ?? defaults.salesDirectorDiscountMax,
          0,
          1,
          "salesDirectorDiscountMax"
        ),
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
      return {
        schemaVersion: "1.0",
        version: currentVersion,
        allowNewBusiness: value.allowNewBusiness,
        allowRenewals: value.allowRenewals,
        newBusinessPipelineIds: normalizePipelineIds(
          value.newBusinessPipelineIds || [],
          "newBusinessPipelineIds"
        ),
        renewalPipelineIds: normalizePipelineIds(
          value.renewalPipelineIds || [],
          "renewalPipelineIds"
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
    var dealCategory = (settings, dealType, pipelineId) => {
      if (settings.renewalPipelineIds.includes(pipelineId)) return "renewal";
      if (settings.newBusinessPipelineIds.includes(pipelineId)) return "new_business";
      const normalized = String(dealType || "").toLowerCase().replace(/[^a-z]/g, "");
      if (!normalized) return "new_business";
      if (normalized === "newbusiness") return "new_business";
      if (normalized === "renewal") return "renewal";
      return "unsupported";
    };
    var isDealAllowed2 = (settings, dealType, pipelineId) => {
      const category = dealCategory(settings, dealType, pipelineId);
      return category === "new_business" && settings.allowNewBusiness || category === "renewal" && settings.allowRenewals;
    };
    module2.exports = {
      accountIdFromContext: accountIdFromContext2,
      defaultPricingPolicy,
      defaultSettings,
      isDealAllowed: isDealAllowed2,
      isSettingsAdmin: isSettingsAdmin2,
      normalizeSettings,
      readDealPipelines: readDealPipelines2,
      readSettings: readSettings2,
      saveSettings: saveSettings2,
      userIdFromContext: userIdFromContext2
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
      enterprise: { id: "46037350773", name: "Enterprise Drawdown Fee", category: "Platform" },
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
      const price = Number(item.properties.price);
      if (!Number.isFinite(price)) return null;
      const net = price - Number(item.properties.discount || 0);
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
      name: product.name,
      hs_product_id: product.id,
      product_category: product.category,
      nylas_pricing_managed: "true",
      nylas_line_item_key: key,
      nylas_pricing_component: component,
      nylas_quote_option_id: option.id,
      nylas_pricing_state_hash: option.result.stateHash,
      nylas_line_item_source: source
    });
    var priceProperties = (price, listPrice) => {
      if (price == null) return {};
      const net = round(price, 2);
      if (listPrice == null) return { price: String(net) };
      const list = round(listPrice, 2);
      if (list - net < 0.01) return { price: String(net) };
      return { price: String(list), discount: String(round(list - net, 2)) };
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
    var buildMeteredLines = (option, source) => {
      const items = option.result.lines.slice().sort(
        (left, right) => productOrderIndex(left.productKey) - productOrderIndex(right.productKey)
      ).map((line) => {
        const product = CATALOG[line.productKey];
        if (!product) throw new Error("PRODUCT_MAPPING_REQUIRED");
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
              // Price is left to HubSpot unless the rep actually changed it.
              //
              // Sending a price overrides the product's own list price, and the code was sending
              // the monthly rate multiplied up to the billing period -- so a $1.30/month product
              // showed $15.60 on a line whose description read "$1.30 per CA per month". Omitting
              // it lets HubSpot hydrate the product's default, which is the number the product
              // library already holds and the one the customer should see.
              //
              // When a discount WAS entered the rate genuinely differs from the default, so both
              // the list rate and the discount are sent -- as monthly rates, the same basis the
              // product is priced on. Quantity is 0, so this moves no money; it makes the agreed
              // rate and the concession visible on the rate schedule.
              ...line.discretionaryDiscount > 0 ? {
                price: line.billingUnitRate,
                listPrice: line.billingUnitRate / (1 - line.discretionaryDiscount)
              } : {},
              source
            }),
            monthly_unit_price: String(line.billingUnitRate),
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
            listPrice: option.result.listOnboardingAmount,
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
        option.result.listProfessionalServicesAmount,
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
      FEE_TOTAL_PROPERTIES,
      _test: { feeTotals, withFeeTotals },
      buildDealLineItems: buildDealLineItems2,
      buildQuoteLineItems: buildQuoteLineItems2,
      contentHash: contentHash2,
      normalizeQuoteContent: normalizeQuoteContent2
    };
  }
});

// QuoteOptionsFunction.js
var crypto = require("node:crypto");
var hubspot = require("@hubspot/api-client");
var { QuoteValidationError, calculateQuote, normalizeStoredInput } = require_calculator();
var {
  accountIdFromContext,
  isDealAllowed,
  isSettingsAdmin,
  readDealPipelines,
  readSettings,
  saveSettings,
  userIdFromContext
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
var UNVERIFIED_DEAL_PROPERTIES = [
  DEAL_CONTRACT_TERM_PROPERTY,
  "pricing_contract_type",
  "pricing_multi_year_discount_pct",
  "pricing_multi_product_discount_pct",
  "pricing_discount_reason",
  "pricing_approval_timestamp"
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
var MAX_OPTIONS = 10;
var MAX_PAYLOAD_LENGTH = 6e4;
var SAFE_ERRORS = Object.freeze({
  CONFIGURATION_REQUIRED: "The Nylas Pricing properties have not been provisioned yet.",
  CONFLICT: "Another user changed these quote options. Reload the card and try again.",
  INVALID_DEAL: "Nylas Pricing is available only on New Business Deals.",
  INVALID_OPTION: "The quote option contains invalid or incomplete information.",
  INVALID_QUOTE_CONTENT: "The quote display choices are invalid or incomplete.",
  LINE_ITEM_SYNC_FAILED: "HubSpot could not replace the Deal line items. Review the Deal before trying again.",
  OPTION_BLOCKED: "This option has blocking policy issues and cannot be selected.",
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
var readDealState = async (client, dealId) => {
  try {
    if (!client?.crm?.deals?.basicApi) throw new Error("CONFIGURATION_REQUIRED");
    const deal = await client.crm.deals.basicApi.getById(dealId, [
      "dealtype",
      "pipeline",
      OPTION_PROPERTY,
      SELECTED_OPTION_ID_PROPERTY,
      SELECTED_OPTION_NAME_PROPERTY,
      "pricing_approval_status",
      "pricing_input_state_hash",
      "pricing_latest_quote_id",
      "pricing_latest_quote_url",
      "pricing_quote_content_hash",
      "pricing_line_item_sync_status",
      "dealname"
    ]);
    if (!deal?.properties) throw new Error("CONFIGURATION_REQUIRED");
    return {
      dealType: deal.properties.dealtype || "",
      pipelineId: deal.properties.pipeline || "",
      document: parseDocument(deal.properties[OPTION_PROPERTY]),
      selectedOptionId: deal.properties[SELECTED_OPTION_ID_PROPERTY] || null,
      selectedOptionName: deal.properties[SELECTED_OPTION_NAME_PROPERTY] || null,
      approvalStatus: deal.properties.pricing_approval_status || "draft",
      selectedStateHash: deal.properties.pricing_input_state_hash || null,
      latestQuoteId: deal.properties.pricing_latest_quote_id || null,
      latestQuoteUrl: deal.properties.pricing_latest_quote_url || null,
      quoteContentHash: deal.properties.pricing_quote_content_hash || null,
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
  console.log("Nylas pricing calculate: validation started.");
  assertRevision(state.document, parameters.expectedRevision);
  const incoming = parameters.option;
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    throw new Error("INVALID_OPTION");
  }
  const result = calculateQuote(incoming.input, settings.pricingPolicy, settings.version);
  console.log("Nylas pricing calculate: calculation completed.");
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
  console.log("Nylas pricing calculate: save started.");
  await writeDocument(client, dealId, document);
  console.log("Nylas pricing calculate: save completed.");
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
    await inBatches(existingLineItemIds, (id) => client.crm.lineItems.basicApi.archive(id));
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
var productVolumeProperties = Object.freeze({
  connect_ca: "pricing_connect_committed_monthly_volume",
  calendar_ca: "pricing_calendar_committed_monthly_volume",
  notetaker_bot_hours: "pricing_notetaker_committed_monthly_hours",
  agent_accounts: "pricing_agent_accounts_committed_monthly_volume",
  agent_email_thousands: "pricing_agent_email_committed_monthly_thousands",
  agent_storage_gb: "pricing_agent_storage_committed_monthly_gb",
  agent_bandwidth_gb: "pricing_agent_bandwidth_committed_monthly_gb"
});
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
    special_terms: input.specialTerms || ""
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
  const result = calculateQuote(parameters.input, settings.pricingPolicy, settings.version);
  if (result.blockingReasons.length > 0) throw new Error("OPTION_BLOCKED");
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
  const liveState = {
    ...state,
    document,
    selectedOptionId: liveOption.id,
    selectedOptionName: liveOption.name,
    selectedStateHash: result.stateHash
  };
  const synced = await syncDealLineItems(client, dealId, liveState, settings);
  const quote = await generateQuote(
    client,
    dealId,
    liveState,
    { quoteContent: parameters.quoteContent || {} },
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
  "name",
  "hs_product_id",
  "quantity",
  "price",
  "monthly_unit_price",
  "discount",
  "description",
  // 'product_category' deliberately omitted: it is not a HubSpot-defined Line Item property, so
  // in a portal that never had it created every create fails with a 400 and the sync collapses.
  "units",
  // Custom, not HubSpot-defined: it carries the monthly committed volume for each metered product,
  // which used to be stated in prose in the description. A portal that never created it rejects
  // the whole create, so createLineItem retries without it rather than failing the sync.
  "committed_quantity",
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
  "one_time_fees",
  "recurring_fees",
  "total_fees_for_term"
];
var isUnknownPropertyRejection = (error, property) => {
  const message = String(
    error?.body?.message || error?.response?.body?.message || error?.message || ""
  );
  return message.includes(property) && /propert/i.test(message);
};
var createLineItem = async (client, properties, associations) => {
  try {
    return await client.crm.lineItems.basicApi.create({ properties, associations });
  } catch (error) {
    const rejected = OPTIONAL_CUSTOM_LINE_ITEM_PROPERTIES.find(
      (property) => properties[property] != null && isUnknownPropertyRejection(error, property)
    );
    if (rejected) {
      const { [rejected]: unused, ...withoutRejected } = properties;
      console.warn(
        `Nylas pricing: this portal has no ${rejected} Line Item property. Creating the line item without it.`
      );
      return createLineItem(client, withoutRejected, associations);
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
var syncDealLineItems = async (client, dealId, state, settings) => {
  const option = selectedOptionForDraft(state);
  assertCurrentSettings(option, settings);
  const desired = buildDealLineItems(option);
  const createdIds = [];
  try {
    const existingIds = await associatedIds(client, "deals", dealId, "line_items", 1e3);
    await inBatches(existingIds, (id) => client.crm.lineItems.basicApi.archive(id));
    await inBatches(desired, async (item) => {
      const created = await createLineItem(
        client,
        hubSpotLineItemProperties(item.properties),
        [createAssociation(dealId, 20)]
      );
      createdIds.push(String(created.id));
    });
    const syncedAt = (/* @__PURE__ */ new Date()).toISOString();
    await client.crm.deals.basicApi.update(dealId, {
      properties: {
        pricing_line_item_sync_status: "synced",
        pricing_line_items_synced_at: syncedAt
      }
    });
    return { count: desired.length, syncedAt };
  } catch (error) {
    await inBatches(
      createdIds,
      (id) => client.crm.lineItems.basicApi.archive(id).catch(() => void 0)
    );
    await client.crm.deals.basicApi.update(dealId, { properties: { pricing_line_item_sync_status: "failed" } }).catch(() => void 0);
    const diagnostics = safeProviderDiagnostics(error, "sync_line_items");
    console.error("Nylas pricing line item sync failed.", diagnostics, error?.stack || error);
    if (error?.message === "TOO_MANY_LINE_ITEMS") throw new Error("TOO_MANY_LINE_ITEMS");
    const failure = new Error("LINE_ITEM_SYNC_FAILED");
    failure.diagnostics = diagnostics;
    throw failure;
  }
};
var REQUIRED_QUOTE_TEMPLATE_TYPE = "customizable_quote_template";
var QUOTE_TEMPLATE_OBJECT_TYPES = ["quote_template", "quote_templates"];
var readQuoteTemplatePage = async (client, after) => {
  let lastError;
  for (const objectType of QUOTE_TEMPLATE_OBJECT_TYPES) {
    try {
      return await client.crm.objects.basicApi.getPage(
        objectType,
        100,
        after,
        ["hs_name", "hs_type"],
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
var usableQuoteTemplates = async (client) => {
  const templates = [];
  let after;
  try {
    do {
      const page = await readQuoteTemplatePage(client, after);
      for (const template of page?.results || []) {
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
    console.log(
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
var generateQuote = async (client, dealId, state, parameters, portalId, settings) => {
  const option = selectedOptionForDraft(state);
  assertCurrentSettings(option, settings);
  const content = normalizeQuoteContent(
    parameters.quoteContent,
    `${state.dealName} \u2013 ${option.name}`
  );
  const templateId = content.templateId || configuredQuoteTemplateId();
  if (!/^\d+$/.test(templateId)) throw new Error("QUOTE_CONFIGURATION_REQUIRED");
  const { type: templateType, name: templateName } = await describeQuoteTemplate(
    client,
    templateId
  );
  const hash = contentHash(option, { ...content, templateId });
  const lineItems = buildQuoteLineItems(option, content);
  let quote;
  const createdLineItemIds = [];
  try {
    quote = await client.crm.quotes.basicApi.create({
      properties: {
        hs_title: content.title,
        // Both dates are the order start date -- the contract start the calculator derived from
        // the rep's Start Date, not the raw input, so the quote and the Deal's contract dates
        // cannot disagree.
        //
        // hs_expiration_date is listed as required at creation, so it cannot simply be dropped.
        // Rather than invent a rolling "30 days from whenever this ran" and print a date on a
        // customer-facing quote that nobody chose, it is pinned to the order start date too.
        //
        // Never send an empty string for a date: in HubSpot that is not "no date", it lands as
        // the epoch and prints as January 1, 1970.
        ...option.result.dates.contractStartDate ? {
          hs_expiration_date: option.result.dates.contractStartDate,
          hs_contract_effective_start_date: option.result.dates.contractStartDate
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
        hs_template_type: "CPQ_QUOTE"
      },
      associations: []
    });
    await client.crm.associations.v4.basicApi.create("quotes", String(quote.id), "deals", dealId, [
      { associationCategory: "HUBSPOT_DEFINED", associationTypeId: 64 }
    ]);
    await client.crm.associations.v4.basicApi.create(
      "quotes",
      String(quote.id),
      "quote_template",
      templateId,
      [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 286 }]
    );
    await Promise.all(
      lineItems.map(async (item) => {
        const created = await createLineItem(
          client,
          hubSpotLineItemProperties(item.properties),
          // 68, not 67. Association type ids are directional: 67 is defined FROM the quote
          // (0-14) TO the line item, but this association is declared on the line item's own
          // create call, so the "from" side is the line item (0-8). HubSpot rejected it with
          // "invalid from object type 0-8 ... expected: 0-14. For definition 0-67". 68 is the
          // line-item-to-quote direction -- the same reason the Deal sync uses 20.
          [createAssociation(quote.id, 68)]
        );
        createdLineItemIds.push(String(created.id));
      })
    );
    const [contactIds, companyIds] = await Promise.all([
      associatedIds(client, "deals", dealId, "contacts", 10),
      associatedIds(client, "deals", dealId, "companies", 1)
    ]);
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
    const finalized = await client.crm.quotes.basicApi.getById(String(quote.id), [
      "hs_quote_link",
      "hs_status"
    ]);
    const quoteUrl = finalized?.properties?.hs_quote_link || "";
    const generatedAt = (/* @__PURE__ */ new Date()).toISOString();
    await client.crm.deals.basicApi.update(dealId, {
      properties: {
        pricing_latest_quote_id: String(quote.id),
        pricing_latest_quote_url: quoteUrl,
        pricing_quote_content_hash: hash,
        pricing_quote_generation_status: "draft_created",
        pricing_quote_generated_at: generatedAt
      }
    });
    return {
      quoteId: String(quote.id),
      quoteUrl,
      generatedAt,
      templateId,
      templateName
    };
  } catch (error) {
    for (const id of createdLineItemIds) {
      await client.crm.lineItems.basicApi.archive(id).catch(() => void 0);
    }
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
    console.log(`Nylas pricing action started: ${String(action || "missing")}.`);
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
        pipelines
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
    console.log("Nylas pricing action: deal state and settings loaded.");
    if (!settingsState.configured) throw new Error("SETTINGS_CONFIGURATION_REQUIRED");
    const settings = settingsState.settings;
    if (!isDealAllowed(settings, state.dealType, state.pipelineId)) throw new Error("INVALID_DEAL");
    if (action === "list") {
      return response(200, {
        success: true,
        ...stateResponse(state),
        quoteTemplates: await usableQuoteTemplates(client),
        defaultQuoteTemplateId: configuredQuoteTemplateId(),
        // The card shows this as the Quote title placeholder, so a rep who leaves the field
        // blank can see the name the quote will actually get rather than being surprised by it.
        dealName: state.dealName
      });
    }
    if (action === "preview") {
      return response(200, {
        success: true,
        previewResult: calculateQuote(parameters.input, settings.pricingPolicy, settings.version)
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
  associatedIds,
  deleteOption,
  lockLiveCalculation,
  autoRenewalProperties,
  contractTermProperties,
  discountReasonProperties,
  paymentFrequencyProperties,
  paymentMethodProperties,
  syncDealLineItems,
  updateDealProperties
});
