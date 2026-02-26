/**
 * Skeleton placeholder that matches the grouped-settings profile layout.
 * Shows shimmer animations for avatar, name, and several settings groups.
 */
export function ProfileSkeleton() {
  return (
    <div className="min-h-screen pb-24 bg-gray-50 dark:bg-gray-900 animate-pulse">
      <div className="container mx-auto px-4 py-6">
        {/* Page header skeleton */}
        <div className="mb-6">
          <div className="h-7 w-24 bg-gray-200 dark:bg-gray-700 rounded mb-1" />
          <div className="h-4 w-40 bg-gray-200 dark:bg-gray-700 rounded" />
        </div>

        {/* Profile header skeleton */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 mb-5">
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 bg-gray-200 dark:bg-gray-700 rounded-full shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-5 w-40 bg-gray-200 dark:bg-gray-700 rounded" />
              <div className="h-4 w-52 bg-gray-200 dark:bg-gray-700 rounded" />
            </div>
          </div>
        </div>

        {/* Settings groups skeleton (3 groups) */}
        {[4, 2, 1].map((rowCount, gi) => (
          <div key={gi} className="mb-5">
            <div className="h-3 w-20 bg-gray-200 dark:bg-gray-700 rounded mb-1.5 ml-1" />
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden divide-y divide-gray-100 dark:divide-gray-700">
              {[...Array(rowCount)].map((_, ri) => (
                <div key={ri} className="flex items-center gap-3 px-4 py-3.5">
                  <div className="w-9 h-9 bg-gray-200 dark:bg-gray-700 rounded-full shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-4 w-28 bg-gray-200 dark:bg-gray-700 rounded" />
                    <div className="h-3 w-40 bg-gray-200 dark:bg-gray-700 rounded" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
