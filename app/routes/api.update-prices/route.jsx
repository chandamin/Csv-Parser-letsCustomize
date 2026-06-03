import { json } from "@remix-run/node";
import { authenticate } from "../../shopify.server";

function normalizeHeader(row, header) {
  if (!header) return undefined;
  const target = String(header).trim().toLowerCase();
  for (const key of Object.keys(row || {})) {
    if (String(key).trim().toLowerCase() === target) return key;
  }
  return undefined;
}

export const action = async ({ request }) => {
  const { rows, skuHeader, priceHeader } = await request.json();

  if (!Array.isArray(rows) || rows.length === 0) {
    return json({ ok: false, error: "No rows provided" }, { status: 400 });
  }

  const { admin } = await authenticate.admin(request);

  let updated = 0;
  let failed = 0;
  const results = [];

  for (const [index, row] of rows.entries()) {
    try {
      const skuKey = normalizeHeader(row, skuHeader) || skuHeader;
      let priceKey = normalizeHeader(row, priceHeader) || priceHeader;

      if (row?.[priceKey] === undefined) {
        const commonPriceHeaders = [
          "price", "product price", "recommended price",
          "variant price", "new price", "sale price", "compare at price",
        ];
        for (const h of commonPriceHeaders) {
          const k = normalizeHeader(row, h);
          if (k && row?.[k] !== undefined) { priceKey = k; break; }
        }
      }

      const sku = String(row?.[skuKey] ?? "").trim();
      const priceRaw = row?.[priceKey];

      if (!sku) {
        failed++;
        results.push({
          sku: "(empty)",
          success: false,
          detail: `Row ${index + 1}: SKU field is empty`,
          reason: "error",
        });
        continue;
      }

      const price = Number(String(priceRaw ?? "").replace(/[^0-9.\-]/g, ""));

      if (!Number.isFinite(price)) {
        failed++;
        results.push({
          sku,
          success: false,
          detail: `Invalid price value: "${priceRaw}"`,
          reason: "error",
        });
        continue;
      }

      const variantResponse = await admin.graphql(
        `#graphql
        query VariantBySku($query: String!) {
          productVariants(first: 1, query: $query) {
            edges {
              node {
                id
                sku
                price
                product { id }
              }
            }
          }
        }`,
        { variables: { query: `sku:${sku}` } }
      );

      const variantData = await variantResponse.json();
      const variantNode = variantData?.data?.productVariants?.edges?.[0]?.node;

      if (!variantNode?.id) {
        failed++;
        results.push({
          sku,
          success: false,
          detail: "No matching product variant found in Shopify",
          reason: "not_found",
        });
        continue;
      }

      const variantId = variantNode.id;
      const productId = variantNode.product.id;
      const oldPrice  = variantNode.price;

      const updateResponse = await admin.graphql(
        `#graphql
        mutation UpdateVariantPrice(
          $productId: ID!,
          $variants: [ProductVariantsBulkInput!]!
        ) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants) {
            productVariants { id sku price }
            userErrors { field message }
          }
        }`,
        {
          variables: {
            productId,
            variants: [{ id: variantId, price: String(price) }],
          },
        }
      );

      const updateData = await updateResponse.json();
      const userErrors = updateData?.data?.productVariantsBulkUpdate?.userErrors ?? [];

      if (userErrors.length > 0) {
        failed++;
        results.push({
          sku,
          success: false,
          detail: userErrors.map((e) => e.message).join("; "),
          reason: "error",
        });
        continue;
      }

      updated++;
      results.push({
        sku,
        success: true,
        detail: `Price updated: $${Number(oldPrice).toFixed(2)} → $${price.toFixed(2)}`,
      });

    } catch (err) {
      console.error(err);
      failed++;
      results.push({
        sku: row?.[normalizeHeader(row, skuHeader) || skuHeader] || "(unknown)",
        success: false,
        detail: err?.message || String(err),
        reason: "error",
      });
    }
  }

  return json({
    ok: true,
    updatedCount: updated,
    failedCount: failed,
    totalCount: updated + failed,
    results, // ← frontend reads this for the modal
  });
};