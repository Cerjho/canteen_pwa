import { ChefHat, Users } from 'lucide-react';
import type { MealPeriod } from '../types';
import { MEAL_PERIOD_LABELS, MEAL_PERIOD_ICONS } from '../types';

interface PrepItem {
  name: string;
  quantity: number;
  image_url: string | null;
  pendingQty: number;
  preparingQty: number;
}

interface GradeMealPrepGroup {
  gradeLevel: string;
  meals: {
    mealPeriod: MealPeriod;
    items: PrepItem[];
    totalItems: number;
  }[];
  totalItems: number;
}

interface StaffKitchenPrepSummaryProps {
  prepByGrade: GradeMealPrepGroup[];
  itemsToPrep: number;
}

export type { PrepItem, GradeMealPrepGroup };

export function StaffKitchenPrepSummary({ prepByGrade, itemsToPrep }: StaffKitchenPrepSummaryProps) {
  if (prepByGrade.length === 0) return null;

  return (
    <details className="mb-4 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 rounded-xl border border-amber-200 dark:border-amber-800 overflow-hidden">
      <summary className="px-4 py-3 cursor-pointer hover:bg-amber-100/50 dark:hover:bg-amber-900/30 transition-colors flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ChefHat size={20} className="text-amber-600 dark:text-amber-400" />
          <span className="font-semibold text-amber-800 dark:text-amber-300">
            Kitchen Prep Summary
          </span>
          <span className="text-xs bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200 px-2 py-0.5 rounded-full">
            {itemsToPrep} items
          </span>
        </div>
        <span className="text-xs text-amber-600 dark:text-amber-400">Click to expand</span>
      </summary>
      <div className="px-4 pb-4 pt-2 space-y-3">
        {prepByGrade.map((gradeGroup) => (
          <div key={gradeGroup.gradeLevel} className="bg-white dark:bg-gray-800 rounded-lg border border-amber-200/50 dark:border-gray-700 overflow-hidden">
            {/* Grade Header */}
            <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-100/50 dark:bg-gray-700/50 border-b border-amber-200/30 dark:border-gray-700">
              <Users size={16} className="text-amber-600 dark:text-amber-400" />
              <span className="font-semibold text-sm text-amber-800 dark:text-amber-300">
                {gradeGroup.gradeLevel}
              </span>
              <span className="text-[10px] bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded">
                {gradeGroup.totalItems} items
              </span>
            </div>

            {/* Meal Period Rows */}
            <div className="divide-y divide-amber-100 dark:divide-gray-700/50">
              {gradeGroup.meals.map((meal) => (
                <div key={`${gradeGroup.gradeLevel}-${meal.mealPeriod}`} className="px-4 py-2.5 flex items-start gap-3">
                  {/* Meal label */}
                  <div className="flex items-center gap-1.5 min-w-[120px] pt-0.5">
                    <span>{MEAL_PERIOD_ICONS[meal.mealPeriod]}</span>
                    <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">
                      {MEAL_PERIOD_LABELS[meal.mealPeriod]}
                    </span>
                  </div>
                  {/* Items inline with chips */}
                  <div className="flex flex-wrap gap-1.5 flex-1">
                    {meal.items.map((item) => (
                      <div 
                        key={item.name}
                        className="inline-flex items-center gap-1.5 bg-gray-50 dark:bg-gray-700 rounded-md px-2.5 py-1 border border-gray-200 dark:border-gray-600"
                      >
                        {item.image_url && (
                          <img 
                            src={item.image_url} 
                            alt={item.name}
                            className="w-5 h-5 rounded object-cover"
                          />
                        )}
                        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{item.name}</span>
                        <span className="text-xs font-bold text-amber-600 dark:text-yellow-400">{item.quantity}</span>
                        {item.preparingQty > 0 && (
                          <span className="text-[9px] px-1 py-0.5 bg-yellow-100 dark:bg-yellow-900/50 text-yellow-700 dark:text-yellow-400 rounded">
                            {item.preparingQty} prep
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}
