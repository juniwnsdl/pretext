import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type Environment = Readonly<Record<string, string | undefined>>;

export interface SupabaseServerConfig {
  url: string;
  secretKey: string;
}

export function readSupabaseServerConfig(
  environment: Environment = process.env,
): SupabaseServerConfig {
  const url = environment.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const secretKey = environment.SUPABASE_SECRET_KEY?.trim()
    || environment.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !secretKey) {
    throw new Error('Supabase 서버 환경변수가 설정되지 않았습니다.');
  }
  return { url, secretKey };
}

export function createSupabaseAdminClient(
  environment: Environment = process.env,
): SupabaseClient {
  const { url, secretKey } = readSupabaseServerConfig(environment);
  return createClient(url, secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
