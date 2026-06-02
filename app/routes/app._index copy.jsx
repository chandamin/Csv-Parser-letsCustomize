import { useCallback, useState } from "react";
import {
  Page,
  Card,
  BlockStack,
  Button,
  DropZone,
  TextField,
  Text,
  IndexTable,
  Frame,
  Toast,
} from "@shopify/polaris";
import Papa from "papaparse";

export default function Index() {
  const [csvUrl, setCsvUrl] = useState("");
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [showPreview, setShowPreview] = useState(false);

  const [searchValue, setSearchValue] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const [toast, setToast] = useState({
    active: false,
    message: "",
    error: false,
  });

  const ITEMS_PER_PAGE = 50;

  const parseCsv = (csvText) => {
    Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        setHeaders(results.meta.fields || []);
        setRows(results.data || []);
        setShowPreview(false);
        setCurrentPage(1);
        setSearchValue("");
      },
      error: (error) => {
        console.error("CSV Parse Error:", error);
      },
    });
  };

  const handleFileUpload = async (_dropFiles, acceptedFiles) => {
    const file = acceptedFiles?.[0];

    if (!file) return;

    try {
      const text = await file.text();
      parseCsv(text);
    } catch (error) {
      console.error(error);
    }
  };

  const loadCsvFromUrl = async () => {
    if (!csvUrl.trim()) {
      alert("Please enter a CSV URL");
      return;
    }

    try {
      const response = await fetch(csvUrl);

      if (!response.ok) {
        throw new Error(`Failed to load CSV`);
      }

      const csvText = await response.text();

      if (!csvText) {
        throw new Error("CSV file empty");
      }

      parseCsv(csvText);
    } catch (error) {
      console.error(error);

      alert(
        `Unable to load CSV.

Possible reasons:
- CORS restriction
- Invalid URL
- Private file
- URL is not a CSV file`
      );
    }
  };

  const filteredRows = rows.filter((row) =>
    Object.values(row).some((value) =>
      String(value || "")
        .toLowerCase()
        .includes(searchValue.toLowerCase())
    )
  );

  const totalPages = Math.max(
    1,
    Math.ceil(filteredRows.length / ITEMS_PER_PAGE)
  );

  const paginatedRows = filteredRows.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const onUpdatePrices = useCallback(async () => {
    try {
      const skuHeader =
        headers.find(
          (h) => String(h).trim().toLowerCase() === "product sku"
        ) || "product sku";

      const priceHeader =
        headers.find(
          (h) =>
            String(h).trim().toLowerCase() ===
            "recommended price"
        ) || "recommended price";

      const response = await fetch("/api/update-prices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          skuHeader,
          priceHeader,
          rows,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setToast({
          active: true,
          message: data?.error || "Update failed",
          error: true,
        });
        return;
      }

      setToast({
        active: true,
        message: `Updated ${data.updatedCount} | Failed ${data.failedCount} | Total ${data.totalCount}`,
        error: data.failedCount > 0,
      });

      console.log("API RESPONSE", data);
      console.log("DETAILS", data.details);
    } catch (error) {
      console.error(error);

      setToast({
        active: true,
        message: "Request failed",
        error: true,
      });
    }
  }, [headers, rows]);

  const toastMarkup = toast.active ? (
    <Toast
      content={toast.message}
      error={toast.error}
      onDismiss={() =>
        setToast((prev) => ({
          ...prev,
          active: false,
        }))
      }
    />
  ) : null;

  return (
    <Frame>
      {toastMarkup}

      <Page title="CSV Import Tool">
        <BlockStack gap="400">

          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                Upload CSV File
              </Text>

              <DropZone
                accept=".csv"
                onDrop={handleFileUpload}
              >
                <DropZone.FileUpload />
              </DropZone>

              <Text variant="headingMd" as="h2">
                Or Load CSV From URL
              </Text>

              <TextField
                label="CSV URL"
                value={csvUrl}
                onChange={setCsvUrl}
                autoComplete="off"
                placeholder="https://example.com/products.csv"
              />

              <Button
                variant="primary"
                onClick={loadCsvFromUrl}
              >
                Load CSV
              </Button>
            </BlockStack>
          </Card>

          {rows.length > 0 && (
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h3">
                  CSV Loaded Successfully
                </Text>

                <Text>Total Columns: {headers.length}</Text>
                <Text>Total Rows: {rows.length}</Text>

                <Button
                  onClick={() =>
                    setShowPreview(!showPreview)
                  }
                >
                  {showPreview
                    ? "Hide Preview"
                    : "Preview Data"}
                </Button>

                {showPreview && (
                  <Button
                    variant="primary"
                    onClick={onUpdatePrices}
                  >
                    Update prices in Shopify
                  </Button>
                )}
              </BlockStack>
            </Card>
          )}

          {headers.length > 0 && (
            <Card>
              <BlockStack gap="200">
                <Text variant="headingMd" as="h3">
                  CSV Headers
                </Text>

                {headers.map((header) => (
                  <Text key={header}>{header}</Text>
                ))}
              </BlockStack>
            </Card>
          )}

          {showPreview && rows.length > 0 && (
            <Card>
              <BlockStack gap="400">

                <Text variant="headingMd" as="h3">
                  CSV Preview
                </Text>

                <TextField
                  label="Search"
                  value={searchValue}
                  onChange={(value) => {
                    setSearchValue(value);
                    setCurrentPage(1);
                  }}
                  autoComplete="off"
                  placeholder="Search SKU..."
                />

                <Text>
                  Showing{" "}
                  {filteredRows.length === 0
                    ? 0
                    : (currentPage - 1) *
                        ITEMS_PER_PAGE +
                      1}
                  {" - "}
                  {Math.min(
                    currentPage * ITEMS_PER_PAGE,
                    filteredRows.length
                  )}
                  {" of "}
                  {filteredRows.length}
                </Text>

                <IndexTable
                  resourceName={{
                    singular: "row",
                    plural: "rows",
                  }}
                  itemCount={paginatedRows.length}
                  selectable={false}
                  headings={headers.map((header) => ({
                    title: header,
                  }))}
                >
                  {paginatedRows.map((row, index) => (
                    <IndexTable.Row
                      id={`${currentPage}-${index}`}
                      key={`${currentPage}-${index}`}
                      position={index}
                    >
                      {headers.map((header) => (
                        <IndexTable.Cell key={header}>
                          {row[header] ?? ""}
                        </IndexTable.Cell>
                      ))}
                    </IndexTable.Row>
                  ))}
                </IndexTable>

                <div
                  style={{
                    display: "flex",
                    justifyContent:
                      "space-between",
                    alignItems: "center",
                  }}
                >
                  <Button
                    disabled={currentPage === 1}
                    onClick={() =>
                      setCurrentPage((p) => p - 1)
                    }
                  >
                    Previous
                  </Button>

                  <Text>
                    Page {currentPage} of {totalPages}
                  </Text>

                  <Button
                    disabled={
                      currentPage === totalPages
                    }
                    onClick={() =>
                      setCurrentPage((p) => p + 1)
                    }
                  >
                    Next
                  </Button>
                </div>

              </BlockStack>
            </Card>
          )}

        </BlockStack>
      </Page>
    </Frame>
  );
}