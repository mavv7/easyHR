begin;

create table public.hr_contracts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  employee_id uuid not null,
  title text not null check (length(trim(title)) between 2 and 120),
  start_date date not null,
  end_date date check (end_date >= start_date),
  reviewed_at timestamptz,
  version integer not null default 1,
  foreign key (organization_id, employee_id) references public.hr_employees(organization_id, id)
);
create index hr_contracts_org on public.hr_contracts(organization_id, id);

create table public.hr_payroll_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  employee_id uuid not null,
  period date not null check (extract(day from period) = 1),
  base_minor integer not null check (base_minor between 0 and 1000000000),
  additional_minor integer not null check (additional_minor between 0 and 1000000000),
  version integer not null default 1,
  unique (organization_id, period, employee_id),
  foreign key (organization_id, employee_id) references public.hr_employees(organization_id, id)
);

alter table public.hr_contracts enable row level security;
alter table public.hr_payroll_drafts enable row level security;
revoke all on public.hr_contracts, public.hr_payroll_drafts from public, anon, authenticated;
grant select on public.hr_contracts, public.hr_payroll_drafts to authenticated;
create policy contract_hr_read on public.hr_contracts for select to authenticated using (easyhr_private.role_in(organization_id) = 'hr');
create policy payroll_hr_read on public.hr_payroll_drafts for select to authenticated using (easyhr_private.role_in(organization_id) = 'hr');

create function public.hr_save_contract(p_org uuid, p_employee uuid, p_title text, p_start date, p_end date, p_id uuid, p_version integer)
returns void language plpgsql security definer set search_path = '' as $$
declare contract_id uuid;
begin
  if easyhr_private.role_in(p_org) is distinct from 'hr' then raise exception 'HR access required'; end if;
  if p_id is null then
    insert into public.hr_contracts(organization_id, employee_id, title, start_date, end_date)
    values (p_org, p_employee, trim(p_title), p_start, p_end) returning id into contract_id;
  else
    update public.hr_contracts set title = trim(p_title), start_date = p_start, end_date = p_end,
      reviewed_at = null, version = version + 1
    where id = p_id and organization_id = p_org and employee_id = p_employee and version = p_version
    returning id into contract_id;
    if not found then raise exception 'Contract changed. Refresh and try again'; end if;
  end if;
  insert into public.hr_audit_events(organization_id, actor_id, action, record_id)
  values (p_org, auth.uid(), case when p_id is null then 'contract.created' else 'contract.updated' end, contract_id);
end $$;

create function public.hr_review_contract(p_org uuid, p_id uuid, p_version integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if easyhr_private.role_in(p_org) is distinct from 'hr' then raise exception 'HR access required'; end if;
  update public.hr_contracts set reviewed_at = now(), version = version + 1
  where id = p_id and organization_id = p_org and version = p_version and reviewed_at is null;
  if not found then raise exception 'Contract changed. Refresh and try again'; end if;
  insert into public.hr_audit_events(organization_id, actor_id, action, record_id)
  values (p_org, auth.uid(), 'contract.reviewed', p_id);
end $$;

create function public.hr_save_payroll_draft(p_org uuid, p_employee uuid, p_period date, p_base integer, p_additional integer, p_version integer)
returns void language plpgsql security definer set search_path = '' as $$
declare draft_id uuid;
begin
  if easyhr_private.role_in(p_org) is distinct from 'hr' then raise exception 'HR access required'; end if;
  if p_version is null then
    insert into public.hr_payroll_drafts(organization_id, employee_id, period, base_minor, additional_minor)
    values (p_org, p_employee, p_period, p_base, p_additional)
    on conflict (organization_id, period, employee_id) do nothing returning id into draft_id;
  else
    update public.hr_payroll_drafts set base_minor = p_base, additional_minor = p_additional, version = version + 1
    where organization_id = p_org and employee_id = p_employee and period = p_period and version = p_version
    returning id into draft_id;
  end if;
  if draft_id is null then raise exception 'Payroll draft changed. Refresh and try again'; end if;
  insert into public.hr_audit_events(organization_id, actor_id, action, record_id)
  values (p_org, auth.uid(), 'payroll.draft_saved', draft_id);
end $$;

revoke all on function public.hr_save_contract(uuid,uuid,text,date,date,uuid,integer),
  public.hr_review_contract(uuid,uuid,integer), public.hr_save_payroll_draft(uuid,uuid,date,integer,integer,integer) from public, anon;
grant execute on function public.hr_save_contract(uuid,uuid,text,date,date,uuid,integer),
  public.hr_review_contract(uuid,uuid,integer), public.hr_save_payroll_draft(uuid,uuid,date,integer,integer,integer) to authenticated;

commit;
