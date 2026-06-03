import { useCallback, useEffect, useRef, useState } from "react";
import {
  Page, Card, BlockStack, Button, DropZone, TextField,
  Text, IndexTable, Frame,
} from "@shopify/polaris";
import Papa from "papaparse";

// ---------- Loader Overlay ----------
function LoaderOverlay({ active, message }) {
  if (!active) return null;
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "rgba(255,255,255,0.72)",
      backdropFilter: "blur(5px)",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 16,
    }}>
      <div style={{
        width: 48, height: 48, borderRadius: "50%",
        border: "4px solid #e4e5e7", borderTopColor: "#008060",
        animation: "csv-spin 0.8s linear infinite",
      }} />
      <span style={{ fontSize: 15, color: "#6d7175", fontWeight: 500 }}>{message}</span>
      <style>{`@keyframes csv-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ---------- Results Modal ----------
function ResultsModal({ data, onClose }) {
  const [tab, setTab] = useState("all");
  if (!data) return null;

  const results = data.results || [];
  const success = results.filter(r => r.success);
  const failed  = results.filter(r => !r.success);
  const filtered = tab === "all" ? results : tab === "success" ? success : failed;

  const tabStyle = (t) => ({
    background: "none", border: "none", cursor: "pointer",
    padding: "10px 16px", fontSize: 13, fontWeight: 500,
    color: tab === t ? "#008060" : "#6d7175",
    borderBottom: `2px solid ${tab === t ? "#008060" : "transparent"}`,
    marginBottom: -1,
  });

  const badgeStyle = (r) => ({
    fontSize: 11, fontWeight: 600, padding: "2px 9px",
    borderRadius: 20, whiteSpace: "nowrap",
    ...(r.success
      ? { background: "#e3f5ee", color: "#008060" }
      : r.reason === "not_found"
        ? { background: "#fff0e5", color: "#c05717" }
        : { background: "#fdf3f0", color: "#d72c0d" }),
  });

  const badgeText = (r) =>
    r.success ? "Updated" : r.reason === "not_found" ? "Not Found" : "Error";

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 10000,
      background: "rgba(0,0,0,0.42)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{
        background: "#fff", borderRadius: 12, width: 620,
        maxWidth: "95vw", maxHeight: "85vh",
        display: "flex", flexDirection: "column",
        boxShadow: "0 20px 60px rgba(0,0,0,0.2)", overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid #e4e5e7", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 17, fontWeight: 700 }}>{data.title || "Results"}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#6d7175", padding: "4px 8px", borderRadius: 6 }}>✕</button>
        </div>

        {/* Summary pills */}
        <div style={{ display: "flex", gap: 12, padding: "14px 24px", borderBottom: "1px solid #e4e5e7", flexWrap: "wrap" }}>
          {[
            { label: `${results.length} Total`,   bg: "#f0f0f0", fg: "#444",    dot: "#888" },
            { label: `${success.length} Updated`, bg: "#e3f5ee", fg: "#008060", dot: "#008060" },
            { label: `${failed.length} Failed`,   bg: "#fdf3f0", fg: "#d72c0d", dot: "#d72c0d" },
          ].map(p => (
            <div key={p.label} style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 13px", borderRadius: 8, background: p.bg, color: p.fg, fontSize: 13, fontWeight: 600 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: p.dot }} />
              {p.label}
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid #e4e5e7", padding: "0 24px" }}>
          {["all", "success", "failed"].map(t => (
            <button key={t} style={tabStyle(t)} onClick={() => setTab(t)}>
              {t === "all" ? "All" : t === "success" ? "Updated" : "Failed"}
            </button>
          ))}
        </div>

        {/* List */}
        <div style={{ overflowY: "auto", flex: 1 }}>
          {filtered.length === 0 ? (
            <div style={{ textAlign: "center", padding: "48px 24px", color: "#8c9196" }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
              <div>No results in this category</div>
            </div>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {filtered.map((r, i) => (
                <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 24px", borderBottom: "1px solid #f0f0f0" }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 12, marginTop: 1,
                    ...(r.success ? { background: "#e3f5ee", color: "#008060" } : { background: "#fdf3f0", color: "#d72c0d" }),
                  }}>
                    {r.success ? "✓" : "✕"}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#202223" }}>{r.sku}</div>
                    <div style={{ fontSize: 12, color: "#6d7175", marginTop: 2 }}>{r.detail}</div>
                  </div>
                  <span style={badgeStyle(r)}>{badgeText(r)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "14px 24px", borderTop: "1px solid #e4e5e7", display: "flex", justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ background: "#008060", color: "#fff", border: "none", padding: "9px 20px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Main Page ----------
export default function Index() {
  const [csvUrl, setCsvUrl]       = useState("");
  const [headers, setHeaders]     = useState([]);
  const [rows, setRows]           = useState([]);
  const [showPreview, setShowPreview] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [savedCsvUrls, setSavedCsvUrls] = useState([]);

  const [loading, setLoading]       = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("Processing…");
  const [results, setResults]       = useState(null);  // modal data

  const ITEMS_PER_PAGE = 50;

  // helpers
  const startLoading = (msg = "Processing…") => { setLoadingMsg(msg); setLoading(true); };
  const stopLoading  = () => setLoading(false);

  useEffect(() => {
    async function loadSettings() {
      try {
        const res = await fetch("/api/settings");
        if (!res.ok) return;
        const data = await res.json();
        if (data?.data?.csvUrl) setSavedCsvUrls([data.data.csvUrl]);
      } catch (err) { console.log("Settings load error:", err); }
    }
    loadSettings();
  }, []);

  const parseCsv = (csvText) => {
    Papa.parse(csvText, {
      header: true, skipEmptyLines: true,
      complete: (res) => {
        setHeaders(res.meta.fields || []);
        setRows(res.data || []);
        setShowPreview(false);
        setCurrentPage(1);
        setSearchValue("");
      },
      error: (err) => console.error("CSV Parse Error:", err),
    });
  };

  const handleFileUpload = async (_drop, acceptedFiles) => {
    const file = acceptedFiles?.[0];
    if (!file) return;
    try { parseCsv(await file.text()); } catch (e) { console.error(e); }
  };

  const loadCsvFromUrl = async () => {
    if (!csvUrl.trim()) { alert("Please enter a CSV URL"); return; }
    startLoading("Loading CSV…");
    try {
      const res = await fetch(csvUrl);
      if (!res.ok) throw new Error("Failed to load CSV");
      const text = await res.text();
      if (!text) throw new Error("CSV file empty");
      parseCsv(text);
    } catch (e) {
      console.error(e);
      alert(`Unable to load CSV.\nPossible reasons:\n- CORS restriction\n- Invalid URL\n- Private file\n- Not a CSV file`);
    } finally { stopLoading(); }
  };

  const runWithResults = async (fetchFn, title) => {
    startLoading("Updating prices…");
    try {
      const res  = await fetchFn();
      const data = await res.json();
      stopLoading();
      // Expect data.results = [{sku, success, detail, reason}]
      setResults({ title, results: data.results || [] });
    } catch (e) {
      stopLoading();
      setResults({ title, results: [{ sku: "–", success: false, detail: "Request failed: " + e.message, reason: "error" }] });
    }
  };

  const onUpdatePrices = useCallback(() => {
    const skuHeader   = headers.find(h => h.trim().toLowerCase() === "product sku")   || "product sku";
    const priceHeader = headers.find(h => h.trim().toLowerCase() === "recommended price") || "recommended price";
    runWithResults(
      () => fetch("/api/update-prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skuHeader, priceHeader, rows }),
      }),
      "Price Update Results"
    );
  }, [headers, rows]);

  const onTestSync = () =>
    runWithResults(
      () => fetch("/api/update-prices-from-saved", { method: "POST" }),
      "CSV Sync Results"
    );

  const filteredRows  = rows.filter(row =>
    Object.values(row).some(v => String(v || "").toLowerCase().includes(searchValue.toLowerCase()))
  );
  const totalPages    = Math.max(1, Math.ceil(filteredRows.length / ITEMS_PER_PAGE));
  const paginatedRows = filteredRows.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  return (
    <Frame>
      <LoaderOverlay active={loading} message={loadingMsg} />
      <ResultsModal data={results} onClose={() => setResults(null)} />

      <Page title="CSV Import Tool">
        <BlockStack gap="400">

          {/* <Button onClick={onTestSync} disabled={loading}>Test CSV Sync</Button> */}

          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Upload CSV File</Text>
              <DropZone accept=".csv" onDrop={handleFileUpload}>
                <DropZone.FileUpload />
              </DropZone>
              <Text variant="headingMd" as="h2">Or Load CSV From URL</Text>
              <TextField label="CSV URL" value={csvUrl} onChange={setCsvUrl} autoComplete="off" placeholder="https://example.com/products.csv" />
              {savedCsvUrls.length > 0 && (
                <Card>
                  <BlockStack gap="200">
                    <Text variant="headingSm" as="h3">Saved CSV Links</Text>
                    {savedCsvUrls.map((url, i) => (
                      <Button key={i} onClick={() => setCsvUrl(url)} disabled={loading}>Use saved CSV</Button>
                    ))}
                  </BlockStack>
                </Card>
              )}
              <Button variant="primary" onClick={loadCsvFromUrl} disabled={loading}>Load CSV</Button>
            </BlockStack>
          </Card>

          {rows.length > 0 && (
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h3">CSV Loaded Successfully</Text>
                <Text>Total Columns: {headers.length}</Text>
                <Text>Total Rows: {rows.length}</Text>
                <Button onClick={() => setShowPreview(!showPreview)} disabled={loading}>
                  {showPreview ? "Hide Preview" : "Preview Data"}
                </Button>
                {showPreview && (
                  <Button variant="primary" onClick={onUpdatePrices} disabled={loading}>
                    Update prices in Shopify
                  </Button>
                )}
              </BlockStack>
            </Card>
          )}

          {headers.length > 0 && (
            <Card>
              <BlockStack gap="200">
                <Text variant="headingMd" as="h3">CSV Headers</Text>
                {headers.map(h => <Text key={h}>{h}</Text>)}
              </BlockStack>
            </Card>
          )}

          {showPreview && rows.length > 0 && (
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h3">CSV Preview</Text>
                <TextField label="Search" value={searchValue} onChange={(v) => { setSearchValue(v); setCurrentPage(1); }} autoComplete="off" placeholder="Search SKU..." />
                <Text>
                  Showing {filteredRows.length === 0 ? 0 : (currentPage - 1) * ITEMS_PER_PAGE + 1}
                  {" – "}
                  {Math.min(currentPage * ITEMS_PER_PAGE, filteredRows.length)} of {filteredRows.length}
                </Text>
                <IndexTable
                  resourceName={{ singular: "row", plural: "rows" }}
                  itemCount={paginatedRows.length}
                  selectable={false}
                  headings={headers.map(h => ({ title: h }))}
                >
                  {paginatedRows.map((row, i) => (
                    <IndexTable.Row id={`${currentPage}-${i}`} key={`${currentPage}-${i}`} position={i}>
                      {headers.map(h => <IndexTable.Cell key={h}>{row[h] ?? ""}</IndexTable.Cell>)}
                    </IndexTable.Row>
                  ))}
                </IndexTable>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <Button disabled={currentPage === 1 || loading} onClick={() => setCurrentPage(p => p - 1)}>Previous</Button>
                  <Text>Page {currentPage} of {totalPages}</Text>
                  <Button disabled={currentPage === totalPages || loading} onClick={() => setCurrentPage(p => p + 1)}>Next</Button>
                </div>
              </BlockStack>
            </Card>
          )}

        </BlockStack>
      </Page>
    </Frame>
  );
}