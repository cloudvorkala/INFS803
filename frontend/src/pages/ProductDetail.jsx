/* Product detail — GET /products/:id, then POST /cart */

import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import * as api from '../services/apiClient.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useCart } from '../context/CartContext.jsx';
import BookCover from '../components/BookCover.jsx';
import Loading from '../components/Loading.jsx';
import ProductCard from '../components/ProductCard.jsx';
import styles from './ProductDetail.module.css';

export default function ProductDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { addItem } = useCart();

  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [adding, setAdding] = useState(false);
  const [alsoBy, setAlsoBy] = useState([]);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount/id-change: setLoading/setError/setQuantity reset before the request settles, per https://react.dev/learn/synchronizing-with-effects#fetching-data
    setLoading(true);
    setError('');

    setQuantity(1);
    setNotice('');
    setAlsoBy([]);
    window.scrollTo({ top: 0 });

    api
      .getProduct(id)
      .then((data) => {
        if (cancelled) return;
        setProduct(data);

        // Same-author shelf, via the documented GET /products?search= —
        // no extra endpoint needed for it.
        return api
          .listProducts({ search: data.author })
          .then((res) => {
            if (!cancelled) {
              setAlsoBy((res.products ?? []).filter((p) => p.id !== data.id).slice(0, 5));
            }
          })
          .catch(() => {
            /* A failed recommendation shelf should never break the page. */
          });
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
  }, [id]);

  const handleAdd = async () => {
    if (!user) {
      // Carry the intent through sign-in so the click is not silently dropped.
      navigate('/login', {
        state: {
          from: `/books/${id}`,
          intent: { productId: product.id, title: product.title, quantity },
        },
      });
      return;
    }
    setAdding(true);
    setError('');
    setNotice('');
    try {
      await addItem(product.id, quantity);
      setNotice(`Added ${quantity} × “${product.title}” to your cart.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  };

  /** Add a book from the same-author shelf without leaving the page. */
  const handleAddRelated = async (related) => {
    if (!user) {
      navigate('/login', {
        state: {
          from: `/books/${id}`,
          intent: { productId: related.id, title: related.title, quantity: 1 },
        },
      });
      return;
    }
    setError('');
    setNotice('');
    try {
      await addItem(related.id, 1);
      setNotice(`Added “${related.title}” to your cart.`);
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) return <Loading label="Loading this title…" />;

  if (error && !product) {
    return (
      <div className="page">
        <div className="alert alert--error">{error}</div>
        <Link to="/" className="btn btn--ghost">
          ← Back to browsing
        </Link>
      </div>
    );
  }

  const outOfStock = product.stock <= 0;

  return (
    <div className="page">
      <Link to="/" className={styles.back}>
        ← Back to browsing
      </Link>

      <div className={styles.layout}>
        <div className={styles.coverCol}>
          <BookCover
            title={product.title}
            author={product.author}
            coverUrl={product.coverUrl}
            size="lg"
          />
        </div>

        <div className={styles.detail}>
          <span className={styles.category}>{product.category}</span>
          <h1>{product.title}</h1>
          <p className={styles.author}>by {product.author}</p>

          <p className={styles.price}>${product.price.toFixed(2)}</p>

          {notice && <div className="alert alert--success">{notice}</div>}
          {error && <div className="alert alert--error">{error}</div>}

          {outOfStock ? (
            <div className="alert alert--info">
              This title is currently out of stock.
            </div>
          ) : (
            <div className={styles.buyRow}>
              <div className={styles.qty}>
                <label htmlFor="qty">Qty</label>
                <select
                  id="qty"
                  value={quantity}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                >
                  {Array.from({ length: Math.min(product.stock, 10) }, (_, i) => i + 1).map(
                    (n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    )
                  )}
                </select>
              </div>
              <button type="button" className="btn" onClick={handleAdd} disabled={adding}>
                {adding ? 'Adding…' : 'Add to cart'}
              </button>
              {product.stock <= 5 && (
                <span className={styles.lowStock}>Only {product.stock} left</span>
              )}
            </div>
          )}

          <p className={styles.description}>{product.description}</p>

          <dl className={styles.meta}>
            <div>
              <dt>ISBN</dt>
              <dd>{product.isbn || '—'}</dd>
            </div>
            <div>
              <dt>Published</dt>
              <dd>{product.publishedYear || '—'}</dd>
            </div>
            <div>
              <dt>In stock</dt>
              <dd>{product.stock}</dd>
            </div>
            <div>
              <dt>Product ID</dt>
              <dd>
                <code>{product.id}</code>
              </dd>
            </div>
          </dl>
        </div>
      </div>

      {alsoBy.length > 0 && (
        <section className={styles.alsoBy}>
          <h2 className={styles.alsoByHead}>
            More by {product.author}
            <span className={styles.alsoByCount}>
              {alsoBy.length} {alsoBy.length === 1 ? 'other title' : 'other titles'}
            </span>
          </h2>
          <div className={styles.alsoByGrid}>
            {alsoBy.map((p) => (
              <ProductCard key={p.id} product={p} onAdd={handleAddRelated} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
