export type NotifierChannel = "email" | "sms" | "whatsapp";

export type SupplierStockNotifyInput = {
  supplierKey: string;
  displayName?: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
};

export type SupplierStockNotifyResult = {
  ok: boolean;
  channels: NotifierChannel[];
  errors: string[];
  skipped?: boolean;
  emailStatus: "configured" | "recipient_missing" | "send_failed" | "not_configured" | "sent";
  /** SMS/WhatsApp are future optional providers — never reported as delivered. */
  smsStatus: "not_implemented" | "credentials_present_unwired" | "missing";
  whatsappStatus: "not_implemented" | "credentials_present_unwired" | "missing";
};

export type SupplierStockNotifier = {
  notifyInvalidRunPause(input: SupplierStockNotifyInput): Promise<SupplierStockNotifyResult>;
  notifyReviewQueue(input: SupplierStockNotifyInput): Promise<SupplierStockNotifyResult>;
};

function postmarkToken(): string {
  return process.env.POSTMARK_SERVER_TOKEN || "";
}
function postmarkFrom(): string {
  return process.env.POSTMARK_FROM_EMAIL || "";
}
function alertRecipient(): string {
  return (
    (process.env.SUPPLIER_STOCK_ALERT_EMAIL || "").trim() ||
    (process.env.POSTMARK_OVERRIDE_TO || "").trim() ||
    (process.env.SUPPORT_EMAIL || "").trim()
  );
}

function twilioConfigured(): boolean {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
}

function whatsAppConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

export function describeNotifierChannels(): {
  email: "configured" | "recipient_missing" | "not_configured";
  sms: "not_implemented" | "credentials_present_unwired" | "missing";
  whatsapp: "not_implemented" | "credentials_present_unwired" | "missing";
} {
  const token = postmarkToken();
  const from = postmarkFrom();
  const to = alertRecipient();
  let email: "configured" | "recipient_missing" | "not_configured" = "not_configured";
  if (token && from && to) email = "configured";
  else if (token && from && !to) email = "recipient_missing";

  return {
    email,
    sms: twilioConfigured() ? "credentials_present_unwired" : "missing",
    whatsapp: whatsAppConfigured() ? "credentials_present_unwired" : "missing",
  };
}

/** Dashboard / preflight — honest Postmark readiness. */
export function getEmailNotifyPreflight(): {
  status: "configured" | "recipient_missing" | "not_configured";
  hasToken: boolean;
  hasFrom: boolean;
  hasRecipient: boolean;
} {
  const hasToken = Boolean(postmarkToken());
  const hasFrom = Boolean(postmarkFrom());
  const hasRecipient = Boolean(alertRecipient());
  const desc = describeNotifierChannels();
  return { status: desc.email, hasToken, hasFrom, hasRecipient };
}

async function sendPostmarkEmail(
  input: SupplierStockNotifyInput
): Promise<{ ok: boolean; error?: string; status: SupplierStockNotifyResult["emailStatus"] }> {
  const token = postmarkToken();
  const from = postmarkFrom();
  const to = alertRecipient();
  if (!token || !from) {
    return { ok: false, error: "Postmark not configured", status: "not_configured" };
  }
  if (!to) {
    return { ok: false, error: "Alert recipient missing", status: "recipient_missing" };
  }

  const fromName = (process.env.POSTMARK_FROM_NAME || "Resell Lausanne").trim();
  const fromHeader = fromName ? `${fromName} <${from}>` : from;
  try {
    const res = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": token,
      },
      body: JSON.stringify({
        From: fromHeader,
        To: to,
        Subject: input.subject,
        TextBody: input.bodyText,
        HtmlBody: input.bodyHtml ?? `<pre>${input.bodyText.replace(/</g, "&lt;")}</pre>`,
        MessageStream: (process.env.POSTMARK_MESSAGE_STREAM || "").trim() || undefined,
      }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => null);
      return {
        ok: false,
        error: `Postmark HTTP ${res.status}: ${JSON.stringify(json)}`,
        status: "send_failed",
      };
    }
    return { ok: true, status: "sent" };
  } catch (err: any) {
    return { ok: false, error: String(err?.message || err), status: "send_failed" };
  }
}

export function createSupplierStockNotifier(): SupplierStockNotifier {
  return {
    async notifyInvalidRunPause(input) {
      const channels: NotifierChannel[] = [];
      const errors: string[] = [];
      const preflight = describeNotifierChannels();

      let emailStatus: SupplierStockNotifyResult["emailStatus"] = preflight.email;
      if (preflight.email === "configured" || preflight.email === "recipient_missing") {
        channels.push("email");
        const res = await sendPostmarkEmail(input);
        emailStatus = res.status;
        if (!res.ok) errors.push(res.error ?? "email failed");
      }

      // Never claim SMS/WhatsApp delivered — stubs only.
      const smsStatus = preflight.sms;
      const whatsappStatus = preflight.whatsapp;
      if (smsStatus === "credentials_present_unwired") {
        errors.push("SMS not implemented (Twilio creds present but unwired)");
      }
      if (whatsappStatus === "credentials_present_unwired") {
        errors.push("WhatsApp not implemented (creds present but unwired)");
      }

      return {
        ok: emailStatus === "sent",
        channels,
        errors,
        skipped: emailStatus === "not_configured" || emailStatus === "recipient_missing",
        emailStatus,
        smsStatus,
        whatsappStatus,
      };
    },

    async notifyReviewQueue(input) {
      return this.notifyInvalidRunPause(input);
    },
  };
}
