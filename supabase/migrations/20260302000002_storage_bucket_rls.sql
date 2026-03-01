-- Migration: Storage bucket creation + RLS policies for product-images
-- Ensures the bucket exists and has proper access controls

-- Create (or confirm) the product-images bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO NOTHING;

-- ── RLS Policies ────────────────────────────────────────────

-- Anyone can read product images (public bucket)
CREATE POLICY "Public read access on product-images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'product-images');

-- Only staff/admin can upload product images
CREATE POLICY "Staff and admin can upload product images"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'product-images'
    AND (
      (auth.jwt() ->> 'role')::text = 'service_role'
      OR (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff')
    )
  );

-- Only staff/admin can update (overwrite) product images
CREATE POLICY "Staff and admin can update product images"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'product-images'
    AND (
      (auth.jwt() ->> 'role')::text = 'service_role'
      OR (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff')
    )
  );

-- Only admin can delete product images
CREATE POLICY "Admin can delete product images"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'product-images'
    AND (
      (auth.jwt() ->> 'role')::text = 'service_role'
      OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    )
  );
