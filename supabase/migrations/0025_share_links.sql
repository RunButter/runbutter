-- ============================================================================
-- HireBTR Platform Core — 0025_share_links.sql
-- Public share links for invoice/offer documents. Fixes: the email's "view"
-- link pointed at the login-gated document page, so recipients (no account)
-- saw the sample document instead of the real one.
--   - invoices.share_token: unguessable 128-bit hex secret per document
--   - get_invoice_document_public(id, token): same document payload, no login
--   - get_invoice_document: redefined (from 0024) to also return share_token
-- Additive & prod-safe. Depends on 0001–0024. Run AFTER them.
-- ============================================================================

alter table invoices add column if not exists share_token text;
alter table invoices alter column share_token set default replace(gen_random_uuid()::text, '-', '');
update invoices set share_token = replace(gen_random_uuid()::text, '-', '') where share_token is null;

-- Public reader: the token IS the authorisation (128-bit random, per document).
create or replace function get_invoice_document_public(p_id uuid, p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_inv invoices;
  ws workspaces;
  v_buyer jsonb;
  v_items jsonb;
  v_gross numeric; v_discount numeric; v_tax numeric; v_net numeric;
begin
  if p_token is null or length(p_token) < 16 then return null; end if;
  select * into v_inv from invoices where id = p_id and share_token = p_token;
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
    'seller', jsonb_build_object(
      'name', coalesce(nullif(ws.legal_name,''), ws.name, 'Your company'),
      'logo_url', ws.logo_url,
      'accent_color', coalesce(nullif(ws.accent_color,''), '#6366F1'),
      'address', ws.address,
      'footer', ws.invoice_footer,
      'tax_id', ws.tax_id,
      'country', ws.country,
      'vat_id', ws.vat_id,
      'reg_no', ws.reg_no,
      'bdo', ws.bdo,
      'iban', ws.iban,
      'bank_name', ws.bank_name
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
grant execute on function get_invoice_document_public(uuid, text) to authenticated, anon;

-- Owner reader — redefined from 0024 to also return share_token (for building
-- the email link and a future "copy share link" button).
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

  -- self-heal docs created before this migration
  if v_inv.share_token is null then
    update invoices set share_token = replace(gen_random_uuid()::text, '-', '')
    where id = v_inv.id returning share_token into v_inv.share_token;
  end if;

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
    'share_token', v_inv.share_token,
    'seller', jsonb_build_object(
      'name', coalesce(nullif(ws.legal_name,''), ws.name, 'Your company'),
      'logo_url', ws.logo_url,
      'accent_color', coalesce(nullif(ws.accent_color,''), '#6366F1'),
      'address', ws.address,
      'footer', ws.invoice_footer,
      'tax_id', ws.tax_id,
      'country', ws.country,
      'vat_id', ws.vat_id,
      'reg_no', ws.reg_no,
      'bdo', ws.bdo,
      'iban', ws.iban,
      'bank_name', ws.bank_name
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
