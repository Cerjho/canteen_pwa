# UI/UX Guidelines

## Design Principles

1. **Mobile-First**: Design for small screens, enhance for larger
2. **Accessibility**: WCAG 2.1 Level AA compliance
3. **Performance**: < 3s load time on 3G
4. **Simplicity**: Minimize cognitive load

---

## Color Palette

### Primary Colors

```css
--primary-50: #EEF2FF;
--primary-100: #E0E7FF;
--primary-500: #6366F1;  /* Primary */
--primary-600: #4F46E5;  /* Primary Dark */
--primary-700: #4338CA;
```

### Semantic Colors

```css
--success: #10B981;  /* Green */
--warning: #F59E0B;  /* Amber */
--error: #EF4444;    /* Red */
--info: #3B82F6;     /* Blue */
```

### Neutrals

```css
--gray-50: #F9FAFB;
--gray-100: #F3F4F6;
--gray-500: #6B7280;
--gray-900: #111827;
```

---

## Typography

### Font Family

```css
font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
```

### Scale

| Element | Size | Weight | Line Height |
| ------- | ---- | ------ | ----------- |
| H1 | 2.25rem (36px) | 700 | 1.2 |
| H2 | 1.875rem (30px) | 600 | 1.3 |
| H3 | 1.5rem (24px) | 600 | 1.4 |
| Body | 1rem (16px) | 400 | 1.5 |
| Small | 0.875rem (14px) | 400 | 1.4 |
| Tiny | 0.75rem (12px) | 400 | 1.3 |

---

## Spacing

Use 8px base unit:

```css
--space-1: 0.25rem;  /* 4px */
--space-2: 0.5rem;   /* 8px */
--space-3: 0.75rem;  /* 12px */
--space-4: 1rem;     /* 16px */
--space-6: 1.5rem;   /* 24px */
--space-8: 2rem;     /* 32px */
```

---

## Components

### Buttons

**Primary Button**:

```tsx
<button className="bg-primary-600 hover:bg-primary-700 text-white font-medium py-2 px-4 rounded-lg shadow-sm">
  Place Order
</button>
```

**Secondary Button**:

```tsx
<button className="bg-white hover:bg-gray-50 text-gray-700 font-medium py-2 px-4 rounded-lg border border-gray-300">
  Cancel
</button>
```

**Sizes**:

- Small: `py-1 px-3 text-sm`
- Medium: `py-2 px-4`
- Large: `py-3 px-6 text-lg`

---

### Cards

```tsx
<div className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow">
  <img src={product.image_url} alt={product.name} className="w-full h-48 object-cover rounded-md mb-4" />
  <h3 className="text-lg font-semibold mb-2">{product.name}</h3>
  <p className="text-gray-600 text-sm mb-4">{product.description}</p>
  <div className="flex items-center justify-between">
    <span className="text-2xl font-bold text-primary-600">₱{product.price}</span>
    <button className="bg-primary-600 text-white px-4 py-2 rounded-lg">Add</button>
  </div>
</div>
```

---

### Forms

**Input Field**:

```tsx
<div className="mb-4">
  <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
    Email
  </label>
  <input
    type="email"
    id="email"
    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
    placeholder="parent@example.com"
  />
</div>
```

**Error State**:

```tsx
<input
  className="w-full px-3 py-2 border-2 border-error rounded-lg focus:ring-2 focus:ring-error"
  aria-invalid="true"
/>
<p className="mt-1 text-sm text-error">Please enter a valid email</p>
```

---

### Badges

```tsx
{/* Status badges */}
<span className="inline-block px-2 py-1 text-xs font-semibold rounded-full bg-success text-white">
  Ready
</span>

<span className="inline-block px-2 py-1 text-xs font-semibold rounded-full bg-warning text-white">
  Preparing
</span>

<span className="inline-block px-2 py-1 text-xs font-semibold rounded-full bg-gray-200 text-gray-700">
  Pending
</span>
```

---

## Layout

### Container

```tsx
<div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-7xl">
  {/* Content */}
</div>
```

### Grid

```tsx
{/* Product grid */}
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
  {products.map(product => <ProductCard key={product.id} {...product} />)}
</div>
```

---

## Navigation

### Mobile Bottom Nav

```tsx
<nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 safe-area-inset-bottom">
  <div className="flex justify-around items-center h-16">
    <NavLink to="/menu" icon={<MenuIcon />} label="Menu" />
    <NavLink to="/orders" icon={<ReceiptIcon />} label="Orders" />
    <NavLink to="/children" icon={<UsersIcon />} label="Children" />
    <NavLink to="/account" icon={<UserIcon />} label="Account" />
  </div>
</nav>
```

---

## Animations

### Transitions

```css
/* Smooth color changes */
.transition {
  transition: all 150ms ease-in-out;
}

/* Hover states */
.hover\:scale-105:hover {
  transform: scale(1.05);
}
```

### Loading States

```tsx
<div className="animate-pulse">
  <div className="h-48 bg-gray-200 rounded-md mb-4"></div>
  <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
  <div className="h-4 bg-gray-200 rounded w-1/2"></div>
</div>
```

---

## Accessibility

### Focus Indicators

```css
:focus-visible {
  outline: 2px solid theme('colors.primary.500');
  outline-offset: 2px;
}
```

### ARIA Labels

```tsx
<button aria-label="Add Chicken Adobo to cart">
  <PlusIcon />
</button>

<img src={product.image_url} alt={`${product.name} - ${product.description}`} />
```

### Keyboard Navigation

- Tab order follows visual order
- All interactive elements accessible via keyboard
- Escape key closes modals/drawers

---

## Responsive Breakpoints

| Breakpoint | Width | Usage |
| ---------- | ----- | ----- |
| `sm` | 640px | Small tablets (portrait) |
| `md` | 768px | Tablets (landscape) |
| `lg` | 1024px | Small laptops |
| `xl` | 1280px | Desktops |
| `2xl` | 1536px | Large screens |

---

## Dark Mode (Future)

```css
/* Light mode (default) */
:root {
  --background: #ffffff;
  --foreground: #111827;
}

/* Dark mode */
@media (prefers-color-scheme: dark) {
  :root {
    --background: #111827;
    --foreground: #f9fafb;
  }
}
```

---

## Philippine Context

### Currency Formatting

```typescript
const formatPHP = (amount: number) => {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP'
  }).format(amount);
};

// Output: ₱45.00
```

### Language

- Primary: English
- Future: Filipino (Tagalog) translations

---

## Performance Guidelines

1. **Images**: Use WebP, max 800px width
2. **Icons**: Use SVG or icon fonts (lucide-react)
3. **Lazy Loading**: Load images below the fold lazily
4. **Bundle Size**: Keep page JS < 200KB

---

## Resources

- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- [Lucide Icons](https://lucide.dev/)
- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
