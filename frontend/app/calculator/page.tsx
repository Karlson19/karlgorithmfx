'use client';
import DashboardLayout from '@/components/layout/DashboardLayout';
import RiskCalculator from '@/components/calculator/RiskCalculator';
import LotSizeResult from '@/components/calculator/LotSizeResult';

export default function CalculatorPage() {
  return (
    <DashboardLayout>
      <div className="mb-6">
        <h1 className="text-white text-2xl font-bold">Risk Calculator</h1>
        <p className="text-text-secondary text-sm">Manage your position sizing and risk</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RiskCalculator />
        <LotSizeResult />
      </div>
    </DashboardLayout>
  );
}
