import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { localAdminAllowed } from '../../../lib/local-admin';
import SourcesDashboard from './SourcesDashboard';
import './sources.css';

export default async function SourcesPage() {
  if (!localAdminAllowed(await headers())) notFound();
  return <SourcesDashboard />;
}
