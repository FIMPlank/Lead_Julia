-- Archetype placement survey (Lead_Julia). All objects prefixed arch_.

create table public.arch_settings (
  id smallint primary key default 1 check (id = 1),
  title text not null default 'Archetype placement',
  intro text not null default '',
  thanks text not null default 'Thank you! Your answers have been submitted.',
  slider_step numeric check (slider_step is null or slider_step > 0),  -- null = continuous
  allow_comments boolean not null default true,
  is_open boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.arch_archetypes (
  id uuid primary key default gen_random_uuid(),
  sort_order int not null default 0,
  name text not null check (char_length(name) between 1 and 80),
  description text not null default '',
  created_at timestamptz not null default now()
);

create table public.arch_cases (
  id uuid primary key default gen_random_uuid(),
  sort_order int not null default 0,
  title text not null check (char_length(title) between 1 and 200),
  description text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.arch_participants (
  code text primary key check (code ~ '^[A-Za-z0-9_-]{3,40}$'),
  label text not null default '',
  created_at timestamptz not null default now(),
  started_at timestamptz,
  submitted_at timestamptz
);

create table public.arch_responses (
  participant_code text not null references public.arch_participants(code) on delete cascade on update cascade,
  case_id uuid not null references public.arch_cases(id) on delete cascade,
  value numeric not null check (value >= 0),
  scale_max int not null check (scale_max >= 1),  -- archetype count - 1 at time of answer
  comment text not null default '' check (char_length(comment) <= 2000),
  updated_at timestamptz not null default now(),
  primary key (participant_code, case_id)
);
create index arch_responses_case_idx on public.arch_responses(case_id);

create table public.arch_admins (
  email text primary key
);

alter table public.arch_settings     enable row level security;
alter table public.arch_archetypes   enable row level security;
alter table public.arch_cases        enable row level security;
alter table public.arch_participants enable row level security;
alter table public.arch_responses    enable row level security;
alter table public.arch_admins       enable row level security;

-- Participants never touch tables directly; they go through the RPCs below.
revoke all on public.arch_settings, public.arch_archetypes, public.arch_cases,
  public.arch_participants, public.arch_responses, public.arch_admins from anon;

create or replace function public.arch_is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.arch_admins a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke all on function public.arch_is_admin() from public, anon;
grant execute on function public.arch_is_admin() to authenticated;

create policy arch_admin_all on public.arch_settings     for all to authenticated using ((select public.arch_is_admin())) with check ((select public.arch_is_admin()));
create policy arch_admin_all on public.arch_archetypes   for all to authenticated using ((select public.arch_is_admin())) with check ((select public.arch_is_admin()));
create policy arch_admin_all on public.arch_cases        for all to authenticated using ((select public.arch_is_admin())) with check ((select public.arch_is_admin()));
create policy arch_admin_all on public.arch_participants for all to authenticated using ((select public.arch_is_admin())) with check ((select public.arch_is_admin()));
create policy arch_admin_all on public.arch_responses    for all to authenticated using ((select public.arch_is_admin())) with check ((select public.arch_is_admin()));
create policy arch_admin_read on public.arch_admins      for select to authenticated using ((select public.arch_is_admin()));

-- Participant RPCs ----------------------------------------------------------

create or replace function public.arch_get_survey(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_part public.arch_participants;
begin
  select * into v_part from public.arch_participants where code = p_code;
  if not found then
    raise exception 'invalid_code' using errcode = 'P0001';
  end if;
  if v_part.started_at is null then
    update public.arch_participants set started_at = now() where code = p_code;
  end if;
  return jsonb_build_object(
    'participant', jsonb_build_object('code', v_part.code, 'submitted_at', v_part.submitted_at),
    'settings', (select to_jsonb(s) - 'id' - 'updated_at' from public.arch_settings s where s.id = 1),
    'archetypes', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'description', a.description) order by a.sort_order, a.created_at) from public.arch_archetypes a), '[]'::jsonb),
    'cases', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'description', c.description) order by c.sort_order, c.created_at) from public.arch_cases c where c.active), '[]'::jsonb),
    'responses', coalesce((select jsonb_object_agg(r.case_id, jsonb_build_object('value', r.value, 'comment', r.comment)) from public.arch_responses r where r.participant_code = p_code), '{}'::jsonb)
  );
end;
$$;

create or replace function public.arch_save_response(p_code text, p_case uuid, p_value numeric, p_comment text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_part public.arch_participants;
  v_max int;
begin
  select * into v_part from public.arch_participants where code = p_code;
  if not found then raise exception 'invalid_code' using errcode = 'P0001'; end if;
  if v_part.submitted_at is not null then raise exception 'already_submitted' using errcode = 'P0001'; end if;
  if not coalesce((select is_open from public.arch_settings where id = 1), false) then
    raise exception 'survey_closed' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.arch_cases where id = p_case and active) then
    raise exception 'invalid_case' using errcode = 'P0001';
  end if;
  select count(*) - 1 into v_max from public.arch_archetypes;
  if v_max < 1 then raise exception 'no_archetypes' using errcode = 'P0001'; end if;
  if p_value is null or p_value < 0 or p_value > v_max then
    raise exception 'invalid_value' using errcode = 'P0001';
  end if;
  insert into public.arch_responses (participant_code, case_id, value, scale_max, comment, updated_at)
  values (p_code, p_case, round(p_value, 4), v_max, left(coalesce(p_comment, ''), 2000), now())
  on conflict (participant_code, case_id) do update
    set value = excluded.value, scale_max = excluded.scale_max,
        comment = excluded.comment, updated_at = now();
end;
$$;

create or replace function public.arch_submit(p_code text)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  v_part public.arch_participants;
  v_missing int;
  v_now timestamptz := now();
begin
  select * into v_part from public.arch_participants where code = p_code;
  if not found then raise exception 'invalid_code' using errcode = 'P0001'; end if;
  if v_part.submitted_at is not null then return v_part.submitted_at; end if;
  if not coalesce((select is_open from public.arch_settings where id = 1), false) then
    raise exception 'survey_closed' using errcode = 'P0001';
  end if;
  select count(*) into v_missing from public.arch_cases c
  where c.active and not exists (
    select 1 from public.arch_responses r where r.case_id = c.id and r.participant_code = p_code);
  if v_missing > 0 then raise exception 'incomplete' using errcode = 'P0001'; end if;
  update public.arch_participants set submitted_at = v_now where code = p_code;
  return v_now;
end;
$$;

revoke all on function public.arch_get_survey(text), public.arch_save_response(text, uuid, numeric, text), public.arch_submit(text) from public;
grant execute on function public.arch_get_survey(text), public.arch_save_response(text, uuid, numeric, text), public.arch_submit(text) to anon, authenticated;

-- Seed ----------------------------------------------------------------------
insert into public.arch_settings (id, title, intro, slider_step)
values (1, 'Where does each case sit?',
  'For each case, move the marker along the spectrum to the archetype that fits best. If a case sits between two archetypes, place it in between.',
  0.25);

insert into public.arch_archetypes (sort_order, name) values
  (1, 'Archetype A'), (2, 'Archetype B'), (3, 'Archetype C'),
  (4, 'Archetype D'), (5, 'Archetype E'), (6, 'Archetype F');

insert into public.arch_cases (sort_order, title, description)
select i, 'Case ' || i, 'Describe case ' || i || ' here.' from generate_series(1, 10) i;
