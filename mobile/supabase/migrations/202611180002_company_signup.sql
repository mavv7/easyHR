begin;

create table easyhr_private.member_invitations (
  organization_id uuid not null references public.hr_organizations(id),
  email text not null,
  role text not null check (role in ('hr', 'manager', 'employee')),
  employee_id uuid,
  invited_by uuid not null references auth.users(id),
  primary key (organization_id, email),
  foreign key (organization_id, employee_id) references public.hr_employees(organization_id, id)
);
create index member_invitations_email on easyhr_private.member_invitations(email);
revoke all on easyhr_private.member_invitations from public, anon, authenticated;

alter function public.hr_add_member(uuid, text, text, uuid) rename to grant_verified_member;
alter function public.grant_verified_member(uuid, text, text, uuid) set schema easyhr_private;
revoke execute on function easyhr_private.grant_verified_member(uuid, text, text, uuid) from authenticated;

create function public.hr_add_member(p_organization_id uuid, p_email text, p_role text, p_employee_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare email_address text := lower(trim(p_email));
begin
  if easyhr_private.role_in(p_organization_id) is distinct from 'hr' then
    raise exception 'HR access required';
  end if;
  if email_address is null or email_address !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid work email';
  end if;
  if p_role is null or p_role not in ('hr', 'manager', 'employee') then
    raise exception 'Invalid role';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(email_address, 0));
  if exists (select 1 from auth.users where lower(email) = email_address and email_confirmed_at is not null) then
    perform easyhr_private.grant_verified_member(p_organization_id, email_address, p_role, p_employee_id);
    delete from easyhr_private.member_invitations where organization_id = p_organization_id and email = email_address;
    return;
  end if;
  if p_employee_id is not null and not exists (
    select 1 from public.hr_employees where organization_id = p_organization_id
      and id = p_employee_id and email = email_address and user_id is null
  ) then
    raise exception 'Select an unlinked employee with the same email';
  end if;
  insert into easyhr_private.member_invitations values (p_organization_id, email_address, p_role, p_employee_id, auth.uid())
  on conflict (organization_id, email) do update
    set role = excluded.role, employee_id = excluded.employee_id, invited_by = excluded.invited_by;
end $$;

revoke execute on function public.hr_create_organization(text) from authenticated;
alter function public.hr_create_organization(text) set schema easyhr_private;

-- Only initial signup metadata supplies the company name. Later profile edits
-- cannot change whether an account provisions a company.
create table easyhr_private.company_registrations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  company_name text not null
);
revoke all on easyhr_private.company_registrations from public, anon, authenticated;

create function easyhr_private.register_company_signup() returns trigger
language plpgsql security definer set search_path = '' as $$
declare company text := trim(new.raw_user_meta_data ->> 'company_name');
begin
  if company is not null then
    if length(company) not between 2 and 120 or new.email is null then
      raise exception 'Enter a valid company name and work email';
    end if;
    insert into easyhr_private.company_registrations values (new.id, company);
  elsif not exists (
    select 1 from easyhr_private.member_invitations where email = lower(new.email)
  ) then
    raise exception 'Company registration or HR approval required';
  end if;
  return new;
end $$;

create trigger easyhr_register_company_signup after insert on auth.users
for each row execute function easyhr_private.register_company_signup();

create function public.hr_activate_workspace() returns void
language plpgsql security definer set search_path = '' as $$
declare
  account uuid := auth.uid();
  email_address text;
  company text;
  invitation easyhr_private.member_invitations;
begin
  select lower(email) into email_address from auth.users where id = account and email_confirmed_at is not null;
  if email_address is null then return; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(email_address, 0));
  delete from easyhr_private.company_registrations where user_id = account returning company_name into company;
  if company is not null then
    perform easyhr_private.hr_create_organization(company);
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

revoke all on function public.hr_add_member(uuid, text, text, uuid), public.hr_activate_workspace() from public, anon;
grant execute on function public.hr_add_member(uuid, text, text, uuid), public.hr_activate_workspace() to authenticated;
revoke all on function easyhr_private.register_company_signup() from public, anon, authenticated;

commit;
