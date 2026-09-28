import { useAuth } from '../lib/auth';
import { ROLE_LABEL } from '../lib/labels';

export function HomePage() {
  const { user } = useAuth();
  return (
    <div className="card">
      <h1>Welcome, {user?.name}</h1>
      <p className="text-slate-600">Signed in as {user ? ROLE_LABEL[user.role] : ''}.</p>
    </div>
  );
}
