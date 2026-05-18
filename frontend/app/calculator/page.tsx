'use client';
import DashboardLayout from '@/components/layout/DashboardLayout';
import RiskCalculator from '@/components/calculator/RiskCalculator';
import LotSizeResult from '@/components/calculator/LotSizeResult';
import RiskOfRuin from '@/components/calculator/RiskOfRuin';

export default function CalculatorPage() {
  return (
    <DashboardLayout>
      <div className="mb-6">
        <h1 className="text-white text-2xl font-bold">Risk &amp; Position Sizing</h1>
        <p className="text-text-secondary text-sm">
          Pair-aware position sizing, R/R math, and the number that should keep you up at night
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <RiskCalculator />
        <LotSizeResult />
      </div>

      <RiskOfRuin />
    </DashboardLayout>
  );
}
