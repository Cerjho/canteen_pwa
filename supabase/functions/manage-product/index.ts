// Manage Product Edge Function
// Secure server-side product management (CRUD operations)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

// Allow specific origins in production, fallback to * for development
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') || '*').split(',');

function getCorsHeaders(origin: string | null): Record<string, string> {
  const allowedOrigin = ALLOWED_ORIGINS.includes('*') 
    ? '*' 
    : (origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]);
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

type ProductCategory = 'mains' | 'snacks' | 'drinks';
type Action = 'create' | 'update' | 'delete' | 'toggle-availability' | 'update-stock';

interface ProductData {
  name: string;
  description?: string;
  price: number;
  category: ProductCategory;
  stock_quantity: number;
  image_url?: string;
  available?: boolean;
}

interface ManageProductRequest {
  action: Action;
  product_id?: string;
  data?: Partial<ProductData>;
  quantity?: number; // For stock updates
}

// Validation constants
const MAX_PRICE = 10000;
const MIN_PRICE = 0.01;
const MAX_STOCK = 99999;
const MAX_NAME_LENGTH = 100;
const VALID_CATEGORIES: ProductCategory[] = ['mains', 'snacks', 'drinks'];

serve(async (req) => {
  const origin = req.headers.get('Origin');
  const corsHeaders = getCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'UNAUTHORIZED', message: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    // Verify user
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'UNAUTHORIZED', message: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if user is admin
    const userRole = user.user_metadata?.role;
    if (userRole !== 'admin') {
      return new Response(
        JSON.stringify({ error: 'FORBIDDEN', message: 'Admin access required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body: ManageProductRequest = await req.json();
    const { action, product_id, data, quantity } = body;

    // Validate action
    const validActions: Action[] = ['create', 'update', 'delete', 'toggle-availability', 'update-stock'];
    if (!validActions.includes(action)) {
      return new Response(
        JSON.stringify({ error: 'VALIDATION_ERROR', message: `Invalid action. Must be: ${validActions.join(', ')}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Actions requiring product_id
    if (['update', 'delete', 'toggle-availability', 'update-stock'].includes(action) && !product_id) {
      return new Response(
        JSON.stringify({ error: 'VALIDATION_ERROR', message: 'product_id is required for this action' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Handle each action
    switch (action) {
      case 'create': {
        if (!data || !data.name || !data.price || !data.category) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: 'name, price, and category are required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Validate data
        if (data.name.length > MAX_NAME_LENGTH) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: `Name must be ${MAX_NAME_LENGTH} characters or less` }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (data.price < MIN_PRICE || data.price > MAX_PRICE) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: `Price must be between ₱${MIN_PRICE} and ₱${MAX_PRICE}` }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (!VALID_CATEGORIES.includes(data.category)) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: `Category must be: ${VALID_CATEGORIES.join(', ')}` }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const stockQty = data.stock_quantity ?? 0;
        if (stockQty < 0 || stockQty > MAX_STOCK) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: `Stock must be between 0 and ${MAX_STOCK}` }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Sanitize image URL
        const imageUrl = data.image_url ? sanitizeUrl(data.image_url) : null;

        const { data: newProduct, error: createError } = await supabaseAdmin
          .from('products')
          .insert({
            name: data.name.trim(),
            description: data.description?.trim() || null,
            price: data.price,
            category: data.category,
            stock_quantity: stockQty,
            image_url: imageUrl,
            available: data.available ?? true
          })
          .select()
          .single();

        if (createError) {
          console.error('Product create error:', createError);
          return new Response(
            JSON.stringify({ error: 'CREATE_FAILED', message: 'Failed to create product' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log(`[AUDIT] Admin ${user.email} created product: ${data.name}`);

        return new Response(
          JSON.stringify({ success: true, product: newProduct }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'update': {
        if (!data || Object.keys(data).length === 0) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: 'No data provided for update' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Fetch existing product
        const { data: existingProduct, error: fetchError } = await supabaseAdmin
          .from('products')
          .select('*')
          .eq('id', product_id)
          .single();

        if (fetchError || !existingProduct) {
          return new Response(
            JSON.stringify({ error: 'PRODUCT_NOT_FOUND', message: 'Product not found' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Build update object with validation
        const updateData: Record<string, any> = { updated_at: new Date().toISOString() };

        if (data.name !== undefined) {
          if (data.name.length > MAX_NAME_LENGTH) {
            return new Response(
              JSON.stringify({ error: 'VALIDATION_ERROR', message: `Name must be ${MAX_NAME_LENGTH} characters or less` }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
          updateData.name = data.name.trim();
        }

        if (data.price !== undefined) {
          if (data.price < MIN_PRICE || data.price > MAX_PRICE) {
            return new Response(
              JSON.stringify({ error: 'VALIDATION_ERROR', message: `Price must be between ₱${MIN_PRICE} and ₱${MAX_PRICE}` }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
          updateData.price = data.price;
        }

        if (data.category !== undefined) {
          if (!VALID_CATEGORIES.includes(data.category)) {
            return new Response(
              JSON.stringify({ error: 'VALIDATION_ERROR', message: `Category must be: ${VALID_CATEGORIES.join(', ')}` }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
          updateData.category = data.category;
        }

        if (data.stock_quantity !== undefined) {
          if (data.stock_quantity < 0 || data.stock_quantity > MAX_STOCK) {
            return new Response(
              JSON.stringify({ error: 'VALIDATION_ERROR', message: `Stock must be between 0 and ${MAX_STOCK}` }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
          updateData.stock_quantity = data.stock_quantity;
        }

        if (data.description !== undefined) {
          updateData.description = data.description?.trim() || null;
        }

        if (data.image_url !== undefined) {
          updateData.image_url = data.image_url ? sanitizeUrl(data.image_url) : null;
        }

        if (data.available !== undefined) {
          updateData.available = data.available;
        }

        const { data: updatedProduct, error: updateError } = await supabaseAdmin
          .from('products')
          .update(updateData)
          .eq('id', product_id)
          .select()
          .single();

        if (updateError) {
          console.error('Product update error:', updateError);
          return new Response(
            JSON.stringify({ error: 'UPDATE_FAILED', message: 'Failed to update product' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log(`[AUDIT] Admin ${user.email} updated product ${product_id}: ${JSON.stringify(updateData)}`);

        return new Response(
          JSON.stringify({ success: true, product: updatedProduct }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'delete': {
        // Check for pending orders with this product
        const { count: pendingOrders } = await supabaseAdmin
          .from('order_items')
          .select('id', { count: 'exact', head: true })
          .eq('product_id', product_id)
          .in('order_id', 
            supabaseAdmin
              .from('orders')
              .select('id')
              .in('status', ['pending', 'preparing', 'ready'])
          );

        if (pendingOrders && pendingOrders > 0) {
          return new Response(
            JSON.stringify({ 
              error: 'HAS_PENDING_ORDERS', 
              message: `Cannot delete: ${pendingOrders} pending order(s) contain this product. Mark as unavailable instead.` 
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Soft delete - mark as unavailable and rename
        const { error: deleteError } = await supabaseAdmin
          .from('products')
          .update({ 
            available: false, 
            name: supabaseAdmin.rpc('', {}), // Will use actual delete below
            updated_at: new Date().toISOString()
          })
          .eq('id', product_id);

        // Actually delete if no orders reference it
        const { count: totalOrders } = await supabaseAdmin
          .from('order_items')
          .select('id', { count: 'exact', head: true })
          .eq('product_id', product_id);

        if (!totalOrders || totalOrders === 0) {
          // Safe to hard delete
          await supabaseAdmin.from('products').delete().eq('id', product_id);
          console.log(`[AUDIT] Admin ${user.email} hard deleted product ${product_id}`);
        } else {
          // Soft delete - just mark unavailable
          await supabaseAdmin
            .from('products')
            .update({ available: false, updated_at: new Date().toISOString() })
            .eq('id', product_id);
          console.log(`[AUDIT] Admin ${user.email} soft deleted product ${product_id} (has ${totalOrders} order references)`);
        }

        return new Response(
          JSON.stringify({ success: true, product_id, soft_delete: (totalOrders || 0) > 0 }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'toggle-availability': {
        const { data: product, error: fetchError } = await supabaseAdmin
          .from('products')
          .select('available')
          .eq('id', product_id)
          .single();

        if (fetchError || !product) {
          return new Response(
            JSON.stringify({ error: 'PRODUCT_NOT_FOUND', message: 'Product not found' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const newAvailability = !product.available;

        const { error: updateError } = await supabaseAdmin
          .from('products')
          .update({ available: newAvailability, updated_at: new Date().toISOString() })
          .eq('id', product_id);

        if (updateError) {
          return new Response(
            JSON.stringify({ error: 'UPDATE_FAILED', message: 'Failed to toggle availability' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log(`[AUDIT] Admin ${user.email} toggled product ${product_id} availability to ${newAvailability}`);

        return new Response(
          JSON.stringify({ success: true, product_id, available: newAvailability }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'update-stock': {
        if (quantity === undefined || quantity === null) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: 'quantity is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (quantity < 0 || quantity > MAX_STOCK) {
          return new Response(
            JSON.stringify({ error: 'VALIDATION_ERROR', message: `Stock must be between 0 and ${MAX_STOCK}` }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { data: updatedProduct, error: updateError } = await supabaseAdmin
          .from('products')
          .update({ stock_quantity: quantity, updated_at: new Date().toISOString() })
          .eq('id', product_id)
          .select()
          .single();

        if (updateError) {
          return new Response(
            JSON.stringify({ error: 'UPDATE_FAILED', message: 'Failed to update stock' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log(`[AUDIT] Admin ${user.email} updated stock for product ${product_id} to ${quantity}`);

        return new Response(
          JSON.stringify({ success: true, product: updatedProduct }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ error: 'INVALID_ACTION', message: 'Unknown action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'SERVER_ERROR', message: 'An unexpected error occurred' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// Sanitize URL to prevent XSS
function sanitizeUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    // Only allow https URLs or data URLs for images
    if (parsed.protocol === 'https:' || parsed.protocol === 'data:') {
      return url;
    }
    return null;
  } catch {
    return null;
  }
}
