-- TestTrace relational schema. Run once in the Supabase SQL editor.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '', email text not null default '', avatar_url text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(), name text not null, description text not null default '',
  automation_base_url text,
  automation_schedule_enabled boolean not null default false,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.projects add column if not exists automation_base_url text;
alter table public.projects add column if not exists automation_schedule_enabled boolean not null default false;
create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('admin','lead','member','viewer')),
  joined_at timestamptz not null default now(), primary key(project_id,user_id)
);
insert into public.profiles(id,display_name,email)
select id,coalesce(raw_user_meta_data->>'display_name',split_part(email,'@',1)),coalesce(email,'') from auth.users
on conflict(id) do nothing;
alter table public.project_members drop constraint if exists project_members_user_id_fkey;
alter table public.project_members add constraint project_members_user_id_fkey foreign key(user_id) references public.profiles(id) on delete cascade;
create table if not exists public.requirements (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade,
  key text not null, title text not null, description text not null default '',
  priority text not null default 'medium' check(priority in ('low','medium','high','critical')),
  status text not null default 'draft' check(status in ('draft','approved','implemented','deprecated')),
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(project_id,key)
);
create table if not exists public.test_cases (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade,
  key text not null, title text not null, objective text not null default '', preconditions text not null default '',
  steps jsonb not null default '[]'::jsonb, expected_result text not null default '', module text not null default 'General',
  priority text not null default 'medium' check(priority in ('low','medium','high','critical')),
  status text not null default 'pending' check(status in ('pending','in_progress','passed','failed','blocked')),
  automation_type text not null default 'manual' check(automation_type in ('manual','playwright','selenium','newman')),
  automation_file text, assigned_to uuid references auth.users(id) on delete set null,
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(project_id,key)
);
create table if not exists public.requirement_test_cases (
  requirement_id uuid not null references public.requirements(id) on delete cascade,
  test_case_id uuid not null references public.test_cases(id) on delete cascade, primary key(requirement_id,test_case_id)
);
create table if not exists public.test_cycles (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade,
  name text not null, version text not null default '',
  status text not null default 'planned' check(status in ('planned','active','completed','archived')),
  starts_at date, ends_at date, created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.cycle_test_cases (
  cycle_id uuid not null references public.test_cycles(id) on delete cascade,
  test_case_id uuid not null references public.test_cases(id) on delete cascade, primary key(cycle_id,test_case_id)
);
create table if not exists public.test_runs (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade,
  cycle_id uuid references public.test_cycles(id) on delete set null, triggered_by uuid references auth.users(id) on delete set null,
  source text not null default 'manual' check(source in ('manual','playwright','selenium','newman','schedule','website')),
  status text not null default 'queued' check(status in ('queued','running','passed','failed','cancelled')),
  branch text, commit_sha text, started_at timestamptz, finished_at timestamptz,
  summary jsonb not null default '{}'::jsonb, worker_run_id text, created_at timestamptz not null default now()
);
alter table public.test_runs drop constraint if exists test_runs_source_check;
alter table public.test_runs add constraint test_runs_source_check check(source in ('manual','playwright','selenium','newman','schedule','website'));
create table if not exists public.test_results (
  id uuid primary key default gen_random_uuid(), run_id uuid not null references public.test_runs(id) on delete cascade,
  test_case_id uuid references public.test_cases(id) on delete set null,
  status text not null check(status in ('passed','failed','blocked','skipped')),
  duration_ms integer not null default 0 check(duration_ms>=0), error_message text,
  evidence jsonb not null default '[]'::jsonb, executed_at timestamptz not null default now()
);
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade,
  title text not null, description text not null default '', status text not null default 'todo' check(status in ('todo','in_progress','done')),
  priority text not null default 'medium' check(priority in ('low','medium','high','critical')),
  assigned_to uuid references auth.users(id) on delete set null, due_at date,
  linked_test_case_id uuid references public.test_cases(id) on delete set null,
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.defects (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade,
  key text not null, title text not null, description text not null default '',
  severity text not null default 'medium' check(severity in ('low','medium','high','critical')),
  status text not null default 'open' check(status in ('open','in_progress','resolved','closed')),
  linked_test_case_id uuid references public.test_cases(id) on delete set null,
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(project_id,key)
);
create table if not exists public.test_case_attachments (
  id uuid primary key default gen_random_uuid(), test_case_id uuid not null references public.test_cases(id) on delete cascade,
  storage_path text not null unique, file_name text not null, mime_type text not null, file_size bigint not null check(file_size>=0),
  uploaded_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create table if not exists public.audit_log (
  id bigint generated always as identity primary key, project_id uuid not null references public.projects(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null, entity_type text not null, entity_id uuid not null,
  action text not null, before_data jsonb, after_data jsonb, created_at timestamptz not null default now()
);
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, title text not null, message text not null default '',
  href text not null default '/', read_at timestamptz, created_at timestamptz not null default now()
);

create index if not exists project_members_user_idx on public.project_members(user_id);
create index if not exists requirements_project_status_idx on public.requirements(project_id,status);
create index if not exists test_cases_project_status_idx on public.test_cases(project_id,status);
create index if not exists test_cases_assignee_idx on public.test_cases(assigned_to);
create index if not exists test_runs_project_created_idx on public.test_runs(project_id,created_at desc);
create index if not exists test_results_run_idx on public.test_results(run_id);
create index if not exists tasks_project_status_idx on public.tasks(project_id,status);
create index if not exists defects_project_status_idx on public.defects(project_id,status);
create index if not exists audit_log_project_created_idx on public.audit_log(project_id,created_at desc);
create index if not exists notifications_user_unread_idx on public.notifications(user_id,created_at desc) where read_at is null;

create or replace function public.is_project_member(target_project uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.project_members pm where pm.project_id=target_project and pm.user_id=auth.uid()) $$;
create or replace function public.can_edit_project(target_project uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.project_members pm where pm.project_id=target_project and pm.user_id=auth.uid() and pm.role in ('admin','lead','member')) $$;
create or replace function public.is_project_admin(target_project uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.project_members pm where pm.project_id=target_project and pm.user_id=auth.uid() and pm.role='admin') $$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public
as $$ begin
  insert into public.profiles(id,display_name,email) values(new.id,coalesce(new.raw_user_meta_data->>'display_name',split_part(new.email,'@',1)),coalesce(new.email,''))
  on conflict(id) do update set email=excluded.email;
  return new;
end; $$;
drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile after insert on auth.users for each row execute procedure public.handle_new_user();
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path=public
as $$ begin new.updated_at=now(); return new; end; $$;
do $$
declare tbl text;
begin
  foreach tbl in array array['profiles','projects','requirements','test_cases','test_cycles','tasks','defects'] loop
    execute format('drop trigger if exists set_updated_at on public.%I',tbl);
    execute format('create trigger set_updated_at before update on public.%I for each row execute procedure public.set_updated_at()',tbl);
  end loop;
end $$;

create or replace function public.capture_audit()
returns trigger language plpgsql security definer set search_path=public
as $$
declare old_json jsonb; new_json jsonb; project_key uuid; entity_key uuid; action_name text;
begin
  old_json=case when tg_op='INSERT' then null else to_jsonb(old) end;
  new_json=case when tg_op='DELETE' then null else to_jsonb(new) end;
  project_key=coalesce((new_json->>'project_id')::uuid,(old_json->>'project_id')::uuid);
  entity_key=coalesce((new_json->>'id')::uuid,(old_json->>'id')::uuid);
  action_name=lower(tg_op);
  if tg_table_name='test_cases' and tg_op='UPDATE' and old.status is distinct from new.status then action_name='status_changed'; end if;
  if project_key is not null and entity_key is not null then
    insert into public.audit_log(project_id,actor_id,entity_type,entity_id,action,before_data,after_data)
    values(project_key,auth.uid(),tg_table_name,entity_key,action_name,old_json,new_json);
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end; $$;
do $$
declare tbl text;
begin
  foreach tbl in array array['requirements','test_cases','test_cycles','tasks','defects','test_runs'] loop
    execute format('drop trigger if exists capture_audit on public.%I',tbl);
    execute format('create trigger capture_audit after insert or update or delete on public.%I for each row execute procedure public.capture_audit()',tbl);
  end loop;
end $$;

create or replace function public.validate_project_assignee()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  if new.assigned_to is not null and not exists(select 1 from public.project_members where project_id=new.project_id and user_id=new.assigned_to) then
    raise exception 'Assignee must be a member of this workspace';
  end if;
  return new;
end; $$;
drop trigger if exists validate_test_case_assignee on public.test_cases;
create trigger validate_test_case_assignee before insert or update of project_id,assigned_to on public.test_cases for each row execute procedure public.validate_project_assignee();
drop trigger if exists validate_task_assignee on public.tasks;
create trigger validate_task_assignee before insert or update of project_id,assigned_to on public.tasks for each row execute procedure public.validate_project_assignee();

create or replace function public.validate_project_case_link()
returns trigger language plpgsql security definer set search_path=public
as $$
declare parent_project uuid; case_project uuid;
begin
  if tg_table_name='requirement_test_cases' then select project_id into parent_project from public.requirements where id=new.requirement_id;
  else select project_id into parent_project from public.test_cycles where id=new.cycle_id; end if;
  select project_id into case_project from public.test_cases where id=new.test_case_id;
  if parent_project is null or case_project is null or parent_project<>case_project then raise exception 'Linked test cases must belong to the same workspace'; end if;
  return new;
end; $$;
drop trigger if exists validate_requirement_case_project on public.requirement_test_cases;
create trigger validate_requirement_case_project before insert or update on public.requirement_test_cases for each row execute procedure public.validate_project_case_link();
drop trigger if exists validate_cycle_case_project on public.cycle_test_cases;
create trigger validate_cycle_case_project before insert or update on public.cycle_test_cases for each row execute procedure public.validate_project_case_link();

create or replace function public.notify_project_change()
returns trigger language plpgsql security definer set search_path=public
as $$
declare member_id uuid; title_text text; message_text text; destination text; should_notify boolean;
begin
  if tg_table_name='tasks' then
    if tg_op='INSERT' then
      should_notify := new.assigned_to is not null;
    else
      should_notify := new.assigned_to is not null and old.assigned_to is distinct from new.assigned_to;
    end if;
    if should_notify and new.assigned_to<>coalesce(auth.uid(),'00000000-0000-0000-0000-000000000000'::uuid) then
      insert into public.notifications(project_id,user_id,title,message,href) values(new.project_id,new.assigned_to,'Task assigned to you',new.title,'/');
    end if;
  elsif tg_table_name='defects' and tg_op='INSERT' then
    title_text='New defect reported'; message_text=new.key||' | '||new.title; destination='/';
    for member_id in select user_id from public.project_members where project_id=new.project_id and user_id<>coalesce(auth.uid(),'00000000-0000-0000-0000-000000000000'::uuid) loop
      insert into public.notifications(project_id,user_id,title,message,href) values(new.project_id,member_id,title_text,message_text,destination);
    end loop;
  elsif tg_table_name='test_runs' and tg_op='UPDATE' and old.status in ('queued','running') and new.status in ('passed','failed','cancelled') then
    title_text=case when new.status='passed' then 'Automation run completed' else 'Automation run needs attention' end;
    message_text=coalesce(new.summary->>'total','0')||' test cases | '||coalesce(new.summary->>'failed','0')||' failed';
    for member_id in select user_id from public.project_members where project_id=new.project_id and user_id<>coalesce(new.triggered_by,'00000000-0000-0000-0000-000000000000'::uuid) loop
      insert into public.notifications(project_id,user_id,title,message,href) values(new.project_id,member_id,title_text,message_text,'/');
    end loop;
  end if;
  return new;
end; $$;
drop trigger if exists notify_task_assignment on public.tasks;
create trigger notify_task_assignment after insert or update of assigned_to on public.tasks for each row execute procedure public.notify_project_change();
drop trigger if exists notify_defect_created on public.defects;
create trigger notify_defect_created after insert on public.defects for each row execute procedure public.notify_project_change();
drop trigger if exists notify_run_completed on public.test_runs;
create trigger notify_run_completed after update of status on public.test_runs for each row execute procedure public.notify_project_change();

create or replace function public.bootstrap_project(project_name text default 'My workspace')
returns uuid language plpgsql security definer set search_path=public,auth
as $$
declare uid uuid=auth.uid(); pid uuid; cid uuid; run_uuid uuid;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  insert into public.profiles(id,display_name,email) select id,coalesce(raw_user_meta_data->>'display_name',split_part(email,'@',1)),coalesce(email,'') from auth.users where id=uid on conflict(id) do nothing;
  insert into public.projects(name,description,created_by) values(left(trim(project_name),80),'Quality workspace',uid) returning id into pid;
  insert into public.project_members(project_id,user_id,role) values(pid,uid,'admin');
  insert into public.test_cycles(project_id,name,version,status,starts_at,ends_at,created_by) values(pid,'Release 1.0','1.0','active',current_date,current_date+14,uid) returning id into cid;
  insert into public.requirements(project_id,key,title,description,status,created_by) values
    (pid,'REQ-001','Secure account access','Users can sign in and recover their account securely.','approved',uid),
    (pid,'REQ-002','Manage team workspace','Workspace administrators can add and manage team members.','approved',uid),
    (pid,'REQ-003','Export execution reports','Team members can export a test cycle summary.','approved',uid);
  insert into public.test_cases(project_id,key,title,objective,module,priority,status,automation_type,steps,expected_result,created_by) values
    (pid,'TC-001','Sign in with valid credentials','Confirm a member can sign in.','Authentication','high','passed','playwright','[{"action":"goto","value":"/login"},{"action":"fill","selector":"input[name=email]","value":"{{env:E2E_EMAIL}}"},{"action":"fill","selector":"input[name=password]","value":"{{env:E2E_PASSWORD}}"},{"action":"click","selector":"button[type=submit]"},{"action":"expect_url","value":"/"}]'::jsonb,'The workspace overview opens. Configure the CI account in repository secrets.',uid),
    (pid,'TC-002','Show an error for an invalid password','Verify rejected sign-in attempts are explained.','Authentication','medium','pending','manual','[]'::jsonb,'A clear validation message appears and no session is created.',uid),
    (pid,'TC-003','Add a member to the workspace','Check workspace membership management.','Workspace','high','in_progress','manual','[]'::jsonb,'The invited member appears with the selected role.',uid),
    (pid,'TC-004','Filter test cases by status','Check the test case status filters.','Test management','low','passed','manual','[]'::jsonb,'Only matching cases are shown.',uid),
    (pid,'TC-005','Export cycle execution report','Check the downloadable cycle report.','Reporting','medium','blocked','manual','[]'::jsonb,'A report downloads with cycle results and traceability.',uid),
    (pid,'TC-006','Health endpoint responds','Confirm the application health route is available.','API','low','pending','newman','[]'::jsonb,'Returns a successful response with a healthy status. Configure a Newman collection path in the case.',uid),
    (pid,'TC-007','Sign in with Selenium browser','Confirm a member can sign in with a second browser driver.','Authentication','medium','pending','selenium','[{"action":"goto","value":"/login"},{"action":"fill","selector":"input[name=email]","value":"{{env:E2E_EMAIL}}"},{"action":"fill","selector":"input[name=password]","value":"{{env:E2E_PASSWORD}}"},{"action":"click","selector":"button[type=submit]"},{"action":"expect_url","value":"/"}]'::jsonb,'The workspace overview opens in Chrome.',uid);
  update public.test_cases set automation_file='automation/collections/health.postman_collection.json' where project_id=pid and key='TC-006';
  insert into public.cycle_test_cases(cycle_id,test_case_id) select cid,id from public.test_cases where project_id=pid;
  insert into public.test_runs(project_id,cycle_id,triggered_by,source,status,started_at,finished_at,summary)
    values(pid,cid,uid,'manual','failed',now()-interval '1 hour',now()-interval '55 minutes','{"total":7,"passed":2,"failed":0,"blocked":1,"skipped":4}'::jsonb) returning id into run_uuid;
  insert into public.test_results(run_id,test_case_id,status) select run_uuid,id,case status when 'passed' then 'passed' when 'failed' then 'failed' when 'blocked' then 'blocked' else 'skipped' end from public.test_cases where project_id=pid;
  insert into public.requirement_test_cases(requirement_id,test_case_id)
    select r.id,c.id from public.requirements r join public.test_cases c on c.project_id=r.project_id
    where r.project_id=pid and ((r.key='REQ-001' and c.key in ('TC-001','TC-002')) or (r.key='REQ-002' and c.key='TC-003') or (r.key='REQ-003' and c.key='TC-005'));
  insert into public.tasks(project_id,title,description,status,priority,due_at,linked_test_case_id,created_by)
    select pid,'Review sign-in validation','Confirm the invalid credential message and lockout behavior.','todo','high',current_date+1,id,uid from public.test_cases where project_id=pid and key='TC-002';
  insert into public.tasks(project_id,title,description,status,priority,due_at,created_by) values(pid,'Prepare release 1.0 summary','Review cycle results and traceability before release.','todo','medium',current_date+7,uid);
  insert into public.defects(project_id,key,title,description,severity,status,linked_test_case_id,created_by)
    select pid,'BUG-001','Cycle report export is unavailable','The report export check is blocked pending the reporting workflow.','medium','open',id,uid from public.test_cases where project_id=pid and key='TC-005';
  return pid;
end; $$;

create or replace function public.add_project_member(target_project uuid, member_email text, member_role text default 'member')
returns uuid language plpgsql security definer set search_path=public,auth
as $$
declare member_uuid uuid;
begin
  if not public.is_project_admin(target_project) then raise exception 'Project administrator role required'; end if;
  if member_role not in ('lead','member','viewer') then raise exception 'Invalid member role'; end if;
  select id into member_uuid from auth.users where lower(email)=lower(trim(member_email));
  if member_uuid is null then raise exception 'Create an account for this email before adding it to the workspace'; end if;
  insert into public.profiles(id,display_name,email) select id,coalesce(raw_user_meta_data->>'display_name',split_part(email,'@',1)),coalesce(email,'') from auth.users where id=member_uuid on conflict(id) do nothing;
  insert into public.project_members(project_id,user_id,role) values(target_project,member_uuid,member_role)
  on conflict(project_id,user_id) do update set role=excluded.role;
  return member_uuid;
end; $$;

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.requirements enable row level security;
alter table public.test_cases enable row level security;
alter table public.requirement_test_cases enable row level security;
alter table public.test_cycles enable row level security;
alter table public.cycle_test_cases enable row level security;
alter table public.test_runs enable row level security;
alter table public.test_results enable row level security;
alter table public.tasks enable row level security;
alter table public.defects enable row level security;
alter table public.test_case_attachments enable row level security;
alter table public.audit_log enable row level security;
alter table public.notifications enable row level security;

drop policy if exists "members read projects" on public.projects;
create policy "members read projects" on public.projects for select using(public.is_project_member(id));
drop policy if exists "admins update projects" on public.projects;
create policy "admins update projects" on public.projects for update using(public.is_project_admin(id)) with check(public.is_project_admin(id));
drop policy if exists "profile read self or project member" on public.profiles;
create policy "profile read self or project member" on public.profiles for select using(id=auth.uid() or exists(select 1 from public.project_members mine join public.project_members theirs on theirs.project_id=mine.project_id where mine.user_id=auth.uid() and theirs.user_id=id));
drop policy if exists "profile update self" on public.profiles;
create policy "profile update self" on public.profiles for update using(id=auth.uid()) with check(id=auth.uid());
drop policy if exists "members read membership" on public.project_members;
create policy "members read membership" on public.project_members for select using(public.is_project_member(project_id));
drop policy if exists "admins remove membership" on public.project_members;
create policy "admins remove membership" on public.project_members for delete using(public.is_project_admin(project_id) and user_id<>auth.uid());

do $$
declare tbl text;
begin
  foreach tbl in array array['requirements','test_cases','test_cycles','tasks','defects'] loop
    execute format('drop policy if exists "members read %s" on public.%I',tbl,tbl);
    execute format('create policy "members read %s" on public.%I for select using(public.is_project_member(project_id))',tbl,tbl);
    execute format('drop policy if exists "editors manage %s" on public.%I',tbl,tbl);
    execute format('create policy "editors manage %s" on public.%I for all using(public.can_edit_project(project_id)) with check(public.can_edit_project(project_id))',tbl,tbl);
  end loop;
end $$;
drop policy if exists "members read test runs" on public.test_runs;
create policy "members read test runs" on public.test_runs for select using(public.is_project_member(project_id));
drop policy if exists "editors create test runs" on public.test_runs;
create policy "editors create test runs" on public.test_runs for insert with check(public.can_edit_project(project_id));
drop policy if exists "editors update test runs" on public.test_runs;
create policy "editors update test runs" on public.test_runs for update using(public.can_edit_project(project_id)) with check(public.can_edit_project(project_id));
drop policy if exists "members read results" on public.test_results;
create policy "members read results" on public.test_results for select using(exists(select 1 from public.test_runs r where r.id=run_id and public.is_project_member(r.project_id)));
drop policy if exists "editors insert results" on public.test_results;
create policy "editors insert results" on public.test_results for insert with check(exists(select 1 from public.test_runs r where r.id=run_id and public.can_edit_project(r.project_id)));
drop policy if exists "members read requirement links" on public.requirement_test_cases;
create policy "members read requirement links" on public.requirement_test_cases for select using(exists(select 1 from public.requirements r where r.id=requirement_id and public.is_project_member(r.project_id)));
drop policy if exists "editors manage requirement links" on public.requirement_test_cases;
create policy "editors manage requirement links" on public.requirement_test_cases for all using(exists(select 1 from public.requirements r where r.id=requirement_id and public.can_edit_project(r.project_id))) with check(exists(select 1 from public.requirements r join public.test_cases c on c.id=test_case_id and c.project_id=r.project_id where r.id=requirement_id and public.can_edit_project(r.project_id)));
drop policy if exists "members read cycle links" on public.cycle_test_cases;
create policy "members read cycle links" on public.cycle_test_cases for select using(exists(select 1 from public.test_cycles c where c.id=cycle_id and public.is_project_member(c.project_id)));
drop policy if exists "editors manage cycle links" on public.cycle_test_cases;
create policy "editors manage cycle links" on public.cycle_test_cases for all using(exists(select 1 from public.test_cycles c join public.test_cases t on t.id=test_case_id and t.project_id=c.project_id where c.id=cycle_id and public.can_edit_project(c.project_id))) with check(exists(select 1 from public.test_cycles c join public.test_cases t on t.id=test_case_id and t.project_id=c.project_id where c.id=cycle_id and public.can_edit_project(c.project_id)));
drop policy if exists "members read attachments" on public.test_case_attachments;
create policy "members read attachments" on public.test_case_attachments for select using(exists(select 1 from public.test_cases c where c.id=test_case_id and public.is_project_member(c.project_id)));
drop policy if exists "editors manage attachments" on public.test_case_attachments;
create policy "editors manage attachments" on public.test_case_attachments for all using(exists(select 1 from public.test_cases c where c.id=test_case_id and public.can_edit_project(c.project_id))) with check(exists(select 1 from public.test_cases c where c.id=test_case_id and public.can_edit_project(c.project_id)));
drop policy if exists "members read audit" on public.audit_log;
create policy "members read audit" on public.audit_log for select using(public.is_project_member(project_id));
drop policy if exists "users read own notifications" on public.notifications;
create policy "users read own notifications" on public.notifications for select using(user_id=auth.uid() and public.is_project_member(project_id));
drop policy if exists "users update own notifications" on public.notifications;
create policy "users update own notifications" on public.notifications for update using(user_id=auth.uid() and public.is_project_member(project_id)) with check(user_id=auth.uid() and public.is_project_member(project_id));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('test-evidence','test-evidence',false,10485760,array['image/png','image/jpeg','image/webp','application/pdf','text/plain'])
on conflict(id) do update set public=false,file_size_limit=10485760;
drop policy if exists "workspace members read evidence" on storage.objects;
create policy "workspace members read evidence" on storage.objects for select using(bucket_id='test-evidence' and exists(select 1 from public.test_case_attachments a join public.test_cases c on c.id=a.test_case_id where a.storage_path=name and public.is_project_member(c.project_id)));
drop policy if exists "workspace editors upload evidence" on storage.objects;
create policy "workspace editors upload evidence" on storage.objects for insert with check(bucket_id='test-evidence' and (storage.foldername(name))[1]=auth.uid()::text and public.can_edit_project(((storage.foldername(name))[2])::uuid));
