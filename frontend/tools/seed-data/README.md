# Seed data — for the database layer

The 100-book catalogue, exported in three formats so the backend/database layer can
load it without transcribing anything. **Generated** — do not hand-edit. Change
`tools/build-catalogue.mjs` and re-run `npm run catalogue`, which rewrites everything
here plus `src/data/books.json` and the cover images together, so the three stay in
sync.

| File | For |
| ---- | --- |
| `products.json` | A plain array. Easiest for Firebase, MongoDB, or a custom loader script. |
| `products.sql` | `CREATE TABLE` + 100 `INSERT`s for RDS / Postgres / MySQL. Verified: parses and loads 100 rows. |
| `dynamodb-batch-{1..4}.json` | `BatchWriteItem` payloads, 25 items each — DynamoDB's hard per-request limit. |

## Loading into DynamoDB

```bash
aws dynamodb create-table \
  --table-name Products \
  --attribute-definitions AttributeName=id,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region ap-southeast-2

for f in dynamodb-batch-*.json; do
  aws dynamodb batch-write-item --request-items file://$f --region ap-southeast-2
done
```

Note the table name in the payload key is `Products` — rename it in the JSON if your
table is called something else.

## Loading into RDS

```bash
psql "$DATABASE_URL" -f products.sql        # Postgres
mysql -h <host> -u <user> -p <db> < products.sql   # MySQL
```

## About `coverUrl`

Every book has a cover image; `coverUrl` is a site-relative path like
`/covers/bk-001.svg`, and those files ship with the client build.

Once covers live in their own S3 bucket — which is what the assignment brief wants for
assets — rewrite the column to the full object URL:

```sql
UPDATE products
SET cover_url = REPLACE(cover_url, '/covers/', 'https://<bucket>.s3.ap-southeast-2.amazonaws.com/covers/');
```

The client renders whatever string the API returns, so no frontend change is needed.
Products with a null `coverUrl` get a generated placeholder rather than a broken image.

## Fields

| Column | Type | Notes |
| ------ | ---- | ----- |
| `id` | string | `bk-001` … `bk-100`. Primary key. |
| `title` | string | |
| `author` | string | Authors recur — 2–3 titles each. |
| `category` | string | Fiction, Mystery, Poetry, History, Science, Technology, Biography, Art & Design |
| `price` | number | NZD, $16.99–$79.95 |
| `stock` | number | 0–26. Two titles are deliberately at 0 so the out-of-stock path is demonstrable. |
| `isbn` | string | Structurally valid ISBN-13, correct check digit |
| `publishedYear` | number | 2016–2026 |
| `coverUrl` | string \| null | |
| `description` | string | One sentence |
