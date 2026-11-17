begin;

create schema if not exists easyhr_private;
revoke all on schema easyhr_private from public;
grant usage on schema easyhr_private to authenticated;

create table public.hr_organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 120),
  country text not null default 'ZM' check (country = 'ZM'),
  currency text not null default 'ZMW' check (currency = 'ZMW'),
  owner_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(owner_id)
);
create table public.hr_members (
  organization_id uuid not null references public.hr_organizations(id),
  user_id uuid not null references auth.users(id),
  role text not null check (role in ('hr', 'manager', 'employee')),
  primary key (organization_id, user_id)
);
create table public.hr_employees (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.hr_organizations(id),
  user_id uuid,
  manager_user_id uuid,
  name text not null check (length(trim(name)) between 2 and 120),
  job_title text not null check (length(trim(job_title)) between 1 and 120),
  department text not null check (length(trim(department)) between 1 and 120),
  email text not null check (email = lower(trim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  leave_balance integer not null default 0 check (leave_balance between 0 and 366),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  unique (organization_id, id), unique (organization_id, email), unique (organization_id, user_id),
  foreign key (organization_id, user_id) references public.hr_members(organization_id, user_id),
  foreign key (organization_id, manager_user_id) references public.hr_members(organization_id, user_id)
);
create table public.hr_leave_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.hr_organizations(id),
  employee_id uuid not null,
  start_date date not null,
  end_date date not null check (end_date >= start_date and end_date - start_date <= 366),
  days integer not null check (days > 0),
  reason text not null check (length(trim(reason)) between 1 and 1000),
  status text not null default 'Pending' check (status in ('Pending', 'Approved', 'Declined')),
  requested_by uuid not null references auth.users(id),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (organization_id, employee_id) references public.hr_employees(organization_id, id)
);
create table public.hr_audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.hr_organizations(id),
  actor_id uuid not null references auth.users(id),
  action text not null,
  record_id uuid,
  created_at timestamptz not null default now()
);
create index hr_employees_manager on public.hr_employees(organization_id, manager_user_id);
create index hr_leave_employee on public.hr_leave_requests(employee_id, start_date, end_date);
create index hr_audit_org on public.hr_audit_events(organization_id, created_at desc);
create index hr_members_user on public.hr_members(user_id);

create function easyhr_private.role_in(org uuid) returns text
language sql stable security definer set search_path = '' as $$
  select role from public.hr_members where organization_id = org and user_id = auth.uid()
$$;
create function easyhr_private.can_read_employee(employee uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.hr_employees e where e.id = employee and
    (easyhr_private.role_in(e.organization_id) = 'hr' or
     (easyhr_private.role_in(e.organization_id) is not null and e.user_id = auth.uid()) or
     (easyhr_private.role_in(e.organization_id) = 'manager' and e.manager_user_id = auth.uid())))
$$;
revoke all on function easyhr_private.role_in(uuid), easyhr_private.can_read_employee(uuid) from public;
grant execute on function easyhr_private.role_in(uuid), easyhr_private.can_read_employee(uuid) to authenticated;

alter table public.hr_organizations enable row level security;
alter table public.hr_members enable row level security;
alter table public.hr_employees enable row level security;
alter table public.hr_leave_requests enable row level security;
alter table public.hr_audit_events enable row level security;
revoke all on public.hr_organizations, public.hr_members, public.hr_employees, public.hr_leave_requests, public.hr_audit_events from anon, authenticated;
grant select on public.hr_organizations, public.hr_members, public.hr_employees, public.hr_leave_requests, public.hr_audit_events to authenticated;
create policy org_read on public.hr_organizations for select to authenticated using (easyhr_private.role_in(id) is not null);
create policy member_read on public.hr_members for select to authenticated using (user_id = auth.uid() or easyhr_private.role_in(organization_id) = 'hr');
create policy employee_read on public.hr_employees for select to authenticated using (easyhr_private.can_read_employee(id));
create policy leave_read on public.hr_leave_requests for select to authenticated using (easyhr_private.can_read_employee(employee_id));
create policy audit_read on public.hr_audit_events for select to authenticated using (easyhr_private.role_in(organization_id) = 'hr');

create function public.hr_create_organization(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare org uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  insert into public.hr_organizations(name, owner_id) values (trim(p_name), auth.uid()) returning id into org;
  insert into public.hr_members values (org, auth.uid(), 'hr');
  insert into public.hr_audit_events(organization_id, actor_id, action, record_id) values (org, auth.uid(), 'organization.created', org);
  return org;
end $$;

create function public.hr_save_employee(p_organization_id uuid, p_name text, p_job_title text, p_department text, p_email text,
  p_leave_balance integer, p_manager_user_id uuid default null, p_id uuid default null, p_version integer default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare result uuid; old_record public.hr_employees; reserved integer;
begin
  if easyhr_private.role_in(p_organization_id) is distinct from 'hr' then raise exception 'HR access required'; end if;
  if p_manager_user_id is not null and not exists(select 1 from public.hr_members where organization_id = p_organization_id and user_id = p_manager_user_id and role in ('manager', 'hr')) then raise exception 'Choose a manager in this company'; end if;
  if p_id is null then
    insert into public.hr_employees(organization_id, name, job_title, department, email, leave_balance, manager_user_id)
    values(p_organization_id, trim(p_name), trim(p_job_title), trim(p_department), lower(trim(p_email)), p_leave_balance, p_manager_user_id) returning id into result;
  else
    select * into old_record from public.hr_employees where id = p_id and organization_id = p_organization_id for update;
    if not found or old_record.version is distinct from p_version then raise exception 'Record changed. Refresh and try again'; end if;
    if old_record.user_id is not null and lower(trim(p_email)) <> old_record.email then raise exception 'Linked account email cannot be changed here'; end if;
    select coalesce(sum(days), 0) into reserved from public.hr_leave_requests where employee_id = p_id and status = 'Pending';
    if p_leave_balance < reserved then raise exception 'Balance cannot be lower than pending leave'; end if;
    update public.hr_employees set name = trim(p_name), job_title = trim(p_job_title), department = trim(p_department), email = lower(trim(p_email)),
      leave_balance = p_leave_balance, manager_user_id = p_manager_user_id, version = version + 1 where id = p_id returning id into result;
  end if;
  insert into public.hr_audit_events(organization_id, actor_id, action, record_id)
  values(p_organization_id, auth.uid(), case when p_id is null then 'employee.created' else 'employee.updated' end, result);
  return result;
end $$;

-- Membership is explicitly granted by HR after the user signs up and verifies their email.
-- Users cannot claim a record merely by supplying its email address to the client.
create function public.hr_add_member(p_organization_id uuid, p_email text, p_role text, p_employee_id uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare account uuid;
begin
  if easyhr_private.role_in(p_organization_id) is distinct from 'hr' then raise exception 'HR access required'; end if;
  select id into account from auth.users where lower(email) = lower(trim(p_email)) and email_confirmed_at is not null;
  if account is null then raise exception 'The user must sign up and verify this email first'; end if;
  if p_role is null or p_role not in ('hr', 'manager', 'employee') then raise exception 'Invalid role'; end if;
  insert into public.hr_members(organization_id, user_id, role) values(p_organization_id, account, p_role) on conflict do nothing;
  if not exists(select 1 from public.hr_members where organization_id = p_organization_id and user_id = account and role = p_role) then raise exception 'Account already has a different role'; end if;
  if p_employee_id is not null then
    update public.hr_employees set user_id = account, version = version + 1
    where id = p_employee_id and organization_id = p_organization_id and email = lower(trim(p_email)) and user_id is null;
    if not found then raise exception 'Select an unlinked employee with the same email'; end if;
  end if;
  insert into public.hr_audit_events(organization_id, actor_id, action, record_id) values(p_organization_id, auth.uid(), 'member.added.' || p_role, account);
end $$;

create function public.hr_request_leave(p_employee_id uuid, p_start date, p_end date, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare e public.hr_employees; count_days integer; reserved integer; result uuid;
begin
  select * into e from public.hr_employees where id = p_employee_id for update;
  if not found or not easyhr_private.can_read_employee(p_employee_id) then raise exception 'Employee unavailable'; end if;
  if e.user_id is distinct from auth.uid() and easyhr_private.role_in(e.organization_id) is distinct from 'hr' then raise exception 'You may only request your own leave'; end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 366 then raise exception 'Invalid date range'; end if;
  select count(*) into count_days from generate_series(0, p_end - p_start) n where extract(isodow from p_start + n) < 6;
  if count_days = 0 then raise exception 'Select at least one weekday'; end if;
  if exists(select 1 from public.hr_leave_requests where employee_id = e.id and status <> 'Declined' and start_date <= p_end and end_date >= p_start) then raise exception 'Leave overlaps an existing request'; end if;
  select coalesce(sum(days), 0) into reserved from public.hr_leave_requests where employee_id = e.id and status = 'Pending';
  if count_days + reserved > e.leave_balance then raise exception 'Insufficient unreserved leave balance'; end if;
  insert into public.hr_leave_requests(organization_id, employee_id, start_date, end_date, days, reason, requested_by)
  values(e.organization_id, e.id, p_start, p_end, count_days, trim(p_reason), auth.uid()) returning id into result;
  insert into public.hr_audit_events(organization_id, actor_id, action, record_id) values(e.organization_id, auth.uid(), 'leave.requested', result);
  return result;
end $$;

create function public.hr_decide_leave(p_id uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare req public.hr_leave_requests; e public.hr_employees; employee_uuid uuid;
begin
  if p_approve is null then raise exception 'Choose approve or decline'; end if;
  select employee_id into employee_uuid from public.hr_leave_requests where id = p_id;
  -- All leave writes lock the employee first, then the request: prevents concurrent overspend.
  select * into e from public.hr_employees where id = employee_uuid for update;
  if not found or not easyhr_private.can_read_employee(employee_uuid) then raise exception 'Request unavailable'; end if;
  if e.user_id = auth.uid() or exists(select 1 from auth.users where id = auth.uid() and lower(email) = e.email) then raise exception 'You cannot approve or decline your own leave'; end if;
  if easyhr_private.role_in(e.organization_id) is distinct from 'hr' and
    not (easyhr_private.role_in(e.organization_id) = 'manager' and e.manager_user_id = auth.uid()) then raise exception 'Approver access required'; end if;
  select * into req from public.hr_leave_requests where id = p_id for update;
  if req.status <> 'Pending' then raise exception 'Request already processed'; end if;
  if p_approve then
    if e.leave_balance < req.days then raise exception 'Insufficient leave balance'; end if;
    update public.hr_employees set leave_balance = leave_balance - req.days, version = version + 1 where id = e.id;
  end if;
  update public.hr_leave_requests set status = case when p_approve then 'Approved' else 'Declined' end, decided_by = auth.uid(), decided_at = now() where id = p_id;
  insert into public.hr_audit_events(organization_id, actor_id, action, record_id) values(e.organization_id, auth.uid(), case when p_approve then 'leave.approved' else 'leave.declined' end, p_id);
end $$;

revoke all on function public.hr_create_organization(text), public.hr_save_employee(uuid,text,text,text,text,integer,uuid,uuid,integer), public.hr_add_member(uuid,text,text,uuid), public.hr_request_leave(uuid,date,date,text), public.hr_decide_leave(uuid,boolean) from public, anon;
grant execute on function public.hr_create_organization(text), public.hr_save_employee(uuid,text,text,text,text,integer,uuid,uuid,integer), public.hr_add_member(uuid,text,text,uuid), public.hr_request_leave(uuid,date,date,text), public.hr_decide_leave(uuid,boolean) to authenticated;
commit;
