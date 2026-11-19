begin;

create table easyhr_private.workflow_documents (
  organization_id uuid not null references public.hr_organizations,
  kind text not null check (kind in ('contract','receipt')),
  record_id uuid not null,
  name text not null check (length(trim(name)) between 1 and 180),
  content bytea not null check (octet_length(content) <= 2097152 and substring(content from 1 for 5) = convert_to('%PDF-', 'UTF8')),
  primary key (organization_id, kind, record_id)
);

create table easyhr_private.people_checklists (
  organization_id uuid not null,
  employee_id uuid not null,
  category text not null check (category in ('onboarding','offboarding')),
  due_on date not null,
  primary key (organization_id, employee_id, category, due_on),
  foreign key (organization_id, employee_id) references public.hr_employees(organization_id, id)
);

create function easyhr_private.document_access(p_org uuid, p_kind text, p_record uuid, p_write boolean) returns boolean
language sql stable set search_path = '' as $$
  select case p_kind
    when 'contract' then exists(
      select 1 from public.hr_contracts c join public.hr_employees e on e.id = c.employee_id
      where c.organization_id = p_org and c.id = p_record and
        (easyhr_private.role_in(p_org) = 'hr' or
          (not p_write and c.reviewed_at is not null and e.user_id = auth.uid() and easyhr_private.role_in(p_org) is not null))
    )
    when 'receipt' then exists(
      select 1 from easyhr_private.statutory_remittances r where r.organization_id = p_org and r.id = p_record and
        (easyhr_private.is_finance(p_org) or (not p_write and easyhr_private.role_in(p_org) = 'hr'))
    )
    else false
  end
$$;

create function public.hr_save_workflow_document(p_org uuid, p_kind text, p_record uuid, p_name text, p_content text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not easyhr_private.document_access(p_org, p_kind, p_record, true) then raise exception 'Document access required'; end if;
  if length(p_content) > 2796204 then raise exception 'Use a PDF of 2 MB or less'; end if;
  if p_kind = 'contract' then
    update public.hr_contracts set reviewed_at = null, version = version + 1 where organization_id = p_org and id = p_record;
  end if;
  insert into easyhr_private.workflow_documents(organization_id, kind, record_id, name, content)
  values (p_org, p_kind, p_record, trim(p_name), decode(p_content, 'base64'))
  on conflict(organization_id, kind, record_id) do update set name = excluded.name, content = excluded.content;
  perform easyhr_private.workflow_audit(p_org, p_kind || '.document_uploaded', p_record);
end $$;

create function public.hr_get_workflow_document(p_org uuid, p_kind text, p_record uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not easyhr_private.document_access(p_org, p_kind, p_record, false) then raise exception 'Document access required'; end if;
  return (select jsonb_build_object('name', name, 'content', replace(encode(content, 'base64'), chr(10), ''))
    from easyhr_private.workflow_documents where organization_id = p_org and kind = p_kind and record_id = p_record);
end $$;

create function public.hr_create_checklist(p_org uuid, p_employee uuid, p_category text, p_due date,
  p_hr uuid, p_manager uuid, p_finance uuid, p_it uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare item record;
begin
  if easyhr_private.role_in(p_org) is distinct from 'hr' then raise exception 'HR access required'; end if;
  if p_category is null or p_category not in ('onboarding','offboarding') then raise exception 'Choose a checklist type'; end if;
  if p_hr is null or p_manager is null or p_finance is null or p_it is null then raise exception 'Choose each task owner'; end if;
  insert into easyhr_private.people_checklists values (p_org, p_employee, p_category, p_due)
  on conflict do nothing;
  if not found then return; end if;
  for item in
    select * from (values
      (p_hr, 'Check signed contract and required employee documents', 'Confirm departure documents and archive the employee record'),
      (p_manager, 'Confirm induction, training and first-week plan', 'Confirm handover and return of company equipment'),
      (p_finance, 'Confirm payroll setup and statutory registrations', 'Confirm final-pay inputs and statutory updates'),
      (p_it, 'Prepare accounts, access and equipment', 'Remove access and collect issued equipment')
    ) as items(owner_id, onboarding, offboarding)
  loop
    perform public.hr_create_work_task(p_org, p_employee, item.owner_id, p_category,
      case when p_category = 'onboarding' then item.onboarding else item.offboarding end, p_due);
  end loop;
end $$;

revoke all on easyhr_private.workflow_documents, easyhr_private.people_checklists from public, anon, authenticated;
revoke all on function easyhr_private.document_access(uuid,text,uuid,boolean) from public;
revoke all on function public.hr_save_workflow_document(uuid,text,uuid,text,text),
  public.hr_get_workflow_document(uuid,text,uuid), public.hr_create_checklist(uuid,uuid,text,date,uuid,uuid,uuid,uuid) from public, anon;
grant execute on function public.hr_save_workflow_document(uuid,text,uuid,text,text),
  public.hr_get_workflow_document(uuid,text,uuid), public.hr_create_checklist(uuid,uuid,text,date,uuid,uuid,uuid,uuid) to authenticated;

commit;
