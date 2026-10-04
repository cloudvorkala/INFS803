/* ---------------------------------------------------------------------------
   Admin — the four privileged routes in one screen:
     POST   /products          create
     PUT    /products/:id      update
     DELETE /products/:id      delete
     POST   /upload_file       cover image -> S3, returns the object URL

   Every one of these is rejected server-side unless the caller's ID token
   carries "admins" in its `cognito:groups` claim. The UI hiding is cosmetic.
   --------------------------------------------------------------------------- */

import { useEffect, useRef, useState } from 'react';
import * as api from '../services/apiClient.js';
import { USE_MOCK_API } from '../services/config.js';
import { resetMockDb } from '../services/mockApi.js';
import Loading from '../components/Loading.jsx';
import BookCover from '../components/BookCover.jsx';
import shared from './pages.module.css';
import styles from './Admin.module.css';

const CATEGORIES = ['Fiction', 'Mystery', 'Poetry', 'History', 'Science', 'Technology'];

const BLANK = {
  title: '',
  author: '',
  category: 'Fiction',
  price: '',
  stock: '',
  isbn: '',
  publishedYear: new Date().getFullYear(),
  description: '',
  coverUrl: null,
};

/* S3 has no practical limit here, but browsers choke on huge data URLs and
   API Gateway caps a request body at 10 MB. Matches the backend's 3 MiB
   limit (backend/models/uploads.py). Keep the client honest. */
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

export default function Admin() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(BLANK);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirmingId, setConfirmingId] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const fileInput = useRef(null);
  const formRef = useRef(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.listProducts();
      setProducts(data.products ?? []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: load() sets loading before its request settles, per https://react.dev/learn/synchronizing-with-effects#fetching-data
    load();
  }, []);

  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  const resetForm = () => {
    setForm(BLANK);
    setEditingId(null);
    if (fileInput.current) fileInput.current.value = '';
  };

  const startEdit = (product) => {
    setForm({
      title: product.title,
      author: product.author,
      category: product.category,
      price: String(product.price),
      stock: String(product.stock),
      isbn: product.isbn ?? '',
      publishedYear: product.publishedYear ?? new Date().getFullYear(),
      description: product.description ?? '',
      coverUrl: product.coverUrl ?? null,
    });
    setEditingId(product.id);
    setError('');
    setNotice('');
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  /** POST /upload_file — read the file, send it, store the returned URL. */
  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_UPLOAD_BYTES) {
      setError('That image is larger than 3 MiB. Please pick a smaller one.');
      e.target.value = '';
      return;
    }

    setUploading(true);
    setError('');
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Could not read that file.'));
        reader.readAsDataURL(file);
      });

      const result = await api.uploadFile(file.name, dataUrl);
      setForm((prev) => ({ ...prev, coverUrl: result.url }));
      setNotice(`Cover uploaded${result.s3Key ? ` to ${result.s3Key}` : ''}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');

    const payload = {
      ...form,
      price: Number(form.price),
      stock: Number(form.stock || 0),
      publishedYear: Number(form.publishedYear),
    };

    try {
      if (editingId) {
        await api.updateProduct(editingId, payload);
        setNotice(`Updated “${payload.title}”.`);
      } else {
        await api.createProduct(payload);
        setNotice(`Added “${payload.title}” to the catalogue.`);
      }
      resetForm();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (product) => {
    setError('');
    setNotice('');
    try {
      await api.deleteProduct(product.id);
      setNotice(`Removed “${product.title}”.`);
      setConfirmingId(null);
      if (editingId === product.id) resetForm();
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleResetDemo = async () => {
    resetMockDb();
    resetForm();
    setNotice('Mock database reset to seed data.');
    await load();
  };

  return (
    <div className="page">
      <div className={shared.pageHead}>
        <div>
          <h1>Catalogue admin</h1>
          <p>Create, update, and remove titles. All four routes require an admin token.</p>
        </div>
        {USE_MOCK_API && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={handleResetDemo}>
            Reset demo data
          </button>
        )}
      </div>

      {error && <div className="alert alert--error">{error}</div>}
      {notice && <div className="alert alert--success">{notice}</div>}

      <div className={styles.layout}>
        <form ref={formRef} className={shared.formCard} onSubmit={handleSubmit}>
          <h2>{editingId ? 'Edit title' : 'Add a title'}</h2>
          {editingId && (
            <p className={styles.editingId}>
              Editing <code>{editingId}</code>
            </p>
          )}

          <div className="field">
            <label htmlFor="title">Title</label>
            <input id="title" value={form.title} onChange={update('title')} required />
          </div>

          <div className="field">
            <label htmlFor="author">Author</label>
            <input id="author" value={form.author} onChange={update('author')} required />
          </div>

          <div className={styles.pair}>
            <div className="field">
              <label htmlFor="category">Category</label>
              <select id="category" value={form.category} onChange={update('category')}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="year">Year</label>
              <input
                id="year"
                type="number"
                min="1400"
                max="2100"
                value={form.publishedYear}
                onChange={update('publishedYear')}
              />
            </div>
          </div>

          <div className={styles.pair}>
            <div className="field">
              <label htmlFor="price">Price (NZD)</label>
              <input
                id="price"
                type="number"
                step="0.01"
                min="0"
                value={form.price}
                onChange={update('price')}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="stock">Stock</label>
              <input
                id="stock"
                type="number"
                min="0"
                value={form.stock}
                onChange={update('stock')}
                required
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="isbn">ISBN</label>
            <input id="isbn" value={form.isbn} onChange={update('isbn')} />
          </div>

          <div className="field">
            <label htmlFor="description">Description</label>
            <textarea
              id="description"
              rows="4"
              value={form.description}
              onChange={update('description')}
            />
          </div>

          <div className="field">
            <label htmlFor="cover">Cover image</label>
            <input
              id="cover"
              type="file"
              accept="image/*"
              ref={fileInput}
              onChange={handleUpload}
              disabled={uploading}
            />
            <p className={shared.hint}>
              Uploaded via <code>POST /upload_file</code> — the API stores the object in S3 and
              returns its URL. Max 3 MiB.
            </p>
            {uploading && <Loading label="Uploading…" inline />}
            {form.coverUrl && (
              <div className={styles.coverPreview}>
                <img src={form.coverUrl} alt="Uploaded cover preview" />
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => setForm({ ...form, coverUrl: null })}
                >
                  Remove
                </button>
              </div>
            )}
          </div>

          <div className={styles.formActions}>
            <button type="submit" className="btn" disabled={saving || uploading}>
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add to catalogue'}
            </button>
            {editingId && (
              <button type="button" className="btn btn--ghost" onClick={resetForm}>
                Cancel
              </button>
            )}
          </div>
        </form>

        <section>
          <h2 className={styles.listHeading}>
            Catalogue <span className="muted">({products.length})</span>
          </h2>

          {loading ? (
            <Loading label="Loading products…" />
          ) : (
            <div className={shared.tableWrap}>
              <table className={shared.table}>
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Category</th>
                    <th className={shared.num}>Price</th>
                    <th className={shared.num}>Stock</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {products.map((product) => (
                    <tr key={product.id}>
                      <td>
                        <div className={styles.titleCell}>
                          <div className={styles.thumb}>
                            <BookCover
                              title={product.title}
                              coverUrl={product.coverUrl}
                              size="xs"
                            />
                          </div>
                          <div>
                            <span className={styles.rowTitle}>{product.title}</span>
                            <span className={styles.rowAuthor}>{product.author}</span>
                          </div>
                        </div>
                      </td>
                      <td>{product.category}</td>
                      <td className={shared.num}>${product.price.toFixed(2)}</td>
                      <td className={shared.num}>
                        <span className={product.stock === 0 ? styles.zeroStock : undefined}>
                          {product.stock}
                        </span>
                      </td>
                      <td className={shared.num}>
                        {confirmingId === product.id ? (
                          <div className={styles.confirmRow}>
                            <span className={styles.confirmText}>Delete?</span>
                            <button
                              type="button"
                              className="btn btn--danger btn--sm"
                              onClick={() => handleDelete(product)}
                            >
                              Yes
                            </button>
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              onClick={() => setConfirmingId(null)}
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <div className={styles.confirmRow}>
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              onClick={() => startEdit(product)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn btn--danger btn--sm"
                              onClick={() => setConfirmingId(product.id)}
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
