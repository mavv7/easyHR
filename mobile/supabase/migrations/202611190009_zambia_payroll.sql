begin;

alter table public.hr_contracts
  add column basic_minor integer check (basic_minor between 0 and 1000000000),
  add column pay_terms text check (length(pay_terms) <= 2000);

-- The existing additional-pay total includes the bonus for compatibility with older readers.
alter table public.hr_payroll_drafts
  add column bonus_minor integer not null default 0 check (bonus_minor between 0 and additional_minor);

create function public.hr_save_contract(p_org uuid, p_employee uuid, p_title text, p_start date, p_end date, p_id uuid, p_version integer, p_basic integer, p_pay_terms text)
returns void language plpgsql security definer set search_path = '' as $$
declare contract_id uuid;
begin
  if easyhr_private.role_in(p_org) is distinct from 'hr' then raise exception 'HR access required'; end if;
  if p_id is null then
    insert into public.hr_contracts(organization_id, employee_id, title, start_date, end_date, basic_minor, pay_terms)
    values (p_org, p_employee, trim(p_title), p_start, p_end, p_basic, nullif(trim(p_pay_terms), '')) returning id into contract_id;
  else
    update public.hr_contracts set title = trim(p_title), start_date = p_start, end_date = p_end,
      basic_minor = p_basic, pay_terms = nullif(trim(p_pay_terms), ''),
      reviewed_at = null, version = version + 1
    where id = p_id and organization_id = p_org and employee_id = p_employee and version = p_version
    returning id into contract_id;
    if not found then raise exception 'Contract changed. Refresh and try again'; end if;
  end if;
  insert into public.hr_audit_events(organization_id, actor_id, action, record_id)
  values (p_org, auth.uid(), case when p_id is null then 'contract.created' else 'contract.updated' end, contract_id);
end $$;

create function public.hr_save_payroll_draft(p_org uuid, p_employee uuid, p_period date, p_base integer, p_additional integer, p_version integer, p_bonus integer)
returns void language plpgsql security definer set search_path = '' as $$
declare draft_id uuid;
begin
  if easyhr_private.role_in(p_org) is distinct from 'hr' then raise exception 'HR access required'; end if;
  if p_version is null then
    insert into public.hr_payroll_drafts(organization_id, employee_id, period, base_minor, additional_minor, bonus_minor)
    values (p_org, p_employee, p_period, p_base, p_additional, p_bonus)
    on conflict (organization_id, period, employee_id) do nothing returning id into draft_id;
  else
    update public.hr_payroll_drafts set base_minor = p_base, additional_minor = p_additional, bonus_minor = p_bonus, version = version + 1
    where organization_id = p_org and employee_id = p_employee and period = p_period and version = p_version
    returning id into draft_id;
  end if;
  if draft_id is null then raise exception 'Payroll draft changed. Refresh and try again'; end if;
  insert into public.hr_audit_events(organization_id, actor_id, action, record_id)
  values (p_org, auth.uid(), 'payroll.draft_saved', draft_id);
end $$;

-- Older clients supply an unclassified additional-pay total.
create or replace function public.hr_save_payroll_draft(
  p_org uuid, p_employee uuid, p_period date, p_base integer, p_additional integer, p_version integer
) returns void language sql security invoker set search_path = '' as $$
  select public.hr_save_payroll_draft(p_org, p_employee, p_period, p_base, p_additional, p_version, 0)
$$;

revoke all on function public.hr_save_contract(uuid,uuid,text,date,date,uuid,integer,integer,text),
  public.hr_save_payroll_draft(uuid,uuid,date,integer,integer,integer,integer) from public, anon;
grant execute on function public.hr_save_contract(uuid,uuid,text,date,date,uuid,integer,integer,text),
  public.hr_save_payroll_draft(uuid,uuid,date,integer,integer,integer,integer) to authenticated;

commit;
