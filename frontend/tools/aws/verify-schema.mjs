/* ---------------------------------------------------------------------------
   Schema verification — runs the real DynamoDB API against a local engine.

   Creates the three tables from tables/*.json, loads all 100 books, then
   exercises every access pattern the 15 documented routes need, including the
   checkout transaction and its failure path. Nothing here touches AWS, so it is
   free to run and safe to re-run.

     cd tools/aws && npm install && npm run verify

   If this passes, the same calls will work against the real tables. If you
   change tables/*.json, run this before running 01-create-tables.sh.
   --------------------------------------------------------------------------- */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import dynalite from 'dynalite';
import { DynamoDBClient, CreateTableCommand } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  BatchWriteCommand,
  GetCommand,
  QueryCommand,
  ScanCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 4567;
const results = [];
const skipped = [];

/* --remote runs against the real tables in your AWS account instead of the
   local engine. Everything it writes uses ids prefixed "bk-test" / "usr-test",
   but it does modify stock on bk-001, so run it before the marker does. */
const REMOTE = process.argv.includes('--remote');
const REGION = process.env.AWS_REGION || 'ap-southeast-2';

const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const section = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

/* --- Local engine ---------------------------------------------------------- */

let server = null;
if (!REMOTE) {
  server = dynalite({ createTableMs: 0, updateTableMs: 0, deleteTableMs: 0 });
  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log(`\x1b[2mLocal DynamoDB engine on :${PORT} — nothing touches AWS.\x1b[0m`);
} else {
  console.log(`\x1b[33mRunning against REAL AWS tables in ${REGION}.\x1b[0m`);
}

const raw = new DynamoDBClient(
  REMOTE
    ? { region: REGION }
    : {
        endpoint: `http://localhost:${PORT}`,
        region: REGION,
        credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
      }
);
const db = DynamoDBDocumentClient.from(raw, { marshallOptions: { removeUndefinedValues: true } });

const PRODUCTS = 'Paperbound-Products';
const CARTS = 'Paperbound-Carts';
const ORDERS = 'Paperbound-Orders';
const USER = 'usr-test-0001';

try {
  /* --- 1. Create tables from the same JSON the AWS CLI will use ------------- */
  section('Table creation (from tools/aws/tables/*.json)');
  for (const file of readdirSync(join(here, 'tables')).sort()) {
    const def = JSON.parse(readFileSync(join(here, 'tables', file), 'utf8'));
    const gsis = def.GlobalSecondaryIndexes?.length ?? 0;
    if (REMOTE) {
      check(`${def.TableName} — using existing table`, true, gsis ? `${gsis} GSI(s)` : 'no GSIs');
      continue;
    }
    delete def.Tags; // the local engine does not implement tagging
    await raw.send(new CreateTableCommand(def));
    check(`${def.TableName} created`, true, gsis ? `${gsis} GSI(s)` : 'no GSIs');
  }

  /* --- 2. Seed load --------------------------------------------------------- */
  section('Seed load');
  const seedDir = join(here, '..', 'seed-data');
  const batches = readdirSync(seedDir).filter((f) => /^dynamodb-batch-\d+\.json$/.test(f)).sort();
  let loaded = 0;
  for (const file of batches) {
    const payload = JSON.parse(readFileSync(join(seedDir, file), 'utf8'));
    const items = payload[PRODUCTS];
    if (!items) throw new Error(`${file} has no "${PRODUCTS}" key — table name mismatch`);
    // Unmarshalled form for the document client
    const puts = items.map((r) => {
      const i = r.PutRequest.Item;
      return {
        PutRequest: {
          Item: {
            id: i.id.S,
            title: i.title.S,
            author: i.author.S,
            category: i.category.S,
            price: Number(i.price.N),
            stock: Number(i.stock.N),
            isbn: i.isbn.S,
            publishedYear: Number(i.publishedYear.N),
            coverUrl: i.coverUrl.S,
            description: i.description.S,
            searchText: i.searchText.S,
          },
        },
      };
    });
    await db.send(new BatchWriteCommand({ RequestItems: { [PRODUCTS]: puts } }));
    loaded += puts.length;
  }
  check('All seed batches loaded', loaded === 100, `${loaded} items from ${batches.length} files`);
  check('Every batch is within the 25-item limit', batches.length === 4);

  /* --- 3. Read patterns ----------------------------------------------------- */
  section('Access patterns for the documented routes');

  // GET /products/:id
  const one = await db.send(new GetCommand({ TableName: PRODUCTS, Key: { id: 'bk-001' } }));
  check('GET /products/:id — GetItem', one.Item?.title === 'The Salt Path Home', one.Item?.title);

  // GET /products?category= — Query on the GSI, not a Scan
  const poetry = await db.send(
    new QueryCommand({
      TableName: PRODUCTS,
      IndexName: 'category-title-index',
      KeyConditionExpression: 'category = :c',
      ExpressionAttributeValues: { ':c': 'Poetry' },
    })
  );
  check('GET /products?category= — Query on GSI', poetry.Count === 10, `${poetry.Count} items`);
  const titles = poetry.Items.map((i) => i.title);
  check(
    'GSI sort key returns them alphabetically',
    JSON.stringify(titles) === JSON.stringify([...titles].sort()),
    titles[0]
  );

  // Same-author shelf — Query, not a client-side filter
  const byAuthor = await db.send(
    new QueryCommand({
      TableName: PRODUCTS,
      IndexName: 'author-title-index',
      KeyConditionExpression: 'author = :a',
      ExpressionAttributeValues: { ':a': 'Ilse Brandt' },
    })
  );
  check('Same-author shelf — Query on GSI', byAuthor.Count === 3, `${byAuthor.Count} titles`);

  // GET /products?search= — Scan with a filter on the denormalised lowercase field
  const search = await db.send(
    new ScanCommand({
      TableName: PRODUCTS,
      FilterExpression: 'contains(searchText, :q)',
      ExpressionAttributeValues: { ':q': 'raghavan' },
    })
  );
  check('GET /products?search= — case-insensitive match', search.Count === 3, `${search.Count} hits`);

  const byIsbn = await db.send(
    new ScanCommand({
      TableName: PRODUCTS,
      FilterExpression: 'contains(searchText, :q)',
      ExpressionAttributeValues: { ':q': '978-1-2794-8866-9' },
    })
  );
  check('Search also matches ISBN', byIsbn.Count === 1, byIsbn.Items[0]?.title);

  /* --- 4. Admin writes ------------------------------------------------------ */
  section('Admin routes');

  await db.send(
    new PutCommand({
      TableName: PRODUCTS,
      Item: {
        id: 'bk-test', title: 'Test Title', author: 'Test Author', category: 'Fiction',
        price: 9.99, stock: 4, isbn: '978-0-0000-0000-0', publishedYear: 2026,
        coverUrl: null, description: 'x', searchText: 'test title test author',
      },
      ConditionExpression: 'attribute_not_exists(id)',
    })
  );
  check('POST /products — Put with attribute_not_exists guard', true);

  let duplicateRejected = false;
  try {
    await db.send(
      new PutCommand({
        TableName: PRODUCTS,
        Item: { id: 'bk-test', title: 'Dupe' },
        ConditionExpression: 'attribute_not_exists(id)',
      })
    );
  } catch (e) {
    duplicateRejected = e.name === 'ConditionalCheckFailedException';
  }
  check('POST /products — duplicate id is rejected', duplicateRejected);

  const updated = await db.send(
    new UpdateCommand({
      TableName: PRODUCTS,
      Key: { id: 'bk-test' },
      UpdateExpression: 'SET price = :p, stock = :s',
      ExpressionAttributeValues: { ':p': 19.5, ':s': 7 },
      ReturnValues: 'ALL_NEW',
    })
  );
  check('PUT /products/:id — Update', updated.Attributes.price === 19.5 && updated.Attributes.stock === 7);

  await db.send(new DeleteCommand({ TableName: PRODUCTS, Key: { id: 'bk-test' } }));
  const gone = await db.send(new GetCommand({ TableName: PRODUCTS, Key: { id: 'bk-test' } }));
  check('DELETE /products/:id — Delete', !gone.Item);

  /* --- 5. Cart -------------------------------------------------------------- */
  section('Cart routes');

  await db.send(new PutCommand({ TableName: CARTS, Item: { userId: USER, productId: 'bk-001', quantity: 2 } }));
  await db.send(new PutCommand({ TableName: CARTS, Item: { userId: USER, productId: 'bk-017', quantity: 1 } }));
  await db.send(new PutCommand({ TableName: CARTS, Item: { userId: 'someone-else', productId: 'bk-005', quantity: 9 } }));

  const cart = await db.send(
    new QueryCommand({
      TableName: CARTS,
      KeyConditionExpression: 'userId = :u',
      ExpressionAttributeValues: { ':u': USER },
    })
  );
  check('GET /cart — Query by userId', cart.Count === 2, `${cart.Count} lines`);
  check("Another user's cart is not visible", !cart.Items.some((i) => i.productId === 'bk-005'));

  await db.send(new DeleteCommand({ TableName: CARTS, Key: { userId: USER, productId: 'bk-017' } }));
  const afterRemove = await db.send(
    new QueryCommand({
      TableName: CARTS,
      KeyConditionExpression: 'userId = :u',
      ExpressionAttributeValues: { ':u': USER },
    })
  );
  check('DELETE /cart/:productId — Delete', afterRemove.Count === 1);

  /* --- 6. Checkout ---------------------------------------------------------- */
  section('POST /checkout — conditional stock decrement');

  const placedAt = new Date().toISOString();
  const orderId = 'ord-test01';

  /* The guard that matters is the ConditionExpression: stock can never go
     negative, no matter how many checkouts race. Verify it directly first,
     because this part works on any DynamoDB-compatible engine. */

  const before = await db.send(new GetCommand({ TableName: PRODUCTS, Key: { id: 'bk-001' } }));
  const startStock = before.Item.stock;

  await db.send(
    new UpdateCommand({
      TableName: PRODUCTS,
      Key: { id: 'bk-001' },
      UpdateExpression: 'SET stock = stock - :q',
      ConditionExpression: 'stock >= :q',
      ExpressionAttributeValues: { ':q': 2 },
    })
  );
  const afterOk = await db.send(new GetCommand({ TableName: PRODUCTS, Key: { id: 'bk-001' } }));
  check('Conditional decrement succeeds when stock allows', afterOk.Item.stock === startStock - 2,
    `${startStock} → ${afterOk.Item.stock}`);

  let refused = false;
  try {
    await db.send(
      new UpdateCommand({
        TableName: PRODUCTS,
        Key: { id: 'bk-001' },
        UpdateExpression: 'SET stock = stock - :q',
        ConditionExpression: 'stock >= :q',
        ExpressionAttributeValues: { ':q': 9999 },
      })
    );
  } catch (e) {
    refused = e.name === 'ConditionalCheckFailedException';
  }
  check('Over-ordering is refused by the condition', refused);

  const held = await db.send(new GetCommand({ TableName: PRODUCTS, Key: { id: 'bk-001' } }));
  check('Refused decrement left stock untouched', held.Item.stock === afterOk.Item.stock,
    `still ${held.Item.stock}`);
  check('Stock can never go negative', held.Item.stock >= 0);

  /* Now the real thing: the same decrement, the order write, and the cart
     clear as ONE atomic TransactWriteItems. dynalite (the local engine used by
     default) does not implement transactions, so this is reported as skipped
     rather than silently passing. Run with --remote against the real tables to
     exercise it for real — see the note printed at the end. */

  let supportsTransactions = true;
  try {
    await db.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: PRODUCTS,
              Key: { id: 'bk-001' },
              UpdateExpression: 'SET stock = stock - :q',
              ConditionExpression: 'stock >= :q',
              ExpressionAttributeValues: { ':q': 1 },
            },
          },
          {
            Put: {
              TableName: ORDERS,
              Item: {
                userId: USER,
                placedAtOrderId: `${placedAt}#${orderId}`,
                orderId,
                placedAt,
                status: 'CONFIRMED',
                total: 24.99,
                items: [
                  { productId: 'bk-001', title: 'The Salt Path Home', price: 24.99, quantity: 1, subtotal: 24.99 },
                ],
              },
            },
          },
          { Delete: { TableName: CARTS, Key: { userId: USER, productId: 'bk-001' } } },
        ],
      })
    );
  } catch (e) {
    if (e.name === 'UnknownOperationException' || e.name === 'UnknownError') {
      supportsTransactions = false;
    } else {
      throw e;
    }
  }

  if (supportsTransactions) {
    const afterTx = await db.send(new GetCommand({ TableName: PRODUCTS, Key: { id: 'bk-001' } }));
    check('TransactWriteItems decremented stock', afterTx.Item.stock === held.Item.stock - 1);

    const emptied = await db.send(
      new QueryCommand({
        TableName: CARTS,
        KeyConditionExpression: 'userId = :u',
        ExpressionAttributeValues: { ':u': USER },
      })
    );
    check('Cart cleared in the same transaction', emptied.Count === 0);

    let cancelled = false;
    try {
      await db.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: PRODUCTS,
                Key: { id: 'bk-001' },
                UpdateExpression: 'SET stock = stock - :q',
                ConditionExpression: 'stock >= :q',
                ExpressionAttributeValues: { ':q': 9999 },
              },
            },
            {
              Put: {
                TableName: ORDERS,
                Item: {
                  userId: USER,
                  placedAtOrderId: `${placedAt}#ord-shouldnotexist`,
                  orderId: 'ord-shouldnotexist',
                },
              },
            },
          ],
        })
      );
    } catch (e) {
      cancelled = e.name === 'TransactionCanceledException';
    }
    check('Whole transaction cancels when one condition fails', cancelled);

    const orphan = await db.send(
      new GetCommand({ TableName: ORDERS, Key: { userId: USER, placedAtOrderId: `${placedAt}#ord-shouldnotexist` } })
    );
    check('Cancelled transaction wrote no orphan order', !orphan.Item);
  } else {
    skipped.push(
      'TransactWriteItems — the local engine does not implement transactions. ' +
        'The conditional decrement above IS verified; the all-or-nothing grouping is not. ' +
        'Re-run with --remote once the real tables exist.'
    );
    console.log('  \x1b[33mSKIP\x1b[0m  TransactWriteItems — not supported by the local engine');
    // Clear the cart by hand so the orders section starts from a known state.
    await db.send(new DeleteCommand({ TableName: CARTS, Key: { userId: USER, productId: 'bk-001' } }));
  }

  /* --- 7. Orders ------------------------------------------------------------ */
  section('GET /orders');

  for (const [i, id] of ['ord-aaa', 'ord-bbb', 'ord-ccc'].entries()) {
    await db.send(
      new PutCommand({
        TableName: ORDERS,
        Item: {
          userId: USER,
          placedAtOrderId: `2026-09-0${i + 1}T10:00:00.000Z#${id}`,
          orderId: id,
          placedAt: `2026-09-0${i + 1}T10:00:00.000Z`,
          status: 'CONFIRMED',
          total: 10 + i,
        },
      })
    );
  }

  const orders = await db.send(
    new QueryCommand({
      TableName: ORDERS,
      KeyConditionExpression: 'userId = :u',
      ExpressionAttributeValues: { ':u': USER },
      ScanIndexForward: false,
    })
  );
  // 3 written here, plus the one the checkout transaction wrote if it ran.
  const expectedOrders = supportsTransactions ? 4 : 3;
  check(
    'Query by userId returns the order history',
    orders.Count === expectedOrders,
    `${orders.Count} orders`
  );
  const dates = orders.Items.map((o) => o.placedAtOrderId);
  check(
    'Newest first, with no sorting in application code',
    JSON.stringify(dates) === JSON.stringify([...dates].sort().reverse()),
    dates[0]?.slice(0, 10)
  );
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);

if (skipped.length) {
  console.log('\n\x1b[33mNot verified here:\x1b[0m');
  skipped.forEach((s) => console.log(`  · ${s}`));
  console.log(
    '\n  Once the real tables exist:  \x1b[32mnode verify-schema.mjs --remote\x1b[0m' +
      '\n  (needs AWS credentials; writes test data, so run it before submission.)'
  );
}

if (failed.length) {
  console.log('\nFailures:');
  failed.forEach((f) => console.log(`  · ${f.name}`));
}
process.exit(failed.length ? 1 : 0);
