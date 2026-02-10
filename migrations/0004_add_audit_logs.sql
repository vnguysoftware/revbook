CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  actor_type VARCHAR(50) NOT NULL,
  actor_id VARCHAR(255) NOT NULL,
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(100) NOT NULL,
  resource_id VARCHAR(255),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS audit_logs_org_idx ON audit_logs(org_id);
CREATE INDEX IF NOT EXISTS audit_logs_org_action_idx ON audit_logs(org_id, action);
CREATE INDEX IF NOT EXISTS audit_logs_org_created_idx ON audit_logs(org_id, created_at);
