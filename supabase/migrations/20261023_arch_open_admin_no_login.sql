-- Admin page is internal and has no login (explicit decision by the project owner):
-- the browser key may read and edit the arch_ tables.
drop policy arch_admin_all on public.arch_settings;
drop policy arch_admin_all on public.arch_archetypes;
drop policy arch_admin_all on public.arch_cases;
drop policy arch_admin_all on public.arch_participants;
drop policy arch_admin_all on public.arch_responses;
drop table public.arch_admins;
drop function public.arch_is_admin();

grant select, insert, update, delete on public.arch_settings, public.arch_archetypes, public.arch_cases,
  public.arch_participants, public.arch_responses to anon, authenticated;

create policy arch_open on public.arch_settings     for all to anon, authenticated using (true) with check (true);
create policy arch_open on public.arch_archetypes   for all to anon, authenticated using (true) with check (true);
create policy arch_open on public.arch_cases        for all to anon, authenticated using (true) with check (true);
create policy arch_open on public.arch_participants for all to anon, authenticated using (true) with check (true);
create policy arch_open on public.arch_responses    for all to anon, authenticated using (true) with check (true);
