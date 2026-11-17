begin;

create function easyhr_private.check_manager_assignment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare manager_role text;
begin
  if new.manager_user_id is not null then
    select role into manager_role from public.hr_members
    where organization_id = new.organization_id and user_id = new.manager_user_id
    for share;
    if manager_role is null or manager_role not in ('manager', 'hr') then
      raise exception 'Choose a manager in this company';
    end if;
  end if;
  return new;
end $$;

revoke all on function easyhr_private.check_manager_assignment() from public, anon, authenticated;
create trigger easyhr_check_manager_assignment before insert or update of manager_user_id on public.hr_employees
for each row execute function easyhr_private.check_manager_assignment();

create function public.hr_manage_member(
  p_organization_id uuid, p_user_id uuid, p_expected_role text, p_role text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  company_owner uuid;
  stored_role text;
begin
  if easyhr_private.role_in(p_organization_id) is distinct from 'hr' then
    raise exception 'HR access required';
  end if;
  select owner_id into company_owner from public.hr_organizations where id = p_organization_id for update;
  if easyhr_private.role_in(p_organization_id) is distinct from 'hr' then
    raise exception 'HR access required';
  end if;
  if p_user_id is null or p_user_id in (company_owner, auth.uid()) then
    raise exception 'The workspace owner and your own access are protected';
  end if;
  if p_role is not null and p_role not in ('hr', 'manager', 'employee') then
    raise exception 'Invalid role';
  end if;
  select role into stored_role from public.hr_members
  where organization_id = p_organization_id and user_id = p_user_id for update;
  if stored_role is null or stored_role is distinct from p_expected_role then
    raise exception 'Workspace access changed. Refresh and try again';
  end if;
  if p_role = stored_role then return; end if;

  if p_role is null or p_role = 'employee' then
    update public.hr_employees set manager_user_id = null, version = version + 1
    where organization_id = p_organization_id and manager_user_id = p_user_id;
  end if;
  if p_role is null then
    update public.hr_employees set user_id = null, version = version + 1
    where organization_id = p_organization_id and user_id = p_user_id;
    delete from public.hr_members where organization_id = p_organization_id and user_id = p_user_id;
  else
    update public.hr_members set role = p_role where organization_id = p_organization_id and user_id = p_user_id;
  end if;
  insert into public.hr_audit_events(organization_id, actor_id, action, record_id)
  values (p_organization_id, auth.uid(), case when p_role is null then 'member.revoked' else 'member.role_changed.' || p_role end, p_user_id);
end $$;

revoke all on function public.hr_manage_member(uuid, uuid, text, text) from public, anon;
grant execute on function public.hr_manage_member(uuid, uuid, text, text) to authenticated;

commit;
