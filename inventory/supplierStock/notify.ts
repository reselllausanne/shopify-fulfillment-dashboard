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
};

export type SupplierStockNotifier = {
  notifyInvalidRunPause(input: SupplierStockNotifyInput): Promise<SupplierStockNotifyResult>;
  notifyReviewQueue(input: SupplierStockNotifyInput): Promise<SupplierStockNotifyResult>;
};

function postmarkConfigured(): boolean {
  return Boolean(process.env.POSTMARK_SERVER_TOKEN && process.env.POSTMARK_FROM_EMAIL);
}

function twilioConfigured(): boolean {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
}

function whatsAppConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

export function describeNotifierChannels(): {
  email: "configured" | "missing";
  sms: "stub" | "missing";
  whatsapp: "stub" | "missing";
} {
  return {
    email: postmarkConfigured() ? "configured" : "missing",
    sms: twilioConfigured() ? "stub" : "missing",
    whatsapp: whatsAppConfigured() ? "stub" : "missing",
  };
}

async function sendPostmarkEmail(input: SupplierStockNotifyInput): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.POSTMARK_SERVER_TOKEN || "";
  const from = process.env.POSTMARK_FROM_EMAIL || "";
  const fromName = (process.env.POSTMARK_FROM_NAME || "Resell Lausanne").trim();
  const to =
    (process.env.SUPPLIER_STOCK_ALERT_EMAIL || "").trim() ||
    (process.env.POSTMARK_OVERRIDE_TO || "").trim() ||
    (process.env.SUPPORT_EMAIL || "").trim();

  if (!token || !from || !to) {
    return { ok: false, error: "Postmark or alert recipient not configured" };
  }

  const fromHeader = fromName ? `${fromName} <${from}>` : from;
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
    return { ok: false, error: `Postmark HTTP ${res.status}: ${JSON.stringify(json)}` };
  }

  return { ok: true };
}

/** SMS stub — Twilio creds detected but not wired. */
async function sendSmsStub(_input: SupplierStockNotifyInput): Promise<{ ok: boolean; error?: string }> {
  if (!twilioConfigured()) return { ok: false, error: "Twilio not configured" };
  return { ok: false, error: "SMS channel stub — Twilio creds present but unwired" };
}

/** WhatsApp stub — Meta creds detected but not wired. */
async function sendWhatsAppStub(_input: SupplierStockNotifyInput): Promise<{ ok: boolean; error?: string }> {
  if (!whatsAppConfigured()) return { ok: false, error: "WhatsApp not configured" };
  return { ok: false, error: "WhatsApp channel stub — creds present but unwired" };
}

export function createSupplierStockNotifier(): SupplierStockNotifier {
  return {
    async notifyInvalidRunPause(input) {
      const channels: NotifierChannel[] = [];
      const errors: string[] = [];

      if (postmarkConfigured()) {
        channels.push("email");
        const res = await sendPostmarkEmail(input);
        if (!res.ok) errors.push(res.error ?? "email failed");
      }

      if (twilioConfigured()) {
        channels.push("sms");
        const res = await sendSmsStub(input);
        if (!res.ok) errors.push(res.error ?? "sms stub");
      }

      if (whatsAppConfigured()) {
        channels.push("whatsapp");
        const res = await sendWhatsAppStub(input);
        if (!res.ok) errors.push(res.error ?? "whatsapp stub");
      }

      return {
        ok: errors.length === 0 && channels.includes("email"),
        channels,
        errors,
        skipped: !postmarkConfigured() && !twilioConfigured() && !whatsAppConfigured(),
      };
    },

    async notifyReviewQueue(input) {
      return this.notifyInvalidRunPause(input);
    },
  };
}
