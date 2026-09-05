/* Order history — GET /orders */

import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import * as api from '../services/apiClient.js';
import Loading from '../components/Loading.jsx';
import EmptyState from '../components/EmptyState.jsx';
import shared from './pages.module.css';
import styles from './Orders.module.css';

const formatDate = (iso) =>
  new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

export default function Orders() {
  const location = useLocation();
  const justPlaced = location.state?.justPlaced;

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api
      .getOrders()
      .then((data) => {
        if (!cancelled) setOrders(data.orders ?? []);
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
  }, []);

  if (loading) return <Loading label="Loading your orders…" />;

  return (
    <div className="page">
      <div className={shared.pageHead}>
        <h1>Your orders</h1>
      </div>

      {justPlaced && (
        <div className="alert alert--success">
          Order <code>{justPlaced}</code> confirmed. Thanks — it's below.
        </div>
      )}
      {error && <div className="alert alert--error">{error}</div>}

      {orders.length === 0 ? (
        <EmptyState
          title="No orders yet"
          message="Once you place an order it'll show up here with everything you bought."
        >
          <Link to="/" className="btn">
            Browse the catalogue
          </Link>
        </EmptyState>
      ) : (
        <div className={styles.list}>
          {orders.map((order) => (
            <article
              key={order.orderId}
              className={
                order.orderId === justPlaced
                  ? `${styles.order} ${styles.highlight}`
                  : styles.order
              }
            >
              <header className={styles.head}>
                <div>
                  <h2 className={styles.orderId}>{order.orderId}</h2>
                  <p className={styles.placed}>{formatDate(order.placedAt)}</p>
                </div>
                <div className={styles.headRight}>
                  <span className={styles.status}>{order.status}</span>
                  <span className={styles.orderTotal}>${order.total.toFixed(2)}</span>
                </div>
              </header>

              <ul className={styles.items}>
                {order.items.map((item) => (
                  <li key={item.productId}>
                    <Link to={`/books/${item.productId}`} className={styles.itemTitle}>
                      {item.title}
                    </Link>
                    <span className={styles.itemMeta}>
                      {item.author} · {item.quantity} × ${item.price.toFixed(2)}
                    </span>
                    <span className={styles.itemSubtotal}>${item.subtotal.toFixed(2)}</span>
                  </li>
                ))}
              </ul>

              {order.shippingAddress?.line1 && (
                <footer className={styles.shipTo}>
                  Shipping to {order.shippingAddress.fullName}, {order.shippingAddress.line1},{' '}
                  {order.shippingAddress.city} {order.shippingAddress.postcode}
                </footer>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
