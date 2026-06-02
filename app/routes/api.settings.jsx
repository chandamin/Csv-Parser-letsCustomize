import prisma from "../db.server";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

/* =========================
   GET SETTINGS (loader)
========================= */
export async function loader({ request }) {
  try {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;

    const settings = await prisma.appSettings.findUnique({
      where: { shop },
    });

    return json({ data: settings });
  } catch (error) {
    console.error("LOADER ERROR:", error);

    return json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}

/* =========================
   SAVE SETTINGS (action)
========================= */
export async function action({ request }) {
  try {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;

    const body = await request.json();

    const result = await prisma.appSettings.upsert({
      where: { shop },
      update: {
        excelUrl: body.excelUrl,
        csvUrl: body.csvUrl,
        convertExcel: body.convertExcel,
      },
      create: {
        shop,
        excelUrl: body.excelUrl,
        csvUrl: body.csvUrl,
        convertExcel: body.convertExcel,
      },
    });

    return json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("ACTION ERROR:", error);

    return json(
      {
        success: false,
        message: error.message,
      },
      { status: 500 }
    );
  }
}