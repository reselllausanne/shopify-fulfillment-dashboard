import { NextResponse } from "next/server";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import {
  REQUIRED_SHOPIFY_ADMIN_SCOPES,
  listMissingRequiredScopes,
  parseShopifyScopes,
} from "@/lib/shopifyEnv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SCOPE_CHECK_QUERY = /* GraphQL */ `
query ShopifyScopeCheck {
  shop {
    name
    myshopifyDomain
  }
  currentAppInstallation {
    accessScopes {
      handle
    }
  }
}
`;

type ScopeCheckResponse = {
  shop: {
    name: string;
    myshopifyDomain: string;
  } | null;
  currentAppInstallation: {
    accessScopes: Array<{ handle: string }>;
  } | null;
};

export async function GET() {
  try {
    const { data, errors } = await shopifyGraphQL<ScopeCheckResponse>(SCOPE_CHECK_QUERY);
    if (errors?.length) {
      return NextResponse.json(
        { ok: false, error: "Shopify GraphQL errors", details: errors },
        { status: 502 }
      );
    }

    const handles = data?.currentAppInstallation?.accessScopes?.map((entry) => entry.handle) ?? [];
    const availableScopes = parseShopifyScopes(handles);
    const missingScopes = listMissingRequiredScopes(availableScopes, REQUIRED_SHOPIFY_ADMIN_SCOPES);
    const requiredScopes = Array.from(REQUIRED_SHOPIFY_ADMIN_SCOPES);

    return NextResponse.json({
      ok: missingScopes.length === 0,
      shop: data?.shop ?? null,
      availableScopes: Array.from(availableScopes.values()).sort(),
      requiredScopes,
      missingScopes,
    });
  } catch (error: any) {
    console.error("[SHOPIFY][ADMIN][SCOPE-CHECK] Failed", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Scope check failed" },
      { status: 500 }
    );
  }
}
