import { LoginGate } from './ui/components/login-gate';
import { MainLayout } from './ui/layouts/main-layout';

export function App() {
  return (
    <LoginGate>
      <MainLayout />
    </LoginGate>
  );
}
