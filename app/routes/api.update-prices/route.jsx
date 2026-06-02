import { json } from "@remix-run/node";
import { authenticate } from "../../shopify.server";

function normalizeHeader(row, header) {
  if (!header) return undefined;

  const target = String(header).trim().toLowerCase();

  for (const key of Object.keys(row || {})) {
    if (String(key).trim().toLowerCase() === target) {
      return key;
    }
  }

  return undefined;
}

export const action = async ({ request }) => {
  const { rows, skuHeader, priceHeader } = await request.json();

  if (!Array.isArray(rows) || rows.length === 0) {
    return json(
      {
        ok: false,
        error: "No rows provided",
      },
      { status: 400 }
    );
  }

  const { admin } = await authenticate.admin(request);

  let updated = 0;
  let failed = 0;
  const details = [];

  for (const [index, row] of rows.entries()) {
    try {
      const skuKey =
        normalizeHeader(row, skuHeader) || skuHeader;

      let priceKey =
        normalizeHeader(row, priceHeader) || priceHeader;

      if (row?.[priceKey] === undefined) {
        const commonPriceHeaders = [
          "price",
          "product price",
          "recommended price",
          "variant price",
          "new price",
          "sale price",
          "compare at price",
        ];

        for (const h of commonPriceHeaders) {
          const k = normalizeHeader(row, h);

          if (k && row?.[k] !== undefined) {
            priceKey = k;
            break;
          }
        }
      }

      const sku = String(row?.[skuKey] ?? "").trim();
      const priceRaw = row?.[priceKey];

      if (!sku) {
        failed++;

        details.push({
          rowIndex: index,
          sku: null,
          status: "failed",
          reason: "Missing SKU",
        });

        continue;
      }

      const price = Number(
        String(priceRaw ?? "").replace(/[^0-9.\-]/g, "")
      );

      if (!Number.isFinite(price)) {
        failed++;

        details.push({
          rowIndex: index,
          sku,
          status: "failed",
          reason: "Invalid price",
        });

        continue;
      }

      console.log("Searching SKU:", sku);

      const variantResponse = await admin.graphql(
        `#graphql
        query VariantBySku($query: String!) {
          productVariants(first: 1, query: $query) {
            edges {
              node {
                id
                sku
                product {
                  id
                }
              }
            }
          }
        }`,
        {
          variables: {
            query: `sku:${sku}`,
          },
        }
      );

      const variantData = await variantResponse.json();

      console.log(
        "Variant Search Result:",
        JSON.stringify(variantData, null, 2)
      );

      const variantNode =
        variantData?.data?.productVariants?.edges?.[0]?.node;

      if (!variantNode?.id) {
        failed++;

        details.push({
          rowIndex: index,
          sku,
          status: "failed",
          reason: "SKU not found",
        });

        continue;
      }

      const variantId = variantNode.id;
      const productId = variantNode.product.id;

      console.log(
        "Updating Variant:",
        variantId,
        "Product:",
        productId,
        "Price:",
        price
      );

      const updateResponse = await admin.graphql(
        `#graphql
        mutation UpdateVariantPrice(
          $productId: ID!,
          $variants: [ProductVariantsBulkInput!]!
        ) {
          productVariantsBulkUpdate(
            productId: $productId
            variants: $variants
          ) {
            productVariants {
              id
              sku
              price
            }
            userErrors {
              field
              message
            }
          }
        }`,
        {
          variables: {
            productId,
            variants: [
              {
                id: variantId,
                price: String(price),
              },
            ],
          },
        }
      );

      const updateData = await updateResponse.json();

      console.log(
        "Update Result:",
        JSON.stringify(updateData, null, 2)
      );

      const userErrors =
        updateData?.data?.productVariantsBulkUpdate?.userErrors ??
        [];

      if (userErrors.length > 0) {
        failed++;

        details.push({
          rowIndex: index,
          sku,
          status: "failed",
          reason: userErrors
            .map((e) => e.message)
            .join("; "),
        });

        continue;
      }

      updated++;

      details.push({
        rowIndex: index,
        sku,
        status: "updated",
        price,
      });
    } catch (err) {
      console.error(err);

      failed++;

      details.push({
        rowIndex: index,
        status: "failed",
        reason: err?.message || String(err),
      });
    }
  }

  return json({
    ok: true,
    updatedCount: updated,
    failedCount: failed,
    totalCount: updated + failed,
    details,
  });
};