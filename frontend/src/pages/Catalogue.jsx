/* ---------------------------------------------------------------------------
   Browse — GET /products with ?category= and ?search=

   Filters live in the URL query string, so a filtered shelf is a shareable link
   and the back button behaves. Search is debounced so typing does not fire a
   request per keystroke.

   Sorting and paging are done client-side over the API's response. With a
   hundred titles that is the right trade: one round trip, instant re-sorts. If
   the catalogue grew past a few hundred, the fix is `?page=` and `?sort=` on
   GET /products rather than more work here.
   --------------------------------------------------------------------------- */

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import * as api from '../services/apiClient.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useCart } from '../context/CartContext.jsx';
import ProductCard from '../components/ProductCard.jsx';
import Loading from '../components/Loading.jsx';
import EmptyState from '../components/EmptyState.jsx';
import styles from './Catalogue.module.css';

const CATEGORIES = [
  'All',
  'Fiction',
  'Mystery',
  'Poetry',
  'History',
  'Science',
  'Technology',
  'Biography',
  'Art & Design',
];

const SORTS = {
  featured: { label: 'Featured', fn: null },
  'price-asc': { label: 'Price: low to high', fn: (a, b) => a.price - b.price },
  'price-desc': { label: 'Price: high to low', fn: (a, b) => b.price - a.price },
  newest: { label: 'Newest first', fn: (a, b) => b.publishedYear - a.publishedYear },
  title: { label: 'Title A–Z', fn: (a, b) => a.title.localeCompare(b.title) },
};

const PER_PAGE = 24;

export default function Catalogue() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { addItem } = useCart();

  const category = params.get('category') || 'All';
  const search = params.get('search') || '';
  const sort = SORTS[params.get('sort')] ? params.get('sort') : 'featured';
  const page = Math.max(1, Number(params.get('page') || 1));

  const [draftSearch, setDraftSearch] = useState(search);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [addingId, setAddingId] = useState(null);
  const [notice, setNotice] = useState('');

  // Adjusted during render rather than in an effect — see
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [syncedSearch, setSyncedSearch] = useState(search);
  if (search !== syncedSearch) {
    setSyncedSearch(search);
    setDraftSearch(search);
  }

  /** Write a set of query params, always resetting to page 1 unless paging. */
  const update = (changes, { keepPage = false } = {}) => {
    const next = new URLSearchParams(params);
    Object.entries(changes).forEach(([key, value]) => {
      if (value == null || value === '' || value === 'All' || value === 'featured') next.delete(key);
      else next.set(key, value);
    });
    if (!keepPage) next.delete('page');
    setParams(next);
  };

  // Debounce the search box by 350ms.
  useEffect(() => {
    if (draftSearch === search) return undefined;
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params);
      if (draftSearch) next.set('search', draftSearch);
      else next.delete('search');
      next.delete('page');
      setParams(next, { replace: true });
    }, 350);
    return () => clearTimeout(timer);
  }, [draftSearch, search, params, setParams]);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-dependency-change: setLoading/setError run before the request settles, per https://react.dev/learn/synchronizing-with-effects#fetching-data
    setLoading(true);
    setError('');

    api
      .listProducts({ category, search })
      .then((data) => {
        if (!cancelled) setProducts(data.products ?? []);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [category, search]);

  const sorted = useMemo(() => {
    const fn = SORTS[sort].fn;
    return fn ? [...products].sort(fn) : products;
  }, [products, sort]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PER_PAGE));
  const safePage = Math.min(page, pageCount);
  const visible = sorted.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  const goToPage = (n) => {
    update({ page: n === 1 ? null : n }, { keepPage: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleAdd = async (product) => {
    if (!user) {
      navigate('/login', { state: { from: '/', intent: { productId: product.id, title: product.title } } });
      return;
    }
    setAddingId(product.id);
    setError('');
    setNotice('');
    try {
      await addItem(product.id, 1);
      setNotice(`Added “${product.title}” to your cart.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setAddingId(null);
    }
  };

  const heading = useMemo(() => {
    if (search) return `Results for “${search}”`;
    if (category !== 'All') return category;
    return 'Everything on the shelves';
  }, [search, category]);

  const filtered = search || category !== 'All';

  return (
    <div className="page">
      <header className={styles.hero}>
        <p className={styles.heroEyebrow}>Established in a cloud region · ap-southeast-2</p>
        <h1 className={styles.heroTitle}>A hundred books, chosen with some care.</h1>
        <p className={styles.heroLede}>
          Fiction, mystery, poetry, history, science, technology, biography and design.
          Browse freely — an account is only needed to buy.
        </p>
      </header>

      <div className={styles.controls}>
        <div className={styles.searchWrap}>
          <svg className={styles.searchIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <label htmlFor="search" className="sr-only">
            Search by title, author, or ISBN
          </label>
          <input
            id="search"
            type="search"
            placeholder="Search by title, author, or ISBN…"
            value={draftSearch}
            onChange={(e) => setDraftSearch(e.target.value)}
          />
        </div>

        <div className={styles.sortWrap}>
          <label htmlFor="sort" className="sr-only">
            Sort by
          </label>
          <select id="sort" value={sort} onChange={(e) => update({ sort: e.target.value })}>
            {Object.entries(SORTS).map(([key, { label }]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className={styles.chips} role="group" aria-label="Filter by category">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            className={c === category ? `${styles.chip} ${styles.chipActive}` : styles.chip}
            onClick={() => update({ category: c })}
            aria-pressed={c === category}
          >
            {c}
          </button>
        ))}
      </div>

      <div className={styles.shelfHead}>
        <h2 className={styles.shelfTitle}>{heading}</h2>
        {!loading && (
          <p className={styles.count}>
            {sorted.length} {sorted.length === 1 ? 'title' : 'titles'}
            {pageCount > 1 && <span className="muted"> · page {safePage} of {pageCount}</span>}
          </p>
        )}
      </div>

      {notice && <div className="alert alert--success">{notice}</div>}
      {error && <div className="alert alert--error">{error}</div>}

      {loading ? (
        <Loading label="Fetching the catalogue…" />
      ) : sorted.length === 0 ? (
        <EmptyState
          title="Nothing on that shelf"
          message="Try a different category, or clear the search and start again."
        >
          <button type="button" className="btn btn--ghost" onClick={() => setParams({})}>
            Clear filters
          </button>
        </EmptyState>
      ) : (
        <>
          <div className={styles.grid}>
            {visible.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                onAdd={handleAdd}
                adding={addingId === product.id}
                disabled={addingId !== null}
              />
            ))}
          </div>

          {pageCount > 1 && (
            <nav className={styles.pager} aria-label="Catalogue pages">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => goToPage(safePage - 1)}
                disabled={safePage === 1}
              >
                ← Previous
              </button>

              <div className={styles.pageNums}>
                {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={n === safePage ? `${styles.pageNum} ${styles.pageNumActive}` : styles.pageNum}
                    onClick={() => goToPage(n)}
                    aria-current={n === safePage ? 'page' : undefined}
                  >
                    {n}
                  </button>
                ))}
              </div>

              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => goToPage(safePage + 1)}
                disabled={safePage === pageCount}
              >
                Next →
              </button>
            </nav>
          )}

          {filtered && (
            <p className={styles.clearRow}>
              <button type="button" className={styles.clearLink} onClick={() => setParams({})}>
                Clear filters and show everything
              </button>
            </p>
          )}
        </>
      )}
    </div>
  );
}
