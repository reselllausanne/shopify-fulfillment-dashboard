/**
 * Set Godspeed trucker hat primary image from cropped supplier photo.
 * Usage: npx tsx scripts/money-kickz-set-godspeed-image.ts
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";

const PRODUCT_ID = "gid://shopify/Product/15379389874562";
const FILE = path.join(process.cwd(), "tmp/money-kickz/godspeed-hat-product.png");

async function main() {
  const buf = readFileSync(FILE);
  const filename = "godspeed-gs-forever-trucker-hat-og.png";
  const mime = "image/png";

  const staged = await shopifyGraphQL<{
    stagedUploadsCreate: {
      stagedTargets: Array<{
        url: string;
        resourceUrl: string;
        parameters: Array<{ name: string; value: string }>;
      }>;
      userErrors: Array<{ message: string }>;
    };
  }>(
    `mutation($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets { url resourceUrl parameters { name value } }
        userErrors { field message }
      }
    }`,
    {
      input: [
        {
          resource: "IMAGE",
          filename,
          mimeType: mime,
          httpMethod: "POST",
          fileSize: String(buf.length),
        },
      ],
    }
  );
  const sue = staged.data?.stagedUploadsCreate?.userErrors ?? [];
  if (staged.errors?.length || sue.length) {
    throw new Error(JSON.stringify(staged.errors || sue));
  }
  const target = staged.data!.stagedUploadsCreate.stagedTargets[0]!;

  const form = new FormData();
  for (const p of target.parameters) form.append(p.name, p.value);
  form.append("file", new Blob([buf], { type: mime }), filename);
  const up = await fetch(target.url, { method: "POST", body: form });
  if (!up.ok) {
    throw new Error(`upload failed ${up.status}: ${(await up.text()).slice(0, 400)}`);
  }

  const cur = await shopifyGraphQL<{
    product: { media: { nodes: Array<{ id: string }> } } | null;
  }>(
    `query($id: ID!) {
      product(id: $id) {
        media(first: 20) { nodes { id } }
      }
    }`,
    { id: PRODUCT_ID }
  );
  const oldIds = (cur.data?.product?.media.nodes ?? []).map((n) => n.id);

  const created = await shopifyGraphQL<{
    productCreateMedia: {
      media: Array<{ id: string | null; status: string } | null>;
      mediaUserErrors: Array<{ message: string }>;
    };
  }>(
    `mutation($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) {
        media { id status }
        mediaUserErrors { message }
      }
    }`,
    {
      productId: PRODUCT_ID,
      media: [
        {
          originalSource: target.resourceUrl,
          mediaContentType: "IMAGE",
          alt: "Godspeed GS Forever Trucker Hat OG",
        },
      ],
    }
  );
  const cue = created.data?.productCreateMedia?.mediaUserErrors ?? [];
  if (created.errors?.length || cue.length) {
    throw new Error(JSON.stringify(created.errors || cue));
  }
  const newId = created.data?.productCreateMedia?.media?.[0]?.id;
  if (!newId) throw new Error("no media id returned");

  await shopifyGraphQL(
    `mutation($id: ID!, $moves: [MoveInput!]!) {
      productReorderMedia(id: $id, moves: $moves) {
        userErrors { field message }
        job { id }
      }
    }`,
    { id: PRODUCT_ID, moves: [{ id: newId, newPosition: "0" }] }
  );

  if (oldIds.length) {
    await shopifyGraphQL(
      `mutation($productId: ID!, $mediaIds: [ID!]!) {
        productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
          deletedMediaIds
          mediaUserErrors { message }
        }
      }`,
      { productId: PRODUCT_ID, mediaIds: oldIds }
    );
  }

  // wait briefly for processing
  await new Promise((r) => setTimeout(r, 2500));

  const after = await shopifyGraphQL<{
    product: {
      handle: string;
      featuredMedia?: { preview?: { image?: { url: string } | null } | null } | null;
      media: { nodes: Array<{ id: string; image?: { url: string } | null }> };
    } | null;
  }>(
    `query($id: ID!) {
      product(id: $id) {
        handle
        featuredMedia { preview { image { url } } }
        media(first: 5) { nodes { id ... on MediaImage { image { url } } } }
      }
    }`,
    { id: PRODUCT_ID }
  );

  console.log(
    JSON.stringify(
      {
        handle: after.data?.product?.handle,
        featured: after.data?.product?.featuredMedia?.preview?.image?.url ?? null,
        media: after.data?.product?.media.nodes.map((n) => n.image?.url),
        deletedOld: oldIds.length,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
