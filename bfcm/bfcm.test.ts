import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_SEND_AT,
  aggregateExclusions,
  automatedSendGate,
  campaignPhase,
  canonicalSize,
  clickIsUseful,
  confirmationDecision,
  customerEmail,
  decideCampaign,
  eligibleVariant,
  exceptionBypassesSuppressionOrHold,
  exclusionMutationMaySubscribe,
  explicitSizes,
  fridayCampaigns,
  keywordsCreateExclusion,
  mailboxStateReleasesHold,
  offerModelKey,
  openIsUsefulInterest,
  profileIdentity,
  releaseHold,
  retainExistingHolds,
  selectAutomaticOffers,
  selectEditorialOffers,
  selectionHistoryEventAllowed,
  serviceMessageAllowed,
  sizeClick,
  smartSendingExceptionAllowed,
  toCampaignProfileProperties,
  type AudienceProfile,
  type EditorialSelection,
  type HoldEntry,
  type OfferVariant,
} from "@/bfcm";

const DAY = 24 * 60 * 60 * 1000;

function profile(patch: Partial<AudienceProfile> = {}): AudienceProfile {
  return {
    consent: "subscribed",
    bfConfirmed: false,
    bfConfirmedAt: null,
    confirmationSentAt: null,
    liquidationPurchasedSinceVipOpen: false,
    usefulInterest: false,
    marketingHold: false,
    bf2026Excluded: false,
    relevantOfferAvailable: false,
    ...patch,
  };
}

function variant(
  id: string,
  model: string,
  size: string,
  patch: Partial<OfferVariant> = {},
): OfferVariant {
  return {
    variant_id: id,
    model_id: model,
    title: model,
    size_eu: size,
    campaign_approved: true,
    local_stock_verified: true,
    available_local_quantity: 1,
    delivery_48h_eligible: true,
    reference_validated: true,
    sale_price_chf: 90,
    reference_price_chf: 200,
    image_url: "https://cdn.example.test/shoe.jpg",
    url: `https://www.resell-lausanne.ch/products/${model}?variant=${id}`,
    ...patch,
  };
}

const catalog = [
  variant("a40", "model-a", "40"),
  variant("a42", "model-a", "42"),
  variant("b42", "model-b", "42"),
  variant("c42h", "model-c", "42.5"),
];

const selection: EditorialSelection = {
  campaign_file: "04_acces_vip",
  approved: true,
  product_urls: [],
  variant_ids: catalog.map((item) => item.variant_id),
};

describe("v3 schedule", () => {
  it("uses 12/15 November and exact Swiss launch instants", () => {
    expect(CAMPAIGN_SEND_AT["01_selection_novembre"]).toBe(
      "2026-11-12T18:30:00+01:00",
    );
    expect(CAMPAIGN_SEND_AT["02_invitation"]).toBe(
      "2026-11-15T18:30:00+01:00",
    );
    expect(campaignPhase("2026-11-26T17:59:59Z")).toBe("prepare");
    expect(campaignPhase("2026-11-26T18:00:00Z")).toBe("vip");
    expect(campaignPhase("2026-11-27T08:00:00Z")).toBe("public");
    expect(campaignPhase("2026-11-30T23:00:00Z")).toBe("ended");
  });
});

describe("editorial selection", () => {
  it("keeps exact sizes and requires verified same-variant claims", () => {
    expect(canonicalSize("EU 42,5")).toBe("42.5");
    expect(canonicalSize("42 2/3")).toBe("42 2/3");
    expect(canonicalSize("9")).toBeNull();
    expect(explicitSizes(["42", "42.5", "42 2/3", "43"])).toEqual([
      "42",
      "42.5",
      "42 2/3",
    ]);
    expect(eligibleVariant(catalog[1]!)).toBe(true);
    expect(
      eligibleVariant(
        variant("bad", "bad", "42", { local_stock_verified: false }),
      ),
    ).toBe(false);
    expect(
      eligibleVariant(
        variant("supplier", "supplier", "42", {
          available_local_quantity: 0,
        }),
      ),
    ).toBe(false);
  });

  it("renders no demo fallback while owner choices are unapproved", () => {
    expect(
      selectEditorialOffers(catalog, ["42"], {
        ...selection,
        approved: false,
      }),
    ).toEqual({ status: "awaiting_selection", items: [] });
    expect(
      selectEditorialOffers(catalog, ["42"], {
        ...selection,
        variant_ids: [],
      }),
    ).toEqual({ status: "awaiting_selection", items: [] });
  });

  it("automatically selects all eligible live-sale variants without an allow-list", () => {
    expect(
      selectAutomaticOffers(catalog, ["42"]).items.map(
        (item) => item.variant_id,
      ),
    ).toEqual(["a42", "b42"]);
    expect(
      selectAutomaticOffers(catalog, ["42.5"]).items.map(
        (item) => item.variant_id,
      ),
    ).toEqual(["c42h"]);
    expect(selectAutomaticOffers(catalog, ["42 2/3"]).items).toEqual([]);
    expect(
      selectAutomaticOffers(catalog, ["42"], [], {
        excluded_variant_ids: ["a42"],
      }).items.map((item) => item.variant_id),
    ).toEqual(["b42"]);
    expect(
      selectAutomaticOffers(catalog, ["42"], [], {
        pinned_variant_ids: ["b42"],
      }).items.map((item) => item.variant_id),
    ).toEqual(["b42", "a42"]);
  });

  it("filters exact size before model dedupe and avoids prior models", () => {
    expect(
      selectEditorialOffers(catalog, ["42"], selection).items.map(
        (item) => item.variant_id,
      ),
    ).toEqual(["a42", "b42"]);
    expect(
      selectEditorialOffers(catalog, ["42"], selection, ["model-a"]).items.map(
        (item) => item.variant_id,
      ),
    ).toEqual(["b42"]);
    expect(
      selectEditorialOffers(
        catalog,
        ["42"],
        selection,
        ["model-a", "model-b"],
      ).items,
    ).toEqual([]);
    expect(offerModelKey({ ...catalog[0]!, model_id: undefined })).toBe(
      "/products/model-a",
    );
    expect(selectionHistoryEventAllowed("delivered")).toBe(true);
    expect(selectionHistoryEventAllowed("preview")).toBe(false);
    expect(selectionHistoryEventAllowed("get")).toBe(false);
  });

  it("isolates snapshots by campaign and clears all stale slots", () => {
    const selected = selectEditorialOffers(
      catalog,
      ["42"],
      selection,
      ["model-a"],
    );
    const dated = "2026-11-26T18:55:00+01:00";
    const fourth = toCampaignProfileProperties(
      "04_acces_vip",
      selected,
      dated,
    );
    const fifth = toCampaignProfileProperties(
      "05_ouverture_publique",
      { items: [] },
      dated,
    );
    expect(fourth.rl_bf_2026_04_p1_ready).toBe(true);
    expect(fourth.rl_bf_2026_04_p1_preview_ready).toBe(false);
    expect(fourth.rl_bf_2026_04_p1_preview_url).toBe("");
    expect(fifth.rl_bf_2026_05_p1_ready).toBe(false);
    expect(fifth.rl_bf_2026_05_p1_title).toBe("");
    expect(
      Object.keys(fourth).every((key) =>
        key.startsWith("rl_bf_2026_04_"),
      ),
    ).toBe(true);
    expect(
      Object.keys(fifth).every((key) =>
        key.startsWith("rl_bf_2026_05_"),
      ),
    ).toBe(true);
  });
});

describe("audience precedence", () => {
  it("routes non-VIP and VIP profiles without duplicate public opening", () => {
    const nonVip = profile();
    expect(decideCampaign(nonVip, "02_invitation").send).toBe(true);
    expect(
      decideCampaign(nonVip, "03_apercu_et_inscription").variant,
    ).toBe("signup_reminder");
    expect(decideCampaign(nonVip, "05_ouverture_publique").send).toBe(true);

    const vip = profile({
      bfConfirmed: true,
      bfConfirmedAt: "2026-11-10T12:00:00+01:00",
      usefulInterest: true,
      relevantOfferAvailable: true,
    });
    expect(decideCampaign(vip, "02_invitation").reason).toBe(
      "already_bf_confirmed",
    );
    expect(decideCampaign(vip, "04_acces_vip").send).toBe(true);
    expect(decideCampaign(vip, "05_ouverture_publique").reason).toBe(
      "vip_excluded_from_public_open",
    );
    expect(fridayCampaigns(vip)).toEqual(["06_rappel_vendredi"]);
    expect(
      fridayCampaigns(
        profile({
          usefulInterest: true,
          relevantOfferAvailable: true,
        }),
      ),
    ).toEqual(["05_ouverture_publique", "06_rappel_vendredi"]);
  });

  it("pauses the 22 mail for 24h and stops buyers from relances", () => {
    const send = Date.parse(CAMPAIGN_SEND_AT["03_apercu_et_inscription"]);
    const recent = profile({
      bfConfirmed: true,
      bfConfirmedAt: new Date(send - DAY + 1).toISOString(),
    });
    expect(
      decideCampaign(recent, "03_apercu_et_inscription").reason,
    ).toBe("recent_confirmation_quiet");

    const buyer = profile({
      bfConfirmed: true,
      bfConfirmedAt: "2026-11-10T12:00:00+01:00",
      liquidationPurchasedSinceVipOpen: true,
      usefulInterest: true,
      relevantOfferAvailable: true,
    });
    expect(decideCampaign(buyer, "06_rappel_vendredi").reason).toBe(
      "liquidation_purchased",
    );
  });

  it("puts suppression and SAV ahead of VIP, clicks, and exceptions", () => {
    const heldVip = profile({
      bfConfirmed: true,
      bfConfirmedAt: "2026-11-10T12:00:00+01:00",
      marketingHold: true,
      usefulInterest: true,
      relevantOfferAvailable: true,
    });
    expect(decideCampaign(heldVip, "04_acces_vip").reason).toBe(
      "service_or_manual_exclusion",
    );
    expect(
      decideCampaign(
        { ...heldVip, consent: "unsubscribed" },
        "04_acces_vip",
      ).reason,
    ).toBe("native_suppression");
    expect(smartSendingExceptionAllowed("04_acces_vip")).toBe(true);
    expect(smartSendingExceptionAllowed("06_rappel_vendredi")).toBe(true);
    expect(exceptionBypassesSuppressionOrHold()).toBe(false);
    expect(serviceMessageAllowed()).toBe(true);
    expect(clickIsUseful(false)).toBe(true);
    expect(clickIsUseful(true)).toBe(false);
    expect(clickIsUseful(null)).toBe(false);
    expect(openIsUsefulInterest()).toBe(false);
  });
});

describe("SAV and registration guards", () => {
  const first: HoldEntry = {
    id: "refund-100",
    profileEmail: "ada+bf@example.com",
    scope: "marketing",
    reason: "refund_pending",
    source: "manual_review",
    sourceRef: "thread-1",
    state: "active",
    decidedBy: "theo",
    decidedAt: "2026-11-11T10:00:00+01:00",
    releasedBy: null,
    releasedAt: null,
  };
  const second: HoldEntry = {
    ...first,
    id: "return-101",
    reason: "open_return",
    sourceRef: "order-101",
  };

  it("preserves email dots/plus and rejects operational senders", () => {
    expect(customerEmail("Ada <Ada.Name+bf@Example.com>")).toBe(
      "ada.name+bf@example.com",
    );
    expect(customerEmail("orders@stockx.com")).toBeNull();
    expect(
      profileIdentity([
        "ada.name+bf@example.com",
        "Ada <ada.name+bf@example.com>",
      ]),
    ).toEqual({
      status: "resolved",
      email: "ada.name+bf@example.com",
    });
    expect(
      profileIdentity(["ada@example.com", "other@example.com"]).status,
    ).toBe("review");
  });

  it("does not classify from keywords or clear from mailbox state", () => {
    expect(keywordsCreateExclusion()).toBe(false);
    expect(mailboxStateReleasesHold()).toBe(false);
    expect(exclusionMutationMaySubscribe()).toBe(false);
    expect(retainExistingHolds([first])).toEqual([first]);
  });

  it("releases one case but keeps another active", () => {
    const released = releaseHold(
      [first, second],
      first.id,
      "theo",
      "2026-11-11T11:00:00+01:00",
    );
    expect(
      aggregateExclusions(released, "ada+bf@example.com"),
    ).toMatchObject({
      rl_marketing_hold: true,
      rl_marketing_hold_reason: "open_return",
    });
  });

  it("fails closed when a critical source is old or unavailable", () => {
    expect(
      automatedSendGate([
        { critical: true, available: true, ageMinutes: 5 },
      ]).allow,
    ).toBe(true);
    expect(
      automatedSendGate([
        { critical: true, available: true, ageMinutes: 6 },
      ]),
    ).toMatchObject({
      allow: false,
      retainExistingHolds: true,
      replaceUnavailableWithEmpty: false,
      reason: "stale",
    });
    expect(
      automatedSendGate([
        { critical: true, available: false, ageMinutes: null },
      ]).reason,
    ).toBe("unavailable");
  });

  it("acknowledges one real form transition only", () => {
    const base = {
      previousConfirmed: false,
      nextConfirmed: true,
      alreadySent: false,
      consent: "subscribed" as const,
      marketingHold: false,
      bf2026Excluded: false,
      phase: "prepare" as const,
    };
    expect(
      confirmationDecision({ ...base, cause: "form_submit" }).send,
    ).toBe(true);
    expect(
      confirmationDecision({ ...base, cause: "size_click" }).send,
    ).toBe(false);
    expect(
      confirmationDecision({
        ...base,
        cause: "form_submit",
        nextConfirmed: false,
      }).reason,
    ).toBe("pending");
    expect(
      confirmationDecision({
        ...base,
        cause: "form_submit",
        marketingHold: true,
      }),
    ).toMatchObject({ send: false, promiseEmail: false, reason: "held" });
    expect(sizeClick()).toEqual({
      preselect: true,
      persist: false,
      subscribe: false,
      confirmBf: false,
    });
  });
});
