import { useState, useEffect, useMemo } from 'react';
import { Drawer } from 'vaul';
import {
  Plus,
  Minus,
  User,
  Calendar,
  ChevronDown,
  ChevronRight,
  Copy,
  Trash2,
  Check,
  PlusCircle,
  ShoppingCart,
  Banknote,
  Wallet,
  Smartphone,
  CreditCard,
} from 'lucide-react';
import { format, parseISO, addDays, isSaturday } from 'date-fns';
import type { CartItem } from '../hooks/useCart';
import {
  MEAL_PERIOD_LABELS,
  MEAL_PERIOD_ICONS,
  type MealPeriod,
  type PaymentMethod,
  isOnlinePaymentMethod,
} from '../types';
import { getCheckoutButtonText } from '../services/payments';
import { formatDateLocal } from '../services/products';
import { friendlyError } from '../utils/friendlyError';
import { useConfirm } from './ConfirmDialog';
import { PaymentMethodSelector } from './PaymentMethodSelector';
import { OrderNotes } from './OrderNotes';

/* ================================================================
   PAYMENT METHOD DISPLAY HELPERS
   ================================================================ */

const PAYMENT_METHOD_META: Record<PaymentMethod, { label: string; icon: React.ReactNode }> = {
  cash: { label: 'Cash', icon: <Banknote size={18} /> },
  balance: { label: 'Wallet Balance', icon: <Wallet size={18} /> },
  gcash: { label: 'GCash', icon: <Smartphone size={18} /> },
  paymaya: { label: 'PayMaya', icon: <Smartphone size={18} /> },
  card: { label: 'Credit/Debit Card', icon: <CreditCard size={18} /> },
};

/* ================================================================
   TYPES
   ================================================================ */

interface CartBottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  items: CartItem[];
  itemsByStudent: Record<string, { student_name: string; items: CartItem[] }>;
  onUpdateQuantity: (
    productId: string,
    studentId: string,
    scheduledFor: string,
    quantity: number,
    mealPeriod?: MealPeriod,
  ) => void;
  onCheckout: (
    paymentMethod: PaymentMethod,
    notes: string,
    selectedDates?: string[],
  ) => Promise<void>;
  onClearDate?: (dateStr: string) => Promise<void>;
  onCopyDateItems?: (fromDate: string, toDate: string) => Promise<void>;
  onError?: (error: Error) => void;
  parentBalance?: number;
  existingOrders?: Array<{
    student_id: string;
    scheduled_for: string;
    order_id: string;
  }>;
  closedDates?: string[];
}

/* ================================================================
   COMPONENT
   ================================================================ */

export function CartBottomSheet({
  isOpen,
  onClose,
  items,
  itemsByStudent,
  onUpdateQuantity,
  onCheckout,
  onClearDate,
  onCopyDateItems,
  onError,
  parentBalance = 0,
  existingOrders,
  closedDates,
}: CartBottomSheetProps) {
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [notes, setNotes] = useState('');
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [paymentExpanded, setPaymentExpanded] = useState(false);
  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(new Set());
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
  const [showCopyModal, setShowCopyModal] = useState<string | null>(null);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const { confirm, ConfirmDialogElement } = useConfirm();

  // ── Computed values ──────────────────────────────────

  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const selectedTotal = useMemo(
    () =>
      selectedDates.size > 0
        ? items
            .filter((i) => selectedDates.has(i.scheduled_for))
            .reduce((sum, item) => sum + item.price * item.quantity, 0)
        : total,
    [items, selectedDates, total],
  );

  const canUseBalance = parentBalance >= selectedTotal;
  const studentCount = Object.keys(itemsByStudent).length;
  const uniqueDates = useMemo(
    () => [...new Set(items.map((i) => i.scheduled_for))].sort(),
    [items],
  );
  const dateCount = uniqueDates.length;

  const orderGroupCount = useMemo(() => {
    const keys = new Set<string>();
    const activeItems =
      selectedDates.size > 0
        ? items.filter((i) => selectedDates.has(i.scheduled_for))
        : items;
    for (const item of activeItems) {
      keys.add(`${item.student_id}_${item.scheduled_for}`);
    }
    return keys.size;
  }, [items, selectedDates]);

  // ── Side-effects ─────────────────────────────────────

  // Prune selectedDates when items are removed and dates disappear
  useEffect(() => {
    setSelectedDates(prev => {
      const pruned = new Set([...prev].filter(d => uniqueDates.includes(d)));
      return pruned.size === prev.size ? prev : pruned;
    });
  }, [uniqueDates]);

  useEffect(() => {
    if (!isOpen) {
      setCheckoutError(null);
      setSelectedDates(new Set());
      setShowCopyModal(null);
    }
  }, [isOpen]);

  // ── Date helpers ─────────────────────────────────────

  const toggleDateCollapse = (dateStr: string) => {
    setCollapsedDates((prev) => {
      const next = new Set(prev);
      if (next.has(dateStr)) next.delete(dateStr);
      else next.add(dateStr);
      return next;
    });
  };

  const toggleDateSelection = (dateStr: string) => {
    setSelectedDates((prev) => {
      const next = new Set(prev);
      if (next.has(dateStr)) next.delete(dateStr);
      else next.add(dateStr);
      return next;
    });
  };

  const getNextValidDates = (excludeDate: string): string[] => {
    const dates: string[] = [];
    const start = parseISO(excludeDate);
    const todayStr = formatDateLocal(new Date());
    const maxDate = addDays(parseISO(todayStr), 14);
    for (let i = 1; i <= 21 && dates.length < 5; i++) {
      const date = addDays(start, i);
      if (date.getDay() === 0) continue;         // Sunday
      if (isSaturday(date)) continue;              // Saturday
      const dateStr = formatDateLocal(date);
      if (dateStr < todayStr) continue;            // Past date
      if (date > maxDate) break;                   // Beyond 14-day limit
      if (closedDates?.includes(dateStr)) continue; // Holiday/closed
      dates.push(dateStr);
    }
    return dates;
  };

  const handleCopyItems = async (fromDate: string, toDate: string) => {
    try {
      if (onCopyDateItems) await onCopyDateItems(fromDate, toDate);
      setShowCopyModal(null);
    } catch (err) {
      setCheckoutError(friendlyError(err, 'copy items'));
    }
  };

  const handleClearDate = async (dateStr: string, e: React.SyntheticEvent) => {
    e.stopPropagation();
    if (!onClearDate) return;
    const confirmed = await confirm({
      title: 'Clear Items',
      message: `Clear all items for ${format(parseISO(dateStr), 'EEE, MMM d')}?`,
      confirmLabel: 'Clear',
      type: 'warning',
    });
    if (!confirmed) return;
    try {
      await onClearDate(dateStr);
    } catch (err) {
      setCheckoutError(friendlyError(err, 'clear items'));
    }
  };

  // ── Checkout ─────────────────────────────────────────

  const handleCheckout = async () => {
    if (isCheckingOut) return;
    setIsCheckingOut(true);
    setCheckoutError(null);
    try {
      const datesToCheckout =
        selectedDates.size > 0 ? Array.from(selectedDates) : undefined;
      await onCheckout(paymentMethod, notes, datesToCheckout);
      setNotes('');
      setPaymentMethod('cash');
      setSelectedDates(new Set());
    } catch (error) {
      const errorMessage = friendlyError(
        error instanceof Error ? error.message : '',
        'complete checkout',
      );
      setCheckoutError(errorMessage);
      onError?.(error instanceof Error ? error : new Error(errorMessage));
      console.error('Checkout error:', error);
    } finally {
      setIsCheckingOut(false);
    }
  };

  // ── Checkout button label ────────────────────────────

  const checkoutLabel = isCheckingOut
    ? isOnlinePaymentMethod(paymentMethod)
      ? 'Redirecting...'
      : 'Processing...'
    : selectedDates.size > 0
      ? `Checkout ${selectedDates.size} ${selectedDates.size === 1 ? 'Day' : 'Days'}`
      : dateCount > 1
        ? `Checkout All ${dateCount} Days`
        : studentCount > 1
          ? `Place ${studentCount} Orders`
          : getCheckoutButtonText(paymentMethod);

  // ── Group items by date → student ────────────────────

  const groupedItems = useMemo(() => {
    const byDateAndStudent = items.reduce(
      (acc, item) => {
        if (!acc[item.scheduled_for]) acc[item.scheduled_for] = {};
        if (!acc[item.scheduled_for][item.student_id]) {
          acc[item.scheduled_for][item.student_id] = {
            student_name: item.student_name,
            items: [],
          };
        }
        acc[item.scheduled_for][item.student_id].items.push(item);
        return acc;
      },
      {} as Record<
        string,
        Record<string, { student_name: string; items: CartItem[] }>
      >,
    );
    return Object.keys(byDateAndStudent)
      .sort()
      .map((dateStr) => ({ dateStr, students: byDateAndStudent[dateStr] }));
  }, [items]);

  // ── Render ───────────────────────────────────────────

  return (
    <>
      <Drawer.Root
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) {
            setPaymentExpanded(false);
            setCollapsedDates(new Set());
            onClose();
          }
        }}
        dismissible={!isCheckingOut}
      >
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/50 z-40" />
          <Drawer.Content
            onKeyDown={(e) => {
              if (isCheckingOut && e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
              }
            }}
            className="fixed bottom-0 left-0 right-0 z-50 flex flex-col rounded-t-2xl bg-white dark:bg-gray-800 outline-none"
            style={{ maxHeight: '92vh' }}
          >
            {/* Handle */}
            <Drawer.Handle className="mx-auto mt-3 mb-1 h-1.5 w-12 rounded-full bg-gray-300 dark:bg-gray-600 flex-shrink-0" />

            {/* Title (accessible, visually compact) */}
            <div className="flex items-center justify-between px-4 pb-3 pt-1 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
              <Drawer.Title className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <ShoppingCart size={20} className="text-primary-600 dark:text-primary-400" />
                Cart
                {items.length > 0 && (
                  <span className="ml-1 text-sm font-medium bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 px-2 py-0.5 rounded-full">
                    {items.reduce((s, i) => s + i.quantity, 0)} items
                  </span>
                )}
              </Drawer.Title>
              <span className="text-lg font-bold text-primary-600 dark:text-primary-400">
                ₱{selectedTotal.toFixed(2)}
              </span>
            </div>

            {/* Scrollable items area */}
            <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-3">
              {items.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500">
                  <ShoppingCart size={48} strokeWidth={1.5} className="mb-3 opacity-40" />
                  <p className="font-medium">Your cart is empty</p>
                  <p className="text-sm mt-1">Add items from the menu to get started</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Multi-date selection header */}
                  {dateCount > 1 && (
                    <div className="flex items-center justify-between bg-gray-50 dark:bg-gray-900 px-3 py-2 rounded-xl">
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        {dateCount} days &middot;{' '}
                        {selectedDates.size > 0
                          ? `${selectedDates.size} selected`
                          : 'All selected'}
                      </span>
                      {selectedDates.size > 0 && selectedDates.size < uniqueDates.length && (
                        <button
                          onClick={() => setSelectedDates(new Set())}
                          className="text-sm text-primary-600 dark:text-primary-400 font-medium hover:underline"
                        >
                          Show all
                        </button>
                      )}
                    </div>
                  )}

                  {/* Date groups */}
                  {groupedItems.map(({ dateStr, students }) => {
                    const dateStudents = Object.values(students);
                    const dateTotal = dateStudents
                      .flatMap((s) => s.items)
                      .reduce((sum, item) => sum + item.price * item.quantity, 0);
                    const isCollapsed = collapsedDates.has(dateStr);
                    const isSelected =
                      selectedDates.size === 0 || selectedDates.has(dateStr);
                    const itemCount = dateStudents
                      .flatMap((s) => s.items)
                      .reduce((sum, item) => sum + item.quantity, 0);
                    // BUG-039: Use Asia/Manila timezone for "today" check
                    const dateIsToday = dateStr === formatDateLocal(new Date());

                    return (
                      <div
                        key={dateStr}
                        className={`transition-opacity ${!isSelected ? 'opacity-40' : ''}`}
                      >
                        {/* Date header */}
                        <button
                          className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border transition-colors ${
                            dateIsToday
                              ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                              : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
                          }`}
                          onClick={() => toggleDateCollapse(dateStr)}
                          type="button"
                        >
                          <div className="flex items-center gap-2">
                            {/* Selection checkbox (multi-date) */}
                            {dateCount > 1 && (
                              <span
                                role="checkbox"
                                aria-checked={isSelected}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleDateSelection(dateStr);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === ' ' || e.key === 'Enter') {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    toggleDateSelection(dateStr);
                                  }
                                }}
                                tabIndex={0}
                                className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors cursor-pointer ${
                                  isSelected
                                    ? 'bg-primary-600 border-primary-600 text-white'
                                    : 'border-gray-300 dark:border-gray-600'
                                }`}
                              >
                                {isSelected && <Check size={12} />}
                              </span>
                            )}

                            {isCollapsed ? (
                              <ChevronRight
                                size={16}
                                className={
                                  dateIsToday
                                    ? 'text-green-600 dark:text-green-400'
                                    : 'text-amber-600 dark:text-amber-400'
                                }
                              />
                            ) : (
                              <ChevronDown
                                size={16}
                                className={
                                  dateIsToday
                                    ? 'text-green-600 dark:text-green-400'
                                    : 'text-amber-600 dark:text-amber-400'
                                }
                              />
                            )}

                            <Calendar
                              size={16}
                              className={
                                dateIsToday
                                  ? 'text-green-600 dark:text-green-400'
                                  : 'text-amber-600 dark:text-amber-400'
                              }
                            />
                            <span
                              className={`font-medium text-sm ${
                                dateIsToday
                                  ? 'text-green-700 dark:text-green-300'
                                  : 'text-amber-700 dark:text-amber-300'
                              }`}
                            >
                              {dateIsToday
                                ? 'Today'
                                : format(parseISO(dateStr), 'EEE, MMM d')}
                            </span>
                            <span className="text-xs text-gray-400 dark:text-gray-500">
                              ({itemCount})
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            <span
                              className={`text-sm font-semibold ${
                                dateIsToday
                                  ? 'text-green-600 dark:text-green-400'
                                  : 'text-amber-600 dark:text-amber-400'
                              }`}
                            >
                              ₱{dateTotal.toFixed(2)}
                            </span>
                            {onCopyDateItems && (
                              <span
                                role="button"
                                tabIndex={0}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setShowCopyModal(dateStr);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === ' ' || e.key === 'Enter') {
                                    e.stopPropagation();
                                    setShowCopyModal(dateStr);
                                  }
                                }}
                                className="p-1.5 hover:bg-white/50 dark:hover:bg-black/20 rounded transition-colors"
                                title="Copy to another day"
                              >
                                <Copy size={14} className="text-gray-500 dark:text-gray-400" />
                              </span>
                            )}
                            {onClearDate && (
                              <span
                                role="button"
                                tabIndex={0}
                                onClick={(e) => handleClearDate(dateStr, e)}
                                onKeyDown={(e) => {
                                  if (e.key === ' ' || e.key === 'Enter') {
                                    handleClearDate(dateStr, e);
                                  }
                                }}
                                className="p-1.5 hover:bg-white/50 dark:hover:bg-black/20 rounded transition-colors"
                                title="Clear this day"
                              >
                                <Trash2 size={14} className="text-red-500 dark:text-red-400" />
                              </span>
                            )}
                          </div>
                        </button>

                        {/* Copy modal */}
                        {showCopyModal === dateStr && (
                          <div className="ml-4 mt-2 p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg">
                            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                              Copy items to:
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {getNextValidDates(dateStr).map((targetDate) => (
                                <button
                                  key={targetDate}
                                  onClick={() => handleCopyItems(dateStr, targetDate)}
                                  className="px-3 py-1.5 text-sm bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded-lg hover:bg-primary-100 dark:hover:bg-primary-900/50 transition-colors"
                                >
                                  {format(parseISO(targetDate), 'EEE, MMM d')}
                                  {uniqueDates.includes(targetDate) && (
                                    <span className="text-xs ml-1 opacity-60">(merge)</span>
                                  )}
                                </button>
                              ))}
                            </div>
                            <button
                              onClick={() => setShowCopyModal(null)}
                              className="mt-2 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                            >
                              Cancel
                            </button>
                          </div>
                        )}

                        {/* Student groups — collapsible content */}
                        {!isCollapsed &&
                          Object.entries(students).map(
                            ([studentId, { student_name, items: studentItems }]) => {
                              const studentTotal = studentItems.reduce(
                                (sum, item) => sum + item.price * item.quantity,
                                0,
                              );
                              return (
                                <div
                                  key={`${dateStr}-${studentId}`}
                                  className="mt-2 ml-1"
                                >
                                  {/* Student header */}
                                  <div className="flex items-center justify-between bg-primary-50 dark:bg-primary-900/20 px-3 py-2 rounded-lg">
                                    <div className="flex items-center gap-2">
                                      <User
                                        size={14}
                                        className="text-primary-600 dark:text-primary-400"
                                      />
                                      <span className="font-medium text-sm text-primary-700 dark:text-primary-300">
                                        {student_name}
                                      </span>
                                    </div>
                                    <span className="text-xs font-medium text-primary-600 dark:text-primary-400">
                                      ₱{studentTotal.toFixed(2)}
                                    </span>
                                  </div>

                                  {/* Items */}
                                  <div className="space-y-2 mt-2 pl-1">
                                    {studentItems.map((item) => (
                                      <div
                                        key={`${item.scheduled_for}-${item.student_id}-${item.product_id}-${item.meal_period}`}
                                        className="flex items-center gap-3 p-2.5 bg-gray-50 dark:bg-gray-900/60 rounded-xl"
                                      >
                                        <img
                                          src={failedImages.has(`${item.scheduled_for}-${item.student_id}-${item.product_id}`) || !item.image_url
                                            ? 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23ddd" width="100" height="100"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="40" fill="%23999">?</text></svg>'
                                            : item.image_url}
                                          alt={item.name}
                                          className="w-12 h-12 object-cover rounded-lg flex-shrink-0"
                                          onError={() => {
                                            setFailedImages(prev => new Set(prev).add(`${item.scheduled_for}-${item.student_id}-${item.product_id}`));
                                          }}
                                        />
                                        <div className="flex-1 min-w-0">
                                          <h4 className="font-medium text-gray-900 dark:text-gray-100 truncate text-sm leading-tight">
                                            {item.name}
                                          </h4>
                                          <p className="text-gray-500 dark:text-gray-400 text-xs mt-0.5">
                                            ₱{item.price.toFixed(2)}
                                          </p>
                                          {item.meal_period && (
                                            <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 rounded mt-0.5">
                                              {MEAL_PERIOD_ICONS[item.meal_period]}{' '}
                                              {MEAL_PERIOD_LABELS[item.meal_period]}
                                            </span>
                                          )}
                                          {existingOrders?.some(
                                            (o) =>
                                              o.student_id === item.student_id &&
                                              o.scheduled_for === item.scheduled_for,
                                          ) && (
                                            <div className="flex items-center gap-1 text-[10px] text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 rounded px-1.5 py-0.5 mt-1 w-fit">
                                              <PlusCircle className="w-3 h-3" />
                                              Adding to existing order
                                            </div>
                                          )}
                                        </div>

                                        {/* Quantity controls */}
                                        <div className="flex items-center gap-1.5 flex-shrink-0">
                                          <button
                                            onClick={() =>
                                              onUpdateQuantity(
                                                item.product_id,
                                                item.student_id,
                                                item.scheduled_for,
                                                item.quantity - 1,
                                                item.meal_period,
                                              )
                                            }
                                            className="w-7 h-7 flex items-center justify-center bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded-lg transition-colors"
                                            aria-label="Decrease quantity"
                                          >
                                            <Minus size={14} className="text-gray-700 dark:text-gray-300" />
                                          </button>
                                          <span className="w-6 text-center font-semibold text-sm text-gray-900 dark:text-gray-100">
                                            {item.quantity}
                                          </span>
                                          <button
                                            onClick={() =>
                                              onUpdateQuantity(
                                                item.product_id,
                                                item.student_id,
                                                item.scheduled_for,
                                                item.quantity + 1,
                                                item.meal_period,
                                              )
                                            }
                                            disabled={item.quantity >= 20}
                                            className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors ${item.quantity >= 20 ? 'opacity-50 cursor-not-allowed bg-gray-100 dark:bg-gray-800' : 'bg-primary-100 dark:bg-primary-900/40 hover:bg-primary-200 dark:hover:bg-primary-900/60'}`}
                                            aria-label="Increase quantity"
                                          >
                                            <Plus size={14} className="text-primary-700 dark:text-primary-300" />
                                          </button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              );
                            },
                          )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── Checkout Footer (sticky) ─────────────────── */}
            {items.length > 0 && (
              <div className="border-t border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex-shrink-0 space-y-2">
                {/* Collapsible payment method */}
                <div>
                  <button
                    type="button"
                    onClick={() => setPaymentExpanded((v) => !v)}
                    className="w-full flex items-center justify-between py-2 px-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 transition-colors"
                    aria-expanded={paymentExpanded}
                    aria-controls="payment-selector-panel"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-primary-600 dark:text-primary-400">
                        {PAYMENT_METHOD_META[paymentMethod].icon}
                      </span>
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {PAYMENT_METHOD_META[paymentMethod].label}
                      </span>
                    </div>
                    <ChevronDown
                      size={16}
                      className={`text-gray-400 dark:text-gray-500 transition-transform ${
                        paymentExpanded ? 'rotate-180' : ''
                      }`}
                    />
                  </button>

                  {paymentExpanded && (
                    <div id="payment-selector-panel" className="mt-2">
                      <PaymentMethodSelector
                        selected={paymentMethod}
                        onSelect={(method) => {
                          setPaymentMethod(method);
                          setPaymentExpanded(false);
                        }}
                        balance={parentBalance}
                        orderTotal={selectedTotal}
                        isOffline={!navigator.onLine}
                      />
                    </div>
                  )}
                </div>

                {/* Order notes */}
                <OrderNotes value={notes} onChange={setNotes} />

                {/* Warnings & errors */}
                {isOnlinePaymentMethod(paymentMethod) && orderGroupCount > 1 && (
                  <p className="text-xs text-blue-600 dark:text-blue-400 text-center">
                    All {orderGroupCount} orders combined into one payment
                  </p>
                )}
                {paymentMethod === 'balance' && !canUseBalance && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 text-center">
                    Need ₱{(selectedTotal - parentBalance).toFixed(2)} more balance
                  </p>
                )}
                {checkoutError && (
                  <p className="text-xs text-red-600 dark:text-red-400 text-center">
                    {checkoutError}
                  </p>
                )}

                {/* Total + Checkout button */}
                <button
                  type="button"
                  onClick={handleCheckout}
                  disabled={items.length === 0 || isCheckingOut || (paymentMethod === 'balance' && !canUseBalance)}
                  className="w-full bg-primary-600 hover:bg-primary-700 active:bg-primary-800 disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed text-white py-3 rounded-xl font-semibold transition-colors flex items-center justify-center gap-2 shadow-sm"
                >
                  {isCheckingOut && (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  )}
                  <span>{checkoutLabel}</span>
                  <span className="text-white/80 font-normal mx-1">·</span>
                  <span>₱{selectedTotal.toFixed(2)}</span>
                </button>
              </div>
            )}
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      {ConfirmDialogElement}
    </>
  );
}
