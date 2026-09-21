import styles from './Loading.module.css';

export default function Loading({ label = 'Loading…', inline = false }) {
  return (
    <div className={inline ? styles.inline : styles.block} role="status" aria-live="polite">
      <span className={styles.spinner} aria-hidden="true" />
      <span className={inline ? styles.inlineLabel : styles.label}>{label}</span>
    </div>
  );
}
