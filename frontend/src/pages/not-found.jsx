import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '../components/ui/button';

export function NotFound() {
  return (
    <div className="not-found">
      <p className="eyebrow">404 / PAGE NOT FOUND</p>
      <h1>A little off the test path.</h1>
      <p>This page doesn’t exist. Your workspace is one click away.</p>
      <Button asChild>
        <Link to="/">
          <ArrowLeft />
          Back to overview
        </Link>
      </Button>
    </div>
  );
}
