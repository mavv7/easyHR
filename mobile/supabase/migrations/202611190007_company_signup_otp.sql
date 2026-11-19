begin;

-- Existing registrations retain their prior activation flow. New registrations
-- must pass both Auth confirmations before company records can be provisioned.
alter table easyhr_private.company_registrations
  add column company_type text,
  add column tpin text,
  add column phone text;

alter table public.hr_company_settings
  add column company_type text check (company_type in ('sole_proprietorship','partnership','limited_company','nonprofit','public_body','other'));

create or replace function easyhr_private.register_company_signup() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  company text := trim(new.raw_user_meta_data ->> 'company_name');
  business_type text := new.raw_user_meta_data ->> 'company_type';
  tax_number text := new.raw_user_meta_data ->> 'tpin';
  mobile text := new.raw_user_meta_data ->> 'registration_phone';
begin
  if company is not null then
    if length(company) not between 2 and 120 or new.email is null then
      raise exception 'Enter a valid company name and work email';
    end if;
    if coalesce(business_type, '') not in ('sole_proprietorship','partnership','limited_company','nonprofit','public_body','other')
      or coalesce(tax_number, '') !~ '^[0-9]{10}$'
      or coalesce(mobile, '') !~ '^[+][1-9][0-9]{7,14}$'
    then raise exception 'Enter a company type, 10-digit TPIN and international phone number'; end if;
    insert into easyhr_private.company_registrations(user_id, company_name, company_type, tpin, phone)
      values (new.id, company, business_type, tax_number, mobile);
  elsif not exists (
    select 1 from easyhr_private.member_invitations where email = lower(new.email)
  ) then
    raise exception 'Company registration or HR approval required';
  end if;
  return new;
end $$;

create or replace function public.hr_activate_workspace() returns void
language plpgsql security definer set search_path = '' as $$
declare
  account uuid := auth.uid();
  email_address text;
  registration easyhr_private.company_registrations;
  mobile text;
  organization uuid;
  invitation easyhr_private.member_invitations;
begin
  select lower(email), case when phone_confirmed_at is not null and phone ~ '^[+]?[1-9][0-9]{7,14}$'
    then '+' || ltrim(phone, '+') end
    into email_address, mobile from auth.users where id = account and email_confirmed_at is not null;
  if email_address is null then return; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(email_address, 0));
  delete from easyhr_private.company_registrations
    where user_id = account and (company_type is null or mobile is not null) returning * into registration;
  if found then
    organization := easyhr_private.hr_create_organization(registration.company_name);
    if registration.company_type is not null then
      update public.hr_company_settings
        set company_type = registration.company_type,
            profile = profile || jsonb_build_object('email', email_address, 'phone', mobile, 'tpin', registration.tpin)
        where organization_id = organization;
    end if;
  end if;
  for invitation in
    delete from easyhr_private.member_invitations where email = email_address returning *
  loop
    if easyhr_private.role_in(invitation.organization_id) is null then
      insert into public.hr_members values (invitation.organization_id, account, invitation.role);
      update public.hr_employees set user_id = account, version = version + 1
      where id = invitation.employee_id and organization_id = invitation.organization_id
        and email = email_address and user_id is null;
      insert into public.hr_audit_events(organization_id, actor_id, action, record_id)
      values (invitation.organization_id, invitation.invited_by, 'member.added.' || invitation.role, account);
    end if;
  end loop;
end $$;

create function public.hr_pending_company_phone() returns text
language sql stable security definer set search_path = '' as $$
  select registration.phone from easyhr_private.company_registrations registration
  join auth.users account on account.id = registration.user_id
  where registration.user_id = auth.uid() and account.email_confirmed_at is not null
$$;

revoke all on function public.hr_pending_company_phone() from public, anon;
grant execute on function public.hr_pending_company_phone() to authenticated;

create function public.hr_company_signup_available() returns boolean
language sql immutable set search_path = '' as $$ select true $$;
revoke all on function public.hr_company_signup_available() from public;
grant execute on function public.hr_company_signup_available() to anon, authenticated;

commit;
