-- Archetype names and case titles may be up to 300 characters (was 80 / 200).
alter table public.arch_archetypes drop constraint arch_archetypes_name_check;
alter table public.arch_archetypes add constraint arch_archetypes_name_check check (char_length(name) between 1 and 300);
alter table public.arch_cases drop constraint arch_cases_title_check;
alter table public.arch_cases add constraint arch_cases_title_check check (char_length(title) between 1 and 300);
