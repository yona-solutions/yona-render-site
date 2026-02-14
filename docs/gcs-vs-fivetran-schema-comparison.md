# GCS Export vs Fivetran Schema Comparison

Comparison of tables in `raw_netsuite_gcs_export` (GCS CSV import) vs the Fivetran-synced tables.

---

## Row Count Comparison

| Table | GCS Export | Fivetran | Notes |
|-------|-----------|----------|-------|
| Customer | 783 | 568 | GCS has 215 more rows — likely includes duplicates across subsidiaries |
| Transactions | 784,563 | 1,453,018 | Fivetran has ~668K more rows — GCS export may be filtered or date-limited |
| Vendor | 929 | 929 | Exact match |
| Account | 570 | 285 | GCS has 2x rows — likely duplicates across subsidiaries |
| Subsidiary | 13 | N/A | GCS-only table, no Fivetran equivalent |

---

## Schema Differences

### 1. Customer

**GCS**: `raw_netsuite_gcs_export.customer`
**Fivetran**: `netsuite_connector_main.sphere_customer`

| Column | GCS Type | Fivetran Type | Notes |
|--------|----------|---------------|-------|
| internal_id | STRING | INTEGER | Type mismatch |
| company_name | STRING | STRING | Match |
| id | STRING | INTEGER | Type mismatch |
| customer_name | STRING | STRING | Match |
| customer_number | STRING | INTEGER | Type mismatch |
| district | STRING | INTEGER | Type mismatch |
| service_type | STRING | — | **GCS only** |
| last_modified | STRING | TIMESTAMP | Type mismatch |
| start_date_custom | STRING | TIMESTAMP | Type mismatch |
| region_internal_id | STRING | INTEGER | Type mismatch |
| region_name | STRING | STRING | Match |
| subsidiary_internal_id | STRING | INTEGER | Type mismatch |
| customer_entity_id | — | STRING | **Fivetran only** |
| _fivetran_synced | — | TIMESTAMP | **Fivetran only** (metadata) |
| _fivetran_deleted | — | BOOLEAN | **Fivetran only** (metadata) |

**Summary**: GCS has `service_type` that Fivetran doesn't. Fivetran has `customer_entity_id` and metadata columns. All GCS columns are STRING; Fivetran uses typed columns (INTEGER, TIMESTAMP).

---

### 2. Transactions

**GCS**: `raw_netsuite_gcs_export.transactions`
**Fivetran**: `netsuite_connector_main.sphere_transactions`

| Column | GCS Type | Fivetran Type | Notes |
|--------|----------|---------------|-------|
| internal_id | STRING | INTEGER | Type mismatch |
| date | STRING | TIMESTAMP | Type mismatch |
| type | STRING | STRING | Match |
| document_number | STRING | STRING | Match |
| name | STRING | STRING | Match |
| line_unique_key | STRING | INTEGER | Type mismatch |
| amount | STRING | FLOAT | Type mismatch |
| account | STRING | STRING | Match |
| account_name | STRING | STRING | Match |
| account_number | STRING | STRING | Match |
| line_sequence_number | STRING | INTEGER | Type mismatch |
| transaction_number | STRING | STRING | Match |
| posting_period | STRING | STRING | Match |
| subsidiary_heiarchy | STRING | STRING | Match (note: typo "heiarchy" in both) |
| subsidiary | STRING | — | **GCS only** |
| customer_internal_id | STRING | INTEGER | Type mismatch |
| vendor_internal_id | STRING | INTEGER | Type mismatch |
| account_internal_id | STRING | INTEGER | Type mismatch |
| region_internal_id | STRING | INTEGER | Type mismatch |
| last_modified | STRING | TIMESTAMP | Type mismatch |
| region_name | STRING | STRING | Match |
| region_name_test | STRING | — | **GCS only** |
| subsidiary_name_test | STRING | — | **GCS only** |
| posting | STRING | STRING | Match |
| class | — | STRING | **Fivetran only** |
| entity | — | STRING | **Fivetran only** |
| subsidiary_internal_id | — | INTEGER | **Fivetran only** (GCS has `subsidiary` as name instead) |
| _fivetran_synced | — | TIMESTAMP | **Fivetran only** (metadata) |
| _fivetran_deleted | — | BOOLEAN | **Fivetran only** (metadata) |
| id | — | INTEGER | **Fivetran only** |

**Summary**: GCS has 3 extra columns (`subsidiary`, `region_name_test`, `subsidiary_name_test`). Fivetran has `class`, `entity`, `subsidiary_internal_id`, and metadata columns. GCS uses `subsidiary` (name string) where Fivetran uses `subsidiary_internal_id` (integer).

---

### 3. Vendor

**GCS**: `raw_netsuite_gcs_export.vendor`
**Fivetran**: `netsuite_connector_main.sphere_vendors`

| Column | GCS Type | Fivetran Type | Notes |
|--------|----------|---------------|-------|
| internal_id | STRING | INTEGER | Type mismatch |
| vendor_name | STRING | STRING | Match |
| last_modified | STRING | TIMESTAMP | Type mismatch |
| _fivetran_synced | — | TIMESTAMP | **Fivetran only** (metadata) |
| _fivetran_deleted | — | BOOLEAN | **Fivetran only** (metadata) |
| id | — | INTEGER | **Fivetran only** |

**Summary**: Same core columns. Only difference is GCS is all STRING, Fivetran uses typed columns plus metadata.

---

### 4. Account

**GCS**: `raw_netsuite_gcs_export.account`
**Fivetran**: `netsuite_accounts.sphere_accounts`

| Column | GCS Type | Fivetran Type | Notes |
|--------|----------|---------------|-------|
| internal_id | STRING | INTEGER | Type mismatch |
| account_type | STRING | STRING | Match |
| name | STRING | STRING | Match |
| display_name | STRING | STRING | Match |
| account_number | STRING | STRING | Match |
| localized_name | STRING | STRING | Match |
| localized_display_name | STRING | — | **GCS only** |
| localized_number | STRING | STRING | Match |
| description | STRING | STRING | Match |
| balance | STRING | FLOAT | Type mismatch |
| number | — | STRING | **Fivetran only** |
| _fivetran_synced | — | TIMESTAMP | **Fivetran only** (metadata) |
| _fivetran_deleted | — | BOOLEAN | **Fivetran only** (metadata) |
| id | — | INTEGER | **Fivetran only** |

**Summary**: GCS has `localized_display_name` that Fivetran doesn't. Fivetran has `number` that GCS doesn't. GCS has 2x the rows (likely duplicates per subsidiary).

---

### 5. Subsidiary (GCS Only)

**GCS**: `raw_netsuite_gcs_export.subsidiary` — 13 rows

| Column | Type |
|--------|------|
| internal_id | STRING |
| name | STRING |
| local_region_name | STRING |

No Fivetran equivalent table exists.

---

## Key Takeaways

1. **All GCS columns are STRING** — the loader uses all-STRING schema to avoid type conflicts (e.g., `account_number` can be "NS017"). The dbt transformation should handle casting.

2. **Fivetran has metadata columns** (`_fivetran_synced`, `_fivetran_deleted`, `id`) on every table that GCS doesn't have.

3. **Column differences are minor** — a few columns exist in one source but not the other (e.g., GCS has `service_type` on customer, Fivetran has `class`/`entity` on transactions).

4. **Row count differences** — Vendors match exactly. Customers and accounts have more rows in GCS (likely subsidiary-level duplicates). Transactions has significantly more rows in Fivetran (GCS export may be date-filtered).

5. **Subsidiary is GCS-only** — provides a lookup table not available via Fivetran.
