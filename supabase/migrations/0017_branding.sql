-- ============================================================================
-- RunButter Platform Core — 0017_branding.sql
-- Workspace branding for documents: logo, legal name, address, accent colour,
-- and an invoice footer. Surfaced on the invoice/offer PDF + email. Adds a
-- public 'branding' storage bucket for logo uploads. Additive & prod-safe.
-- Depends on 0001–0016. Run AFTER them.
-- ============================================================================

-- 1. Branding columns on the workspace.
alter table workspaces add column if not exists logo_url text;
alter table workspaces add column if not exists legal_name text;
alter table workspaces add column if not exists address text;
alter table workspaces add column if not exists accent_color text not null default '#6366F1';
alter table workspaces add column if not exists invoice_footer text;

-- 2. Public storage bucket for logo uploads (+ permissive policies, matching the
--    project's current open posture — tighten later).
insert into storage.buckets (id, name, public) values ('branding', 'branding', true)
  on conflict (id) do nothing;

drop policy if exists "branding_read"   on storage.objects;
drop policy if exists "branding_write"  on storage.objects;
drop policy if exists "branding_update" on storage.objects;
drop policy if exists "branding_delete" on storage.objects;
create policy "branding_read"   on storage.objects for select using (bucket_id = 'branding');
create policy "branding_write"  on storage.objects for insert with check (bucket_id = 'branding');
create policy "branding_update" on storage.objects for update using (bucket_id = 'branding');
create policy "branding_delete" on storage.objects for delete using (bucket_id = 'branding');

-- 3. Branding read/write RPCs.
create or replace function get_workspace_branding(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return (select to_jsonb(t) from (
    select name, logo_url, legal_name, address, accent_color, invoice_footer
    from workspaces where id = p_workspace
  ) t);
end $$;
grant execute on function get_workspace_branding(text, uuid) to authenticated, anon;

create or replace function save_workspace_branding(p_privy text, p_workspace uuid, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  update workspaces set
    logo_url       = nullif(p_data->>'logo_url',''),
    legal_name     = nullif(p_data->>'legal_name',''),
    address        = nullif(p_data->>'address',''),
    accent_color   = coalesce(nullif(p_data->>'accent_color',''), accent_color),
    invoice_footer = nullif(p_data->>'invoice_footer','')
  where id = p_workspace;
end $$;
grant execute on function save_workspace_branding(text, uuid, jsonb) to authenticated, anon;

-- 4. get_invoice_document — seller now carries branding (redefined from 0016).
create or replace function get_invoice_document(p_privy text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  my uuid[] := (select array_agg(workspace_id) from accounts where privy_user_id = p_privy);
  v_inv invoices;
  ws workspaces;
  v_buyer jsonb;
  v_items jsonb;
begin
  select * into v_inv from invoices where id = p_id and workspace_id = any(my);
  if not found then return null; end if;

  select * into ws from workspaces where id = v_inv.workspace_id;
  select to_jsonb(o) into v_buyer from (
    select name, domain, industry from organizations where id = v_inv.organization_id
  ) o;
  select coalesce(jsonb_agg(jsonb_build_object(
    'description', coalesce(nullif(it.description,''), p.name, 'Item'),
    'product', p.name,
    'product_id', it.product_id,
    'quantity', it.quantity,
    'unit_price', it.unit_price,
    'line_total', it.line_total
  ) order by it.position, it.created_at), '[]'::jsonb)
  into v_items
  from invoice_items it left join products p on p.id = it.product_id
  where it.invoice_id = v_inv.id;

  return jsonb_build_object(
    'id', v_inv.id, 'number', v_inv.number, 'kind', v_inv.kind, 'direction', v_inv.direction,
    'status', v_inv.status, 'currency', v_inv.currency, 'amount', v_inv.amount, 'category', v_inv.category,
    'issued_at', v_inv.issued_at, 'due_at', v_inv.due_at, 'notes', v_inv.notes,
    'seller', jsonb_build_object(
      'name', coalesce(nullif(ws.legal_name,''), ws.name, 'Your company'),
      'logo_url', ws.logo_url,
      'accent_color', coalesce(nullif(ws.accent_color,''), '#6366F1'),
      'address', ws.address,
      'footer', ws.invoice_footer
    ),
    'buyer', v_buyer,
    'items', v_items
  );
end $$;
grant execute on function get_invoice_document(text, uuid) to authenticated, anon;

notify pgrst, 'reload schema';
