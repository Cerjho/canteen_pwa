import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface OrderNotesProps {
  value: string;
  onChange: (value: string) => void;
}

export function OrderNotes({ value, onChange }: OrderNotesProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between w-full text-left text-sm text-gray-600 hover:text-gray-900"
      >
        <span>Add special instructions (optional)</span>
        <ChevronDown 
          size={18} 
          className={`transform transition-transform ${isExpanded ? 'rotate-180' : ''}`} 
        />
      </button>
      
      {isExpanded && (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g., No onions, extra rice, less salt..."
          rows={3}
          maxLength={200}
          className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-none"
        />
      )}
    </div>
  );
}
