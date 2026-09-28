import { useEffect } from 'react';
import { matchPath, useLocation } from 'react-router-dom';

const TITLES = [
  ['/login', 'Sign In'],
  ['/register', 'Create Account'],
  ['/plans', 'Test Plans'],
  ['/targets', 'Verified Targets'],
  ['/history', 'Run History'],
  ['/compare', 'Compare Runs'],
  ['/runs/:runId/live', 'Live Run'],
  ['/runs/:runId', 'Run Details'],
  ['/', 'Overview'],
];

export function RouteTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    const title = TITLES.find(([pattern]) =>
      matchPath({ path: pattern, end: true }, pathname),
    )?.[1];
    document.title = `LoadLab · ${title ?? 'Not Found'}`;
  }, [pathname]);
  return null;
}
