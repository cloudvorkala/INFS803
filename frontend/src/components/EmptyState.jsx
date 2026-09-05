import styles from './EmptyState.module.css';

export default function EmptyState({ title, message, children }) {
  return (
    <div className={styles.wrap}>
      <h2 className={styles.title}>{title}</h2>
      {message && <p className={styles.message}>{message}</p>}
      {children}
    </div>
  );
}
