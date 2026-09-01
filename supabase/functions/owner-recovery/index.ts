import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const PASSWORD_MIN_LENGTH = 10
const COMMON_PASSWORDS = new Set(['1234567890', 'password123', 'qwerty1234', 'admin12345', '1111111111', '0000000000', 'abcdefghij', 'password1'])

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

function getServiceKey(): string {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (legacy) return legacy
  const dict = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}')
  return (dict.default || Object.values(dict)[0]) as string
}

async function hashText(value: string, algorithm: AlgorithmIdentifier = 'SHA-256'): Promise<string> {
  const digest = await crypto.subtle.digest(algorithm, new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function validatePasswordSecurity(password: string): Promise<string> {
  if (password.length < PASSWORD_MIN_LENGTH) return `Password ต้องมีอย่างน้อย ${PASSWORD_MIN_LENGTH} ตัวอักษร`
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Password ต้องมีทั้งตัวอักษรและตัวเลข'
  if (COMMON_PASSWORDS.has(password.toLowerCase())) return 'Password นี้คาดเดาง่ายเกินไป กรุณาใช้รหัสอื่น'
  try {
    const hash = (await hashText(password, 'SHA-1')).toUpperCase()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const response = await fetch(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`, {
      headers: { 'Add-Padding': 'true', 'User-Agent': 'PEPOS-password-check' }, signal: controller.signal,
    })
    clearTimeout(timeout)
    if (response.ok) {
      const suffix = hash.slice(5)
      if ((await response.text()).split(/\r?\n/).some((line) => line.split(':')[0] === suffix)) return 'Password นี้เคยรั่วไหลบนอินเทอร์เน็ต กรุณาใช้รหัสอื่น'
    }
  } catch (error) { console.warn('Leaked-password lookup unavailable', error) }
  return ''
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  try {
    const body = await req.json()
    const username = String(body.username || '').trim().toLowerCase()
    const recoveryCode = String(body.recoveryCode || '').replace(/[^a-f0-9]/gi, '').toUpperCase()
    const password = String(body.password || '')
    if (!username || !/^[A-F0-9]{24}$/.test(recoveryCode)) return json({ error: 'ID หรือรหัสกู้คืนไม่ถูกต้อง' }, 400)
    const passwordError = await validatePasswordSecurity(password)
    if (passwordError) return json({ error: passwordError }, 400)

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, getServiceKey(), { auth: { persistSession: false } })
    const suppliedHash = await hashText(recoveryCode)
    // Look up by the 96-bit one-time secret first. Invalid requests therefore
    // cannot discover an owner username or deliberately lock a valid code.
    const { data: recovery } = await admin.from('owner_recovery_codes').select('owner_id,expires_at,used_at').eq('code_hash', suppliedHash).maybeSingle()
    if (!recovery || recovery.used_at || new Date(recovery.expires_at).getTime() <= Date.now()) return json({ error: 'ID หรือรหัสกู้คืนไม่ถูกต้อง' }, 400)
    const { data: profile } = await admin.from('profiles').select('id').eq('id', recovery.owner_id).eq('owner', true).ilike('username', username).maybeSingle()
    if (!profile?.id) return json({ error: 'ID หรือรหัสกู้คืนไม่ถูกต้อง' }, 400)
    const { error: authError } = await admin.auth.admin.updateUserById(profile.id, { password })
    if (authError) return json({ error: authError.message }, 400)
    await admin.from('owner_recovery_codes').update({ used_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('owner_id', profile.id)
    return json({ ok: true })
  } catch (error) {
    console.error('owner recovery failed', error)
    return json({ error: 'กู้คืน Password ไม่สำเร็จ กรุณาลองใหม่' }, 500)
  }
})
