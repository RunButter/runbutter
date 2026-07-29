-- ============================================================================
-- RunButter — 0061_branding_expanded.sql
-- Branding grows from "logo on an invoice" to every surface a customer's
-- audience actually sees: the careers page, the apply form, outbound email,
-- documents, and the link preview when any of those is shared.
--
-- All of it hangs off `workspaces`, which already holds logo_url/accent_color
-- (0024), so there stays exactly ONE place a brand is defined. The careers copy
-- added in 0060 lives on `companies` for the public read path; everything
-- visual belongs here.
--
-- get/save_workspace_branding are redefined IN FULL rather than patched — same
-- discipline as the CRUD monolith, so the newest migration is always the whole
-- truth for these two functions.
-- Depends on 0024 (identity columns) + 0060 (careers page).
-- ============================================================================

-- Careers + apply surfaces
alter table workspaces add column if not exists cover_image_url text;   -- careers hero
alter table workspaces add column if not exists apply_intro     text;   -- shown above the apply form
-- Link previews (careers page, public forms, apply pages)
alter table workspaces add column if not exists favicon_url     text;
alter table workspaces add column if not exists og_image_url    text;
-- Outbound email (candidate status mails, invoice mails)
alter table workspaces add column if not exists email_from_name text;
alter table workspaces add column if not exists email_footer    text;
-- Documents beyond the invoice footer that already exists
alter table workspaces add column if not exists document_footer text;

create or replace function get_workspace_branding(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_build_object(
    'logo_url', logo_url, 'legal_name', legal_name, 'address', address,
    'accent_color', accent_color, 'invoice_footer', invoice_footer,
    'tax_id', tax_id, 'country', country, 'vat_id', vat_id, 'reg_no', reg_no,
    'bdo', bdo, 'iban', iban, 'bank_name', bank_name,
    'cover_image_url', cover_image_url, 'apply_intro', apply_intro,
    'favicon_url', favicon_url, 'og_image_url', og_image_url,
    'email_from_name', email_from_name, 'email_footer', email_footer,
    'document_footer', document_footer
  ) from workspaces where id = p_workspace), '{}'::jsonb);
end $$;

create or replace function save_workspace_branding(p_privy text, p_workspace uuid, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  update workspaces set
    logo_url        = nullif(p_data->>'logo_url',''),
    legal_name      = nullif(p_data->>'legal_name',''),
    address         = nullif(p_data->>'address',''),
    accent_color    = coalesce(nullif(p_data->>'accent_color',''), accent_color),
    invoice_footer  = nullif(p_data->>'invoice_footer',''),
    tax_id          = nullif(p_data->>'tax_id',''),
    country         = nullif(p_data->>'country',''),
    vat_id          = nullif(p_data->>'vat_id',''),
    reg_no          = nullif(p_data->>'reg_no',''),
    bdo             = nullif(p_data->>'bdo',''),
    iban            = nullif(p_data->>'iban',''),
    bank_name       = nullif(p_data->>'bank_name',''),
    -- `?` (key present) rather than a plain nullif: a caller that omits a key
    -- must leave it alone. Without this, any older client still posting the
    -- 0024 field set would blank every branding value added here.
    cover_image_url = case when p_data ? 'cover_image_url' then nullif(p_data->>'cover_image_url','') else cover_image_url end,
    apply_intro     = case when p_data ? 'apply_intro'     then nullif(p_data->>'apply_intro','')     else apply_intro end,
    favicon_url     = case when p_data ? 'favicon_url'     then nullif(p_data->>'favicon_url','')     else favicon_url end,
    og_image_url    = case when p_data ? 'og_image_url'    then nullif(p_data->>'og_image_url','')    else og_image_url end,
    email_from_name = case when p_data ? 'email_from_name' then nullif(p_data->>'email_from_name','') else email_from_name end,
    email_footer    = case when p_data ? 'email_footer'    then nullif(p_data->>'email_footer','')    else email_footer end,
    document_footer = case when p_data ? 'document_footer' then nullif(p_data->>'document_footer','') else document_footer end
  where id = p_workspace;
end $$;

-- Anon EXECUTE was granted in 0024, before the /api/rpc proxy existed (0046).
-- Revoke it here: branding is workspace data and must go through the proxy.
revoke all on function get_workspace_branding(text, uuid)          from public, anon, authenticated;
revoke all on function save_workspace_branding(text, uuid, jsonb)  from public, anon, authenticated;
grant execute on function get_workspace_branding(text, uuid)         to service_role;
grant execute on function save_workspace_branding(text, uuid, jsonb) to service_role;

-- ── Public read for the careers page ────────────────────────────────────────
-- Redefined from 0060 so the page can render the hero image, favicon and OG
-- image. Same contract otherwise.
create or replace function get_careers_page(p_slug text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_company uuid; v_out jsonb;
begin
  select id into v_company from companies where lower(careers_slug) = lower(trim(coalesce(p_slug, '')));
  if v_company is null then return null; end if;

  select jsonb_build_object(
    'company', jsonb_build_object(
      'id', c.id,
      'name', coalesce(nullif(w.legal_name, ''), c.name),
      'slug', c.careers_slug,
      'headline', c.careers_headline,
      'about', c.careers_about,
      'logo_url', coalesce(nullif(w.logo_url, ''), c.logo_url),
      'accent_color', nullif(w.accent_color, ''),
      'website', nullif(w.address, ''),
      'cover_image_url', nullif(w.cover_image_url, ''),
      'favicon_url', nullif(w.favicon_url, ''),
      'og_image_url', nullif(w.og_image_url, '')
    ),
    'positions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'title', p.title, 'department', p.department,
        'location', p.location, 'employment_type', p.employment_type,
        'created_at', p.created_at
      ) order by p.created_at desc)
      from positions p
      where p.company_id = v_company and p.is_active and p.is_published
    ), '[]'::jsonb)
  ) into v_out
  from companies c left join workspaces w on w.id = c.id
  where c.id = v_company;

  return v_out;
end $$;

revoke all on function get_careers_page(text) from public, anon, authenticated;
grant execute on function get_careers_page(text) to service_role;

notify pgrst, 'reload schema';
