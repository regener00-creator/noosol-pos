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

function normalizeRecoveryAnswer(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('th-TH')
}

function hexToBytes(value: string): Uint8Array {
  return new Uint8Array(value.match(/.{2}/g)?.map((part) => Number.parseInt(part, 16)) || [])
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function hashRecoveryAnswer(answer: string, saltHex: string, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(normalizeRecoveryAnswer(answer)), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: hexToBytes(saltHex), iterations }, key, 256)
  return bytesToHex(new Uint8Array(bits))
}

function timingSafeEqualHex(left: string, right: string): boolean {
  const a = hexToBytes(left)
  const b = hexToBytes(right)
  let difference = a.length ^ b.length
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index += 1) difference |= (a[index] || 0) ^ (b[index] || 0)
  return difference === 0
}

async function hashText(value: string, algorithm: AlgorithmIdentifier = 'SHA-256'): Promise<string> {
  const digest = await crypto.subtle.digest(algorithm, new TextEncoder().encode(value))
  return bytesToHex(new Uint8Array(digest))
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
    const action = String(body.action || '').trim().toLowerCase()
    const username = String(body.username || '').trim().toLowerCase()
    if (!username || !/^[a-z0-9._-]+$/i.test(username)) return json({ error: 'กรุณากรอก ID เจ้าของร้านให้ถูกต้อง' }, 400)

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, getServiceKey(), { auth: { persistSession: false } })
    const { data: profile, error: profileError } = await admin.from('profiles').select('id').eq('owner', true).eq('username', username).maybeSingle()
    if (profileError) return json({ error: 'ตรวจสอบบัญชีเจ้าของร้านไม่สำเร็จ กรุณาลองใหม่' }, 503)
    const { data: challenge } = profile?.id
      ? await admin.from('password_recovery_challenges').select('user_id,question,answer_salt,answer_hash,answer_iterations,failed_attempts,locked_until').eq('user_id', profile.id).maybeSingle()
      : { data: null }

    if (action === 'question') {
      if (!profile?.id || !challenge?.question) return json({ error: 'ยังไม่ได้ตั้งคำถามกู้คืน Password กรุณาติดต่อผู้ดูแลระบบ' }, 404)
      return json({ ok: true, question: challenge.question })
    }
    if (action !== 'reset') return json({ error: 'คำสั่งไม่ถูกต้อง' }, 400)

    const answer = String(body.answer || '').trim()
    const password = String(body.password || '')
    if (!answer || !password) return json({ error: 'กรุณากรอกคำตอบและ Password ใหม่ให้ครบ' }, 400)
    if (password.length < PASSWORD_MIN_LENGTH || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      return json({ error: `Password ต้องมีอย่างน้อย ${PASSWORD_MIN_LENGTH} ตัวอักษร และมีทั้งตัวอักษรกับตัวเลข` }, 400)
    }
    if (!profile?.id || !challenge?.answer_hash) return json({ error: 'ID หรือคำตอบไม่ถูกต้อง' }, 400)
    if (challenge.locked_until && new Date(challenge.locked_until).getTime() > Date.now()) {
      return json({ error: 'ตอบคำถามผิดหลายครั้ง กรุณารอ 15 นาทีแล้วลองใหม่' }, 429)
    }

    const suppliedHash = await hashRecoveryAnswer(answer, String(challenge.answer_salt), Number(challenge.answer_iterations) || 310000)
    if (!timingSafeEqualHex(suppliedHash, String(challenge.answer_hash))) {
      const { data: failureRows, error: failureError } = await admin.rpc('record_password_recovery_failure', { p_user_id: profile.id })
      if (failureError) return json({ error: 'ตรวจสอบคำตอบไม่สำเร็จ กรุณาลองใหม่' }, 503)
      const failure = Array.isArray(failureRows) ? failureRows[0] : failureRows
      if (failure?.locked_until) return json({ error: 'ตอบคำถามผิดหลายครั้ง กรุณารอ 15 นาทีแล้วลองใหม่' }, 429)
      return json({ error: 'ID หรือคำตอบไม่ถูกต้อง' }, 400)
    }

    const passwordError = await validatePasswordSecurity(password)
    if (passwordError) return json({ error: passwordError }, 400)
    const { error: authError } = await admin.auth.admin.updateUserById(profile.id, { password })
    if (authError) return json({ error: authError.message }, 400)
    await admin.from('password_recovery_challenges').update({ failed_attempts: 0, locked_until: null, updated_at: new Date().toISOString() }).eq('user_id', profile.id)
    return json({ ok: true })
  } catch (error) {
    console.error('owner recovery failed', error)
    return json({ error: 'กู้คืน Password ไม่สำเร็จ กรุณาลองใหม่' }, 500)
  }
})
