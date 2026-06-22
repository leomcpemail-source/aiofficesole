-- AISole brain — secure accessor for LLM provider API keys.
--
-- The actual keys are stored in Supabase Vault (encrypted at rest) and are NOT
-- in version control. Set them once per project, e.g.:
--   select vault.create_secret('<key>', 'OPENROUTER_API_KEY', 'OpenRouter');
--   select vault.create_secret('<key>', 'MISTRAL_API_KEY',    'Mistral');
--   select vault.create_secret('<key>', 'THAILLM_API_KEY',    'Typhoon ThaiLLM');
--
-- The `brain` edge function reads them through this RPC using the service role.

create or replace function public.get_provider_secret(secret_name text)
returns text
language sql
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = secret_name limit 1;
$$;

-- Only the server-side service role may read secrets — never anon/authenticated.
revoke all on function public.get_provider_secret(text) from public;
grant execute on function public.get_provider_secret(text) to service_role;
