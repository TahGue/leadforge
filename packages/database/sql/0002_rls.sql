-- Optional defense-in-depth: row level security for organization-scoped tables.
--
-- The application always filters by organization_id. This migration adds the
-- same rule at the database so a missing filter fails closed instead of leaking.
--
-- Apply with: node scripts/enable-rls.mjs
-- Requirements:
--   * The application must connect as a NON-OWNER role (owners bypass RLS unless
--     FORCE is set, and FORCE would break auth queries before an org is known).
--   * Each request transaction must run:
--       SET LOCAL app.organization_id = '<org id>';
--     which the API's withOrg() helper does when ENABLE_RLS=true.

DO $$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'Company',
    'Contact',
    'Source',
    'DiscoveryProject',
    'CrawlTarget',
    'ExtractionCandidate',
    'SourceEvidence',
    'Campaign',
    'EmailTemplate',
    'ImportJob',
    'LawfulBasisRecord',
    'ConsentRecord',
    'SuppressionEntry',
    'EligibilityDecision',
    'DataSubjectRequest'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', target || '_org_isolation', target);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING ("organizationId" = current_setting(''app.organization_id'', true))',
      target || '_org_isolation',
      target
    );
  END LOOP;
END
$$;

-- Global suppression rows (organizationId IS NULL) must remain visible to every
-- tenant, so the policy above would hide them. Replace it with a policy that
-- allows global rows too.
DROP POLICY IF EXISTS "SuppressionEntry_org_isolation" ON "SuppressionEntry";
CREATE POLICY "SuppressionEntry_org_isolation" ON "SuppressionEntry"
  USING (
    "organizationId" IS NULL
    OR "organizationId" = current_setting('app.organization_id', true)
  );
