-- Applied after all domain tables exist. Keep administrative writes narrower
-- than the cross-schema read privileges used for reporting.
GRANT SELECT ON ALL TABLES IN SCHEMA auth, product, inventory, "order", payment, delivery, notification, admin TO admin_svc;
GRANT SELECT ON ALL TABLES IN SCHEMA auth, product, inventory, "order", payment, delivery, notification, admin TO sync_worker;
GRANT UPDATE (is_active, updated_at) ON auth.users TO admin_svc;
GRANT DELETE ON auth.refresh_tokens TO admin_svc;
GRANT UPDATE (commission_rate, updated_at) ON auth.agent_profiles TO admin_svc;
GRANT UPDATE (status, settled_at) ON payment.agent_settlements TO admin_svc;
GRANT UPDATE (status, processed_at) ON payment.settlement_adjustments TO admin_svc;
