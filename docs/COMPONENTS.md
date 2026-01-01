# Component Library

## Overview

Reusable React components for consistent UI across the app.

---

## Admin Pages

### Admin/Students

Full student management page for administrators.

**Features**:
- **Stats Dashboard**: Total students, linked, unlinked counts
- **Add Student Form**: Manual entry with auto-generated Student ID
- **CSV Import**: Bulk upload with template download
- **Search & Filter**: By name, Student ID, parent email, grade, link status
- **Student Actions**: Edit details, unlink from parent, delete

**Location**: `src/pages/Admin/Students.tsx`

**Route**: `/admin/students`

**Key Functions**:
- `addStudent()`: Creates student with auto-generated ID
- `updateStudent()`: Updates student details
- `unlinkStudent()`: Removes parent link
- `importCSV()`: Bulk import from CSV file

---

## Core Components

### ProductCard

Displays a menu item with image, name, price, and add-to-cart button.

**Props**:

```typescript
interface ProductCardProps {
  id: string;
  name: string;
  description: string;
  price: number;
  image_url: string;
  available: boolean;
  onAddToCart: (productId: string) => void;
}
```

**Usage**:

```tsx
<ProductCard
  id="product-123"
  name="Chicken Adobo"
  description="Filipino classic with rice"
  price={45.00}
  image_url="https://..."
  available={true}
  onAddToCart={(id) => addToCart(id)}
/>
```

**Implementation**:

```tsx
export function ProductCard({ id, name, description, price, image_url, available, onAddToCart }: ProductCardProps) {
  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow">
      <img src={image_url} alt={name} className="w-full h-48 object-cover" />
      <div className="p-4">
        <h3 className="text-lg font-semibold mb-1">{name}</h3>
        <p className="text-gray-600 text-sm mb-3 line-clamp-2">{description}</p>
        <div className="flex items-center justify-between">
          <span className="text-2xl font-bold text-primary-600">₱{price.toFixed(2)}</span>
          <button
            onClick={() => onAddToCart(id)}
            disabled={!available}
            className="bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 text-white px-4 py-2 rounded-lg transition-colors"
          >
            {available ? 'Add' : 'Out of Stock'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

---

### ChildSelector

Dropdown for selecting which child to order for.

**Props**:

```typescript
interface ChildSelectorProps {
  children: Child[];
  selectedChildId: string | null;
  onSelect: (childId: string) => void;
}
```

**Usage**:

```tsx
<ChildSelector
  children={parentChildren}
  selectedChildId={activeChildId}
  onSelect={(id) => setActiveChildId(id)}
/>
```

**Implementation**:

```tsx
export function ChildSelector({ children, selectedChildId, onSelect }: ChildSelectorProps) {
  return (
    <div className="mb-6">
      <label className="block text-sm font-medium text-gray-700 mb-2">
        Order for:
      </label>
      <select
        value={selectedChildId || ''}
        onChange={(e) => onSelect(e.target.value)}
        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
      >
        <option value="">Select a child</option>
        {children.map((child) => (
          <option key={child.id} value={child.id}>
            {child.first_name} {child.last_name} - {child.grade_level}
          </option>
        ))}
      </select>
    </div>
  );
}
```

---

### CartDrawer

Slide-out cart showing items and checkout button.

**Props**:

```typescript
interface CartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  items: CartItem[];
  onUpdateQuantity: (itemId: string, quantity: number) => void;
  onCheckout: () => void;
}
```

**Usage**:

```tsx
<CartDrawer
  isOpen={cartOpen}
  onClose={() => setCartOpen(false)}
  items={cartItems}
  onUpdateQuantity={updateQuantity}
  onCheckout={handleCheckout}
/>
```

**Implementation**:

```tsx
export function CartDrawer({ isOpen, onClose, items, onUpdateQuantity, onCheckout }: CartDrawerProps) {
  const total = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  
  return (
    <>
      {/* Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-40"
          onClick={onClose}
        />
      )}
      
      {/* Drawer */}
      <div
        className={`fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-xl z-50 transform transition-transform duration-300 ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b">
            <h2 className="text-xl font-bold">Your Cart</h2>
            <button onClick={on Close} className="p-2 hover:bg-gray-100 rounded-lg">
<XIcon />
</button>
</div>

{/* Items */}
      <div className="flex-1 overflow-y-auto p-4">
        {items.length === 0 ? (
          <p className="text-gray-500 text-center py-8">Cart is empty</p>
        ) : (
          items.map((item) => (
            <div key={item.id} className="flex items-center gap-4 mb-4 p-3 bg-gray-50 rounded-lg">
              <img src={item.image_url} alt={item.name} className="w-16 h-16 object-cover rounded" />
              <div className="flex-1">
                <h4 className="font-medium">{item.name}</h4>
                <p className="text-gray-600">₱{item.price.toFixed(2)}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onUpdateQuantity(item.id, item.quantity - 1)}
                  className="p-1 hover:bg-gray-200 rounded"
                >
                  <MinusIcon size={16} />
                </button>
                <span className="w-8 text-center">{item.quantity}</span>
                <button
                  onClick={() => onUpdateQuantity(item.id, item.quantity + 1)}
                  className="p-1 hover:bg-gray-200 rounded"
                >
                  <PlusIcon size={16} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
      
      {/* Footer */}
      <div className="border-t p-4">
        <div className="flex items-center justify-between mb-4">
          <span className="text-lg font-medium">Total:</span>
          <span className="text-2xl font-bold text-primary-600">₱{total.toFixed(2)}</span>
        </div>
        <button
          onClick={onCheckout}
          disabled={items.length === 0}
          className="w-full bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 text-white py-3 rounded-lg font-medium"
        >
          Checkout
        </button>
      </div>
    </div>
  </div>
</>
);
}

---

## Form Components

### Input
```tsx
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export function Input({ label, error, ...props }: InputProps) {
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}
      </label>
      <input
        {...props}
        className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 ${
          error ? 'border-error' : 'border-gray-300'
        }`}
      />
      {error && <p className="mt-1 text-sm text-error">{error}</p>}
    </div>
  );
}
```

---

## Layout Components

### PageHeader

```tsx
interface PageHeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export function PageHeader({ title, subtitle, action }: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">{title}</h1>
        {subtitle && <p className="text-gray-600 mt-1">{subtitle}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}
```

---

## Utility Components

### Loading Spinner

```tsx
export function LoadingSpinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-8 h-8',
    lg: 'w-12 h-12'
  };
  
  return (
    <div className="flex items-center justify-center">
      <div className={`${sizeClasses[size]} border-4 border-gray-200 border-t-primary-600 rounded-full animate-spin`}></div>
    </div>
  );
}
```

### Empty State

```tsx
interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="text-center py-12">
      <div className="text-gray-400 mb-4 flex justify-center">{icon}</div>
      <h3 className="text-lg font-medium text-gray-900 mb-2">{title}</h3>
      <p className="text-gray-600 mb-6">{description}</p>
      {action && <div>{action}</div>}
    </div>
  );
}
```

---

## Best Practices

1. **Props Validation**: Use TypeScript interfaces
2. **Accessibility**: Always include ARIA labels
3. **Responsive**: Mobile-first design
4. **Performance**: Use React.memo for expensive components
5. **Testability**: Keep components pure and testable
