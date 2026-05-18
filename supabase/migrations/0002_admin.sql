-- Admin helpers for Zaman Sepeti
-- Run after 0001_init.sql in Supabase SQL Editor.

create or replace function public.is_admin_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and lower(p.role) = 'admin'
  );
$$;

comment on function public.is_admin_user() is 'Returns true when the signed-in user has admin role';

-- Let admins manage categories from the UI if needed.
drop policy if exists "admins can manage categories" on public.categories;
create policy "admins can manage categories" on public.categories
for all
using (public.is_admin_user())
with check (public.is_admin_user());
