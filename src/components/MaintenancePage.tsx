import { Wrench, RefreshCw } from 'lucide-react';

interface MaintenancePageProps {
  canteenName?: string;
  onRefresh?: () => void;
}

export function MaintenancePage({ canteenName = 'School Canteen', onRefresh }: MaintenancePageProps) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
        <div className="w-20 h-20 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <Wrench className="w-10 h-10 text-amber-600" />
        </div>
        
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          Under Maintenance
        </h1>
        
        <p className="text-gray-600 mb-6">
          {canteenName} is currently undergoing scheduled maintenance. 
          We'll be back shortly!
        </p>
        
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
          <p className="text-sm text-amber-800">
            We apologize for any inconvenience. Please check back later or contact 
            the school office if you need immediate assistance.
          </p>
        </div>
        
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="inline-flex items-center gap-2 px-6 py-3 bg-primary-600 text-white rounded-xl font-medium hover:bg-primary-700 transition-colors"
          >
            <RefreshCw size={18} />
            Check Again
          </button>
        )}
      </div>
    </div>
  );
}
