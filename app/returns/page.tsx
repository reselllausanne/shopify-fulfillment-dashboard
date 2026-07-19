"use client";

import { FormEvent, useState } from "react";
import { RETURNS_LOCALES } from "@/app/returns/copy";
import { useReturnsLocale } from "@/app/returns/locale";
import {
  digitsFromPublicOrderInput,
  formatPublicOrderNumberFromDigits,
  parseStrictPublicOrderNumber,
} from "@/shopify/returns/publicOrderNumber";

type ReturnReason =
  | "SIZE_CHANGE"
  | "CHANGE_OF_MIND"
  | "DEFECTIVE_ITEM"
  | "WRONG_ITEM_RECEIVED"
  | "NON_CONFORMITY"
  | "OTHER";

type SubmitState =
  | { type: "idle" }
  | { type: "loading" }
  | { type: "success"; message: string; labelUrl?: string | null; trackingNumber?: string | null }
  | { type: "error"; message: string; code?: string };

type ReturnableItem = {
  fulfillmentLineItemId: string;
  lineItemId: string | null;
  sku: string | null;
  title: string | null;
  quantity: number;
  unitAmount: number | null;
  currencyCode: string | null;
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
  const { locale, setLocale, copy } = useReturnsLocale();
  const [step, setStep] = useState<FlowStep>(1);
  const [orderDigits, setOrderDigits] = useState("");
  const [orderEmail, setOrderEmail] = useState("");
  const [orderNumberError, setOrderNumberError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [reason, setReason] = useState<ReturnReason>("SIZE_CHANGE");
  const [details, setDetails] = useState("");
  const [loadingItems, setLoadingItems] = useState(false);
  const [returnableItems, setReturnableItems] = useState<ReturnableItem[]>([]);
  const [selectedItems, setSelectedItems] = useState<
    Record<string, { checked: boolean; quantity: number }>
  >({});
  const [submitState, setSubmitState] = useState<SubmitState>({ type: "idle" });
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);

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

  async function loadReturnableItems() {
    if (!validateStep1()) return;
    setLoadingItems(true);
    setSubmitState({ type: "idle" });
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
        setSelectedItems({});
        setSubmitState({
          type: "error",
          message: String(data?.message ?? copy.lookupFailed),
          code: String(data?.error ?? ""),
        });
        return;
      }
      const items = Array.isArray(data?.items) ? (data.items as ReturnableItem[]) : [];
      setReturnableItems(items);
      const defaults: Record<string, { checked: boolean; quantity: number }> = {};
      for (const item of items) {
        defaults[item.fulfillmentLineItemId] = { checked: items.length === 1, quantity: 1 };
      }
      setSelectedItems(defaults);
      setStep(2);
    } catch (error: any) {
      setReturnableItems([]);
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
    if (!details.trim()) {
      setSubmitState({ type: "error", code: "VALIDATION_ERROR", message: copy.commentRequired });
      return;
    }
    setSubmitState({ type: "loading" });
    try {
      const chosenItems = Object.entries(selectedItems)
        .filter(([, value]) => value.checked && value.quantity > 0)
        .map(([fulfillmentLineItemId, value]) => ({
          fulfillmentLineItemId,
          quantity: value.quantity,
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
          items: chosenItems,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.success) {
        setSubmitState({
          type: "error",
          message: String(data?.message ?? copy.lookupFailed),
          code: String(data?.error ?? ""),
        });
        return;
      }
      setSubmitState({
        type: "success",
        message: String(data?.name ?? data?.returnId ?? "ok"),
        labelUrl: String(data?.returnLabelUrl ?? "").trim() || null,
        trackingNumber: String(data?.returnTrackingNumber ?? "").trim() || null,
      });
      setOrderDigits("");
      setOrderEmail("");
      setReason("SIZE_CHANGE");
      setDetails("");
      setReturnableItems([]);
      setSelectedItems({});
      setOrderNumberError(null);
      setEmailError(null);
      setConsentAccepted(false);
      setConsentError(null);
      setStep(4);
    } catch (error: any) {
      setSubmitState({
        type: "error",
        message: String(error?.message ?? copy.lookupFailed),
      });
    }
  }

  const selectedCount = Object.values(selectedItems).filter((value) => value.checked).length;

  function goToStep3() {
    if (selectedCount === 0) {
      setSubmitState({
        type: "error",
        code: "VALIDATION_ERROR",
        message: copy.selectOneProduct,
      });
      return;
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
    setReason("SIZE_CHANGE");
    setDetails("");
    setReturnableItems([]);
    setSelectedItems({});
    setOrderNumberError(null);
    setEmailError(null);
    setConsentAccepted(false);
    setConsentError(null);
    setSubmitState({ type: "idle" });
  }

  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900">
      <div className="mx-auto w-full max-w-3xl px-5 py-8 md:px-8 md:py-12">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold tracking-wide text-neutral-500">{copy.brand}</p>
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
        </div>

        <header className="mb-8">
          <h1 className="text-[3rem] font-semibold leading-[1.1] tracking-normal text-neutral-900 md:text-[4.5rem]">
            {copy.pageTitle}
          </h1>
          <p className="mt-3 text-lg leading-relaxed text-neutral-600">{copy.pageSubtitle}</p>
        </header>

        <section className="rounded-sm border border-neutral-200 bg-white p-6 shadow-sm md:p-8">
          <div className="flex flex-wrap gap-2 text-sm">
            {[
              { key: 1, label: copy.steps.order },
              { key: 2, label: copy.steps.products },
              { key: 3, label: copy.steps.confirm },
            ].map((item) => (
              <span
                key={item.key}
                className={`rounded-sm px-3 py-1.5 ${
                  step >= item.key ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-500"
                }`}
              >
                {item.label}
              </span>
            ))}
          </div>

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
                              onChange={(e) =>
                                setSelectedItems((prev) => ({
                                  ...prev,
                                  [item.fulfillmentLineItemId]: {
                                    ...state,
                                    checked: e.target.checked,
                                  },
                                }))
                              }
                              className="mt-1 h-5 w-5"
                            />
                            <span className="flex-1">
                              <span className="block font-medium">
                                {item.title ?? item.sku ?? item.lineItemId ?? "—"}
                              </span>
                              <span className="mt-1 block text-sm text-neutral-500">
                                {item.sku ? `SKU ${item.sku} · ` : ""}
                                {copy.max} {item.quantity}
                              </span>
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
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <label className="block">
                <span className="mb-2 block text-base font-medium">{copy.reasonLabel}</span>
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value as ReturnReason)}
                  className={fieldClass}
                >
                  {Object.entries(copy.reasons).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-3">
                <button type="button" onClick={() => setStep(1)} className={btnSecondary}>
                  {copy.back}
                </button>
                <button type="button" onClick={goToStep3} className={btnPrimary}>
                  {copy.continue}
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <form onSubmit={onSubmit} className="mt-6 space-y-5">
              <div className="rounded-sm bg-neutral-50 px-4 py-3 text-base text-neutral-700">
                {orderNumber} · {orderEmail}
              </div>
              <label className="block">
                <span className="mb-2 block text-base font-medium">{copy.commentLabel}</span>
                <textarea
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  placeholder={copy.commentPlaceholder}
                  required
                  rows={4}
                  className="w-full rounded-sm border border-neutral-300 px-4 py-3 text-base outline-none focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/15"
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
                  {submitState.type === "loading" ? copy.validating : copy.validateReturn}
                </button>
              </div>
            </form>
          )}

          {step === 4 && submitState.type === "success" && (
            <div className="mt-6 space-y-5">
              <div className="rounded-sm border border-emerald-200 bg-emerald-50 p-5">
                <h3 className="text-2xl font-semibold text-emerald-950">{copy.successTitle}</h3>
                <p className="mt-2 text-base leading-relaxed text-emerald-900">
                  {copy.successBody}
                </p>
                {submitState.trackingNumber ? (
                  <p className="mt-3 text-sm text-emerald-900">
                    {copy.tracking}: <strong>{submitState.trackingNumber}</strong>
                  </p>
                ) : null}
              </div>

              <div className="rounded-sm border border-neutral-200 bg-neutral-50 p-5">
                <h4 className="text-lg font-semibold">{copy.successNextTitle}</h4>
                <ol className="mt-3 space-y-2 text-base text-neutral-700">
                  {copy.successNext.map((item, index) => (
                    <li key={item} className="flex gap-3">
                      <span className="font-semibold text-neutral-900">{index + 1}.</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ol>
              </div>

              {submitState.labelUrl ? (
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
