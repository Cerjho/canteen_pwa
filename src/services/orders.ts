import { supabase } from './supabaseClient';
import { queueOrder, isOnline } from './localQueue';

export interface CreateOrderRequest {
  parent_id: string;
  child_id: string;
  client_order_id: string;
  items: Array<{
    product_id: string;
    quantity: number;
    price_at_order: number;
  }>;
  payment_method: string;
  notes?: string;
  scheduled_for?: string; // Date string YYYY-MM-DD for future orders
}

export async function createOrder(orderData: CreateOrderRequest) {
  // Check if online
  if (!isOnline()) {
    // Queue for offline sync
    await queueOrder(orderData);
    return { queued: true };
  }

  // Process order via Edge Function
  const { data, error } = await supabase.functions.invoke('process-order', {
    body: orderData
  });

  if (error) throw error;
  return data;
}

export async function getOrderHistory(parentId: string) {
  const { data, error } = await supabase
    .from('orders')
    .select(`
      *,
      child:children(first_name, last_name),
      items:order_items(
        *,
        product:products(name, image_url)
      )
    `)
    .eq('parent_id', parentId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) throw error;
  return data;
}