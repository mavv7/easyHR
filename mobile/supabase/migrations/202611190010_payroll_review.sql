begin;

create table easyhr_private.finance_reviewers (
  organization_id uuid not null,
  user_id uuid not null,
  primary key (organization_id, user_id),
  foreign key (organization_id, user_id) references public.hr_members on delete cascade
);

alter table public.hr_payroll_drafts add column overtime_minor integer not null default 0
  check (overtime_minor between 0 and additional_minor - bonus_minor);

-- Keep the older draft endpoint behind the same definer and HR authorization as the newer endpoint.
alter function public.hr_save_payroll_draft(uuid,uuid,date,integer,integer,integer) security definer;

create table easyhr_private.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.hr_organizations,
  period date not null check (extract(day from period) = 1),
  status text not null check (status in ('submitted', 'returned', 'approved')),
  submitted_by uuid not null references auth.users,
  reviewed_by uuid references auth.users,
  comment text,
  version integer not null default 1,
  unique (organization_id, period),
  unique (organization_id, id)
);

create table easyhr_private.payslips (
  organization_id uuid not null,
  run_id uuid not null,
  employee_id uuid not null,
  base_minor integer not null,
  gross_minor integer not null,
  bonus_minor integer not null,
  paye integer not null,
  napsa integer not null,
  nhima integer not null,
  primary key (run_id, employee_id),
  foreign key (organization_id, run_id) references easyhr_private.payroll_runs(organization_id, id),
  foreign key (organization_id, employee_id) references public.hr_employees(organization_id, id)
);

create table easyhr_private.compensation_changes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  employee_id uuid not null,
  effective_on date not null check (extract(day from effective_on) = 1),
  basic_minor integer not null check (basic_minor between 0 and 1000000000),
  allowance_minor integer not null check (allowance_minor between 0 and 1000000000),
  reason text not null check (length(trim(reason)) between 1 and 500),
  unique (organization_id, employee_id, effective_on),
  foreign key (organization_id, employee_id) references public.hr_employees(organization_id, id)
);

create function easyhr_private.is_finance(p_org uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists(select 1 from easyhr_private.finance_reviewers where organization_id = p_org and user_id = auth.uid())
$$;

create function easyhr_private.workflow_audit(p_org uuid, p_action text, p_record uuid) returns void
language sql set search_path = '' as $$
  insert into public.hr_audit_events(organization_id, actor_id, action, record_id)
  values (p_org, auth.uid(), p_action, p_record)
$$;

create function easyhr_private.lock_payroll(p_org uuid, p_period date) returns void
language sql set search_path = '' as $$
  select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_org::text || ':' || p_period::text, 931))
$$;

create function easyhr_private.guard_payroll_draft() returns trigger
language plpgsql set search_path = '' as $$
declare
  org uuid := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
  month date := case when tg_op = 'DELETE' then old.period else new.period end;
begin
  perform easyhr_private.lock_payroll(org, month);
  if exists(select 1 from easyhr_private.payroll_runs where organization_id = org and period = month and status in ('submitted','approved')) then
    raise exception 'Payroll is locked for review';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create trigger payroll_draft_review_lock before insert or update or delete on public.hr_payroll_drafts
for each row execute function easyhr_private.guard_payroll_draft();

create function public.hr_finance_access(p_org uuid, p_user uuid, p_enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if easyhr_private.role_in(p_org) is distinct from 'hr' then raise exception 'HR access required'; end if;
  if p_enabled then
    insert into easyhr_private.finance_reviewers values (p_org, p_user) on conflict do nothing;
  else
    delete from easyhr_private.finance_reviewers where organization_id = p_org and user_id = p_user;
  end if;
  perform easyhr_private.workflow_audit(p_org, case when p_enabled then 'payroll.finance_granted' else 'payroll.finance_revoked' end, p_user);
end $$;

create function public.hr_schedule_compensation(
  p_org uuid, p_employee uuid, p_effective date, p_basic integer, p_allowance integer, p_reason text
) returns void language plpgsql security definer set search_path = '' as $$
declare change_id uuid;
begin
  if easyhr_private.role_in(p_org) is distinct from 'hr' then raise exception 'HR access required'; end if;
  insert into easyhr_private.compensation_changes(organization_id, employee_id, effective_on, basic_minor, allowance_minor, reason)
  values (p_org, p_employee, p_effective, p_basic, p_allowance, trim(p_reason)) returning id into change_id;
  perform easyhr_private.workflow_audit(p_org, 'payroll.compensation_scheduled', change_id);
end $$;

create function public.hr_payroll_review(p_org uuid, p_period date, p_action text, p_version integer, p_comment text)
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

create function public.hr_payroll_workbench(p_org uuid, p_period date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if easyhr_private.role_in(p_org) is distinct from 'hr' and not easyhr_private.is_finance(p_org) then raise exception 'Payroll access required'; end if;
  return jsonb_build_object(
    'finance', easyhr_private.is_finance(p_org),
    'reviewers', array(select user_id from easyhr_private.finance_reviewers where organization_id = p_org),
    'run', (select to_jsonb(r) from easyhr_private.payroll_runs r where organization_id = p_org and period = p_period),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'employee_id', e.id, 'name', e.name, 'basic', d.base_minor, 'additional', d.additional_minor,
        'bonus', d.bonus_minor, 'overtime', d.overtime_minor, 'version', d.version, 'previous_gross', prev.base_minor + prev.additional_minor,
        'previous_bonus', prev.bonus_minor, 'previous_basic', prev.base_minor,
        'previous_allowance', prev.additional_minor - prev.bonus_minor - prev.overtime_minor,
        'scheduled', to_jsonb(c)
      ) order by e.name, e.id)
      from public.hr_employees e
      left join public.hr_payroll_drafts d on d.organization_id = p_org and d.employee_id = e.id and d.period = p_period
      left join public.hr_payroll_drafts prev on prev.organization_id = p_org and prev.employee_id = e.id
        and prev.period = (p_period - interval '1 month')::date
      left join lateral (
        select effective_on, basic_minor, allowance_minor, reason from easyhr_private.compensation_changes c
        where c.organization_id = p_org and c.employee_id = e.id and c.effective_on <= p_period
        order by c.effective_on desc limit 1
      ) c on true
      where e.organization_id = p_org
    ), '[]'::jsonb)
  );
end $$;

revoke all on easyhr_private.finance_reviewers, easyhr_private.payroll_runs, easyhr_private.payslips,
  easyhr_private.compensation_changes from public, anon, authenticated;
revoke all on function easyhr_private.is_finance(uuid), easyhr_private.workflow_audit(uuid,text,uuid),
  easyhr_private.lock_payroll(uuid,date), easyhr_private.guard_payroll_draft() from public;
revoke all on function public.hr_finance_access(uuid,uuid,boolean),
  public.hr_schedule_compensation(uuid,uuid,date,integer,integer,text),
  public.hr_payroll_review(uuid,date,text,integer,text), public.hr_payroll_workbench(uuid,date) from public, anon;
grant execute on function public.hr_finance_access(uuid,uuid,boolean),
  public.hr_schedule_compensation(uuid,uuid,date,integer,integer,text),
  public.hr_payroll_review(uuid,date,text,integer,text), public.hr_payroll_workbench(uuid,date) to authenticated;

commit;
