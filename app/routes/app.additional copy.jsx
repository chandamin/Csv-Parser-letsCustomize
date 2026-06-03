import { useMemo, useState } from "react";
import {
  Button,
  Card,
  Checkbox,
  Frame,
  Layout,
  Page,
  Text,
  TextField,
  BlockStack,
  Toast,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";

function buildCsvFromExcelUrl(excelUrl, gid = "0") {
  if (!excelUrl) return "";

  try {
    const url = new URL(excelUrl);

    const match = url.pathname.match(/\/spreadsheets\/d\/([^/]+)/);

    if (!match) return "";

    const sheetId = match[1];

    return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
  } catch {
    return "";
  }
}

export default function SettingsPage() {
  const [excelUrl, setExcelUrl] = useState("");
  const [manualCsvUrl, setManualCsvUrl] = useState("");
  const [convertExcel, setConvertExcel] = useState(true);
  const [loading, setLoading] = useState(false);

  const [toast, setToast] = useState({
    active: false,
    message: "",
    error: false,
  });

  const finalCsvUrl = useMemo(() => {
    if (!convertExcel) return manualCsvUrl;

    const gidMatch = excelUrl.match(/[?&#]gid=([^&#]+)/i);
    const gid = gidMatch?.[1] || "0";

    return buildCsvFromExcelUrl(excelUrl, gid);
  }, [excelUrl, manualCsvUrl, convertExcel]);

  async function onSave() {
    try {
      setLoading(true);

      if (!excelUrl && !manualCsvUrl) {
        setToast({
          active: true,
          message: "Please enter a valid URL",
          error: true,
        });
        setLoading(false);
        return;
      }

      const response = await fetch("/api/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          excelUrl,
          csvUrl: finalCsvUrl,
          convertExcel,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || "Save failed");
      }

      setToast({
        active: true,
        message: "Settings saved successfully",
        error: false,
      });
    } catch (error) {
      setToast({
        active: true,
        message: error.message || "Something went wrong",
        error: true,
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Frame>
      {toast.active && (
        <Toast
          content={toast.message}
          error={toast.error}
          onDismiss={() =>
            setToast((prev) => ({ ...prev, active: false }))
          }
        />
      )}

      <Page>
        <TitleBar title="Settings" />

        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Feed Settings
                </Text>

                <TextField
                  label="Google Sheet URL"
                  value={excelUrl}
                  onChange={setExcelUrl}
                  autoComplete="off"
                  placeholder="https://docs.google.com/spreadsheets/d/.../edit?gid=0"
                />

                <Checkbox
                  label="Automatically convert Google Sheet to CSV URL"
                  checked={convertExcel}
                  onChange={setConvertExcel}
                />

                <TextField
                  label="CSV URL"
                  value={finalCsvUrl}
                  onChange={setManualCsvUrl}
                  disabled={convertExcel}
                  autoComplete="off"
                  placeholder="https://example.com/feed.csv"
                />

                <Button
                  variant="primary"
                  onClick={onSave}
                  loading={loading}
                >
                  Save Settings
                </Button>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    </Frame>
  );
}