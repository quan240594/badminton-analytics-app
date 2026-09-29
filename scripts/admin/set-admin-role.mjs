import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.TARGET_EMAIL;

if (!url || !serviceRoleKey || !email) {
  console.error('Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or TARGET_EMAIL env var.');
  process.exit(1);
}

// service-role key bypasses RLS/auth entirely - never expose this client-side.
const supabase = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// admin.listUsers() is paginated; walk pages until the email is found.
async function findUserByEmail(targetEmail) {
  let page = 1;
  const perPage = 200;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === targetEmail.toLowerCase());
    if (match) return match;
    if (data.users.length < perPage) return null;
    page += 1;
  }
}

const user = await findUserByEmail(email);
if (!user) {
  console.error(`No registered user found with email ${email}. They must register in the app first.`);
  process.exit(1);
}

const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, {
  app_metadata: { ...user.app_metadata, role: 'admin' },
});

if (updateError) {
  console.error('Failed to set admin role:', updateError.message);
  process.exit(1);
}

console.log(`Granted admin role to ${email} (${user.id}).`);
