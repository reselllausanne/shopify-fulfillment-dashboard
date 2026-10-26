"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import { RETURNS_LOCALES, type ReturnsCopy } from "@/app/returns/copy";
import { useReturnsEmbed } from "@/app/returns/EmbedBootstrap";
import { useReturnsLocale } from "@/app/returns/locale";
import {
  digitsFromPublicOrderInput,
  formatPublicOrderNumberFromDigits,
  parseStrictPublicOrderNumber,
} from "@/shopify/returns/publicOrderNumber";
import type { ProductSizeFit } from "@/shopify/returns/productSizeFit";
import { customerSizeFitLine } from "@/shopify/returns/productSizeFit";
import { unitPriceDelta } from "@/shopify/returns/refundPreference";

function formatDeltaLabel(delta: number | null, copy: ReturnsCopy): string {
  if (delta == null || Math.abs(delta) < 0.005) return copy.priceDiffSame;
  if (delta > 0) return copy.priceDiffPlus.replace("{amount}", delta.toFixed(2));
  return copy.priceDiffMinus.replace("{amount}", Math.abs(delta).toFixed(2));
}

/** "Taille: 37.5" / "Size: 42" → "37.5" for recap template. */
function sizeTokenFromReplacementLabel(label: string | null | undefined): string {
  const raw = String(label ?? "").trim();
  if (!raw) return "—";
  const stripped = raw
    .replace(/^(taille|size|groesse|größe)\s*:\s*/i, "")
    .trim();
  return stripped || raw;
}

type FlowPath = "return" | "exchange";

type ReplacementOption = {
  variantId: string;
  sku: string | null;
  title: string | null;
  optionLabel: string | null;
  unitPrice: number | null;
  currencyCode: string | null;
  availableQuantity: number | null;
};

function messageForPublicError(
  code: string,
  apiMessage: unknown,
  copy: ReturnsCopy
): string {
  if (code === "RETURN_WINDOW_EXPIRED") return copy.returnWindowExpired;
  if (
    code === "ORDER_NOT_FOUND" ||
    code === "EMAIL_MISMATCH" ||
    code === "INVALID_ORDER_NUMBER"
  ) {
    return copy.lookupFailed;
  }
  if (code === "NO_RETURNABLE_ITEMS") return copy.noEligibleProducts;
  if (code === "RETURN_POLICY_EXCLUDED") return copy.returnPolicyExcluded;
  if (code === "RATE_LIMITED") {
    return "Shopify est occupe — attendez quelques secondes et reessayez.";
  }
  const raw = String(apiMessage ?? "").trim();
  return raw || copy.lookupFailed;
}

type ReturnReason =
  | "SIZE_TOO_SMALL"
  | "SIZE_TOO_LARGE"
  | "UNWANTED"
  | "NOT_AS_DESCRIBED"
  | "WRONG_ITEM"
  | "DEFECTIVE"
  | "STYLE"
  | "COLOR"
  | "OTHER";

type SubmitState =
  | { type: "idle" }
  | { type: "loading" }
  | {
      type: "success";
      message: string;
      labelUrl?: string | null;
      trackingNumber?: string | null;
      intent?: FlowPath;
      exchangeInvoiceUrl?: string | null;
      priceDifferenceDue?: number | null;
      priceCreditDue?: number | null;
      labelPendingPayment?: boolean;
    }
  | { type: "error"; message: string; code?: string };

type ReturnableItem = {
  fulfillmentLineItemId: string;
  lineItemId: string | null;
  sku: string | null;
  title: string | null;
  variantLabel: string | null;
  imageUrl: string | null;
  quantity: number;
  unitAmount: number | null;
  currencyCode: string | null;
};

function ReturnLineProductHead({
  title,
  sizeLabel,
  orderedSizeLabel,
  imageUrl,
}: {
  title: string;
  sizeLabel: string | null;
  orderedSizeLabel: string;
  imageUrl: string | null;
}) {
  return (
    <span className="flex min-w-0 flex-1 items-start justify-between gap-3">
      <span className="min-w-0">
        <span className="block font-medium leading-snug">{title}</span>
        {sizeLabel ? (
          <span className="mt-1 block text-sm text-neutral-500">
            {orderedSizeLabel} {sizeLabel}
          </span>
        ) : null}
      </span>
      {imageUrl ? (
        <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-neutral-200 bg-white p-1">
          {/* eslint-disable-next-line @next/next/no-img-element -- Shopify CDN thumbnail from Admin API */}
          <img
            src={imageUrl}
            alt=""
            width={56}
            height={56}
            className="max-h-full max-w-full object-contain object-center"
          />
        </span>
      ) : null}
    </span>
  );
}

type ExcludedReturnItem = ReturnableItem & {
  excludeReason: "PRICE_OVER_LIMIT" | "SALE_OR_PROMO";
};

type FlowStep = 1 | 2 | 3 | 4;

const fieldClass =
  "min-h-14 w-full rounded-sm border border-neutral-300 bg-white px-4 text-base text-neutral-900 outline-none focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/15";
const btnPrimary =
  "min-h-14 w-full rounded-sm bg-neutral-900 px-5 text-base font-semibold text-white disabled:opacity-50";
const btnSecondary =
  "min-h-14 w-full rounded-sm border border-neutral-300 bg-white px-5 text-base font-medium text-neutral-900";

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export default function PublicReturnsPage() {
  return (
    <Suspense
      fallback={
        <main className="returns-shell min-h-screen bg-neutral-50 text-neutral-900">
          <div className="returns-shell-inner mx-auto w-full max-w-3xl px-5 py-8 md:px-8 md:py-12">
            <div className="returns-wizard rounded-sm border border-neutral-200 bg-white p-6 shadow-sm md:p-8" />
          </div>
        </main>
      }
    >
      <PublicReturnsWizard />
    </Suspense>
  );
}

function PublicReturnsWizard() {
  const embed = useReturnsEmbed();
  const { locale, setLocale, copy } = useReturnsLocale();
  const [step, setStep] = useState<FlowStep>(1);
  const [orderDigits, setOrderDigits] = useState("");
  const [orderEmail, setOrderEmail] = useState("");
  const [orderNumberError, setOrderNumberError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [flowPath, setFlowPath] = useState<FlowPath>("return");
  const [reason, setReason] = useState<ReturnReason>("SIZE_TOO_SMALL");
  const isExchangeFlow = flowPath === "exchange";
  const [details, setDetails] = useState("");
  const [loadingItems, setLoadingItems] = useState(false);
  const [returnableItems, setReturnableItems] = useState<ReturnableItem[]>([]);
  const [excludedItems, setExcludedItems] = useState<ExcludedReturnItem[]>([]);
  const [selectedItems, setSelectedItems] = useState<
    Record<
      string,
      { checked: boolean; quantity: number; replacementVariantId?: string | null }
    >
  >({});
  const [replacementOptions, setReplacementOptions] = useState<
    Record<string, ReplacementOption[]>
  >({});
  const [replacementLoading, setReplacementLoading] = useState<Record<string, boolean>>({});
  const [sizeFitByLine, setSizeFitByLine] = useState<Record<string, ProductSizeFit | null>>({});
  const [submitState, setSubmitState] = useState<SubmitState>({ type: "idle" });
  const [exchangeQuote, setExchangeQuote] = useState<{
    due: number;
    credit: number;
  } | null>(null);
  const [exchangeQuoteLoading, setExchangeQuoteLoading] = useState(false);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);

  function excludeReasonMessage(reason: ExcludedReturnItem["excludeReason"]): string {
    if (reason === "PRICE_OVER_LIMIT") return copy.excludedPriceOverLimit;
    return copy.excludedSaleOrPromo;
  }

  const orderNumber = formatPublicOrderNumberFromDigits(orderDigits);

  function validateStep1(): boolean {
    let ok = true;
    if (!parseStrictPublicOrderNumber(orderNumber)) {
      setOrderNumberError(copy.orderNumberInvalid);
      ok = false;
    } else {
      setOrderNumberError(null);
    }
    if (!isValidEmail(orderEmail)) {
      setEmailError(copy.emailInvalid);
      ok = false;
    } else {
      setEmailError(null);
    }
    return ok;
  }

  function inStockOptions(options: ReplacementOption[] | undefined): ReplacementOption[] {
    if (!options?.length) return [];
    const stocked = options.filter(
      (opt) => opt.availableQuantity == null || opt.availableQuantity > 0
    );
    return stocked.length ? stocked : [];
  }

  async function loadReplacementOptions(fulfillmentLineItemId: string) {
    setReplacementLoading((prev) => ({ ...prev, [fulfillmentLineItemId]: true }));
    try {
      const response = await fetch("/api/shopify/returns/replacement-options", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orderNumber,
          email: orderEmail.trim().toLowerCase(),
          fulfillmentLineItemId,
        }),
      });
      const contentType = response.headers.get("content-type") ?? "";
      const data = contentType.includes("json")
        ? await response.json().catch(() => ({}))
        : {};
      if (!response.ok || !data?.success) {
        setReplacementOptions((prev) => ({ ...prev, [fulfillmentLineItemId]: [] }));
        const code = String(data?.error ?? (response.ok ? "" : "HTTP_ERROR"));
        const fallback =
          response.status === 404
            ? "Service echange indisponible (API). Rechargez la page."
            : copy.lookupFailed;
        setSubmitState({
          type: "error",
          message:
            code && code !== "HTTP_ERROR"
              ? messageForPublicError(code, data?.message, copy)
              : fallback,
          code,
        });
        return;
      }
      const options = Array.isArray(data?.options)
        ? (data.options as ReplacementOption[])
        : [];
      setReplacementOptions((prev) => ({ ...prev, [fulfillmentLineItemId]: options }));
      if (data?.productSizeFit) {
        setSizeFitByLine((prev) => ({
          ...prev,
          [fulfillmentLineItemId]: data.productSizeFit as ProductSizeFit,
        }));
      }
    } catch (error: any) {
      setReplacementOptions((prev) => ({ ...prev, [fulfillmentLineItemId]: [] }));
      setSubmitState({
        type: "error",
        message: String(error?.message ?? copy.lookupFailed),
      });
    } finally {
      setReplacementLoading((prev) => ({ ...prev, [fulfillmentLineItemId]: false }));
    }
  }

  // Auto-load sizes whenever exchange is selected + line checked (covers
  // auto-checked single item and path toggle race where load never fired).
  useEffect(() => {
    if (!isExchangeFlow || step !== 2) return;
    for (const item of returnableItems) {
      const id = item.fulfillmentLineItemId;
      const st = selectedItems[id];
      if (!st?.checked) continue;
      if (replacementLoading[id]) continue;
      if (Object.prototype.hasOwnProperty.call(replacementOptions, id)) continue;
      void loadReplacementOptions(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: load when path/selection needs options
  }, [isExchangeFlow, step, returnableItems, selectedItems, replacementOptions, replacementLoading]);

  async function loadReturnableItems() {
    if (!validateStep1()) return;
    setLoadingItems(true);
    setSubmitState({ type: "idle" });
    setExchangeQuote(null);
    try {
      const response = await fetch("/api/shopify/returns/returnable", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orderNumber,
          email: orderEmail.trim().toLowerCase(),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.success) {
        setReturnableItems([]);
        setExcludedItems([]);
        setSelectedItems({});
        const code = String(data?.error ?? "");
        setSubmitState({
          type: "error",
          message: messageForPublicError(code, data?.message, copy),
          code,
        });
        return;
      }
      const items = Array.isArray(data?.items) ? (data.items as ReturnableItem[]) : [];
      const excluded = Array.isArray(data?.excludedItems)
        ? (data.excludedItems as ExcludedReturnItem[])
        : [];
      setReturnableItems(items);
      setExcludedItems(excluded);
      const defaults: Record<
        string,
        { checked: boolean; quantity: number; replacementVariantId?: string | null }
      > = {};
      for (const item of items) {
        defaults[item.fulfillmentLineItemId] = {
          checked: items.length === 1,
          quantity: 1,
          replacementVariantId: null,
        };
      }
      setSelectedItems(defaults);
      setReplacementOptions({});
      setReplacementLoading({});
      setSizeFitByLine({});
      if (!items.length) {
        setSubmitState({
          type: "error",
          code: excluded.length ? "RETURN_POLICY_EXCLUDED" : "NO_RETURNABLE_ITEMS",
          message: excluded.length ? copy.returnPolicyExcluded : copy.noEligibleProducts,
        });
        return;
      }
      setStep(2);
    } catch (error: any) {
      setReturnableItems([]);
      setExcludedItems([]);
      setSelectedItems({});
      setSubmitState({
        type: "error",
        message: String(error?.message ?? copy.lookupFailed),
      });
    } finally {
      setLoadingItems(false);
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!validateStep1()) return;
    if (!consentAccepted) {
      setConsentError(copy.consentRequiredError);
      return;
    }
    setConsentError(null);
    setSubmitState({ type: "loading" });
    try {
      const chosenItems = Object.entries(selectedItems)
        .filter(([, value]) => value.checked && value.quantity > 0)
        .map(([fulfillmentLineItemId, value]) => ({
          fulfillmentLineItemId,
          quantity: value.quantity,
          ...(isExchangeFlow && value.replacementVariantId
            ? { replacementVariantId: value.replacementVariantId }
            : {}),
        }));
      if (!chosenItems.length) {
        setSubmitState({
          type: "error",
          code: "VALIDATION_ERROR",
          message: copy.selectOneProduct,
        });
        return;
      }
      const response = await fetch("/api/shopify/returns/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orderNumber,
          email: orderEmail.trim().toLowerCase(),
          reason,
          details: details.trim(),
          intent: isExchangeFlow ? "exchange" : "return",
          items: chosenItems,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.success) {
        const code = String(data?.error ?? "");
        setSubmitState({
          type: "error",
          message: messageForPublicError(code, data?.message, copy),
          code,
        });
        return;
      }
      const successIntent: FlowPath =
        String(data?.intent ?? (isExchangeFlow ? "exchange" : "return")).toLowerCase() ===
        "exchange"
          ? "exchange"
          : "return";
      setSubmitState({
        type: "success",
        message: String(data?.name ?? data?.returnId ?? "ok"),
        labelUrl: String(data?.returnLabelUrl ?? "").trim() || null,
        trackingNumber: String(data?.returnTrackingNumber ?? "").trim() || null,
        intent: successIntent,
        exchangeInvoiceUrl: String(data?.exchangeInvoiceUrl ?? "").trim() || null,
        priceDifferenceDue:
          typeof data?.priceDifferenceDue === "number" ? data.priceDifferenceDue : null,
        priceCreditDue: typeof data?.priceCreditDue === "number" ? data.priceCreditDue : null,
        labelPendingPayment: Boolean(data?.labelPendingPayment),
      });
      setOrderDigits("");
      setOrderEmail("");
      setFlowPath("return");
      setReason("SIZE_TOO_SMALL");
      setReplacementOptions({});
      setReplacementLoading({});
      setSizeFitByLine({});
      setDetails("");
      setReturnableItems([]);
      setExcludedItems([]);
      setSelectedItems({});
      setOrderNumberError(null);
      setEmailError(null);
      setConsentAccepted(false);
      setConsentError(null);
      setStep(4);
      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch (error: any) {
      setSubmitState({
        type: "error",
        message: String(error?.message ?? copy.lookupFailed),
      });
    }
  }

  const selectedCount = Object.values(selectedItems).filter((value) => value.checked).length;

  function replacementLabelForLine(fulfillmentLineItemId: string, variantId: string | null | undefined) {
    if (!variantId) return null;
    const opt = (replacementOptions[fulfillmentLineItemId] ?? []).find(
      (o) => o.variantId === variantId
    );
    return opt?.optionLabel || opt?.title || opt?.sku || variantId;
  }

  const selectedLineSummaries = returnableItems
    .map((item) => {
      const state = selectedItems[item.fulfillmentLineItemId];
      if (!state?.checked || state.quantity <= 0) return null;
      let lineDelta: number | null = null;
      if (isExchangeFlow && state.replacementVariantId) {
        const opt = (replacementOptions[item.fulfillmentLineItemId] ?? []).find(
          (o) => o.variantId === state.replacementVariantId
        );
        const unit = unitPriceDelta(item.unitAmount, opt?.unitPrice ?? null);
        lineDelta =
          unit != null ? Number((unit * state.quantity).toFixed(2)) : null;
      }
      return {
        id: item.fulfillmentLineItemId,
        title: item.title ?? item.sku ?? "—",
        quantity: state.quantity,
        replacement: isExchangeFlow
          ? replacementLabelForLine(item.fulfillmentLineItemId, state.replacementVariantId)
          : null,
        lineDelta,
        returnAmount:
          item.unitAmount != null
            ? Number((item.unitAmount * state.quantity).toFixed(2))
            : null,
      };
    })
    .filter(Boolean) as Array<{
    id: string;
    title: string;
    quantity: number;
    replacement: string | null;
    lineDelta: number | null;
    returnAmount: number | null;
  }>;

  function setFlowPathAndLoad(next: FlowPath) {
    setFlowPath(next);
    setSubmitState({ type: "idle" });
    setExchangeQuote(null);
    if (next === "exchange") {
      // Drop cached empty/error results so useEffect reloads sizes.
      setReplacementOptions({});
      for (const item of returnableItems) {
        const st = selectedItems[item.fulfillmentLineItemId];
        if (st?.checked || returnableItems.length === 1) {
          void loadReplacementOptions(item.fulfillmentLineItemId);
        }
      }
      return;
    }
    setSelectedItems((prev) => {
      const out = { ...prev };
      for (const key of Object.keys(out)) {
        out[key] = { ...out[key], replacementVariantId: null };
      }
      return out;
    });
  }

  const returnRefundEstimate = (() => {
    if (isExchangeFlow) return null;
    let sum = 0;
    let known = false;
    for (const line of selectedLineSummaries) {
      if (line.returnAmount == null) continue;
      known = true;
      sum += line.returnAmount;
    }
    if (!known) return null;
    return Number(sum.toFixed(2));
  })();

  async function goToStep3() {
    if (selectedCount === 0) {
      setSubmitState({
        type: "error",
        code: "VALIDATION_ERROR",
        message: copy.selectOneProduct,
      });
      return;
    }
    if (isExchangeFlow) {
      for (const item of returnableItems) {
        const st = selectedItems[item.fulfillmentLineItemId];
        if (!st?.checked) continue;
        const opts = replacementOptions[item.fulfillmentLineItemId];
        const stocked = inStockOptions(opts);
        if (opts && opts.length === 0) {
          setSubmitState({
            type: "error",
            code: "VALIDATION_ERROR",
            message: copy.replacementNone,
          });
          return;
        }
        if (opts && stocked.length === 0) {
          setSubmitState({
            type: "error",
            code: "VALIDATION_ERROR",
            message: copy.replacementNoneOutOfStock,
          });
          return;
        }
      }
      const missing = Object.entries(selectedItems).some(
        ([, value]) =>
          value.checked && value.quantity > 0 && !String(value.replacementVariantId ?? "").trim()
      );
      if (missing) {
        setSubmitState({
          type: "error",
          code: "VALIDATION_ERROR",
          message: copy.replacementPickRequired,
        });
        return;
      }
      setExchangeQuoteLoading(true);
      setExchangeQuote(null);
      try {
        const items = Object.entries(selectedItems)
          .filter(([, value]) => value.checked && value.quantity > 0)
          .map(([fulfillmentLineItemId, value]) => ({
            fulfillmentLineItemId,
            quantity: value.quantity,
            replacementVariantId: value.replacementVariantId,
          }));
        const response = await fetch("/api/shopify/returns/exchange-preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            orderNumber,
            email: orderEmail.trim().toLowerCase(),
            items,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.success) {
          const code = String(data?.error ?? "");
          setSubmitState({
            type: "error",
            code,
            message: messageForPublicError(code, data?.message, copy),
          });
          return;
        }
        setExchangeQuote({
          due: Number(data?.priceDifferenceDue ?? 0),
          credit: Number(data?.priceCreditDue ?? 0),
        });
      } catch (error: any) {
        setSubmitState({
          type: "error",
          message: String(error?.message ?? copy.lookupFailed),
        });
        return;
      } finally {
        setExchangeQuoteLoading(false);
      }
    }
    setSubmitState({ type: "idle" });
    setConsentAccepted(false);
    setConsentError(null);
    setStep(3);
  }

  function resetFlow() {
    setStep(1);
    setOrderDigits("");
    setOrderEmail("");
    setFlowPath("return");
    setReason("SIZE_TOO_SMALL");
    setDetails("");
    setReplacementOptions({});
    setReplacementLoading({});
    setSizeFitByLine({});
    setExchangeQuote(null);
    setExchangeQuoteLoading(false);
    setReturnableItems([]);
    setExcludedItems([]);
    setSelectedItems({});
    setOrderNumberError(null);
    setEmailError(null);
    setConsentAccepted(false);
    setConsentError(null);
    setSubmitState({ type: "idle" });
  }

  return (
    <main
      className={
        embed
          ? "returns-shell bg-white text-neutral-900"
          : "returns-shell min-h-screen bg-neutral-50 text-neutral-900"
      }
    >
      <div
        className={
          embed
            ? "returns-shell-inner w-full"
            : "returns-shell-inner mx-auto w-full max-w-3xl px-5 py-8 md:px-8 md:py-12"
        }
      >
        {!embed ? (
          <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
            <a
              href="https://www.resell-lausanne.ch"
              target="_blank"
              rel="noreferrer"
              className="text-xl font-semibold tracking-tight text-neutral-900 md:text-2xl"
            >
              {copy.brand}
            </a>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-neutral-500">{copy.langLabel}</span>
              {RETURNS_LOCALES.map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => setLocale(code)}
                  className={`min-h-10 rounded-sm px-3 uppercase ${
                    locale === code
                      ? "bg-neutral-900 text-white"
                      : "border border-neutral-300 bg-white text-neutral-700"
                  }`}
                >
                  {code}
                </button>
              ))}
            </div>
          </header>
        ) : null}

        <section
          className={
            embed
              ? "returns-wizard bg-white"
              : "returns-wizard rounded-sm border border-neutral-200 bg-white p-6 shadow-sm md:p-8"
          }
        >
          {step !== 4 ? (
            <div className="flex flex-wrap gap-2 text-sm">
              {[
                { key: 1, label: copy.steps.order },
                { key: 2, label: copy.steps.products },
                { key: 3, label: copy.steps.confirm },
              ].map((item) => (
                <span
                  key={item.key}
                  className={`rounded-sm px-3 py-1.5 ${
                    step >= item.key
                      ? "bg-neutral-900 text-white"
                      : "bg-neutral-100 text-neutral-500"
                  }`}
                >
                  {item.label}
                </span>
              ))}
            </div>
          ) : null}

          {step === 1 && (
            <div className="mt-6 space-y-5">
              <label className="block">
                <span className="mb-2 block text-base font-medium">{copy.orderNumberLabel}</span>
                <div
                  className={`flex overflow-hidden rounded-sm border ${
                    orderNumberError ? "border-red-500" : "border-neutral-300"
                  }`}
                >
                  <span className="flex min-h-14 items-center bg-neutral-100 px-4 text-lg font-semibold">
                    #
                  </span>
                  <input
                    value={orderDigits}
                    onChange={(e) => {
                      setOrderDigits(digitsFromPublicOrderInput(e.target.value));
                      setOrderNumberError(null);
                    }}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="off"
                    placeholder={copy.orderNumberPlaceholder}
                    className="min-h-14 w-full px-4 text-lg outline-none"
                  />
                </div>
                <p className="mt-2 text-sm text-neutral-500">{copy.orderNumberHint}</p>
                {orderNumberError ? (
                  <p className="mt-2 text-sm font-medium text-red-600">{orderNumberError}</p>
                ) : null}
              </label>

              <details className="rounded-sm border border-neutral-200 bg-neutral-50 px-4 py-3">
                <summary className="cursor-pointer text-base font-medium">
                  {copy.orderHelpTitle}
                </summary>
                <div className="mt-3 text-base text-neutral-600">
                  <p className="mb-2">{copy.orderHelpIntro}</p>
                  <ul className="list-disc space-y-1 pl-5">
                    {copy.orderHelpItems.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              </details>

              <label className="block">
                <span className="mb-2 block text-base font-medium">{copy.emailLabel}</span>
                <input
                  type="email"
                  value={orderEmail}
                  onChange={(e) => {
                    setOrderEmail(e.target.value);
                    setEmailError(null);
                  }}
                  placeholder={copy.emailPlaceholder}
                  autoComplete="email"
                  className={`${fieldClass} ${emailError ? "border-red-500" : ""}`}
                />
                <p className="mt-2 text-sm text-neutral-500">{copy.emailHint}</p>
                {emailError ? (
                  <p className="mt-2 text-sm font-medium text-red-600">{emailError}</p>
                ) : null}
              </label>

              <button
                type="button"
                onClick={() => void loadReturnableItems()}
                disabled={loadingItems}
                className={btnPrimary}
              >
                {loadingItems ? copy.checking : copy.continue}
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="mt-6 space-y-5">
              <div className="rounded-sm bg-neutral-50 px-4 py-3 text-base text-neutral-700">
                {orderNumber} · {orderEmail}
              </div>

              <div>
                <span className="mb-2 block text-base font-medium">{copy.pathTitle}</span>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setFlowPathAndLoad("return")}
                    className={
                      flowPath === "return"
                        ? "min-h-14 rounded-sm bg-neutral-900 px-4 text-base font-semibold text-white"
                        : "min-h-14 rounded-sm border border-neutral-300 bg-white px-4 text-base font-medium text-neutral-900"
                    }
                  >
                    {copy.pathReturnTitle}
                  </button>
                  <button
                    type="button"
                    onClick={() => setFlowPathAndLoad("exchange")}
                    className={
                      flowPath === "exchange"
                        ? "min-h-14 rounded-sm bg-neutral-900 px-4 text-base font-semibold text-white"
                        : "min-h-14 rounded-sm border border-neutral-300 bg-white px-4 text-base font-medium text-neutral-900"
                    }
                  >
                    {copy.pathExchangeTitle}
                  </button>
                </div>
              </div>

              <label className="block">
                <span className="mb-2 block text-base font-medium">{copy.reasonLabel}</span>
                <select
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value as ReturnReason);
                    setSubmitState({ type: "idle" });
                  }}
                  className={fieldClass}
                >
                  {Object.entries(copy.reasons).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>

              <div>
                <h3 className="text-lg font-semibold">{copy.productsTitle}</h3>
                <p className="mt-1 text-sm text-neutral-500">{copy.productsHint}</p>
                {returnableItems.length === 0 ? (
                  <p className="mt-4 text-base text-neutral-500">{copy.noEligibleProducts}</p>
                ) : (
                  <div className="mt-4 space-y-3">
                    {returnableItems.map((item) => {
                      const state = selectedItems[item.fulfillmentLineItemId] ?? {
                        checked: false,
                        quantity: 1,
                      };
                      return (
                        <div
                          key={item.fulfillmentLineItemId}
                          className="rounded-sm border border-neutral-200 p-4"
                        >
                          <label className="flex items-start gap-3 text-base">
                            <input
                              type="checkbox"
                              checked={state.checked}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setSelectedItems((prev) => ({
                                  ...prev,
                                  [item.fulfillmentLineItemId]: {
                                    ...state,
                                    checked,
                                    replacementVariantId: checked
                                      ? state.replacementVariantId ?? null
                                      : null,
                                  },
                                }));
                                if (checked && isExchangeFlow) {
                                  void loadReplacementOptions(item.fulfillmentLineItemId);
                                }
                              }}
                              className="mt-1 h-5 w-5"
                            />
                            <span className="flex min-w-0 flex-1">
                              <ReturnLineProductHead
                                title={item.title ?? item.sku ?? item.lineItemId ?? "—"}
                                sizeLabel={item.variantLabel ?? null}
                                orderedSizeLabel={copy.orderedSizeLabel}
                                imageUrl={item.imageUrl ?? null}
                              />
                            </span>
                          </label>
                          {item.quantity > 1 ? (
                            <div className="mt-3 flex items-center gap-3 text-sm">
                              <span>{copy.quantity}</span>
                              <input
                                type="number"
                                min={1}
                                max={item.quantity}
                                value={state.quantity}
                                onChange={(e) => {
                                  const raw = Number(e.target.value);
                                  const nextQty = Number.isFinite(raw)
                                    ? Math.max(1, Math.min(item.quantity, Math.floor(raw)))
                                    : 1;
                                  setSelectedItems((prev) => ({
                                    ...prev,
                                    [item.fulfillmentLineItemId]: {
                                      ...state,
                                      quantity: nextQty,
                                    },
                                  }));
                                }}
                                className="min-h-11 w-24 rounded-sm border border-neutral-300 px-3"
                              />
                            </div>
                          ) : null}
                          {isExchangeFlow && state.checked ? (
                            <div className="mt-4 border-t border-neutral-100 pt-4">
                              {item.quantity > 1 ? (
                                <p className="mb-3 text-sm text-neutral-600">
                                  {copy.exchangeMultiQtyHint}
                                </p>
                              ) : null}
                              {sizeFitByLine[item.fulfillmentLineItemId] ? (
                                <div className="mb-3 rounded-sm border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-950">
                                  {customerSizeFitLine(
                                    sizeFitByLine[item.fulfillmentLineItemId]!,
                                    locale
                                  )}
                                </div>
                              ) : null}
                              <span className="mb-2 block text-sm font-medium">
                                {copy.replacementLabel}
                              </span>
                              {(() => {
                                const rawOpts =
                                  replacementOptions[item.fulfillmentLineItemId];
                                const loaded = Object.prototype.hasOwnProperty.call(
                                  replacementOptions,
                                  item.fulfillmentLineItemId
                                );
                                const loading = Boolean(
                                  replacementLoading[item.fulfillmentLineItemId]
                                );
                                const stocked = inStockOptions(rawOpts);
                                if (loading || (!loaded && isExchangeFlow)) {
                                  return (
                                    <p className="text-sm text-neutral-500">
                                      {copy.replacementLoading}
                                    </p>
                                  );
                                }
                                if (loaded && (!rawOpts || rawOpts.length === 0)) {
                                  return (
                                    <p className="text-sm text-amber-800">
                                      {copy.replacementNone}
                                    </p>
                                  );
                                }
                                if (loaded && stocked.length === 0) {
                                  return (
                                    <p className="text-sm text-amber-800">
                                      {copy.replacementNoneOutOfStock}
                                    </p>
                                  );
                                }
                                return (
                                  <select
                                    value={state.replacementVariantId ?? ""}
                                    onChange={(e) => {
                                      const replacementVariantId = e.target.value || null;
                                      setSelectedItems((prev) => ({
                                        ...prev,
                                        [item.fulfillmentLineItemId]: {
                                          ...state,
                                          replacementVariantId,
                                        },
                                      }));
                                    }}
                                    className="min-h-12 w-full rounded-sm border border-neutral-300 px-3 text-sm"
                                  >
                                    <option value="">—</option>
                                    {stocked.map((opt) => {
                                      const delta = unitPriceDelta(
                                        item.unitAmount,
                                        opt.unitPrice
                                      );
                                      const label =
                                        opt.optionLabel ||
                                        opt.title ||
                                        opt.sku ||
                                        opt.variantId;
                                      return (
                                        <option key={opt.variantId} value={opt.variantId}>
                                          {label} · {formatDeltaLabel(delta, copy)}
                                        </option>
                                      );
                                    })}
                                  </select>
                                );
                              })()}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}

                {excludedItems.length > 0 ? (
                  <div className="mt-5 space-y-3">
                    <h4 className="text-base font-semibold text-neutral-900">{copy.excludedTitle}</h4>
                    {excludedItems.map((item) => (
                      <div
                        key={`excluded-${item.fulfillmentLineItemId}`}
                        className="rounded-sm border border-amber-200 bg-amber-50 p-4"
                      >
                        <ReturnLineProductHead
                          title={item.title ?? item.sku ?? item.lineItemId ?? "—"}
                          sizeLabel={item.variantLabel ?? null}
                          orderedSizeLabel={copy.orderedSizeLabel}
                          imageUrl={item.imageUrl ?? null}
                        />
                        <p className="mt-1 text-sm font-medium text-amber-900">
                          {excludeReasonMessage(item.excludeReason)}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button type="button" onClick={() => setStep(1)} className={btnSecondary}>
                  {copy.back}
                </button>
                <button
                  type="button"
                  onClick={goToStep3}
                  disabled={exchangeQuoteLoading}
                  className={btnPrimary}
                >
                  {exchangeQuoteLoading ? copy.checking : copy.continue}
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <form onSubmit={onSubmit} className="mt-6 space-y-5">
              <div className="rounded-sm bg-neutral-50 px-4 py-3 text-base text-neutral-700">
                {orderNumber} · {orderEmail}
              </div>

              <div className="rounded-sm border border-neutral-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-base font-semibold">{copy.confirmSummaryTitle}</h3>
                  <button
                    type="button"
                    onClick={() => setStep(2)}
                    className="text-sm font-medium underline"
                  >
                    {copy.confirmEditProducts}
                  </button>
                </div>
                <p className="mt-2 text-sm text-neutral-600">
                  {isExchangeFlow ? copy.confirmPathExchange : copy.confirmPathReturn}
                </p>
                <ul className="mt-3 space-y-2 text-base">
                  {selectedLineSummaries.map((line) => (
                    <li key={line.id}>
                      <div className="flex justify-between gap-3">
                        <span>{line.title}</span>
                        <span className="text-neutral-500">× {line.quantity}</span>
                      </div>
                      {line.replacement ? (
                        <p className="mt-1 text-sm text-neutral-900">
                          {copy.confirmExchangeForSize.replace(
                            "{size}",
                            sizeTokenFromReplacementLabel(line.replacement)
                          )}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-sm text-neutral-600">
                  {copy.confirmReason}:{" "}
                  <span className="font-medium text-neutral-900">
                    {copy.reasons[reason] ?? reason}
                  </span>
                </p>
                {isExchangeFlow && exchangeQuote ? (
                  <p className="mt-2 text-sm text-neutral-600">
                    {copy.confirmMoneyTitle}:{" "}
                    <span className="font-medium text-neutral-900">
                      {exchangeQuote.due > 0
                        ? copy.confirmAmountDue.replace(
                            "{amount}",
                            exchangeQuote.due.toFixed(2)
                          )
                        : exchangeQuote.credit > 0
                          ? copy.confirmAmountSave.replace(
                              "{amount}",
                              exchangeQuote.credit.toFixed(2)
                            )
                          : copy.confirmAmountEven}
                    </span>
                  </p>
                ) : null}
                {!isExchangeFlow && returnRefundEstimate != null ? (
                  <p className="mt-2 text-sm text-neutral-600">
                    {copy.confirmReturnRefundTitle}:{" "}
                    <span className="font-medium text-neutral-900">
                      CHF {returnRefundEstimate.toFixed(2)}
                    </span>
                  </p>
                ) : null}
              </div>

              <label className="block">
                <span className="mb-1.5 flex items-baseline gap-2">
                  <span className="text-sm font-medium text-neutral-700">{copy.commentLabel}</span>
                  <span className="text-xs text-neutral-400">{copy.commentHint}</span>
                </span>
                <textarea
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  placeholder={copy.commentPlaceholder}
                  rows={3}
                  className="w-full rounded-sm border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/15"
                />
              </label>

              <div className="space-y-3 rounded-sm border border-neutral-200 bg-neutral-50 p-4">
                <label className="flex items-start gap-3 text-base text-neutral-800">
                  <input
                    type="checkbox"
                    checked={consentAccepted}
                    onChange={(e) => {
                      setConsentAccepted(e.target.checked);
                      if (e.target.checked) setConsentError(null);
                    }}
                    className="mt-1 h-5 w-5 shrink-0"
                  />
                  <span>{copy.consentLabel}</span>
                </label>
                <a
                  href={copy.policyLinkHref}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block text-base font-medium text-neutral-900 underline"
                >
                  {copy.policyLinkLabel}
                </a>
                {consentError ? (
                  <p className="text-sm font-medium text-red-600">{consentError}</p>
                ) : null}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button type="button" onClick={() => setStep(2)} className={btnSecondary}>
                  {copy.back}
                </button>
                <button
                  type="submit"
                  disabled={submitState.type === "loading" || !consentAccepted}
                  className={btnPrimary}
                >
                  {submitState.type === "loading"
                    ? copy.validating
                    : isExchangeFlow
                      ? copy.validateExchange
                      : copy.validateReturn}
                </button>
              </div>
            </form>
          )}

          {step === 4 && submitState.type === "success" && (
            <div className="mt-2 space-y-5">
              <div className="border-b border-neutral-200 pb-5">
                <p className="text-sm font-medium uppercase tracking-wide text-neutral-500">
                  {copy.brand}
                </p>
                <h3 className="mt-2 text-3xl font-semibold tracking-tight text-neutral-900">
                  {submitState.labelPendingPayment
                    ? copy.exchangePayBeforeLabelTitle
                    : submitState.intent === "exchange"
                      ? copy.successTitleExchange
                      : copy.successRequestReceivedTitle}
                </h3>
                <p className="mt-3 text-base leading-relaxed text-neutral-700">
                  {submitState.labelPendingPayment
                    ? copy.exchangePayBeforeLabelBody
                    : submitState.intent === "exchange"
                      ? copy.successBodyExchange
                      : copy.successRequestReceivedBody}
                </p>
                <p className="mt-2 text-sm text-neutral-500">{copy.successEmailHint}</p>
                {submitState.message && submitState.message !== "ok" ? (
                  <p className="mt-3 text-sm text-neutral-600">
                    Ref.{" "}
                    <span className="font-medium text-neutral-900">{submitState.message}</span>
                  </p>
                ) : null}
              </div>

              {submitState.priceDifferenceDue != null && submitState.priceDifferenceDue > 0 ? (
                <div className="space-y-3">
                  <p className="text-lg font-semibold text-neutral-900">
                    {copy.exchangePriceDiffDue.replace(
                      "{amount}",
                      submitState.priceDifferenceDue.toFixed(2)
                    )}
                  </p>
                  {submitState.exchangeInvoiceUrl ? (
                    <>
                      <p className="text-sm text-neutral-600">{copy.successPayEmailHint}</p>
                      <a
                        href={submitState.exchangeInvoiceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex min-h-14 items-center justify-center rounded-sm bg-neutral-900 px-5 text-base font-semibold text-white"
                      >
                        {copy.payExchangeDiff}
                      </a>
                    </>
                  ) : null}
                </div>
              ) : null}

              {submitState.priceCreditDue != null && submitState.priceCreditDue > 0 ? (
                <p className="text-base font-medium text-neutral-900">
                  {copy.exchangeCreditDue.replace(
                    "{amount}",
                    submitState.priceCreditDue.toFixed(2)
                  )}
                </p>
              ) : null}

              <div>
                <h4 className="text-base font-semibold text-neutral-900">{copy.successNextTitle}</h4>
                <ol className="mt-3 space-y-2 text-base text-neutral-700">
                  {(submitState.labelPendingPayment
                    ? copy.exchangePayBeforeLabelNext
                    : submitState.intent === "exchange"
                      ? copy.successNextExchange
                      : copy.successNext
                  ).map((item, index) => (
                    <li key={item} className="flex gap-3">
                      <span className="font-semibold text-neutral-900">{index + 1}.</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ol>
              </div>

              {submitState.trackingNumber ? (
                <p className="text-sm text-neutral-700">
                  {copy.tracking}: <strong>{submitState.trackingNumber}</strong>
                </p>
              ) : null}

              {submitState.labelUrl && !submitState.labelPendingPayment ? (
                <a
                  href={submitState.labelUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-h-14 items-center justify-center rounded-sm bg-neutral-900 px-5 text-base font-semibold text-white"
                >
                  {copy.downloadLabel}
                </a>
              ) : null}

              <button type="button" onClick={resetFlow} className={btnSecondary}>
                {copy.anotherRequest}
              </button>
            </div>
          )}

          {submitState.type === "error" && step !== 4 && (
            <div className="mt-5 rounded-sm border border-red-200 bg-red-50 px-4 py-3 text-base text-red-800">
              {submitState.message}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
