-- ============================================
-- CRITICAL FIX: Lock down invitations SELECT policy
-- Previously USING (true) — allowed any user (including anon) to enumerate
-- all invitation codes, enabling privilege escalation.
-- Now restricted to admin-only SELECT.
-- Registration flow is unaffected: verify-invitation edge function uses
-- service_role key which bypasses RLS.
-- ============================================

-- Drop the overly permissive SELECT policy
DROP POLICY IF EXISTS "Anyone can read invitation by code" ON invitations;

-- Only admins can list/read invitations
CREATE POLICY "Admin can read invitations"
  ON invitations FOR SELECT
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

-- ============================================
-- HIGH-PRIORITY FIX: Restrict audit_logs INSERT
-- Previously WITH CHECK (TRUE) — allowed any authenticated user to insert
-- arbitrary audit log entries, poisoning the audit trail.
-- Now restricted to staff/admin only.
-- ============================================

DROP POLICY IF EXISTS "System can insert audit logs" ON audit_logs;

CREATE POLICY "Staff and admin can insert audit logs"
  ON audit_logs FOR INSERT
  WITH CHECK (
    (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff')
  );
