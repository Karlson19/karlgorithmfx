'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { TrendingUp } from 'lucide-react';

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <TrendingUp className="w-10 h-10 text-accent animate-pulse" />
          <p className="text-text-secondary text-sm">Loading KarlgorithmFX...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return <>{children}</>;
}
