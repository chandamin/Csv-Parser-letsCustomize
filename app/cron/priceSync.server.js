import cron from "node-cron";
import Papa from "papaparse";
import prisma from "../db.server";

const API_VERSION = "2024-10";

// --------------------
// Parse CSV text -> rows
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
// Refresh access token (agar expire ho)
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
// Valid offline session lo (refresh if expired)
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

  // Expires nahi hai toh token non-expiring hai
  if (!offline.expires) return { shop, token: offline.accessToken };

  const expiresAt = new Date(offline.expires).getTime();
  const shouldRefresh = Date.now() >= expiresAt - 2 * 60 * 1000;

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
// GraphQL helper
// --------------------
async function graphqlForShop(shop, accessToken, query) {
  const res = await fetch(
    `https://${shop}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({ query }),
    }
  );

  const json = await res.json();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(json)}`);
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

// --------------------
// Main sync function
// --------------------
async function runOnce() {
  console.log("");
  console.log("========================================");
  console.log("🚀 PRICING METAFIELD SYNC STARTED");
  console.log("🕒", new Date().toLocaleString());
  console.log("========================================");

  // 1️⃣ AUTH - Prisma se offline session lo
  const { shop, token } = await getValidOfflineSession();

  const ping = await graphqlForShop(shop, token, `query { shop { name } }`);
  console.log("✅ AUTH SUCCESS");
  console.log("🏪 Shop:", ping.shop.name);

  // 2️⃣ CSV URL CHECK - AppSettings se lo
  const settings = await prisma.appSettings.findUnique({
    where: { shop },
    select: { csvUrl: true },
  });

  const csvUrl = settings?.csvUrl;
  console.log("📄 CSV URL:", csvUrl || "NOT SET");

  if (!csvUrl) {
    console.log("⚠️  CSV URL save nahi hai AppSettings mein — sync skip.");
    console.log("========================================");
    return;
  }

  // 3️⃣ CSV FETCH
  const csvResponse = await fetch(csvUrl);
  if (!csvResponse.ok) {
    throw new Error(`CSV fetch failed: ${csvResponse.status}`);
  }

  const csvText = await csvResponse.text();
  const { rows } = await parseCsvToRows(csvText);
  console.log("✅ CSV Loaded:", rows.length, "rows");

  // 4️⃣ PRICE MAP banana (omnia product id => price)
  const priceMap = {};
  for (const row of rows) {
    const csvProductId = String(row["product id"] || "").trim();
    const price = row["recommended price"];

    if (csvProductId && price) {
      priceMap[csvProductId] = Number(String(price).replace(",", "."));
    }
  }

  console.log("🧾 CSV Products mapped:", Object.keys(priceMap).length);

  // 5️⃣ SHOPIFY VARIANTS PAGINATION
  let hasNextPage = true;
  let cursor = null;
  let updated = 0;
  let scanned = 0;

  while (hasNextPage) {
    const data = await graphqlForShop(
      shop,
      token,
      `{
        productVariants(first: 100, after: ${cursor ? `"${cursor}"` : null}) {
          pageInfo { hasNextPage endCursor }
          edges {
            node {
              id
              sku
              omnia: metafield(namespace: "custom", key: "omnia") {
                value
              }
              pricing: metafield(namespace: "custom", key: "pricing") {
                value
              }
              pricingPremium: metafield(namespace: "custom", key: "pricing_premium") {
                value
              }
              pricingCustomer: metafield(namespace: "custom", key: "pricing_customer") {
                value
              }
            }
          }
        }
      }`
    );

    const variants = data.productVariants.edges;
    console.log("\n📦 Scanning batch:", variants.length, "variants");

    for (const edge of variants) {
      const variant = edge.node;
      scanned++;

      // Omnia metafield se product id lo
      const omniaId = variant.omnia?.value?.trim();
      if (!omniaId) continue;

      // CSV mein match dhundo
      const csvPrice = priceMap[omniaId];
      if (csvPrice == null || Number.isNaN(csvPrice)) continue;

      // 6️⃣ EXISTING METAFIELDS PARSE
      let existing = {};
      try { existing = variant.pricing?.value ? JSON.parse(variant.pricing.value) : {}; } catch { existing = {}; }

      let existingPremium = {};
      try { existingPremium = variant.pricingPremium?.value ? JSON.parse(variant.pricingPremium.value) : {}; } catch { existingPremium = {}; }

      let existingCustomer = {};
      try { existingCustomer = variant.pricingCustomer?.value ? JSON.parse(variant.pricingCustomer.value) : {}; } catch { existingCustomer = {}; }

      // 7️⃣ PATCH BUILD - base_price kabhi mat chhuona
      const buildPatch = (existing) => {
        const patch = {
          ...existing,
          base_price: existing.base_price, // NEVER TOUCH
          base_price_google: csvPrice,
          base_price_idealo: csvPrice,
        };

        if (existing.tiered_price_google) {
          patch.tiered_price_google = { ...existing.tiered_price_google, 1: csvPrice };
        }
        if (existing.tiered_price_idealo) {
          patch.tiered_price_idealo = { ...existing.tiered_price_idealo, 1: csvPrice };
        }
        if (existing.tiered_price) {
          patch.tiered_price = existing.tiered_price;
        }

        return patch;
      };

      const newPricing = buildPatch(existing);
      const newPremiumPricing = buildPatch(existingPremium);
      const newCustomerPricing = buildPatch(existingCustomer);

      console.log(`💰 Updating SKU: ${variant.sku} | Omnia: ${omniaId} | Price: ${csvPrice}`);

      try {
        const mutationResult = await graphqlForShop(
          shop,
          token,
          `mutation {
            metafieldsSet(metafields: [
              {
                ownerId: "${variant.id}"
                namespace: "custom"
                key: "pricing"
                type: "json"
                value: "${JSON.stringify(newPricing).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"
              },
              {
                ownerId: "${variant.id}"
                namespace: "custom"
                key: "pricing_premium"
                type: "json"
                value: "${JSON.stringify(newPremiumPricing).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"
              },
              {
                ownerId: "${variant.id}"
                namespace: "custom"
                key: "pricing_customer"
                type: "json"
                value: "${JSON.stringify(newCustomerPricing).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"
              }
            ]) {
              userErrors {
                field
                message
              }
            }
          }`
        );

        const userErrors = mutationResult?.metafieldsSet?.userErrors || [];
        if (userErrors.length > 0) {
          console.log("❌ userErrors:", userErrors);
        } else {
          updated++;
          console.log(`✅ SUCCESS | SKU=${variant.sku}`);
        }

        // Rate limit se bachne ke liye thoda wait
        await new Promise((r) => setTimeout(r, 200));
      } catch (err) {
        console.log(`❌ Update failed for SKU ${variant.sku}:`, err.message);
      }
    }

    hasNextPage = data.productVariants.pageInfo.hasNextPage;
    cursor = data.productVariants.pageInfo.endCursor;
  }

  console.log("");
  console.log("========================================");
  console.log("🎯 SYNC COMPLETE");
  console.log("========================================");
  console.log(`✅ Updated  : ${updated}`);
  console.log(`📦 Scanned  : ${scanned}`);
  console.log("========================================");
}

// --------------------
// Cron runner with lock
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

// Server start hote hi ek baar chala lo
runWithLock();

// Phir har 3 minute pe
console.log("🟢 PRICING SYNC CRON REGISTERED");
console.log("⏰ Schedule: Har 3 minute");

cron.schedule("*/3 * * * *", async () => {
  console.log("");
  console.log("⏰ CRON TRIGGERED");
  await runWithLock();
});