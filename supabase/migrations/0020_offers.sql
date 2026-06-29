-- ============================================================================
-- HireBTR Platform Core — 0020_offers.sql
-- Quote-to-cash: convert an accepted offer into a draft invoice (clones the
-- offer + its line items, recomputes the total, marks the offer accepted).
-- Offers themselves are invoices with kind='offer' — the data layer maps the
-- 'offers' object onto the invoices table, so no CRUD redefinition is needed.
-- Additive & prod-safe. Depends on 0001–0019. Run AFTER them.
-- ============================================================================

create or replace function convert_offer_to_invoice(p_privy text, p_offer uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  my uuid[] := (select array_agg(workspace_id) from accounts where privy_user_id = p_privy);
  o invoices;
  v_new uuid;
  v_net numeric;
  v_tax numeric;
begin
  select * into o from invoices where id = p_offer and workspace_id = any(my) and kind = 'offer';
  if not found then raise exception 'OFFER_NOT_FOUND_OR_FORBIDDEN'; end if;

  -- clone the header into a fresh draft invoice (OFF-#### -> INV-####)
  insert into invoices (workspace_id, number, organization_id, kind, direction, currency, category, status, issued_at, due_at, notes)
  values (o.workspace_id, nullif(regexp_replace(coalesce(o.number,''), '^OFF', 'INV'), ''), o.organization_id,
          'invoice', 'income', o.currency, o.category, 'draft', current_date, current_date + 14, o.notes)
  returning id into v_new;

  -- clone the line items (positions)
  insert into invoice_items (workspace_id, invoice_id, product_id, description, quantity, unit_price, discount_pct, tax_rate, position)
  select workspace_id, v_new, product_id, description, quantity, unit_price, discount_pct, tax_rate, position
  from invoice_items where invoice_id = p_offer;

  -- keep the invoice total in sync (net + VAT)
  select coalesce(sum(quantity * unit_price * (1 - coalesce(discount_pct,0)/100)), 0),
         coalesce(sum(quantity * unit_price * (1 - coalesce(discount_pct,0)/100) * coalesce(tax_rate,0)/100), 0)
  into v_net, v_tax
  from invoice_items where invoice_id = v_new;
  update invoices set amount = round(v_net + v_tax, 2) where id = v_new;

  -- mark the offer accepted
  update invoices set status = 'accepted' where id = p_offer;

  return v_new;
end $$;
grant execute on function convert_offer_to_invoice(text, uuid) to authenticated, anon;

notify pgrst, 'reload schema';
