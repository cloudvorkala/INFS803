/* Cart — GET /cart, DELETE /cart/:productId */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useCart } from '../context/CartContext.jsx';
import Loading from '../components/Loading.jsx';
import EmptyState from '../components/EmptyState.jsx';
import QuantityStepper from '../components/QuantityStepper.jsx';
import shared from './pages.module.css';
import styles from './Cart.module.css';

export default function Cart() {
  const { cart, loading, removeItem, setItemQuantity } = useCart();
  const [removingId, setRemovingId] = useState(null);
  const [error, setError] = useState('');

  const handleRemove = async (productId) => {
    setRemovingId(productId);
    setError('');
    try {
      await removeItem(productId);
    } catch (err) {
      setError(err.message);
    } finally {
      setRemovingId(null);
    }
  };

  const handleQuantity = async (productId, quantity) => {
    setError('');
    try {
      await setItemQuantity(productId, quantity);
    } catch (err) {
      setError(err.message);
      throw err; // lets the stepper roll its number back
    }
  };

  if (loading) return <Loading label="Loading your cart…" />;

  return (
    <div className="page">
      <div className={shared.pageHead}>
        <h1>Your cart</h1>
        {cart.itemCount > 0 && (
          <p>
            {cart.itemCount} {cart.itemCount === 1 ? 'item' : 'items'}
          </p>
        )}
      </div>

      {error && <div className="alert alert--error">{error}</div>}

      {cart.items.length === 0 ? (
        <EmptyState
          title="Your cart is empty"
          message="Nothing here yet. Have a browse and add something you'll actually read."
        >
          <Link to="/" className="btn">
            Browse the catalogue
          </Link>
        </EmptyState>
      ) : (
        <div className={styles.layout}>
          <div className={shared.tableWrap}>
            <table className={shared.table}>
              <thead>
                <tr>
                  <th>Title</th>
                  <th className={shared.num}>Price</th>
                  <th style={{ textAlign: 'center' }}>Qty</th>
                  <th className={shared.num}>Subtotal</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {cart.items.map((item) => (
                  <tr key={item.productId}>
                    <td>
                      <Link to={`/books/${item.productId}`} className={styles.itemTitle}>
                        {item.title}
                      </Link>
                      <span className={styles.itemAuthor}>{item.author}</span>
                    </td>
                    <td className={shared.num}>${item.price.toFixed(2)}</td>
                    <td className={styles.qtyCell}>
                      <QuantityStepper
                        value={item.quantity}
                        max={item.stock}
                        label={item.title}
                        disabled={removingId === item.productId}
                        onChange={(q) => handleQuantity(item.productId, q)}
                      />
                      {item.quantity >= item.stock && (
                        <span className={styles.maxNote}>max</span>
                      )}
                    </td>
                    <td className={shared.num}>${item.subtotal.toFixed(2)}</td>
                    <td className={shared.num}>
                      <button
                        type="button"
                        className="btn btn--danger btn--sm"
                        onClick={() => handleRemove(item.productId)}
                        disabled={removingId === item.productId}
                      >
                        {removingId === item.productId ? 'Removing…' : 'Remove'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <aside className={styles.summary}>
            <h2>Summary</h2>
            <div className={styles.row}>
              <span>Items</span>
              <span>{cart.itemCount}</span>
            </div>
            <div className={styles.row}>
              <span>Delivery</span>
              <span className="muted">Calculated at checkout</span>
            </div>
            <div className={`${styles.row} ${styles.total}`}>
              <span>Total</span>
              <span>${cart.total.toFixed(2)}</span>
            </div>
            <Link to="/checkout" className={`btn ${shared.fullWidthBtn}`}>
              Proceed to checkout
            </Link>
            <Link to="/" className={styles.keepShopping}>
              Keep browsing
            </Link>
          </aside>
        </div>
      )}
    </div>
  );
}
