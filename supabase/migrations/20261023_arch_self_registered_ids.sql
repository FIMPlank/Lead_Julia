-- Participants choose their own ID; it is created on first use.
alter table public.arch_participants drop constraint arch_participants_code_check;
alter table public.arch_participants add constraint arch_participants_code_check
  check (char_length(code) between 2 and 60 and code = btrim(code) and code !~ '[[:cntrl:]]');

create or replace function public.arch_get_survey(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_code text := btrim(coalesce(p_code, ''));
  v_part public.arch_participants;
begin
  if char_length(v_code) not between 2 and 60 or v_code ~ '[[:cntrl:]]' then
    raise exception 'invalid_code' using errcode = 'P0001';
  end if;
  select * into v_part from public.arch_participants where upper(code) = upper(v_code);
  if not found then
    insert into public.arch_participants (code, started_at) values (v_code, now())
    on conflict do nothing;
    select * into v_part from public.arch_participants where upper(code) = upper(v_code);
  elsif v_part.started_at is null then
    update public.arch_participants set started_at = now() where code = v_part.code;
  end if;
  return jsonb_build_object(
    'participant', jsonb_build_object('code', v_part.code, 'submitted_at', v_part.submitted_at),
    'settings', (select to_jsonb(s) - 'id' - 'updated_at' from public.arch_settings s where s.id = 1),
    'archetypes', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'description', a.description) order by a.sort_order, a.created_at) from public.arch_archetypes a), '[]'::jsonb),
    'cases', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'description', c.description) order by c.sort_order, c.created_at) from public.arch_cases c where c.active), '[]'::jsonb),
    'responses', coalesce((select jsonb_object_agg(r.case_id, jsonb_build_object('value', r.value, 'comment', r.comment)) from public.arch_responses r where r.participant_code = v_part.code), '{}'::jsonb)
  );
end;
$$;
