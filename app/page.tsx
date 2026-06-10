import Dashboard from '@/components/Dashboard';
import { getDashboard, type DashboardData } from '@/lib/stats';

export const dynamic = 'force-dynamic';

export default async function Page() {
  let initial: DashboardData | null = null;
  let error: string | null = null;
  try {
    initial = await getDashboard();
  } catch (e) {
    error = (e as Error).message;
  }
  return <Dashboard initial={initial} initialError={error} />;
}
