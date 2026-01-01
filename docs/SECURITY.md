# Security Best Practices

## Overview

This document outlines security measures implemented across the stack.

---

## Authentication & Authorization

### Supabase Auth

- **Password Requirements**: Minimum 8 characters
- **Email Verification**: Required for all accounts
- **MFA**: Optional (SMS/TOTP)
- **Session Management**: JWT tokens with 1-hour expiry

### Role-Based Access Control (RBAC)

| Role | Permissions |
| ---- | ----------- |
| **Parent** | Manage own children, place orders, view own history |
| **Staff** | View all orders, update order status, manage inventory |
| **Admin** | Full access, manage users, generate reports |

---

## Data Protection

### Row Level Security (RLS)

All database tables enforce RLS. See [SUPABASE_RLS.md](SUPABASE_RLS.md).

### Data Encryption

- **In Transit**: TLS 1.3 (HTTPS)
- **At Rest**: AES-256 (Supabase default)
- **Secrets**: Encrypted environment variables

### Personal Data

| Data Type | Storage | Retention |
| --------- | ------- | --------- |
| Parent email/phone | Supabase Auth | Until account deletion |
| Child profiles | Postgres | Until parent deletes |
| Order history | Postgres | 2 years |
| Payment info | Not stored | Tokenized via PayMongo |

---

## Input Validation

### Frontend

```typescript
// Zod schema validation
const orderSchema = z.object({
  child_id: z.string().uuid(),
  items: z.array(z.object({
    product_id: z.string().uuid(),
    quantity: z.number().int().positive().max(10)
  })).min(1).max(20),
  payment_method: z.enum(['cash', 'balance', 'gcash'])
});

orderSchema.parse(formData); // Throws if invalid
```

### Backend (Edge Functions)

```typescript
// Never trust client input
if (!child_id || !Array.isArray(items) || items.length === 0) {
  return new Response(
    JSON.stringify({ error: 'VALIDATION_ERROR' }),
    { status: 400 }
  );
}

// Validate ownership
const { data: child } = await supabase
  .from('children')
  .select('parent_id')
  .eq('id', child_id)
  .single();

if (!child || child.parent_id !== parent_id) {
  return new Response(
    JSON.stringify({ error: 'UNAUTHORIZED' }),
    { status: 401 }
  );
}
```

---

## SQL Injection Prevention

### Parameterized Queries

```typescript
// ✅ Safe: Supabase client uses parameterized queries
const { data } = await supabase
  .from('orders')
  .select('*')
  .eq('parent_id', parentId);

// ❌ Dangerous: Never construct raw SQL from user input
const result = await supabase.rpc('raw_query', {
  query: `SELECT * FROM orders WHERE parent_id = '${parentId}'`
});
```

---

## XSS Prevention

### Content Security Policy

```html
<!-- In index.html -->
<meta http-equiv="Content-Security-Policy" 
      content="default-src 'self'; 
               script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; 
               style-src 'self' 'unsafe-inline'; 
               img-src 'self' data: https:; 
               connect-src 'self' https://*.supabase.co;">
```

### React Auto-Escaping

React automatically escapes content:

```tsx
// Safe: React escapes malicious content
<div>{userInput}</div>

// Dangerous: Only use dangerouslySetInnerHTML for trusted content
<div dangerouslySetInnerHTML={{ __html: sanitizedHTML }} />
```

---

## CSRF Protection

### Supabase JWT

Supabase JWTs in `Authorization` header prevent CSRF:

```typescript
const { data, error } = await supabase.auth.getSession();
const token = data.session?.access_token;

fetch(`${SUPABASE_URL}/functions/v1/process-order`, {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
});
```

No cookies = no CSRF vulnerability.

---

## Rate Limiting

### Supabase Edge Functions

Built-in rate limiting:

- 100 requests/minute per user
- 1000 requests/hour per IP

### Custom Rate Limiting (Optional)

```typescript
// In Edge Function
const rateLimitKey = `rate_limit:${parent_id}`;
const count = await redis.incr(rateLimitKey);

if (count === 1) {
  await redis.expire(rateLimitKey, 60); // 1 minute
}

if (count > 20) {
  return new Response(
    JSON.stringify({ error: 'RATE_LIMIT_EXCEEDED' }),
    { status: 429 }
  );
}
```

---

## Secrets Management

### Environment Variables

```bash
# .env (NEVER commit to Git)
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGc...

# Supabase secrets (for Edge Functions)
GCASH_API_KEY=xxx
PAYMONGO_SECRET_KEY=xxx
```

### Rotate Keys Regularly

- **Supabase Keys**: Rotate every 6 months
- **Payment Keys**: Rotate annually
- **VAPID Keys**: Rotate on suspected compromise

---

## Payment Security

### PCI DSS Compliance

**Never store**:

- Credit card numbers
- CVV codes
- Card expiration dates

### Tokenization

Use PayMongo/GCash tokenization:

```typescript
// Client-side: Create token
const token = await PayMongo.createToken({
  type: 'card',
  details: { /* card info */ }
});

// Send only token to backend
await processPayment({ token: token.id });
```

---

## Philippine Data Privacy Act (DPA)

### Requirements

1. **Consent**: Explicit consent for data collection
2. **Purpose Limitation**: Use data only for stated purpose
3. **Data Retention**: Delete data when no longer needed
4. **Access Rights**: Allow users to view/export their data
5. **Breach Notification**: Notify within 72 hours

### Implementation

```typescript
// Privacy consent on signup
<Checkbox required>
  I consent to the collection and processing of my personal data
  as described in the <Link to="/privacy">Privacy Policy</Link>
</Checkbox>

// Data export
async function exportUserData(parentId: string) {
  const { data: parent } = await supabase
    .from('parents')
    .select('*')
    .eq('id', parentId)
    .single();
  
  const { data: children } = await supabase
    .from('children')
    .select('*')
    .eq('parent_id', parentId);
  
  const { data: orders } = await supabase
    .from('orders')
    .select('*, order_items(*)')
    .eq('parent_id', parentId);
  
  return { parent, children, orders };
}

// Data deletion
async function deleteAccount(parentId: string) {
  // Cascade delete handled by foreign key constraints
  await supabase.auth.admin.deleteUser(parentId);
}
```

---

## Logging & Monitoring

### What to Log

- Authentication attempts (success/failure)
- Order creations
- Payment transactions
- Admin actions
- Error rates

### What NOT to Log

- Passwords
- Credit card numbers
- Session tokens
- PII without redaction

### Example

```typescript
// ✅ Good
logger.info('Order created', {
  order_id: orderId,
  parent_id: parentId, // UUID is fine
  item_count: items.length,
  total_amount: totalAmount
});

// ❌ Bad
logger.info('Order created', {
  parent_email: 'john@example.com', // PII
  card_number: '1234-5678-9012-3456' // Sensitive
});
```

---

## Incident Response Plan

### 1. Detection

- Monitor error rates in Supabase Dashboard
- Set up alerts for unusual activity
- Weekly security log reviews

### 2. Containment

- Revoke compromised API keys immediately
- Temporarily disable affected features
- Block malicious IPs

### 3. Investigation

- Review logs to identify breach scope
- Check for unauthorized data access
- Document timeline

### 4. Recovery

- Patch vulnerability
- Rotate all keys
- Restore from backup if needed

### 5. Notification

- Notify affected users within 72 hours (DPA requirement)
- Report to National Privacy Commission (PH)
- Update security measures

---

## Security Checklist

### Pre-Launch

- [ ] RLS enabled on all tables
- [ ] Input validation on frontend and backend
- [ ] Secrets in environment variables (not code)
- [ ] HTTPS enabled
- [ ] CSP headers configured
- [ ] Rate limiting tested
- [ ] Privacy policy published
- [ ] Terms of service published

### Post-Launch

- [ ] Weekly log reviews
- [ ] Monthly dependency updates
- [ ] Quarterly security audits
- [ ] Annual penetration testing

---

## Reporting Vulnerabilities

**Security Email**: <security@yourschool.edu.ph>

**Response Time**: 24 hours

**Disclosure Policy**: Responsible disclosure with 90-day embargo.

---

## Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Supabase Security Best Practices](https://supabase.com/docs/guides/auth/security)
- [Philippine Data Privacy Act](https://www.privacy.gov.ph/data-privacy-act/)
