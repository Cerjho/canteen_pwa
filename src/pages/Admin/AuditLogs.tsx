import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { 
  History, 
  RefreshCw, 
  Search,
  User,
  Package,
  ShoppingBag,
  Settings,
  Users,
  Eye
} from 'lucide-react';
import { supabase } from '../../services/supabaseClient';
import { PageHeader } from '../../components/PageHeader';
import { LoadingSpinner } from '../../components/LoadingSpinner';

interface AuditLog {
  id: string;
  user_id: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  entity_type: string;
  entity_id: string;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  created_at: string;
}

const ACTION_COLORS = {
  CREATE: 'bg-green-100 text-green-700',
  UPDATE: 'bg-blue-100 text-blue-700',
  DELETE: 'bg-red-100 text-red-700'
};

const ENTITY_ICONS: Record<string, React.ReactNode> = {
  products: <Package size={18} />,
  orders: <ShoppingBag size={18} />,
  parents: <Users size={18} />,
  children: <User size={18} />,
  system_settings: <Settings size={18} />
};

export default function AdminAuditLogs() {
  const [entityFilter, setEntityFilter] = useState<string>('all');
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  // Fetch audit logs
  const { data: logs, isLoading, refetch } = useQuery<AuditLog[]>({
    queryKey: ['audit-logs', entityFilter, actionFilter],
    queryFn: async () => {
      let query = supabase
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (entityFilter !== 'all') {
        query = query.eq('entity_type', entityFilter);
      }
      if (actionFilter !== 'all') {
        query = query.eq('action', actionFilter);
      }

      const { data, error } = await query;
      
      if (error) {
        // Table might not exist yet
        console.log('Audit logs table not found');
        return [];
      }
      return data || [];
    }
  });

  // Filter by search
  const filteredLogs = logs?.filter(log => {
    if (!searchQuery) return true;
    const search = searchQuery.toLowerCase();
    return (
      log.entity_id?.toLowerCase().includes(search) ||
      log.entity_type.toLowerCase().includes(search) ||
      JSON.stringify(log.new_data || {}).toLowerCase().includes(search)
    );
  });

  // Get unique entity types
  const entityTypes = [...new Set(logs?.map(l => l.entity_type) || [])];

  const formatChangeDescription = (log: AuditLog): string => {
    if (log.action === 'CREATE') {
      const name = (log.new_data as any)?.name || (log.new_data as any)?.first_name || log.entity_id?.slice(0, 8);
      return `Created ${log.entity_type.slice(0, -1)} "${name}"`;
    }
    if (log.action === 'DELETE') {
      const name = (log.old_data as any)?.name || (log.old_data as any)?.first_name || log.entity_id?.slice(0, 8);
      return `Deleted ${log.entity_type.slice(0, -1)} "${name}"`;
    }
    if (log.action === 'UPDATE') {
      // Find what changed
      const changes: string[] = [];
      if (log.old_data && log.new_data) {
        Object.keys(log.new_data).forEach(key => {
          if (JSON.stringify(log.old_data![key]) !== JSON.stringify(log.new_data![key])) {
            if (key !== 'updated_at') {
              changes.push(key);
            }
          }
        });
      }
      if (changes.length > 0) {
        return `Updated ${changes.slice(0, 2).join(', ')}${changes.length > 2 ? ` +${changes.length - 2} more` : ''}`;
      }
      return `Updated ${log.entity_type.slice(0, -1)}`;
    }
    return 'Unknown action';
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <div className="container mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <PageHeader
            title="Audit Logs"
            subtitle="Track all system changes"
          />
          <button
            onClick={() => refetch()}
            className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            <RefreshCw size={20} />
          </button>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-6">
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="flex-1 relative">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search logs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div className="flex gap-2">
              <select
                value={entityFilter}
                onChange={(e) => setEntityFilter(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-primary-500"
              >
                <option value="all">All Entities</option>
                {entityTypes.map(type => (
                  <option key={type} value={type} className="capitalize">{type}</option>
                ))}
              </select>
              <select
                value={actionFilter}
                onChange={(e) => setActionFilter(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-primary-500"
              >
                <option value="all">All Actions</option>
                <option value="CREATE">Created</option>
                <option value="UPDATE">Updated</option>
                <option value="DELETE">Deleted</option>
              </select>
            </div>
          </div>
        </div>

        {/* Logs List */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          {filteredLogs && filteredLogs.length > 0 ? (
            <div className="divide-y divide-gray-100">
              {filteredLogs.map((log) => (
                <div
                  key={log.id}
                  className="p-4 hover:bg-gray-50 cursor-pointer transition-colors"
                  onClick={() => setSelectedLog(log)}
                >
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-gray-100 rounded-lg text-gray-600">
                      {ENTITY_ICONS[log.entity_type] || <History size={18} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ACTION_COLORS[log.action]}`}>
                          {log.action}
                        </span>
                        <span className="text-xs text-gray-500 capitalize">{log.entity_type}</span>
                      </div>
                      <p className="text-gray-900 font-medium truncate">
                        {formatChangeDescription(log)}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        {format(new Date(log.created_at), 'MMM d, yyyy h:mm a')}
                      </p>
                    </div>
                    <button className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg">
                      <Eye size={18} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <History size={48} className="mx-auto text-gray-300 mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">No audit logs found</h3>
              <p className="text-gray-500">
                {logs?.length === 0 
                  ? 'Audit logging will track changes once the feature is enabled'
                  : 'Try adjusting your filters'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Log Detail Modal */}
      {selectedLog && (
        <>
          <div className="fixed inset-0 bg-black/50 z-50" onClick={() => setSelectedLog(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-bold">Log Details</h2>
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${ACTION_COLORS[selectedLog.action]}`}>
                    {selectedLog.action}
                  </span>
                </div>

                <div className="space-y-4 mb-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm text-gray-500">Entity Type</label>
                      <p className="font-medium capitalize">{selectedLog.entity_type}</p>
                    </div>
                    <div>
                      <label className="text-sm text-gray-500">Entity ID</label>
                      <p className="font-mono text-sm">{selectedLog.entity_id?.slice(0, 8)}...</p>
                    </div>
                    <div>
                      <label className="text-sm text-gray-500">Timestamp</label>
                      <p className="font-medium">{format(new Date(selectedLog.created_at), 'PPpp')}</p>
                    </div>
                    <div>
                      <label className="text-sm text-gray-500">User ID</label>
                      <p className="font-mono text-sm">{selectedLog.user_id?.slice(0, 8) || 'System'}...</p>
                    </div>
                  </div>
                </div>

                {selectedLog.action === 'UPDATE' && selectedLog.old_data && selectedLog.new_data && (
                  <div className="space-y-4">
                    <h3 className="font-semibold text-gray-900">Changes</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm text-gray-500 block mb-2">Before</label>
                        <pre className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs overflow-auto max-h-60">
                          {JSON.stringify(selectedLog.old_data, null, 2)}
                        </pre>
                      </div>
                      <div>
                        <label className="text-sm text-gray-500 block mb-2">After</label>
                        <pre className="bg-green-50 border border-green-200 rounded-lg p-3 text-xs overflow-auto max-h-60">
                          {JSON.stringify(selectedLog.new_data, null, 2)}
                        </pre>
                      </div>
                    </div>
                  </div>
                )}

                {selectedLog.action === 'CREATE' && selectedLog.new_data && (
                  <div>
                    <h3 className="font-semibold text-gray-900 mb-2">Created Data</h3>
                    <pre className="bg-green-50 border border-green-200 rounded-lg p-3 text-xs overflow-auto max-h-60">
                      {JSON.stringify(selectedLog.new_data, null, 2)}
                    </pre>
                  </div>
                )}

                {selectedLog.action === 'DELETE' && selectedLog.old_data && (
                  <div>
                    <h3 className="font-semibold text-gray-900 mb-2">Deleted Data</h3>
                    <pre className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs overflow-auto max-h-60">
                      {JSON.stringify(selectedLog.old_data, null, 2)}
                    </pre>
                  </div>
                )}

                <button
                  onClick={() => setSelectedLog(null)}
                  className="w-full mt-6 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
