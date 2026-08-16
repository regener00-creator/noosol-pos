// Supabase client config for NOOSOL POS
// The publishable key below is safe to expose in frontend code — it is
// protected by Row Level Security (RLS) policies on every table
// (see supabase/migrations/0001_init.sql). Only signed-in users (Supabase Auth)
// can read/write any data; anonymous requests are rejected by RLS.

export const SUPABASE_URL = 'https://tgwqmpvdjyxwivjxceoq.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_Lo0ABFMvYp8IqceZ3DLIow_jrMv1V8j';

// Usage (once supabase-js is loaded via CDN in index.html):
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
//   <script type="module">
//     import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';
//     const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
//   </script>
