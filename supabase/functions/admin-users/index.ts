// Deployed via Supabase dashboard editor. Lets the store owner create/update/
// delete staff accounts (replaces the old plaintext systemUsers array), and
// lets any signed-in user update their own display info (self-update).
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

function getPublicKey(): string {
  return Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY') || ''
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

type AdminClient = ReturnType<typeof createClient>
const WAREHOUSE_ACCESS_PAGE_SIZE = 500
const PROFILE_PAGE_SIZE = 500

function normalizeWarehouseIds(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null
  const ids = value.map((entry) => Number(entry))
  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) return null
  return [...new Set(ids)]
}

async function listAllProfiles(admin: AdminClient) {
  const rows: Array<Record<string, unknown>> = []
  for (let from = 0; ; from += PROFILE_PAGE_SIZE) {
    const { data, error } = await admin
      .from('profiles')
      .select('id, username, first_name, last_name, phone, note, owner, level')
      .order('owner', { ascending: false })
      .order('id')
      .range(from, from + PROFILE_PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    const batch = data || []
    rows.push(...batch)
    if (batch.length < PROFILE_PAGE_SIZE) break
  }
  return rows
}

async function listAllWarehouseAccess(admin: AdminClient) {
  const rows: Array<{ user_id: string; warehouse_id: number }> = []
  for (let from = 0; ; from += WAREHOUSE_ACCESS_PAGE_SIZE) {
    const { data, error } = await admin
      .from('profile_warehouse_access')
      .select('user_id, warehouse_id')
      .order('user_id')
      .order('warehouse_id')
      .range(from, from + WAREHOUSE_ACCESS_PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    const batch = data || []
    rows.push(...batch)
    if (batch.length < WAREHOUSE_ACCESS_PAGE_SIZE) break
  }
  return rows
}

async function deleteAuthUserWithRetry(admin: AdminClient, userId: string) {
  let lastError = ''
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { error } = await admin.auth.admin.deleteUser(userId)
    if (!error) return { ok: true, error: '' }
    lastError = error.message
  }
  return { ok: false, error: lastError || 'unknown Auth cleanup error' }
}

async function verifyCurrentPassword(url: string, email: string, password: string) {
  const publicKey = getPublicKey()
  if (!publicKey) return false
  const verifier = createClient(url, publicKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const { data, error } = await verifier.auth.signInWithPassword({ email, password })
  if (!error) await verifier.auth.signOut({ scope: 'local' })
  return !error && !!data.user
}

async function listAllAuthUsers(admin: ReturnType<typeof createClient>) {
  const users: Array<{ id: string }> = []
  for (let page = 1; page <= 1000; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    const batch = (data.users || []).map((user) => ({ id: user.id }))
    users.push(...batch)
    if (batch.length < 1000) break
  }
  return users
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const serviceKey = getServiceKey()
    const admin = createClient(url, serviceKey)

    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace('Bearer ', '').trim()
    if (!token) return json({ error: 'unauthorized' }, 401)

    const { data: userData, error: userErr } = await admin.auth.getUser(token)
    const caller = userData?.user
    if (userErr || !caller) return json({ error: 'unauthorized' }, 401)

    const body = await req.json()
    const action = body.action

    // Self-service: any signed-in user may update their OWN display info.
    // No owner check needed here — scoped strictly to caller.id, and only
    // to non-privileged fields (never level/owner/username).
    if (action === 'self-update') {
      const updates: Record<string, unknown> = {}
      if (body.firstName !== undefined) updates.first_name = String(body.firstName).trim()
      if (body.lastName !== undefined) updates.last_name = String(body.lastName).trim()
      if (body.phone !== undefined) updates.phone = String(body.phone).trim()
      if (Object.keys(updates).length) {
        const { error } = await admin.from('profiles').update(updates).eq('id', caller.id)
        if (error) return json({ error: error.message }, 400)
      }
      return json({ ok: true })
    }

    // Everything below is owner-only.
    const { data: callerProfile } = await admin
      .from('profiles')
      .select('owner, level, username')
      .eq('id', caller.id)
      .single()
    if (!callerProfile?.owner || Number(callerProfile.level) !== 1) return json({ error: 'forbidden: owner only' }, 403)

    if (action === 'reset-store') {
      const mode = String(body.mode || '').trim().toLowerCase()
      const password = String(body.password || '')
      const phrase = String(body.phrase || '').trim()
      const expectedPhrase = mode === 'factory' ? 'คืนค่าโรงงาน' : 'ล้างเอกสารและสต๊อก'
      if (!['documents', 'factory'].includes(mode)) return json({ error: 'รูปแบบการรีเซ็ตไม่ถูกต้อง' }, 400)
      if (phrase !== expectedPhrase) return json({ error: `กรุณาพิมพ์ “${expectedPhrase}” ให้ถูกต้อง` }, 400)
      if (!password || !caller.email || !(await verifyCurrentPassword(url, caller.email, password))) {
        return json({ error: 'รหัสผ่านเจ้าของร้านไม่ถูกต้อง' }, 403)
      }

      let bootstrapToken = ''
      if (mode === 'factory') {
        bootstrapToken = `${crypto.randomUUID()}${crypto.randomUUID()}`
        const { error: bootstrapError } = await admin.rpc('admin_prepare_owner_bootstrap_token', {
          p_actor_id: caller.id,
          p_token: bootstrapToken,
        })
        if (bootstrapError) return json({ error: bootstrapError.message }, 400)
      }

      const confirmation = mode === 'factory' ? 'CONFIRM_FACTORY_RESET' : 'CONFIRM_DOCUMENT_RESET'
      const { data: resetResult, error: resetError } = await admin.rpc('admin_reset_store_data', {
        p_mode: mode,
        p_actor_id: caller.id,
        p_confirmation: confirmation,
      })
      if (resetError) return json({ error: resetError.message }, 400)

      if (mode === 'factory') {
        const authUsers = await listAllAuthUsers(admin)
        const ordered = [...authUsers.filter((user) => user.id !== caller.id), ...authUsers.filter((user) => user.id === caller.id)]
        const failed: string[] = []
        for (const user of ordered) {
          let deleted = false
          for (let attempt = 0; attempt < 2 && !deleted; attempt += 1) {
            const { error } = await admin.auth.admin.deleteUser(user.id)
            if (!error) deleted = true
          }
          if (!deleted) failed.push(user.id)
        }
        return json({
          ok: true,
          reset: { ...(resetResult || {}), bootstrapToken },
          ...(failed.length ? { warning: 'ล้างข้อมูลแล้ว แต่ลบบัญชีผู้ใช้งานเดิมบางส่วนไม่สำเร็จ บัญชีเหล่านั้นไม่มีสิทธิ์เข้าถึงข้อมูลร้านแล้ว' } : {}),
        })
      }

      return json({ ok: true, reset: resetResult })
    }

    if (action === 'list') {
      let profiles: Array<Record<string, unknown>>
      let accessRows: Array<{ user_id: string; warehouse_id: number }>
      try {
        ;[profiles, accessRows] = await Promise.all([
          listAllProfiles(admin),
          listAllWarehouseAccess(admin),
        ])
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : String(error) }, 400)
      }
      const warehouseIdsByUser = new Map<string, number[]>()
      for (const row of accessRows || []) {
        const userId = String(row.user_id || '')
        const warehouseId = Number(row.warehouse_id)
        if (!userId || !Number.isSafeInteger(warehouseId) || warehouseId <= 0) continue
        const ids = warehouseIdsByUser.get(userId) || []
        ids.push(warehouseId)
        warehouseIdsByUser.set(userId, ids)
      }
      const users = profiles.map((profile) => ({
        ...profile,
        warehouseIds: warehouseIdsByUser.get(String(profile.id)) || [],
      }))
      return json({ ok: true, users })
    }

    if (action === 'create') {
      const username = String(body.username || '').trim()
      const password = String(body.password || '')
      const firstName = String(body.firstName || '').trim()
      const phone = String(body.phone || '').trim()
      const note = String(body.note || '').trim()
      const level = body.level === undefined ? 2 : Number(body.level)
      const warehouseIds = normalizeWarehouseIds(body.warehouseIds)

      if (!username || !/^[A-Za-z0-9._-]+$/.test(username)) {
        return json({ error: 'ID ใช้ได้เฉพาะตัวอักษรอังกฤษ ตัวเลข จุด ขีดกลาง และขีดล่าง' }, 400)
      }
      if (!password || password.length < 4) {
        return json({ error: 'Password ต้องมีอย่างน้อย 4 ตัวอักษร' }, 400)
      }
      if (!firstName) return json({ error: 'กรุณากรอกชื่อ' }, 400)
      if (![2, 3, 4].includes(level)) return json({ error: 'ระดับสิทธิ์ผู้ใช้งานไม่ถูกต้อง' }, 400)
      if (!warehouseIds) return json({ error: 'รูปแบบคลังสินค้าที่เลือกไม่ถูกต้อง' }, 400)
      if (!warehouseIds.length) return json({ error: 'ผู้ใช้งานทั่วไปต้องเข้าถึงคลังสินค้าอย่างน้อย 1 แห่ง' }, 400)

      const email = username.toLowerCase() + '@noosol-pos.internal'
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      })
      if (createErr) return json({ error: createErr.message }, 400)

      const { error: profileErr } = await admin.rpc('admin_create_staff_profile_access', {
        p_user_id: created.user.id,
        p_username: username.toLowerCase(),
        p_first_name: firstName,
        p_phone: phone,
        p_note: note,
        p_level: level,
        p_warehouse_ids: warehouseIds,
      })
      if (profileErr) {
        const cleanup = await deleteAuthUserWithRetry(admin, created.user.id)
        const cleanupWarning = cleanup.ok
          ? ''
          : `; คำเตือน: สร้างบัญชี Auth แล้วแต่ลบคืนไม่สำเร็จ (${cleanup.error}) กรุณาตรวจสอบบัญชี ${username.toLowerCase()} ใน Supabase Auth`
        return json({ error: profileErr.message + cleanupWarning }, cleanup.ok ? 400 : 500)
      }
      return json({ ok: true, id: created.user.id })
    }

    if (action === 'update') {
      const id = String(body.id || '')
      if (!id) return json({ error: 'missing id' }, 400)
      const password = body.password ? String(body.password) : ''
      const { data: target, error: targetError } = await admin
        .from('profiles')
        .select('owner, level')
        .eq('id', id)
        .single()
      if (targetError || !target) return json({ error: targetError?.message || 'ไม่พบผู้ใช้งาน' }, 404)
      const targetIsOwner = target.owner === true
      if (password && password.length < 4) return json({ error: 'Password ต้องมีอย่างน้อย 4 ตัวอักษร' }, 400)

      let warehouseIds: number[] | null = null
      if (body.warehouseIds !== undefined) {
        warehouseIds = normalizeWarehouseIds(body.warehouseIds)
        if (!warehouseIds) return json({ error: 'รูปแบบคลังสินค้าที่เลือกไม่ถูกต้อง' }, 400)
        if (!targetIsOwner && !warehouseIds.length) {
          return json({ error: 'ผู้ใช้งานทั่วไปต้องเข้าถึงคลังสินค้าอย่างน้อย 1 แห่ง' }, 400)
        }
      }
      const requestedLevel = body.level === undefined ? null : Number(body.level)
      if (!targetIsOwner && requestedLevel !== null && ![2, 3, 4].includes(requestedLevel)) {
        return json({ error: 'ระดับสิทธิ์ผู้ใช้งานไม่ถูกต้อง' }, 400)
      }
      if (targetIsOwner && id !== caller.id) {
        return json({ error: 'ไม่สามารถแก้ไขเจ้าของร้านหลักบัญชีอื่นได้' }, 403)
      }

      // Auth and Postgres cannot share one transaction. Change the password
      // first, then apply profile + access atomically. A later DB error is
      // reported explicitly instead of attempting a race-prone rollback.
      let passwordChanged = false
      if (password) {
        const { error } = await admin.auth.admin.updateUserById(id, { password })
        if (error) return json({ error: error.message }, 400)
        passwordChanged = true
      }

      if (targetIsOwner) {
        const updates: Record<string, unknown> = {}
        if (body.firstName !== undefined) updates.first_name = String(body.firstName).trim()
        if (body.phone !== undefined) updates.phone = String(body.phone).trim()
        if (body.note !== undefined) updates.note = String(body.note).trim()
        if (Object.keys(updates).length) {
          const { data: updatedOwner, error } = await admin
            .from('profiles')
            .update(updates)
            .eq('id', id)
            .select('id')
            .maybeSingle()
          if (error || !updatedOwner) {
            const message = error?.message || 'ไม่พบโปรไฟล์เจ้าของร้าน'
            const warning = passwordChanged
              ? 'เปลี่ยน Password สำเร็จแล้ว แต่บันทึกข้อมูลเจ้าของร้านไม่สำเร็จ กรุณาลองบันทึกอีกครั้งโดยเว้นช่อง Password ว่าง: '
              : ''
            return json({ error: warning + message }, passwordChanged ? 409 : 400)
          }
        }
        return json({ ok: true })
      }

      const { error: updateError } = await admin.rpc('admin_update_staff_profile_access', {
        p_user_id: id,
        p_first_name: body.firstName === undefined ? null : String(body.firstName).trim(),
        p_phone: body.phone === undefined ? null : String(body.phone).trim(),
        p_note: body.note === undefined ? null : String(body.note).trim(),
        p_level: requestedLevel,
        p_warehouse_ids: warehouseIds,
      })
      if (updateError) {
        const warning = passwordChanged
          ? 'เปลี่ยน Password สำเร็จแล้ว แต่ข้อมูลผู้ใช้งานและสิทธิ์คลังไม่ได้เปลี่ยน กรุณาลองบันทึกอีกครั้งโดยเว้นช่อง Password ว่าง: '
          : ''
        return json({ error: warning + updateError.message }, passwordChanged ? 409 : 400)
      }
      return json({ ok: true })
    }

    if (action === 'delete') {
      const id = String(body.id || '')
      if (!id) return json({ error: 'missing id' }, 400)
      const { data: target, error: targetError } = await admin
        .from('profiles')
        .select('owner')
        .eq('id', id)
        .maybeSingle()
      if (targetError) return json({ error: `ตรวจสอบผู้ใช้งานก่อนลบไม่สำเร็จ: ${targetError.message}` }, 400)
      if (!target) return json({ error: 'ไม่พบผู้ใช้งาน' }, 404)
      if (target.owner) return json({ error: 'ไม่สามารถลบเจ้าของร้านหลักได้' }, 400)

      const { data: openShift, error: openShiftError } = await admin
        .from('cash_shifts')
        .select('id')
        .eq('opened_by', id)
        .eq('status', 'open')
        .limit(1)
        .maybeSingle()
      if (openShiftError) return json({ error: `ตรวจสอบกะเงินสดก่อนลบไม่สำเร็จ: ${openShiftError.message}` }, 400)
      if (openShift) {
        return json({ error: 'ไม่สามารถลบผู้ใช้งานที่มีกะเงินสดเปิดอยู่ กรุณาปิดกะก่อนลบผู้ใช้งาน' }, 409)
      }

      // Delete Auth first. Profiles/access cascade, while immutable history
      // keeps its operator-name snapshot and clears only nullable actor IDs.
      const { error } = await admin.auth.admin.deleteUser(id)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    return json({ error: 'unknown action' }, 400)
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
