-- Create profiles table to store public user data
create table public.profiles (
  id uuid not null references auth.users on delete cascade,
  name text,
  has_completed_onboarding boolean default false,

  primary key (id)
);

-- Set up Row Level Security (RLS) for profiles
alter table public.profiles enable row level security;

create policy "Public profiles are viewable by everyone." on profiles
  for select using (true);

create policy "Users can insert their own profile." on profiles
  for insert with check (auth.uid() = id);

create policy "Users can update own profile." on profiles
  for update using (auth.uid() = id);

-- Function to create a profile for a new user
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name)
  values (new.id, new.raw_user_meta_data->>'name');
  return new;
end;
$$;

-- Trigger to call the function on new user sign-up
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Create projects table
create table public.projects (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null,
  pages jsonb not null,
  active_page_index integer not null default 0,
  created_at timestamp with time zone not null default now(),
  last_modified timestamp with time zone not null default now(),

  primary key (id)
);

-- Set up Row Level Security (RLS) for projects
alter table public.projects enable row level security;

create policy "Users can see their own projects." on projects
  for select using (auth.uid() = user_id);

create policy "Users can create their own projects." on projects
  for insert with check (auth.uid() = user_id);

create policy "Users can update their own projects." on projects
  for update using (auth.uid() = user_id);

create policy "Users can delete their own projects." on projects
  for delete using (auth.uid() = user_id);

-- Create storage bucket for project images
-- Note: Bucket creation must be done via the dashboard or management API.
-- This SQL is for documentation purposes.
-- insert into storage.buckets (id, name, public) values ('project_images', 'project_images', true);

-- Set up storage policies
-- Note: Policies should be set in the Supabase dashboard.
-- Allow authenticated users to upload to their own folders.
-- create policy "Authenticated users can upload images." on storage.objects for insert with check ( bucket_id = 'project_images' and auth.role() = 'authenticated' );
-- create policy "Anyone can view project images." on storage.objects for select using ( bucket_id = 'project_images' );