begin;

alter table public.hr_employees add column phone text check (phone ~ '^[+]260[79][0-9]{8}$');
alter table easyhr_private.member_invitations
  add column required_phone text check (required_phone ~ '^[+]260[79][0-9]{8}$');

create function public.hr_save_employee_access(
  p_organization_id uuid, p_name text, p_job_title text, p_department text, p_email text, p_leave_balance integer,
  p_phone text, p_manager_user_id uuid, p_id uuid, p_version integer, p_staff_number text, p_pay_point_id uuid,
  p_update_staff_details boolean, p_authorize boolean
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  address text := lower(trim(p_email));
  employee public.hr_employees;
  result uuid;
  lock_email text;
  pending_role text;
begin
  if easyhr_private.role_in(p_organization_id) is distinct from 'hr' then raise exception 'HR access required'; end if;
  select * into employee from public.hr_employees where organization_id = p_organization_id and id = p_id;
  -- Activation and withdrawal serialize on the same email lock. Order both locks for an email edit.
  for lock_email in select distinct email from unnest(array[address, employee.email]) as addresses(email)
    where email is not null order by email
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(lock_email, 0));
  end loop;
  if p_id is not null then
    select * into employee from public.hr_employees where organization_id = p_organization_id and id = p_id for update;
    if not found or employee.version is distinct from p_version then raise exception 'Record changed. Refresh and try again'; end if;
    if employee.user_id is not null and p_phone is distinct from employee.phone then
      raise exception 'The linked employee phone cannot be changed here';
    end if;
  end if;
  if (p_id is null or (employee.user_id is null and p_authorize) or p_phone is not null)
    and coalesce(p_phone, '') !~ '^[+]260[79][0-9]{8}$'
  then raise exception 'Enter a Zambian mobile number'; end if;

  result := public.hr_save_employee(p_organization_id, p_name, p_job_title, p_department, address, p_leave_balance,
    p_manager_user_id, p_id, p_version, p_staff_number, p_pay_point_id, p_update_staff_details);
  update public.hr_employees set phone = p_phone where id = result;

  if employee.user_id is null then
    delete from easyhr_private.member_invitations
      where organization_id = p_organization_id and employee_id = result and email = employee.email
      returning role into pending_role;
    if p_id is null or p_authorize or pending_role is not null then
      if p_phone is null then raise exception 'Enter a Zambian mobile number to update this authorization'; end if;
      insert into easyhr_private.member_invitations(organization_id, email, role, employee_id, invited_by, required_phone)
        values (p_organization_id, address, coalesce(pending_role, 'employee'), result, auth.uid(), p_phone)
        on conflict (organization_id, email) do update
        set employee_id = excluded.employee_id, role = excluded.role, invited_by = excluded.invited_by,
            required_phone = excluded.required_phone
        where member_invitations.employee_id is null or member_invitations.employee_id = result;
      if not found then raise exception 'This email is already authorized for another employee'; end if;
      insert into public.hr_audit_events(organization_id, actor_id, action, record_id)
        values(p_organization_id, auth.uid(), 'invitation.employee_verification', result);
    end if;
  end if;
  return result;
end $$;

create or replace function public.hr_add_member(p_organization_id uuid, p_email text, p_role text, p_employee_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if easyhr_private.role_in(p_organization_id) is distinct from 'hr' then raise exception 'HR access required'; end if;
  raise exception 'Authorize employee access from People';
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
  existing_member boolean;
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
    delete from easyhr_private.member_invitations
    where email = email_address and (required_phone is null or (required_phone = mobile and exists (
      select 1 from public.hr_employees employee
      where employee.organization_id = member_invitations.organization_id and employee.id = member_invitations.employee_id
        and employee.email = email_address and employee.phone = mobile and employee.user_id is null
    ))) returning *
  loop
    existing_member := easyhr_private.role_in(invitation.organization_id) is not null;
    if not existing_member then
      insert into public.hr_members values (invitation.organization_id, account, invitation.role);
      insert into public.hr_audit_events(organization_id, actor_id, action, record_id)
      values (invitation.organization_id, invitation.invited_by, 'member.added.' || invitation.role, account);
    end if;
    if not existing_member or invitation.required_phone is not null then
      update public.hr_employees set user_id = account, version = version + 1
      where id = invitation.employee_id and organization_id = invitation.organization_id
        and email = email_address and user_id is null;
      if found and existing_member then
        insert into public.hr_audit_events(organization_id, actor_id, action, record_id)
        values (invitation.organization_id, invitation.invited_by, 'employee.account_linked', invitation.employee_id);
      end if;
    end if;
  end loop;
end $$;

create function public.hr_pending_employee_phone() returns text
language sql stable security definer set search_path = '' as $$
  select invitation.required_phone
  from auth.users account
  join easyhr_private.member_invitations invitation on lower(account.email) = invitation.email
  where account.id = auth.uid() and account.email_confirmed_at is not null and invitation.required_phone is not null
  order by invitation.organization_id
  limit 1
$$;

revoke all on function public.hr_pending_employee_phone(),
  public.hr_save_employee_access(uuid,text,text,text,text,integer,text,uuid,uuid,integer,text,uuid,boolean,boolean) from public, anon;
grant execute on function public.hr_pending_employee_phone(),
  public.hr_save_employee_access(uuid,text,text,text,text,integer,text,uuid,uuid,integer,text,uuid,boolean,boolean) to authenticated;

commit;
