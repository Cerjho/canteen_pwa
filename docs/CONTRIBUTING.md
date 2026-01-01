# Contributing Guide

Thank you for considering contributing to the School Canteen PWA!

---

## Code of Conduct

Be respectful, inclusive, and collaborative. We aim to maintain a welcoming environment for all contributors.

---

## Getting Started

1. **Fork the repository**
2. **Clone your fork**:

```bash
   git clone https://github.com/your-username/canteen-pwa.git
   cd canteen-pwa
```

1. **Install dependencies**:

```bash
   npm install
```

1. **Create a branch**:

```bash
   git checkout -b feature/your-feature-name
```

---

## Development Workflow

### 1. Make Changes

- Follow the coding standards (see below)
- Write tests for new features
- Update documentation as needed

### 2. Test Locally

```bash
npm run lint          # Check code style
npm test              # Run unit tests
npm run test:e2e      # Run E2E tests
npm run build         # Verify build works
```

### 3. Commit Changes

Use conventional commits:

```bash
git commit -m "feat: add child dietary restrictions field"
git commit -m "fix: resolve offline sync race condition"
git commit -m "docs: update API documentation"
```

**Commit Types**:

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code formatting (no logic change)
- `refactor`: Code restructuring
- `test`: Add/update tests
- `chore`: Maintenance tasks

### 4. Push and Create PR

```bash
git push origin feature/your-feature-name
```

Open a pull request on GitHub with:

- Clear description of changes
- Link to related issue (if applicable)
- Screenshots for UI changes

---

## Coding Standards

### TypeScript

- **Use TypeScript** for all new code
- **Define interfaces** for all props and data structures
- **Avoid `any`** - use proper types or `unknown`

```typescript
// ✅ Good
interface User {
  id: string;
  email: string;
}

// ❌ Bad
const user: any = { ... };
```

### React

- **Functional components** with hooks
- **Descriptive names**: `UserProfileCard`, not `Card`
- **Extract reusable logic** into custom hooks
- **Prop drilling**: Use React Context for deep props

```typescript
// ✅ Good
export function UserProfileCard({ user }: { user: User }) {
  return <div>{user.name}</div>;
}

// ❌ Bad
export function Card({ data }: { data: any }) {
  return <div>{data.name}</div>;
}
```

### CSS (Tailwind)

- Use Tailwind utility classes
- Extract repeated patterns into components
- Mobile-first responsive design

```tsx
// ✅ Good
<div className="p-4 md:p-6 lg:p-8">

// ❌ Bad (desktop-first)
<div className="p-8 md:p-6 sm:p-4">
```

---

## File Organization

```text
src/
├── components/       # Reusable UI components
├── pages/           # Route components
├── hooks/           # Custom React hooks
├── services/        # API/data services
├── utils/           # Helper functions
├── types/           # TypeScript type definitions
└── constants/       # App-wide constants
```

**File Naming**:

- Components: `PascalCase.tsx`
- Hooks: `useCamelCase.ts`
- Utils: `camelCase.ts`
- Types: `camelCase.types.ts`

---

## Testing Requirements

All new features must include tests:

### Unit Tests

```typescript
// ProductCard.test.tsx
describe('ProductCard', () => {
  it('renders product information', () => {
    // Test implementation
  });
  
  it('handles add to cart action', () => {
    // Test implementation
  });
});
```

### E2E Tests (for critical paths)

```typescript
test('parent can place order', async ({ page }) => {
  // Test implementation
});
```

---

## Documentation

Update documentation when:

- Adding new features
- Changing APIs
- Modifying architecture
- Adding dependencies

Documentation files in `/docs`:

- `API.md` - Backend endpoints
- `COMPONENTS.md` - UI components
- `ARCHITECTURE.md` - System design

---

## Supabase Changes

### Database Migrations

Never modify schema directly. Always create migrations:

```bash
supabase migration new add_allergen_field
```

Edit the generated SQL file:

```sql
ALTER TABLE children 
ADD COLUMN allergens TEXT[];
```

Test locally:

```bash
supabase db reset
```

### Edge Functions

Keep functions focused and testable:

```typescript
// ✅ Good - single responsibility
export async function processOrder(req: Request) {
  // Process order logic
}

// ❌ Bad - multiple responsibilities
export async function handleEverything(req: Request) {
  // Process order, send notification, update inventory...
}
```

---

## Security Considerations

Before submitting:

- [ ] No hardcoded secrets or API keys
- [ ] User input validated
- [ ] RLS policies tested
- [ ] SQL injection prevented (use parameterized queries)
- [ ] XSS prevented (React handles this, but check `dangerouslySetInnerHTML`)

---

## Pull Request Checklist

- [ ] Tests pass locally
- [ ] Code follows style guide
- [ ] Documentation updated
- [ ] No console.log statements
- [ ] No commented-out code
- [ ] Commit messages follow convention
- [ ] Branch is up to date with main

---

## Review Process

1. **Automated checks** must pass (CI/CD)
2. **Code review** by at least one maintainer
3. **Testing** on preview deployment
4. **Approval** and merge

---

## Questions?

- Open a GitHub Discussion
- Check existing issues
- Review documentation

Thank you for contributing! 🎉
