-- ============================================================================
-- HireBTR Platform Core — 0018_quoting.sql
-- Real quoting: per-line discount % and tax/VAT % on invoice/offer line items,
-- with Subtotal / Discount / VAT / Total computed in get_invoice_document and
-- kept in sync on invoices.amount (grand total incl. VAT). Additive & prod-safe.
-- Depends on 0001–0017. Run AFTER them.
-- ============================================================================

-- 1. New per-line columns (the stored line_total stays gross = qty*unit_price;
--    discount/tax are applied in the functions below so we don't rebuild the
--    generated column).
alter table invoice_items add column if not exists discount_pct numeric(6,2) not null default 0;
alter table invoice_items add column if not exists tax_rate     numeric(6,2) not null default 0;

-- 2. save_invoice_items — store discount/tax; amount = net (after discount) + VAT.
create or replace function save_invoice_items(p_privy text, p_invoice uuid, p_items jsonb)
returns numeric language plpgsql security definer set search_path = public as $$
declare
  my uuid[] := (select array_agg(workspace_id) from accounts where privy_user_id = p_privy);
  v_ws uuid;
  v_net numeric;
  v_tax numeric;
  v_pos int := 0;
  itm jsonb;
begin
  select workspace_id into v_ws from invoices where id = p_invoice and workspace_id = any(my);
  if v_ws is null then raise exception 'NOT_FOUND_OR_FORBIDDEN'; end if;

  delete from invoice_items where invoice_id = p_invoice;
  for itm in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    insert into invoice_items (workspace_id, invoice_id, product_id, description, quantity, unit_price, discount_pct, tax_rate, position)
    values (
      v_ws, p_invoice, nullif(itm->>'product_id','')::uuid, nullif(itm->>'description',''),
      coalesce(nullif(itm->>'quantity','')::numeric, 1), coalesce(nullif(itm->>'unit_price','')::numeric, 0),
      coalesce(nullif(itm->>'discount_pct','')::numeric, 0), coalesce(nullif(itm->>'tax_rate','')::numeric, 0), v_pos
    );
    v_pos := v_pos + 1;
  end loop;

  select
    coalesce(sum(quantity * unit_price * (1 - coalesce(discount_pct,0)/100)), 0),
    coalesce(sum(quantity * unit_price * (1 - coalesce(discount_pct,0)/100) * coalesce(tax_rate,0)/100), 0)
  into v_net, v_tax
  from invoice_items where invoice_id = p_invoice;

  update invoices set amount = round(v_net + v_tax, 2) where id = p_invoice;
  return round(v_net + v_tax, 2);
end $$;
grant execute on function save_invoice_items(text, uuid, jsonb) to authenticated, anon;

-- 3. get_invoice_document — per-line discount/tax + a totals block (redefined from 0017).
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
    select name, domain, industry from organizations where id = v_inv.organization_id
  ) o;

  select coalesce(jsonb_agg(jsonb_build_object(
    'description', coalesce(nullif(it.description,''), p.name, 'Item'),
    'product', p.name,
    'product_id', it.product_id,
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
      'footer', ws.invoice_footer
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
