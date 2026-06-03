import { json } from "@remix-run/node";
import Papa from "papaparse";
import { authenticate } from "../../shopify.server";
import prisma from "../../db.server";

/**
 * Normalize CSV header
 */
function normalizeHeader(row, header) {
  if (!header) return undefined;

  const target = String(header).trim().toLowerCase();

  return Object.keys(row || {}).find(
    (key) => String(key).trim().toLowerCase() === target
  );
}

/**
 * Parse CSV
 */
function parseCsvToRows(csvText) {
  return new Promise((resolve, reject) => {
    Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        resolve({
          headers: results.meta.fields || [],
          rows: results.data || [],
        });
      },
      error: reject,
    });
  });
}

export const action = async ({ request }) => {
  try {

     console.log("🚀 PRICE SYNC STARTING");
    // ✅ FIXED: single authentication call
    const { admin, session } = await authenticate.admin(request);
    const shop = session?.shop;
console.log("✅ AUTH SUCCESS");
    console.log("SHOP:", session?.shop);

    if (!shop) {
      return json({ ok: false, error: "Missing shop session" }, { status: 400 });
      console.log("❌ AUTH FAILED: No shop in session");
    }

    // 1. Get saved CSV URL
    const settings = await prisma.appSettings.findUnique({
      where: { shop },
      select: { csvUrl: true },
    });

    const csvUrl = settings?.csvUrl;

   console.log(`📄 CSV URL: ${csvUrl}`);

    if (!csvUrl) {
      return json(
        { ok: false, error: "No CSV URL saved for this shop" },
        { status: 400 }
      );
    }

    // 2. Fetch CSV
    const response = await fetch(csvUrl);

    if (!response.ok) {
      return json(
        { ok: false, error: `CSV fetch failed: ${response.status}` },
        { status: 500 }
      );
    }

    const csvText = await response.text();

    if (!csvText) {
      return json({ ok: false, error: "CSV is empty" }, { status: 400 });
    }

    // 3. Parse CSV
    const { headers, rows } = await parseCsvToRows(csvText);

    if (!rows?.length) {
      return json({ ok: false, error: "No rows found in CSV" }, { status: 400 });
    }

    // 4. Default headers
    const skuHeader =
      headers.find((h) => h?.toLowerCase() === "product sku") ||
      "product sku";

    const priceHeader =
      headers.find((h) => h?.toLowerCase() === "recommended price") ||
      "recommended price";

    let updated = 0;
    let failed = 0;
    const details = [];

    // 5. Loop rows
    for (const [index, row] of rows.entries()) {
      try {

         console.log(`\n🔄 Processing Row ${index + 1}`);
        const skuKey = normalizeHeader(row, skuHeader) || skuHeader;
        let priceKey = normalizeHeader(row, priceHeader) || priceHeader;

        // fallback price detection
        if (row?.[priceKey] === undefined) {
          const fallback = [
            "price",
            "product price",
            "variant price",
            "sale price",
            "compare at price",
          ];

          for (const h of fallback) {
            const k = normalizeHeader(row, h);
            if (k && row?.[k] !== undefined) {
              priceKey = k;
              break;
            }
          }
        }

        const sku = String(row?.[skuKey] ?? "").trim();
        const priceRaw = row?.[priceKey];

        console.log(`📦 SKU: ${sku}`);
console.log(`💰 Raw Price: ${priceRaw}`);

        if (!sku) {
           console.error(`❌ SKU NOT FOUND: ${sku}`);
          failed++;
          details.push({ rowIndex: index, status: "failed", reason: "Missing SKU" });
          continue;
        }

        const price = Number(String(priceRaw ?? "").replace(/[^0-9.\-]/g, ""));

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

        // 6. Find variant
        const variantRes = await admin.graphql(
          `#graphql
          query ($query: String!) {
            productVariants(first: 1, query: $query) {
              edges {
                node {
                  id
                  product { id }
                }
              }
            }
          }`,
          { variables: { query: `sku:${sku}` } }
        );

        const variantData = await variantRes.json();
        const node = variantData?.data?.productVariants?.edges?.[0]?.node;

        if (!node?.id) {
          failed++;
          details.push({
            rowIndex: index,
            sku,
            status: "failed",
            reason: "SKU not found",
          });
          continue;
        }

        // 7. Update price
        const updateRes = await admin.graphql(

          console.log(
  `🚀 Updating SKU ${sku} with Price ${price}`
),
          `#graphql
          mutation ($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
            productVariantsBulkUpdate(productId: $productId, variants: $variants) {
              userErrors { message }
            }
          }`,
          {
            variables: {
              productId: node.product.id,
              variants: [
                {
                  id: node.id,
                  price: String(price),
                },
              ],
            },
          }
        );

        const updateData = await updateRes.json();
        const errors =
          updateData?.data?.productVariantsBulkUpdate?.userErrors || [];

        if (errors.length > 0) {
          failed++;
          details.push({
            rowIndex: index,
            sku,
            status: "failed",
            reason: errors.map((e) => e.message).join("; "),
          });
          continue;
        }

        updated++;
        console.log(`✅ SUCCESS | SKU: ${sku} | Price: ${price}`);
        details.push({
          rowIndex: index,
          sku,
          status: "updated",
          price,
        });
      } catch (err) {
        failed++;
        details.push({
          rowIndex: index,
          status: "failed",
          reason: err?.message || String(err),
        });
      }
    }

    // 8. Response
    return json({
      ok: true,
      updatedCount: updated,
      failedCount: failed,
      totalCount: rows.length,
      details,
    });
  } catch (err) {
     console.error("💥 MAIN CATCH ERROR");
  console.error(err);
  console.error(err?.stack);
    return json(
      { ok: false, error: err?.message || String(err) },
      { status: 500 }
    );
  }
};