import cron from "node-cron";
import Papa from "papaparse";
import prisma from "../db.server";

const API_VERSION = "2024-10";

// --------------------
// CSV header normalize
// --------------------
function normalizeHeader(row, header) {
  if (!header) return undefined;
  const target = String(header).trim().toLowerCase();
  return Object.keys(row || {}).find(
    (key) => String(key).trim().toLowerCase() === target
  );
}

// --------------------
// CSV text -> rows
// --------------------
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

// --------------------
// Access token refresh
// --------------------
async function refreshAccessToken(shop, refreshToken) {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_API_KEY,
      client_secret: process.env.SHOPIFY_API_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  const json = await res.json();
  if (!res.ok)
    throw new Error(`Token refresh failed: ${res.status} ${JSON.stringify(json)}`);
  return json;
}

// --------------------
// Offline session (auto-refresh if expired)
// --------------------
async function getValidOfflineSession() {
  const offline = await prisma.session.findFirst({
    where: { id: { startsWith: "offline_" } },
    select: {
      id: true,
      accessToken: true,
      expires: true,
      refreshToken: true,
      refreshTokenExpires: true,
    },
  });

  if (!offline?.accessToken) {
    throw new Error("No offline access token found. App install karo pehle.");
  }

  const shop = offline.id.replace("offline_", "");

  if (!offline.expires) return { shop, token: offline.accessToken };

  const shouldRefresh = Date.now() >= new Date(offline.expires).getTime() - 2 * 60 * 1000;
  if (!shouldRefresh) return { shop, token: offline.accessToken };

  if (!offline.refreshToken) {
    throw new Error("Token expire ho gaya aur refreshToken nahi hai. App reinstall karo.");
  }

  const refreshed = await refreshAccessToken(shop, offline.refreshToken);

  const updated = await prisma.session.update({
    where: { id: offline.id },
    data: {
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token ?? offline.refreshToken,
      expires: refreshed.expires_in
        ? new Date(Date.now() + refreshed.expires_in * 1000)
        : offline.expires,
      refreshTokenExpires: refreshed.refresh_token_expires_in
        ? new Date(Date.now() + refreshed.refresh_token_expires_in * 1000)
        : offline.refreshTokenExpires,
    },
    select: { accessToken: true },
  });

  return { shop, token: updated.accessToken };
}

// --------------------
// GraphQL helper (with variables support)
// --------------------
async function graphqlForShop(shop, accessToken, query, variables = {}) {
  const res = await fetch(
    `https://${shop}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({ query, variables }),
    }
  );

  const json = await res.json();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(json)}`);
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

// --------------------
// Main sync
// --------------------
async function runOnce() {
  console.log("");
  console.log("========================================");
  console.log("🚀 PRICE SYNC STARTED");
  console.log("🕒", new Date().toLocaleString());
  console.log("========================================");

  // 1️⃣ AUTH
  const { shop, token } = await getValidOfflineSession();

  const ping = await graphqlForShop(shop, token, `query { shop { name } }`);
  console.log("✅ AUTH SUCCESS");
  console.log("🏪 Shop:", ping.shop.name);

  // 2️⃣ CSV URL - AppSettings se check karo
  const settings = await prisma.appSettings.findUnique({
    where: { shop },
    select: { csvUrl: true },
  });

  const csvUrl = settings?.csvUrl;
  console.log("📄 CSV URL:", csvUrl || "NOT SET");

  if (!csvUrl) {
    console.log("⚠️  CSV URL save nahi hai — sync skip kiya.");
    console.log("========================================");
    return;
  }

  // 3️⃣ CSV FETCH
  const csvResponse = await fetch(csvUrl);
  if (!csvResponse.ok) {
    throw new Error(`CSV fetch failed: ${csvResponse.status}`);
  }

  const csvText = await csvResponse.text();
  if (!csvText) throw new Error("CSV empty hai");

  const { headers, rows } = await parseCsvToRows(csvText);
  console.log(`📦 Total CSV rows: ${rows.length}`);

  if (!rows.length) throw new Error("CSV mein koi rows nahi hain");

  // 4️⃣ EXACT HEADERS (same as route code)
  const skuHeader =
    headers.find((h) => h?.toLowerCase() === "product sku") || "product sku";

  const priceHeader =
    headers.find((h) => h?.toLowerCase() === "recommended price") ||
    "recommended price";

  console.log("🏷️  SKU Header:", skuHeader);
  console.log("💰 Price Header:", priceHeader);

  // 5️⃣ LOOP ROWS - exact same logic as route
  let updated = 0;
  let failed = 0;

  for (const [index, row] of rows.entries()) {
    try {
      console.log(`\n🔄 Row ${index + 1}/${rows.length}`);

      const skuKey = normalizeHeader(row, skuHeader) || skuHeader;
      let priceKey = normalizeHeader(row, priceHeader) || priceHeader;

      // Fallback price column detection (same as route)
      if (row?.[priceKey] === undefined) {
        const fallbacks = ["price", "product price", "variant price", "sale price", "compare at price"];
        for (const h of fallbacks) {
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
        console.log("❌ SKU empty — skip");
        failed++;
        continue;
      }

      const price = Number(String(priceRaw ?? "").replace(/[^0-9.\-]/g, ""));

      if (!Number.isFinite(price)) {
        console.log(`❌ Invalid price: ${priceRaw} — skip`);
        failed++;
        continue;
      }

      // 6️⃣ SKU SE VARIANT DHUNDO
      const variantData = await graphqlForShop(
        shop,
        token,
        `query ($query: String!) {
          productVariants(first: 1, query: $query) {
            edges {
              node {
                id
                product { id }
              }
            }
          }
        }`,
        { query: `sku:${sku}` }
      );

      const node = variantData?.productVariants?.edges?.[0]?.node;

      if (!node?.id) {
        console.log(`❌ SKU not found in Shopify: ${sku}`);
        failed++;
        continue;
      }

      // 7️⃣ PRICE UPDATE - productVariantsBulkUpdate (same as route)
      console.log(`🚀 Updating SKU: ${sku} => Price: ${price}`);

      const updateData = await graphqlForShop(
        shop,
        token,
        `mutation ($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants) {
            userErrors { message }
          }
        }`,
        {
          productId: node.product.id,
          variants: [
            {
              id: node.id,
              price: String(price),
            },
          ],
        }
      );

      const errors = updateData?.productVariantsBulkUpdate?.userErrors || [];

      if (errors.length > 0) {
        console.log(`❌ userErrors for SKU ${sku}:`, errors.map((e) => e.message).join("; "));
        failed++;
        continue;
      }

      updated++;
      console.log(`✅ SUCCESS | SKU=${sku} | Price=${price}`);

      // Rate limit se bachne ke liye
      await new Promise((r) => setTimeout(r, 200));

    } catch (err) {
      failed++;
      console.log(`💥 Row ${index + 1} error:`, err?.message || err);
    }
  }

  console.log("");
  console.log("========================================");
  console.log("🎯 PRICE SYNC COMPLETE");
  console.log("========================================");
  console.log(`✅ Updated : ${updated}`);
  console.log(`❌ Failed  : ${failed}`);
  console.log(`📦 Total   : ${rows.length}`);
  console.log("========================================");
}

// --------------------
// Cron lock runner
// --------------------
let isRunning = false;

async function runWithLock() {
  if (isRunning) {
    console.log("⏳ Skipping — previous sync still running");
    return;
  }

  isRunning = true;
  try {
    await runOnce();
  } catch (err) {
    console.log("");
    console.log("💥 SYNC ERROR");
    console.log(err?.message || err);
    console.log(err?.stack);
  } finally {
    isRunning = false;
  }
}

// Server start hote hi ek baar run
runWithLock();

// Har 3 minute pe cron
console.log("🟢 PRICE SYNC CRON REGISTERED");
console.log("⏰ Schedule: Har 3 minute");

cron.schedule("*/3 * * * *", async () => {
  console.log("");
  console.log("⏰ CRON TRIGGERED");
  await runWithLock();
});