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
    if (!password || password.length < 4) {
      return json({ error: 'Password ต้องมีอย่างน้อย 4 ตัวอักษร' }, 400)
    }
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
      await admin.auth.admin.deleteUser(created.user.id)
      return json({ error: profileErr.message }, 400)
    }

    let warehouseId: number | null = null
    const { data: existingWarehouse, error: warehouseReadErr } = await admin
      .from('warehouses')
      .select('id')
      .order('id')
      .limit(1)
      .maybeSingle()
    if (warehouseReadErr) {
      await admin.from('profiles').delete().eq('id', created.user.id)
      await admin.auth.admin.deleteUser(created.user.id)
      return json({ error: warehouseReadErr.message }, 400)
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
        await admin.from('profiles').delete().eq('id', created.user.id)
        await admin.auth.admin.deleteUser(created.user.id)
        return json({ error: warehouseErr.message }, 400)
      }
      warehouseId = createdWarehouse.id
    }

    const { error: accessErr } = await admin.from('profile_warehouse_access').upsert({
      user_id: created.user.id,
      warehouse_id: warehouseId,
      can_sell: true,
      can_manage_stock: true,
    })
    if (accessErr) {
      await admin.from('profiles').delete().eq('id', created.user.id)
      await admin.auth.admin.deleteUser(created.user.id)
      return json({ error: accessErr.message }, 400)
    }

    const { data: tokenConsumed, error: consumeError } = await admin.rpc('admin_consume_owner_bootstrap_token', {
      p_token: setupToken,
    })
    if (consumeError || tokenConsumed !== true) {
      await admin.from('profile_warehouse_access').delete().eq('user_id', created.user.id)
      await admin.from('profiles').delete().eq('id', created.user.id)
      await admin.auth.admin.deleteUser(created.user.id)
      return json({ error: 'กุญแจตั้งค่าเจ้าของร้านถูกใช้งานแล้ว กรุณาเริ่มขั้นตอนใหม่' }, 409)
    }

    return json({ ok: true, id: created.user.id, warehouseId })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
