begin;

create table easyhr_private.hr_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  employee_id uuid not null,
  owner_id uuid,
  category text not null check (category in ('onboarding','offboarding','renewal','probation')),
  title text not null check (length(trim(title)) between 1 and 160),
  due_on date not null,
  result text check (length(result) between 1 and 1000),
  completed_at timestamptz,
  foreign key (organization_id, employee_id) references public.hr_employees(organization_id, id),
  foreign key (organization_id, owner_id) references public.hr_members on delete set null (owner_id)
);

create table easyhr_private.timesheets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  employee_id uuid not null,
  period date not null check (extract(day from period) = 1),
  regular_minutes integer not null check (regular_minutes between 0 and 44640),
  overtime_minutes integer not null check (overtime_minutes between 0 and 44640 and regular_minutes + overtime_minutes <= 44640),
  overtime_minor integer not null default 0 check (overtime_minor between 0 and 1000000000),
  status text not null default 'submitted' check (status in ('submitted','approved','returned')),
  submitted_by uuid not null references auth.users,
  reviewed_at timestamptz,
  version integer not null default 1,
  unique (organization_id, employee_id, period),
  foreign key (organization_id, employee_id) references public.hr_employees(organization_id, id)
);

create table easyhr_private.attendance_cutoffs (
  organization_id uuid not null references public.hr_organizations,
  period date not null check (extract(day from period) = 1),
  cutoff date not null,
  primary key (organization_id, period)
);

create table easyhr_private.payroll_queries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  employee_id uuid not null,
  period date not null check (extract(day from period) = 1),
  question text not null check (length(trim(question)) between 1 and 2000),
  owner_id uuid references auth.users,
  reply text check (length(trim(reply)) between 1 and 2000),
  resolved_at timestamptz,
  foreign key (organization_id, employee_id) references public.hr_employees(organization_id, id)
);

create table easyhr_private.statutory_remittances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  run_id uuid not null,
  agency text not null check (agency in ('PAYE','NAPSA','NHIMA')),
  paid_minor bigint not null check (paid_minor > 0),
  paid_on date not null,
  reference text not null check (length(trim(reference)) between 1 and 200),
  unique (run_id, agency, reference),
  foreign key (organization_id, run_id) references easyhr_private.payroll_runs(organization_id, id)
);

create function public.hr_apply_recurring_pay(p_org uuid, p_employee uuid, p_period date,
  p_base integer, p_allowance integer, p_version integer) returns void
language plpgsql security definer set search_path = '' as $$
declare draft public.hr_payroll_drafts;
begin
  if easyhr_private.role_in(p_org) is distinct from 'hr' then raise exception 'HR access required'; end if;
  if p_allowance is null or p_allowance not between 0 and 1000000000 then raise exception 'Invalid allowance amount'; end if;
  select * into draft from public.hr_payroll_drafts where organization_id = p_org and employee_id = p_employee and period = p_period;
  if draft.version is distinct from p_version then raise exception 'Payroll draft changed. Refresh and try again'; end if;
  perform public.hr_save_payroll_draft(p_org, p_employee, p_period, p_base,
    p_allowance + coalesce(draft.bonus_minor, 0) + coalesce(draft.overtime_minor, 0), p_version, coalesce(draft.bonus_minor, 0));
end $$;

create function public.hr_set_attendance_cutoff(p_org uuid, p_period date, p_cutoff date) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if easyhr_private.role_in(p_org) is distinct from 'hr' then raise exception 'HR access required'; end if;
  perform easyhr_private.lock_payroll(p_org, p_period);
  if exists(select 1 from easyhr_private.payroll_runs where organization_id = p_org and period = p_period and status in ('submitted','approved'))
    then raise exception 'Payroll is locked for review'; end if;
  if p_cutoff is null or p_cutoff < p_period or p_cutoff > p_period + interval '2 months - 1 day' then
    raise exception 'Choose a cut-off within the payroll month or the following month';
  end if;
  insert into easyhr_private.attendance_cutoffs values (p_org, p_period, p_cutoff)
  on conflict (organization_id, period) do update set cutoff = excluded.cutoff;
  perform easyhr_private.workflow_audit(p_org, 'attendance.cutoff_set', null);
end $$;

create function easyhr_private.check_approved_overtime() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'submitted' and exists(
    select 1 from easyhr_private.timesheets t left join public.hr_payroll_drafts d
      on d.organization_id = t.organization_id and d.employee_id = t.employee_id and d.period = t.period
    where t.organization_id = new.organization_id and t.period = new.period and t.status = 'approved'
      and t.overtime_minor > 0 and d.overtime_minor is distinct from t.overtime_minor
  ) then raise exception 'Import all approved overtime before submitting payroll'; end if;
  return new;
end $$;

create trigger payroll_overtime_ready before insert or update on easyhr_private.payroll_runs
for each row execute function easyhr_private.check_approved_overtime();
revoke all on function easyhr_private.check_approved_overtime() from public;

create function public.hr_import_overtime(p_org uuid, p_employee uuid, p_period date, p_version integer) returns void
language plpgsql security definer set search_path = '' as $$
declare
  draft public.hr_payroll_drafts;
  amount integer;
begin
  if easyhr_private.role_in(p_org) is distinct from 'hr' then raise exception 'HR access required'; end if;
  select * into draft from public.hr_payroll_drafts where organization_id = p_org and employee_id = p_employee
    and period = p_period and version = p_version;
  if not found then raise exception 'Payroll draft changed. Refresh and try again'; end if;
  select overtime_minor into amount from easyhr_private.timesheets where organization_id = p_org and employee_id = p_employee
    and period = p_period and status = 'approved';
  if not found then raise exception 'Approve the timesheet first'; end if;
  update public.hr_payroll_drafts set additional_minor = draft.additional_minor - draft.overtime_minor + amount,
    overtime_minor = amount, version = version + 1 where id = draft.id and version = p_version;
  if not found then raise exception 'Payroll draft changed. Refresh and try again'; end if;
  perform easyhr_private.workflow_audit(p_org, 'payroll.overtime_imported', draft.id);
end $$;

create function public.hr_submit_timesheet(p_org uuid, p_employee uuid, p_period date, p_regular integer, p_overtime integer, p_version integer)
returns void language plpgsql security definer set search_path = '' as $$
declare entry_id uuid;
begin
  if easyhr_private.role_in(p_org) is null or not exists(select 1 from public.hr_employees where organization_id = p_org
    and id = p_employee and user_id = auth.uid()) then raise exception 'Submit your own timesheet'; end if;
  perform easyhr_private.lock_payroll(p_org, p_period);
  if exists(select 1 from easyhr_private.payroll_runs where organization_id = p_org and period = p_period and status in ('submitted','approved'))
    then raise exception 'Payroll cut-off has passed for this month'; end if;
  if p_version is null then
    insert into easyhr_private.timesheets(organization_id, employee_id, period, regular_minutes, overtime_minutes, submitted_by)
    values (p_org, p_employee, p_period, p_regular, p_overtime, auth.uid()) on conflict do nothing returning id into entry_id;
  else
    update easyhr_private.timesheets set regular_minutes = p_regular, overtime_minutes = p_overtime,
      submitted_by = auth.uid(), status = 'submitted', version = version + 1, reviewed_at = null
    where organization_id = p_org and employee_id = p_employee and period = p_period and status = 'returned'
      and version = p_version returning id into entry_id;
  end if;
  if entry_id is null then raise exception 'Timesheet changed. Refresh and try again'; end if;
  perform easyhr_private.workflow_audit(p_org, 'attendance.submitted', entry_id);
end $$;

create function public.hr_review_timesheet(p_org uuid, p_id uuid, p_version integer, p_approve boolean, p_amount integer)
returns void language plpgsql security definer set search_path = '' as $$
declare entry easyhr_private.timesheets;
begin
  select * into entry from easyhr_private.timesheets where organization_id = p_org and id = p_id;
  if entry.id is null or entry.submitted_by = auth.uid() or not (
    easyhr_private.role_in(p_org) is not distinct from 'hr'
    or (easyhr_private.role_in(p_org) is not distinct from 'manager' and easyhr_private.can_read_employee(entry.employee_id))
  ) then raise exception 'Manager or HR review required'; end if;
  perform easyhr_private.lock_payroll(p_org, entry.period);
  if exists(select 1 from easyhr_private.payroll_runs where organization_id = p_org and period = entry.period and status in ('submitted','approved'))
    then raise exception 'Payroll cut-off has passed for this month'; end if;
  if p_approve and entry.overtime_minutes = 0 and p_amount <> 0 then raise exception 'Overtime hours are required'; end if;
  update easyhr_private.timesheets set status = case when p_approve then 'approved' else 'returned' end,
    overtime_minor = case when p_approve then p_amount else 0 end, reviewed_at = now(), version = version + 1
  where id = p_id and version = p_version and status = 'submitted';
  if not found then raise exception 'Timesheet changed. Refresh and try again'; end if;
  perform easyhr_private.workflow_audit(p_org, case when p_approve then 'attendance.approved' else 'attendance.returned' end, p_id);
end $$;

create function public.hr_create_work_task(p_org uuid, p_employee uuid, p_owner uuid, p_category text, p_title text, p_due date)
returns void language plpgsql security definer set search_path = '' as $$
declare task_id uuid;
begin
  if easyhr_private.role_in(p_org) is distinct from 'hr' then raise exception 'HR access required'; end if;
  insert into easyhr_private.hr_tasks(organization_id, employee_id, owner_id, category, title, due_on)
  values (p_org, p_employee, p_owner, p_category, trim(p_title), p_due) returning id into task_id;
  perform easyhr_private.workflow_audit(p_org, 'people.task_created', task_id);
end $$;

create function public.hr_complete_work_task(p_org uuid, p_id uuid, p_result text, p_effective date, p_basic integer, p_allowance integer)
returns void language plpgsql security definer set search_path = '' as $$
declare task easyhr_private.hr_tasks;
begin
  if easyhr_private.role_in(p_org) is null then raise exception 'Workspace access required'; end if;
  update easyhr_private.hr_tasks set result = trim(p_result), completed_at = now()
  where organization_id = p_org and id = p_id and completed_at is null
    and (owner_id = auth.uid() or easyhr_private.role_in(p_org) = 'hr') returning * into task;
  if not found then raise exception 'Task unavailable or already completed'; end if;
  if p_effective is not null then
    if task.category not in ('renewal','probation') then raise exception 'Only reviews can schedule compensation'; end if;
    perform public.hr_schedule_compensation(p_org, task.employee_id, p_effective, p_basic, p_allowance, p_result);
  end if;
  if task.category in ('renewal','probation') and easyhr_private.role_in(p_org) <> 'hr' then
    insert into easyhr_private.hr_tasks(organization_id, employee_id, category, title, due_on)
    values (p_org, task.employee_id, task.category, left('HR sign-off: ' || task.title, 160), task.due_on);
  end if;
  perform easyhr_private.workflow_audit(p_org, 'people.task_completed', p_id);
end $$;

create function public.hr_payroll_query(p_org uuid, p_employee uuid, p_period date, p_question text)
returns void language plpgsql security definer set search_path = '' as $$
declare query_id uuid;
begin
  if easyhr_private.role_in(p_org) is null or not exists(select 1 from public.hr_employees where organization_id = p_org
    and id = p_employee and user_id = auth.uid()) then raise exception 'Submit a query for your own pay'; end if;
  insert into easyhr_private.payroll_queries(organization_id, employee_id, period, question)
  values (p_org, p_employee, p_period, trim(p_question)) returning id into query_id;
  perform easyhr_private.workflow_audit(p_org, 'payroll.query_opened', query_id);
end $$;

create function public.hr_reply_payroll_query(p_org uuid, p_id uuid, p_reply text, p_resolve boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if easyhr_private.role_in(p_org) is distinct from 'hr' and not easyhr_private.is_finance(p_org) then raise exception 'Payroll access required'; end if;
  update easyhr_private.payroll_queries set owner_id = auth.uid(), reply = coalesce(nullif(trim(p_reply), ''), reply),
    resolved_at = case when p_resolve then now() end
  where organization_id = p_org and id = p_id and resolved_at is null
    and (not p_resolve or coalesce(nullif(trim(p_reply), ''), reply) is not null);
  if not found then raise exception 'Query unavailable or requires a reply'; end if;
  perform easyhr_private.workflow_audit(p_org, case when p_resolve then 'payroll.query_resolved' else 'payroll.query_assigned' end, p_id);
end $$;

create function public.hr_record_remittance(p_org uuid, p_run uuid, p_agency text, p_amount bigint, p_paid_on date, p_reference text)
returns void language plpgsql security definer set search_path = '' as $$
declare receipt_id uuid;
begin
  if not easyhr_private.is_finance(p_org) then raise exception 'Finance access required'; end if;
  if not exists(select 1 from easyhr_private.payroll_runs where organization_id = p_org and id = p_run and status = 'approved')
    then raise exception 'Approve payroll first'; end if;
  insert into easyhr_private.statutory_remittances(organization_id, run_id, agency, paid_minor, paid_on, reference)
  values (p_org, p_run, p_agency, p_amount, p_paid_on, trim(p_reference)) returning id into receipt_id;
  perform easyhr_private.workflow_audit(p_org, 'payroll.remittance_recorded', receipt_id);
end $$;

create function public.hr_operations(p_org uuid, p_period date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  role text := easyhr_private.role_in(p_org);
  finance boolean := easyhr_private.is_finance(p_org);
  employee uuid;
begin
  if role is null then raise exception 'Workspace access required'; end if;
  select id into employee from public.hr_employees where organization_id = p_org and user_id = actor;
  return jsonb_build_object(
    'employee', employee, 'finance', finance,
    'cutoff', (select cutoff from easyhr_private.attendance_cutoffs where organization_id = p_org and period = p_period),
    'payroll_locked', exists(select 1 from easyhr_private.payroll_runs where organization_id = p_org and period = p_period and status in ('submitted','approved')),
    'overtime', case when role = 'hr' then array(
      select jsonb_build_object('employee_id', t.employee_id, 'amount', t.overtime_minor, 'imported', d.overtime_minor)
      from easyhr_private.timesheets t left join public.hr_payroll_drafts d
        on d.organization_id = t.organization_id and d.employee_id = t.employee_id and d.period = t.period
      where t.organization_id = p_org and t.period = p_period and t.status = 'approved' and t.overtime_minor > 0
    ) else '{}' end,
    'timesheets', array(
      select to_jsonb(t) || jsonb_build_object('name', e.name) from easyhr_private.timesheets t
      join public.hr_employees e on e.id = t.employee_id where t.organization_id = p_org and t.period = p_period
        and (role = 'hr' or t.employee_id = employee or (role = 'manager' and e.manager_user_id = actor))
      order by e.name
    ),
    'expected_timesheets', array(
      select e.name from public.hr_employees e where e.organization_id = p_org and e.user_id is not null
        and (role = 'hr' or (role = 'manager' and e.manager_user_id = actor))
        and not exists(select 1 from easyhr_private.timesheets t where t.organization_id = p_org and t.employee_id = e.id and t.period = p_period)
      order by e.name
    ),
    'tasks', array(
      select to_jsonb(t) || jsonb_build_object('name', e.name) from easyhr_private.hr_tasks t
      join public.hr_employees e on e.id = t.employee_id where t.organization_id = p_org
        and (role = 'hr' or t.owner_id = actor)
      order by t.completed_at nulls first, t.due_on
    ),
    'renewals', array(
      select jsonb_build_object('id', c.id, 'employee_id', e.id, 'name', e.name, 'title', c.title, 'end_date', c.end_date,
        'manager_user_id', e.manager_user_id) from public.hr_contracts c
      join public.hr_employees e on e.id = c.employee_id
      where c.organization_id = p_org and c.end_date between (now() at time zone 'Africa/Lusaka')::date
        and (now() at time zone 'Africa/Lusaka')::date + 60
        and (role = 'hr' or (role = 'manager' and e.manager_user_id = actor))
      order by c.end_date
    ),
    'contracts', array(select to_jsonb(c) from public.hr_contracts c where c.organization_id = p_org
      and c.employee_id = employee and c.reviewed_at is not null order by c.start_date desc),
    'leave_balance', (select greatest(0, e.leave_balance - coalesce((
      select sum(l.days) from public.hr_leave_requests l where l.organization_id = p_org and l.employee_id = e.id and l.status = 'Pending'
    ), 0)) from public.hr_employees e where e.id = employee),
    'payslips', array(
      select to_jsonb(s) || jsonb_build_object('period', r.period) from easyhr_private.payslips s
      join easyhr_private.payroll_runs r on r.id = s.run_id
      where s.organization_id = p_org and s.employee_id = employee and r.period = p_period
    ),
    'queries', array(
      select to_jsonb(q) || jsonb_build_object('name', e.name) from easyhr_private.payroll_queries q
      join public.hr_employees e on e.id = q.employee_id
      where q.organization_id = p_org and q.period = p_period and (role = 'hr' or finance or q.employee_id = employee)
      order by q.resolved_at nulls first, q.id
    ),
    'reconciliation', (
      select jsonb_build_object('run_id', r.id, 'paye', coalesce(sum(s.paye), 0),
        'napsa', coalesce(sum(s.napsa), 0), 'nhima', coalesce(sum(s.nhima), 0),
        'payments', array(select to_jsonb(m) from easyhr_private.statutory_remittances m where m.run_id = r.id order by m.paid_on))
      from easyhr_private.payroll_runs r join easyhr_private.payslips s on s.run_id = r.id
      where r.organization_id = p_org and r.period = p_period and (role = 'hr' or finance) group by r.id
    )
  );
end $$;

create function public.hr_workflow_alerts(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  role text := easyhr_private.role_in(p_org);
  today date := (now() at time zone 'Africa/Lusaka')::date;
begin
  if role is null then raise exception 'Workspace access required'; end if;
  return jsonb_build_object(
    'tasks', (select count(*) from easyhr_private.hr_tasks
      where organization_id = p_org and completed_at is null and due_on <= today + 14
        and (owner_id = actor or (role = 'hr' and owner_id is null))),
    'renewals', (select count(*) from public.hr_contracts c join public.hr_employees e on e.id = c.employee_id
      where c.organization_id = p_org and c.end_date between today and today + 60
        and (role = 'hr' or (role = 'manager' and e.manager_user_id = actor))),
    'review_period', (select min(r.period) from easyhr_private.payroll_runs r
      where r.organization_id = p_org and r.status = 'submitted' and r.submitted_by <> actor and easyhr_private.is_finance(p_org))
  );
end $$;

revoke all on easyhr_private.hr_tasks, easyhr_private.timesheets, easyhr_private.attendance_cutoffs,
  easyhr_private.payroll_queries, easyhr_private.statutory_remittances from public, anon, authenticated;
revoke all on function public.hr_apply_recurring_pay(uuid,uuid,date,integer,integer,integer), public.hr_set_attendance_cutoff(uuid,date,date),
  public.hr_import_overtime(uuid,uuid,date,integer), public.hr_submit_timesheet(uuid,uuid,date,integer,integer,integer),
  public.hr_review_timesheet(uuid,uuid,integer,boolean,integer), public.hr_create_work_task(uuid,uuid,uuid,text,text,date),
  public.hr_complete_work_task(uuid,uuid,text,date,integer,integer), public.hr_payroll_query(uuid,uuid,date,text),
  public.hr_reply_payroll_query(uuid,uuid,text,boolean), public.hr_record_remittance(uuid,uuid,text,bigint,date,text),
  public.hr_operations(uuid,date), public.hr_workflow_alerts(uuid) from public, anon;
grant execute on function public.hr_apply_recurring_pay(uuid,uuid,date,integer,integer,integer), public.hr_set_attendance_cutoff(uuid,date,date),
  public.hr_import_overtime(uuid,uuid,date,integer), public.hr_submit_timesheet(uuid,uuid,date,integer,integer,integer),
  public.hr_review_timesheet(uuid,uuid,integer,boolean,integer), public.hr_create_work_task(uuid,uuid,uuid,text,text,date),
  public.hr_complete_work_task(uuid,uuid,text,date,integer,integer), public.hr_payroll_query(uuid,uuid,date,text),
  public.hr_reply_payroll_query(uuid,uuid,text,boolean), public.hr_record_remittance(uuid,uuid,text,bigint,date,text),
  public.hr_operations(uuid,date), public.hr_workflow_alerts(uuid) to authenticated;

commit;
