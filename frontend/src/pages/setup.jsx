import { ArrowLeft, Terminal } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';

export function Setup() {
  return (
    <div className="page-content setup-page">
      <Button asChild variant="ghost" className="mb-6">
        <Link to="/">
          <ArrowLeft />
          Back to overview
        </Link>
      </Button>
      <p className="eyebrow">LOCAL DEVELOPMENT</p>
      <h1>Connect your workspace</h1>
      <p className="page-subtitle mb-8">Two services. One place to start.</p>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Terminal size={19} />
            Quick start
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="setup-steps">
            <li>
              <h2>Install dependencies</h2>
              <p>
                Use Node.js 22.16+ on a supported even-numbered release and npm 10+ in the
                repository root.
              </p>
              <pre>
                <code>npm install</code>
              </pre>
            </li>
            <li>
              <h2>Configure your environment</h2>
              <p>
                Copy <code>backend/.env.example</code> to <code>backend/.env</code>, and{' '}
                <code>frontend/.env.example</code> to <code>frontend/.env</code>. Set your Atlas
                connection string as <code>MONGODB_URI</code> in the API file. Keep credentials out
                of frontend variables.
              </p>
            </li>
            <li>
              <h2>Allow the database connection</h2>
              <p>
                Create an Atlas database user with access to the LoadLab database and allow your
                current IP in Atlas Network Access. Use a connection string with a database name,
                and URL-encode special characters in the password.
              </p>
            </li>
            <li>
              <h2>Start the workspace</h2>
              <pre>
                <code>npm run dev</code>
              </pre>
              <p>
                The frontend runs on port 5173 and the API on port 5000 by default. The API starts
                after MongoDB connects. Return to the overview to check both services.
              </p>
            </li>
          </ol>
          <p className="text-sm text-muted-foreground">
            For configuration details, troubleshooting and all commands, see the repository README.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
