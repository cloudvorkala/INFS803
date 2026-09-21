import { Link } from 'react-router-dom';
import EmptyState from '../components/EmptyState.jsx';

export default function NotFound() {
  return (
    <div className="page">
      <EmptyState
        title="Page not found"
        message="That link doesn't lead anywhere. It may have been a title we no longer stock."
      >
        <Link to="/" className="btn">
          Back to the catalogue
        </Link>
      </EmptyState>
    </div>
  );
}
