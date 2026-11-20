begin;

create or replace function public.hr_activate_workspace() returns void
language plpgsql security definer set search_path = '' as $$
declare
  account uuid := auth.uid();
  email_address text;
  registration easyhr_private.company_registrations;
  organization uuid;
  invitation easyhr_private.member_invitations;
  existing_member boolean;
begin
  select lower(email) into email_address from auth.users where id = account and email_confirmed_at is not null;
  if email_address is null then return; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(email_address, 0));
  delete from easyhr_private.company_registrations
    where user_id = account returning * into registration;
  if found then
    organization := easyhr_private.hr_create_organization(registration.company_name);
    if registration.company_type is not null then
      update public.hr_company_settings
        set company_type = registration.company_type,
            profile = profile || jsonb_build_object('email', email_address, 'phone', registration.phone, 'tpin', registration.tpin)
        where organization_id = organization;
    end if;
  end if;
  for invitation in
    delete from easyhr_private.member_invitations
    where email = email_address and (required_phone is null or exists (
      select 1 from public.hr_employees employee
      where employee.organization_id = member_invitations.organization_id and employee.id = member_invitations.employee_id
        and employee.email = email_address and employee.user_id is null
    )) returning *
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

commit;
