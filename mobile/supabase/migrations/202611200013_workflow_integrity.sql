begin;

-- Use a date-style independent lock key for each payroll month.

create or replace function easyhr_private.lock_payroll(p_org uuid, p_period date) returns void
language sql set search_path = '' as $$
  select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_org::text || ':' || (p_period - date '2000-01-01')::text, 931))
$$;

create or replace function public.hr_finance_access(p_org uuid, p_user uuid, p_enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if easyhr_private.role_in(p_org) is distinct from 'hr' then raise exception 'HR access required'; end if;
  if p_enabled is null then raise exception 'Choose whether to grant or revoke Finance access'; end if;
  if p_enabled then
    insert into easyhr_private.finance_reviewers values (p_org, p_user) on conflict do nothing;
  else
    delete from easyhr_private.finance_reviewers where organization_id = p_org and user_id = p_user;
  end if;
  perform easyhr_private.workflow_audit(p_org, case when p_enabled then 'payroll.finance_granted' else 'payroll.finance_revoked' end, p_user);
end $$;

create or replace function public.hr_payroll_review(p_org uuid, p_period date, p_action text, p_version integer, p_comment text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  run easyhr_private.payroll_runs;
  actor uuid := auth.uid();
begin
  if p_action = 'submit' then
    if easyhr_private.role_in(p_org) is distinct from 'hr' then raise exception 'HR access required'; end if;
  elsif p_action in ('approve','return') then
    if not easyhr_private.is_finance(p_org) then raise exception 'Finance review access required'; end if;
  else raise exception 'Invalid payroll action';
  end if;

  perform easyhr_private.lock_payroll(p_org, p_period);
  select * into run from easyhr_private.payroll_runs where organization_id = p_org and period = p_period;
  if run.version is distinct from p_version then raise exception 'Payroll review changed. Refresh and try again'; end if;

  if p_action = 'submit' then
    if run.id is not null and run.status <> 'returned' then raise exception 'Payroll has already been submitted'; end if;
    if p_period < date '2026-01-01' or p_period >= date '2027-01-01' then raise exception 'Payroll rules are configured for 2026'; end if;
    if not exists(select 1 from public.hr_payroll_drafts where organization_id = p_org and period = p_period) then
      raise exception 'Add payroll drafts before submitting';
    end if;
    if not exists(
      select 1 from easyhr_private.finance_reviewers where organization_id = p_org and user_id <> actor
    ) then raise exception 'Assign a different Finance reviewer before submitting payroll'; end if;
    insert into easyhr_private.payroll_runs(organization_id, period, status, submitted_by, comment)
    values (p_org, p_period, 'submitted', actor, nullif(trim(p_comment), ''))
    on conflict (organization_id, period) do update set status = 'submitted', submitted_by = actor,
      reviewed_by = null, comment = excluded.comment, version = payroll_runs.version + 1
    returning * into run;
  else
    if run.status is distinct from 'submitted' then raise exception 'Payroll is not awaiting review'; end if;
    if actor = run.submitted_by then raise exception 'A different reviewer must review the run'; end if;
    if p_action = 'return' and nullif(trim(p_comment), '') is null then raise exception 'Add a return comment'; end if;
    update easyhr_private.payroll_runs set status = case when p_action = 'approve' then 'approved' else 'returned' end,
      reviewed_by = actor, comment = nullif(trim(p_comment), ''), version = version + 1 where id = run.id;
    if p_action = 'approve' then
      insert into easyhr_private.payslips
      select p_org, run.id, d.employee_id, d.base_minor, g.gross, d.bonus_minor,
        round((greatest(0, least(g.gross, 710000) - 510000) * 20::numeric
          + greatest(0, least(g.gross, 920000) - 710000) * 30::numeric
          + greatest(0, g.gross - 920000) * 37::numeric) / 100)::integer,
        round(least(g.gross, 3723600) * 0.05)::integer,
        round(d.base_minor * 0.01)::integer
      from public.hr_payroll_drafts d cross join lateral (select d.base_minor + d.additional_minor as gross) g
      where d.organization_id = p_org and d.period = p_period;
    end if;
  end if;
  perform easyhr_private.workflow_audit(p_org, 'payroll.' || p_action, run.id);
end $$;

create or replace function public.hr_submit_timesheet(p_org uuid, p_employee uuid, p_period date, p_regular integer, p_overtime integer, p_version integer)
returns void language plpgsql security definer set search_path = '' as $$
declare entry_id uuid;
begin
  if easyhr_private.role_in(p_org) is null or not exists(select 1 from public.hr_employees where organization_id = p_org
    and id = p_employee and user_id = auth.uid()) then raise exception 'Submit your own timesheet'; end if;
  if p_period is null or not isfinite(p_period) or extract(day from p_period) <> 1 then
    raise exception 'Choose a valid timesheet month';
  end if;
  if p_regular is null or p_overtime is null or p_regular < 0 or p_overtime < 0
    or p_regular::bigint + p_overtime > 1440 * ((p_period + interval '1 month')::date - p_period)
  then raise exception 'Total minutes must fit within the selected month'; end if;
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

create or replace function public.hr_review_timesheet(p_org uuid, p_id uuid, p_version integer, p_approve boolean, p_amount integer)
returns void language plpgsql security definer set search_path = '' as $$
declare entry easyhr_private.timesheets;
begin
  select * into entry from easyhr_private.timesheets where organization_id = p_org and id = p_id;
  if entry.id is null or entry.submitted_by = auth.uid() or not (
    easyhr_private.role_in(p_org) is not distinct from 'hr'
    or (easyhr_private.role_in(p_org) is not distinct from 'manager' and easyhr_private.can_read_employee(entry.employee_id))
  ) then raise exception 'Manager or HR review required'; end if;
  if p_approve is null then raise exception 'Choose whether to approve or return the timesheet'; end if;
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

create or replace function public.hr_complete_work_task(p_org uuid, p_id uuid, p_result text, p_effective date, p_basic integer, p_allowance integer)
returns void language plpgsql security definer set search_path = '' as $$
declare task easyhr_private.hr_tasks;
begin
  if easyhr_private.role_in(p_org) is null then raise exception 'Workspace access required'; end if;
  if nullif(trim(p_result), '') is null then raise exception 'Enter a task outcome'; end if;
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

create or replace function public.hr_reply_payroll_query(p_org uuid, p_id uuid, p_reply text, p_resolve boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if easyhr_private.role_in(p_org) is distinct from 'hr' and not easyhr_private.is_finance(p_org) then raise exception 'Payroll access required'; end if;
  if p_resolve is null then raise exception 'Choose whether to resolve the query'; end if;
  update easyhr_private.payroll_queries set owner_id = auth.uid(), reply = coalesce(nullif(trim(p_reply), ''), reply),
    resolved_at = case when p_resolve then now() end
  where organization_id = p_org and id = p_id and resolved_at is null
    and (not p_resolve or coalesce(nullif(trim(p_reply), ''), reply) is not null);
  if not found then raise exception 'Query unavailable or requires a reply'; end if;
  perform easyhr_private.workflow_audit(p_org, case when p_resolve then 'payroll.query_resolved' else 'payroll.query_assigned' end, p_id);
end $$;

commit;
