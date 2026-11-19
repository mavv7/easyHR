begin;

create sequence public.hr_company_account_seq start 10001;
alter table public.hr_organizations
  add column account_number text not null unique default ('EH-' || nextval('public.hr_company_account_seq'));
revoke all on sequence public.hr_company_account_seq from public, anon, authenticated;

create table public.hr_company_settings (
  organization_id uuid primary key references public.hr_organizations(id),
  profile jsonb not null default '{"work_days":[1,2,3,4,5],"payment_method":"varies","workers_compensation":false}',
  profile_version integer not null default 0,
  numbering_version integer not null default 0,
  automatic boolean not null default true,
  prefix text not null default 'EMP' check (prefix ~ '^[A-Z0-9]{0,12}$'),
  separator text not null default '' check (separator ~ '^[-_/]?$'),
  digits integer not null default 4 check (digits between 1 and 12),
  next_number bigint not null default 1 check (next_number between 1 and 1000000000000),
  include_year boolean not null default false,
  include_branch boolean not null default false,
  separate_number boolean not null default false
);
insert into public.hr_company_settings(organization_id) select id from public.hr_organizations;

create function easyhr_private.init_company_settings() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.hr_company_settings(organization_id) values (new.id);
  return new;
end $$;
revoke all on function easyhr_private.init_company_settings() from public, anon, authenticated;
create trigger hr_init_company_settings after insert on public.hr_organizations
for each row execute function easyhr_private.init_company_settings();

create table public.hr_pay_points (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.hr_organizations(id),
  name text not null check (char_length(trim(name)) between 1 and 120),
  code text check (code ~ '^[A-Z0-9]{1,12}$'),
  unique (organization_id, id),
  unique (organization_id, code)
);
create unique index hr_pay_point_name on public.hr_pay_points(organization_id, lower(name));

alter table public.hr_employees add column staff_number text,
  add column pay_point_id uuid,
  add constraint hr_employee_pay_point foreign key (organization_id, pay_point_id)
    references public.hr_pay_points(organization_id, id),
  add constraint hr_staff_number_format check (staff_number ~ '^[A-Z0-9][A-Z0-9_/-]{0,63}$');
create unique index hr_unique_staff_number on public.hr_employees (organization_id, staff_number);

alter table public.hr_company_settings enable row level security;
alter table public.hr_pay_points enable row level security;
revoke all on public.hr_company_settings, public.hr_pay_points from public, anon, authenticated;
grant select on public.hr_company_settings, public.hr_pay_points to authenticated;
create policy hr_company_settings_read on public.hr_company_settings for select to authenticated
  using (easyhr_private.role_in(organization_id) = 'hr');
create policy hr_pay_points_read on public.hr_pay_points for select to authenticated
  using (easyhr_private.role_in(organization_id) = 'hr');

create function public.hr_save_company_profile(p_organization_id uuid, p_name text, p_profile jsonb, p_version integer)
returns void language plpgsql security definer set search_path = '' as $$
declare entry record; work_days jsonb := p_profile->'work_days';
begin
  if easyhr_private.role_in(p_organization_id) is distinct from 'hr' then raise exception 'HR access required'; end if;
  if jsonb_typeof(p_profile) is distinct from 'object' then raise exception 'Enter a valid company profile'; end if;
  for entry in select * from jsonb_each(p_profile) loop
    if entry.key in ('work_days', 'workers_compensation') then continue; end if;
    if entry.key not in ('phone','address','city','email','legal_name','trading_name','registration_number','postal_address',
      'industry','business','signatory','signatory_title','pay_day','payment_method','tpin','napsa','nhima')
      or jsonb_typeof(entry.value) <> 'string' or length(p_profile->>entry.key) > 300
    then raise exception 'Invalid company profile field'; end if;
  end loop;
  if jsonb_typeof(work_days) is distinct from 'array' then raise exception 'Choose ordinary working days'; end if;
  if jsonb_array_length(work_days) not between 1 and 7
    or exists (select 1 from jsonb_array_elements(work_days) d where d::text !~ '^[1-7]$')
    or (select count(distinct d) from jsonb_array_elements(work_days) d) <> jsonb_array_length(work_days)
  then raise exception 'Choose ordinary working days'; end if;
  if jsonb_typeof(p_profile->'workers_compensation') is distinct from 'boolean'
    or coalesce(p_profile->>'payment_method', '') not in ('varies','bank','mobile','cash','cheque')
    or coalesce(p_profile->>'pay_day', '') !~ '^([1-9]|[12][0-9]|3[01])?$'
    or coalesce(p_profile->>'tpin', '') !~ '^([0-9]{10})?$'
    or coalesce(p_profile->>'napsa', '') !~ '^[0-9]{0,30}$'
    or coalesce(p_profile->>'nhima', '') !~ '^[0-9]{0,30}$'
    or coalesce(p_profile->>'email', '') !~ '^([^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+)?$'
  then raise exception 'Check the company email, pay day, payment method and statutory account numbers'; end if;
  update public.hr_company_settings set profile = p_profile, profile_version = profile_version + 1
    where organization_id = p_organization_id and profile_version = p_version;
  if not found then raise exception 'Company profile changed. Reload settings and try again'; end if;
  update public.hr_organizations set name = trim(p_name) where id = p_organization_id;
  insert into public.hr_audit_events(organization_id, actor_id, action, record_id)
    values (p_organization_id, auth.uid(), 'organization.profile_saved', p_organization_id);
end $$;

create function public.hr_save_numbering(p_organization_id uuid, p_version integer, p_automatic boolean, p_prefix text,
  p_separator text, p_digits integer, p_next_number bigint, p_include_year boolean, p_include_branch boolean, p_separate_number boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if easyhr_private.role_in(p_organization_id) is distinct from 'hr' then raise exception 'HR access required'; end if;
  update public.hr_company_settings set automatic = p_automatic, prefix = upper(trim(p_prefix)), separator = p_separator,
    digits = p_digits, next_number = p_next_number, include_year = p_include_year, include_branch = p_include_branch,
    separate_number = p_separate_number, numbering_version = numbering_version + 1
    where organization_id = p_organization_id and numbering_version = p_version;
  if not found then raise exception 'Numbering changed. Reload settings and try again'; end if;
  insert into public.hr_audit_events(organization_id, actor_id, action, record_id)
    values (p_organization_id, auth.uid(), 'organization.numbering_saved', p_organization_id);
end $$;

create function public.hr_add_pay_point(p_organization_id uuid, p_name text, p_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare result uuid;
begin
  if easyhr_private.role_in(p_organization_id) is distinct from 'hr' then raise exception 'HR access required'; end if;
  insert into public.hr_pay_points(organization_id, name, code)
    values (p_organization_id, trim(p_name), nullif(upper(trim(p_code)), '')) returning id into result;
  insert into public.hr_audit_events(organization_id, actor_id, action, record_id)
    values (p_organization_id, auth.uid(), 'organization.pay_point_added', result);
  return result;
end $$;

alter function public.hr_save_employee(uuid,text,text,text,text,integer,uuid,uuid,integer) set schema easyhr_private;
revoke all on function easyhr_private.hr_save_employee(uuid,text,text,text,text,integer,uuid,uuid,integer) from public, anon, authenticated;

create function public.hr_save_employee(p_organization_id uuid, p_name text, p_job_title text, p_department text, p_email text,
  p_leave_balance integer, p_manager_user_id uuid default null, p_id uuid default null, p_version integer default null,
  p_staff_number text default null, p_pay_point_id uuid default null, p_update_staff_details boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare result uuid; policy public.hr_company_settings; branch text; stem text; serial bigint; staff text;
begin
  if easyhr_private.role_in(p_organization_id) is distinct from 'hr' then raise exception 'HR access required'; end if;
  if p_id is null then
    select * into strict policy from public.hr_company_settings where organization_id = p_organization_id for update;
    if p_pay_point_id is not null then
      select code into branch from public.hr_pay_points where organization_id = p_organization_id and id = p_pay_point_id;
      if not found then raise exception 'Choose a pay point in this company'; end if;
    end if;
    if policy.automatic then
      stem := concat_ws(policy.separator,
        case when policy.include_branch then branch end,
        nullif(policy.prefix, ''),
        case when policy.include_year then to_char(now() at time zone 'Africa/Lusaka', 'YYYY') end);
      serial := policy.next_number;
      loop
        if serial >= 1000000000000 then raise exception 'Employee numbering sequence exhausted'; end if;
        staff := stem || case when stem <> '' and policy.separate_number then policy.separator else '' end
          || lpad(serial::text, greatest(policy.digits, length(serial::text)), '0');
        exit when not exists (select 1 from public.hr_employees where organization_id = p_organization_id and staff_number = staff);
        serial := serial + 1;
      end loop;
      update public.hr_company_settings set next_number = serial + 1, numbering_version = numbering_version + 1
        where organization_id = p_organization_id;
    else
      staff := nullif(upper(trim(p_staff_number)), '');
      if staff is null then raise exception 'Enter an employee number'; end if;
    end if;
  end if;
  result := easyhr_private.hr_save_employee(p_organization_id, p_name, p_job_title, p_department, p_email,
    p_leave_balance, p_manager_user_id, p_id, p_version);
  if p_id is null or p_update_staff_details then
    update public.hr_employees set staff_number = coalesce(staff, staff_number), pay_point_id = p_pay_point_id where id = result;
  end if;
  return result;
exception when unique_violation then
  if sqlerrm like '%hr_unique_staff_number%' then raise exception 'Employee number already exists in this company'; end if;
  raise;
end $$;

revoke all on function public.hr_save_company_profile(uuid,text,jsonb,integer),
  public.hr_save_numbering(uuid,integer,boolean,text,text,integer,bigint,boolean,boolean,boolean),
  public.hr_add_pay_point(uuid,text,text),
  public.hr_save_employee(uuid,text,text,text,text,integer,uuid,uuid,integer,text,uuid,boolean) from public, anon;
grant execute on function public.hr_save_company_profile(uuid,text,jsonb,integer),
  public.hr_save_numbering(uuid,integer,boolean,text,text,integer,bigint,boolean,boolean,boolean),
  public.hr_add_pay_point(uuid,text,text),
  public.hr_save_employee(uuid,text,text,text,text,integer,uuid,uuid,integer,text,uuid,boolean) to authenticated;

commit;
