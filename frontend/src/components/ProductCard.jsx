import { Link } from 'react-router-dom';
import BookCover from './BookCover.jsx';
import styles from './ProductCard.module.css';

export default function ProductCard({ product, onAdd, adding, disabled }) {
  const outOfStock = product.stock <= 0;

  return (
    <article className={styles.card}>
      <Link
        to={`/books/${product.id}`}
        className={styles.coverLink}
        tabIndex={-1}
        aria-hidden="true"
      >
        <BookCover
          title={product.title}
          author={product.author}
          coverUrl={product.coverUrl}
          size="sm"
        />
        {outOfStock && <span className={styles.oosFlag}>Out of stock</span>}
      </Link>

      <div className={styles.body}>
        <span className="eyebrow">{product.category}</span>
        <h3 className={styles.title}>
          <Link to={`/books/${product.id}`}>{product.title}</Link>
        </h3>
        <p className={styles.author}>{product.author}</p>

        <div className={styles.footer}>
          <span className={styles.price}>${product.price.toFixed(2)}</span>
          {outOfStock ? (
            <span className={styles.stockOut}>Unavailable</span>
          ) : (
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => onAdd(product)}
              disabled={adding || disabled}
            >
              {adding ? 'Adding…' : 'Add'}
            </button>
          )}
        </div>

        {!outOfStock && product.stock <= 5 && (
          <p className={styles.lowStock}>Only {product.stock} left</p>
        )}
      </div>
    </article>
  );
}
