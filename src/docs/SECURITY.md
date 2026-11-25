# ByteBuild Security Notes

## Threat Model & Admin PIN
- The `VITE_ADMIN_PIN` gate in `src/App.jsx` is a **client-side convenience gate only** and is never a substitute for server-enforced authorization. If `VITE_ADMIN_PIN` is unset, PIN entry is disabled and admin access falls back to Supabase authentication matching `ADMIN_EMAILS`.
- Real write protection on inventory, pre-order, reference, and DSS settings tables depends on **Supabase Row Level Security (RLS)** (`docs/security/rls.sql`).

## RLS Policy Summary
- Inventory & DSS settings tables: public `SELECT`; write operations restricted to authenticated users present in `admin_emails`.
- `bytebuild_saved_builds`: users read/write only rows where `user_id = auth.uid()`.
- `bytebuild_quotations`: allows insert with `user_id` null (walk-in) or `auth.uid() = user_id`; select restricted to owner (`auth.uid() = user_id`).
- `bytebuild_preorder_requests`: insert allowed; select restricted to owner or admin.

## Verifying TC-63 (Unauthenticated Write Rejected)
Using `curl` with the anon key against REST API (must return HTTP 401/403 and no inserted row):
```bash
curl -i -X POST "$VITE_SUPABASE_URL/rest/v1/bytebuild_current_inventory" \
  -H "apikey: $VITE_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"Unauthorized Probe","category":"Processors","price":1000,"stock_status":"In Stock"}'