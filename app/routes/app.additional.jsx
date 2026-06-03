import { useEffect, useMemo, useState } from "react";
import {
  Button, Card, Checkbox, Frame, IndexTable, Layout,
  Page, Text, TextField, BlockStack, Toast, Badge, Spinner,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import Papa from "papaparse";

function buildCsvFromExcelUrl(excelUrl, gid = "0") {
  if (!excelUrl) return "";
  try {
    const url = new URL(excelUrl);
    const match = url.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
    if (!match) return "";
    const sheetId = match[1];
    return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
  } catch { return ""; }
}

export default function SettingsPage() {
  const [excelUrl, setExcelUrl]       = useState("");
  const [manualCsvUrl, setManualCsvUrl] = useState("");
  const [convertExcel, setConvertExcel] = useState(true);
  const [loading, setLoading]         = useState(false);

  // saved URL state
  const [savedUrl, setSavedUrl]       = useState("");

  // preview state
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewHeaders, setPreviewHeaders] = useState([]);
  const [previewRows, setPreviewRows]       = useState([]);
  const [previewSearch, setPreviewSearch]   = useState("");
  const [previewPage, setPreviewPage]       = useState(1);
  const ITEMS_PER_PAGE = 50;

  const [toast, setToast] = useState({ active: false, message: "", error: false });

  const finalCsvUrl = useMemo(() => {
    if (!convertExcel) return manualCsvUrl;
    const gidMatch = excelUrl.match(/[?&#]gid=([^&#]+)/i);
    const gid = gidMatch?.[1] || "0";
    return buildCsvFromExcelUrl(excelUrl, gid);
  }, [excelUrl, manualCsvUrl, convertExcel]);

  // ── Load saved settings on mount ──
  useEffect(() => {
    async function loadSettings() {
      try {
        const res = await fetch("/api/settings");
        if (!res.ok) return;
        const data = await res.json();
        if (data?.data?.excelUrl)    setExcelUrl(data.data.excelUrl);
        if (data?.data?.convertExcel !== undefined) setConvertExcel(data.data.convertExcel);
        if (!data.data.convertExcel && data?.data?.csvUrl) setManualCsvUrl(data.data.csvUrl);
        if (data?.data?.csvUrl)      setSavedUrl(data.data.csvUrl);
      } catch (err) { console.error("Load settings error:", err); }
    }
    loadSettings();
  }, []);

  // ── Load CSV preview from a URL ──
  async function loadPreview(url) {
    if (!url) return;
    setPreviewLoading(true);
    setPreviewHeaders([]);
    setPreviewRows([]);
    setPreviewSearch("");
    setPreviewPage(1);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch CSV");
      const text = await res.text();
      Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          setPreviewHeaders(results.meta.fields || []);
          setPreviewRows(results.data || []);
          setPreviewLoading(false);
        },
        error: () => setPreviewLoading(false),
      });
    } catch (e) {
      console.error(e);
      setToast({ active: true, message: "Could not load preview: " + e.message, error: true });
      setPreviewLoading(false);
    }
  }

  // ── Save ──
  async function onSave() {
    try {
      setLoading(true);
      if (!excelUrl && !manualCsvUrl) {
        setToast({ active: true, message: "Please enter a valid URL", error: true });
        return;
      }
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ excelUrl, csvUrl: finalCsvUrl, convertExcel }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.message || "Save failed");
      setSavedUrl(finalCsvUrl);
      setToast({ active: true, message: "Settings saved successfully", error: false });
    } catch (error) {
      setToast({ active: true, message: error.message || "Something went wrong", error: true });
    } finally {
      setLoading(false);
    }
  }

  // ── Filtered + paginated preview rows ──
  const filteredRows = previewRows.filter((row) =>
    Object.values(row).some((v) =>
      String(v || "").toLowerCase().includes(previewSearch.toLowerCase())
    )
  );
  const totalPages    = Math.max(1, Math.ceil(filteredRows.length / ITEMS_PER_PAGE));
  const paginatedRows = filteredRows.slice(
    (previewPage - 1) * ITEMS_PER_PAGE,
    previewPage * ITEMS_PER_PAGE
  );

  return (
    <Frame>
      {toast.active && (
        <Toast
          content={toast.message}
          error={toast.error}
          onDismiss={() => setToast((prev) => ({ ...prev, active: false }))}
        />
      )}

      <Page>
        <TitleBar title="Settings" />
        <Layout>
          <Layout.Section>

            {/* ── Feed Settings Form ── */}
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Feed Settings</Text>

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

                <Button variant="primary" onClick={onSave} loading={loading}>
                  Save Settings
                </Button>
              </BlockStack>
            </Card>

            {/* ── Saved URL Card ── */}
            {savedUrl && (
              <div style={{ marginTop: 16 }}>
                <Card>
                  <BlockStack gap="300">
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                      <Text as="h2" variant="headingMd">Saved CSV URL</Text>
                      <Badge tone="success">Active</Badge>
                    </div>

                    <div style={{
                      background: "#f6f6f7", borderRadius: 8,
                      padding: "10px 14px", wordBreak: "break-all",
                      fontSize: 13, color: "#303030", border: "1px solid #e1e3e5",
                    }}>
                      {savedUrl}
                    </div>

                    <div style={{ display: "flex", gap: 8 }}>
                      <Button
                        onClick={() => loadPreview(savedUrl)}
                        loading={previewLoading}
                        disabled={previewLoading}
                      >
                        {previewRows.length > 0 ? "Reload Preview" : "Preview Data"}
                      </Button>

                      {previewRows.length > 0 && (
                        <Button
                          tone="critical"
                          variant="plain"
                          onClick={() => { setPreviewHeaders([]); setPreviewRows([]); setPreviewSearch(""); }}
                        >
                          Clear Preview
                        </Button>
                      )}
                    </div>

                    {/* summary badges */}
                    {previewRows.length > 0 && (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <Badge>{previewRows.length} Rows</Badge>
                        <Badge tone="info">{previewHeaders.length} Columns</Badge>
                        {previewHeaders.map((h) => (
                          <Badge key={h} tone="attention">{h}</Badge>
                        ))}
                      </div>
                    )}
                  </BlockStack>
                </Card>
              </div>
            )}

            {/* ── Preview Loader ── */}
            {previewLoading && (
              <div style={{ marginTop: 16 }}>
                <Card>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 32, gap: 12 }}>
                    <Spinner size="small" />
                    <Text color="subdued">Loading CSV preview…</Text>
                  </div>
                </Card>
              </div>
            )}

            {/* ── Preview Table ── */}
            {!previewLoading && previewRows.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <Card>
                  <BlockStack gap="400">
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                      <Text as="h2" variant="headingMd">CSV Preview</Text>
                      <Text tone="subdued" variant="bodySm">
                        Showing{" "}
                        {filteredRows.length === 0 ? 0 : (previewPage - 1) * ITEMS_PER_PAGE + 1}
                        {" – "}
                        {Math.min(previewPage * ITEMS_PER_PAGE, filteredRows.length)}
                        {" of "}
                        {filteredRows.length}
                        {previewSearch && ` (filtered from ${previewRows.length})`}
                      </Text>
                    </div>

                    <TextField
                      label=""
                      labelHidden
                      value={previewSearch}
                      onChange={(v) => { setPreviewSearch(v); setPreviewPage(1); }}
                      placeholder="Search by any column…"
                      autoComplete="off"
                      clearButton
                      onClearButtonClick={() => { setPreviewSearch(""); setPreviewPage(1); }}
                    />

                    <IndexTable
                      resourceName={{ singular: "row", plural: "rows" }}
                      itemCount={paginatedRows.length}
                      selectable={false}
                      headings={previewHeaders.map((h) => ({ title: h }))}
                    >
                      {paginatedRows.map((row, i) => (
                        <IndexTable.Row
                          id={`${previewPage}-${i}`}
                          key={`${previewPage}-${i}`}
                          position={i}
                        >
                          {previewHeaders.map((h) => (
                            <IndexTable.Cell key={h}>{row[h] ?? ""}</IndexTable.Cell>
                          ))}
                        </IndexTable.Row>
                      ))}
                    </IndexTable>

                    {/* Pagination */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Button
                        disabled={previewPage === 1}
                        onClick={() => setPreviewPage((p) => p - 1)}
                      >
                        Previous
                      </Button>
                      <Text tone="subdued" variant="bodySm">
                        Page {previewPage} of {totalPages}
                      </Text>
                      <Button
                        disabled={previewPage === totalPages}
                        onClick={() => setPreviewPage((p) => p + 1)}
                      >
                        Next
                      </Button>
                    </div>

                  </BlockStack>
                </Card>
              </div>
            )}

          </Layout.Section>
        </Layout>
      </Page>
    </Frame>
  );
}