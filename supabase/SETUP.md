# Supabase bootstrap for Zaman Sepeti

This repo now contains the SQL needed for the live backend, but the schema must be applied to your Supabase project once from the dashboard or CLI.

Project:
- URL: https://rolmtojoocllqujtswes.supabase.co

Public client config already used by the app:
- `supabaseUrl`
- `supabaseAnonKey` / publishable key

## 1) Apply the schema

Open Supabase SQL Editor and run:

```sql
-- File: supabase/migrations/0001_init.sql
```

Recommended order:
1. Paste the full migration file into SQL Editor.
2. Run it once.
3. Confirm `public.categories`, `public.listings`, `public.offers`, `public.conversations`, `public.messages`, and `public.profiles` appear in the Table Editor.

## 2) Verify the public API

After migration, this should return JSON instead of a schema-cache error:

```bash
curl -s \
  -H "apikey: YOUR_PUBLISHABLE_KEY" \
  -H "Authorization: Bearer YOUR_PUBLISHABLE_KEY" \
  "https://rolmtojoocllqujtswes.supabase.co/rest/v1/categories?select=*"
```

## 3) Auth providers

Enable in Supabase Auth:
- GitHub provider
- Email OTP / magic link

Make sure the redirect URLs include:
- `https://atk1905.github.io/zaman-sepeti/`
- `http://localhost:8080/`

## 4) Optional expiry automation

Use one of these:
- Supabase scheduled function calling `public.expire_old_listings()`
- External cron hitting your Edge Function

## 5) Expected behavior after bootstrap

- The home page should show seeded categories
- New users get a profile row automatically via trigger
- Accepting an offer creates a conversation atomically
- Listings expire after 7 days via `expires_at`

## 6) Troubleshooting

If the REST endpoint still says the table is missing:
- The migration was not applied to this project, or
- You ran it in the wrong project, or
- The schema cache needs a short refresh delay

If RLS blocks a query:
- Confirm the policy exists
- Verify the client is signed in for write operations
- Use the public anon key only for client-side reads and authenticated writes
