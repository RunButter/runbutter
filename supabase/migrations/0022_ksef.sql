-- ============================================================================
-- RunButter Platform Core — 0022_ksef.sql
-- KSeF (Poland e-invoicing) groundwork: the seller's own NIP on the workspace,
-- KSeF reference columns on invoices, and seller/buyer tax_id + address surfaced
-- in get_invoice_document so an FA(3) XML can be generated. Additive & prod-safe.
-- Depends on 0001–0021. Run AFTER them.  (Live KSeF submission is a later phase.)
-- ============================================================================

alter table workspaces add column if not exists tax_id text;            -- seller NIP
alter table invoices   add column if not exists ksef_ref text;          -- KSeF number / UPO ref
alter table invoices   add column if not exists ksef_status text;       -- pending | sent | rejected

-- Branding RPCs carry the seller NIP.
create or replace function get_workspace_branding(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return (select to_jsonb(t) from (
    select name, logo_url, legal_name, address, accent_color, invoice_footer, tax_id
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
    invoice_footer = nullif(p_data->>'invoice_footer',''),
    tax_id         = nullif(p_data->>'tax_id','')
  where id = p_workspace;
end $$;
grant execute on function save_workspace_branding(text, uuid, jsonb) to authenticated, anon;

-- get_invoice_document — seller + buyer now carry tax_id/address (from 0019 + fields).
create or replace function get_invoice_document(p_privy text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  my uuid[] := (select array_agg(workspace_id) from accounts where privy_user_id = p_privy);
  v_inv invoices;
  ws workspaces;
  v_buyer jsonb;
  v_items jsonb;
  v_gross numeric; v_discount numeric; v_tax numeric; v_net numeric;
begin
  select * into v_inv from invoices where id = p_id and workspace_id = any(my);
  if not found then return null; end if;

  select * into ws from workspaces where id = v_inv.workspace_id;
  select to_jsonb(o) into v_buyer from (
    select name, domain, industry, tax_id, address, country from organizations where id = v_inv.organization_id
  ) o;

  select coalesce(jsonb_agg(jsonb_build_object(
    'description', coalesce(nullif(it.description,''), p.name, 'Item'),
    'product', p.name,
    'product_id', it.product_id,
    'image', p.image_url,
    'quantity', it.quantity,
    'unit_price', it.unit_price,
    'discount_pct', it.discount_pct,
    'tax_rate', it.tax_rate,
    'line_total', round(it.quantity * it.unit_price * (1 - coalesce(it.discount_pct,0)/100), 2)
  ) order by it.position, it.created_at), '[]'::jsonb)
  into v_items
  from invoice_items it left join products p on p.id = it.product_id
  where it.invoice_id = v_inv.id;

  select
    coalesce(sum(quantity * unit_price), 0),
    coalesce(sum(quantity * unit_price * coalesce(discount_pct,0)/100), 0),
    coalesce(sum(quantity * unit_price * (1 - coalesce(discount_pct,0)/100) * coalesce(tax_rate,0)/100), 0)
  into v_gross, v_discount, v_tax
  from invoice_items where invoice_id = v_inv.id;
  v_net := v_gross - v_discount;

  return jsonb_build_object(
    'id', v_inv.id, 'number', v_inv.number, 'kind', v_inv.kind, 'direction', v_inv.direction,
    'status', v_inv.status, 'currency', v_inv.currency, 'amount', v_inv.amount, 'category', v_inv.category,
    'issued_at', v_inv.issued_at, 'due_at', v_inv.due_at, 'notes', v_inv.notes,
    'ksef_ref', v_inv.ksef_ref, 'ksef_status', v_inv.ksef_status,
    'seller', jsonb_build_object(
      'name', coalesce(nullif(ws.legal_name,''), ws.name, 'Your company'),
      'logo_url', ws.logo_url,
      'accent_color', coalesce(nullif(ws.accent_color,''), '#6366F1'),
      'address', ws.address,
      'footer', ws.invoice_footer,
      'tax_id', ws.tax_id
    ),
    'buyer', v_buyer,
    'items', v_items,
    'totals', jsonb_build_object(
      'subtotal', round(v_gross, 2),
      'discount', round(v_discount, 2),
      'net',      round(v_net, 2),
      'tax',      round(v_tax, 2),
      'total',    round(v_net + v_tax, 2)
    )
  );
end $$;
grant execute on function get_invoice_document(text, uuid) to authenticated, anon;

notify pgrst, 'reload schema';
