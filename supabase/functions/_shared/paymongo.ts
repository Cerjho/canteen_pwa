/**
 * Shared PayMongo API utilities for Supabase Edge Functions
 * 
 * Uses PayMongo Checkout Sessions API for GCash, PayMaya, and Card payments.
 * All amounts in PayMongo API are in centavos (₱1.00 = 100 centavos).
 */

const PAYMONGO_API_BASE = 'https://api.paymongo.com/v1';

function getAuthHeader(): string {
  const secretKey = Deno.env.get('PAYMONGO_SECRET_KEY');
  if (!secretKey) {
    throw new Error('PAYMONGO_SECRET_KEY is not configured');
  }
  // PayMongo uses Basic auth with secret key as username, empty password
  const encoded = btoa(secretKey + ':');
  return `Basic ${encoded}`;
}

function getAppUrl(): string {
  return Deno.env.get('APP_URL') || 'http://localhost:5173';
}

// ============================================
// TYPES
// ============================================

export interface PayMongoLineItem {
  name: string;
  quantity: number;
  amount: number; // centavos
  currency: string;
}

export interface CheckoutSessionMetadata {
  type: 'order' | 'topup';
  order_id?: string;
  payment_group_id?: string;
  parent_id: string;
  client_order_id?: string;
  topup_session_id?: string;
}

export interface CreateCheckoutSessionParams {
  lineItems: PayMongoLineItem[];
  paymentMethodTypes: string[];
  description: string;
  metadata: CheckoutSessionMetadata;
  successUrl: string;
  cancelUrl: string;
}

export interface PayMongoCheckoutSession {
  id: string;
  type: string;
  attributes: {
    checkout_url: string;
    status: string;
    payment_intent: { id: string } | null;
    payments: Array<{
      id: string;
      type: string;
      attributes: {
        amount: number;
        status: string;
        source: { type: string };
      };
    }>;
    metadata: Record<string, string>;
  };
}

export interface PayMongoWebhookEvent {
  data: {
    id: string;
    type: string;
    attributes: {
      type: string;
      data: PayMongoCheckoutSession;
    };
  };
}

// ============================================
// API FUNCTIONS
// ============================================

/**
 * Create a PayMongo Checkout Session
 */
export async function createCheckoutSession(
  params: CreateCheckoutSessionParams
): Promise<PayMongoCheckoutSession> {
  const response = await fetch(`${PAYMONGO_API_BASE}/checkout_sessions`, {
    method: 'POST',
    headers: {
      'Authorization': getAuthHeader(),
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      data: {
        attributes: {
          send_email_receipt: true,
          show_description: true,
          show_line_items: true,
          description: params.description,
          line_items: params.lineItems,
          payment_method_types: params.paymentMethodTypes,
          success_url: params.successUrl,
          cancel_url: params.cancelUrl,
          metadata: params.metadata,
        },
      },
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error('PayMongo create checkout session error:', response.status, errorBody);
    throw new Error(`PayMongo API error: ${response.status} - ${errorBody}`);
  }

  const json = await response.json();
  return json.data as PayMongoCheckoutSession;
}

/**
 * Retrieve a PayMongo Checkout Session by ID
 */
export async function getCheckoutSession(
  checkoutSessionId: string
): Promise<PayMongoCheckoutSession> {
  const response = await fetch(`${PAYMONGO_API_BASE}/checkout_sessions/${checkoutSessionId}`, {
    headers: {
      'Authorization': getAuthHeader(),
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`PayMongo API error: ${response.status} - ${errorBody}`);
  }

  const json = await response.json();
  return json.data as PayMongoCheckoutSession;
}

/**
 * Create a PayMongo Refund
 */
export async function createRefund(
  paymentId: string,
  amountCentavos: number,
  reason: 'requested_by_customer' | 'duplicate' | 'fraudulent',
  notes?: string,
): Promise<{ id: string; status: string }> {
  const response = await fetch(`${PAYMONGO_API_BASE}/refunds`, {
    method: 'POST',
    headers: {
      'Authorization': getAuthHeader(),
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      data: {
        attributes: {
          amount: amountCentavos,
          payment_id: paymentId,
          reason,
          notes: notes || 'Canteen order refund',
        },
      },
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error('PayMongo refund error:', response.status, errorBody);
    throw new Error(`PayMongo refund failed: ${response.status} - ${errorBody}`);
  }

  const json = await response.json();
  return {
    id: json.data.id,
    status: json.data.attributes.status,
  };
}

// ============================================
// WEBHOOK SIGNATURE VERIFICATION
// ============================================

/**
 * Verify PayMongo webhook signature
 * 
 * PayMongo signs webhooks with HMAC-SHA256.
 * Signature header format: t=timestamp,te=test_signature,li=live_signature
 */
export async function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string,
): Promise<boolean> {
  const webhookSecret = Deno.env.get('PAYMONGO_WEBHOOK_SECRET');
  if (!webhookSecret) {
    console.error('PAYMONGO_WEBHOOK_SECRET not configured');
    return false;
  }

  // Parse header parts
  const parts: Record<string, string> = {};
  signatureHeader.split(',').forEach(part => {
    const eqIndex = part.indexOf('=');
    if (eqIndex > 0) {
      const key = part.substring(0, eqIndex);
      const value = part.substring(eqIndex + 1);
      parts[key] = value;
    }
  });

  const timestamp = parts['t'];
  if (!timestamp) {
    console.error('Missing timestamp in webhook signature');
    return false;
  }

  // Check timestamp freshness (reject if > 5 min old)
  const age = Math.abs(Date.now() / 1000 - parseInt(timestamp));
  if (age > 300) {
    console.error('Webhook timestamp too old:', age, 'seconds');
    return false;
  }

  // Compute expected signature
  const payload = `${timestamp}.${rawBody}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(webhookSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  const computed = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  // Compare signature — try both te (test) and li (live), accept if either matches
  // In test mode, PayMongo sends valid 'te'; in live mode, valid 'li'
  const testSig = parts['te'];
  const liveSig = parts['li'];

  if (!testSig && !liveSig) {
    console.error('No signature found in header');
    return false;
  }

  // Constant-time comparison to prevent timing attacks
  const matchesSig = (expected: string): boolean => {
    if (!expected || computed.length !== expected.length) return false;
    const computedBuf = new TextEncoder().encode(computed);
    const expectedBuf = new TextEncoder().encode(expected);
    let mismatch = 0;
    for (let i = 0; i < computedBuf.length; i++) {
      mismatch |= computedBuf[i] ^ expectedBuf[i];
    }
    return mismatch === 0;
  };

  // Accept if either test or live signature matches
  const isValid = matchesSig(testSig) || matchesSig(liveSig);

  if (!isValid) {
    console.error('Webhook signature mismatch', {
      hasTestSig: !!testSig,
      hasLiveSig: !!liveSig,
      computedLength: computed.length,
      testSigLength: testSig?.length,
      liveSigLength: liveSig?.length,
    });
  }

  return isValid;
}

// ============================================
// HELPERS
// ============================================

/**
 * Convert PHP amount to centavos for PayMongo
 */
export function toCentavos(phpAmount: number): number {
  return Math.round(phpAmount * 100);
}

/**
 * Convert centavos back to PHP amount
 */
export function fromCentavos(centavos: number): number {
  return centavos / 100;
}

/**
 * Map our payment method names to PayMongo payment_method_types
 */
export function mapPaymentMethodTypes(method: string): string[] {
  switch (method) {
    case 'gcash': return ['gcash'];
    case 'paymaya': return ['paymaya'];
    case 'card': return ['card'];
    default: return ['gcash', 'paymaya', 'card'];
  }
}

/**
 * Build checkout success/cancel URLs
 */
export function buildCheckoutUrls(type: 'order' | 'topup', id: string): {
  successUrl: string;
  cancelUrl: string;
} {
  const appUrl = getAppUrl();
  if (type === 'order') {
    return {
      successUrl: `${appUrl}/order-confirmation?payment=success&order_id=${id}`,
      cancelUrl: `${appUrl}/order-confirmation?payment=cancelled&order_id=${id}`,
    };
  }
  return {
    successUrl: `${appUrl}/balance?topup=success&session=${id}`,
    cancelUrl: `${appUrl}/balance?topup=cancelled`,
  };
}

/**
 * Determine the actual payment method from a PayMongo payment source
 */
export function resolvePaymentMethod(
  payments: PayMongoCheckoutSession['attributes']['payments']
): string {
  const firstPayment = payments?.[0];
  if (!firstPayment) return 'paymongo';
  const sourceType = firstPayment.attributes?.source?.type;
  if (sourceType === 'gcash') return 'gcash';
  if (sourceType === 'paymaya' || sourceType === 'maya') return 'paymaya';
  if (sourceType === 'card') return 'card';
  return 'paymongo';
}
