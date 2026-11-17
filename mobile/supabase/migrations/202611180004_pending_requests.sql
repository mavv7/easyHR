begin;

alter table public.hr_leave_requests drop constraint hr_leave_requests_status_check;
alter table public.hr_leave_requests add constraint hr_leave_requests_status_check
  check (status in ('Pending', 'Approved', 'Declined', 'Cancelled'));

create or replace function public.hr_request_leave(p_employee_id uuid, p_start date, p_end date, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare e public.hr_employees; count_days integer; reserved integer; result uuid;
begin
  select * into e from public.hr_employees where id = p_employee_id for update;
  if not found or not easyhr_private.can_read_employee(p_employee_id) then raise exception 'Employee unavailable'; end if;
  if e.user_id is distinct from auth.uid() and easyhr_private.role_in(e.organization_id) is distinct from 'hr' then raise exception 'You may only request your own leave'; end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 366 then raise exception 'Invalid date range'; end if;
  select count(*) into count_days from generate_series(0, p_end - p_start) n where extract(isodow from p_start + n) < 6;
  if count_days = 0 then raise exception 'Select at least one weekday'; end if;
  if exists(select 1 from public.hr_leave_requests where employee_id = e.id and status in ('Pending', 'Approved') and start_date <= p_end and end_date >= p_start) then raise exception 'Leave overlaps an existing request'; end if;
  select coalesce(sum(days), 0) into reserved from public.hr_leave_requests where employee_id = e.id and status = 'Pending';
  if count_days + reserved > e.leave_balance then raise exception 'Insufficient unreserved leave balance'; end if;
  insert into public.hr_leave_requests(organization_id, employee_id, start_date, end_date, days, reason, requested_by)
  values(e.organization_id, e.id, p_start, p_end, count_days, trim(p_reason), auth.uid()) returning id into result;
  insert into public.hr_audit_events(organization_id, actor_id, action, record_id) values(e.organization_id, auth.uid(), 'leave.requested', result);
  return result;
end $$;

create function public.hr_cancel_leave(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  employee_uuid uuid;
  employee public.hr_employees;
  member_role text;
begin
  select employee_id into employee_uuid from public.hr_leave_requests where id = p_id;
  -- Match the employee-first lock order used for requests and approvals.
  select * into employee from public.hr_employees where id = employee_uuid for update;
  if not found then raise exception 'Request unavailable'; end if;
  member_role := easyhr_private.role_in(employee.organization_id);
  if member_role is null or (member_role <> 'hr' and employee.user_id is distinct from auth.uid()) then
    raise exception 'Request unavailable';
  end if;
  update public.hr_leave_requests
  set status = 'Cancelled', decided_by = auth.uid(), decided_at = now()
  where id = p_id and status = 'Pending';
  if not found then raise exception 'Only pending requests can be cancelled'; end if;
  insert into public.hr_audit_events(organization_id, actor_id, action, record_id)
  values (employee.organization_id, auth.uid(), 'leave.cancelled', p_id);
end $$;

create function public.hr_list_invitations(p_organization_id uuid)
returns table(email text, role text, employee_id uuid)
language sql stable security definer set search_path = '' as $$
  select i.email, i.role, i.employee_id from easyhr_private.member_invitations i
  where i.organization_id = p_organization_id and easyhr_private.role_in(p_organization_id) = 'hr'
  order by i.email
$$;

create function public.hr_cancel_invitation(p_organization_id uuid, p_email text, p_expected_role text, p_expected_employee_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  email_address text := lower(trim(p_email));
  linked_employee uuid;
begin
  if easyhr_private.role_in(p_organization_id) is distinct from 'hr' then raise exception 'HR access required'; end if;
  -- Share the lock with invitation authorization and account activation.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(email_address, 0));
  if easyhr_private.role_in(p_organization_id) is distinct from 'hr' then raise exception 'HR access required'; end if;
  delete from easyhr_private.member_invitations
  where organization_id = p_organization_id and email = email_address and role = p_expected_role
    and employee_id is not distinct from p_expected_employee_id
  returning employee_id into linked_employee;
  if not found then raise exception 'Pending authorization changed. Refresh and try again'; end if;
  insert into public.hr_audit_events(organization_id, actor_id, action, record_id)
  values (p_organization_id, auth.uid(), 'invitation.cancelled', linked_employee);
end $$;

revoke all on function public.hr_cancel_leave(uuid), public.hr_list_invitations(uuid), public.hr_cancel_invitation(uuid, text, text, uuid) from public, anon;
grant execute on function public.hr_cancel_leave(uuid), public.hr_list_invitations(uuid), public.hr_cancel_invitation(uuid, text, text, uuid) to authenticated;

commit;
