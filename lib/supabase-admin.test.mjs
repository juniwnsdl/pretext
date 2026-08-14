import test from 'node:test';
import assert from 'node:assert/strict';

import { readSupabaseServerConfig } from './supabase-admin.ts';

test('reads the project URL and legacy server-only service role key', () => {
  assert.deepEqual(
    readSupabaseServerConfig({
      NEXT_PUBLIC_SUPABASE_URL: 'https://project-ref.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'legacy-service-role',
    }),
    {
      url: 'https://project-ref.supabase.co',
      secretKey: 'legacy-service-role',
    },
  );
});

test('prefers the new Supabase secret key and rejects missing configuration', () => {
  assert.deepEqual(
    readSupabaseServerConfig({
      NEXT_PUBLIC_SUPABASE_URL: 'https://project-ref.supabase.co',
      SUPABASE_SECRET_KEY: 'sb_secret_new',
      SUPABASE_SERVICE_ROLE_KEY: 'legacy-service-role',
    }),
    {
      url: 'https://project-ref.supabase.co',
      secretKey: 'sb_secret_new',
    },
  );
  assert.throws(() => readSupabaseServerConfig({}), /Supabase/i);
});
