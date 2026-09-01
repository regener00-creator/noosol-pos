// Deployed via Supabase dashboard editor. Creates the very first owner
// account (systemUsers[0] equivalent) — only works while `profiles` is empty.
// Runs server-side only; uses the service_role key (never exposed to the browser).
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function getServiceKey(): string {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (legacy) return legacy
  const dict = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}')
  return (dict.default || Object.values(dict)[0]) as string
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

type AdminClient = ReturnType<typeof createClient>
const PASSWORD_MIN_LENGTH = 10
const COMMON_PASSWORDS = new Set([
  '1234567890', 'password123', 'qwerty1234', 'admin12345',
  '1111111111', '0000000000', 'abcdefghij', 'password1',
])

async function validatePasswordSecurity(password: string): Promise<string> {
  if (password.length < PASSWORD_MIN_LENGTH) return `Password ต้องมีอย่างน้อย ${PASSWORD_MIN_LENGTH} ตัวอักษร`
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Password ต้องมีทั้งตัวอักษรและตัวเลข'
  if (COMMON_PASSWORDS.has(password.toLowerCase())) return 'Password นี้คาดเดาง่ายเกินไป กรุณาใช้รหัสอื่น'
  try {
    const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password))
    const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const response = await fetch(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`, {
      headers: { 'Add-Padding': 'true', 'User-Agent': 'PEPOS-password-check' },
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (response.ok) {
      const suffix = hash.slice(5)
      const leaked = (await response.text()).split(/\r?\n/).some((line) => line.split(':')[0] === suffix)
      if (leaked) return 'Password นี้เคยรั่วไหลบนอินเทอร์เน็ต กรุณาใช้รหัสอื่น'
    }
  } catch (error) {
    console.warn('Leaked-password lookup unavailable', error)
  }
  return ''
}

async function cleanupCreatedOwner(
  admin: AdminClient,
  userId: string,
  createdWarehouseId: number | null = null,
) {
  const errors: string[] = []
  const { error: accessError } = await admin
    .from('profile_warehouse_access')
    .delete()
    .eq('user_id', userId)
  if (accessError) errors.push(`warehouse access: ${accessError.message}`)

  const { error: profileError } = await admin.from('profiles').delete().eq('id', userId)
  if (profileError) errors.push(`profile: ${profileError.message}`)

  if (createdWarehouseId) {
    const { error: warehouseError } = await admin.from('warehouses').delete().eq('id', createdWarehouseId)
    if (warehouseError) errors.push(`warehouse: ${warehouseError.message}`)
  }

  let authDeleted = false
  let authError = ''
  for (let attempt = 0; attempt < 2 && !authDeleted; attempt += 1) {
    const { error } = await admin.auth.admin.deleteUser(userId)
    if (!error) authDeleted = true
    else authError = error.message
  }
  if (!authDeleted) errors.push(`Auth: ${authError || 'unknown cleanup error'}`)
  return { ok: errors.length === 0, error: errors.join('; ') }
}

function cleanupMessage(baseMessage: string, cleanup: { ok: boolean; error: string }) {
  return cleanup.ok
    ? baseMessage
    : `${baseMessage}; คำเตือน: กู้คืนการสร้างเจ้าของร้านไม่ครบ (${cleanup.error}) กรุณาตรวจสอบ Supabase Auth และข้อมูลร้าน`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const serviceKey = getServiceKey()
    const admin = createClient(url, serviceKey)

    const { count, error: countErr } = await admin
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('owner', true)
      .eq('level', 1)
    if (countErr) return json({ error: countErr.message }, 500)
    if ((count || 0) > 0) {
      return json({ error: 'ระบบมีเจ้าของร้านอยู่แล้ว ไม่สามารถตั้งค่าใหม่ได้' }, 403)
    }

    const body = await req.json()
    const setupToken = String(body.setupToken || '')
    const { data: tokenAllowed, error: tokenError } = await admin.rpc('admin_validate_owner_bootstrap_token', {
      p_token: setupToken,
    })
    if (tokenError || tokenAllowed !== true) {
      return json({ error: 'เครื่องนี้ไม่มีกุญแจตั้งค่าเจ้าของร้าน หรือกุญแจหมดอายุ กรุณาคืนค่าโรงงานจากเครื่องเจ้าของร้านอีกครั้ง' }, 403)
    }
    const username = String(body.username || '').trim()
    const password = String(body.password || '')
    const firstName = String(body.firstName || '').trim()
    const phone = String(body.phone || '').trim()

    if (!username || !/^[A-Za-z0-9._-]+$/.test(username)) {
      return json({ error: 'ID ใช้ได้เฉพาะตัวอักษรอังกฤษ ตัวเลข จุด ขีดกลาง และขีดล่าง' }, 400)
    }
    const passwordError = await validatePasswordSecurity(password)
    if (passwordError) return json({ error: passwordError }, 400)
    if (!firstName) {
      return json({ error: 'กรุณากรอกชื่อเจ้าของร้าน' }, 400)
    }

    const email = username.toLowerCase() + '@noosol-pos.internal'
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (createErr) return json({ error: createErr.message }, 400)

    const { error: profileErr } = await admin.from('profiles').insert({
      id: created.user.id,
      username: username.toLowerCase(),
      first_name: firstName,
      phone,
      owner: true,
      level: 1,
    })
    if (profileErr) {
      const cleanup = await cleanupCreatedOwner(admin, created.user.id)
      return json({ error: cleanupMessage(profileErr.message, cleanup) }, cleanup.ok ? 400 : 500)
    }

    let warehouseId: number | null = null
    let createdWarehouseId: number | null = null
    const { data: existingWarehouse, error: warehouseReadErr } = await admin
      .from('warehouses')
      .select('id')
      .order('id')
      .limit(1)
      .maybeSingle()
    if (warehouseReadErr) {
      const cleanup = await cleanupCreatedOwner(admin, created.user.id)
      return json({ error: cleanupMessage(warehouseReadErr.message, cleanup) }, cleanup.ok ? 400 : 500)
    }
    warehouseId = existingWarehouse?.id || null
    if (!warehouseId) {
      const warehouseData = {
        name: 'สำนักงานใหญ่',
        code: 'WH-001',
        address: '',
        postcode: '',
        purpose: 'ขายสินค้า',
        contactName: firstName,
        email: '',
        phone,
      }
      const { data: createdWarehouse, error: warehouseErr } = await admin
        .from('warehouses')
        .insert({ name: warehouseData.name, data: warehouseData })
        .select('id')
        .single()
      if (warehouseErr) {
        const cleanup = await cleanupCreatedOwner(admin, created.user.id)
        return json({ error: cleanupMessage(warehouseErr.message, cleanup) }, cleanup.ok ? 400 : 500)
      }
      warehouseId = createdWarehouse.id
      createdWarehouseId = createdWarehouse.id
    }

    const { error: accessErr } = await admin.from('profile_warehouse_access').upsert({
      user_id: created.user.id,
      warehouse_id: warehouseId,
      can_sell: true,
      can_receive_goods: true,
      can_manage_stock: true,
    })
    if (accessErr) {
      const cleanup = await cleanupCreatedOwner(admin, created.user.id, createdWarehouseId)
      return json({ error: cleanupMessage(accessErr.message, cleanup) }, cleanup.ok ? 400 : 500)
    }

    const { data: tokenConsumed, error: consumeError } = await admin.rpc('admin_consume_owner_bootstrap_token', {
      p_token: setupToken,
    })
    if (consumeError || tokenConsumed !== true) {
      const cleanup = await cleanupCreatedOwner(admin, created.user.id, createdWarehouseId)
      const message = cleanupMessage('กุญแจตั้งค่าเจ้าของร้านถูกใช้งานแล้ว กรุณาเริ่มขั้นตอนใหม่', cleanup)
      return json({ error: message }, cleanup.ok ? 409 : 500)
    }

    return json({ ok: true, id: created.user.id, warehouseId })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
